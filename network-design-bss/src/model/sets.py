from collections import defaultdict


def set_sets(self):
    """ 定义集合 """
    self.I = self.shortest_path_solver.userOD_nodes  # 所有区域
    self.K = list(set(self.shortest_path_solver.feasible_od_pairs))  # 可行od对 若不连通 则没必要讨论demand
    # self.J = self.network.public_transport.pt_stops  # PT 站点，我们这变成了字典 因此这样表示只是线路名
    self.J = {node.node_id for nodes in self.network.public_transport.pt_stops.values() for node in nodes}
    self.B = self.network.bike_stations
    self.A_bike_network = self.network.bike_network
    self.bike_outbound_station, self.bike_inbound_station = get_station_neighbors(self)
    # self.B = list(station.node_id for station in self.network.bike_stations)  # BS 站点
    self.M1, self.M2, self.M3 = get_paths_by_type_od(self)
    self.T = range(self.demand_generator.time_periods)  # 运行周期 add dummy period -1
    self.T_1 = range(self.demand_generator.time_periods + 1)
    print("=== Sets Initialization Completed ===")
    print(f"Total OD pairs (K): {len(self.K)}")
    print(f"Total Bike Stations (B): {len(self.B)}")
    # print(f"Total Public Transport Stops (J): {len(self.J)}")
    # 路径集合只考虑和 pt 有关的 默认了 bike only 模式的路径可以唯一表达 此处我们考虑字典，
    # 表示每个od的某种 mode 的可选 path 集合
    # 本质上只关心 R 的若干路径即可 具体那种 mode 其实不重要
    # self.R = {k: self.shortest_path_solver.shortest_path[k] for k in self.K}  # 可行路径


def get_paths_by_type_od(self):
    """
    od 到 对应 path 的映射字典 转为 mode 类型到 path 的字典
    索引应尽量使用简单的数据类型（如整数、字符串、元组等），而不是复杂的对象
    因此最好能给 path 编号，但又能通过索引找到对应信息

    :return: 每种类型 每个od对tuple和对应的path的嵌套字典
    """
    categorized_paths = self.shortest_path_solver.categorized_paths
    return categorized_paths.get("bike_only"), categorized_paths.get("bike_pt"), categorized_paths.get("walk_pt")


def get_station_neighbors(self):
    self.bike_outbound_station = defaultdict(set)  # 出边邻居
    self.bike_inbound_station = defaultdict(set)
    for i, j in self.A_bike_network.edges:
        self.bike_outbound_station[i].add(j)  # i 指向 j，j 是 i 的后续节点
        self.bike_inbound_station[j].add(i)
    return self.bike_outbound_station, self.bike_inbound_station

