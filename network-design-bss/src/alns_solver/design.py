"""
Design representation: which candidate stations are open. w[i]/v1[i] are
NOT part of the search space -- the oracle jointly optimises them for
whatever y is currently proposed.
"""
from util.cost import CostParameters
from util.util import CAPACITY_UB


def typical_station_cost():
    """Budget consumed by one station at a *realistic* fill level, not the
    bare minimum. Using MIN_CAPACITY_IF_BUILT here would make nearly every
    subset of the 105 candidates "affordable" (opening all of them at floor
    capacity is cheap), collapsing repair operators onto "always open
    everything" and hiding the real few-big-stations vs many-small-stations
    tradeoff the objective actually cares about. Every solved instance seen
    in practice fills most opened stations to (or near) full capacity
    (v1 ~= w ~= CAPACITY_UB), so that is the realistic proxy, not the floor.
    """
    return (
        CostParameters.station_setup_cost
        + CostParameters.dock_cost * CAPACITY_UB
        + CostParameters.unit_bike_cost * CAPACITY_UB
    )


def realized_avg_station_cost(result):
    """Average per-station budget actually spent (cs + cp*w + cu*v1) in the
    last oracle result, for stations the oracle chose to open. Reading this
    from a real solve (instead of always assuming full capacity) lets repair
    operators size their "how many more can I afford" estimate to match what
    the oracle actually tends to build, not a static guess."""
    if not result or not result.feasible:
        return None
    opened = [s for s in result.w if result.w.get(s, 0) > 1e-6]
    if not opened:
        return None
    total = sum(
        CostParameters.station_setup_cost
        + CostParameters.dock_cost * result.w[s]
        + CostParameters.unit_bike_cost * result.v1.get(s, 0.0)
        for s in opened
    )
    return total / len(opened)


def design_lower_bound_cost(design, unit_cost=None):
    unit_cost = unit_cost if unit_cost is not None else typical_station_cost()
    return len(design) * unit_cost


def feasible_to_add(design, station, budget, unit_cost=None):
    """Cheap necessary (not sufficient) budget check used by repair operators
    to skip stations that can't plausibly fit -- the oracle is still the
    source of truth for real feasibility (it can always shrink w/v1)."""
    return design_lower_bound_cost(design | {station}, unit_cost) <= budget
