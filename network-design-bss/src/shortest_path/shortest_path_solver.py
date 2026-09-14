# import networkit as nk
from collections import defaultdict

import networkx as nx
from shortest_path.yen_k_shortest_path import yen_k_shortest_paths, yen_k_shortest_paths_multidigraph
from shortest_path.path_assessment import compute_alpha_values
from problem.path import Path
from shortest_path.shortest_path_with_minimum_transfer import dijkstra_with_arc_count
from util.util import *
from tqdm import tqdm


class ShortestPathSolver:
    def __init__(self, network, k, flag, shortest_path_benchmark=None, max_modes=10, detour_ratio=DETOUR_RATIO):
        """
        :param network:  输入的 NetworkX 图
        :param k:  最多寻找 k 阶最短路径
        :param max_modes:  允许的最大模式数
        :param detour_ratio:  迂回比阈值，大于该比例的路径将被排除
        """
        self.graph = network
        self.k = k
        self.flag = flag
        self.shortest_path_benchmark = shortest_path_benchmark
        self.max_modes = max_modes  # inactive
        self.detour_ratio = detour_ratio
        self.userOD_nodes = [node for node, data in network.nodes(data=True) if data.get("type") == "userOD"]
        self.userOD_nodes = self.userOD_nodes  # debug
        self.shortest_paths_cache = {}  # (source, target) -> shortest path
        (self.shortest_path, self.categorized_paths, self.id_path_map,
         self.feasible_od_pairs, self.mode_counts, self.path_ranking) = self.find_k_shortest_paths()

    def _is_valid_path(self, path):
        """ 检查路径是否符合模式转换规则 """
        mode_sequence = []
        for i in range(len(path.path) - 1):
            u, v = path.path[i], path.path[i + 1]
            if self.graph.has_edge(u, v):
                # MultiDiGraph
                for edge_data in self.graph[u][v].values():
                    arc = edge_data.get("arc", None)
                    if arc:
                        mode_sequence.append(arc.mode)
                        break
                # DiGraph
                # arc = self.graph.edges[u, v].get("arc", None)
                # if arc:
                #     mode_sequence.append(arc.mode)

        # allow pt connection or walk connection, but not bike connection
        for i in range(len(mode_sequence) - 1):
            if ((not mode_sequence[i].startswith("PT") and mode_sequence[i] != "Walk")
                    and mode_sequence[i] == mode_sequence[i + 1]):
                return False

        # 模式总数不能超过 max_modes
        # if len(set(mode_sequence)) > self.max_modes:
        #     return False

        return True

    def find_k_shortest_paths(self):
        """ 计算所有 userOD 节点间的 k 阶最短路径 """

        filename = f"shortest_paths_cache_size{AREA_LENGTH}_k{self.k}_{FIXED_LINE_POINTS_LST}_{self.flag}.pkl"
        full_path = os.path.join(SAVE_DIR, filename)
        if os.path.exists(full_path):
            print(f"✅ Found file '{filename}', loading...")
            data = load_results_from_pickle(filename)
            all_paths = data["all_paths"]
            categorized_paths = data["categorized_paths"]
            id_path_map = data["id_path_map"]
            feasible_od_pairs = data["feasible_od_pairs"]
            mode_counts = data["mode_counts"]
            path_ranking = data["path_ranking"]
            # path_alpha_values = data["path_alpha_values"]
            return (all_paths, categorized_paths, id_path_map, feasible_od_pairs,
                    mode_counts, path_ranking)

        all_paths = {}
        feasible_od_pairs = []
        mode_counts = defaultdict(int)
        id_path_map = dict()
        categorized_paths = {
            "bike_only": defaultdict(list),
            "bike_pt": defaultdict(list),
            "walk_pt": defaultdict(list)
        }
        path_ranking = {}
        for source in tqdm(self.userOD_nodes, desc="Processing user OD nodes"):
            for target in self.userOD_nodes:
                if source == target:
                    continue

                # 使用 Yen's Algorithm 计算 k 最短路径
                if nx.has_path(self.graph, source, target):
                    # debug
                    if DEBUG_SHORTEST_COORDINATES:  # 非空列表才会进入
                        src_coord, tgt_coord = DEBUG_SHORTEST_COORDINATES
                        if not (source.coordinate == src_coord and target.coordinate == tgt_coord):
                            continue

                    # DiGraph
                    # k_shortest_paths = yen_k_shortest_paths(self.graph, source, target, self.k)

                    # MultiDiGraph graph[u][v][key] -> dict of edge attributes
                    k_shortest_paths = yen_k_shortest_paths_multidigraph(self.graph, source, target, self.k)
                else:
                    continue

                valid_paths = []
                idx = 1
                theoretical_optimal_time = float("inf")

                for path in k_shortest_paths:
                    # debug
                    # if source.coordinate == (0.5, 0.5) and target.coordinate == (2.5, 5.5):
                    #     print()

                    total_time = path.total_time
                    total_distance = path.total_distance

                    # cannot be worse than the shortest path before introducing bike stations
                    shortest_path_time_gain = 0
                    if self.shortest_path_benchmark:
                        benchmark_path = next(iter(self.shortest_path_benchmark.shortest_path[source, target]))
                        # compute time improvement by introducing bike stations
                        shortest_path_time_gain = benchmark_path.total_time - total_time
                        if total_time > benchmark_path.total_time:   # 最短路结果为 list 因此需要访问第一个元素
                            continue

                    # Suboptimal paths should not deviate too much from the theoretical optimal time.
                    theoretical_optimal_time = min(theoretical_optimal_time, total_time)
                    if total_time - theoretical_optimal_time > self.detour_ratio * theoretical_optimal_time:
                        continue

                    # 模式转换检查
                    if not self._is_valid_path(path) and self.flag == "after":
                        continue

                    # DiGraph
                    # arcs_traversed = [self.graph.edges[path[i], path[i + 1]]["arc"] for i in range(len(path) - 1)]
                    # MultiDiGraph
                    arcs_traversed = path.arcs_traversed
                    modes = [arc.mode for arc in arcs_traversed]
                    modes_set = set(modes)

                    path_instance = Path(source, target, path, arcs_traversed,
                                         total_time, total_distance, modes, shortest_path_time_gain)

                    # Note: Invalid paths should not be included in id→path and categorized_paths mappings,
                    # o.w. leading to incorrect flow assignment. Better to filter shortest valid paths first,
                    # then build dictionaries for clarity.
                    valid_paths, keep_flag, replaced_path = add_valid_path(valid_paths, path_instance)

                    # od 到 对应 path 的映射字典
                    all_paths[(source, target)] = valid_paths

                    if keep_flag:
                        if replaced_path:
                            # 删除旧 path 的记录
                            del id_path_map[replaced_path.id]
                            idx_incumbent = path_ranking[replaced_path.id]
                            del path_ranking[replaced_path.id]  # todo: 实际上把 rank 为1 的替掉了，最终留了 2， idx 3-1 于是有了俩 2
                            remove_from_categorized(categorized_paths, (source.node_id, target.node_id),
                                                    replaced_path.id)
                            # path_ranking = remove_path_from_ranking(path_ranking, replaced_path.id)
                            # idx -= 1
                            path_ranking[path_instance.id] = idx_incumbent
                        else:
                            # id 到 ranking 的映射
                            # path_ranking[path_instance.id] = len(path_ranking) + 1 ❌ path ranking 应该是对每个 od 对
                            # 来说对，而不是整体来比较的 比把序号递增的
                            path_ranking[path_instance.id] = idx
                            idx += 1

                        feasible_od_pairs.append((source.node_id, target.node_id))
                        mode_counts[str(modes_set)] += 1

                        # id 到 path 的映射
                        id_path_map[path_instance.id] = path_instance

                        # 类型到 path 集合的映射字典
                        if modes_set.issubset({"Bike", "Walk"}) and "Bike" in modes_set:
                            categorized_paths["bike_only"][(source.node_id, target.node_id)].append(path_instance.id)
                        elif any("PT" in mode for mode in modes_set) and "Bike" in modes_set:
                            categorized_paths["bike_pt"][(source.node_id, target.node_id)].append(path_instance.id)
                        else:
                            categorized_paths["walk_pt"][(source.node_id, target.node_id)].append(path_instance.id)

        print("Quantity of multi-modal trips:")
        for mode, count in mode_counts.items():
            print(f"  - {mode}: {count}")

        total_od_pairs = len(self.userOD_nodes) * (len(self.userOD_nodes) - 1)
        disconnected_ratio = (total_od_pairs - len(all_paths)) / total_od_pairs

        print("------------------")
        print(f"Proportion of disconnected OD pairs: {disconnected_ratio:.4f}")
        print("------------------")

        # path_alpha_values 放到外部计算 则不必每次改参数都重新计算最短路
        results = {
            "all_paths": all_paths,
            "categorized_paths": categorized_paths,
            "id_path_map": id_path_map,
            "feasible_od_pairs": feasible_od_pairs,
            "mode_counts": mode_counts,
            "path_ranking": path_ranking
        }

        save_results_to_pickle(filename, results)
        print("✅ The shortest path calculation is complete and has been stored in the cache file!")

        return (all_paths, categorized_paths, id_path_map, feasible_od_pairs,
                mode_counts, path_ranking)


def remove_from_categorized(categorized_paths, od_pair, path_id):
    for mode in ["bike_only", "bike_pt", "walk_pt"]:
        if path_id in categorized_paths[mode].get(od_pair, []):
            categorized_paths[mode][od_pair].remove(path_id)


def remove_path_from_ranking(path_ranking, removed_id):
    if removed_id not in path_ranking:
        return
    old_idx = path_ranking.pop(removed_id)
    for pid, rank in path_ranking.items():
        if rank > old_idx:
            path_ranking[pid] = rank - 1
    return path_ranking
