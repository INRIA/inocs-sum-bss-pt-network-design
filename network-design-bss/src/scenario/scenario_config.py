from dataclasses import dataclass


@dataclass(frozen=True)
class DemandConfig:
    seed: int
    demand_periods: int
    period_weights: tuple[float, ...]
    # total OD demand is stochastically distributed across time periods using a multinomial allocation scheme.
    split_method: str
    # Multiplier applied to the raw od.csv flow before period-splitting.
    # 1.0 = observed/IPF-fitted demand as-is; >1.0 scales every OD flow up
    # proportionally (a uniform demand-growth scenario).
    demand_scale: float = 1.0


@dataclass(frozen=True)
class BudgetConfig:
    total_budget: int
    op_budget_ratio: float

    @property
    def op_budget(self) -> float:
        return self.total_budget * self.op_budget_ratio


@dataclass(frozen=True)
class ScenarioConfig:
    name: str
    demand_config: DemandConfig
    budget_config: BudgetConfig






