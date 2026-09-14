import datetime
import json
import os
import pickle
from functools import lru_cache
from math import radians, sin, cos, sqrt, atan2
from pathlib import Path as SysPath
from typing import Dict, Tuple, List

import geopandas as gpd
import h3
import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
from shapely.geometry import Point
from shapely.geometry import Polygon
from shapely.ops import unary_union

from problem.path import Path

version = "0115"

# ----------------------------------------------------------------
# tunable parameters
# version control
H3_BASED_GRID = True
H3_resolution = 9

# h3 version
h3_version = "geneva_1.5km-radius"

# GENEVA
CENTER_LON, CENTER_LAT = 6.15, 46.202778
# 覆盖半径（km）
RADIUS = 1.5

# optimality gap threshold
OPTIMALITY_GAP = 0  # 0.0002
# number of shortest paths
NUM_SHORTEST_PATHS = 3
# proportion of OD pairs that are effectively serviced
OD_COVERAGE_RATIO = 0.5
# Area Size
AREA_LENGTH = 7
AREA_WIDTH = 7
CELL_SIZE = 1
# Radius to define the catchment area of two points by walking & biking
# todo: 这部分改么
WALK_CATCHMENT_RADIUS = 0.3  # 0.8 - 1.2 km      1 -> 0.5
RIDE_CATCHMENT_RADIUS = 1  # 2.5 - 5 km   # todo：本来区域半径就是 1.5 km，这里设 2 km 有点奇怪

# additional time needed for waiting each PT line transfer
TRANSFER_WAITING_TIME = 1
# BIKE_ACCESS_EGRESS_TIME
BIKE_ACCESS_EGRESS_TIME = 1
# Transfers between public transport modes are allowed within a certain distance threshold.
PT_TRANSFER_RADIUS = 0.5  # 0.3 - 0.6 km
# speed
WALK_SPEED = 4  # 4.5 - 5 km/h   # JR Lin 用的是 4
RIDE_SPEED = 20  # 12 - 18 km/h   # JR Lin 用的是 20 todo： 速度是否被高估 路况和基础设施如何，只比 pt 快一倍 合理吗？
# PUBLIC_TRANSPORT_SPEED = 30  # 20 - 35 km/h
# CAR_SPEED = 45  # 35 - 50 km/h
# demand size
TOTAL_TRIPS_NUN = 4000
# period number
TIME_PERIODS = 3
# penalty coefficient for suboptimal path choice
PENALTY_COEFFICIENT = 0.1
# capacity upper bound of each bike station
CAPACITY_UB = 30
# capacity lower bound of each bike station
MIN_CAPACITY_IF_BUILT = 5

# capacity of rebalancing vehicle
CAPACITY_REBALANCING_VEHICLE = 10
# pt structure
PT_STRUCTURE = 'radical_density'  # ['radical_density', 'regular_spacing']
# Fixed route public transit (PT station located within partitioned sub-zones and indexed accordingly)
# FIXED_LINE_POINTS_LST = [[1]]
# FIXED_LINE_POINTS_LST = [[10, 18, 27, -1, 36, 45, 53], [22, 21, 28, -1, 35, 42, 41]]   # 8*8
# FIXED_LINE_POINTS_LST = [[1, 6, 12, 18, 23], [9, 8, 12, 16, 15]]  # 5*5
# 7*7 Radical density
# FIXED_LINE_POINTS_LST = [[18, 28, 38, 49, 60, 71, 82, 92, 102],
#                          [34, 46, 58, 59, 60, 61, 62, 74, 86]]
# FIXED_LINE_POINTS_LST = [[11, 17, 24, 31, 37], [15, 23, 24, 25, 33]]
FIXED_LINE_POINTS_LST = ["real_pt_lines_radius2"]  # use real pt lines
# 7*7 Regular spacing 是否和上面一样保持只有八段弧连接两两pt站点
# FIXED_LINE_POINTS_LST = [[12, 26, 40], [10, 24, 38], [8, 22, 36], [8, 10, 12], [22, 24, 26], [36, 38, 40]]
# is rebalancing considered
REBALANCING_FLAG = True
# objective function (maximum coverage or maximum travel time reduction)
IS_MAX_COVERAGE = True
# whether to use uniform distribution for demand generation, otherwise use unimodal/bimodal distribution
DEMAND_DISTRIBUTION_TYPE = 'unimodal'  # 【uniform, unimodal, bimodal】
# penalty coefficient for dispatch cost
EPSILON = 0.04   # 测了点 0.02

# ----------------------------------------------------------------
# default parameters

# detour ratio
# Maximum allowed ratio a suboptimal path can exceed the theoretical optimal time
DETOUR_RATIO = 0.2
# punishment mode (ranking based/ magnitude and ratio based)
IS_RANKING_BASED = True
# 控制 短途 vs 长途的权衡，调整短途变化过敏感 vs 长途变化不敏感问题
TIME_SENSITIVITY = 20
# 控制路径质量的要求
RISK_TOLERANCE = 0.8
# customized constraints (最多一个为 True)
ARC_BASED_CONSTRAINTS = False
STATION_BASED_CONSTRAINTS = True
# Shortest path result cache path
SAVE_DIR = "data/shortest_paths_result"
# cached runs od demand stored path
CACHED_DIR = "data/cached_runs"
# 输出结果版本路径
DIR_OUTPUT_VERSION = "data/output/" + version
# Path to statistical results output
timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
OUTPUT_CSV_FILE = f"optimization_statistics_results_{timestamp}.csv"

TWO_STAGE_CONSIDERED = False

# debug shortest path
DEBUG_SHORTEST_COORDINATES = []
    # [(6.149155789278762, 46.218832062988305), (6.163169701399437, 46.20216185306845)]
# [(source coordinates), (target coordinates)]


def add_input_cwd(file_name):
    return os.path.join(os.getcwd(), 'data', 'input', '0101', file_name)


def add_output_cwd(file_name, subdir=None):
    dir_path = os.path.join(os.getcwd(), 'data', 'output', version, subdir)
    os.makedirs(dir_path, exist_ok=True)  # ✅ 确保目录存在
    return os.path.join(dir_path, file_name)


def add_specific_cwd(file_name, directory):
    return os.path.join(os.getcwd(), 'data', directory, file_name)


def add_config_cwd(file_name, directory):
    return os.path.join(os.getcwd(), directory, file_name)


def add_plot_cwd(file_name):
    return os.path.join(os.getcwd(), 'plot', file_name)


def save_results_to_pickle(filename, data):
    """将计算结果存入 pickle 文件"""
    full_path = os.path.join(SAVE_DIR, filename)
    with open(full_path, 'wb') as f:
        pickle.dump(data, f)


def load_results_from_pickle(filename):
    """从 pickle 文件加载计算结果"""
    full_path = os.path.join(SAVE_DIR, filename)
    with open(full_path, 'rb') as f:
        return pickle.load(f)


def compute_distance(coord1, coord2):
    """
    Wrapper function: choose between Euclidean and Haversine distance.
    :param coord1: (x, y) or (lat, lon)
    :param coord2: (x, y) or (lat, lon)
    :param use_haversine: bool, if True use Haversine, else Euclidean
    :return: distance
    """
    if H3_BASED_GRID:
        return haversine(coord1, coord2)
    else:
        return euclidean_distance(coord1, coord2)


def is_valid_path(path_obj, max_bike_legs=2):
    """对整条路径做统一合法性校验。"""
    arcs = path_obj.arcs_traversed

    # 1) 禁止 Bike–nonBike–Bike 模式
    if has_bike_nonbike_bike(arcs):
        return False

    # 2) 限制 Bike 使用段数
    bike_count = sum(1 for a in arcs if a.mode.lower() == "bike")
    if bike_count > max_bike_legs:
        return False

    # 3) 其他可选规则（示例：禁止连续 Bike 合并段）
    # if any(a.mode=="Bike" and b.mode=="Bike" for a,b in zip(arcs, arcs[1:])):
    #     return False

    return True


def build_path_if_valid(source, target, path, arcs_traversed, travel_time, modes, walk_arc=None):
    """
    构造 Path 对象的通用函数。

    此处做非法校验没用 因为是后面一段 还没有和前面的拼接起来

    参数：
        source, target : 起点和终点节点
        path           : 已走过的节点列表
        arcs_traversed : 已走过的弧列表
        travel_time    : 当前累计时间
        modes          : 已用出行方式列表
        walk_arc       : 可选的额外 Walk 弧（默认 None）

    返回：
        Path 对象 或 None （若违反 Bike–nonBike–Bike 规则）
    """

    # 总距离
    total_distance = sum(arc.distance for arc in arcs_traversed)
    total_time = travel_time
    new_path = list(path)
    new_arcs = list(arcs_traversed)
    new_modes = list(modes)

    # 如果需要补一个 Walk arc
    if walk_arc is not None:
        new_path.append(target)
        new_arcs.append(walk_arc)
        new_modes.append(walk_arc.mode)
        total_distance += walk_arc.distance
        total_time += walk_arc.travel_time

    return Path(
        source=source,
        target=target,
        path=new_path,
        arcs_traversed=new_arcs,
        total_time=total_time,
        total_distance=total_distance,
        modes=new_modes
    )


def euclidean_distance(coord1, coord2):
    """
    Calculate Euclidean distance between two coordinates.
    :param coord1: (x1, y1)
    :param coord2: (x2, y2)
    :return: Euclidean distance
    """
    return ((coord1[0] - coord2[0]) ** 2 + (coord1[1] - coord2[1]) ** 2) ** 0.5


def get_grid_union_polygon(grid):
    """
    Return a shapely Polygon/MultiPolygon representing the total boundary
    of all H3 cells in the grid generator.
    """
    polygons = []
    for node_data in grid.nodes.values():
        poly = node_data["polygon"]  # already Shapely Polygon
        polygons.append(poly)

    return unary_union(polygons)  # merge into one geometry


def haversine(coord1, coord2):
    """地理坐标计算两点间距离
    """
    # 经纬度转弧度
    lat1, lon1 = radians(coord1[0]), radians(coord1[1])
    lat2, lon2 = radians(coord2[0]), radians(coord2[1])

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    R = 6371.0  # 地球半径，单位 km

    return R * c  # 返回公里数


def safe_div(x, y):
    return x / y if y != 0 else 0


def add_valid_path(valid_paths, new_path, tol=1e-9):
    """
    向 valid_paths 添加新的路径，若存在相同时间的路径则比较 arc 数量。
    - 如果 new_path arc 更少，则替换旧的。
    - 如果 arc 不更少，则丢弃 new_path。
    """
    for i, old_path in enumerate(valid_paths):
        if abs(old_path.total_time - new_path.total_time) < tol:
            # 时间相同，比较 arc 数
            if len(new_path.arcs_traversed) < len(old_path.arcs_traversed):
                replaced_path = valid_paths[i]
                valid_paths[i] = new_path  # 替换为 arc 更少的
                return valid_paths, True, replaced_path
    # 没有相同时间的路径，直接添加
    valid_paths.append(new_path)
    return valid_paths, True, None


def var_dict_sum(dic):
    """
    :param dic:
    :return: sum of all values in the dictionary
    """
    return sum(var.X for var in dic.values())


def generate_peak_weights(periods, peak_strength=5):
    """
    todo：A bimodal distribution can be fitted to real-world data in
     order to capture the typical demand patterns, such as morning and evening peaks
    根据 period 数自动生成一组时间段权重，使早晚高峰权重更高。
    :param periods: int, 时间段数量
    :param peak_strength: float, 越大峰值越明显
    :return: list of weights
    """
    # 构造双峰函数：两边高，中间低（钟形镜像）
    x = np.linspace(0, 1, periods)  # 标准化时间段
    left_peak = np.exp(-peak_strength * (x - 0.0) ** 2)
    right_peak = np.exp(-peak_strength * (x - 1.0) ** 2)
    weights = left_peak + right_peak
    weights = weights / np.sum(weights)
    return weights.tolist()


def save_geojson(features, fc, file_name, subdir="data/output/geojson"):
    """
    通用函数：保存 GeoJSON 到项目根目录下的指定子目录

    :param features: 特征列表（用于打印数量）
    :param fc: FeatureCollection (dict)
    :param file_name: 文件名，例如 "test.geojson"
    :param subdir: 相对项目根的子目录，默认 "data/output/geojson"
    """
    # 获取项目根目录（假设以 pythonProject 作为根）
    # 项目里有个文件/类也叫 Path，会覆盖掉标准库
    base_dir = SysPath(__file__).resolve().parents[1]  # 如果脚本在 pythonProject/config 目录下
    out_dir = base_dir / subdir
    out_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    file_name = f"{file_name}_{timestamp}.geojson"

    out_path = out_dir / file_name
    out_path.write_text(json.dumps(fc, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✅ GeoJSON saved -> {out_path.resolve()} (features={len(features)})")


def od_dict_to_df(demand_matrix):
    """
    demand_matrix to DataFrame
    :param demand_matrix:
    :return:
    """
    # demand_matrix: { ((o, d), t): v }
    rows = [{"origin": o, "destination": d, "period": t, "trips": float(v)}
            for ((o, d), t), v in demand_matrix.items()]
    df = pd.DataFrame(rows)
    return df


def generate_bimodal_weights(periods, peak_strength=3.0):
    """
    生成一个双峰的时间权重分布，两端高、中间低。
    参数：
    - periods: 总期数
    - peak_strength: 控制中间值的压低程度，越大中间越低（建议值 1~10）
    """
    x = np.arange(periods)

    # 构造双峰权重：对称指数函数，中心越低
    left = np.exp(-peak_strength * np.abs(x - 0) / (periods - 1))
    right = np.exp(-peak_strength * np.abs(x - (periods - 1)) / (periods - 1))

    weights = left + right
    weights /= np.sum(weights)  # 归一化为概率分布
    return weights.tolist()

    # labels = ["6–10", "11–15", "16–20"]
    # sns.set(style="whitegrid")
    # plt.figure(figsize=(6, 4))
    # sns.barplot(x=labels, y=weights, palette="Blues_d")
    # plt.title("Discrete Unimodal Temporal Demand Distribution (6AM–20PM)")
    # plt.xlabel("Time Period")
    # plt.ylabel("Normalized Probability")
    # plt.ylim(0, max(weights) * 1.1)
    # plt.tight_layout()
    # # Save the plot
    # plt.savefig(add_plot_cwd(f"seaborn_dual_peak_weights_{periods}.png"))

    return weights.tolist()


def generate_single_peak_weights(periods, decay_strength=2.0):
    """
    生成一个单峰的时间权重分布，峰值在第一期，之后呈现逐步下降趋势。

    参数：
    - periods: 总期数
    - decay_strength: 控制下降的快慢，越大下降越快（建议值 1~5）
    """
    x = np.arange(periods)
    weights = np.exp(-decay_strength * x / (periods - 1))  # 从第0期开始逐步下降
    weights /= np.sum(weights)  # 归一化为概率
    # Plot using seaborn
    # Your 3 periods: 6–8, 9–10, 11–12
    # labels = ["6–8", "9–10", "11–12"]
    # Plotting
    # sns.set(style="whitegrid")
    # plt.figure(figsize=(6, 4))
    # sns.barplot(x=labels, y=weights, palette="Blues_d")
    # plt.title("Discrete Unimodal Temporal Demand Distribution (6AM–12PM)")
    # plt.xlabel("Time Period")
    # plt.ylabel("Normalized Probability")
    # plt.ylim(0, max(weights) * 1.1)
    # plt.tight_layout()
    # # Save the plot
    # plt.savefig(add_plot_cwd(f"seaborn_single_peak_weights_{periods}.png"))
    # plt.show()
    return weights.tolist()


def _norm_mode(m):
    return (m or "").strip().lower()


def has_bike_nonbike_bike(arcs):
    """
    True 表示存在 Bike – 非Bike – Bike 的模式
    allow_multiple=False: 只允许中间恰好隔一段
    allow_multiple=True : 中间可隔一段或多段（但不能含 Bike）
    不能允许两段 bike 被 walk 相连 明显不合理
    """
    modes = [_norm_mode(a.mode) for a in arcs]
    n = len(modes)

    # 仅检测 Bike - X - Bike（X 不是 Bike）
    for i in range(n - 2):
        if modes[i] == "bike" and modes[i + 2] == "bike" and modes[i + 1] != "bike":
            return True
    return False


def generate_strict_peak_weights(periods, peak_strength=15):
    """
    生成早晚高峰权重分布，确保双峰在period较小时也保持明显。
    """
    x = np.linspace(0, 1, periods)

    # 将峰值偏移至靠近0.2和0.8，更适合3–8个period
    left_peak = np.exp(-peak_strength * (x - 0.2) ** 2)
    right_peak = np.exp(-peak_strength * (x - 0.8) ** 2)

    # 叠加后压低中间区域（例如人为乘以一个收缩因子）
    weights = left_peak + right_peak
    if periods <= 5:
        # 手动降低中间值权重，确保双峰（只在 period 少时启用）
        center_idx = periods // 2
        weights[center_idx] *= 0.4  # 你可以调这个参数
    elif periods == 6:
        weights[2:4] *= 0.7
    elif periods == 7:
        weights[3] *= 0.6
    elif periods == 8:
        weights[3:5] *= 0.7

    weights /= np.sum(weights)
    return weights.tolist()


def get_config_parameter_range():
    with open(add_config_cwd("configuration.json", 'config'), "r") as f:
        config = json.load(f)
    coverage_ratios = np.arange(
        config["OD_COVERAGE_RATIO_START"],
        config["OD_COVERAGE_RATIO_END"] + 0.01,
        config["OD_COVERAGE_RATIO_STEP"]
    )
    total_trips_values = range(
        config["TOTAL_TRIPS_NUN_START"],
        config["TOTAL_TRIPS_NUN_END"] + 1,
        config["TOTAL_TRIPS_NUN_STEP"]
    )
    budget_values = range(
        config["budget_start"],
        config["budget_end"] + 1,
        config["budget_step"]
    )
    operational_budget_ratios = np.arange(
        config["operational_budget_ratio_start"],
        config["operational_budget_ratio_end"] + 0.001,
        config["operational_budget_ratio_step"]
    )
    random_seeds = config["random_seeds"]
    return budget_values, coverage_ratios, operational_budget_ratios, random_seeds, total_trips_values


def load_geojson(filename):
    # base_dir = os.getcwd()
    # 获取当前文件所在路径（假设这个脚本在 project/config 里）
    current_file_path = os.path.abspath(__file__)
    # 获取项目根路径（假设项目结构固定，回退两级）
    project_root = os.path.dirname(os.path.dirname(current_file_path))
    path = os.path.join(project_root, "data", "geojson", h3_version, filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def h3_cells_to_gdf(cell_ids):
    """
    从 H3 cell ID 列表构建完整 polygon 的 GeoDataFrame
    """
    polygons = []
    for cid in cell_ids:
        boundary = h3.cell_to_boundary(cid)  # -> list of [lat, lon] todo: 本就是 lon lat，多余了 后面交换顺序的步骤
        # coords = normalize_lonlat(boundary)
        coords = [(lon, lat) for lon, lat in boundary if lon <= 10]  # todo: 临时操作下 剔除掉明显不对的
        poly = Polygon(coords)
        # poly = Polygon([(lon, lat) for lon, lat in boundary])  # 注意顺序
        polygons.append({         # todo：之前只包含 poly，丢失了 id 信息
            "cell_id": cid,
            "geometry": poly
        })

    gdf = gpd.GeoDataFrame(polygons, crs="EPSG:4326")
    return gdf


def normalize_lonlat(coords):
    """
    输入一组坐标，自动判断并统一成 (lon, lat)
    """
    fixed = []
    for a, b in coords:
        # 如果 a 像纬度（大于 40），说明是 (lat, lon)，需要交换
        if abs(a) > 40:
            fixed.append((b, a))  # swap
        else:
            fixed.append((a, b))  # already (lon, lat)
    return fixed


def save_figure(fig, file_name: str, subdir="data/output/figures", dpi=300):
    """
    保存 matplotlib figure 到指定路径

    :param fig: matplotlib.figure.Figure 对象
    :param file_name: 文件名（不带扩展名，例如 "od_flows"）
    :param subdir: 相对项目根的子目录，默认 "data/output/figures"
    :param dpi: 图片分辨率
    :return: 保存的完整路径
    """
    # 获取项目根目录
    base_dir = SysPath(__file__).resolve().parents[1]
    out_dir = base_dir / subdir
    out_dir.mkdir(parents=True, exist_ok=True)

    # 自动加时间戳
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    file_name = f"{file_name}_{timestamp}.png"

    out_path = out_dir / file_name
    fig.savefig(out_path, dpi=dpi, bbox_inches="tight")
    print(f"✅ Figure saved -> {out_path.resolve()}")
    return out_path


def split_od_into_periods(
    od_df: pd.DataFrame,
    periods,
    weights,
    method="multinomial",   # "multinomial" or "deterministic"
    seed=42,
):
    """
    od_df columns: origin_cell, dest_cell, flow (int or float)
    return: long df with columns [period, origin_cell, dest_cell, flow]
    Guarantees: sum_t flow_t == flow per OD if method="multinomial" and flow is int.

    The demand is interpreted as F independent travelers. Each traveler independently chooses a departure time
    period according to a predefined probability vector (period weights).
    """
    period_names = make_period_names(periods)

    w = np.asarray(weights, dtype=float)
    w = w / w.sum()
    rng = np.random.default_rng(seed)

    df = od_df.copy()
    # 先确保是非负整数（你已 round 成 int 更好）
    df["flow"] = np.maximum(0, np.round(df["flow"]).astype(int))

    out_rows = []
    for _, r in df.iterrows():
        F = int(r["flow"])
        if F == 0:
            continue

        if method == "multinomial":
            alloc = rng.multinomial(F, w)  # 长度=3，和=F
        elif method == "deterministic":
            # 允许非随机：先 floor，再把余数按最大残差补齐
            raw = w * F
            alloc = np.floor(raw).astype(int)
            rem = F - alloc.sum()
            if rem > 0:
                frac = raw - np.floor(raw)
                idx = np.argsort(-frac)[:rem]
                alloc[idx] += 1
        else:
            raise ValueError("method must be multinomial or deterministic")

        for p, f_p in zip(period_names, alloc):
            if f_p > 0:
                out_rows.append((p, r["origin_cell"], r["dest_cell"], int(f_p)))

    od_period_long = pd.DataFrame(out_rows, columns=["period", "origin_cell", "dest_cell", "flow"])

    period_to_id = {p: i for i, p in enumerate(period_names)}

    od_demand = {}
    for r in od_period_long.itertuples(index=False):
        t = period_to_id[r.period]
        od_demand[((r.origin_cell, r.dest_cell), t)] = int(r.flow)

    return od_demand


def make_period_names(n_periods: int) -> tuple[str, ...]:
    return tuple(f"P{t+1}" for t in range(n_periods))


def arc_line_id(arc):
    # 你按真实字段改一个：优先 arc.line_id，否则从 pt_attrs 取
    lid = getattr(arc, "mode", None)
    return lid
    # if lid is not None:
    #     return lid
    # sn = getattr(arc, "start_node", None)
    # if sn is not None and getattr(sn, "pt_attrs", None):
    #     return getattr(sn.pt_attrs, "line_id", None)
    # en = getattr(arc, "end_node", None)
    # if en is not None and getattr(en, "pt_attrs", None):
    #     return getattr(en.pt_attrs, "line_id", None)
    # return None


def additional_wait_s(prev_arc, arc, pt_wait_s=TRANSFER_WAITING_TIME):
    """
    规则：
    - 第一次乘坐 PT（prev 不是 PT，当前是 PT）：+wait
    - PT -> PT 且换线（line_id 不同）：+wait
    """
    if not getattr(arc, "mode", None).startswith("PT"):
        return 0

    if prev_arc is None:
        return pt_wait_s

    if not getattr(prev_arc, "mode", None).startswith("PT"):
        return pt_wait_s

    # prev 和 current 都是 PT：只有换线才加
    l1, l2 = arc_line_id(prev_arc), arc_line_id(arc)
    if l1 and l2 and l1 != l2:
        return pt_wait_s

    return 0


def generalized_time_from_arcs(arcs):
    total = 0
    prev = None
    for a in arcs:
        total += getattr(a, "travel_time", 0)
        total += additional_wait_s(prev, a)
        prev = a
    return total


# ------------------ shortest path in projected graph ------------------ #
def lonlat_to_xy(G_proj, lon, lat):
    g = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs(G_proj.graph["crs"])
    p = g.iloc[0]
    return p.x, p.y


@lru_cache(maxsize=200000)
def shortest_path_distance_time_projected(G_proj, lon1, lat1, lon2, lat2, speed_kmh=4.5):
    x1, y1 = lonlat_to_xy(G_proj, lon1, lat1)
    x2, y2 = lonlat_to_xy(G_proj, lon2, lat2)

    u = ox.distance.nearest_nodes(G_proj, X=x1, Y=y1)
    v = ox.distance.nearest_nodes(G_proj, X=x2, Y=y2)

    dist_m = nx.shortest_path_length(G_proj, u, v, weight="length")
    dur_s = dist_m / (speed_kmh * 1000 / 3600)

    # === 单位转换 ===
    dist_km = dist_m / 1000
    dur_min = dur_s / 60

    return dist_km, dur_min

def load_instance_txt(txt_path):
    with open(txt_path, "r") as f:
        return json.load(f)   # dict
