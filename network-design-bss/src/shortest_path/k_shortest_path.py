import heapq
from typing_extensions import deprecated

import networkx as nx
from util.util import *


@deprecated
def yen_k_shortest_paths(graph, source, target, k, weight=custom_weight):
    """
    @deprecated: This class is deprecated. Use `NewClass` instead.
    使用 Yen's 算法求 K 条最短路径
    :param graph: NetworkX 图
    :param source: 起点
    :param target: 终点
    :param k: 需要找到的最短路径数量
    :param weight: 边权重，默认为 "weight"，可以传入自定义权重函数
    :return: K 条最短路径的列表，每条路径是一个节点列表
    """
    # 1️⃣ 计算第一条最短路径（Dijkstra）
    shortest_path = nx.shortest_path(graph, source, target, weight=weight, method="dijkstra")
    # todo：重复了 能否算一遍就得出 path 和 cost
    shortest_path_cost = nx.shortest_path_length(graph, source, target, weight=weight, method="dijkstra")

    total_time = sum(
        graph.edges[shortest_path[i], shortest_path[i + 1]]["arc"].travel_time for i in range(len(shortest_path) - 1))
    total_distance = sum(
        graph.edges[shortest_path[i], shortest_path[i + 1]]["arc"].distance for i in range(len(shortest_path) - 1))

    arcs_traversed = [graph.edges[shortest_path[i], shortest_path[i + 1]]["arc"] for i in range(len(shortest_path) - 1)]
    modes = [arc.mode for arc in arcs_traversed]

    # 初始化路径集合
    shortest_paths = [(shortest_path_cost, shortest_path)]
    potential_paths = []

    # 2️⃣ 开始 Yen’s 算法迭代
    for i in range(1, k):
        last_path = shortest_paths[-1][1]  # 取当前最优路径

        # 遍历路径上的每个节点作为偏移点
        for j in range(len(last_path) - 1):
            spur_node = last_path[j]  # 偏移点
            root_path = last_path[:j + 1]  # 取到偏移点的路径

            # 备份删除的边
            removed_edges = []

            for path_cost, path in shortest_paths:
                if path[:j + 1] == root_path and len(path) > j + 1:
                    # 移除 root_path 下的分支路径
                    u, v = path[j], path[j + 1]
                    if graph.has_edge(u, v):
                        # todo: weight 定义方式  权重还是必不可少的 需要适配 ！！！
                        edge_weight = weight(u, v, graph[u][v])

                        # arc = Arc()

                        # self.graph.add_edge(start_node, node,
                        #                     arc=Arc(travel_mode, start_node, node, distance, travel_time),
                        #                     travel_time=travel_time,  # 直接存储 travel_time
                        #                     distance=distance,
                        #                     transfer=1
                        #                     )

                        removed_edges.append((u, v))  #  attrs["travel_time"] + 0.0000001 * attrs["transfer"]
                        graph.remove_edge(u, v)

            # 计算 spur_node 到 target 的最短路径
            try:
                spur_path = nx.shortest_path(graph, spur_node, target, weight=weight, method="dijkstra")
                spur_cost = nx.shortest_path_length(graph, spur_node, target, weight=weight, method="dijkstra")

                total_path = root_path[:-1] + spur_path  # 合并 root_path 和 spur_path
                total_cost = sum(graph[u][v][weight] for u, v in zip(total_path, total_path[1:]))

                # 只存入**新路径**
                if (total_cost, total_path) not in potential_paths:
                    heapq.heappush(potential_paths, (total_cost, total_path))
            except nx.NetworkXNoPath:
                pass  # 如果没有路径，跳过

            # 还原被删除的边
            for u, v in removed_edges:
                # graph.add_edge(u, v, **{"travel_time": , "transfer": 1})
                graph.add_edge(u, v)  # 修正：使用 "weight" 作为键

                # 如果没有新的可行路径，则终止
        if not potential_paths:
            break

        # 取出当前最优的候选路径
        next_best_cost, next_best_path = heapq.heappop(potential_paths)
        shortest_paths.append((next_best_cost, next_best_path))

    return [path for cost, path in shortest_paths]  # 仅返回路径，不返回权重
