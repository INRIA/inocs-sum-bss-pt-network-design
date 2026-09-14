import gurobipy as gp
from gurobipy import GRB
from collections import defaultdict
from util.util import *
from util.cost import CostParameters


def set_embedded_lexicographic_objectives(self):
    """
    Objective function: Maximize the total bike-related flow captured by the system,
    including both bike-only and bike–public transport multimodal trips.
    Assign a ranking-based penalty pi_k(r) to discourage lower-ranked (longer) paths"""

    if IS_MAX_COVERAGE:
        if IS_RANKING_BASED:
            self.inferior_value = self.pi_kr
        else:
            self.inferior_value = self.alpha
        # Maximize bike-related flow, i.e., the amount of travel demand
        # that the BSS can attract and serve under a given budget
        total_flow = \
            gp.quicksum(
                (1 - self.penalty_coefficient * self.inferior_value[path]) * self.x_b[k, t, path]
                for k, t in self.demand_matrix.keys()
                for path in self.shortest_path_solver.categorized_paths["bike_only"].get(k, [])
                if (k, t, path) in self.x_b
            ) + gp.quicksum(
                (1 - self.penalty_coefficient * self.inferior_value[path]) * self.x_pt[k, t, path]
                for k, t in self.demand_matrix.keys()
                for path in self.shortest_path_solver.categorized_paths["bike_pt"].get(k, [])
                if (k, t, path) in self.x_pt
            )

        self.model.ModelSense = gp.GRB.MAXIMIZE

        self.model.setObjectiveN(total_flow,
                                 index=0, priority=2, weight=1.0,
                                 name="max_served_flow")

        # 2) 次目标：最小化 dispatch cost（或 dispatch_count）
        dispatch_cost_expr = gp.quicksum(
            self.n[i, j, t] * (
                    CostParameters.dispatch_fixed_cost +
                    CostParameters.rebalancing_unit_cost *
                    float(self.A_bike_network.get_edge_data(i, j)["distance"])
            )
            for (i, j) in self.A_bike_network.edges
            for t in self.T
        )

        self.model.setObjectiveN(-dispatch_cost_expr,
                                 index=1, priority=1, weight=1.0,
                                 name="min_dispatch_cost")

        # todo： 纯考虑 maximum flow
        # total_flow = \
        #     gp.quicksum(
        #         self.x_b[k, t, path]
        #         for k, t in self.demand_matrix.keys()
        #         for path in self.shortest_path_solver.categorized_paths["bike_only"].get(k, [])
        #         if (k, t, path) in self.x_b
        #     ) + gp.quicksum(
        #         self.x_pt[k, t, path]
        #         for k, t in self.demand_matrix.keys()
        #         for path in self.shortest_path_solver.categorized_paths["bike_pt"].get(k, [])
        #         if (k, t, path) in self.x_pt
        #     )

        # self.model.setObjective(total_flow, GRB.MAXIMIZE)
    else:
        # maximize total flow * time_gain
        total_time_gain = (gp.quicksum(
            self.shortest_path_solver.id_path_map[path].shortest_path_time_gain * self.x_b[k, t, path]
            for k, t in self.demand_matrix.keys()
            for path in self.shortest_path_solver.categorized_paths["bike_only"].get(k, [])
            if (k, t, path) in self.x_b
        ) + gp.quicksum(
            self.shortest_path_solver.id_path_map[path].shortest_path_time_gain * self.x_pt[k, t, path]
            for k, t in self.demand_matrix.keys()
            for path in self.shortest_path_solver.categorized_paths["bike_pt"].get(k, [])
            if (k, t, path) in self.x_pt
        )
            # no time gain for walk + pt path because it can be realized before introducing bike
            # + gp.quicksum(
            #     self.shortest_path_solver.id_path_map[path].shortest_path_time_gain * self.x_w[k, t, path]
            #     for k, t in self.demand_matrix.keys()
            #     for path in self.shortest_path_solver.categorized_paths["walk_pt"].get(k, [])
            #     if (k, t, path) in self.x_w)
        )
        self.model.setObjective(total_time_gain, GRB.MAXIMIZE)


def set_two_stage_objective(self):

    # ---- flow objective ----
    self.total_flow_expr = \
        gp.quicksum(
            (1 - self.penalty_coefficient * self.pi_kr[path]) * self.x_b[k, t, path]
            for k, t in self.demand_matrix.keys()
            for path in self.shortest_path_solver.categorized_paths["bike_only"].get(k, [])
            if (k, t, path) in self.x_b
        ) + gp.quicksum(
            (1 - self.penalty_coefficient * self.pi_kr[path]) * self.x_pt[k, t, path]
            for k, t in self.demand_matrix.keys()
            for path in self.shortest_path_solver.categorized_paths["bike_pt"].get(k, [])
            if (k, t, path) in self.x_pt
        )

    # ---- dispatch cost ----
    self.dispatch_cost_expr = gp.quicksum(
        self.n[i, j, t] * (
            CostParameters.dispatch_fixed_cost +
            CostParameters.rebalancing_unit_cost *
            float(self.A_bike_network.get_edge_data(i, j)["distance"])
        )
        for (i, j) in self.A_bike_network.edges
        for t in self.T
    )


def set_objective(self):
    if IS_RANKING_BASED:
        self.inferior_value = self.pi_kr
    else:
        self.inferior_value = self.alpha

    # Maximize bike-related flow, i.e., the amount of travel demand
    # that the BSS can attract and serve under a given budget
    total_flow = \
        gp.quicksum(
            (1 - self.penalty_coefficient * self.inferior_value[path]) * self.x_b[k, t, path]
            for k, t in self.demand_matrix.keys()
            for path in self.shortest_path_solver.categorized_paths["bike_only"].get(k, [])
            if (k, t, path) in self.x_b
        ) + gp.quicksum(
            (1 - self.penalty_coefficient * self.inferior_value[path]) * self.x_pt[k, t, path]
            for k, t in self.demand_matrix.keys()
            for path in self.shortest_path_solver.categorized_paths["bike_pt"].get(k, [])
            if (k, t, path) in self.x_pt
        )

    self.model.setObjective(total_flow, GRB.MAXIMIZE)


def set_weighted_multi_objective(self):
    """
    Add a penalty term for the dispatch cost in the objective function
    to approximate the lexicographic optimization in a single-stage formulation.
    :param self:
    :param epsilon:
    :return:
    """
    total_flow = gp.quicksum(
        (1 - self.penalty_coefficient * self.pi_kr[path]) * self.x_b[k, t, path]
        for k, t in self.demand_matrix.keys()
        for path in self.shortest_path_solver.categorized_paths["bike_only"].get(k, [])
        if (k, t, path) in self.x_b
    ) + gp.quicksum(
        (1 - self.penalty_coefficient * self.pi_kr[path]) * self.x_pt[k, t, path]
        for k, t in self.demand_matrix.keys()
        for path in self.shortest_path_solver.categorized_paths["bike_pt"].get(k, [])
        if (k, t, path) in self.x_pt
    )

    dispatch_cost_expr = gp.quicksum(
        self.n[i, j, t] * (
            CostParameters.dispatch_fixed_cost +
            CostParameters.rebalancing_unit_cost *
            float(self.A_bike_network.get_edge_data(i, j)["distance"])
        )
        for (i, j) in self.A_bike_network.edges
        for t in self.T
    )

    embedded_obj = total_flow - self.epsilon * dispatch_cost_expr

    self.model.ModelSense = gp.GRB.MAXIMIZE
    self.model.setObjective(embedded_obj)
