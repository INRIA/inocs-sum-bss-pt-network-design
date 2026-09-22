"""
File: fixed_design.py
Description: The NORMATIVE definition of "evaluate a visitor's station layout".

With the set of open stations fixed, the paper's model (network-design-bss/src/
model/) collapses to its OPERATIONAL sub-problem: the LP below sizes the docks,
the initial fleet and -- optionally -- the truck rebalancing, and assigns the OD
demand to the pre-enumerated candidate paths, under the same capex and
operational budgets the frozen model uses.

This module is the reference the TypeScript engine in
demo/frontend/src/domain/evaluation/ transcribes. Every KPI line below carries a
`mirrors <file>:<lines>` comment pointing at the frozen model (or at the demo
pipeline stage) whose definition it reproduces; the TypeScript carries the same
comments pointing back here. The golden vectors that pin the two together are
written by demo/experiments/game_export.py into
demo/experiments/results/shared/game/golden/.

CONSTRAINTS AND RULES THIS MODULE OBEYS
---------------------------------------
* AGENTS.md rule 1 -- nothing under network-design-bss/src/ is edited or run.
* AGENTS.md rule 2 -- no model constant is hard-coded here. Unit costs are
  imported from network-design-bss/src/util/cost.py (a dependency-free
  dataclass, the same trick as demo/experiments/pipeline/config.py); the
  behavioural constants (CAPACITY_UB, MIN_CAPACITY_IF_BUILT,
  CAPACITY_REBALANCING_VEHICLE, PENALTY_COEFFICIENT, NUM_SHORTEST_PATHS,
  EPSILON, WALK_CATCHMENT_RADIUS, TIME_PERIODS, h3_version) are read out of
  network-design-bss/src/util/util.py with `ast`, because importing it pulls in
  osmnx/geopandas/h3 and requires compat.bootstrap().
* scipy is an OPTIONAL dependency of the demo layer. Importing this module must
  never fail without it; `solve()` raises a clear error instead.

WHY AN LP IS THE RIGHT MODEL HERE (verified by reading the frozen tree)
----------------------------------------------------------------------
Candidate paths are enumerated once over ALL candidate stations and cached under
a key carrying no design or budget parameter (shortest_path/
shortest_path_solver.py:62-216; the bike arc set is built over all candidates in
network/network_constructor.py:118-127). The design enters the model only as a
gate, `x[k,t,p] <= demand[k,t] * y[node]` for every station on p's bike legs
(model/constraints.py:129-152, node sets from model/parameters.py:24-46). So
with `y` fixed a path is usable iff every station on its bike legs is open --
a set-membership test, not an optimisation.

CONSTRAINTS REPRODUCED (frozen model -> here)
---------------------------------------------
  (2)  demand cap                     model/constraints.py:9-18
  (5)  flow conservation              model/constraints.py:157-165  (f is an
       equality alias of the path flows and is substituted out, so it never
       becomes an LP column)
  (6)  inventory balance              model/constraints.py:237-244
  (8)  v[i,t] <= w[i],  v[i,t] >= 0   model/constraints.py:270-273
  (10) start-of-period stock covers all outflow in t
                                      model/constraints.py:276-281
  (*)  MIN_CAPACITY_IF_BUILT <= w <= CAPACITY_UB
                                      model/constraints.py:285-293
  (11) capex budget                   model/constraints.py:296-301
       operational budget             model/constraints.py:177-188
       r <= CAPACITY_REBALANCING_VEHICLE * n
                                      model/constraints.py:191-195
       (n is substituted as r / CAPACITY_REBALANCING_VEHICLE -- the LP
        relaxation of the integer truck count, see CAVEATS)
  objective                           model/objective.py:145-178
       max  sum (1 - PENALTY_COEFFICIENT * rank) * x  -  epsilon * dispatch_cost

CAVEATS (measured in .specs/1demo-game-presentation/spike/RESULTS.md)
---------------------------------------------------------------------
* LP RELAXATION. x, w, v, r, n are integer upstream and continuous here, so the
  relaxation can only over-estimate. Measured overshoot on served flow over the
  21 committed designs: 0.9998x to 1.0157x, mean 1.005x.
* RELAXED TRUCKS. n = r / CAPACITY_REBALANCING_VEHICLE buys fractional truck
  runs, so the operational budget is slightly loose and the reported dispatch
  count runs 18-31 % high. `bikes_rebalanced` / `dispatches` are therefore
  reported as indicative and must never be headlined for a visitor's layout.
* walk_pt paths carry no bike and are never assigned here; the export drops
  them. flow_walk_pt == 0 in all 21 committed runs.
* CAPACITY_UB = 30 docks per station, not money, is what caps served flow once
  the budget is slack (see RESULTS.md section 3).

DATA
----
Everything this module reads is COMMITTED:
  demo/experiments/results/shared/game/{constants,candidates,cells,paths,
                                        arcs,demand_reference}.json
  demo/experiments/results/<scenario>/instance.json   (per-scenario demand)
Those game files are produced by demo/experiments/game_export.py, which is the
only piece that needs the uncommitted k-shortest-path pickle.

USAGE
-----
    from demo.experiments.fixed_design import Instance, evaluate, summary

    instance = Instance.for_game()                     # the game's demand
    result = evaluate(instance, station_ids, budget=80000,
                      ops_budget=4000, epsilon=0.04, trucks=True)
    print(result["served"], result["pt_share"])
"""

from __future__ import annotations

import ast
import collections
import json
import sys
import time
from pathlib import Path

from . import REPO_ROOT, RESULTS_DIR

#: network-design-bss/src -- the frozen model. Read-only, never imported wholesale.
SRC_DIR = REPO_ROOT / "network-design-bss" / "src"

#: Where game_export.py writes the interned browser payload.
GAME_DIR = RESULTS_DIR / "shared" / "game"

#: Anything at or below this flow is treated as zero (LP dust).
FLOW_EPS = 1e-6

#: Path categories, in the frozen model's own vocabulary
#: (shortest_path/shortest_path_solver.py's `categorized_paths` keys).
#: walk_pt carries no bike and is never exported.
CATEGORIES = ("bike_only", "bike_pt")

#: The behavioural constants read out of util/util.py. Mirrored by
#: tests/test_src_parity.py so an upstream rename fails loudly here.
_UTIL_CONSTANTS = (
    "PENALTY_COEFFICIENT",
    "CAPACITY_UB",
    "MIN_CAPACITY_IF_BUILT",
    "CAPACITY_REBALANCING_VEHICLE",
    "NUM_SHORTEST_PATHS",
    "EPSILON",
    "WALK_CATCHMENT_RADIUS",
    "TIME_PERIODS",
    "h3_version",
)

#: The five CostParameters fields the demo depends on by name.
_COST_FIELDS = (
    "station_setup_cost",
    "dock_cost",
    "unit_bike_cost",
    "dispatch_fixed_cost",
    "rebalancing_unit_cost",
)

_SCIPY_HINT = (
    "fixed_design.py needs scipy (scipy.optimize.linprog, method='highs') to "
    "solve. scipy is an optional dependency of the demo layer: install it with "
    "`pipenv install --dev` or `pip install scipy`, or run the stdlib-only part "
    "of the suite with DEMO_TESTS_FAST=1."
)


def _require_scipy():
    """Import numpy/scipy on demand.

    Importing this module must never fail without scipy (the demo layer is
    stdlib-only by design), so the dependency is resolved here, at solve time.

    :return: (numpy, linprog, coo_matrix).
    :raises RuntimeError: when scipy or numpy is not installed.
    """
    try:
        import numpy
        from scipy.optimize import linprog
        from scipy.sparse import coo_matrix
    except ImportError as exc:  # pragma: no cover - depends on the interpreter
        raise RuntimeError(f"{_SCIPY_HINT} (import failed: {exc})") from exc
    return numpy, linprog, coo_matrix


# --------------------------------------------------------------------------
# Constants, read live from the frozen model (AGENTS.md rule 2)
# --------------------------------------------------------------------------

def _ensure_src_on_path():
    src = str(SRC_DIR)
    if src not in sys.path:
        sys.path.insert(0, src)


def load_constants():
    """Unit costs and behavioural constants, straight from the frozen model.

    Unit costs are imported from `util/cost.py` (a plain dataclass with no heavy
    dependencies, exactly as pipeline/config.py does it). The behavioural
    constants are parsed out of `util/util.py` with `ast` rather than imported,
    because `util.util` pulls in osmnx/geopandas/h3 at import time and needs
    `compat.bootstrap()` to have run.

    :return: a flat dict of constants. Never a copied literal.
    :raises RuntimeError: if the module cannot be read or a constant vanished
                          upstream -- a silent fallback to stale numbers is
                          exactly what AGENTS.md rule 2 forbids.
    """
    cost_py = SRC_DIR / "util" / "cost.py"
    util_py = SRC_DIR / "util" / "util.py"
    for path in (cost_py, util_py):
        if not path.is_file():
            raise RuntimeError(
                f"missing {path} -- fixed_design.py reads the model's constants "
                f"live from network-design-bss/src/ and must run inside the "
                f"repository checkout")

    _ensure_src_on_path()
    try:
        from util.cost import CostParameters
    except ImportError as exc:
        raise RuntimeError(
            "could not import CostParameters from "
            "network-design-bss/src/util/cost.py -- the demo's unit costs are "
            "read live from the frozen model and cannot fall back to copies"
        ) from exc

    parameters = CostParameters()
    constants = {field: getattr(parameters, field) for field in _COST_FIELDS}

    wanted = set(_UTIL_CONSTANTS)
    tree = ast.parse(util_py.read_text(encoding="utf-8"))
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in wanted:
                try:
                    constants[target.id] = ast.literal_eval(node.value)
                except ValueError:
                    pass
    missing = wanted - set(constants)
    if missing:
        raise RuntimeError(
            f"network-design-bss/src/util/util.py no longer defines "
            f"{sorted(missing)} as plain literals -- upstream changed. Update "
            f"fixed_design.py and tests/test_src_parity.py together.")
    return constants


def constants_source():
    """Where every constant in `load_constants()` comes from, for provenance."""
    return {
        "unit_costs": "network-design-bss/src/util/cost.py::CostParameters",
        "behavioural": "network-design-bss/src/util/util.py (parsed with ast)",
        "fields": {
            "unit_costs": list(_COST_FIELDS),
            "behavioural": list(_UTIL_CONSTANTS),
        },
    }


# --------------------------------------------------------------------------
# The instance: candidates, cells, paths, arcs, demand
# --------------------------------------------------------------------------

def _read_json(path, what, how=""):
    if not Path(path).is_file():
        raise FileNotFoundError(
            f"{what} not found at {path}." + (f" {how}" if how else ""))
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


_EXPORT_HINT = ("Regenerate the game payload with "
                "`python3 -m demo.experiments.game_export` (it needs the "
                "k-shortest-path pickle under "
                "network-design-bss/src/data/shortest_paths_result/).")


class Instance:
    """Everything the LP is built from, for one demand profile.

    Interned ids throughout: a station is its index into `candidate_ids`, a cell
    its index into `cell_ids`, a path its index into `paths`. Those indices are
    the contract shared with the browser payload, so `flows` rows can be read
    straight off the exported `paths.json`.
    """

    def __init__(self, constants, candidate_ids, candidate_types, candidate_lonlat,
                 cell_ids, paths, arcs, demand, periods, demand_label):
        self.constants = constants
        self.candidate_ids = list(candidate_ids)
        self.candidate_types = list(candidate_types)
        self.candidate_lonlat = list(candidate_lonlat)
        self.cell_ids = list(cell_ids)
        #: [{"o", "d", "cat", "rank", "time", "km", "gain", "legs"}] -- legs are
        #: ORDERED (station_index, station_index) pairs, one per bike arc.
        self.paths = list(paths)
        #: {(station_index, station_index): distance_km} -- the ride network.
        self.arcs = dict(arcs)
        #: {(origin_cell, dest_cell, period): flow}
        self.demand = dict(demand)
        self.periods = int(periods)
        self.demand_label = demand_label

        self.index_of_candidate = {s: i for i, s in enumerate(self.candidate_ids)}
        self.index_of_cell = {c: i for i, c in enumerate(self.cell_ids)}

        self.demand_total = sum(self.demand.values())
        self.od_pairs = {(o, d) for (o, d, _t) in self.demand}

        self.paths_by_od = collections.defaultdict(list)
        for index, path in enumerate(self.paths):
            self.paths_by_od[(path["o"], path["d"])].append(index)

        #: Demand on OD pairs that have NO path in the catalogue at all: it can
        #: never be served whatever the visitor builds (AGENTS.md "Known
        #: upstream issues" #3 -- OD rows on unbuildable cells are not filtered).
        self.unreachable_flow = sum(
            flow for (o, d, _t), flow in self.demand.items()
            if not self.paths_by_od.get((o, d)))

    # -- construction ----------------------------------------------------

    @classmethod
    def from_export(cls, demand=None, game_dir=None):
        """Load from the committed browser payload under results/shared/game/.

        :param demand: None for the game's own demand profile
                       (`demand_reference.json`), or a scenario id whose
                       `results/<id>/instance.json` supplies the demand instead.
        :param game_dir: override the payload directory (tests).
        :return: an Instance.
        """
        game_dir = Path(game_dir or GAME_DIR)
        constants = load_constants()

        candidates = _read_json(game_dir / "candidates.json",
                                "candidates.json", _EXPORT_HINT)
        cells = _read_json(game_dir / "cells.json", "cells.json", _EXPORT_HINT)
        paths_file = _read_json(game_dir / "paths.json", "paths.json", _EXPORT_HINT)
        arcs_file = _read_json(game_dir / "arcs.json", "arcs.json", _EXPORT_HINT)

        candidate_ids = [row[0] for row in candidates["candidates"]]
        type_names = candidates["types"]
        candidate_types = [type_names[row[1]] for row in candidates["candidates"]]
        candidate_lonlat = [(row[2], row[3]) for row in candidates["candidates"]]
        cell_ids = [row[0] for row in cells["cells"]]

        paths = [{"o": row[0], "d": row[1], "cat": row[2], "rank": row[3],
                  "time": row[4], "km": row[5], "gain": row[6],
                  "legs": [tuple(leg) for leg in row[7]]}
                 for row in paths_file["paths"]]
        arcs = {(row[0], row[1]): float(row[2]) for row in arcs_file["arcs"]}

        if demand is None:
            reference = _read_json(game_dir / "demand_reference.json",
                                   "demand_reference.json", _EXPORT_HINT)
            rows = reference["demand"]
            periods = int(reference["periods"])
            label = reference["profile"]
        else:
            rows, periods = cls._scenario_demand(demand, cell_ids)
            label = demand

        table = collections.defaultdict(int)
        for origin, destination, period, flow in rows:
            table[(int(origin), int(destination), int(period))] += int(flow)

        return cls(constants, candidate_ids, candidate_types, candidate_lonlat,
                   cell_ids, paths, arcs, table, periods, label)

    @classmethod
    def for_game(cls, game_dir=None):
        """The instance the game runs on: the bimodal demand of the paper grid."""
        return cls.from_export(demand=None, game_dir=game_dir)

    @staticmethod
    def _scenario_demand(scenario, cell_ids):
        """Read one scenario's own per-period demand, interned to cell indices.

        The multinomial period split depends on the scenario's temporal profile
        and seed, so a golden vector must use its own scenario's demand.
        """
        instance = _read_json(RESULTS_DIR / scenario / "instance.json",
                              f"instance.json for scenario {scenario!r}",
                              "Run the scenario first (see "
                              "demo/experiments/scenarios/README.md).")
        index_of_cell = {c: i for i, c in enumerate(cell_ids)}
        rows = []
        for row in instance["od_demand"]:
            origin = index_of_cell.get(row["origin"])
            destination = index_of_cell.get(row["dest"])
            if origin is None or destination is None:
                raise ValueError(
                    f"scenario {scenario!r} has demand on a cell that is not in "
                    f"the exported cells.json: {row['origin']} -> {row['dest']}. "
                    + _EXPORT_HINT)
            rows.append((origin, destination, int(row["period"]), int(row["flow"])))
        return rows, int(instance["time_periods"])

    # -- helpers ---------------------------------------------------------

    def resolve(self, station_ids):
        """Turn a layout of candidate ids (or indices) into sorted indices.

        :param station_ids: iterable of candidate id strings and/or integer
                            indices; duplicates are collapsed.
        :return: a sorted list of station indices.
        :raises ValueError: when an id is not a candidate station.
        """
        out = set()
        unknown = []
        for item in station_ids:
            if isinstance(item, int) and not isinstance(item, bool):
                if 0 <= item < len(self.candidate_ids):
                    out.add(item)
                else:
                    unknown.append(item)
                continue
            index = self.index_of_candidate.get(item)
            if index is None:
                unknown.append(item)
            else:
                out.add(index)
        if unknown:
            raise ValueError(
                f"not candidate stations: {unknown[:5]}"
                f"{' ...' if len(unknown) > 5 else ''}")
        return sorted(out)

    def demand_by_period(self):
        """Total demand per period. mirrors demo/experiments/evaluate.py:175."""
        totals = [0.0] * self.periods
        for (_o, _d, period), flow in self.demand.items():
            totals[period] += flow
        return totals


# --------------------------------------------------------------------------
# The LP
# --------------------------------------------------------------------------

def evaluate(instance, station_ids, budget, ops_budget=None, epsilon=None,
             trucks=True):
    """Evaluate one layout: the paper's operational sub-problem, as an LP.

    The station set is fixed; the LP sizes docks (MIN_CAPACITY_IF_BUILT to
    CAPACITY_UB per open station), the initial fleet, and -- when `trucks` is
    true -- the aggregate rebalancing, then assigns the OD demand to the
    candidate paths whose bike legs are entirely open.

    :param instance: an :class:`Instance`.
    :param station_ids: the layout -- candidate ids or indices.
    :param budget: capex envelope in euros
                   (station_setup_cost * stations + dock_cost * docks +
                   unit_bike_cost * bikes <= budget). None = unconstrained.
    :param ops_budget: operational envelope in euros. Ignored (forced to 0)
                       when `trucks` is false. None = unconstrained.
    :param epsilon: the objective's rebalancing penalty weight; defaults to the
                    model's own EPSILON.
    :param trucks: False removes every rebalancing variable AND sets the
                   operating budget to zero -- "the same network, operated
                   without trucks".
    :return: the evaluation dict documented in the module docstring.
    """
    numpy, linprog, coo_matrix = _require_scipy()

    constants = instance.constants
    penalty = constants["PENALTY_COEFFICIENT"]
    capacity_ub = constants["CAPACITY_UB"]
    capacity_lb = constants["MIN_CAPACITY_IF_BUILT"]
    vehicle = constants["CAPACITY_REBALANCING_VEHICLE"]
    fixed_cost = constants["dispatch_fixed_cost"]
    km_cost = constants["rebalancing_unit_cost"]
    station_cost = constants["station_setup_cost"]
    dock_cost = constants["dock_cost"]
    bike_cost = constants["unit_bike_cost"]
    if epsilon is None:
        epsilon = constants["EPSILON"]
    if not trucks:
        ops_budget = 0.0

    periods = instance.periods
    opened = instance.resolve(station_ids)
    position = {station: i for i, station in enumerate(opened)}
    n_stations = len(opened)

    started = time.perf_counter()
    if n_stations == 0:
        return _empty(instance, opened, budget, ops_budget, epsilon, trucks,
                      time.perf_counter() - started,
                      note="no station placed")

    # --- columns ---------------------------------------------------------
    # x[k, t, p]: flow of OD pair k in period t on path p. A path exists as a
    # column only when every station on its bike legs is open -- the fixed-y
    # reading of constraints.py:129-152.
    columns = []                       # (origin, destination, period, path_index)
    for (origin, destination, period), flow in instance.demand.items():
        if flow <= 0:
            continue
        for path_index in instance.paths_by_od.get((origin, destination), ()):
            legs = instance.paths[path_index]["legs"]
            if all(node in position for leg in legs for node in leg):
                columns.append((origin, destination, period, path_index))
    n_x = len(columns)

    rebalancing_arcs = []
    if trucks:
        rebalancing_arcs = [(i, j) for (i, j) in instance.arcs
                            if i in position and j in position]
        rebalancing_arcs.sort()
    n_r = len(rebalancing_arcs) * periods
    r_index = {}
    for period in range(periods):
        for k, (i, j) in enumerate(rebalancing_arcs):
            r_index[(i, j, period)] = n_x + period * len(rebalancing_arcs) + k

    w_at = n_x + n_r                   # docks per open station
    v_at = w_at + n_stations           # bikes at the start of period 0
    n_cols = v_at + n_stations

    # --- per (station, period) incidence ---------------------------------
    out_of = collections.defaultdict(list)
    into = collections.defaultdict(list)
    for column, (_o, _d, period, path_index) in enumerate(columns):
        for start, end in instance.paths[path_index]["legs"]:
            out_of[(position[start], period)].append(column)
            into[(position[end], period)].append(column)
    for (i, j, period), column in r_index.items():
        out_of[(position[i], period)].append(column)
        into[(position[j], period)].append(column)

    rows, cols, vals, rhs = [], [], [], []

    def add(entries, bound):
        row = len(rhs)
        for column, coefficient in entries.items():
            if coefficient:
                rows.append(row)
                cols.append(column)
                vals.append(float(coefficient))
        rhs.append(float(bound))

    # (2) demand cap -- constraints.py:9-18
    grouped = collections.defaultdict(list)
    for column, (origin, destination, period, _p) in enumerate(columns):
        grouped[(origin, destination, period)].append(column)
    for key, group in grouped.items():
        add({column: 1.0 for column in group}, instance.demand[key])

    # (6) + (8) + (10): everything about stocks. Flow conservation (5) is an
    # equality alias of the path flows and is substituted out.
    for i in range(n_stations):
        for period in range(periods):
            # (10) outflow in t <= v[i,t] -- constraints.py:276-281. Bikes that
            # ARRIVE during period t are not borrowable until t+1.
            entry = collections.Counter()
            for column in out_of[(i, period)]:
                entry[column] += 1
            for earlier in range(period):
                for column in into[(i, earlier)]:
                    entry[column] -= 1
                for column in out_of[(i, earlier)]:
                    entry[column] += 1
            if entry:
                entry[v_at + i] = entry.get(v_at + i, 0) - 1
                add(dict(entry), 0.0)

            # (8) 0 <= v[i,t+1] <= w[i] -- constraints.py:237-244, 270-273
            entry = collections.Counter()
            for earlier in range(period + 1):
                for column in into[(i, earlier)]:
                    entry[column] += 1
                for column in out_of[(i, earlier)]:
                    entry[column] -= 1
            upper = dict(entry)
            upper[v_at + i] = upper.get(v_at + i, 0) + 1
            upper[w_at + i] = -1.0
            add(upper, 0.0)
            lower = {column: -coefficient for column, coefficient in entry.items()}
            lower[v_at + i] = -1.0
            add(lower, 0.0)

        add({v_at + i: 1.0, w_at + i: -1.0}, 0.0)      # v[i,0] <= w[i]

    # (11) capex budget -- constraints.py:296-301
    if budget is not None:
        entry = {}
        for i in range(n_stations):
            entry[w_at + i] = float(dock_cost)
            entry[v_at + i] = float(bike_cost)
        add(entry, budget - station_cost * n_stations)

    # operational budget, with n substituted as r / CAPACITY_REBALANCING_VEHICLE
    # -- constraints.py:177-188 and :191-195
    if r_index and ops_budget is not None:
        add({column: (fixed_cost + km_cost * instance.arcs[(i, j)]) / vehicle
             for (i, j, _t), column in r_index.items()}, ops_budget)

    matrix = coo_matrix((vals, (rows, cols)), shape=(len(rhs), n_cols))

    # objective -- objective.py:145-178, negated because linprog minimises
    objective = numpy.zeros(n_cols)
    for column, (_o, _d, _t, path_index) in enumerate(columns):
        objective[column] = -(1.0 - penalty * instance.paths[path_index]["rank"])
    for (i, j, _t), column in r_index.items():
        objective[column] = epsilon * (fixed_cost + km_cost * instance.arcs[(i, j)]) / vehicle

    lower_bounds = numpy.zeros(n_cols)
    upper_bounds = numpy.full(n_cols, numpy.inf)
    lower_bounds[w_at:v_at] = capacity_lb
    upper_bounds[w_at:v_at] = capacity_ub
    upper_bounds[v_at:n_cols] = capacity_ub

    solution = linprog(objective, A_ub=matrix.tocsr(), b_ub=numpy.array(rhs),
                       bounds=list(zip(lower_bounds, upper_bounds)),
                       method="highs")
    seconds = time.perf_counter() - started

    if not solution.success:
        # Documented behaviour: a layout the budget cannot pay for (every open
        # station needs MIN_CAPACITY_IF_BUILT docks) is NOT an error. It scores
        # zero and says why. Nothing crashes.
        result = _empty(instance, opened, budget, ops_budget, epsilon, trucks,
                        seconds, note=str(solution.message))
        result["feasible"] = False
        result["lp"]["columns"] = n_cols
        result["lp"]["rows"] = len(rhs)
        result["lp"]["path_columns"] = n_x
        result["lp"]["rebalancing_columns"] = n_r
        return result

    values = solution.x
    return _read_kpis(instance, opened, columns, values, n_x, r_index,
                      w_at, v_at, n_cols, len(rhs), budget, ops_budget,
                      epsilon, trucks, seconds)


def _read_kpis(instance, opened, columns, values, n_x, r_index, w_at, v_at,
               n_cols, n_rows, budget, ops_budget, epsilon, trucks, seconds):
    """Turn a solved LP into the evaluation dict. One KPI per line, each
    carrying the definition it mirrors."""
    constants = instance.constants
    periods = instance.periods
    vehicle = constants["CAPACITY_REBALANCING_VEHICLE"]
    fixed_cost = constants["dispatch_fixed_cost"]
    km_cost = constants["rebalancing_unit_cost"]

    # served flow, per period and per category
    # mirrors demo/experiments/evaluate.py:149-183 (paper_kpis) and
    # network-design-bss/src/output_handler/metrics_evaluator.py:84-85
    served = 0.0
    served_by_period = [0.0] * periods
    bike_only_by_period = [0.0] * periods
    bike_pt_by_period = [0.0] * periods
    flows = []
    for column, (_o, _d, period, path_index) in enumerate(columns):
        flow = float(values[column])
        if flow <= FLOW_EPS:
            continue
        served += flow
        served_by_period[period] += flow
        if instance.paths[path_index]["cat"] == 1:          # bike_pt
            bike_pt_by_period[period] += flow
        else:                                               # bike_only
            bike_only_by_period[period] += flow
        flows.append([path_index, period, flow])
    flows.sort(key=lambda row: (row[0], row[1]))

    flow_bike_pt = sum(bike_pt_by_period)
    flow_bike_only = sum(bike_only_by_period)

    docks = float(values[w_at:v_at].sum())                  # mirrors model_plan.py:"docks"
    bikes = float(values[v_at:n_cols].sum())                # mirrors model_plan.py:"bikes_initial"
    n_stations = len(opened)
    # capex -- constraints.py:296-301, unit costs from util/cost.py
    capex = (constants["station_setup_cost"] * n_stations
             + constants["dock_cost"] * docks
             + constants["unit_bike_cost"] * bikes)

    rebalanced = float(sum(values[column] for column in r_index.values())) if r_index else 0.0
    dispatch_cost = float(sum(
        values[column] * (fixed_cost + km_cost * instance.arcs[(i, j)]) / vehicle
        for (i, j, _t), column in r_index.items()))
    # mirrors demo/experiments/pipeline/model_plan.py:357 (dispatch_cost_eur) and
    # network-design-bss/src/output_handler/metrics_evaluator.py:177-198 --
    # RELAXED, see the module docstring's CAVEATS.

    covered_pairs = {(o, d) for column, (o, d, _t, _p) in enumerate(columns)
                     if values[column] > FLOW_EPS}
    # mirrors metrics_evaluator.py:282-294 (_compute_coverage_metrics): counts
    # OD PAIRS with any positive assignment, not flow volume (upstream issue #5).

    time_weighted = sum(values[c] * instance.paths[columns[c][3]]["time"]
                        for c in range(n_x))
    gain_weighted = sum(values[c] * instance.paths[columns[c][3]]["gain"]
                        for c in range(n_x))

    result = _base(instance, opened, budget, ops_budget, epsilon, trucks, seconds)
    result.update({
        "feasible": True,
        "served": served,
        "served_ratio": served / instance.demand_total if instance.demand_total else 0.0,
        "served_by_period": served_by_period,
        "bike_only_by_period": bike_only_by_period,
        "bike_pt_by_period": bike_pt_by_period,
        "flow_bike_only": flow_bike_only,
        "flow_bike_pt": flow_bike_pt,
        # mirrors evaluate.py:183 -- pt_assisted_share = flow_bike_pt / served
        "pt_share": flow_bike_pt / served if served > FLOW_EPS else 0.0,
        "docks": docks,
        "bikes": bikes,
        "capex_eur": capex,
        "bikes_rebalanced": rebalanced,
        "dispatches_relaxed": rebalanced / vehicle,
        "dispatch_cost_eur": dispatch_cost,
        "od_pairs_covered": len(covered_pairs),
        "covered_od_ratio": (len(covered_pairs) / len(instance.od_pairs)
                             if instance.od_pairs else 0.0),
        # mirrors metrics_evaluator.py:299-324 (flow-weighted travel time / gain)
        "avg_travel_time_min": time_weighted / served if served > FLOW_EPS else 0.0,
        "avg_time_gain_min": gain_weighted / served if served > FLOW_EPS else 0.0,
        "losses": losses(instance, opened, served),
        "flows": flows,
    })
    result["lp"].update({"columns": n_cols, "rows": n_rows,
                         "path_columns": n_x, "rebalancing_columns": len(r_index)})
    return result


def losses(instance, opened, served):
    """Split the demand that never moves into its three causes.

    * `unreachable` -- the OD pair has no path in the catalogue at all, so no
      layout can ever serve it (AGENTS.md "Known upstream issues" #3: ~60 trips).
    * `no_station`  -- the OD pair has candidate paths, but the layout leaves at
      least one station open on every one of them.
    * `no_stock`    -- everything else: a path was available but the LP could
      not put a bike on it (docks, fleet, budget, the 30-dock cap, or the
      start-of-period stock rule).

    :param instance: the :class:`Instance`.
    :param opened: sorted station indices.
    :param served: the served flow of the solved LP.
    :return: {"no_station", "no_stock", "unreachable"}.
    """
    open_set = set(opened)
    no_station = 0.0
    for (origin, destination, _period), flow in instance.demand.items():
        options = instance.paths_by_od.get((origin, destination))
        if not options:
            continue                                   # counted as unreachable
        if not any(all(node in open_set
                       for leg in instance.paths[index]["legs"] for node in leg)
                   for index in options):
            no_station += flow
    unreachable = float(instance.unreachable_flow)
    no_stock = instance.demand_total - served - unreachable - no_station
    return {"no_station": no_station,
            "no_stock": max(0.0, no_stock),
            "unreachable": unreachable}


def _base(instance, opened, budget, ops_budget, epsilon, trucks, seconds):
    """The fields every evaluation carries, feasible or not."""
    transfer = sum(1 for i in opened
                   if instance.candidate_types[i] == "TransferStation")
    return {
        "demand_total": float(instance.demand_total),
        "demand_by_period": instance.demand_by_period(),
        "n_stations": len(opened),
        "n_transfer": transfer,
        "n_regular": len(opened) - transfer,
        "budget_eur": budget,
        "ops_budget_eur": ops_budget,
        "epsilon": epsilon,
        "trucks": bool(trucks),
        "demand_profile": instance.demand_label,
        "lp": {"columns": 0, "rows": 0, "path_columns": 0,
               "rebalancing_columns": 0, "seconds": seconds},
    }


def _empty(instance, opened, budget, ops_budget, epsilon, trucks, seconds, note):
    """A layout that serves nothing: no station, or a budget that cannot pay
    for the stations placed. Never an exception."""
    periods = instance.periods
    result = _base(instance, opened, budget, ops_budget, epsilon, trucks, seconds)
    result.update({
        "feasible": True,
        "note": note,
        "served": 0.0,
        "served_ratio": 0.0,
        "served_by_period": [0.0] * periods,
        "bike_only_by_period": [0.0] * periods,
        "bike_pt_by_period": [0.0] * periods,
        "flow_bike_only": 0.0,
        "flow_bike_pt": 0.0,
        "pt_share": 0.0,
        "docks": 0.0,
        "bikes": 0.0,
        "capex_eur": float(instance.constants["station_setup_cost"] * len(opened)),
        "bikes_rebalanced": 0.0,
        "dispatches_relaxed": 0.0,
        "dispatch_cost_eur": 0.0,
        "od_pairs_covered": 0,
        "covered_od_ratio": 0.0,
        "avg_travel_time_min": 0.0,
        "avg_time_gain_min": 0.0,
        "losses": losses(instance, opened, 0.0),
        "flows": [],
    })
    return result


#: The keys `summary()` keeps -- everything except the bulky per-path flows and
#: the wall-clock timing, which would make a golden vector flaky.
SUMMARY_DROP = ("flows",)


def summary(result, round_to=6):
    """The evaluation without its `flows` list and without wall-clock timings.

    This is what golden vectors and references.json store: stable, small, and
    safe to compare with a 1e-6 tolerance.

    :param result: an `evaluate()` result.
    :param round_to: decimal places floats are rounded to.
    :return: a new dict.
    """
    def clean(value):
        if isinstance(value, float):
            return round(value, round_to)
        if isinstance(value, list):
            return [clean(v) for v in value]
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items() if k != "seconds"}
        return value

    return {key: clean(value) for key, value in result.items()
            if key not in SUMMARY_DROP}


# --------------------------------------------------------------------------
# Layout rules shared with the browser (domain/placement)
# --------------------------------------------------------------------------

def potential_flow_by_candidate(instance):
    """Per candidate, the demand of the OD-periods that have ANY path touching it.

    A static upper bound on what opening that one station could unlock; it is
    NOT service (it ignores the other stations the same path needs). The browser
    reads it from `coverage.json` for the live "within reach" preview, and the
    assistant uses it only as a display value.

    :return: a list of floats, one per candidate index.
    """
    score = [0.0] * len(instance.candidate_ids)
    for (origin, destination, _period), flow in instance.demand.items():
        for index in instance.paths_by_od.get((origin, destination), ()):
            for node in {n for leg in instance.paths[index]["legs"] for n in leg}:
                score[node] += flow
    return score


def reach_options(instance):
    """For every demanded (origin, destination, period), the station sets that
    would make it servable.

    One entry per demand row: `{"od": [o, d], "t": period, "flow": flow,
    "sets": [[station_index, ...], ...]}`, where each set is the (de-duplicated,
    sorted) set of stations one candidate path needs. A row is "within reach" of
    a layout iff at least one of its sets is a subset of the layout.

    This is exactly the availability test the LP applies (constraints.py:129-152
    with y fixed), so "within reach" is an upper bound on served flow -- never a
    service figure. Measured overestimate: 1.04x at 80 k EUR, 1.90x at 20 k EUR.
    """
    rows = []
    for (origin, destination, period), flow in sorted(instance.demand.items()):
        sets = []
        seen = set()
        for index in instance.paths_by_od.get((origin, destination), ()):
            nodes = tuple(sorted({n for leg in instance.paths[index]["legs"]
                                  for n in leg}))
            if nodes not in seen:
                seen.add(nodes)
                sets.append(list(nodes))
        rows.append({"od": [origin, destination], "t": period,
                     "flow": flow, "sets": sets})
    return rows


def reach_flow(rows, layout):
    """Demand within reach of `layout`, from `reach_options()` rows.

    :param rows: the output of :func:`reach_options`.
    :param layout: an iterable of station indices.
    :return: total flow of the rows that have at least one fully-open set.
    """
    open_set = set(layout)
    return float(sum(row["flow"] for row in rows
                     if any(open_set.issuperset(s) for s in row["sets"])))


def assistant_order(rows, candidates, limit):
    """The "follow the demand" rule, deterministically.

    Repeatedly add the candidate that makes the most ADDITIONAL demand reachable
    (a row becomes reachable when one of its station sets is fully open); ties
    are broken by the smallest candidate index. Because a still-unreachable row
    becomes reachable by adding `c` only when `c` is the single missing station
    of one of its sets, the marginal gain is exact.

    This is the rule `references.json` records as `demand_rule`, and the one
    demo/frontend/src/domain/placement/assistant.ts must reproduce exactly.

    :param rows: the output of :func:`reach_options`.
    :param candidates: the number of candidate stations.
    :param limit: how many stations to pick.
    :return: the chosen station indices, in the order they were chosen.
    """
    chosen = set()
    order = []
    covered = [False] * len(rows)
    for _ in range(min(limit, candidates)):
        gain = collections.Counter()
        for position, row in enumerate(rows):
            if covered[position]:
                continue
            for option in row["sets"]:
                missing = [s for s in option if s not in chosen]
                if len(missing) == 1:
                    gain[missing[0]] += row["flow"]
        best, best_gain = None, None
        for candidate in range(candidates):
            if candidate in chosen:
                continue
            value = gain.get(candidate, 0)
            if best is None or value > best_gain:
                best, best_gain = candidate, value
        if best is None:
            break
        chosen.add(best)
        order.append(best)
        for position, row in enumerate(rows):
            if not covered[position] and any(
                    all(s in chosen for s in option) for option in row["sets"]):
                covered[position] = True
    return order


def max_stations(budget, constants):
    """How many stations a capex budget can pay for at all.

    Every open station costs `station_setup_cost` and must carry at least
    `MIN_CAPACITY_IF_BUILT` docks (constraints.py:285-293), so the cheapest
    possible station is `station_setup_cost + dock_cost * MIN_CAPACITY_IF_BUILT`.
    Mirrored by demo/frontend/src/domain/placement/budget.ts.
    """
    floor_cost = (constants["station_setup_cost"]
                  + constants["dock_cost"] * constants["MIN_CAPACITY_IF_BUILT"])
    return int(budget // floor_cost)
