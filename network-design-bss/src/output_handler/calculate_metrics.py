import numpy as np
from util.cost import CostParameters
from util.util import *
import pandas as pd


def calculate_metrics(self):
    """ 计算所需的评估指标 """
    selected_stations = [station for station in self.B if self.y[station].X == 1]
    # 1. 总建站成本
    total_setup_cost = sum(
        self.y[i].X * CostParameters.station_setup_cost +
        self.w[i].X * CostParameters.dock_cost +
        self.v[i, 0].X * CostParameters.unit_bike_cost
        for i in selected_stations
    )
    # 2. 站点间平均距离
    distances = [compute_distance(station_1.coordinate, station_2.coordinate)
                 for station_1 in selected_stations for station_2 in selected_stations if station_1 != station_2
                 ]
    avg_station_distance = np.mean(distances) if distances else 0

    # 3 & 4. 地铁区和非地铁区的站点数量 & 平均容量 todo：应该算距离 此处简化处理了
    subway_stations = [i for i in selected_stations if
                       int(i.node_id.split("-")[-1]) in self.demand_generator.pt_stop_zones]
    non_subway_stations = list(set(selected_stations) - set(subway_stations))

    subway_station_count = len(subway_stations)
    subway_avg_capacity = np.mean([self.w[i].X for i in subway_stations]) if subway_stations else 0

    non_subway_station_count = len(non_subway_stations)
    non_subway_avg_capacity = np.mean([self.w[i].X for i in non_subway_stations]) if non_subway_stations else 0

    # 5. 车辆利用率
    total_bike_trips = sum([flow.X for flow in self.f.values()])
    total_bikes = sum(self.v[i, 0].X for i in selected_stations)
    bike_utilization = total_bike_trips / total_bikes if total_bikes > 0 else 0

    # 6. 各模式的流量
    bike_mode_flow = sum([x_b.X for x_b in self.x_b.values()])
    pt_mode_flow = sum([x_pt.X for x_pt in self.x_pt.values()])
    walk_mode_flow = sum([x_w.X for x_w in self.x_w.values()])

    # 7. 用户平均出行时间（按模式）
    bike_mode_travel_time = sum(
        x_b.X * self.shortest_path_solver.id_path_map[path_id].total_time for (k, t, path_id), x_b in
        self.x_b.items()) / bike_mode_flow
    pt_mode_travel_time = sum(
        x_pt.X * self.shortest_path_solver.id_path_map[path_id].total_time for (k, t, path_id), x_pt in
        self.x_pt.items()) / pt_mode_flow
    walk_mode_travel_time = sum(
        x_w.X * self.shortest_path_solver.id_path_map[path_id].total_time for (k, t, path_id), x_w in
        self.x_w.items()) / walk_mode_flow

    # 8. OD 需求满足率
    total_fulfilled_demand = bike_mode_flow + pt_mode_flow + walk_mode_flow
    demand_satisfaction_rate = total_fulfilled_demand / TOTAL_TRIPS_NUN

    # 9. Primary Path Usage Rate
    primary_bike_mode_flow = sum(
        x_b.X for (k, t, path_id), x_b in
        self.x_b.items() if self.shortest_path_solver.path_ranking[path_id] == 1)
    primary_pt_mode_flow = sum(
        x_pt.X for (k, t, path_id), x_pt in
        self.x_pt.items() if self.shortest_path_solver.path_ranking[path_id] == 1)
    primary_walk_mode_flow = sum(
        x_w.X for (k, t, path_id), x_w in
        self.x_w.items() if self.shortest_path_solver.path_ranking[path_id] == 1)
    primary_path_trips = primary_bike_mode_flow + primary_pt_mode_flow + primary_walk_mode_flow
    primary_path_usage_rate = primary_path_trips / total_fulfilled_demand if total_bike_trips > 0 else 0

    # 汇总所有计算结果
    results = {
        "Budget": CostParameters.total_budget,
        "Total demand": TOTAL_TRIPS_NUN,
        "K": self.shortest_path_solver.k,
        "Penalty coefficient": PENALTY_COEFFICIENT,
        "Capacity upperbound": CAPACITY_UB,
        "Total Setup Cost": total_setup_cost,
        "Avg Station Distance": avg_station_distance,
        "Subway Station Count": subway_station_count,
        "Subway Avg Capacity": subway_avg_capacity,
        "Non-Subway Station Count": non_subway_station_count,
        "Non-Subway Avg Capacity": non_subway_avg_capacity,
        "Bike Utilization": bike_utilization,
        "Bike Only Flow": bike_mode_flow,
        "Bike PT Flow": pt_mode_flow,
        "Walk PT Flow": walk_mode_flow,
        "Avg Travel Time by Bike Only Mode": bike_mode_travel_time,
        "Avg Travel Time by Bike PT Mode": pt_mode_travel_time,
        "Avg Travel Time by Walk PT  Mode": walk_mode_travel_time,
        "Demand Satisfaction Rate": demand_satisfaction_rate,
        "Primary Path Usage Rate": primary_path_usage_rate,
    }

    df = pd.DataFrame([results])
    if os.path.exists(add_specific_cwd(OUTPUT_CSV_FILE, 'statistic_result')):
        df.to_csv(add_specific_cwd(OUTPUT_CSV_FILE, 'statistic_result'), mode='a', header=False, index=False)
    else:
        df.to_csv(add_specific_cwd(OUTPUT_CSV_FILE, 'statistic_result'), mode='w', header=True, index=False)

    return results
