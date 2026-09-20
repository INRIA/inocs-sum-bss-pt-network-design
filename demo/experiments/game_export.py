"""
File: game_export.py
Description: Write the compact browser payload the "planner game" evaluates
             layouts from, under demo/experiments/results/shared/game/.

The game lets a visitor place stations and scores the layout in the browser with
the same operational LP `fixed_design.py` defines. That needs the pre-enumerated
candidate paths, the ride network, the model's constants and a set of reference
values -- all small, all interned to integer ids, all committed.

WHAT IS WRITTEN (all under results/shared/game/)
------------------------------------------------
  constants.json        unit costs + behavioural constants, read LIVE from
                        network-design-bss/src/ (AGENTS.md rule 2), plus the
                        four game budgets with their capex and daily operating
                        envelope taken from the scenario files.
  candidates.json       100 candidate stations: id, type, lon, lat.
                        A station's INTEGER ID is its index in this array.
  cells.json            56 H3 cell centres. A cell's integer id is its index.
  paths.json            the candidate paths of the DEMANDED OD pairs only, with
                        their bike legs as explicit (station, station) pairs.
  arcs.json             the ride network: candidate pairs with their distance.
  demand_reference.json the game's own per-period OD demand.
  coverage.json         per candidate: the cells inside the walk catchment and
                        the potential flow it could touch; plus the reach table
                        the live "within reach" preview reads.
  references.json       per game budget: the engine's own evaluation of the
                        optimiser's stations (with and without trucks), the
                        median of 30 seeded random layouts, and the demand-rule
                        layout.
  golden/<scenario>.json  for each committed design: its station ids, its
                        budget, and the engine's evaluation with and without
                        trucks (without the bulky `flows` list).

THE TRAP, STATED ONCE
---------------------
A path's de-duplicated station list is NOT its bike legs. `[A,B,C,D]` can be two
disjoint legs and `[A,B,C]` a chain; re-deriving legs by pairing the list up is
ambiguous for the 127 paths with three bike arcs. The legs are therefore taken
one-per-bike-arc straight from each path's `arcs_traversed` and exported
explicitly. See .specs/1demo-game-presentation/spike/RESULTS.md caveat 3.

INPUTS
------
Committed, and preferred wherever they are sufficient:
  demo/experiments/results/<scenario>/instance.json    cells, candidates, demand
  demo/experiments/results/<scenario>/model_plan.json  the optimiser's design
  demo/experiments/results/<scenario>/kpis.json        published KPIs
  demo/experiments/results/shared/bike_arcs.json       the ride network
  demo/experiments/scenarios/<id>.json                 budgets and epsilon
  network-design-bss/src/util/{cost,util}.py           the constants

NOT committed, and needed ONLY to build paths.json:
  network-design-bss/src/data/shortest_paths_result/
      shortest_paths_cache_size7_k3_['real_pt_lines_radius2']_after.pkl
That pickle is the k-shortest-path cache the first model run produces (~50 min);
`network-design-bss/src/.gitignore:21` keeps it out of the repository. Without
it this exporter refuses to run and says so. Everything downstream --
fixed_design.py, the Python tests and the TypeScript engine -- reads the
COMMITTED paths.json instead and never touches the pickle.

The pickle is read with a stub class loader, so no frozen-model module is ever
imported, osmnx/geopandas/h3 are never needed and Gurobi is never touched.

USAGE
-----
    python3 -m demo.experiments.game_export              # write everything
    python3 -m demo.experiments.game_export --check      # rebuild and diff only
"""

from __future__ import annotations

import argparse
import ast
import collections
import gzip
import json
import math
import pickle
import random
import sys
from pathlib import Path

from . import RESULTS_DIR
from .fixed_design import (GAME_DIR, SRC_DIR, Instance, assistant_order,
                           constants_source, evaluate, load_constants,
                           max_stations, potential_flow_by_candidate,
                           reach_flow, reach_options, summary)

#: The k-shortest-path cache. Uncommitted; see the module docstring.
PICKLE = (SRC_DIR / "data" / "shortest_paths_result" /
          "shortest_paths_cache_size7_k3_['real_pt_lines_radius2']_after.pkl")

#: The ride network written by demo/experiments/run_model.py.
ARCS_FILE = RESULTS_DIR / "shared" / "bike_arcs.json"

SCENARIOS_DIR = Path(__file__).resolve().parent / "scenarios"

#: Every committed design, in the order golden vectors are written.
ALL_SCENARIOS = ("budget_020k", "budget_040k", "budget_060k", "budget_080k",
                 "budget_100k", "budget_120k",
                 "eps_000", "eps_001", "eps_008", "eps_012",
                 "ops_000", "ops_025", "ops_075", "ops_100", "ops_125",
                 "rhythm_geneva", "rhythm_sharp", "rhythm_uniform",
                 "S1_essential", "S2_balanced", "S3_ambitious")

#: The four budgets the game offers, and the run whose demand, epsilon and
#: operating envelope each one borrows.
GAME_BUDGETS = (("budget_020k", 20000), ("budget_060k", 60000),
                ("budget_080k", 80000), ("budget_120k", 120000))

#: The scenario whose instance.json supplies the game's cells, candidates and
#: demand. Its temporal profile is the paper's bimodal baseline (0.4/0.2/0.4);
#: the 15 non-rhythm runs share it exactly.
GAME_DEMAND_SCENARIO = "budget_080k"
GAME_DEMAND_PROFILE = "bimodal"

#: Layouts drawn for the "random planner" reference, and the seed. Fixed so the
#: reference is reproducible; both are recorded in references.json.
RANDOM_LAYOUTS = 30
RANDOM_SEED = 20260920

#: Rounding of the exported numbers. Coordinates to 6 decimals (~0.1 m),
#: distances and times to 5-6, so the payload stays small and the goldens stay
#: byte-stable across machines.
ROUND_COORD = 6
ROUND_KM = 6
ROUND_MIN = 4


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def _read_json(path, what, how=""):
    if not Path(path).is_file():
        raise SystemExit(f"\nERROR: {what} not found at\n  {path}\n"
                         + (f"{how}\n" if how else ""))
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path, payload):
    """Write compact JSON (no spaces, sorted nowhere -- order is meaningful)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))
        handle.write("\n")
    return path


def _sizes(path):
    raw = path.stat().st_size
    packed = len(gzip.compress(path.read_bytes(), 9))
    return raw, packed


def _method(purpose, sources, notes=()):
    """The `method` block every artefact carries (AGENTS.md convention).

    Deliberately carries NO timestamp and NO absolute path: golden tests compare
    these files as parsed JSON, and a clock or a home directory in them would
    make every run differ.
    """
    return {"purpose": purpose,
            "generated_by": "demo/experiments/game_export.py",
            "sources": list(sources),
            "notes": list(notes)}


def _relative(path):
    """A repository-relative path string, for provenance without absolutes."""
    return str(Path(path).resolve().relative_to(
        Path(__file__).resolve().parents[2]))


# --------------------------------------------------------------------------
# The path catalogue, from the uncommitted pickle
# --------------------------------------------------------------------------

class _Stub:
    """Stand-in for any class the pickle names. Nothing from the frozen model
    is imported: only plain attributes are read off the unpickled objects."""

    def __setstate__(self, state):
        if isinstance(state, dict):
            self.__dict__.update(state)
        else:
            self._state = state

    def __hash__(self):
        return id(self)

    def __eq__(self, other):
        return self is other


class _StubUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        try:
            return super().find_class(module, name)
        except Exception:                                   # noqa: BLE001
            return type(name, (_Stub,), {})


#: The frozen model's own path-category vocabulary. walk_pt carries no bike and
#: is never assignable in the fixed-design LP, so it is dropped on export.
_CATEGORY_CODE = {"bike_only": 0, "bike_pt": 1}


def read_catalogue():
    """Flatten the pickled k-shortest-path cache into plain rows.

    :return: (rows, stats). Each row is
             {"o", "d", "cat", "rank", "time", "km", "gain", "legs", "src_id"}
             with cell ids and station ids as UPSTREAM STRINGS; `legs` is the
             ordered list of (start_station, end_station) pairs, one per bike
             arc of `arcs_traversed`.
    """
    if not PICKLE.is_file():
        raise SystemExit(
            "\nERROR: the k-shortest-path cache is missing.\n"
            f"  expected at: {PICKLE}\n\n"
            "It is produced by the first model run (~50 min of path enumeration)\n"
            "and is deliberately NOT committed "
            "(network-design-bss/src/.gitignore:21).\n"
            "Only this exporter needs it; fixed_design.py, the Python tests and\n"
            "the TypeScript engine all read the committed\n"
            "demo/experiments/results/shared/game/paths.json instead.\n\n"
            "To rebuild it, run one scenario through the model, e.g.\n"
            "  python3 -m demo.experiments.run_model budget_080k\n")

    with open(PICKLE, "rb") as handle:
        data = _StubUnpickler(handle).load()

    categorized = data["categorized_paths"]
    id_path_map = data["id_path_map"]
    ranking = data["path_ranking"]

    rows = []
    dropped_walk_pt = 0
    for category, code in _CATEGORY_CODE.items():
        for od, path_ids in categorized.get(category, {}).items():
            for path_id in path_ids:
                path = id_path_map.get(path_id)
                if path is None:
                    continue
                # THE TRAP: one leg per bike arc, taken from arcs_traversed.
                legs = [(arc.start_node.node_id, arc.end_node.node_id)
                        for arc in getattr(path, "arcs_traversed", ())
                        if getattr(arc, "mode", None) == "Bike"]
                if not legs:
                    dropped_walk_pt += 1
                    continue
                rows.append({
                    "o": od[0], "d": od[1], "src_id": int(path_id), "cat": code,
                    "rank": int(ranking.get(path_id, 1)),
                    "time": round(float(path.total_time), ROUND_MIN),
                    "km": round(float(path.total_distance), ROUND_KM),
                    "gain": round(float(path.shortest_path_time_gain), ROUND_MIN),
                    "legs": legs,
                })
    walk_pt = sum(len(v) for v in categorized.get("walk_pt", {}).values())
    stats = {"source_paths": len(id_path_map),
             "bike_carrying_paths": len(rows),
             "walk_pt_paths_dropped": walk_pt + dropped_walk_pt}
    return rows, stats


# --------------------------------------------------------------------------
# Reading the committed inputs and interning the ids
# --------------------------------------------------------------------------

def _grid_centres():
    """{cell id: (lon, lat)} from the demo layer's own copy of the H3 grid.

    Only needed for the handful of cells the demand names but the model kept no
    candidate station in (upstream issue #3). `properties.center` is a
    stringified `(lat, lon)` tuple.
    """
    from . import GEOJSON_DIR
    grid = _read_json(GEOJSON_DIR / "grid.geojson", "grid.geojson",
                      "It ships with the demo layer's data/ sample.")
    centres = {}
    for feature in grid["features"]:
        properties = feature["properties"]
        latitude, longitude = ast.literal_eval(str(properties["center"]))
        centres[properties["id"]] = (float(longitude), float(latitude))
    return centres


def _scenario_instance(scenario):
    return _read_json(RESULTS_DIR / scenario / "instance.json",
                      f"instance.json for scenario {scenario!r}",
                      "Run the scenario first, or drop it from ALL_SCENARIOS.")


def collect():
    """Read every committed input and intern the ids.

    :return: a context dict shared by all the writers.
    """
    constants = load_constants()
    available = [s for s in ALL_SCENARIOS
                 if (RESULTS_DIR / s / "instance.json").is_file()
                 and (RESULTS_DIR / s / "model_plan.json").is_file()]
    if GAME_DEMAND_SCENARIO not in available:
        raise SystemExit(f"\nERROR: the game's demand scenario "
                         f"{GAME_DEMAND_SCENARIO!r} has no results.\n")

    base = _scenario_instance(GAME_DEMAND_SCENARIO)
    model_cells = [(c["id"], c["lon"], c["lat"]) for c in base["cells"]]
    candidates = [(s["id"], s["type"], s["lon"], s["lat"])
                  for s in base["candidate_stations"]]
    candidate_index = {s[0]: i for i, s in enumerate(candidates)}

    # Every committed run shares the same cells and candidates (only the
    # per-period demand split differs); a future run that does not would break
    # the interning silently, so it is checked rather than assumed.
    demand_cell_ids = set()
    for scenario in available:
        other = _scenario_instance(scenario)
        if [c["id"] for c in other["cells"]] != [c[0] for c in model_cells]:
            raise SystemExit(f"\nERROR: scenario {scenario!r} has different "
                             f"cells from {GAME_DEMAND_SCENARIO!r}; the "
                             f"interned ids would not be shared.\n")
        if [s["id"] for s in other["candidate_stations"]] != [s[0] for s in candidates]:
            raise SystemExit(f"\nERROR: scenario {scenario!r} has different "
                             f"candidate stations from "
                             f"{GAME_DEMAND_SCENARIO!r}.\n")
        for row in other["od_demand"]:
            if row["flow"] > 0:
                demand_cell_ids.add(row["origin"])
                demand_cell_ids.add(row["dest"])

    # Upstream issue #3 (AGENTS.md "Known upstream issues"): OD rows whose cell
    # is unbuildable are not filtered, so the demand names a couple of cells the
    # model kept no candidate station in. They carry ~60 trips that no layout
    # can ever serve. They must still be drawable, so their centres come from
    # the grid and they are exported with buildable = 0.
    known = {c[0] for c in model_cells}
    extra = sorted(demand_cell_ids - known)
    cells = list(model_cells)
    buildable = [True] * len(model_cells)
    if extra:
        centres = _grid_centres()
        for cell_id in extra:
            centre = centres.get(cell_id)
            if centre is None:
                raise SystemExit(
                    f"\nERROR: demand names cell {cell_id!r}, which is neither "
                    f"in the instance's cells nor in grid.geojson -- its centre "
                    f"is unknown and trips from it could not be drawn.\n")
            cells.append((cell_id, centre[0], centre[1]))
            buildable.append(False)
    cell_index = {c[0]: i for i, c in enumerate(cells)}

    # The OD pairs that carry demand anywhere in the committed grid. Only their
    # paths are exported: the catalogue holds ~6.2k bike-carrying paths over all
    # connected pairs, the grid demands 703 of them.
    demanded = set()
    for scenario in available:
        for row in _scenario_instance(scenario)["od_demand"]:
            if row["flow"] > 0:
                demanded.add((cell_index[row["origin"]], cell_index[row["dest"]]))

    catalogue, stats = read_catalogue()
    paths = []
    for row in catalogue:
        origin = cell_index.get(row["o"])
        destination = cell_index.get(row["d"])
        if origin is None or destination is None:
            continue
        if (origin, destination) not in demanded:
            continue
        legs = []
        unknown = False
        for start, end in row["legs"]:
            a, b = candidate_index.get(start), candidate_index.get(end)
            if a is None or b is None:
                unknown = True
                break
            legs.append([a, b])
        if unknown:
            continue
        paths.append({"o": origin, "d": destination, "cat": row["cat"],
                      "rank": row["rank"], "time": row["time"], "km": row["km"],
                      "gain": row["gain"], "legs": legs, "src_id": row["src_id"]})
    # Deterministic order: by OD pair, then rank, then the upstream path id.
    paths.sort(key=lambda p: (p["o"], p["d"], p["rank"], p["src_id"]))

    arcs_file = _read_json(ARCS_FILE, "results/shared/bike_arcs.json",
                           "It is written by demo/experiments/run_model.py.")
    arcs = []
    for arc in arcs_file["arcs"]:
        a, b = candidate_index.get(arc["from"]), candidate_index.get(arc["to"])
        if a is None or b is None:
            continue
        arcs.append([a, b, round(float(arc["distance_km"]), ROUND_KM)])
    arcs.sort()

    game_demand = [[cell_index[row["origin"]], cell_index[row["dest"]],
                    int(row["period"]), int(row["flow"])]
                   for row in base["od_demand"] if row["flow"] > 0]
    game_demand.sort()

    return {
        "constants": constants,
        "scenarios": available,
        "cells": cells,
        "buildable": buildable,
        "candidates": candidates,
        "paths": paths,
        "arcs": arcs,
        "demand": game_demand,
        "periods": int(base["time_periods"]),
        "catalogue_stats": stats,
        "demanded_pairs": len(demanded),
    }


def instance_from_context(context, demand=None):
    """Build a :class:`Instance` straight from the in-memory context.

    Used while exporting, before the JSON files exist. `Instance.from_export()`
    is the same thing read back off disk, and the golden tests pin the two
    against each other.
    """
    if demand is None:
        rows, periods, label = context["demand"], context["periods"], GAME_DEMAND_PROFILE
    else:
        rows, periods = Instance._scenario_demand(
            demand, [c[0] for c in context["cells"]])
        label = demand
    table = collections.defaultdict(int)
    for origin, destination, period, flow in rows:
        table[(int(origin), int(destination), int(period))] += int(flow)
    return Instance(
        context["constants"],
        [s[0] for s in context["candidates"]],
        [s[1] for s in context["candidates"]],
        [(s[2], s[3]) for s in context["candidates"]],
        [c[0] for c in context["cells"]],
        [{"o": p["o"], "d": p["d"], "cat": p["cat"], "rank": p["rank"],
          "time": p["time"], "km": p["km"], "gain": p["gain"],
          "legs": [tuple(leg) for leg in p["legs"]]} for p in context["paths"]],
        {(a, b): km for a, b, km in context["arcs"]},
        table, periods, label)


# --------------------------------------------------------------------------
# The writers, one per file
# --------------------------------------------------------------------------

def _budget_blocks(constants):
    """The four game budgets, with the capex and operating envelope each one
    takes from its scenario file."""
    blocks = []
    for scenario, capex in GAME_BUDGETS:
        definition = _read_json(SCENARIOS_DIR / f"{scenario}.json",
                                f"scenarios/{scenario}.json")
        parameters = definition["model_parameters"]
        if int(parameters["total_budget"]) != capex:
            raise SystemExit(
                f"\nERROR: scenarios/{scenario}.json declares total_budget "
                f"{parameters['total_budget']}, the game expects {capex}.\n")
        ratio = float(parameters["op_budget_ratio"])
        blocks.append({
            "scenario": scenario,
            "capex_eur": capex,
            "op_budget_ratio": ratio,
            "ops_budget_eur": round(capex * ratio, 6),
            "epsilon": float(parameters["epsilon"]),
            "max_stations": max_stations(capex, constants),
        })
    return blocks


def write_constants(context, out_dir):
    constants = context["constants"]
    payload = {
        "method": _method(
            "Unit costs and behavioural constants of the frozen model, plus the "
            "four budgets the game offers. Nothing here is a hand-copied "
            "literal: every value is read at export time from "
            "network-design-bss/src/ (AGENTS.md rule 2).",
            ["network-design-bss/src/util/cost.py",
             "network-design-bss/src/util/util.py",
             "demo/experiments/scenarios/<id>.json"],
            ["constants flow one way: src/ -> this file -> the TypeScript "
             "engine. demo/experiments/tests/test_src_parity.py fails loudly if "
             "they drift.",
             "CAPACITY_UB = 30 docks per station is what caps served flow once "
             "the budget is slack, not money (spike/RESULTS.md section 3)."]),
        "source": constants_source(),
        "costs": {k: constants[k] for k in
                  ("station_setup_cost", "dock_cost", "unit_bike_cost",
                   "dispatch_fixed_cost", "rebalancing_unit_cost")},
        "model": {k: constants[k] for k in
                  ("PENALTY_COEFFICIENT", "CAPACITY_UB", "MIN_CAPACITY_IF_BUILT",
                   "CAPACITY_REBALANCING_VEHICLE", "NUM_SHORTEST_PATHS",
                   "EPSILON", "WALK_CATCHMENT_RADIUS", "TIME_PERIODS")},
        "h3_version": constants["h3_version"],
        "periods": context["periods"],
        "budgets": _budget_blocks(constants),
    }
    return _write_json(out_dir / "constants.json", payload)


def write_candidates(context, out_dir):
    types = ["BikeStation", "TransferStation"]
    rows = []
    for station_id, kind, lon, lat in context["candidates"]:
        if kind not in types:
            types.append(kind)
        rows.append([station_id, types.index(kind),
                     round(float(lon), ROUND_COORD), round(float(lat), ROUND_COORD)])
    payload = {
        "method": _method(
            "The candidate stations the model may open. A station's INTEGER ID "
            "is its index in `candidates`; every other game file refers to it "
            "that way.",
            [f"demo/experiments/results/{GAME_DEMAND_SCENARIO}/instance.json"],
            ["identical in all 21 committed runs; the exporter checks it."]),
        "fields": ["id", "type_index", "lon", "lat"],
        "types": types,
        "count": len(rows),
        "candidates": rows,
    }
    return _write_json(out_dir / "candidates.json", payload)


def write_cells(context, out_dir):
    rows = [[cell_id, round(float(lon), ROUND_COORD), round(float(lat), ROUND_COORD),
             1 if flag else 0]
            for (cell_id, lon, lat), flag in zip(context["cells"],
                                                 context["buildable"])]
    payload = {
        "method": _method(
            "The H3 r9 zone centres demand is aggregated to. A cell's INTEGER "
            "ID is its index in `cells`; trips are drawn from these centres.",
            [f"demo/experiments/results/{GAME_DEMAND_SCENARIO}/instance.json",
             "demo/experiments/data/geneva_1.5km-radius/grid.geojson"],
            ["`buildable` is 0 for a cell the demand names but the model kept "
             "no candidate station in (AGENTS.md known upstream issue #3): "
             "its trips can never be served by any layout. Its centre comes "
             "from the grid, so it can still be drawn."]),
        "fields": ["id", "lon", "lat", "buildable"],
        "count": len(rows),
        "buildable_count": sum(row[3] for row in rows),
        "cells": rows,
    }
    return _write_json(out_dir / "cells.json", payload)


def write_paths(context, out_dir):
    rows = [[p["o"], p["d"], p["cat"], p["rank"], p["time"], p["km"], p["gain"],
             p["legs"]] for p in context["paths"]]
    payload = {
        "method": _method(
            "The candidate paths of the DEMANDED OD pairs, as enumerated once "
            "by the frozen model over ALL candidate stations. With the station "
            "set fixed, a path is usable iff every station on its bike legs is "
            "open (model/constraints.py:129-152) -- that is the whole of what "
            "the design decides.",
            [_relative(PICKLE),
             "demo/experiments/results/<scenario>/instance.json"],
            ["BIKE LEGS ARE EXPLICIT, one per bike arc of arcs_traversed. A "
             "path's de-duplicated station list is NOT its legs: [A,B,C,D] can "
             "be two disjoint legs. Never re-pair the list.",
             "walk_pt paths carry no bike and are dropped; flow_walk_pt == 0 in "
             "all 21 committed runs.",
             "category 0 = bike_only, 1 = bike_pt. `rank` feeds the objective's "
             "(1 - PENALTY_COEFFICIENT * rank) weight."]),
        "fields": ["origin_cell", "dest_cell", "category", "rank",
                   "time_min", "distance_km", "time_gain_min", "legs"],
        "categories": ["bike_only", "bike_pt"],
        "count": len(rows),
        "catalogue": context["catalogue_stats"],
        "demanded_od_pairs": context["demanded_pairs"],
        "source_path_ids": [p["src_id"] for p in context["paths"]],
        "paths": rows,
    }
    return _write_json(out_dir / "paths.json", payload)


def write_arcs(context, out_dir):
    payload = {
        "method": _method(
            "The ride network between candidate stations: the arcs a truck may "
            "move bikes along, with the distance the operating cost is computed "
            "from (dispatch_fixed_cost + rebalancing_unit_cost * km).",
            ["demo/experiments/results/shared/bike_arcs.json"],
            ["distances rounded to 6 decimals of a kilometre (~1 mm), so the "
             "Python reference and the browser price a truck move identically."]),
        "fields": ["from_station", "to_station", "distance_km"],
        "count": len(context["arcs"]),
        "arcs": context["arcs"],
    }
    return _write_json(out_dir / "arcs.json", payload)


def write_demand(context, out_dir):
    payload = {
        "method": _method(
            "The game's own per-period OD demand: the potential trips a day the "
            "optimiser was given, split over the three periods.",
            [f"demo/experiments/results/{GAME_DEMAND_SCENARIO}/instance.json"],
            ["the multinomial period split depends on the temporal profile and "
             "the seed, so this is ONE profile. The 15 non-rhythm committed "
             "runs share it exactly; the rhythm_* runs do not, and their golden "
             "vectors read their own instance.json.",
             "a flow is a potential trip built from six months of records, an "
             "upper bound and not a forecast (open upstream question 1)."]),
        "profile": GAME_DEMAND_PROFILE,
        "scenario": GAME_DEMAND_SCENARIO,
        "periods": context["periods"],
        "fields": ["origin_cell", "dest_cell", "period", "flow"],
        "count": len(context["demand"]),
        "total": sum(row[3] for row in context["demand"]),
        "demand": context["demand"],
    }
    return _write_json(out_dir / "demand_reference.json", payload)


def write_coverage(context, out_dir, instance):
    """Per candidate: the cells inside its walk catchment and the potential flow
    it could touch; plus the reach table the live preview reads.

    THE EXACT DEFINITIONS, because the UI quotes these numbers:

    * `cells[i]`       -- every cell whose CENTRE lies within
                          WALK_CATCHMENT_RADIUS (0.3 km, util/util.py:50) of
                          candidate i, by the same haversine the demo uses
                          (pipeline/geometry.py, pinned against util.util by
                          tests/test_src_parity.py). Centre-to-centre, not
                          polygon overlap: the model itself assigns demand by
                          cell centre.
    * `potential_flow[i]` -- the total demand of the (OD, period) rows that have
                          AT LEAST ONE path whose bike legs touch candidate i.
                          A static, generous upper bound: it ignores the other
                          stations the same path needs, so a single station
                          "covers" nothing on its own. Shown as "within reach",
                          never as "served".
    * `reach.rows`     -- one row per demanded (origin, destination, period):
                          its flow and the de-duplicated STATION SETS that would
                          make it servable (one set per candidate path). A row
                          is within reach of a layout iff one of its sets is a
                          subset of the layout. This is exactly the availability
                          test the LP applies, so reach is an upper bound on
                          served flow -- measured 1.04x at 80 k EUR and 1.90x at
                          20 k EUR (spike/RESULTS.md).
    """
    from .pipeline.geometry import haversine_km

    radius = instance.constants["WALK_CATCHMENT_RADIUS"]
    cells = context["cells"]
    within = []
    for _id, _type, lon, lat in context["candidates"]:
        near = [index for index, (_c, clon, clat) in enumerate(cells)
                if haversine_km(lat, lon, clat, clon) <= radius]
        within.append(near)

    potential = [round(value, 6) for value in potential_flow_by_candidate(instance)]
    rows = reach_options(instance)
    payload = {
        "method": _method(
            "What each candidate station can reach, and what each demand row "
            "needs. Feeds the live 'within reach' preview while the visitor "
            "places stations, and the follow-the-demand assistant.",
            ["demo/experiments/results/shared/game/paths.json",
             "demo/experiments/results/shared/game/demand_reference.json",
             "network-design-bss/src/util/util.py (WALK_CATCHMENT_RADIUS)"],
            ["`within reach` is an UPPER BOUND on served flow (1.04x at 80 k, "
             "1.90x at 20 k EUR). The UI must never call it 'served'.",
             "cells are matched centre to centre, the way the model assigns "
             "demand; not by polygon overlap."]),
        "walk_catchment_km": radius,
        "demand_profile": GAME_DEMAND_PROFILE,
        "fields": {"cells": "cell indices within the walk catchment",
                   "potential_flow": "demand of the OD-periods any path through "
                                     "this candidate could carry"},
        "cells": within,
        "potential_flow": potential,
        "reach": {
            "fields": ["origin_cell", "dest_cell", "period", "flow", "sets"],
            "count": len(rows),
            "rows": [[row["od"][0], row["od"][1], row["t"], row["flow"],
                      row["sets"]] for row in rows],
        },
    }
    return _write_json(out_dir / "coverage.json", payload)


def _built_stations(scenario):
    plan = _read_json(RESULTS_DIR / scenario / "model_plan.json",
                      f"model_plan.json for scenario {scenario!r}")
    return [station["id"] for station in plan["stations"] if station["built"]]


def _scenario_budgets(scenario):
    """(capex, operating budget, epsilon) as the run itself used them."""
    paper = _read_json(RESULTS_DIR / scenario / "kpis.json",
                       f"kpis.json for scenario {scenario!r}")["paper"]
    epsilon = None
    metrics = RESULTS_DIR / scenario / "metrics.json"
    if metrics.is_file():
        with open(metrics, encoding="utf-8") as handle:
            epsilon = json.load(handle).get("epsilon")
    return (paper["budget_eur"], paper.get("op_budget_eur"),
            float(epsilon or 0.0))


def write_golden(context, out_dir, log=print):
    """One golden vector per committed design: its stations, its budget, and the
    engine's evaluation with and without trucks (no `flows` list)."""
    written = []
    for scenario in context["scenarios"]:
        # Always the scenario's OWN demand: the multinomial period split
        # depends on the temporal profile and the seed, so a golden vector must
        # not borrow another run's demand.
        instance = instance_from_context(context, demand=scenario)
        stations = _built_stations(scenario)
        budget, ops_budget, epsilon = _scenario_budgets(scenario)
        with_trucks = evaluate(instance, stations, budget, ops_budget, epsilon,
                               trucks=True)
        without = evaluate(instance, stations, budget, ops_budget, epsilon,
                           trucks=False)
        paper = _read_json(RESULTS_DIR / scenario / "kpis.json",
                           f"kpis.json for {scenario}")["paper"]
        payload = {
            "method": _method(
                "Golden vector: the reference evaluator applied to one "
                "committed design. Pins demo/experiments/fixed_design.py and, "
                "through it, the TypeScript engine, against the published run.",
                [f"demo/experiments/results/{scenario}/model_plan.json",
                 f"demo/experiments/results/{scenario}/kpis.json"],
                ["`flows` is dropped: a golden vector must stay small.",
                 "`published` is the run's own kpis.json `paper` block, for the "
                 "fidelity comparison only -- it is NOT what the engine "
                 "reproduces exactly (the LP relaxation overshoots by up to "
                 "1.6 % on served flow)."]),
            "scenario": scenario,
            "demand_profile": instance.demand_label,
            "budget_eur": budget,
            "ops_budget_eur": ops_budget,
            "epsilon": epsilon,
            "stations": sorted(instance.resolve(stations)),
            "station_ids": sorted(stations),
            "with_trucks": summary(with_trucks),
            "without_trucks": summary(without),
            "published": {"served_total": paper["served_total"],
                          "served_ratio": paper["served_ratio"],
                          "pt_assisted_share": paper["pt_assisted_share"],
                          "docks": paper["docks"], "bikes": paper["bikes"]},
        }
        path = _write_json(out_dir / "golden" / f"{scenario}.json", payload)
        written.append(path)
        ratio = with_trucks["served"] / paper["served_total"]
        log(f"  golden {scenario:16s} served {with_trucks['served']:8.1f} "
            f"vs published {paper['served_total']:5d}  ratio {ratio:6.4f}  "
            f"({with_trucks['lp']['seconds'] * 1000:5.0f} ms)")
    return written


def write_references(context, out_dir, log=print):
    """Per game budget: what the engine says about the optimiser's own layout,
    about a random planner, and about the follow-the-demand rule.

    These are the numbers the game compares a visitor to, so all four come from
    the SAME engine -- never from the published run. The published figure is
    carried alongside for the "show the proof" popup.
    """
    rows = []
    random_source = random.Random(RANDOM_SEED)
    for scenario, capex in GAME_BUDGETS:
        instance = instance_from_context(context, demand=scenario)
        budget, ops_budget, epsilon = _scenario_budgets(scenario)
        optimiser = _built_stations(scenario)
        count = len(optimiser)
        candidates = list(range(len(instance.candidate_ids)))

        with_trucks = evaluate(instance, optimiser, budget, ops_budget, epsilon,
                               trucks=True)
        without = evaluate(instance, optimiser, budget, ops_budget, epsilon,
                           trucks=False)

        served = []
        for _ in range(RANDOM_LAYOUTS):
            layout = random_source.sample(candidates, count)
            served.append(evaluate(instance, layout, budget, ops_budget,
                                   epsilon, trucks=True)["served"])
        served.sort()
        median = served[len(served) // 2]

        rows_reach = reach_options(instance)
        demand_rule = assistant_order(rows_reach, len(candidates), count)
        rule_result = evaluate(instance, demand_rule, budget, ops_budget,
                               epsilon, trucks=True)

        paper = _read_json(RESULTS_DIR / scenario / "kpis.json",
                           f"kpis.json for {scenario}")["paper"]
        rows.append({
            "scenario": scenario,
            "budget_eur": capex,
            "ops_budget_eur": ops_budget,
            "epsilon": epsilon,
            "n_stations": count,
            "optimiser": {
                "stations": sorted(instance.resolve(optimiser)),
                "with_trucks": summary(with_trucks),
                "without_trucks": summary(without),
                "published_served_total": paper["served_total"],
                "published_served_ratio": paper["served_ratio"],
            },
            "random": {
                "layouts": RANDOM_LAYOUTS,
                "seed": RANDOM_SEED,
                "n_stations": count,
                "served_median": round(median, 6),
                "served_min": round(served[0], 6),
                "served_max": round(served[-1], 6),
                "served_ratio_median": round(median / instance.demand_total, 6),
            },
            "demand_rule": {
                "stations": demand_rule,
                "served": round(rule_result["served"], 6),
                "served_ratio": round(rule_result["served_ratio"], 6),
                "pt_share": round(rule_result["pt_share"], 6),
            },
            # The estimate fallback calibrates a reach-based bound against the
            # engine; infra/estimateEvaluator.ts reads exactly this factor.
            "reach_calibration": _calibration(instance, rows_reach,
                                              optimiser, with_trucks),
        })
        log(f"  reference {scenario:14s} optimiser {with_trucks['served']:7.1f} "
            f"| random median {median:7.1f} | demand rule "
            f"{rule_result['served']:7.1f}")

    payload = {
        "method": _method(
            "What the game compares a visitor's layout to, at each budget. "
            "Every value is produced by demo/experiments/fixed_design.py, so "
            "both sides of 'you vs the optimiser' are measured by the same "
            "engine; the published figure is carried alongside for the proof "
            "popup.",
            ["demo/experiments/results/<scenario>/model_plan.json",
             "demo/experiments/results/<scenario>/kpis.json"],
            [f"the random planner draws {RANDOM_LAYOUTS} layouts at the "
             f"optimiser's own station count with seed {RANDOM_SEED}; it is "
             f"reproducible, not a live sample.",
             "the demand rule is the assistant's own order "
             "(fixed_design.assistant_order), so the game's Assistant and this "
             "reference are the same rule.",
             "`reach_calibration` is the estimate fallback's factor: served / "
             "within-reach on the optimiser's layout at this budget."]),
        "budgets": rows,
    }
    return _write_json(out_dir / "references.json", payload)


def _calibration(instance, rows_reach, layout, result):
    """served / within-reach on one layout: the factor the estimate fallback
    multiplies a reach bound by when the solver is unavailable."""
    reach = reach_flow(rows_reach, instance.resolve(layout))
    if reach <= 0:
        return {"reach": 0.0, "served": round(result["served"], 6), "factor": 1.0}
    return {"reach": round(reach, 6),
            "served": round(result["served"], 6),
            "factor": round(result["served"] / reach, 6)}


# --------------------------------------------------------------------------
# Building everything
# --------------------------------------------------------------------------

def build(out_dir=None, log=print):
    """Write the whole payload.

    :param out_dir: destination, default results/shared/game/.
    :param log: where progress goes; tests pass a sink.
    :return: {relative name: Path} of everything written.
    """
    out_dir = Path(out_dir or GAME_DIR)
    log("reading the committed inputs and the path catalogue ...")
    context = collect()
    stats = context["catalogue_stats"]
    log(f"  {len(context['candidates'])} candidates, "
        f"{len(context['cells'])} cells, {len(context['arcs'])} ride arcs")
    log(f"  {stats['bike_carrying_paths']} bike-carrying paths in the catalogue "
        f"-> {len(context['paths'])} on the {context['demanded_pairs']} "
        f"demanded OD pairs")

    instance = instance_from_context(context)
    written = {}
    for name, writer in (("constants.json", write_constants),
                         ("candidates.json", write_candidates),
                         ("cells.json", write_cells),
                         ("paths.json", write_paths),
                         ("arcs.json", write_arcs),
                         ("demand_reference.json", write_demand)):
        written[name] = writer(context, out_dir)
    written["coverage.json"] = write_coverage(context, out_dir, instance)

    log(f"evaluating the references ({len(GAME_BUDGETS)} budgets x "
        f"{RANDOM_LAYOUTS + 3} layouts) ...")
    written["references.json"] = write_references(context, out_dir, log=log)

    log(f"evaluating the golden vectors ({len(context['scenarios'])} designs "
        f"x 2 solves) ...")
    for path in write_golden(context, out_dir, log=log):
        written[f"golden/{path.name}"] = path
    return written


def report_sizes(written, log=print):
    """Print raw and gzipped sizes -- the two numbers that decide the payload."""
    log(f"\n  {'file':26s} {'raw':>9s} {'gzip':>9s}")
    raw_total = packed_total = 0
    goldens = [p for name, p in written.items() if name.startswith("golden/")]
    for name, path in written.items():
        if name.startswith("golden/"):
            continue
        raw, packed = _sizes(path)
        raw_total += raw
        packed_total += packed
        log(f"  {name:26s} {raw / 1024:8.1f}K {packed / 1024:8.1f}K")
    golden_raw = sum(_sizes(p)[0] for p in goldens)
    golden_packed = sum(_sizes(p)[1] for p in goldens)
    log(f"  {f'golden/ ({len(goldens)} files)':26s} {golden_raw / 1024:8.1f}K "
        f"{golden_packed / 1024:8.1f}K   (not shipped to the browser)")
    log(f"  {'-' * 26} {'-' * 9} {'-' * 9}")
    log(f"  {'browser payload':26s} {raw_total / 1024:8.1f}K "
        f"{packed_total / 1024:8.1f}K")
    return {"raw_bytes": raw_total, "gzip_bytes": packed_total,
            "golden_raw_bytes": golden_raw, "golden_gzip_bytes": golden_packed}


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python -m demo.experiments.game_export",
        description="Write the planner game's browser payload under "
                    "demo/experiments/results/shared/game/.")
    parser.add_argument("--out", default=None,
                        help="destination directory "
                             "(default: results/shared/game)")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    log = (lambda *a, **k: None) if args.quiet else print
    written = build(out_dir=args.out, log=log)
    report_sizes(written, log=log)
    log(f"\nwrote {len(written)} files under "
        f"{_relative(Path(args.out or GAME_DIR))}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
