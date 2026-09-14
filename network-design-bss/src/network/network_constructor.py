import numpy as np
import networkx as nx
from network.arc import Arc
from util.util import *
from collections import Counter
import itertools
from network.osmnx_network import NetworkBuilder


class NetworkConstructor:
    def __init__(self, initial_graph, grid_generator, public_transport,
                 bike_stations, ignore_walk_radius=False, consider_bike_network=True):
        self.graph = initial_graph.copy()
        self.grid_generator = grid_generator
        self.public_transport = public_transport
        self.bike_stations = bike_stations
        self.ignore_walk_radius = ignore_walk_radius  # 是否忽略步行半径 注意这只针对 walk  而不要影响其他的出行方式
        self.consider_bike_network = consider_bike_network  # whether considering bike network
        self.builder = NetworkBuilder()   # 用于计算实际的最短路径距离和时间 基于路网
        self._construct_walk_arcs()     # 包含了前往 bike station 的步行 arc，在初始 network 中应该剔除
        self._construct_public_transport_arcs()
        if self.consider_bike_network:
            self.bike_network = self._construct_bike_network()  # 单独记录一个 bike network 方便建模使用
            self._construct_bike_arcs()  # 需求点中心可以作为station潜在选址 则double了node的数目
        self._count_graph_elements()
        self.builder.save_sp_cache()

    def _construct_bike_network(self):
        bike_network = nx.DiGraph()
        for station in self.bike_stations:
            bike_network.add_node(station)
        return bike_network

    def _construct_walk_arcs(self):
        start_node_set = list(self.grid_generator.grid.nodes)  # 用列表存储遍历对象，不会动态变化
        pt_stops = list(itertools.chain.from_iterable(self.public_transport.pt_stops.values()))
        for idx, catchment_area_set in enumerate(
                [self.grid_generator.grid.nodes, self.bike_stations, pt_stops]):
            set_name = ["userOD", "bikeStation", "publicTransportStop"][idx]
            if (set_name == "bikeStation") and (not self.consider_bike_network):
                continue
            self.graph, arc_count = self.graph_update(start_node_set,
                                                      catchment_area_set,
                                                      WALK_CATCHMENT_RADIUS,
                                                      WALK_SPEED,
                                                      "Walk",
                                                      set_name)
            print(f"Grid center walks to {set_name} processed: {arc_count} arcs added.\n")

        # pt 到 bike station 的步行 arc
        if self.consider_bike_network:
            self.graph, arc_count = self.graph_update(pt_stops,
                                                      self.bike_stations,
                                                      WALK_CATCHMENT_RADIUS,
                                                      WALK_SPEED,
                                                      "Walk",
                                                      "bikeStation")
            print(f"PT stop walks to bike stations processed: {arc_count} arcs added.\n")

        # pt 同站或范围内换乘
        self.graph, arc_count = self.graph_update(pt_stops,
                                                  pt_stops,
                                                  WALK_CATCHMENT_RADIUS,
                                                  WALK_SPEED,
                                                  "Walk",
                                                  "publicTransportStop")

    def graph_update(self, start_node_set, catchment_node_set, catchment_radius, travel_speed, travel_mode, set_name):
        """
        :param start_node_set: 遍历的起始点集合
        :param catchment_node_set: 所有待计算的可达范围(用户起止点/单车站点/公共交通站点)
        :param catchment_radius: 区分步行/骑行
        :return:
        """
        arc_count = 0
        for start_node in start_node_set:
            if self.ignore_walk_radius:
                catchment_area, distance_accessing = start_node.calculate_catchment_area(float('inf'),
                                                                                         catchment_node_set)
            else:
                catchment_area, distance_accessing = start_node.calculate_catchment_area(catchment_radius,
                                                                                         catchment_node_set)

            for node, distance_ in zip(catchment_area, distance_accessing):
                if node not in self.graph.nodes:
                    self.graph.add_node(node, type=set_name)
                if not self.graph.has_edge(start_node, node, travel_mode):
                    # 只看起点和终点，不区分边的属性，因此若之前有 walk arc 则无法添加 bike arc 了
                    # travel_time = 60 * distance / travel_speed
                    # print("Previous distance & travel time", distance, travel_time)
                    distance, travel_time = self.builder.shortest_path_km_min(
                        mode=travel_mode,
                        lon1=round(start_node.coordinate[0], 5), lat1=round(start_node.coordinate[1], 5),
                        lon2=round(node.coordinate[0], 5), lat2=round(node.coordinate[1], 5)
                    )
                    # print("After that distance & travel time", distance, travel_time)
                    transfer_num = 1 if start_node.type != node.type else 0
                    if travel_mode == "Bike":
                        travel_time += BIKE_ACCESS_EGRESS_TIME
                        self._add_graph_edge(self.bike_network, start_node, node, travel_mode, distance, travel_time,
                                             transfer_num)
                    self._add_graph_edge(self.graph, start_node, node, travel_mode, distance, travel_time, transfer_num)
                    arc_count += 1
        return self.graph, arc_count

    def _construct_public_transport_arcs(self):
        """构造公共交通 arc"""
        for route_name, stops in self.public_transport.routes.items():
            for stop in stops:
                if stop.pt_attrs.next_stop is not None:
                    distance = stop.pt_attrs.next_stop_distance
                    # travel_time = 60 * stop.pt_attrs.next_stop_distance / PUBLIC_TRANSPORT_SPEED
                    travel_time = stop.pt_attrs.next_stop_travel_time / 60
                    self._add_graph_edge(self.graph, stop, stop.pt_attrs.next_stop, route_name, distance, travel_time,
                                         transfer_num=0)
        return self.graph

    def _construct_bike_arcs(self):
        """构造骑行 arc"""
        start_node_set = list(self.bike_stations)
        self.graph, arc_count = self.graph_update(start_node_set,
                                                  self.bike_stations,
                                                  RIDE_CATCHMENT_RADIUS,
                                                  RIDE_SPEED,
                                                  "Bike",
                                                  None)
        print(f"Biking processed: {arc_count} arcs added.\n")

    def _count_graph_elements(self):
        # 统计不同类型的节点数
        node_types = [self.graph.nodes[node].get("type", "unknown") for node in self.graph.nodes]
        node_count = Counter(node_types)  # PT 和 station 变成 unknown 了 需要新增此信息

        # 统计不同类型的 arc 数量
        arc_types = [
            ("PT" if data["arc"].mode.startswith("PT") else data["arc"].mode)
            for u, v, key, data in self.graph.edges(keys=True, data=True)
            if "arc" in data
        ]
        arc_count = Counter(arc_types)

        # 打印结果
        print("Node: ")
        for node_type, count in node_count.items():
            print(f"  - {node_type}: {count}")

        print("\n Arc:")
        for arc_type, count in arc_count.items():
            print(f"  - {arc_type}: {count}")

    def _add_graph_edge(self, graph, start_node, end_node, travel_mode, distance, travel_time, transfer_num):
        """ 通用函数：向 graph 添加双向边 """
        arc = Arc(travel_mode, start_node, end_node, distance, travel_time)

        graph.add_edge(start_node, end_node,
                       key=travel_mode,
                       arc=arc,
                       travel_time=travel_time,
                       distance=distance,
                       transfer=transfer_num)

        graph.add_edge(end_node, start_node,
                       key=travel_mode,
                       arc=Arc(travel_mode, end_node, start_node, distance, travel_time),
                       travel_time=travel_time,
                       distance=distance,
                       transfer=transfer_num)
