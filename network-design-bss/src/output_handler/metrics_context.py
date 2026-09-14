from dataclasses import dataclass
from typing import Dict, Any, List, Set, Tuple
from collections import defaultdict


@dataclass(frozen=True)
class MetricsContext:
    model: Any

    # ---------- Flow decision variables ----------
    bike_only_flow: Dict          # x_b : flow on bike-only paths
    bike_pt_flow: Dict            # x_pt: flow on bike + PT paths
    walk_pt_flow: Dict            # x_w : flow on walk + PT paths

    # ---------- Infrastructure decisions ----------
    station_open: Dict            # y : whether a station is built
    station_inventory: Dict       # v : number of bikes at station i,t
    station_capacity: Dict        # w : station capacity (docks)

    # ---------- Rebalancing decisions ----------
    rebalance_flow: Dict          # r : rebalancing flow between stations
    rebalance_dispatch: Dict      # n : number of rebalancing vehicles dispatched between stations

    # ---------- Path & demand ----------
    path_info: Dict               # id_path_map
    categorized_paths: Dict       # {bike_only, bike_pt, walk_pt}
    demand_keys: list
    total_sampled_od: int

    # ---------- Network & cost ----------
    bike_network: Any
    unit_reb_cost: float

