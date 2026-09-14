# metrics_evaluator.py
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Tuple, Any, Set
import matplotlib.pyplot as plt
from scipy.spatial import KDTree
from scipy.spatial.distance import pdist

from util.cost import CostParameters
from util.util import *
from .metrics import BSSMetrics
from .metrics_context import MetricsContext


@dataclass
class MetricsEvaluator:
    """Compute post-optimization metrics from a frozen MetricsContext."""
    ctx: MetricsContext
    eps: float = 1e-6

    def evaluate(self) -> BSSMetrics:
        flow = self._compute_flow_metrics()
        stations = self._compute_station_metrics()
        layout = self._compute_layout_metrics(stations["selected_stations"])
        reb = self._compute_rebalancing_metrics(flow["total_flow"])
        travel = self._compute_travel_metrics(flow["flows_by_mode"], flow["total_flow"])
        coverage = self._compute_coverage_metrics()
        time_gain = self._compute_time_gain_metrics(flow["total_flow"])

        return BSSMetrics(
            # ---- Flow ----
            total_flow_by_mode=flow["total_flow_by_mode"],
            total_flow=flow["total_flow"],
            supported_flow_per_investment=flow["supported_flow_per_investment"],
            avg_travel_time=travel["avg_travel_time"],
            covered_od_ratio=coverage["covered_od_ratio"],
            total_time_gain=time_gain["total_time_gain"],
            average_time_gain=time_gain["average_time_gain"],

            # ---- Station composition ----
            n_reg_station=stations["n_reg_station"],
            n_trans_station=stations["n_trans_station"],

            # ---- Layout ----
            mean_pairwise_distance=layout["mean_pairwise_distance"],
            nearest_neighbor_distance=layout["nearest_neighbor_distance"],

            # ---- Capacity / utilization / availability ----
            avg_capacity_reg=stations["avg_capacity_reg"],
            avg_capacity_trans=stations["avg_capacity_trans"],
            util_reg=stations["util_reg"],
            util_trans=stations["util_trans"],
            borrowable_rate_reg=stations["borrowable_rate_reg"],
            returnable_rate_reg=stations["returnable_rate_reg"],
            borrowable_rate_trans=stations["borrowable_rate_trans"],
            returnable_rate_trans=stations["returnable_rate_trans"],

            # ---- Rebalancing ----
            dispatch_count=reb["dispatch_count"],
            reb_volume=reb["reb_volume"],
            dispatch_cost=reb["dispatch_cost"],
            avg_bikes_per_dispatch=reb["avg_bikes_per_dispatch"],
            avg_dispatch_distance=reb["avg_dispatch_distance"],
        )

    # -------------------------
    # 1) Flow-related
    # -------------------------
    def _compute_flow_metrics(self) -> Dict[str, Any]:
        m = self.ctx.model
        total_investment = m.Q

        x_b = self.ctx.bike_only_flow
        x_pt = self.ctx.bike_pt_flow
        x_w = self.ctx.walk_pt_flow

        fb = self._var_dict_sum(x_b)
        fpt = self._var_dict_sum(x_pt)
        fw = self._var_dict_sum(x_w)

        total_flow_by_mode = {
            "flow_bike_only": fb,
            "flow_bike_pt": fpt,
            "flow_walk_pt": fw,
        }
        total_flow = fb + fpt + fw

        return {
            "flows_by_mode": (x_b, x_pt, x_w),
            "total_flow_by_mode": total_flow_by_mode,
            "total_flow": total_flow,
            "supported_flow_per_investment": total_flow / total_investment if total_investment > self.eps else 0.0,
        }

    # -------------------------
    # 2) Stations / capacities / availability
    # -------------------------
    def _compute_station_metrics(self) -> Dict[str, Any]:
        y = self.ctx.station_open
        v = self.ctx.station_inventory
        w = self.ctx.station_capacity

        selected = [s for s in y if y[s].X > 0.5]
        reg = [s for s in selected if s.type == "BikeStation"]
        trans = [s for s in selected if s.type == "TransferStation"]

        util_reg, avg_cap_reg = self._compute_average_utilization_rate(reg, v, w)
        util_trans, avg_cap_trans = self._compute_average_utilization_rate(trans, v, w)

        brw_reg, ret_reg = self._compute_station_availability(reg, v, w)
        brw_trans, ret_trans = self._compute_station_availability(trans, v, w)

        return {
            "selected_stations": selected,
            "n_reg_station": len(reg),
            "n_trans_station": len(trans),
            "avg_capacity_reg": avg_cap_reg,
            "avg_capacity_trans": avg_cap_trans,
            "util_reg": util_reg,
            "util_trans": util_trans,
            "borrowable_rate_reg": brw_reg,
            "returnable_rate_reg": ret_reg,
            "borrowable_rate_trans": brw_trans,
            "returnable_rate_trans": ret_trans,
        }

    # -------------------------
    # 3) Layout geometry metrics
    # -------------------------
    def _compute_layout_metrics(self, selected_stations: list) -> Dict[str, float]:
        if len(selected_stations) <= 1:
            return {"mean_pairwise_distance": 0.0, "nearest_neighbor_distance": 0.0}

        return {
            "mean_pairwise_distance": self._compute_mean_pairwise_distance(selected_stations),
            "nearest_neighbor_distance": self._compute_nearest_neighbor_distance(selected_stations),
        }

    # -------------------------
    # 4) Rebalancing metrics todo: 旧版本的 rebalancing 评估
    # -------------------------
    # def _compute_rebalancing_metrics(self, total_flow: float) -> Dict[str, float]:
    #     r = self.ctx.rebalance_flow
    #     bike_net = self.ctx.bike_network
    #     unit_cost = self.ctx.unit_reb_cost
    #
    #     net_vol, total_dist = self._net_rebalance_volume_and_distance(r, bike_net)
    #     reb_cost = net_vol * (total_dist / net_vol) * unit_cost if net_vol > 0 else 0.0
    #     reb_avg_dist = (total_dist / net_vol) if net_vol > 0 else 0.0
    #     reb_intensity = (net_vol / total_flow) if total_flow > self.eps else 0.0
    #
    #     return {
    #         "reb_volume": net_vol,
    #         "reb_avg_dist": reb_avg_dist,
    #         "reb_cost": reb_cost,
    #         "reb_intensity": reb_intensity,
    #     }

    def _compute_rebalancing_metrics(self, total_flow: float) -> Dict[str, float]:
        r = self.ctx.rebalance_flow  # r[i,j,t]
        n = self.ctx.rebalance_dispatch  # n[i,j,t]
        bike_net = self.ctx.bike_network

        c_f = CostParameters.dispatch_fixed_cost
        c_d = CostParameters.rebalancing_unit_cost  # 这里表示 “per km per dispatch operation”

        # ---------- (A) dispatch-count based cost ----------
        total_dispatches = self._sum_var_dict(n)  # sum n[i,j,t]

        def dist_of_ijt(key):
            i, j, t = key
            return float(bike_net.get_edge_data(i, j)["distance"])

        # total_cost = sum n * (fixed + unit_dist_cost * dist)
        total_dispatch_cost = self._sum_var_dict_weighted(
            n, lambda key: (c_f + c_d * dist_of_ijt(key))
        )

        # avg distance per dispatch (optional but often useful)
        total_dispatch_distance = self._sum_var_dict_weighted(n, lambda key: dist_of_ijt(key))
        avg_dispatch_distance = (total_dispatch_distance / total_dispatches) if total_dispatches > self.eps else 0.0

        # ---------- (B) bikes moved & bikes per dispatch ----------
        total_reb_bikes = self._sum_var_dict(r)  # sum r[i,j,t]
        avg_bikes_per_dispatch = (total_reb_bikes / total_dispatches) if total_dispatches > self.eps else 0.0

        # ---------- (C) net rebalancing volume (cancel i<->j) ----------
        # net_vol, total_dist_net = self._net_rebalance_volume_and_distance(r, bike_net)
        # reb_avg_dist_net = (total_dist_net / net_vol) if net_vol > self.eps else 0.0
        # reb_intensity = (net_vol / total_flow) if total_flow > self.eps else 0.0

        return {
            # 新口径（按车次）
            "dispatch_count": total_dispatches,
            "reb_volume": total_reb_bikes,
            "dispatch_cost": total_dispatch_cost,
            "avg_bikes_per_dispatch": avg_bikes_per_dispatch,
            "avg_dispatch_distance": avg_dispatch_distance,  # 可选但很推荐

            # 旧口径（按净调度量）
            # "reb_volume": net_vol,
            # "reb_avg_dist": reb_avg_dist_net,
            # "reb_intensity": reb_intensity,
        }

    def _sum_var_dict(self, var_dict) -> float:
        return sum(float(v.X) for v in var_dict.values() if float(v.X) > self.eps)

    def _sum_var_dict_weighted(self, var_dict, weight_fn) -> float:
        s = 0.0
        for key, v in var_dict.items():
            x = float(v.X)
            if x <= self.eps:
                continue
            s += x * float(weight_fn(key))
        return s

    # -------------------------
    # 5) Travel time metrics
    # -------------------------
    def _compute_travel_metrics(self, flows_by_mode, total_flow: float) -> Dict[str, float]:
        x_b, x_pt, x_w = flows_by_mode
        id_path_map = self.ctx.path_info

        total_tt = (
                self._total_travel_time(x_b, id_path_map)
                + self._total_travel_time(x_pt, id_path_map)
                # + self._total_travel_time(x_w, id_path_map)
        )
        avg_tt = total_tt / total_flow if total_flow > self.eps else 0.0

        rows = []
        rows += self._collect_path_time_flow(x_b, id_path_map, mode="bike_only")
        rows += self._collect_path_time_flow(x_pt, id_path_map, mode="bike_pt")

        tag = ""
        if rows:
            os.makedirs("diagnostics", exist_ok=True)
            df = pd.DataFrame(rows)

            fname = f"path_time_flow{('_' + tag) if tag else ''}.csv"
            df.to_csv(os.path.join("diagnostics", fname), index=False)

            plt.figure(figsize=(6, 4))

            # Baseline (without BSS)
            plt.hist(
                df["baseline_time"],
                weights=df["flow"],
                bins=30,
                alpha=0.45,
                edgecolor="black",
                label="Baseline (without BSS)"
            )

            # New (with BSS)
            plt.hist(
                df["travel_time"],
                weights=df["flow"],
                bins=30,
                alpha=0.65,
                edgecolor="black",
                label="With BSS"
            )

            plt.xlabel("Travel time (min)")
            plt.ylabel("Flow-weighted number of trips")
            plt.title("Flow-weighted travel time distribution")
            plt.legend()

            plt.tight_layout()
            plt.savefig("diagnostics/travel_time_hist_before_after.png", dpi=200)
            plt.close()

        return {"avg_travel_time": avg_tt}

    # -------------------------
    # 6) Coverage metrics (bike-related OD coverage)
    # -------------------------
    def _compute_coverage_metrics(self) -> Dict[str, float]:
        # 你现在定义 coverage 只看 bike_only + bike_pt（合理：BSS触发的 OD）
        x_b = self.ctx.bike_only_flow
        x_pt = self.ctx.bike_pt_flow

        covered: Set[Any] = set()
        for flow_dict in (x_b, x_pt):
            for (od, t, p), var in flow_dict.items():
                if var.X > self.eps:
                    covered.add(od)

        denom = self.ctx.total_sampled_od if self.ctx.total_sampled_od > 0 else 1
        return {"covered_od_ratio": len(covered) / denom}

    # -------------------------
    # 7) Time gain metrics
    # -------------------------
    def _compute_time_gain_metrics(self, total_flow) -> Dict[str, float]:
        m = self.ctx.model
        id_path_map = self.ctx.path_info
        cat = self.ctx.categorized_paths
        total_investment = m.Q  # 不考虑 m.Q_r

        total_time_gain = 0.0
        for (k, t) in self.ctx.demand_keys:
            for p in cat.get("bike_only", {}).get(k, []):
                key = (k, t, p)
                if key in m.x_b:
                    total_time_gain += m.x_b[key].X * id_path_map[p].shortest_path_time_gain

            for p in cat.get("bike_pt", {}).get(k, []):
                key = (k, t, p)
                if key in m.x_pt:
                    total_time_gain += m.x_pt[key].X * id_path_map[p].shortest_path_time_gain

            for p in cat.get("walk_pt", {}).get(k, []):
                key = (k, t, p)
                if key in m.x_w:
                    total_time_gain += m.x_w[key].X * id_path_map[p].shortest_path_time_gain

        return {"total_time_gain": total_time_gain,
                "average_time_gain": total_time_gain / total_flow if total_flow > self.eps else 0.0,
                "time_gain_per_investment": total_time_gain / total_investment if total_investment > self.eps else 0.0}

    # =========================================================
    # Helper functions (你可以搬到 utils.py)
    # =========================================================
    def _var_dict_sum(self, var_dict: Dict) -> float:
        return sum(v.X for v in var_dict.values())

    def _total_travel_time(self, flow_dict: Dict, id_path_map: Dict) -> float:
        return sum(var.X * id_path_map[p].total_time for (_, _, p), var in flow_dict.items() if var.X > self.eps)

    def _net_rebalance_volume_and_distance(self, r: Dict, bike_net) -> Tuple[float, float]:
        # 把 (i->j) 和 (j->i) 抵消掉
        fwd = defaultdict(float)
        rev = defaultdict(float)

        for (i, j, t), var in r.items():
            val = var.X
            if val <= self.eps:
                continue
            key = (min(i, j), max(i, j), t)
            if i.node_id <= j.node_id:
                fwd[key] += val
            else:
                rev[key] += val

        net_vol = 0.0
        total_dist = 0.0
        for key in set(fwd) | set(rev):
            i, j, t = key
            net = abs(fwd.get(key, 0.0) - rev.get(key, 0.0))
            if net <= self.eps:
                continue
            net_vol += net
            dist = bike_net.get_edge_data(i, j)["distance"]
            total_dist += net * dist
            # todo: 没有分摊 rebalancing 距离
        return net_vol, total_dist

    def _compute_average_utilization_rate(self, stations, v, w):
        """
        compute average utilization rate of selected stations (average of average inventory / capacity)
        do not consider period 0 because it's a dummy period
        :param stations:
        :param v: invertory level variable of each station
        :param w: capacity variable of each station
        :return:
        """
        utilization_sum = 0
        capacity = 0
        for station in stations:
            # 取出 station 在时间段 t 的库存变量（变量不存在则返回默认值 0）
            # single station, multi periods
            n_periods = self.ctx.model.demand_generator.time_periods  # real periods: 0 … T-1
            inv_sum = sum(v.get((station, t), 0).X for t in range(n_periods))
            avg_inventory = inv_sum / n_periods
            utilization = avg_inventory / w.get(station).X
            utilization_sum += utilization
            capacity += w.get(station).X
        avg_capacity = capacity / len(stations) if stations else 0
        utilization_rate = utilization_sum / len(stations) if stations else 0
        return utilization_rate, avg_capacity

    def _compute_station_availability(self, stations, v, w):
        """
        compute station availability rate (borrowable / returnable)
        :param stations:
        :param v:
        :param w:
        :return:
        """
        borrowable_index, returnable_index = 0, 0
        time_periods = range(self.ctx.model.demand_generator.time_periods)  # real periods: 0 … T-1
        for station in stations:
            borrowable = sum(v.get((station, t), 0).X > 0 for t in time_periods)
            returnable = sum(v.get((station, t), 0).X < w.get(station).X for t in time_periods)
            borrowable_index += borrowable / len(time_periods)
            returnable_index += returnable / len(time_periods)
        # 计算平均值
        borrowable_index = safe_div(borrowable_index, len(stations))
        returnable_index = safe_div(returnable_index, len(stations))
        return borrowable_index, returnable_index

    def _compute_mean_pairwise_distance(self, bike_stations_selected):
        """
        NumPy 更快的矢量化方案
        :return:
        """
        station_coordinates = [s.coordinate for s in bike_stations_selected]
        if len(station_coordinates) < 2:
            return 0.0

        gdf = gpd.GeoDataFrame(
            geometry=[Point(lon, lat) for lon, lat in station_coordinates],
            crs="EPSG:4326",
        ).to_crs("EPSG:2056")

        coords_m = np.array([(p.x, p.y) for p in gdf.geometry], dtype=float)  # meters
        distances = pdist(coords_m)  # Euclidean distances in meters
        return float(distances.mean()) if distances.size else 0.0

    def _compute_nearest_neighbor_distance(self, stations):
        """
        每个站点只看距离最近的另一个站点，取平均，更敏感于“密集簇”。
        越小说明站点间距小，有局部集中趋势； 比 pairwise 更适合检测“是否形成小团簇”。
        投影成米 再计算距离
        :return:
        """

        station_coordinates = [s.coordinate for s in stations]
        if len(station_coordinates) < 2:
            return 0.0

        # 1) Build GeoDataFrame in WGS84
        gdf = gpd.GeoDataFrame(
            geometry=[Point(lon, lat) for lon, lat in station_coordinates],
            crs="EPSG:4326",
        ).to_crs("EPSG:2056")  # project to meters

        # 2) Extract projected coordinates (meters)
        coords_m = np.array(
            [(p.x, p.y) for p in gdf.geometry],
            dtype=float
        )

        # 3) KD-tree for nearest neighbor search
        tree = KDTree(coords_m)

        # query k=2: first is self (distance 0), second is nearest neighbor
        dists, _ = tree.query(coords_m, k=2)

        nearest_distances = dists[:, 1]
        return float(nearest_distances.mean())

    def _collect_path_time_flow(
            self,
            flow_dict: Dict[Tuple, object],  # (k,t,p)->gurobi var
            id_path_map: Dict,
            mode: str,
    ) -> List[dict]:
        rows = []
        for (k, t, p), var in flow_dict.items():
            x = float(var.X)
            if x <= self.eps:
                continue

            new_time = float(id_path_map[p].total_time)
            gain = float(getattr(id_path_map[p], "shortest_path_time_gain", 0.0))
            base_time = new_time + gain  # baseline = new + gain

            rows.append({
                "mode": mode,
                "t": int(t),
                "path_id": p,
                "flow": x,
                "travel_time": new_time,
                "baseline_time": base_time,
                # 可选：如果你有 time_gain，也可以一起存
                "time_gain": float(getattr(id_path_map[p], "shortest_path_time_gain", 0.0)),
            })
        return rows

