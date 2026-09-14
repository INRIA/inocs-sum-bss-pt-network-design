# -*- coding: utf-8 -*-
from datetime import datetime
from typing import Dict, Any, Iterable

import contextily as cx
from shapely.geometry import LineString

from util.util import *
import matplotlib.pyplot as plt


# ---------- 0) 项目根目录 ----------
def get_project_root():
    """
    返回项目根目录：脚本所处目录的上一层（pythonProject/）
    如需更稳健，可按你项目标志文件扩展搜索逻辑。
    """
    return SysPath(__file__).resolve().parents[1]


# ---------- 1) 找到“最新”的 GeoJSON ----------
def find_latest_geojson(prefix="selected_bike_stations", subdir="data/output/geojson"):
    """
    在项目根目录下的 subdir 中查找最新(按修改时间)的、以 prefix 开头的 .geojson 文件
    """
    root = get_project_root()
    folder = root / subdir
    if not folder.exists():
        raise FileNotFoundError(f"GeoJSON 目录不存在: {folder}")

    files = sorted(
        [p for p in folder.glob(f"{prefix}*.geojson") if p.is_file()],
        key=lambda p: p.stat().st_mtime,
        reverse=True
    )
    if not files:
        raise FileNotFoundError(f"未在 {folder} 找到以 {prefix} 开头的 .geojson 文件")
    return files[0]


def _node_to_lonlat(n: Any):
    """从 Node 取出 (lon, lat)，做几种常见字段的降级回退。"""
    if hasattr(n, "coordinate") and n.coordinate:
        lon, lat = n.coordinate
        return float(lon), float(lat)
    # 兼容其它可能的字段名
    if hasattr(n, "lon") and hasattr(n, "lat"):
        return float(n.lon), float(n.lat)
    if hasattr(n, "x") and hasattr(n, "y"):
        return float(n.x), float(n.y)
    return None


def _dedupe_consecutive(points: Iterable):
    """去掉相邻重复点，避免 LineString 报错或生成零长度段。"""
    out = []
    last = None
    for p in points:
        if p and p != last:
            out.append(p)
            last = p
    return out


def public_transport_to_gdf_lines(public_transport) -> gpd.GeoDataFrame:
    """
    将 PublicTransport.routes 转为线路 GeoDataFrame (EPSG:4326)
    期望 routes: Dict[str, List[Node]]，Node.coordinate=(lon,lat)
    """
    if not hasattr(public_transport, "routes"):
        raise AttributeError("public_transport 对象缺少属性 'routes'")

    records = []
    for route_id, nodes in public_transport.routes.items():
        # nodes 可能是 Node 列表或坐标元组列表
        coords = []
        for n in nodes:
            pt = _node_to_lonlat(n) if not isinstance(n, (tuple, list)) else (float(n[0]), float(n[1]))
            if pt is not None:
                coords.append(pt)

        coords = _dedupe_consecutive(coords)
        if len(coords) < 2:
            # 不够成线就跳过
            continue

        geom = LineString(coords)
        records.append({
            "route": route_id,
            "n_points": len(coords),
            "geometry": geom
        })

    if not records:
        raise ValueError("routes 转换后没有有效的线。请检查节点坐标。")

    gdf_lines = gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")
    return gdf_lines


def plot_bike_stations_with_pt(public_transport, centers, demand_matrix: Dict, ):
    """
    1) 从 data/output/geojson/ 读取最新 selected_bike_stations*.geojson
    2) 生成两张图：只画站点 / 站点+公交线路（来自 public_transport）
    3) 输出到 data/output/geojson_map/
    """
    root = SysPath(__file__).resolve().parents[1]
    in_dir = root / "data" / "output" / "geojson"
    out_dir = root / "data" / "output" / "geojson_map"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 最新站点文件
    files = sorted(in_dir.glob("selected_bike_stations*.geojson"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        raise FileNotFoundError(f"未在 {in_dir} 找到 selected_bike_stations*.geojson")
    latest = files[0]
    print(f"🗂️ 使用最新站点: {latest.name}")

    # 站点 GDF
    gdf_bs = gpd.read_file(latest)
    if gdf_bs.crs is None:
        gdf_bs = gdf_bs.set_crs(4326)

    # 准备线路 GDF（从 public_transport 转）
    gdf_lines = public_transport_to_gdf_lines(public_transport)

    # 转投影以叠底图
    gdf_bs_3857 = gdf_bs.to_crs(3857)
    gdf_lines_3857 = gdf_lines.to_crs(3857)

    # 点大小 & 颜色
    if "capacity" in gdf_bs_3857.columns:
        size_cap = 20 + 5.0 * gdf_bs_3857["capacity"].clip(lower=0)
        color_col = "capacity"
    else:
        size_cap = 50
        color_col = None

    ts = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    vmin, vmax = 0, CAPACITY_UB

    # ---------- 图1：只画站点 ----------
    fig, ax = plt.subplots(figsize=(7.5, 7.5))
    gdf_bs_3857.plot(
        ax=ax,
        column=color_col,
        cmap="Reds" if color_col else None,
        markersize=size_cap,
        edgecolor="black",
        linewidth=0.3,
        alpha=0.9,
        legend=bool(color_col),
        legend_kwds={"label": "Station Capacity",
                     "format": "{x:.0f}"},
        vmin=vmin,
        vmax=vmax
    )
    cx.add_basemap(ax, source=cx.providers.CartoDB.Positron, alpha=0.9)
    ax.set_title("Selected Bike Stations in Geneva", fontsize=12)
    ax.set_axis_off()
    plt.tight_layout()
    out1 = out_dir / f"geneva_bike_stations_{ts}.png"
    plt.savefig(out1, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"✅ Map saved -> {out1.resolve()}")

    # ---------- 图2：站点 + 公交线路 ----------
    fig, ax = plt.subplots(figsize=(7.5, 7.5))
    # 线路（按 route 上色或统一浅灰）
    if "route" in gdf_lines_3857.columns:
        gdf_lines_3857.plot(ax=ax, column="route", linewidth=1.2, alpha=0.45, legend=False)
    else:
        gdf_lines_3857.plot(ax=ax, color="lightgray", linewidth=1.2, alpha=0.45)

    gdf_bs_3857.plot(
        ax=ax,
        column=color_col,
        cmap="Reds" if color_col else None,
        markersize=size_cap,
        edgecolor="black",
        linewidth=0.3,
        alpha=0.9,
        legend=bool(color_col),
        legend_kwds={"label": "Station Capacity",
                     "format": "{x:.0f}"},  # 保留 0 位小数，即整数
        vmin=vmin,
        vmax=vmax
    )
    cx.add_basemap(ax, source=cx.providers.CartoDB.Positron, alpha=0.9)
    ax.set_title("Bike Stations + Public Transit Lines in Geneva", fontsize=12)
    ax.set_axis_off()
    plt.tight_layout()
    out2 = out_dir / f"geneva_bike_stations_with_lines_{ts}.png"
    plt.savefig(out2, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"✅ Map saved -> {out2.resolve()}")

    # examine top od flows
    # df = od_dict_to_df(demand_matrix)
    # fig, ax = plot_flow_map(
    #     df, grid_centers=centers,
    #     gdf_stations=gdf_bs, gdf_lines=gdf_lines,
    #     period=None, topk=300, qmin=0.90, curvature=0.2,
    #     title="Geneva OD flows (top 10% + top-300) with stations & PT lines"
    # )
    # save_figure(fig, "geneva_od_flows")

    return out1, out2
