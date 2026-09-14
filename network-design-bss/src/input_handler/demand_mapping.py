import json
from datetime import datetime
from typing import List, Tuple, Dict, Optional
import numpy as np
import pandas as pd
from shapely.geometry import Point
from shapely.strtree import STRtree
from util.util import *
import random
import pandas as pd


class DemandMapper:
    """
    用真实 bike trips 数据生成 OD 矩阵（不做裁剪、不做缩放）。
    demand_type: 'count'（计次）或 'distance'（按公里数累加）。
    """

    def __init__(self,
                 grid_generator,
                 trips_geojson_path: str,
                 pt_heatnao_path: str,
                 demand_type: str = "count",
                 time_periods: List[Tuple[str, range]] = TIME_PERIODS,
                 keep_intrazone: bool = False):
        self.grid_generator = grid_generator
        self.trips_geojson_path = trips_geojson_path
        self.demand_type = demand_type
        self.time_periods = time_periods
        self.keep_intrazone = keep_intrazone
        self._build_spatial_index()
        trips = self._parse_trips_geojson()
        trips = self._map_points_to_zones(trips)
        trips = self._attach_time_period(trips)

        # Aggregate (only using observed values)
        # self.df_od, self.demand_matrix = self._aggregate_od(trips)

        self.df_od, self.demand_matrix = self._generate_h3_demand()

        # todo: 对数据进行扰动和丰富
        # self.df_od, self.demand_matrix = self._densify_and_jitter_demand(
        #     self.demand_matrix,
        #     time_slots=(0, 1, 2),
        #     amount_range=(1, 10),
        #     jitter_ratio=0.15,
        #     keep_intrazone=False,
        #     seed=42
        # )

        # 6) 输出矩阵
        self.node_ids = self._ordered_node_ids()
        self.matrix_all = self._to_matrix(self.df_od, self.node_ids)

        # 简要统计（真实数据）
        self.total_trips_observed = float(self.df_od["demand"].sum())
        self.total_od_pairs = int(len(self.df_od))

    def _generate_h3_demand(self):
        # zone_weight = self.build_zone_weights_from_geojson("heatmap.geojson")
        zone_weight = self.build_zone_weights(self.grid_generator, "heatmap.geojson",
                                              h3_resolution=H3_resolution, random_fill=True)
        zone_ids = sorted(zone_weight.keys())  # 所有有 demand 的 H3 cells

        # ===== 2. 构造 λ 值矩阵 =====
        lambda_matrix = self.generate_lambda_matrix(zone_weight, zone_ids, intensity_scale=300)

        # ===== 4. 生成泊松随机需求 =====
        df_od, demand_matrix = self.generate_poisson_demand(lambda_matrix, period_weights)

        self.od_demand = demand_matrix

        return df_od, demand_matrix

    # ---------- internal ----------
    def _build_spatial_index(self):
        zones, zone_ids = [], []
        for zid, data in self.grid_generator.grid.nodes(data=True):
            poly = data.get("polygon")
            if poly is not None:
                zones.append(poly)
                zone_ids.append(zid)
        self._tree = STRtree(zones)
        self._zone_ids = zone_ids
        self._poly_to_id = {poly: zid for poly, zid in zip(zones, zone_ids)}
        self._id_to_poly = {zid: poly for poly, zid in zip(zones, zone_ids)}

    def _point_to_zone(self, lon: float, lat: float) -> Optional[str]:
        pt = Point(lon, lat)
        for idx in self._tree.query(pt):
            poly = self._zone_ids[idx]
            if self._id_to_poly[poly].covers(pt):
                # return self._poly_to_id[poly]
                return poly
        return None

    def _parse_trips_geojson(self) -> pd.DataFrame:
        current_file_path = os.path.abspath(__file__)
        project_root = os.path.dirname(os.path.dirname(current_file_path))
        path = os.path.join(project_root, "data", "geojson", h3_version, self.trips_geojson_path)
        with open(path, "r", encoding="utf-8") as f:
            gj = json.load(f)
        rows = []
        for ft in gj["features"]:
            p = ft["properties"];
            g = ft["geometry"]
            lon_s = p.get("longitude_start")
            lat_s = p.get("latitude_start")
            lon_e = p.get("longitude_end")
            lat_e = p.get("latitude_end")
            if (lon_s is None or lat_s is None) and g["type"] == "LineString":
                lon_s, lat_s = g["coordinates"][0]
            if (lon_e is None or lat_e is None) and g["type"] == "LineString":
                lon_e, lat_e = g["coordinates"][-1]
            # t_start = datetime.fromisoformat(p["trip_started_at_utc"])
            t_start = datetime.datetime.strptime(p["trip_started_at_utc"], "%Y-%m-%dT%H:%M:%S")
            t_end = datetime.datetime.strptime(p["trip_ended_at_utc"], "%Y-%m-%dT%H:%M:%S")
            rows.append({
                "trip_id": p["trip_id"],
                "start_hour": t_start.hour,
                "start_lon": float(lon_s), "start_lat": float(lat_s),
                "end_lon": float(lon_e), "end_lat": float(lat_e),
                "distance_km": float(p.get("distance_in_km", 0.0))
            })
        return pd.DataFrame(rows)

    def _map_points_to_zones(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        df["start_zone"] = [self._point_to_zone(lo, la) for lo, la in zip(df.start_lon, df.start_lat)]
        df["end_zone"] = [self._point_to_zone(lo, la) for lo, la in zip(df.end_lon, df.end_lat)]
        df = df.dropna(subset=["start_zone", "end_zone"]).reset_index(drop=True)
        if not self.keep_intrazone:
            df = df[df.start_zone != df.end_zone].reset_index(drop=True)
        return df

    def _attach_time_period(self, df: pd.DataFrame) -> pd.DataFrame:
        def hour_to_tp(h):
            for label, hrs in self.time_periods:
                if h in hrs: return label
            return "OTHER"

        df = df.copy()
        df["time_period"] = df.start_hour.apply(hour_to_tp)
        return df

    def _aggregate_od(self, df: pd.DataFrame):
        """
        直接返回并写入稀疏OD需求字典：
          key = (i, j, t_idx)  其中 i/j 为 node_ids 的索引，t_idx 为 time_periods 的索引
          val = demand（按次或按距离）
        同时兼容：self.od_demand 与 self.demand_matrix 指向同一份字典。
        """
        # -------- 1) 基本映射 --------
        # 节点顺序（与后续优化模型一致）
        if not hasattr(self, "node_ids") or not self.node_ids:
            self.node_ids = sorted([z for z, _ in self.grid_generator.grid.nodes(data=True)])
        node_index = {z: i for i, z in enumerate(self.node_ids)}

        # 时间段标签 → 索引
        tp_labels = [lbl for (lbl, _) in self.time_periods]
        tp_index = {lbl: i for i, lbl in enumerate(tp_labels)}

        # -------- 2) 分组聚合（带 time_period）--------
        if self.demand_type == "distance":
            measure = "distance_km"
            g = (df.groupby(["start_zone", "end_zone", "time_period"], as_index=False)[measure]
                 .sum().rename(columns={measure: "demand"}))
        else:  # "count"
            g = (df.groupby(["start_zone", "end_zone", "time_period"], as_index=False)
                 .size().rename(columns={"size": "demand"}))

        # （可选）保留一份明细表，便于调试或导出
        self.df_od_by_tp = g

        # -------- 3) 构建稀疏字典 --------
        od_demand: dict[tuple[int, int, int], float] = {}
        for _, r in g.iterrows():
            o = r["start_zone"]
            d = r["end_zone"]
            t = r["time_period"]
            val = float(r["demand"])
            # 暂不用 index 表示，之后可以统一改成 整数索引 + 映射表
            # i = node_index.get(o);
            # j = node_index.get(d);
            ti = tp_index.get(t)
            if o is None or d is None or ti is None or val <= 0:
                continue
            od_demand[((o, d), ti)] = od_demand.get((o, d, ti), 0.0) + val

        # -------- 4) 兼容旧接口字段名 --------
        self.od_demand = od_demand

        # （可选）总体不分时段的 df_od，方便查看总量
        self.df_od = (g.groupby(["start_zone", "end_zone"], as_index=False)["demand"]
                      .sum())
        return self.df_od, od_demand

    def _ordered_node_ids(self) -> List[str]:
        return sorted([zid for zid, _ in self.grid_generator.grid.nodes(data=True)])

    def _to_matrix(self, df: pd.DataFrame, node_ids: List[str]) -> np.ndarray:
        n = len(node_ids)
        idx = {z: i for i, z in enumerate(node_ids)}
        M = np.zeros((n, n), dtype=float)
        for _, r in df.iterrows():
            o, d, val = r["start_zone"], r["end_zone"], float(r["demand"])
            if o in idx and d in idx: M[idx[o], idx[d]] += val
        return M

    def _densify_and_jitter_demand(
            self,
            demand_matrix: dict,
            origins=None, destinations=None,
            time_slots=(0, 1, 2),
            amount_range=(1.0, 5.0),  # 缺失项填充值区间
            jitter_ratio=0.2,  # 现有值的相对扰动幅度 (±比例)
            keep_intrazone=False,  # 是否允许 O==D
            seed=None,
    ):
        """
        返回 (new_demand_matrix, df_od_stats)
        - new_demand_matrix: dict[ ( (o,d), t ) ] = float
        - df_od_stats: DataFrame( columns=["origin","dest","total_demand"] )
        """
        rng = random.Random(seed)

        # 自动推断 O/D
        if origins is None or destinations is None:
            O, D = set(), set()
            for (o, d), _t in ((k[0], k[1]) for k in demand_matrix.keys()):
                O.add(o);
                D.add(d)
            origins = list(O) if origins is None else origins
            destinations = list(D) if destinations is None else destinations

        new_dm = {}

        # 1) 复制已有并扰动
        for key, val in demand_matrix.items():
            base = float(val)
            if base > 0 and jitter_ratio > 0:
                eps = rng.uniform(-jitter_ratio, jitter_ratio)
                base = max(0.0, base * (1.0 + eps))
            new_dm[key] = int(round(base))

        # 2) 补全缺失
        for o in origins:
            for d in destinations:
                if not keep_intrazone and o == d:
                    continue
                for t in time_slots:
                    key = ((o, d), t)
                    if key not in new_dm:
                        amt = rng.uniform(*amount_range)
                        new_dm[key] = int(round(amt))

        # 3) 统计总需求
        od_totals = {}
        for (o, d), t in new_dm.keys():
            od_totals[(o, d)] = od_totals.get((o, d), 0.0) + new_dm[((o, d), t)]

        df_od = pd.DataFrame(
            [{"start_zone": o, "end_zone": d, "demand": v} for (o, d), v in od_totals.items()]
        ).sort_values("demand", ascending=False).reset_index(drop=True)

        return df_od, new_dm

    import random

    def build_zone_weights(self, grid_generator, geojson_path, h3_resolution=8, random_fill=False):
        current_file_path = os.path.abspath(__file__)
        project_root = os.path.dirname(os.path.dirname(current_file_path))
        path = os.path.join(project_root, "data", "geojson", h3_version, geojson_path)

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # 从 heatmap 提取已有权重
        zone_weight = dict()
        for feature in data["features"]:
            props = feature["properties"]
            lat = props["latitude"]
            lon = props["longitude"]
            weight = props.get("weight", 0.0)
            h3_cell = h3.latlng_to_cell(lon, lat, h3_resolution)
            zone_weight[h3_cell] = zone_weight.get(h3_cell, 0) + weight

        # 遍历 grid_generator 中所有 cell，确保都有 weight
        for cell_id in grid_generator.grid_centers.keys():
            if cell_id not in zone_weight:
                if random_fill:
                    zone_weight[cell_id] = random.uniform(0.1, 1.0)  # 随机补值
                else:
                    zone_weight[cell_id] = 0.0  # 默认值

        return zone_weight

    def build_zone_weights_from_geojson(self, geojson_path, h3_resolution=8):
        current_file_path = os.path.abspath(__file__)
        project_root = os.path.dirname(os.path.dirname(current_file_path))
        path = os.path.join(project_root, "data", "geojson", h3_version, geojson_path)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        zone_weight = dict()
        for feature in data["features"]:
            props = feature["properties"]
            lat = props["latitude"]
            lon = props["longitude"]
            weight = props.get("weight", 0.0)

            h3_cell = h3.latlng_to_cell(lon, lat, h3_resolution)
            zone_weight[h3_cell] = zone_weight.get(h3_cell, 0) + weight  # 聚合同一区域权重

        return zone_weight

    def generate_lambda_matrix(self, zone_weight, zone_ids, intensity_scale=300):
        lambda_matrix = {}
        for i in zone_ids:
            for j in zone_ids:
                if i == j:
                    continue  # optional: skip intra-zone
                w_i = zone_weight.get(i, 0.01)
                w_j = zone_weight.get(j, 0.01)
                λ_ij = intensity_scale * w_i * w_j
                lambda_matrix[(i, j)] = λ_ij
        return lambda_matrix

    def generate_poisson_demand(self, lambda_matrix, weights, seed=42):
        np.random.seed(seed)
        od_demand = {}  # key = ((i,j), t)
        records = []
        for (i, j), base_λ in lambda_matrix.items():
            for t, factor in weights.items():
                lam = base_λ * factor
                demand = np.random.poisson(lam)
                if demand > 0:
                    od_demand[((i, j), t)] = demand
                    records.append({
                        "start_zone": i,
                        "end_zone": j,
                        "time_period": t,
                        "demand": demand,
                    })

        df_od_by_period = pd.DataFrame(records)
        df_od = (df_od_by_period
                 .groupby(["start_zone", "end_zone"], as_index=False)["demand"]
                 .sum())
        return df_od, od_demand

    # ---- public getters ----
    def get_overall_matrix(self) -> np.ndarray:
        return self.matrix_all

    # def get_matrix_by_period(self) -> Dict[str, np.ndarray]: return self.matrix_by_tp
    def get_node_order(self) -> List[str]:
        return self.node_ids
