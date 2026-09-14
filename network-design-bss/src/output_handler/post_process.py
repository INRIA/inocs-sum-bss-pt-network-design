import json
from pathlib import Path

from util.cost import CostParameters
from util.util import *


def save_selected_stations_geojson(self, file_name="selected_bike_stations.geojson",
                                   extra_fields=None, coord_attr="coordinate"):
    """
    把 y=1 的站点导出为 GeoJSON FeatureCollection。
    extra_fields: 需要额外写入 properties 的字段名列表（来自节点对象）
    coord_attr:   节点上保存经纬度的属性名，默认 'coordinate' -> (lon, lat)
    """
    extra_fields = extra_fields or []  # 例如 ["node_id", "name", "zone"]

    features = []
    for i in self.B:
        # 只导出被选址的站点
        if float(self.y[i].X) < 0.5:
            continue

        # 读取变量值
        y_val = float(self.y[i].X)
        v_val = float(self.v[i, 0].X)
        z_val = float(self.w[i].X)

        # 读取节点对象与坐标
        node = i if not isinstance(i, (str, int)) else self.node_lookup[i]  # 如果 B 里是 id，则通过你自己的索引获取节点
        lon, lat = getattr(node, coord_attr)

        # 组织 properties
        props = {
            "id": getattr(node, "node_id", str(i)),
            "y": y_val,
            "inventory": v_val,
            "capacity": z_val,
            "type": getattr(node, "type", "BikeStation"),
        }
        # 附加你想保留的节点字段（若存在）
        for f in extra_fields:
            if hasattr(node, f):
                props[f] = getattr(node, f)

        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": {
                "type": "Point",
                "coordinates": [float(lon), float(lat)]  # WGS84: [lon, lat]
            }
        })

    selected_stations_geojson = {
        "type": "FeatureCollection",
        "name": "selected_bike_stations",
        "crs": {"type": "name", "properties": {"name":"urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": features
    }

    save_geojson(features, selected_stations_geojson, file_name)


def post_process(self):
    print("\n✅ 选定的站点（y=1）及其初始库存 v 和容量 z：")
    for i in self.B:
        y_val = self.y[i].X  # 获取决策变量 y[i] 的最优值
        v_val = self.v[i, 0].X  # 获取初始阶段每个站点车辆
        z_val = self.w[i].X  # 获取容量

        if y_val == 1:
            print(f"🚲 站点 {i}: y = {y_val}, v(initial inventory) = {v_val}, z(capacity) = {z_val}")

    # total_y, total_v, total_z = map(sum, zip(*[(self.y[i].X, self.v[i, 0].X, self.w[i].X) for i in self.B if
    #                                            self.y[i].X == 1]))
    triples = [(self.y[i].X, self.v[i, 0].X, self.w[i].X)
               for i in self.B if self.y[i].X == 1]

    total_y, total_v, total_z = (tuple(map(sum, zip(*triples)))
                                 if triples else (0, 0, 0))

    # 打印
    print(f"\n✅ Total station mumber (y=1): {int(total_y)}")
    print(f"🔢 Total initial inventory (v): {int(total_v)}")
    print(f"📦 Total dock size (z): {int(total_z)}")
    print(f"✅ Objective value: {self.model.ObjVal}")

    cost = 0
    rebalancing_volume = 0
    for i, j in self.A_bike_network.edges:
        for t in self.T:
            # f_val = self.f[i, j, t].X
            # if abs(f_val) > 1e-6:  # 排除数值误差
            #     print(f"bike flow 流量 t={t}, edge ({i}->{j}): f = {f_val}")
            r_val = self.r[i, j, t].X
            if r_val > 0:
                distance = self.A_bike_network.get_edge_data(i, j)['distance']
                # print(f"Rebalancing value and distance from {i} to {j} at time {t} is:", r_val, distance)
                cost += distance * r_val * CostParameters.rebalancing_unit_cost
                rebalancing_volume += r_val
            # if i < j:
            #     r_val_abs = self.r_abs[i, j, t].X
            #     if r_val_abs > 0:
            #         r_val = self.r[i, j, t].X
            #         if r_val > 0:
            #             distance = self.A_bike_network.get_edge_data(i, j)['distance']
            #             print(f"Rebalancing value and distance from {i} to {j} at time {t} is:", r_val, distance)
            #         else:
            #             r_val = -self.r[i, j, t].X
            #             distance = self.A_bike_network.get_edge_data(j, i)['distance']
            #             print(f"Rebalancing value and distance from {j} to {i} at time {t} is:", r_val, distance)
            #         cost += distance * r_val * CostParameters.rebalancing_cost
            #         rebalancing_volume += r_val
    # total_rebalancing_volume = sum(self.r_abs[i, j, t].X for i, j in self.A_bike_network.edges if i < j for t in self.T)
    # total_rebalancing_volume = sum(self.r[i, j, t].X for i, j in self.A_bike_network.edges for t in self.T)
    # print("Total rebalancing cost is:", cost)
    print("Total rebalancing volume is:", rebalancing_volume, rebalancing_volume)

    for mode, x_flow in zip(["bike_only", "bike_pt", "walk_pt"], [self.x_b, self.x_pt, self.x_w]):
        # 计算 self.x_b 的总流量
        total_x_flow = sum(x_flow[k, t, path].X for k, t, path in x_flow)
        # 输出结果
        print(f"{mode} 总流量: {total_x_flow}")


def find_unmet_demand_od(self):
    # 计算每个 (k, t) 的实际流量
    total_flow = {}

    for flow_variable in [self.x_b, self.x_pt, self.x_w]:
        for (k, t, path), var in flow_variable.items():
            if (k, t) not in total_flow:
                total_flow[(k, t)] = 0
            total_flow[(k, t)] += var.X  # 取变量的最优解值

    # 计算未满足的需求
    unmet_demand = {}

    for (k, t), demand_value in self.demand_matrix.items():
        actual_flow = total_flow.get((k, t), 0)  # 获取实际流量，若无则为0
        unmet_demand[(k, t)] = demand_value - actual_flow  # 计算未满足的需求

    # 过滤出未满足需求的流向
    unmet_demand_filtered = {k_t: v for k_t, v in unmet_demand.items() if v > 0}

    # 输出结果
    # print("未满足的需求流向及其缺口：")
    # for (k, t), shortage in unmet_demand_filtered.items():
    #     print(f"流向 ({k}, {t}) 需求 {self.demand_matrix[(k, t)]}，实际分配 {total_flow.get((k, t), 0)}，缺口 {shortage}")


def load_gurobi_results(filename="gurobi_results.json"):
    """加载 Gurobi 变量求解结果"""
    # 获取当前文件路径
    current_path = Path(__file__).resolve()

    # 循环向上查找 .git 目录，找到项目根目录
    for parent in current_path.parents:
        if (parent / ".git").exists():
            project_root = parent
            break
    else:
        project_root = current_path.parent  # 如果没有 .git，就用上一级
    # 切换到项目根目录
    os.chdir(project_root)
    # 确保路径正确
    print("Project Root:", project_root)
    print("Current Working Directory:", os.getcwd())
    with open(add_output_cwd(filename), "r") as f:
        results = json.load(f)
    return results  # 返回字典格式的变量值


def analyze_gurobi_results(model):
    """ 解析 Gurobi 模型求解结果，提取 y=1 的站点、对应的 z（capacity）以及 x_b 的流量 """
    pass


if __name__ == '__main__':
    data = load_gurobi_results()
    analyze_gurobi_results(data)
    # print(data)



