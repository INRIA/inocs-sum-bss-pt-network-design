"""
Destroy/repair operators over a Design (frozenset of open station objects).

w[i]/v1[i] are never part of the search space (see alns_solver/design.py):
given a fixed y, the oracle solves that residual sub-problem exactly in
tens of milliseconds, so there's nothing for a heuristic to gain by
guessing capacities too. What repair operators DO need from that sub-solve
is its *realized* per-station value (station_flow) and cost (w/v1) --
scoring insertion candidates purely by static path-centrality (structural,
oracle-free) ignores which stations the oracle actually found worth
building up, which is what let earlier search runs stagnate on a
locally-good-looking but globally weak design. combined_station_score
blends the static prior (used before any solve exists, and as a tie-
breaker for stations never yet opened) with the realized signal once one
is available.
"""
import random

from util.util import compute_distance
from alns_solver.design import feasible_to_add, realized_avg_station_cost


def _path_values(context):
    """value(path) = (1 - penalty*rank) * total_demand(path), mirroring
    set_weighted_multi_objective's own path-value formula -- shared by
    build_station_score and the max-coverage greedy construction below."""
    path_ids = {pid for (_station, _cat), pids in context.node_to_paths.items() for pid in pids}
    id_path_map = context.shortest_path_solver.id_path_map
    values = {}
    for path_id in path_ids:
        path = id_path_map[path_id]
        demand = sum(
            context.demand_matrix.get(((path.source.node_id, path.target.node_id), t), 0)
            for t in context.T
        )
        rank = context.pi_kr.get(path_id, 0)
        weight = max(0.0, 1.0 - context.penalty_coefficient * rank)
        values[path_id] = weight * demand
    return values


def build_station_score(context):
    """Demand-weighted structural prior: how much of the objective's own
    (1 - penalty*rank)*flow reward could plausibly flow through this
    station, summed over every bike-network path that touches it. This
    mirrors set_weighted_multi_objective's own path-value formula instead of
    counting paths (a station covering many low-demand short paths used to
    outscore one covering a handful of high-demand ones -- the wrong way
    round). Only used before any oracle result exists, or as a tie-breaker
    for stations that have never been opened (see combined_station_score).

    This treats each station's value as independent of which OTHER stations
    are open -- it doesn't see that a bike_pt path typically needs several
    bike stations open simultaneously (constraint (4)'s station-gating; a
    path needs 2-6 stations open at once here, average ~3.3) before it
    contributes anything. build_coverage_structures/max_coverage_greedy
    below model that coupling directly."""
    path_value = _path_values(context)
    score = {station: 0.0 for station in context.B}
    for (station, _category), pids in context.node_to_paths.items():
        if station not in score:
            continue
        for path_id in pids:
            score[station] += path_value.get(path_id, 0)
    return score


def build_coverage_structures(context):
    """Precompute what max_coverage_greedy needs: each path's value, how
    many distinct candidate stations it requires simultaneously open, and
    the reverse index from station -> paths touching it."""
    path_value = _path_values(context)
    path_required_stations = {}
    for (station, _category), pids in context.node_to_paths.items():
        for pid in pids:
            path_required_stations.setdefault(pid, set()).add(station)

    station_to_paths = {station: set() for station in context.B}
    for path_id, stations in path_required_stations.items():
        for station in stations:
            if station in station_to_paths:
                station_to_paths[station].add(path_id)

    path_required_count = {pid: len(stations) for pid, stations in path_required_stations.items()}
    return {
        "path_value": path_value,
        "path_required_count": path_required_count,
        "station_to_paths": station_to_paths,
    }


def max_coverage_greedy(budget, all_stations, coverage, unit_cost=None, design=None):
    """Weighted maximum-coverage greedy construction: at each step, open the
    affordable station that unlocks the most NEW path value -- a bike_pt
    path only starts contributing once ALL of its required stations
    (constraint (4)) are open, so a station's marginal value depends on
    which other stations are already in the design, unlike a static score.
    Monotone submodular under a budget/knapsack constraint, so this greedy
    carries the classical (1 - 1/e) approximation guarantee (Nemhauser-
    Wolsey-Fisher) relative to the true best subset under this coverage
    proxy -- not relative to the real MIP optimum, but a much better-founded
    proxy than an independent per-station score.

    O(total station-path incidences) per step in the worst case (recompute
    every remaining candidate's marginal gain fresh each round); measured
    ~18.8k incidences / 5.7k paths on the baseline instance, so ~105 steps x
    ~18.8k operations is comfortably sub-second in pure Python -- no need
    for a lazy/priority-queue acceleration at this scale.
    """
    design = set(design) if design else set()
    remaining_requirement = dict(coverage["path_required_count"])
    for station in design:
        for pid in coverage["station_to_paths"].get(station, ()):
            remaining_requirement[pid] -= 1

    candidates = set(s for s in all_stations if s not in design)
    path_value = coverage["path_value"]
    station_to_paths = coverage["station_to_paths"]

    while candidates:
        best_station, best_gain = None, -1.0
        for station in candidates:
            if not feasible_to_add(design, station, budget, unit_cost=unit_cost):
                continue
            gain = sum(
                path_value.get(pid, 0.0)
                for pid in station_to_paths.get(station, ())
                if remaining_requirement.get(pid, 0) == 1
            )
            if gain > best_gain:
                best_station, best_gain = station, gain

        if best_station is None:
            break  # nothing left both affordable and (marginally) useful
        design.add(best_station)
        candidates.discard(best_station)
        for pid in station_to_paths.get(best_station, ()):
            if pid in remaining_requirement:
                remaining_requirement[pid] -= 1

    return frozenset(design)


def combined_station_score(station_score, station_flow, realized_weight=0.7):
    """Normalise both signals to [0,1] and blend: mostly the oracle's
    realized flow-throughput where available, falling back to the static
    structural prior for stations that were never open (station_flow==0
    there isn't "this station is bad", it's "we never tried it")."""
    max_score = max(station_score.values(), default=0.0) or 1.0
    max_flow = max(station_flow.values(), default=0.0) if station_flow else 0.0
    combined = {}
    for station, prior in station_score.items():
        prior_n = prior / max_score
        if max_flow > 0:
            flow_n = station_flow.get(station, 0.0) / max_flow
            combined[station] = realized_weight * flow_n + (1 - realized_weight) * prior_n
        else:
            combined[station] = prior_n
    return combined


# ---------------------------------------------------------------- destroy --

def random_removal(design, rng, q, **_):
    design = set(design)
    q = min(q, len(design))
    remove = rng.sample(sorted(design, key=lambda s: s.node_id), q)
    return frozenset(design - set(remove))


def worst_removal(design, rng, q, station_flow=None, **_):
    design = set(design)
    q = min(q, len(design))
    if not station_flow:
        return random_removal(design, rng, q)
    ranked = sorted(design, key=lambda s: (station_flow.get(s, 0.0), s.node_id))
    remove = ranked[:q]
    return frozenset(design - set(remove))


def related_removal(design, rng, q, **_):
    design = set(design)
    q = min(q, len(design))
    if q == 0:
        return frozenset(design)
    anchor = rng.choice(sorted(design, key=lambda s: s.node_id))
    ranked = sorted(
        design,
        key=lambda s: compute_distance(anchor.coordinate, s.coordinate),
    )
    remove = ranked[:q]
    return frozenset(design - set(remove))


def weak_support_removal(design, rng, q, station_score=None, **_):
    """Remove stations with the lowest STATIC weighted path-support score
    (build_station_score: how much high-rank/high-demand path value touches
    this station at all) -- distinct from worst_removal's REALIZED flow
    criterion. A station can have low realized flow simply because some
    OTHER station on its paths' required sets isn't open yet (constraint
    (4)); this targets stations that only ever prop up low-rank/marginal
    paths regardless of what else is open."""
    design = set(design)
    q = min(q, len(design))
    if not station_score:
        return random_removal(design, rng, q)
    ranked = sorted(design, key=lambda s: (station_score.get(s, 0.0), s.node_id))
    remove = ranked[:q]
    return frozenset(design - set(remove))


DESTROY_OPERATORS = {
    "random_removal": random_removal,
    "worst_removal": worst_removal,
    "related_removal": related_removal,
    "weak_support_removal": weak_support_removal,
}


# ----------------------------------------------------------------- repair --

def _affordable_candidates(design, all_stations, budget, rng, order):
    candidates = [s for s in all_stations if s not in design]
    if order == "random":
        rng.shuffle(candidates)
    return candidates


def _repair_unit_cost(current_result):
    return realized_avg_station_cost(current_result)


def greedy_insertion(design, rng, budget, all_stations, station_score=None,
                     station_flow=None, current_result=None, **_):
    design = set(design)
    score = combined_station_score(station_score or {}, station_flow or {})
    unit_cost = _repair_unit_cost(current_result)
    candidates = sorted(
        (s for s in all_stations if s not in design),
        key=lambda s: score.get(s, 0.0),
        reverse=True,
    )
    for station in candidates:
        if feasible_to_add(design, station, budget, unit_cost=unit_cost):
            design.add(station)
    return frozenset(design)


def regret2_insertion(design, rng, budget, all_stations, station_score=None,
                      station_flow=None, current_result=None, **_):
    design = set(design)
    score = combined_station_score(station_score or {}, station_flow or {})
    unit_cost = _repair_unit_cost(current_result)
    remaining = sorted(
        (s for s in all_stations if s not in design),
        key=lambda s: score.get(s, 0.0),
        reverse=True,
    )
    while remaining:
        if len(remaining) >= 2:
            regret = score.get(remaining[0], 0.0) - score.get(remaining[1], 0.0)
        else:
            regret = 0.0
        station = remaining[0] if regret >= 0 else remaining[min(1, len(remaining) - 1)]
        remaining.remove(station)
        if feasible_to_add(design, station, budget, unit_cost=unit_cost):
            design.add(station)
    return frozenset(design)


def random_insertion(design, rng, budget, all_stations, current_result=None, **_):
    design = set(design)
    unit_cost = _repair_unit_cost(current_result)
    candidates = _affordable_candidates(design, all_stations, budget, rng, order="random")
    for station in candidates:
        if feasible_to_add(design, station, budget, unit_cost=unit_cost):
            design.add(station)
    return frozenset(design)


def max_coverage_repair(design, rng, budget, all_stations, coverage=None,
                        current_result=None, **_):
    """Extends max_coverage_greedy incrementally from the CURRENT partial
    (post-destroy) design instead of scoring candidates by
    combined_station_score -- applies the same submodular marginal-gain
    logic used for the one-off initial construction to every ongoing
    repair step, so constraint (4)'s station-gating coupling keeps
    informing insertion choices throughout the search, not just at t=0."""
    if coverage is None:
        return greedy_insertion(design, rng, budget, all_stations, current_result=current_result)
    unit_cost = _repair_unit_cost(current_result)
    return max_coverage_greedy(budget, all_stations, coverage, unit_cost=unit_cost, design=design)


REPAIR_OPERATORS = {
    "greedy_insertion": greedy_insertion,
    "regret2_insertion": regret2_insertion,
    "random_insertion": random_insertion,
    "max_coverage_repair": max_coverage_repair,
}
