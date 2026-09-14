import numpy as np


def compute_alpha_values(all_paths, path_ranking, time_sensitivity, risk_tolerance):
    """
    计算每条路径的 alpha 值，并返回包含 alpha 的路径信息。

    参数：
    - categorized_paths: dict { (o, d): [path_1, path_2, ...] }，表示每个 OD 对的 k 条最短路
    - path_ranking: dict { path_id: rank }，表示每条路径在自己 OD 对中的排名
    - T: 时间调节因子，默认为 30
    - gamma: 风险容忍度，默认为 0.8

    返回：
    - path_alpha_values: dict { path_id: alpha }，每条路径的 alpha 值
    """
    path_alpha_values = {}

    for (o, d), paths_lst in all_paths.items():
        # 获取该 OD 对下所有路径的出行时间
        sorted_paths = sorted(paths_lst, key=lambda p: path_ranking[p.id])  # 按照 ranking 排序
        shortest_time = sorted_paths[0].total_time  # 最短路径 travel time
        path_alpha_values[sorted_paths[0].id] = 0  # 最短路径 alpha = 0

        for path in sorted_paths[1:]:  # 从第二条路径开始计算 alpha
            ti = path.total_time
            # todo：不严格大于 0 若取 0 不就相当于和最好路径效果一样了？因此有问题
            # todo: 必须有足够平滑合理的曲线刻画这个关系
            alpha = max(0, ((ti - shortest_time) / (1 - risk_tolerance)) - shortest_time - time_sensitivity)
            path_alpha_values[path.id] = alpha
    return path_alpha_values
