"""
File: instance.py
Description: Readers for the artefacts that describe the problem the
             optimiser actually solved -- the *instance* (its zones, its
             candidate station sites, its per-period OD demand), its solved
             *plan* (inventories, rebalancing moves, path assignments) and
             the *bike arcs* it routed on.

Why this module exists
----------------------
The demo's replay/sample modes simulate the *observed* 11.5 trips/day, a
demand ~125x smaller than the 1,453-trip planning day the model was sized
for (`.specs/demo-pipeline/findings.md` #1). Nothing computed at that scale
is comparable with `metrics.json`. Phase B adds an ``instance`` simulation
mode that replays the model's own demand against a design; this module is
the I/O edge that feeds it.

Three artefacts, three availabilities:

``instance.json``   committed next to every optimiser scenario today. Slimmed
                    dump of ``h3_instances_json/<config_name>.txt``: the 56
                    zones the model kept (3 of 59 H3 cells are dropped as
                    unbuildable, finding #7), the 100 candidate station sites
                    (cell centres + PT stops merged within 100 m, finding #8)
                    and the 973 demand rows (703 OD pairs x 3 periods,
                    1,453 trips).

``model_plan.json`` written by the design layer after a Gurobi run; **absent
                    today**. Carries the solved ``v``/``r``/``n``/``x``
                    variables (plan.md 4.7).

``shared/bike_arcs.json``  the model's OSM-routed ride arcs between candidate
                    stations within 1 km straight-line; **absent today**.

Every loader tolerates absence by returning ``None``, so the simulator
degrades to documented approximations (haversine x detour distances, greedy
rebalancing) rather than failing.

Coordinate convention: the JSON carries ``lon``/``lat`` fields explicitly;
this module hands out ``(lat, lon)`` tuples, the demo's order everywhere
(``pipeline.geometry.haversine_km``).

DEPRECATED (demo v3, 2026-09-15): replaced by reading ``model_plan.json``
directly (``evaluate.paper_kpis``), which is the model's own answer rather
than the input to a re-simulation of it; removed once the paper-grid runs
are validated. The whole module goes with the simulator's ``instance`` mode
and ``baseline.py``: importing it warns, and nothing outside those two
deprecated paths imports it any more.
"""

import json
import warnings
from pathlib import Path

from .. import RESULTS_DIR

warnings.warn(
    "DEPRECATED (demo v3, 2026-09-15): demo.experiments.pipeline.instance is "
    "replaced by reading model_plan.json directly (evaluate.paper_kpis); "
    "removed once the paper-grid runs are validated.",
    DeprecationWarning, stacklevel=2)

#: The scenario whose committed instance stands in when a design has none of
#: its own. All three optimiser scenarios solve the *same* instance -- same
#: cells, same candidates, same demand; only the budget and the period
#: weights differ -- so any of them describes the problem, and S2 is the
#: reference plan the demo narrates around.
REFERENCE_INSTANCE_SCENARIO = "S2_balanced"

#: Default location of the model's routed ride arcs (shared by every
#: scenario: the arcs depend on the candidate set, not on the budget).
BIKE_ARCS_PATH = RESULTS_DIR / "shared" / "bike_arcs.json"


def load_instance(path):
    """Read an ``instance.json`` -- the problem the optimiser solved.

    :param path: path of the instance file.
    :return: the parsed dict (keys: cells, candidate_stations, od_demand,
             time_period_weights, ...).
    """
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def cells_of(instance):
    """The model's zones as ``{cell_id: (lat, lon)}``.

    These are the *kept* cells only (56 of the layer's 59). Demand rows may
    reference a dropped cell; callers that must not lose demand fall back to
    the raw grid for those (see ``simulate.DaySimulation``).
    """
    return {c["id"]: (float(c["lat"]), float(c["lon"]))
            for c in instance["cells"]}


def candidates_of(instance):
    """The model's candidate station sites.

    :return: list of ``{"id", "type", "lat", "lon"}`` in instance order.
             ``type`` is ``BikeStation`` (a cell centre) or
             ``TransferStation`` (a PT stop the model kept as a candidate).
    """
    return [{"id": c["id"], "type": c["type"],
             "lat": float(c["lat"]), "lon": float(c["lon"])}
            for c in instance["candidate_stations"]]


def demand_of(instance):
    """The model's demand as ``[(origin, dest, period, flow), ...]``.

    One row per (OD pair, period) with a positive flow; ``period`` is the
    model's abstract index 0/1/2 (it has no hour semantics of its own,
    finding #10).
    """
    return [(r["origin"], r["dest"], int(r["period"]), int(r["flow"]))
            for r in instance["od_demand"]]


def demand_pairs(instance):
    """The distinct OD pairs carrying demand -- the denominator of the
    model's count-based ``covered_od_ratio`` (finding #5)."""
    return {(r["origin"], r["dest"]) for r in instance["od_demand"]}


def load_model_plan(scenario_dir):
    """Read ``model_plan.json`` from a scenario directory, if it exists.

    :param scenario_dir: the result directory of a design.
    :return: the parsed plan dict, or None when the design has no solved
             plan (every design today, and every ``baseline.py`` design
             forever -- a naive design is not the output of an optimiser).
    """
    if scenario_dir is None:
        return None
    path = Path(scenario_dir) / "model_plan.json"
    if not path.is_file():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_bike_arcs(path=None):
    """Read the model's routed ride arcs, if they have been exported.

    :param path: bike_arcs.json path; defaults to
                 ``results/shared/bike_arcs.json``.
    :return: ``{(from_id, to_id): (distance_km, travel_time_min)}``, or None
             when the file is absent. The travel time already includes the
             model's ``BIKE_ACCESS_EGRESS_TIME`` (1 min).
    """
    path = Path(path) if path else BIKE_ARCS_PATH
    if not path.is_file():
        return None
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    arcs = payload["arcs"] if isinstance(payload, dict) else payload
    return {(a["from"], a["to"]): (float(a["distance_km"]),
                                   float(a["travel_time_min"]))
            for a in arcs}


def find_instance(stations_file):
    """Locate the instance describing the problem a design belongs to.

    Resolution order:

    1. ``instance.json`` next to the design -- the instance that design was
       solved for;
    2. the reference scenario's instance (``S2_balanced``) -- correct for
       any design over the same study area, since the three scenarios share
       cells, candidates and demand;
    3. None, when neither exists (the caller then cannot run instance mode).

    :param stations_file: path of a design's stations.json.
    :return: a Path, or None.
    """
    if stations_file is not None:
        local = Path(stations_file).resolve().parent / "instance.json"
        if local.is_file():
            return local
    reference = RESULTS_DIR / REFERENCE_INSTANCE_SCENARIO / "instance.json"
    return reference if reference.is_file() else None
