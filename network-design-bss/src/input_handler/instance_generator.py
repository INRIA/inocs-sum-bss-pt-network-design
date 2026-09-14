import json
import os
import random
from typing import Dict, Any
from util.util import *
from util.cost import *
from input_handler.grid_generator import GridGenerator
from input_handler.pt_generator import PublicTransport
from input_handler.station_generator import BikeStationGenerator
from input_handler.demand_generator import DemandGenerator
from input_handler.demand_mapping import DemandMapper
from input_handler.preprocess import match_transfer_station_with_bss
from input_handler.h3_grid_generator import H3GridGenerator
from dataclasses import dataclass
from shapely.geometry import Point
from sklearn.neighbors import KDTree
from pathlib import Path
from collections import defaultdict
from scenario.scenario_config import ScenarioConfig


class InstanceGenerator:

    def __init__(
            self,
            scenario: ScenarioConfig,
            # From this point onward, all subsequent parameters must be passed by keyword only and cannot be provided
            # as positional arguments.
            *,  # force keyword argument.
            use_h3: bool = True,
    ):
        self.bike_stations = None
        self.public_transport = None
        self.bike_station_generator = None
        self.grid_generator = None
        self.scenario = scenario
        self.use_h3 = use_h3
        # 占位：待生成
        self.grid_network = None
        self.od_demand = None
        self.pt_structure = None
        self.station_layout = None

    @property
    def config_name(self) -> str:
        d = self.scenario.demand_config
        b = self.scenario.budget_config
        w_tag = "-".join(f"{x:.2f}" for x in d.period_weights)

        parts = [
            f"{self.scenario.name}",
            f"H3{self.use_h3}",
            f"SEED{self.scenario.demand_config.seed}",
            f"DIS{d.split_method}",
            f"P{w_tag}",
            f"BUD{b.total_budget}",
            f"OP{b.op_budget_ratio:.4f}",
            f"SCALE{d.demand_scale:.2f}",
        ]

        return "_".join(parts)

    def generate_synthesized_scenario(self):
        """调用网络生成、线路生成、需求生成逻辑"""
        random.seed(self.seed)
        # 构建网格结构
        self.grid_generator = GridGenerator(self.area_length, self.area_width, self.cell_size)
        # 构建 PT
        self.public_transport = PublicTransport(self.grid_generator)
        pt_line_number = len(FIXED_LINE_POINTS_LST)
        for pt, fixed_line_points in zip(range(1, pt_line_number + 1), FIXED_LINE_POINTS_LST):
            self.public_transport.generate_new_route(f"PT_{pt}", flag=True, fixed_line_points=fixed_line_points)

        # Bike stations
        self.bike_station_generator = BikeStationGenerator(self.grid_generator)
        self.bike_stations = self.bike_station_generator.bike_stations
        self.public_transport, self.bike_stations = match_transfer_station_with_bss(
            self.public_transport, self.bike_stations
        )

        # Demand
        demand_generator = DemandGenerator(
            self.grid_generator,
            self.public_transport,
            self.seed,
            self.total_trips,
            self.demand_type,
            self.coverage_ratio
        )
        self.od_demand = demand_generator.demand_matrix

        # 转换结构用于保存
        self.pt_structure = self.public_transport.to_dict()
        self.station_layout = self._serialize_stations(self.bike_stations)

    def build_realistic_scenario(self, od_path="data/geojson/geneva_1.5km-radius/od.csv"):
        """Network construction, path extraction, potential station generation,
        and demand generation logic in real-world scenarios.

        :param od_path: path to an [origin_cell, dest_cell, flow] CSV. Defaults
            to the observed/IPF-fitted od.csv; pass a different file (e.g. a
            gravity-densified variant from od_gravity_completion) to test the
            solver on a structurally larger OD set.
        """
        scenario = self.scenario
        demand_config = scenario.demand_config
        random.seed(demand_config.seed)

        # netork construction
        geojson_data = load_geojson("grid.geojson")
        self.grid_generator = H3GridGenerator(geojson_data)

        # pt line extraction (站点在构造之初已经被当作transfer station)
        self.public_transport = PublicTransport(self.grid_generator).build_route()

        # potential bike station generation
        self.bike_station_generator = BikeStationGenerator(self.grid_generator)
        self.bike_stations = self.bike_station_generator.bike_stations

        # all stations = transfer stations (pt stop related) + bike stations
        stations_combined = self.bike_stations + [s for route in self.public_transport.routes.values() for s in route]
        # self.all_stations = [s for route in self.public_transport.routes.values() for s in route]

        self.all_stations = self._preprocess_stations(stations_combined)

        self.all_stations = merge_nearby_stations(self.all_stations, threshold_m=100)

        # demand_generator = DemandMapper(
        #     grid_generator=self.grid_generator,
        #     trips_geojson_path="bike_trips.geojson",
        #     pt_heatnao_path="heatmap.geojson",
        #     demand_type="count",  # 或 "distance"
        # )
        # print("Observed trips:", demand_generator.total_trips_observed, "OD pairs:", demand_generator.total_od_pairs)

        # self.od_demand = demand_generator.od_demand

        # 1) 先用你已有的 split_od_into_periods 得到 long df
        # od_3p columns: period, origin_cell, dest_cell, flow

        od = pd.read_csv(od_path)

        # Uniformly scale the IPF-fitted OD flows (demand_scale == 1.0 keeps
        # the observed magnitude unchanged).
        od["flow"] = od["flow"] * demand_config.demand_scale

        self.od_demand = split_od_into_periods(
            od_df=od,
            periods=demand_config.demand_periods,
            weights=demand_config.period_weights,
            method=demand_config.split_method,  # default "multinomial"
            seed=demand_config.seed,
        )

        # # 转换结构用于保存
        self.pt_structure = self.public_transport.to_dict()
        self.station_layout = self._serialize_stations(self.all_stations)

        self.grid_network = self.grid_generator.serialize_grid()

    def to_dict(self) -> Dict[str, Any]:
        """打包为可序列化结构"""
        return {
            "config_name": self.config_name,
            # "coverage_ratio": self.coverage_ratio,
            # "total_trips": self.total_trips,
            "seed": self.scenario.demand_config.seed,
            "time_period": self.scenario.demand_config.demand_periods,
            # "grid_length": self.grid_generator.length,
            # "grid_width": self.grid_generator.width,
            # "cell_size": self.grid_generator.square_size,
            "demand_type": self.scenario.demand_config.split_method,
            "time_period_weights": self.scenario.demand_config.period_weights,
            "total_budget": self.scenario.budget_config.total_budget,
            "operational_budget_ratio": self.scenario.budget_config.op_budget_ratio,
            "od_demand": {str(k): v for k, v in self.od_demand.items()},
            "pt_structure": self.pt_structure,
            "station_layout": self.station_layout,
            "grid_network": self.grid_network
        }

    @staticmethod
    def parse_od_demand(od_demand_dict: Dict[str, int]):
        return {eval(k): v for k, v in od_demand_dict.items()}

    def save_to_file(self, output_dir: str):
        """导出为 JSON 文件"""
        os.makedirs(output_dir, exist_ok=True)
        path = os.path.join(output_dir, self.config_name + ".txt")
        with open(path, "w") as f:
            # keys must be str, int, float, bool or None, not tuple
            # 需要对 key 做序列化处理
            json.dump(self.to_dict(), f, indent=2)
        print(f"✅ Saved: {path}")

    def _serialize_stations(self, stations):
        return [
            {
                "node_id": s.node_id,
                "coordinate": s.coordinate,
                # "capacity": s.capacity,
                # "initial_stock": s.initial_stock,
                # "capacity_ub": s.capacity_ub,
                # "catchment_area_walk": s.catchment_area_walk,
                # "catchment_area_ride": s.catchment_area_ride,
                "type": s.type
            }
            for s in stations
        ]

    def _preprocess_stations(self, stations):
        """
        所有潜在站点（bike stations + PT stops）必须落在 H3 grid 的整体多边形区域内部
        :param stations:
        :return:
        """
        # 2. 过滤潜在站点
        valid_stations, removed_stations = filter_stations_inside_grid(stations, self.grid_generator.grid_polygon)
        self.removed_candidate_stations = removed_stations
        return valid_stations


def filter_stations_inside_grid(all_stations, grid_polygon):
    """
    Return only the stations whose coordinates fall inside the H3 grid boundary.
    """
    filtered = []
    removed = []

    for s in all_stations:
        lon, lat = s.coordinate
        pt = Point(lon, lat)
        if grid_polygon.contains(pt):
            filtered.append(s)
        else:
            removed.append(s)

    return filtered, removed


def merge_nearby_stations(stations, threshold_m=100):
    """
    Merge stations within threshold_m. Keep one representative from each cluster.

    stations: list of station objects
        station.coordinate = (lon, lat)

    threshold_m: float
        Distance threshold in meters.
    """

    # --- Step 1: convert to 3857 for meter-based distance ---
    pts = np.array([s.coordinate for s in stations])
    gdf = gpd.GeoDataFrame(
        geometry=[Point(lon, lat) for lon, lat in pts],
        crs="EPSG:4326"
    ).to_crs(epsg=3857)

    coords_m = np.array([[p.x, p.y] for p in gdf.geometry])
    tree = KDTree(coords_m)

    n = len(stations)
    visited = np.zeros(n, dtype=bool)
    merged = []

    for i in range(n):
        if visited[i]:
            continue

        # 查找距离 < threshold 的所有点
        idx = tree.query_radius([coords_m[i]], r=threshold_m)[0]
        visited[idx] = True

        # 这里你可以选：
        # 1) 选择第一个
        # 2) 选择中心点
        # 3) 选择原 stations 中属性更完整的那个
        # 我这里选“第一个出现的”
        merged.append(stations[i])

    return merged
