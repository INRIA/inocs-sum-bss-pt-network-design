import copy
import heapq
from collections import defaultdict
import math
from problem.path import Path
from network.arc import Arc
from util.util import *


def yen_k_shortest_paths(graph, source, target, k):
    # **1. 找到最短路径**
    shortest_path = dijkstra(graph, source, target)
    if not shortest_path:
        return []  # 没有可行路径

    A = [shortest_path]  # 存储 K 条最短路径
    B = []  # 候选路径集

    for i in range(1, k):
        for j in range(len(A[i - 1]) - 1):
            spur_node = A[i - 1][j]
            root_path = A[i - 1][:j + 1]

            # **2. 复制当前图并移除 root_path 中的边**
            temp_graph = copy.deepcopy(graph)
            for path in A:
                if path[:j + 1] == root_path:
                    # del temp_graph[path[j]][0]  # 移除该边
                    u, v = path[j], path[j + 1]  # 获取要删除的边
                    if temp_graph.has_edge(u, v):  # 确保边存在
                        temp_graph.remove_edge(u, v)

            # **3. 计算 spur_path（从 spur_node 到目标节点的最短路径）**
            spur_path = dijkstra(temp_graph, spur_node, target)

            if spur_path:
                total_path = root_path[:-1] + spur_path
                if total_path not in B:
                    heapq.heappush(B, (len(total_path), total_path))

        if not B:
            break

        # **4. 选择当前最短路径并加入 A**
        _, next_shortest = heapq.heappop(B)
        A.append(next_shortest)

    return A  # 返回 K 条最短路径


def dijkstra(graph, source, target):
    """ 自定义 Dijkstra 算法，考虑 travel_time + transfer 规则 """
    pq = []  # 优先队列 (travel_time, transfer, path)
    heapq.heappush(pq, (0, 0, [source]))
    best_paths = defaultdict(lambda: (math.inf, math.inf))  # 记录每个节点的最优路径

    while pq:
        travel_time, transfers, path = heapq.heappop(pq)
        current_node = path[-1]

        if current_node == target:
            return path  # 找到最短路径

        if best_paths[current_node] <= (travel_time, transfers):
            continue
        best_paths[current_node] = (travel_time, transfers)

        if current_node in graph:
            for neighbor, attributes in graph[current_node].items():
                arc = attributes.get('arc')  # 访问 Arc 对象
                if not arc:
                    continue
                neighbour = arc.end_node
                if neighbour == source:
                    continue

                arc_time = attributes.get('travel_time', float('inf'))
                arc_distance = attributes.get('distance', float('inf'))
                arc_transfer = attributes.get('transfer', 0)

                # 防止连续 `Bike → Bike` 连接**
                if len(path) > 1:
                    prev_node = path[-2]
                    prev_arc = graph[prev_node].get(current_node, {}).get('arc')
                    prev_mode = prev_arc.mode if prev_arc else None
                    if prev_mode == "Bike" and arc.mode == "Bike":
                        continue  # 跳过连续的 Bike 段

                # 计算新路径的 cost
                new_time = travel_time + arc_time
                new_transfers = transfers + arc_transfer

                heapq.heappush(pq, (new_time, new_transfers, path + [neighbour]))

    return None  # 没有找到路径


def yen_k_shortest_paths_multidigraph(graph, source, target, k):
    """
    Yen's K shortest paths for MultiDiGraph with full arc/mode/path tracking.
    Returns a list of Path objects.
    """
    shortest_path_obj = dijkstra_multigraph(graph, source, target)
    if not shortest_path_obj:
        return []

    A = [shortest_path_obj]
    B = []

    for i in range(1, k):
        for j in range(len(A[i - 1].path) - 1):
            spur_node = A[i - 1].path[j]
            root_path_nodes = A[i - 1].path[:j + 1]
            arcs_traversed = A[i - 1].arcs_traversed[:j]

            # 1. 拷贝图
            temp_graph = copy.deepcopy(graph)

            # 2. 移除 root_path 中所有重复的边
            for path_obj in A:
                if path_obj.path[:j + 1] == root_path_nodes:
                    u, v = path_obj.path[j], path_obj.path[j + 1]
                    if temp_graph.has_edge(u, v):
                        keys = list(temp_graph[u][v].keys())
                        for key in keys:
                            temp_graph.remove_edge(u, v, key=key)

            # 3. 计算 spur_path（从 spur_node 到 target 的路径 因此在这里面的一些规则筛选 可能不满足整体 path 的要求）
            spur_path_obj = dijkstra_multigraph(temp_graph, spur_node, target, arcs_traversed)

            if spur_path_obj:
                # 构建新 path 对象
                # 前一段 root path 剔除掉最后一个(spur_node)
                new_path_nodes = root_path_nodes[:-1] + spur_path_obj.path
                new_arcs = A[i - 1].arcs_traversed[:j] + spur_path_obj.arcs_traversed
                new_modes = A[i - 1].modes[:j] + spur_path_obj.modes
                # new_total_time = sum(arc.travel_time for arc in new_arcs)
                new_total_time = generalized_time_from_arcs(new_arcs)
                new_total_distance = sum(arc.distance for arc in new_arcs)

                new_path_obj = Path(
                    source=source,
                    target=target,
                    path=new_path_nodes,
                    arcs_traversed=new_arcs,
                    total_time=new_total_time,
                    total_distance=new_total_distance,
                    modes=new_modes
                )

                if new_path_nodes not in [p.path for _, p in B] and new_path_nodes not in [p.path for p in A]:
                    if is_valid_path(new_path_obj, max_bike_legs=2):
                        heapq.heappush(B, (new_total_time, new_path_obj))

        if not B:
            break

        _, next_shortest = heapq.heappop(B)
        A.append(next_shortest)

    return A  # List[Path]


def dijkstra_multigraph(graph, source, target, root_path_nodes=None):
    """
    Modified Dijkstra algorithm for MultiDiGraph.
    Tracks full path info and returns a Path object.
    root_path_nodes: Optional list of nodes to avoid consecutive Bike → Bike segments.
    """

    # priority queue: (travel_time, transfers, path, arcs, modes)
    pq = []
    heapq.heappush(pq, (0, 0, ([source], [], [])))
    best_paths = defaultdict(lambda: (math.inf, math.inf))

    while pq:
        travel_time, transfers, (path, arcs_traversed, modes) = heapq.heappop(pq)
        current_node = path[-1]

        if current_node == target:
            # 不带 walk_arc 的情况
            return build_path_if_valid(source, target, path, arcs_traversed,
                                       travel_time, modes)

        # If current_node has same coordinates as target, create a zero-time Walk arc.
        if current_node.coordinate == target.coordinate:
            # 创建虚拟 Walk arc
            walk_arc = Arc(
                start_node=current_node,
                end_node=target,
                travel_time=0,
                distance=0,
                mode="Walk"
            )
            return build_path_if_valid(source, target, path, arcs_traversed,
                                       travel_time, modes, walk_arc=walk_arc)

        if best_paths[current_node] <= (travel_time, transfers):
            continue
        best_paths[current_node] = (travel_time, transfers)

        if current_node in graph:
            for neighbor in graph[current_node]:
                for key in graph[current_node][neighbor]:
                    data = graph[current_node][neighbor][key]
                    arc = data.get('arc')
                    if not arc:
                        continue
                    neighbour = arc.end_node
                    if neighbour == source:
                        continue

                    # Intermediate nodes are restricted to functional nodes only;
                    # OD-type nodes can only appear as origins or destinations.
                    if neighbour.type == "userOD" and not neighbour == target:
                        continue

                    arc_time = data.get('travel_time', float('inf'))
                    arc_transfer = data.get('transfer', 0)

                    root_last_arc = root_path_nodes[-1] if root_path_nodes else None
                    prev_arc = arcs_traversed[-1] if arcs_traversed else root_last_arc

                    # Avoid consecutive Bike → Bike segments
                    if arcs_traversed:
                        prev_arc = arcs_traversed[-1]
                        if prev_arc.mode == "Bike" and arc.mode == "Bike":
                            continue

                    # 拼接的前一段和后一段不能都是 Bike
                    if root_path_nodes:
                        if root_path_nodes[-1].mode == "Bike" and arc.mode == "Bike":
                            continue
                    wait_extra = additional_wait_s(prev_arc, arc)
                    new_time = travel_time + arc_time + wait_extra
                    new_transfers = transfers + arc_transfer
                    new_path = path + [neighbour]
                    new_arcs = arcs_traversed + [arc]
                    new_modes = modes + [arc.mode]

                    heapq.heappush(pq, (
                        new_time,
                        new_transfers,
                        (new_path, new_arcs, new_modes)  # 放到 tuple 里，也没法避免直接参与比较...
                    ))

    return None
