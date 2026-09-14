# metrics.py
from typing import Dict
from dataclasses import dataclass, asdict, fields
from typing import Optional


@dataclass
class BSSMetrics:
    # ---------- Flow-related ----------
    total_flow_by_mode: Dict[str, float]   # e.g. {"bike_only": x, "bike_pt": y, "walk_pt": z}
    total_flow: float
    supported_flow_per_investment: float
    avg_travel_time: float
    covered_od_ratio: float
    total_time_gain: float
    average_time_gain: float

    # ---------- Station layout ----------
    n_reg_station: int
    n_trans_station: int
    mean_pairwise_distance: float
    nearest_neighbor_distance: float

    # ---------- Capacity & utilization ----------
    avg_capacity_reg: float
    avg_capacity_trans: float
    util_reg: float
    util_trans: float

    borrowable_rate_reg: float
    returnable_rate_reg: float
    borrowable_rate_trans: float
    returnable_rate_trans: float

    # ---------- Rebalancing ----------
    dispatch_count: float
    reb_volume: float
    dispatch_cost: float
    avg_bikes_per_dispatch: float
    avg_dispatch_distance: float

    @classmethod
    def empty(cls) -> "BSSMetrics":
        return cls(
            total_flow_by_mode={"bike_only": 0.0, "bike_pt": 0.0, "walk_pt": 0.0},
            total_flow=0.0,
            avg_travel_time=float("nan"),
            n_reg_station=0,
            n_trans_station=0,
            mean_pairwise_distance=float("nan"),
            nearest_neighbor_distance=float("nan"),
            avg_capacity_reg=float("nan"),
            avg_capacity_trans=float("nan"),
            util_reg=float("nan"),
            util_trans=float("nan"),
            borrowable_rate_reg=float("nan"),
            returnable_rate_reg=float("nan"),
            borrowable_rate_trans=float("nan"),
            returnable_rate_trans=float("nan"),
            dispatch_count=0.0,
            reb_volume=0.0,
            dispatch_cost=0.0,
            avg_bikes_per_dispatch=0.0,
            avg_dispatch_distance=float("nan"),
            covered_od_ratio=0.0,
            total_time_gain=0.0,
            average_time_gain=0.0,
            supported_flow_per_investment=0.0,
        )


@dataclass(frozen=True)
class ExperimentRow:
    config: str
    solve_mode: str
    od_num: int
    total_demand: float
    distribution_type: str
    time_weights: list[float]
    total_budget: float
    operational_budget_ratio: float
    network_nodes: int
    network_edges: int
    period: int
    epsilon: float
    n_candidates: int
    n_selected_stations: int
    mean_pairwise_distance: float
    nearest_neighbor_distance: float
    n_reg_station: int
    n_trans_station: int
    avg_capacity_reg: float
    avg_capacity_trans: float
    fill_ratio_reg: float
    fill_ratio_trans: float
    brw_reg: float
    ret_reg: float
    brw_trans: float
    ret_trans: float
    flow_total: float
    supported_flow_per_investment: float
    avg_travel_time: float
    covered_od_ratio: float
    total_time_gain: float
    average_time_gain: float
    flow_bike_only: float
    flow_bike_pt: float
    # flow_walk_pt: float
    reb_budget: float
    dispatch_count: float
    reb_volume: float
    dispatch_cost: float
    avg_bikes_per_dispatch: float
    avg_dispatch_distance: float
    status: int
    obj_val: Optional[float]
    obj_bound: Optional[float]
    # mip_gap : Gurobi MIPGap = (obj_bound - obj_val) / obj_bound
    mip_gap: Optional[float]
    runtime: float
    # ---------- stage 1 : max served flow ----------
    # s1_status: int
    # s1_obj: Optional[float]
    # s1_bound: Optional[float]
    # s1_gap: Optional[float]
    # s1_runtime: float

    # ---------- stage 2 : min dispatch cost ----------
    # s2_status: Optional[int]
    # s2_obj: Optional[float]
    # s2_bound: Optional[float]
    # s2_gap: Optional[float]
    # s2_runtime: Optional[float]

    # ---------- linking metric ----------
    # stage1_best_flow: Optional[float]

    @classmethod
    def columns(cls) -> list[str]:
        return [f.name for f in fields(cls)]

    def to_dict(self) -> dict:
        """Convert to a flat dict for CSV/DF export."""
        return asdict(self)
