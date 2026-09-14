from dataclasses import dataclass


@dataclass
class CostParameters:
    total_budget: int = 100000  # 总预算  3,000 - 10,000  单位统一用欧元
    operational_budget: int = 1000  # total_budget 20% - 40%
    operational_budget_ratio: float = 0.05    # 0.05  # 运营预算占总预算的比例
    station_setup_cost: int = 100  # 站点设置成本 500
    dock_cost: int = 20  # 每个停车位成本  20
    unit_bike_cost: int = 60  # 每辆车成本
    rebalancing_unit_cost: int = 20  # Unit rebalancing cost per bike per km between stations
    dispatch_fixed_cost: int = 40  # fixed cost of dispatching one rebalancing vehicle
    # dispatch_distance_cost: int = 2  # cost per distance unit for dispatching a rebalancing vehicle


