import gurobipy as gp
from gurobipy import GRB, quicksum
from util.util import *
from util.cost import CostParameters


def set_constraints(self):
    # Constraints (2) flow cannot exceed OD demand
    self.model.addConstrs(
        (gp.quicksum(
            self.x_b[k, t, path] for path in self.shortest_path_solver.categorized_paths["bike_only"].get(k, [])) +
         gp.quicksum(
             self.x_pt[k, t, path] for path in self.shortest_path_solver.categorized_paths["bike_pt"].get(k, [])) +
         gp.quicksum(self.x_w[k, t, path] for path in self.shortest_path_solver.categorized_paths["walk_pt"].get(k, []))
         <= self.demand_matrix[k, t]
         for k, t in self.demand_matrix.keys()),
        name="demand_limit"
    )

    # Constraints (3) Path selection: flow allowed only if path is chosen
    # todo: 不再使用 alpha，直接强绑定 f 和 y
    # self.model.addConstrs(
    #     (self.x_b[k, t, path] <= self.demand_matrix[k, t] * self.alpha_b[k, t, path]
    #      for k, t, path in self.x_b),
    #     name="bike_path_activation"
    # )
    # self.model.addConstrs(
    #     (self.x_pt[k, t, path] <= self.demand_matrix[k, t] * self.alpha_pt[k, t, path]
    #      for k, t, path in self.x_pt),
    #     name="pt_path_activation"
    # )
    # self.model.addConstrs(
    #     (self.x_w[k, t, path] <= self.demand_matrix[k, t] * self.alpha_w[k, t, path]
    #      for k, t, path in self.x_w),
    #     name="walk_path_activation"
    # )

    # Arc-level gating
    # todo: sigma x = f <= M * y_i
    # for (i, j, t), fvar in self.f.items():
    #
    #     # 只对存在 y 的节点加 gating（避免 KeyError）
    #     if i in self.y:
    #         self.model.addConstr(
    #             fvar <= CAPACITY_UB * self.y[i],
    #             name=f"arc_gate_out_{i}_{j}_{t}"
    #         )
    #
    #     if j in self.y:
    #         self.model.addConstr(
    #             fvar <= CAPACITY_UB * self.y[j],
    #             name=f"arc_gate_in_{i}_{j}_{t}"
    #         )

    if ARC_BASED_CONSTRAINTS:
        for arc in self.A_bike_network.edges:
            start_node, end_node = arc
            selected_arcs = set()
            self.model.addConstr(
                quicksum(
                    self.alpha_b[od_flow, t, path_id] if path_id in self.arc_to_paths[
                        (start_node, end_node), "bike_only"] else 0 for (od_flow, t, path_id) in self.alpha_b) +
                quicksum(
                    self.alpha_pt[od_flow, t, path_id] if path_id in self.arc_to_paths[
                        (start_node, end_node), "bike_pt"] else 0 for (od_flow, t, path_id) in self.alpha_pt)
                <= self.M * self.y[start_node],
                name="bike_station_dependency")
            self.model.addConstr(
                quicksum(
                    self.alpha_b[od_flow, t, path_id] if path_id in self.arc_to_paths[
                        (start_node, end_node), "bike_only"] else 0 for (od_flow, t, path_id) in self.alpha_b) +
                quicksum(
                    self.alpha_pt[od_flow, t, path_id] if path_id in self.arc_to_paths[
                        (start_node, end_node), "bike_pt"] else 0 for (od_flow, t, path_id) in self.alpha_pt)
                <= self.M * self.y[end_node],
                name="bike_station_dependency")
        # bike 相关 flow 流量守恒
        self.model.addConstrs(
            (self.f[i, j, t_fixed] ==
             gp.quicksum(self.x_b[k, t, path] for k, t, path in self.x_b
                         if t == t_fixed and path in self.arc_to_paths[(i, j), "bike_only"]) +
             gp.quicksum(self.x_pt[k, t, path] for k, t, path in self.x_pt
                         if t == t_fixed and path in self.arc_to_paths[(i, j), "bike_pt"])
             for i, j, t_fixed in self.f),
            name="flow_conservation"
        )

    # Constraints (4) Station activation: paths through a station allowed iff the station is built
    elif STATION_BASED_CONSTRAINTS:   # 目前采用
        # todo：\sum \alpha \le M\, y_i,\quad M=\sum \text{demand}
        #  在数值上通常 不够 tight（很松），容易导致 LP relaxation 很弱
        # for node in self.A_bike_network.nodes:
        #     self.model.addConstr(
        #         quicksum(
        #             self.alpha_b[od_flow, t, path_id] if path_id in self.node_to_paths[
        #                 node, "bike_only"] else 0 for (od_flow, t, path_id) in self.alpha_b) +
        #         quicksum(
        #             self.alpha_pt[od_flow, t, path_id] if path_id in self.node_to_paths[
        #                 node, "bike_pt"] else 0 for (od_flow, t, path_id) in self.alpha_pt)
        #         <= self.M * self.y[node],
        #         name="bike_station_dependency")

        # todo: 最 tight：逐路径“开关约束”（path-level gating）
        # -------- bike_only paths ----------
        # for (od, t, path_id), var in self.alpha_b.items():
        #
        #     nodes = self.path_to_nodes.get((path_id, "bike_only"), set())
        #     ub = self.demand_matrix[(od, t)]  # 每个 OD 在 t 的需求上界
        #
        #     for node in nodes:
        #         self.model.addConstr(
        #             var <= ub * self.y[node],
        #             name=f"gate_b_{od}_{t}_{path_id}_{node}"
        #         )
        # # -------- bike_pt paths ----------
        # for (od, t, path_id), var in self.alpha_pt.items():
        #
        #     nodes = self.path_to_nodes.get((path_id, "bike_pt"), set())
        #     ub = self.demand_matrix[(od, t)]
        #
        #     for node in nodes:
        #         self.model.addConstr(
        #             var <= ub * self.y[node],
        #             name=f"gate_pt_{od}_{t}_{path_id}_{node}"
        #         )

        # todo：替换掉 alpha，直接用 x
        # -------- bike_only: x_b gating ----------
        for (od, t, path_id), xvar in self.x_b.items():
            nodes = self.path_to_nodes.get((path_id, "bike_only"), set())
            if not nodes:
                continue

            ub = float(self.demand_matrix[(od, t)])  # tight M
            for node in nodes:
                self.model.addConstr(
                    xvar <= ub * self.y[node],
                    name=f"gate_xb_{od}_{t}_{path_id}_{node.node_id}",
                )

        # -------- bike_pt: x_pt gating ----------
        for (od, t, path_id), xvar in self.x_pt.items():
            nodes = self.path_to_nodes.get((path_id, "bike_pt"), set())
            if not nodes:
                continue

            ub = float(self.demand_matrix[(od, t)])
            for node in nodes:
                self.model.addConstr(
                    xvar <= ub * self.y[node],
                    name=f"gate_xpt_{od}_{t}_{path_id}_{node.node_id}",
                )

        # Constraints (5) Flow conservation: arc flow = path flows + inbound rebalancing − outbound rebalancing
        if REBALANCING_FLAG:
            # dual direction flow
            self.model.addConstrs(
                (self.f[i, j, t_fixed] ==
                 gp.quicksum(self.x_b[k, t, path] for k, t, path in self.x_b
                             if t == t_fixed and path in self.arc_to_paths[(i, j), "bike_only"]) +
                 gp.quicksum(self.x_pt[k, t, path] for k, t, path in self.x_pt
                             if t == t_fixed and path in self.arc_to_paths[(i, j), "bike_pt"])
                 # + self.r[i, j, t_fixed] - self.r[j, i, t_fixed]   # todo：区分用户流和调度流
                 for i, j, t_fixed in self.f),
                name="flow_conservation")
            # Constraints (12) Rebalancing cost budget
            # todo：单位距离成本 * 距离 * 调度流量 之和 ≤ 调度预算
            # self.model.addConstr(
            #     gp.quicksum(self.r[i, j, t] * self.A_bike_network.get_edge_data(i, j)['distance'] *
            #                 CostParameters.rebalancing_unit_cost
            #                 for (i, j) in self.A_bike_network.edges
            #                 for t in self.T) <= self.Q_r,
            #     name="budget_constraint"
            # )

            # todo:车次数 * （固定成本 + 单位距离成本 * 距离） 之和 ≤ 调度预算
            self.model.addConstr(
                gp.quicksum(
                    self.n[i, j, t] * (
                            CostParameters.dispatch_fixed_cost +
                            CostParameters.rebalancing_unit_cost *
                            float(self.A_bike_network.get_edge_data(i, j)["distance"])
                    )
                    for (i, j) in self.A_bike_network.edges
                    for t in self.T
                ) <= self.Q_r,
                name="reb_budget_constraint"
            )

            # 每条边的调度流量不能超过对应的调度车辆数量 * 车辆容量
            self.model.addConstrs(
                (self.r[i, j, t] <= CAPACITY_REBALANCING_VEHICLE * self.n[i, j, t]
                 for (i, j) in self.A_bike_network.edges for t in self.T),
                name="reb_capacity_link"
            )

            # 调度车辆和建站决策联系起来
            N_ub = int(self.Q_r / CostParameters.dispatch_fixed_cost)  # 选项 A：预算上限

            # for (i, j) in self.A_bike_network.edges:
            #     for t in self.T:
            #         self.model.addConstr(
            #             self.n[i, j, t] <= N_ub * self.y[i],
            #             name=f"dispatch_activation_i_{i}_{j}_{t}"
            #         )
            #         self.model.addConstr(
            #             self.n[i, j, t] <= N_ub * self.y[j],
            #             name=f"dispatch_activation_j_{i}_{j}_{t}"
            #         )

        else:
            # Flow conservation: arc flow = path flows
            self.model.addConstrs(
                (self.f[i, j, t_fixed] ==
                 gp.quicksum(self.x_b[k, t, path] for k, t, path in self.x_b
                             if t == t_fixed and path in self.arc_to_paths[(i, j), "bike_only"]) +
                 gp.quicksum(self.x_pt[k, t, path] for k, t, path in self.x_pt
                             if t == t_fixed and path in self.arc_to_paths[(i, j), "bike_pt"])
                 for i, j, t_fixed in self.f),
                name="flow_conservation"
            )
    else:
        # For all bike-related modes (bike / bike+PT), iterate over corresponding arcs
        # and add station dependency constraints for bike arcs
        for alpha_variable, category in zip([self.alpha_b, self.alpha_pt], ["bike_only", "bike_pt"]):
            generate_path_station_dependency_path_based(self, category, alpha_variable)
        self.model.addConstrs(
            (self.f[i, j, t_fixed] == get_bike_flow(self.delta_ijr, self.x_pt, i, j, t_fixed)
             + get_bike_flow(self.delta_ijr, self.x_b, i, j, t_fixed)
             for i, j, t_fixed in self.f),
            name="flow_conservation"
        )

    # Constraints (6) inventory at time t = inventory at time t-1 - outbound flows + inbound flows
    # If only restricting t ≥ 0, initial inventory at stations will be forced to 0
    # (since variables at t = -1 are 0, no demand can be satisfied).
    self.model.addConstrs(
        (self.v[i, t] == self.v[i, t - 1] - gp.quicksum(self.f[i, j, t - 1] + self.r[i, j, t - 1]
                                                        for j in self.bike_outbound_station[i]) +
         gp.quicksum(self.f[j, i, t - 1] + self.r[j, i, t - 1]
                     for j in self.bike_inbound_station[i])
         for i, t in self.v if t >= 1),
        name="bike_balance"
    )

    # todo：保证了平衡 但求解速度异常大
    # self.model.addConstrs(
    #     (self.v[i, 0] == self.v[i, len(self.T)] for i in self.B),
    #     name="bike_cyclic_closure"
    # )

    # todo：保证站level的平衡 期末要回到期初状态
    # self.model.addConstrs(
    #     (self.v[i, 0] == self.v[i, len(self.T)]
    #      - gp.quicksum(self.r[i, j, len(self.T)] for j in self.bike_outbound_station[i])
    #      + gp.quicksum(self.r[j, i, len(self.T)] for j in self.bike_inbound_station[i])
    #      for i in self.B),
    #     name="bike_cyclic_closure"
    # )

    # Constraints (7) End-of-day inventory equals the initial inventory
    # todo：流量守恒的自动推论 去掉毫无影响
    # self.model.addConstr(
    #     (quicksum(self.v[i, 0] for i in self.B) == quicksum(self.v[i, len(self.T) - 1] for i in self.B)),
    #     name="stock_balance"
    # )

    # Constraints (8) Station storage capacity constraint: inventory at each station cannot exceed capacity
    # Add a dummy variable for the end-of-horizon inventory to ensure that arriving bikes have enough docks to park.
    self.model.addConstrs(
        (self.v[i, t] <= self.w[i] for i in self.B for t in list(self.T)+[self.demand_generator.time_periods]),
        name="storage_capacity"
    )

    # Constraints (10) Inventory-outbound constraint: station inventory at time t must cover all outbound bike flows
    self.model.addConstrs(
        (self.v[i, t] >= gp.quicksum(self.f[i, j, t] for j in self.bike_outbound_station[i])
         + gp.quicksum(self.r[i, j, t] for j in self.bike_outbound_station[i])
         for i in self.B for t in self.T),
        name="inventory_outbound_constraint"
    )
    # Constraints (*) Station capacity binding: if a station is built, it must have at least a minimum capacity
    # docking size upper bound aslo needs to be binded by y, but got negelected because
    # we put it in parameter configuration
    self.model.addConstrs(
        (self.w[i] >= MIN_CAPACITY_IF_BUILT * self.y[i] for i in self.B),
        name="station_capacity_binding"
    )

    self.model.addConstrs(
        (self.w[i] <= self.q_ub * self.y[i] for i in self.B),
        name="station_capacity_binding"
    )

    # Constraint (11) Total budget constraint
    self.model.addConstr(
        gp.quicksum(self.cs * self.y[i] for i in self.B) +
        gp.quicksum(self.cp * self.w[i] for i in self.B) +
        gp.quicksum(self.cu * self.v[i, 0] for i in self.B) <= self.Q,
        name="budget_constraint"
    )

    # for i in self.B:
    #     self.model.addConstr(self.v[i, 0] >= self.alpha * self.w[i], name=f"init_fill_lb_{i}")
    #     self.model.addConstr(self.v[i, 0] <= (1 - self.alpha) * self.w[i], name=f"init_fill_ub_{i}")


def generate_path_station_dependency_path_based(self, category, alpha_variable):
    for od_flow, path_instance_set in self.shortest_path_solver.categorized_paths[category].items():
        for path_id in path_instance_set:
            path = self.shortest_path_solver.id_path_map[path_id]  # 找到对应路径
            # 遍历路径中的所有arc
            for arc in path.arcs_traversed:
                if arc.mode == "Bike":
                    i, j = arc.start_node, arc.end_node  # 获取 bike arc 两端的站点
                    # 约束: sigma alpha_k,t,path <= self.T * y_i
                    # 修改变量构建规则后 有的 t 就的流向就不存在了 不能直接加
                    self.model.addConstr(
                        quicksum(alpha_variable[od_flow, t, path_id] for t in self.T if
                                 (od_flow, t, path_id) in alpha_variable) <= len(self.T) * self.y[i],
                        name="bike_station_dependency")
                    self.model.addConstr(
                        quicksum(alpha_variable[od_flow, t, path_id] for t in self.T if
                                 (od_flow, t, path_id) in alpha_variable) <= len(self.T) * self.y[j],
                        name="bike_station_dependency")


def get_bike_flow(delta_ijr, flow_variable, i, j, t_fixed):
    return gp.quicksum(
        delta_ijr[i, j, path] * flow_variable[k, t, path]
        for k, t, path in flow_variable if t == t_fixed)  # .select('*', t, '*'))
