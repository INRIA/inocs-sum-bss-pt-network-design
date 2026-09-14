"""
Description:
    Extracts instance attributes from generated H3-based JSON/TXT instance files.
    Used in the BSS/PT network design experimental pipeline.

Author: Zhenyu Wu
Last Modified: 2025-11-13

Notes:
    - This module loads instance files and parses configuration attributes.
"""


from input_handler.demand_generator import DemandGenerator
from input_handler.grid_generator import GridGenerator
from input_handler.h3_grid_generator import H3GridGenerator
from input_handler.pt_generator import PublicTransport
from output_handler.visualize import plot_h3_grid_and_stations, plot_h3_grid_and_pt_stops
from network.node import TransferStation, BikeStation
from util.cost import CostParameters
from util.util import *
from pathlib import Path as FilePath


def load_instance_by_name(config_name, folder="h3_instances_json"):
    path = FilePath(folder) / f"{config_name}.txt"
    if not path.exists():
        raise FileNotFoundError(f"Instance file {path} not found")
    with open(path, "r") as f:
        data = json.load(f)
    return data   # 或者再用 InstanceGenerator.from_dict(data)


def get_instance_attribute(instance_config):
    config_name = instance_config.config_name
    instance_entity = load_instance_by_name(config_name)
    # todo：instance 中有方法 scenario，已经记录了所要的信息，此处改dataclass的参数值其实是不必要的
    CostParameters.total_budget = instance_entity["total_budget"]
    CostParameters.operational_budget_ratio = instance_entity["operational_budget_ratio"]
    CostParameters.operational_budget = instance_entity["total_budget"] * instance_entity["operational_budget_ratio"]

    # ── Propagate time periods to the util.util module global so that any
    #    code which still reads TIME_PERIODS directly gets the right value.
    #    (Modules that do `from util.util import *` bind the name at import
    #    time; they are fixed separately.  This covers late-bound reads.)
    _time_period = instance_entity.get("time_period", 3)
    import util.util as _util_mod
    _util_mod.TIME_PERIODS = _time_period
    # 1. 还原 od_demand
    od_demand = {eval(k): v for k, v in instance_entity["od_demand"].items()}

    # 2. 还原所有站点（BikeStation / TransferStation）
    station_layout = []
    seen_coords = set()
    for s in instance_entity["station_layout"]:
        coord = tuple(s.get("coordinate"))  # 假设存的是 [lon, lat]
        # 已有同坐标 → 跳过
        if coord in seen_coords:
            continue
        if s["type"] == "BikeStation":
            station = BikeStation.from_dict(s)
        elif s["type"] == "TransferStation":
            station = TransferStation.from_dict(s)
        else:
            raise ValueError(f"Unknown station type: {s['type']}")
        station_layout.append(station)
        seen_coords.add(coord)

        # 3. 还原 PublicTransport
    if not H3_BASED_GRID:
        # rectangular grid system
        grid_generator = GridGenerator()
    else:
        # h3 grid system
        grid_generator = H3GridGenerator.from_instance(instance_entity["grid_network"])
    public_transport = PublicTransport.from_dict(instance_entity["pt_structure"], grid_generator)
    for route_name, stops in public_transport.routes.items():
        for i in range(len(stops) - 1):
            stops[i].pt_attrs.next_stop = stops[i + 1]
            stops[i].pt_attrs.next_stop_distance = compute_distance(
                stops[i].coordinate, stops[i + 1].coordinate
            )
    demand_generator = DemandGenerator.from_existing_demand(
        od_demand=od_demand,
        grid_generator=grid_generator,
        public_transport=public_transport,
        seed=instance_entity["seed"],
        demand_type=instance_entity["demand_type"],
        time_periods=instance_entity.get("time_period", 3),
        time_period_weights=instance_entity.get("time_period_weights", None)
    )
    unique_ids = set()
    for (o, d), _ in demand_generator.demand_matrix.items():
        unique_ids.update([o[0]])
        unique_ids.update([o[1]])

    if H3_BASED_GRID:
        plot_h3_grid_and_stations(
            config_name=config_name,
            grid_generator=grid_generator,
            station_layout=station_layout,
        )
        plot_h3_grid_and_pt_stops(
            config_name=config_name,
            grid_generator=grid_generator,
            public_transport=public_transport,
        )
    return config_name, demand_generator, grid_generator, public_transport, station_layout
