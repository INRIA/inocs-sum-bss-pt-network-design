from dataclasses import asdict

import pandas as pd
import os
from model.bike_sharing_optimization import BikeSharingModel
from network.network_constructor import NetworkConstructor
from util.util import *
from util.cost import CostParameters
from output_handler.metrics import BSSMetrics
from output_handler.metrics_evaluator import MetricsEvaluator
from output_handler.matrics_builder import MetricsContextBuilder
from output_handler.metrics import ExperimentRow


class ExperimentHandler:
    def __init__(self,
                 bike_sharing_model: BikeSharingModel,
                 network: NetworkConstructor,
                 config_name: str,
                 output_file="experiment_results.csv"):
        self.bike_sharing_model = bike_sharing_model
        self.solver_stats = self.bike_sharing_model.solver_stats
        self.network = network
        self.config_name = config_name
        self.output_file = output_file
        self.data: list[ExperimentRow] = []
        self._record_experiment_result()

    def _record_experiment_result(self):
        self.record()
        self.save()

    def record(self):
        """
        Record the experiment result into the data buffer.
        :return:
        """
        model = self.bike_sharing_model.model

        if model.SolCount > 0:
            computed_metrics = self.compute_decision_variable_result()
        else:
            computed_metrics = BSSMetrics.empty()

        row = {
            # Unpack a dictionary and merge its key–value pairs directly into the current dictionary
            **self._row_config(),
            **self._row_network(),
            **self._row_layout_metrics(computed_metrics),
            **self._row_flow_metrics(computed_metrics),
            **self._row_rebalancing_metrics(computed_metrics),
            # **self._row_solver_two_stage(self.solver_stats),
            **self._row_solver(model),
        }

        # Store the raw dict so callers (e.g. comparison_writer) can read it.
        self.last_row: dict = row

        self.data.append(ExperimentRow(**row))

    def compute_decision_variable_result(self) -> BSSMetrics:
        ctx = MetricsContextBuilder(self.bike_sharing_model).build()
        evaluator = MetricsEvaluator(ctx)
        return evaluator.evaluate()

    def save(self):
        if not self.data:
            return

        df_new = pd.DataFrame([asdict(r) for r in self.data]).round(4)
        write_header = not os.path.exists(self.output_file)
        df_new.to_csv(self.output_file, mode="a", header=write_header, index=False)

        # optional: clear buffer after flushing to disk
        self.data.clear()

    def compute_total_travel_time(self, flow_var, id_path_map):
        return sum(flow_var[k, t, path].X * id_path_map[path].total_time for k, t, path in flow_var)

    def _row_config(self) -> dict:
        dg = self.bike_sharing_model.demand_generator
        return {
            "config": self.config_name,
            "solve_mode": self.bike_sharing_model.solve_mode,
            "od_num": dg.num_sampled_od_pairs,
            "total_demand": dg.total_trips,
            "distribution_type": dg.demand_distribution_type,
            "time_weights": dg.time_period_weights,
            "total_budget": CostParameters.total_budget,
            "operational_budget_ratio": CostParameters.operational_budget_ratio,
            "period": self.bike_sharing_model.demand_generator.time_periods,
            "epsilon": self.bike_sharing_model.epsilon,
            "reb_budget": CostParameters.operational_budget,
        }

    def _row_network(self) -> dict:
        g = self.network.graph
        return {
            "network_nodes": len(g.nodes),
            "network_edges": len(g.edges),
            "n_candidates": len(self.network.bike_stations),
        }

    def _row_layout_metrics(self, m) -> dict:
        # m: BSSMetrics
        n_selected = m.n_reg_station + m.n_trans_station
        return {
            "n_selected_stations": n_selected,
            "mean_pairwise_distance": m.mean_pairwise_distance,
            "nearest_neighbor_distance": m.nearest_neighbor_distance,
            "n_reg_station": m.n_reg_station,
            "n_trans_station": m.n_trans_station,
            "avg_capacity_reg": m.avg_capacity_reg,
            "avg_capacity_trans": m.avg_capacity_trans,
            "fill_ratio_reg": m.util_reg,
            "fill_ratio_trans": m.util_trans,
            "brw_reg": m.borrowable_rate_reg,
            "ret_reg": m.returnable_rate_reg,
            "brw_trans": m.borrowable_rate_trans,
            "ret_trans": m.returnable_rate_trans,
        }

    def _row_flow_metrics(self, m) -> dict:
        by_mode = m.total_flow_by_mode or {}
        return {
            "flow_total": m.total_flow,
            "supported_flow_per_investment": m.supported_flow_per_investment,
            "avg_travel_time": m.avg_travel_time,
            "total_time_gain": m.total_time_gain,
            "average_time_gain": m.average_time_gain,
            "covered_od_ratio": round(m.covered_od_ratio, 3),
            "flow_bike_only": by_mode.get("flow_bike_only", 0.0),
            "flow_bike_pt": by_mode.get("flow_bike_pt", 0.0),
            # "flow_walk_pt": by_mode.get("flow_walk_pt", 0.0),
        }

    def _row_rebalancing_metrics(self, m) -> dict:
        return {
            "dispatch_count": m.dispatch_count,
            "reb_volume": m.reb_volume,
            "dispatch_cost": m.dispatch_cost,
            "avg_bikes_per_dispatch": m.avg_bikes_per_dispatch,
            "avg_dispatch_distance": m.avg_dispatch_distance,
        }

    def _row_solver(self, model) -> dict:
        has_sol = model.SolCount > 0
        mip_gap = round(model.MIPGap, 4) if has_sol else None
        return {
            "status":    model.Status,
            "obj_val":   round(model.ObjVal,   3) if has_sol else None,
            "obj_bound": round(model.ObjBound, 3) if has_sol else None,
            "mip_gap":   mip_gap,
            "runtime":   round(model.Runtime,  3),
        }

    def _row_solver_two_stage(self, solver_stats: dict) -> dict:
        """
        Flatten solver statistics (single-stage or two-stage) into CSV-friendly fields.

        Expected two-stage format:
        {
            "two_stage": True,
            "stage1": {"status":..., "has_sol":..., "obj":..., "bound":..., "gap":..., "runtime":..., "solcount":...},
            "stage2": {"status":..., "has_sol":..., "obj":..., "bound":..., "gap":..., "runtime":..., "solcount":...},
            "stage1_best_flow": <float>,
        }
        """
        if not solver_stats:
            return {}

        if solver_stats.get("two_stage", False):
            s1 = solver_stats.get("stage1", {}) or {}
            s2 = solver_stats.get("stage2", {}) or {}

            def _get_obj(d):
                return d.get("obj", d.get("obj_val"))

            def _get_bound(d):
                return d.get("bound", d.get("obj_bound"))

            return {
                # "solve_mode": "two_stage",

                "s1_status": s1.get("status"),
                "s1_obj": _get_obj(s1),
                "s1_bound": _get_bound(s1),
                "s1_gap": s1.get("gap"),
                "s1_runtime": s1.get("runtime"),

                "s2_status": s2.get("status"),
                "s2_obj": _get_obj(s2),
                "s2_bound": _get_bound(s2),
                "s2_gap": s2.get("gap"),
                "s2_runtime": s2.get("runtime"),

                "stage1_best_flow": solver_stats.get("stage1_best_flow"),
            }
