"""
File: model_plan.py
Description: Read a solved run of the frozen optimisation model into plain
             dictionaries -- the design, the operating plan and the instance
             it was solved on -- so the demo layer can replay the model's own
             decisions instead of re-deriving them.

`NetworkDesignRun.stations` exposes three of the model's variables (`y`, `w`,
`v[i,0]`). The model decides considerably more than that: how many bikes sit in
each station at the start of *every* period, which arcs the operator rebalances
over and with how many vehicles, which paths the assigned demand rides, and
which stations those paths touch. The demo simulator needs all of it to replay
a day the way the optimiser planned it.

Everything here is a pure function: the live objects go in, plain
JSON-serialisable dicts come out. Nothing imports the frozen model (or gurobipy,
or networkx), so this module -- and its tests -- run in an environment where
none of them are installed.

Variable conventions of the frozen model, which the schemas below follow:

* `v[i, t]` is the stock at the **start** of period `t`, for `t` in `0..T`;
  `v[i, T]` is therefore the end state of the day. An `inventory` list has
  `T + 1` entries for that reason.
* `f[i,j,t]`, `r[i,j,t]` and `n[i,j,t]` carry the flows that happen **during**
  period `t` (the inventory balance reads them at `t-1` to produce `v[i,t]`),
  and only `t` in `0..T-1` feeds that balance -- so only those are exported.
* A Gurobi variable's value is `var.X`. Values below `EPS` are treated as zero,
  and bike/dispatch counts are rounded to integers: they are integer variables,
  and the solver returns them as floats a hair off.
"""

import ast

#: Anything smaller than this is the solver's floating point noise, not a
#: decision. Same tolerance `output_handler/metrics_evaluator.py` uses.
EPS = 1e-6

#: Defaults matching `util/cost.CostParameters` in the frozen model, so this
#: module never has to import it. `run_model.run_scenario` passes the live
#: values in, which is what a result file records.
DEFAULT_DISPATCH_FIXED_COST = 40.0
DEFAULT_REBALANCING_UNIT_COST = 20.0

#: The one-line description carried by every `instance.json`.
INSTANCE_DESCRIPTION = (
    "The instance the optimiser solved, slimmed (no polygons, no PT routes): "
    "zones kept by the model, its candidate stations, and its demand per period.")


# -- instance ----------------------------------------------------------------

def slim_instance(instance_dict, scenario_id, source):
    """The solved instance, without the parts the demo never reads.

    `InstanceGenerator.to_dict()` (also written verbatim to
    `h3_instances_json/<config_name>.txt`) carries the H3 cell polygons and the
    full public transport structure, which together are most of its size and
    none of its use here. This keeps the zone centres, the candidate stations
    and the per-period OD demand.

    :param instance_dict: `InstanceGenerator.to_dict()`, or the parsed `.txt`.
    :param scenario_id: e.g. "S2_balanced" -- recorded under "scenario".
    :param source: repo-relative path of the `.txt` this came from.
    :return: dict with keys scenario, config_name, source, description, seed,
             time_periods, time_period_weights, total_budget,
             operational_budget_ratio, cells, candidate_stations, od_demand.
    """
    cells = [
        {
            "id": node["zone_id"],
            "lon": node["coordinates"][0],
            "lat": node["coordinates"][1],
        }
        for node in instance_dict["grid_network"]["nodes"]
    ]

    candidate_stations = [
        {
            "id": station["node_id"],
            "type": station["type"],
            "lon": station["coordinate"][0],
            "lat": station["coordinate"][1],
        }
        for station in instance_dict["station_layout"]
    ]

    od_demand = []
    for key, flow in instance_dict["od_demand"].items():
        # to_dict() stringifies the tuple key: "(('origin', 'dest'), period)".
        (origin, dest), period = ast.literal_eval(key) if isinstance(key, str) else key
        od_demand.append({
            "origin": origin,
            "dest": dest,
            "period": int(period),
            "flow": flow,
        })
    od_demand.sort(key=lambda row: (row["period"], row["origin"], row["dest"]))

    return {
        "scenario": scenario_id,
        "config_name": instance_dict["config_name"],
        "source": source,
        "description": INSTANCE_DESCRIPTION,
        "seed": instance_dict["seed"],
        "time_periods": instance_dict["time_period"],
        "time_period_weights": list(instance_dict["time_period_weights"]),
        "total_budget": instance_dict["total_budget"],
        "operational_budget_ratio": instance_dict["operational_budget_ratio"],
        "cells": cells,
        "candidate_stations": candidate_stations,
        "od_demand": od_demand,
    }


# -- the solved plan ---------------------------------------------------------

def extract_model_plan(model, shortest_path_solver, periods,
                       dispatch_fixed_cost=DEFAULT_DISPATCH_FIXED_COST,
                       rebalancing_unit_cost=DEFAULT_REBALANCING_UNIT_COST):
    """Everything the solve decided, as one JSON-serialisable document.

    :param model: the solved `BikeSharingModel` (`NetworkDesignRun.model`).
    :param shortest_path_solver: the run's `ShortestPathSolver`, for the path
                                 objects the assignment variables index.
    :param periods: number of real demand periods, T
                    (`run.demand_generator.time_periods`).
    :param dispatch_fixed_cost: euro cost of dispatching one vehicle,
                                `CostParameters.dispatch_fixed_cost`.
    :param rebalancing_unit_cost: euro cost per km per dispatch,
                                  `CostParameters.rebalancing_unit_cost`.
    :return: dict with keys periods, stations, rebalancing, user_flows,
             assignments, demand, summary (see the module docstring for what
             the period index on a flow means).
    """
    periods = int(periods)
    stations = _extract_stations(model, periods)
    rebalancing = _extract_rebalancing(model, periods)
    user_flows = _extract_user_flows(model, periods)
    assignments = _extract_assignments(model, shortest_path_solver)
    demand = _extract_demand(model)

    summary = _summarise(model, stations, rebalancing, user_flows, assignments,
                         demand, dispatch_fixed_cost, rebalancing_unit_cost)

    return {
        "periods": periods,
        "stations": stations,
        "rebalancing": rebalancing,
        "user_flows": user_flows,
        "assignments": assignments,
        "demand": demand,
        "summary": summary,
    }


def extract_bike_arcs(bike_network):
    """The model's ride network: what it costs to ride between two candidates.

    `A_bike_network` holds one arc per ordered pair of candidate stations
    within `RIDE_CATCHMENT_RADIUS` of each other, with the distance and time of
    the OSM-routed cycling path between them (the time includes the
    `BIKE_ACCESS_EGRESS_TIME` minute of picking up and docking). It depends on
    the station layout and the street network only -- not on the budget, the
    demand or the solve -- so it is identical for every scenario of one
    instance and is written once, to `results/shared/bike_arcs.json`.

    :param bike_network: `model.A_bike_network`, a networkx DiGraph.
    :return: list of {from, to, distance_km, travel_time_min}, sorted.
    """
    arcs = []
    for i, j in bike_network.edges:
        data = bike_network.get_edge_data(i, j)
        arcs.append({
            "from": _node_id(i),
            "to": _node_id(j),
            "distance_km": round(float(data["distance"]), 6),
            "travel_time_min": round(float(data["travel_time"]), 6),
        })
    arcs.sort(key=lambda arc: (arc["from"], arc["to"]))
    return arcs


# -- pieces of the plan ------------------------------------------------------

def _extract_stations(model, periods):
    """Every candidate, built or not, with its capacity and its bike stock.

    Unbuilt candidates are kept (with capacity 0 and an all-zero inventory) so
    that the demo can show what the model *declined* to build, which is half of
    what a budget scenario says.

    :return: list of dicts, built stations first, each group sorted by id.
    """
    stations = []
    for node in model.B:
        built = _value(model.y[node]) > 0.5
        stations.append({
            "id": _node_id(node),
            "type": getattr(node, "type", type(node).__name__),
            "lon": node.coordinate[0],
            "lat": node.coordinate[1],
            "built": bool(built),
            "capacity": _count(model.w[node]),
            "inventory": [_count(model.v[node, t]) for t in range(periods + 1)],
        })
    stations.sort(key=lambda s: (not s["built"], s["id"]))
    return stations


def _extract_rebalancing(model, periods):
    """The operator's moves: bikes trucked from station to station, per period.

    `r` is how many bikes move, `n` how many vehicle dispatches carry them --
    two separate variables, and a row is kept when either is non-zero.
    """
    rows = []
    for i, j in model.A_bike_network.edges:
        for t in range(periods):
            bikes = _value(model.r[i, j, t])
            dispatches = _value(model.n[i, j, t])
            if bikes <= EPS and dispatches <= EPS:
                continue
            rows.append({
                "from": _node_id(i),
                "to": _node_id(j),
                "period": t,
                "bikes": int(round(bikes)),
                "dispatches": int(round(dispatches)),
            })
    rows.sort(key=lambda row: (row["period"], row["from"], row["to"]))
    return rows


def _extract_user_flows(model, periods):
    """Bikes moved by riders (`f`), as opposed to by the operator (`r`)."""
    rows = []
    for i, j in model.A_bike_network.edges:
        for t in range(periods):
            bikes = _value(model.f[i, j, t])
            if bikes <= EPS:
                continue
            rows.append({
                "from": _node_id(i),
                "to": _node_id(j),
                "period": t,
                "bikes": int(round(bikes)),
            })
    rows.sort(key=lambda row: (row["period"], row["from"], row["to"]))
    return rows


def _extract_assignments(model, shortest_path_solver):
    """Which path each unit of assigned demand takes, and how good it is.

    One row per non-zero flow variable, across the three mode categories:
    `x_b` (bike only), `x_pt` (bike + public transport), `x_w` (walk + public
    transport, i.e. the demand the bike system does not serve). The path's
    travel time, distance and time gain come off the `Path` object the variable
    is indexed by; `origin_station`/`dest_station` are where the rider takes and
    leaves a bike, and are None on a walk+PT path, which touches none.
    """
    id_path_map = getattr(shortest_path_solver, "id_path_map", {})
    path_ranking = getattr(shortest_path_solver, "path_ranking", {})

    rows = []
    for category, flow_vars in (("bike_only", model.x_b),
                                ("bike_pt", model.x_pt),
                                ("walk_pt", model.x_w)):
        for (od, t, path_id), var in flow_vars.items():
            flow = _value(var)
            if flow <= EPS:
                continue
            path = id_path_map.get(path_id)
            origin_station, dest_station, path_stations = _bike_leg(path)
            rows.append({
                "origin": od[0],
                "dest": od[1],
                "period": int(t),
                "path_id": path_id,
                "category": category,
                "flow": int(round(flow)),
                "rank": path_ranking.get(path_id),
                "total_time_min": _maybe_float(getattr(path, "total_time", None)),
                "total_distance_km": _maybe_float(getattr(path, "total_distance", None)),
                "time_gain_min": _maybe_float(
                    getattr(path, "shortest_path_time_gain", None)),
                "origin_station": origin_station,
                "dest_station": dest_station,
                "stations": path_stations,
            })
    rows.sort(key=lambda row: (row["period"], row["origin"], row["dest"],
                               row["category"], row["path_id"]))
    return rows


def _extract_demand(model):
    """The demand the model was given, flattened out of `demand_matrix`."""
    rows = [
        {
            "origin": od[0],
            "dest": od[1],
            "period": int(t),
            "flow": flow,
        }
        for (od, t), flow in model.demand_matrix.items()
    ]
    rows.sort(key=lambda row: (row["period"], row["origin"], row["dest"]))
    return rows


def _summarise(model, stations, rebalancing, user_flows, assignments, demand,
               dispatch_fixed_cost, rebalancing_unit_cost):
    """The headline numbers, recomputed from the rows above.

    `covered_od_ratio` follows `MetricsEvaluator._compute_coverage_metrics`: a
    *count* of distinct OD pairs carrying any bike-only or bike+PT flow, over
    the number of sampled OD pairs -- not a flow share.
    """
    built = [s for s in stations if s["built"]]

    flows = {"bike_only": 0, "bike_pt": 0, "walk_pt": 0}
    covered = set()
    for row in assignments:
        flows[row["category"]] += row["flow"]
        if row["category"] in ("bike_only", "bike_pt"):
            covered.add((row["origin"], row["dest"]))

    od_pairs_total = getattr(
        getattr(model, "demand_generator", None), "num_sampled_od_pairs", None)
    if not od_pairs_total:
        od_pairs_total = len({(row["origin"], row["dest"]) for row in demand})

    distances = _arc_distances(model.A_bike_network) if rebalancing else {}
    dispatch_cost = 0.0
    for row in rebalancing:
        if not row["dispatches"]:
            continue
        distance = distances[(row["from"], row["to"])]
        dispatch_cost += row["dispatches"] * (
            dispatch_fixed_cost + rebalancing_unit_cost * distance)

    return {
        "n_built": len(built),
        "docks": sum(s["capacity"] for s in built),
        "bikes_initial": sum(s["inventory"][0] for s in built),
        "flow_bike_only": flows["bike_only"],
        "flow_bike_pt": flows["bike_pt"],
        "flow_walk_pt": flows["walk_pt"],
        "demand_total": sum(row["flow"] for row in demand),
        "demand_assigned_bike_related": flows["bike_only"] + flows["bike_pt"],
        "od_pairs_total": int(od_pairs_total),
        "od_pairs_covered": len(covered),
        "covered_od_ratio": (len(covered) / od_pairs_total) if od_pairs_total else 0.0,
        "dispatches": sum(row["dispatches"] for row in rebalancing),
        "bikes_rebalanced": sum(row["bikes"] for row in rebalancing),
        "dispatch_cost_eur": round(dispatch_cost, 2),
    }


# -- reading the live objects ------------------------------------------------

def _node_id(node):
    """A node's stable string id (`Node.node_id`), whatever it is."""
    return getattr(node, "node_id", str(node))


def _bike_leg(path):
    """Where a path picks up a bike, where it leaves one, and what it passes.

    A path's `arcs_traversed` mixes walking, riding and public transport legs;
    only the arcs whose `mode` is exactly "Bike" are rides (a PT arc's mode is
    the route name). Consecutive rides share a node, so the station list keeps
    each endpoint once, in the order they are ridden.

    :param path: a `problem.path.Path`, or None if the id is unknown.
    :return: (origin_station, dest_station, stations) -- the first two None
             when the path never touches a bike, e.g. a walk+PT path.
    """
    arcs = [arc for arc in getattr(path, "arcs_traversed", None) or []
            if getattr(arc, "mode", None) == "Bike"]
    if not arcs:
        return None, None, []

    stations = []
    for arc in arcs:
        for node in (arc.start_node, arc.end_node):
            node_id = _node_id(node)
            if not stations or stations[-1] != node_id:
                stations.append(node_id)
    return _node_id(arcs[0].start_node), _node_id(arcs[-1].end_node), stations


def _value(var):
    """A Gurobi variable's solution value, as a float."""
    return float(var.X)


def _count(var):
    """An integer decision variable's value, rounded to the integer it is."""
    value = float(var.X)
    return 0 if abs(value) < EPS else int(round(value))


def _maybe_float(value):
    """`float(value)`, or None if there is no value to convert."""
    return None if value is None else float(value)


def _arc_distances(bike_network):
    """Arc lengths in km, keyed by the pair of *node ids*.

    The graph itself is keyed by node objects; the exported rows carry ids, so
    the mapping is built once rather than looking a node object back up per row.
    """
    return {
        (_node_id(i), _node_id(j)): float(bike_network.get_edge_data(i, j)["distance"])
        for i, j in bike_network.edges
    }
