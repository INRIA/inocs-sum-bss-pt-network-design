import heapq
import networkx as nx


def dijkstra_with_arc_count(graph, source, target):
    # Step 1: 先找到最短 travel_time
    shortest_time_path = nx.shortest_path(graph, source=source, target=target, weight="travel_time", method="dijkstra")
    min_time = sum(graph[u][v]["travel_time"] for u, v in zip(shortest_time_path[:-1], shortest_time_path[1:]))

    # Step 2: 重新 Dijkstra 优化边数
    pq = [(0, 0, source, [])]  # (travel_time, edge_count, node, path)
    visited = {}

    while pq:
        time_cost, edge_count, node, path = heapq.heappop(pq)
        path = path + [node]

        # 找到目标点，返回最优路径
        if node == target and time_cost == min_time:
            return path

        # 如果当前状态已经访问过，且更优，则跳过
        if node in visited and visited[node] <= (time_cost, edge_count):
            continue
        visited[node] = (time_cost, edge_count)

        # 遍历邻居
        for neighbor in graph.neighbors(node):
            travel_time = graph[node][neighbor]["travel_time"]
            # todo: 此处 node 的比较无关紧要 但 node 类型无法比较
            heapq.heappush(pq, (time_cost + travel_time, edge_count + 1, neighbor, path))

    return shortest_time_path  # 没找到路径

