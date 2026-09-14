# metrics/builder.py
from dataclasses import dataclass
from output_handler.metrics_context import MetricsContext
from util.cost import CostParameters
from typing import Any


@dataclass
class MetricsContextBuilder:
    model: Any

    def build(self) -> MetricsContext:
        m = self.model
        sps = m.shortest_path_solver

        return MetricsContext(
            model=m,

            # flows
            bike_only_flow=m.x_b,
            bike_pt_flow=m.x_pt,
            walk_pt_flow=m.x_w,

            # stations
            station_open=m.y,
            station_inventory=m.v,
            station_capacity=m.w,

            # rebalancing
            rebalance_flow=m.r,
            rebalance_dispatch=m.n,

            # path & demand
            path_info=sps.id_path_map,
            categorized_paths=sps.categorized_paths,
            demand_keys=list(m.demand_matrix.keys()),
            total_sampled_od=m.demand_generator.num_sampled_od_pairs,

            # network & cost
            bike_network=m.A_bike_network,
            unit_reb_cost=CostParameters.rebalancing_unit_cost,
        )
