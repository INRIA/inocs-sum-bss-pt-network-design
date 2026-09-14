from collections import defaultdict

import numpy as np
import random
import matplotlib.pyplot as plt
import os
from util.util import *


class DemandGenerator:
    def __init__(self, grid_generator, public_transport, seed,
                 demand_type, time_period_weights, time_periods=TIME_PERIODS, precomputed_demand=None):
        """
        Initialize the DemandGenerator class.
        :param grid_generator: An instance of the GridGenerator class.
        :param seed: Random seed for reproducibility.
        """
        self.grid_generator = grid_generator
        self.public_transport = public_transport
        self.time_periods = time_periods
        self.demand_distribution_type = demand_type
        self.time_period_weights = time_period_weights
        self.nodes = list(grid_generator.grid.nodes(data=True))
        if seed is not None:
            self.seed = seed
            random.seed(seed)
            np.random.seed(seed)
        if not H3_BASED_GRID:
            self.demand_matrix = self._generate_demand_based_on_distribution()
        if precomputed_demand is not None:
            self.demand_matrix = precomputed_demand
            self.num_sampled_od_pairs = len(set([od for (od, t) in precomputed_demand.keys()]))
        self._compute_demand_matrix_statistics()

    def _experiment_demand(self):
        """
        Key factors for OD demand generation:
        - network_size: controls the spatial complexity of the network.
        - num_od_pairs: determines OD coverage (higher = broader travel patterns).
        - total_trips: defines the total travel demand to test system load.
        - demand_distribution: uses weighted OD sampling (e.g., PT-related OD has higher weight);
          zonal models can be used in realistic cases.
        - time_allocation: distributes demand across time periods (e.g., more demand during peak hours).
        :return:
        """
        # Step 1: all possible od pairs
        node_ids = [node[0] for node in self.nodes]
        all_od_pairs = [(i, j) for i in node_ids for j in node_ids if i != j]
        num_od = int(len(all_od_pairs) * self.od_coverage_ratio)
        rng = random.Random(21)
        # local random seed for reproducibility, investigate capacity under same network structure
        sampled_od_pairs = (rng.sample(all_od_pairs, num_od))

        # Step 2: 设置 PT 权重
        self.pt_stop_zones = set(
            [pt_stop.pt_attrs.zone for pt_stop in self.public_transport.coordinate_to_stop.values()])
        weights = []
        for origin, destination in sampled_od_pairs:
            if origin.node_id in self.pt_stop_zones or destination.node_id in self.pt_stop_zones:
                weights.append(2.0)  # PT stop 相关 OD 需求更大
            else:
                weights.append(0.5)

        # Step 3: 分配 total_trips 到 sampled_od_pairs
        od_distribution = random.choices(sampled_od_pairs, weights=weights, k=TOTAL_TRIPS_NUN / TIME_PERIODS)
        od_demand_base = defaultdict(int)
        for origin, destination in od_distribution:
            od_demand_base[(origin, destination)] += 1

        # Step 4: 将 OD trip 分配到多个 periods
        demand = defaultdict(int)
        for (origin, destination), demand_total in od_demand_base.items():
            time_slots = list(range(TIME_PERIODS))
            time_distribution = random.choices(time_slots, k=demand_total)
            for t in time_distribution:
                demand[(origin, destination, t)] += 1
        return demand

    def _generate_demand_based_on_distribution(self):

        od_demand_base = self.generate_od_demand_spatial_base()

        demand = self.generate_od_demand_temporal(od_demand_base)

        self.num_sampled_od_pairs = len(od_demand_base)

        return demand

    def generate_od_demand_temporal(self, od_demand_base, cache_dir=CACHED_DIR):
        """

        :param cache_dir:
        :param od_demand_base:
        :return:
        """
        os.makedirs(cache_dir, exist_ok=True)
        cache_path = os.path.join(cache_dir, f"od_demand_temporal_seed{self.seed}"
                                             f"_trips{self.total_trips}"
                                             f"_cov{self.od_coverage_ratio}"
                                             f"_{self.demand_distribution_type}"
                                             f"_{PT_STRUCTURE}.pkl")

        if os.path.exists(cache_path):
            with open(cache_path, "rb") as f:
                return pickle.load(f)

        if self.demand_distribution_type == 'unimodal':
            weights = generate_single_peak_weights(self.time_periods, 3)
        elif self.demand_distribution_type == 'uniform':
            weights = [1 / self.time_periods] * self.time_periods
        elif self.demand_distribution_type == 'bimodal':
            weights = generate_bimodal_weights(self.time_periods, 4)
        else:
            raise ValueError(f"Unsupported demand distribution type: {self.demand_distribution_type}")

        demand = {}
        for (origin_id, destination_id), total_demand in od_demand_base.items():
            time_slots = list(range(self.time_periods))  # 可能的时间段
            time_distribution = random.choices(time_slots, weights=weights, k=total_demand)

            for t in time_distribution:
                if self.demand_distribution_type in ["unimodal", "uniform"]:
                    od_key = get_random_direction_key(destination_id, origin_id)

                elif self.demand_distribution_type == "bimodal":
                    # 根据时段设置方向
                    if t == 0:
                        od_key = (origin_id, destination_id)
                    elif t == self.time_periods - 1:
                        od_key = (destination_id, origin_id)
                    else:
                        od_key = get_random_direction_key(destination_id, origin_id)

                key = (od_key, t)
                demand[key] = demand.get(key, 0) + 1

        with open(cache_path, "wb") as f:
            pickle.dump(demand, f)

        return demand

    def generate_od_demand_spatial_base(self, cache_dir=CACHED_DIR):
        """
        Generate spatial OD demand distribution based on coverage and PT structure.

        - A subset of OD pairs is randomly selected based on the specified OD coverage ratio.
        - An option is available to restrict the selection to unidirectional OD pairs only.
        - Spatial weights are assigned to candidate OD pairs according to proximity to PT stations.
        - The total number of trips is then distributed across the selected OD pairs.

        Parameters
        ----------
        cache_dir : str
            Path to the cache directory used for storing generated OD demand data.
        """
        os.makedirs(cache_dir, exist_ok=True)
        cache_path = os.path.join(cache_dir, f"od_demand_base_seed{self.seed}"
                                             f"_trips{self.total_trips}"
                                             f"_cov{self.od_coverage_ratio}"    
                                             f"_{PT_STRUCTURE}.pkl")

        if os.path.exists(cache_path):
            with open(cache_path, "rb") as f:
                return pickle.load(f)

        node_ids = [node[0] for node in self.nodes]
        # 只基于 OD 对（不含时间段）
        # 创建无重复方向的 OD 对（只保留 i < j）
        od_pairs_all = [(i, j) for i in node_ids for j in node_ids if i < j]
        num_od = int(len(od_pairs_all) * self.od_coverage_ratio)
        sampled_od_pairs = random.sample(od_pairs_all, num_od)

        # 识别 PT stops 所在的区域 (和需求在同一个 zone 的会增大权重)
        self.pt_stop_zones = set(
            [pt_stop.pt_attrs.zone for pt_stop in self.public_transport.coordinate_to_stop.values()])
        # **设置权重：如果 OD 连接 PT stops，权重更高**
        # todo: 后期拓展则不应该考虑 node_id，而要看所属于的 zone_id 和实现方式有关
        weights = []
        for origin, destination in sampled_od_pairs:
            if destination.node_id in self.pt_stop_zones:  # todo：首先只考虑终点是 pt 站点的情况
                weights.append(2.0)  # PT stop 相关 OD 需求更大
            else:
                weights.append(0.5)
        # **随机分配 period=1 时的需求**
        od_demand_base = {}
        od_distribution = random.choices(sampled_od_pairs, weights=weights, k=self.total_trips)
        # 统计每个 OD 对的总需求
        for origin, destination in od_distribution:
            key = (origin.node_id, destination.node_id)
            od_demand_base[key] = od_demand_base.get(key, 0) + 1

        with open(cache_path, "wb") as f:
            pickle.dump(od_demand_base, f)

        return od_demand_base

    def _split_demand(self):
        """
        生成 OD 需求矩阵，确保总流量为 self.total_trips，并随机分配到不同 OD 对和时间点。
        :return: 需求矩阵 {((origin, destination), t): demand_value}
        """
        node_ids = [node[0] for node in self.nodes]  # 提取所有节点 ID
        valid_od_pairs = [(i, j) for i in node_ids for j in node_ids if i != j]  # 生成所有 OD 组合
        # 生成所有可能的 (OD, time) 组合
        od_time_slots = [(od, t) for od in valid_od_pairs for t in range(self.time_periods)]

        # 识别 PT stops 所在的区域 (和需求在同一个zone的会增大权重)
        self.pt_stop_zones = set([pt_stop.zone for pt_stop in self.public_transport.coordinate_to_stop.values()])

        weights = []
        for (origin, destination), t in od_time_slots:
            if origin.node_id in self.pt_stop_zones or destination.node_id in self.pt_stop_zones:
                weights.append(2.0)  # PT stop 相关 OD 需求更大
            else:
                weights.append(0.5)

        # 使用 `random.choices()` 随机分配 `self.total_trips` 个 trip 到这些 slots
        demand_distribution = random.choices(od_time_slots, weights=weights, k=self.total_trips)

        demand = {}
        for (origin, destination), t in demand_distribution:
            key = ((origin.node_id, destination.node_id), t)
            demand[key] = demand.get(key, 0) + 1
        # for key, val in demand.items():
        #     print(key, val)
        # 统计每个时间 t 的总需求
        total_demand_per_t = defaultdict(int)

        for (od_pair, t), value in demand.items():
            total_demand_per_t[t] += value  # 累加所有 OD 对在 t 时刻的需求

        # 打印每个时间 t 的总需求
        for t, total in sorted(total_demand_per_t.items()):
            print(f"Time {t}: Total Demand = {total}")

        return demand

    def _compute_demand_weights(self):
        """
        Compute weights for each node based on proximity to the grid center.
        Center zones have higher weights, peripheral zones have lower weights.
        """
        length, width = self.grid_generator.length, self.grid_generator.width
        center_x, center_y = length // 2, width // 2
        weights = {}

        for node_id, data in self.nodes:
            x, y = data["coordinates"]
            # Calculate Euclidean distance to the grid center
            distance_to_center = np.sqrt((x - center_x) ** 2 + (y - center_y) ** 2)
            # Assign weight inversely proportional to the distance
            weights[node_id] = 1 / (0.1 + distance_to_center)

        return weights

    def generate_demand(self):
        """
        Generate a demand matrix based on the node weights.
        :return: A dictionary representing the OD demand {OD_pair: demand}.
        """
        weights = self._compute_demand_weights()
        weight_sum = sum(weights.values())

        # Normalize weights
        normalized_weights = {k: v / weight_sum for k, v in weights.items()}

        # Initialize demand dictionary
        demand = {}

        # Generate OD pairs and assign demand
        node_ids = [node[0] for node in self.nodes]  # Extract node IDs
        for i in node_ids:
            for j in node_ids:
                if i != j:  # Exclude self-loops
                    # Compute demand for the OD pair based on weights
                    for t in range(self.time_periods):
                        # 采用随机波动
                        random_factor = random.uniform(0.8, 1.2)  # allow 20% fluctuations
                        demand_prob = normalized_weights[i] * normalized_weights[j]
                        demand[(i.node_id, j.node_id), t] = int(self.total_trips * demand_prob * random_factor)
        # user_od_nodes = [node for node in self.nodes if node[1].get('type') == 'UserOD']
        return demand

    @classmethod
    def from_existing_demand(cls, *,
                             od_demand, grid_generator, public_transport, seed,
                             demand_type, time_periods, time_period_weights):
        # obj = cls(grid_generator, public_transport, seed, total_trips,
        #           demand_type, time_periods, od_demand)
        obj = cls(
            grid_generator=grid_generator,
            public_transport=public_transport,
            seed=seed,
            demand_type=demand_type,
            time_periods=time_periods,
            time_period_weights=time_period_weights,
            precomputed_demand=od_demand
            )
        return obj

    def _compute_demand_matrix_statistics(self):
        """
        直观感受下需求矩阵的统计信息，以此对比结果站点设置的合理性
        :return:
        """
        # 输出总需求数量
        self.total_trips = sum(self.demand_matrix.values())
        print(f"The total demand is {self.total_trips}.")
        # 提取所有出现过需求的 OD 对（忽略时间维度）
        od_pairs_with_demand = set([od for (od, t) in self.demand_matrix.keys()])
        num_active_od_pairs = len(od_pairs_with_demand)
        # print(f"Number of OD pairs with demand: {num_active_od_pairs}")

        # 每一期的总需求量
        period_demand = defaultdict(int)
        for ((origin, destination), t), count in self.demand_matrix.items():
            period_demand[t] += count

        # 打印每一期的需求量
        # for t in sorted(period_demand):
        #     print(f"Period {t}: total demand = {period_demand[t]}")

        # Step 1: 初始化每期的需求和活跃 OD 统计
        period_total_demand = defaultdict(int)
        period_active_od_pairs = defaultdict(set)

        # Step 2: 遍历所有 demand，统计每期总需求和有需求的 OD 数
        for ((origin, destination), t), count in self.demand_matrix.items():
            period_total_demand[t] += count
            period_active_od_pairs[t].add((origin, destination))

        # Step 3: 打印每期的需求量和活跃 OD 数占比
        for t in sorted(period_total_demand):
            total_demand = period_total_demand[t]
            active_od_count = len(period_active_od_pairs[t])
            ratio = total_demand / active_od_count if active_od_count > 0 else 0
            print(
                f"Period {t}: total demand = {total_demand}, active OD pairs = {active_od_count}, demand per OD = {ratio:.2f}")
        # for t in range(self.time_periods):
        #     plot_demand_heatmap(self.demand_matrix, self.nodes, period=t)


def get_random_direction_key(destination_id, origin_id):
    if random.random() < 0.5:
        od_key = (origin_id, destination_id)
    else:
        od_key = (destination_id, origin_id)
    return od_key
