"""
File: run_model.py
Description: Run one prebuilt scenario (`scenarios/S*.json`) against the frozen
             optimisation model and save its design where the demo layer reads it.

This replaces the edit-and-revert procedure that `scenarios/README.md` describes.
That procedure works, but it makes a scenario run depend on a local, unversioned
edit to `network-design-bss/src/instance_builder.py` -- a step that is easy to
forget to revert, and impossible to audit afterwards from the result files.

The whole scenario surface of the frozen model is one function,
`instance_builder.generate_h3_instances()`, which takes no arguments and builds a
`ScenarioConfig` inline. So instead of editing it, this module **replaces it in
`sys.modules` for the duration of one run** with a function that builds the same
`ScenarioConfig` from a scenario JSON. `NetworkDesignRun.build_instance()` does
`from instance_builder import generate_h3_instances` at call time, so it picks up
the replacement; the file on disk is never touched and `git diff` stays empty.

Everything else is the frozen code, called with the arguments
`main.main_run_single_instance` gives it.

    from demo.experiments.run_model import run_scenario

    result = run_scenario("S2_balanced")
    print(result["metrics"]["covered_od_ratio"], len(result["stations"]))

Or from a shell:

    python -m demo.experiments.run_model budget_080k rhythm_uniform
    python -m demo.experiments.run_model --write-scenarios   # generate, run nothing

The scenarios themselves are generated, not hand-written: :data:`PAPER_GRID`
is the single definition of the 18 runs the demonstration is built on (the
paper's budget, operational-ratio, epsilon and temporal-profile axes around
its Table D.8 baseline), and :func:`write_scenarios` turns it into
`scenarios/<id>.json`. Existing files are kept unless `--overwrite` is
passed, so copy edited in place survives a regeneration.

Cost note: the shortest-path enumeration is the expensive stage (~50 min cold) and
is cached on disk under keys that carry **no scenario parameter** -- so running the
three scenarios back to back pays it once and the rest take minutes.

Files a run writes:

    results/<scenario>/stations.json    the stations built, with capacity and
                                        starting bikes (the design)
    results/<scenario>/metrics.json     the FULL evaluator row of the frozen
                                        model (`NetworkDesignRun.experiment_row`)
                                        under a provenance block
    results/<scenario>/model_plan.json  everything else the solve decided:
                                        inventory per period, rebalancing,
                                        rider flows, path assignments, demand
    results/<scenario>/instance.json    the instance it was solved on, slimmed
    results/shared/bike_arcs.json       the ride network the model uses --
                                        scenario-independent, so written once

`pipeline/model_plan.py` builds the last three; this module only calls it and
writes what it returns.
"""

import argparse
import contextlib
import importlib
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from . import REPO_ROOT, RESULTS_DIR
from .pipeline.model_plan import extract_bike_arcs, extract_model_plan, slim_instance

#: Where the prebuilt scenario definitions live.
SCENARIOS_DIR = Path(__file__).resolve().parent / "scenarios"

#: The SDK that drives the frozen model, kept outside network-design-bss/src/.
SDK_DIR = REPO_ROOT / "network-design-bss" / "sdk-builder"

# ---------------------------------------------------------------------------
# The paper grid: the 18 runs the v3 demonstration is built on.
# ---------------------------------------------------------------------------

#: Schema tag every generated scenario file carries.
SCENARIO_SCHEMA = "scenario-v3"

#: What every run of the grid shares -- and, taken alone, the paper's own
#: baseline (Table D.8: 80 000 EUR of investment, operational ratio 0.05,
#: T = 3 periods, epsilon 0.04, integrated solve). A grid entry overrides at
#: most one of these values, so any difference between two runs is
#: attributable to that one parameter.
BASELINE_PARAMETERS = {
    "total_budget": 80000,
    "op_budget_ratio": 0.05,
    "demand_periods": 3,
    "split_method": "multinomial",
    "seed": 20,
    "epsilon": 0.04,
    "solve_mode": "integrated",
}

#: Period weights per temporal profile, over the three periods 06-10 / 10-16 /
#: 16-22. "geneva_weekday" is None because it is not a choice: it is measured
#: from the observed trips and read from data/profiles.json when the scenario
#: files are generated (:func:`period_weights_for`).
TEMPORAL_PROFILES = {
    "bimodal": [0.4, 0.2, 0.4],
    "uniform": [0.3333, 0.3333, 0.3334],
    "sharp": [0.6, 0.2, 0.2],
    "geneva_weekday": None,
}

#: The grid itself, one entry per run -- the single place the 18 scenarios are
#: defined. `model_parameters` holds only what the entry changes relative to
#: :data:`BASELINE_PARAMETERS`; `period_weights` is never written here, it
#: follows from `temporal_profile`. :func:`scenario_document` merges the two
#: into the complete scenario JSON of the v3 contract.
#:
#: `family` is the sensitivity axis the run belongs to ("baseline" for the
#: reference run, which belongs to every family and is added to each family's
#: chart at its own axis value); `role` is "card" for the four plans the
#: demonstration offers the visitor (starter / essential / reference /
#: ambitious) and "compare" for the points that exist only in the comparison
#: charts.
PAPER_GRID = (
    # -- family: budget (Table 2 budgets; Fig. 9, 12a, 14) -------------------
    {
        "id": "budget_020k",
        "family": "budget",
        "role": "card",
        "card": "starter",
        "title": "Starter budget",
        "axis_label": "20 000 €",
        "temporal_profile": "bimodal",
        "outside_paper_range": True,
        "paper_reference": ("Below Table 2's budget range; added to locate "
                            "the PT-integration threshold of Fig. 14"),
        "audience_pitch": ("The city tests the water with the smallest "
                           "budget on this page -- what does a seed network "
                           "buy, and what does it leave out?"),
        "narrative": (
            "Twenty thousand euros is below the range the study examines "
            "(Table 2); this run was added to locate the point where "
            "public-transport integration begins (Fig. 14). With so little "
            "money the optimiser buys coverage first: a few small stations "
            "at the zone centres that carry the most demand, and only a "
            "handful at public-transport stops. Read this plan as the seed "
            "every other plan grows from -- a bike-only service for a "
            "fraction of the potential riders, against which each extra "
            "euro of the larger budgets can be measured."),
        "model_parameters": {"total_budget": 20000},
    },
    {
        "id": "budget_040k",
        "family": "budget",
        "role": "compare",
        "title": "Low budget",
        "axis_label": "40 000 €",
        "temporal_profile": "bimodal",
        "outside_paper_range": True,
        "paper_reference": ("Below Table 2's budget range; added to locate "
                            "the PT-integration threshold of Fig. 14"),
        "model_parameters": {"total_budget": 40000},
    },
    {
        "id": "budget_060k",
        "family": "budget",
        "role": "card",
        "card": "essential",
        "title": "Essential plan",
        "axis_label": "60 000 €",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 2 budget 60 kEUR (lower end); Fig. 9, 12a, 14",
        "audience_pitch": ("The city invests the minimum of the paper's "
                           "range -- who is left out?"),
        "narrative": (
            "Sixty thousand euros is the smallest budget the study examines. "
            "The optimiser has to triage: it buys the stations and docks that "
            "carry the most demand and puts them where cycling and public "
            "transport reinforce each other, leaving the thinner corridors "
            "uncovered. Read this plan for what a minimal investment cannot "
            "reach -- which neighbourhoods stay outside the network, and how "
            "much of the potential demand goes unserved."),
        "model_parameters": {"total_budget": 60000},
    },
    {
        "id": "budget_080k",
        "family": "baseline",
        "role": "card",
        "card": "reference",
        "title": "Reference plan",
        "axis_label": "80 000 €",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table D.8 baseline; Table 2",
        "audience_pitch": ("The paper's baseline: 80 000 EUR of investment, "
                           "5 % of it kept for daily operations."),
        "narrative": (
            "This is the configuration the published study uses as its "
            "reference (Table D.8): 80 000 EUR of capital, an operational "
            "envelope of 5 % for moving bikes around, three demand periods "
            "and a moderate penalty on truck dispatches. Every other plan on "
            "this page changes exactly one of those settings, so whatever "
            "differs is attributable to that one change."),
        "model_parameters": {},
    },
    {
        "id": "budget_100k",
        "family": "budget",
        "role": "compare",
        "title": "Extended plan",
        "axis_label": "100 000 €",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 2 budget 100 kEUR; Fig. 9, 12a, 14",
        "model_parameters": {"total_budget": 100000},
    },
    {
        "id": "budget_120k",
        "family": "budget",
        "role": "card",
        "card": "ambitious",
        "title": "Ambitious plan",
        "axis_label": "120 000 €",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 2 budget 120 kEUR (upper end); Fig. 9, 12a, 14",
        "audience_pitch": ("Is more always better? Twice the essential "
                           "budget, and the returns start to flatten."),
        "narrative": (
            "At 120 000 EUR the city buys the top of the paper's range. "
            "Nearly every zone gets a station and the network reaches deep "
            "into the tram and bus map -- but each additional euro buys fewer "
            "newly served trips than the one before it. Put the served share "
            "and the investment per served trip next to the reference plan: "
            "the gap between them is the diminishing return the model exists "
            "to quantify."),
        "model_parameters": {"total_budget": 120000},
    },

    # -- family: ops_ratio (Table 2 operational ratio; Fig. 7-8) -------------
    {
        "id": "ops_000",
        "family": "ops_ratio",
        "role": "compare",
        "title": "No operations budget",
        "axis_label": "0 %",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 2 operational ratio 0; Fig. 7-8",
        "model_parameters": {"op_budget_ratio": 0.0},
    },
    {
        "id": "ops_025",
        "family": "ops_ratio",
        "role": "compare",
        "title": "Lean operations",
        "axis_label": "2.5 %",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 2 operational ratio 0.025; Fig. 7-8",
        "model_parameters": {"op_budget_ratio": 0.025},
    },
    {
        "id": "ops_075",
        "family": "ops_ratio",
        "role": "compare",
        "title": "Generous operations",
        "axis_label": "7.5 %",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 2 operational ratio 0.075; Fig. 7-8",
        "model_parameters": {"op_budget_ratio": 0.075},
    },
    {
        "id": "ops_100",
        "family": "ops_ratio",
        "role": "compare",
        "title": "Double operations",
        "axis_label": "10 %",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 2 operational ratio 0.10; Fig. 7-8",
        "model_parameters": {"op_budget_ratio": 0.10},
    },
    {
        "id": "ops_125",
        "family": "ops_ratio",
        "role": "compare",
        "title": "Maximum operations",
        "axis_label": "12.5 %",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 2 operational ratio 0.125; Fig. 7-8",
        "model_parameters": {"op_budget_ratio": 0.125},
    },

    # -- family: epsilon (Table 3; Fig. 6-8) --------------------------------
    {
        "id": "eps_000",
        "family": "epsilon",
        "role": "compare",
        "title": "No dispatch penalty",
        "axis_label": "ε = 0",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 3 aggregates epsilon 0; Fig. 6-8",
        "model_parameters": {"epsilon": 0.0},
    },
    {
        "id": "eps_001",
        "family": "epsilon",
        "role": "compare",
        "title": "Minimal dispatch penalty",
        "axis_label": "ε = 0.01",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": ("Table 3 aggregates epsilon 0.01; Fig. 6 -- the "
                            "paper's tractability valley, this run may hit "
                            "the model's 3600 s time limit"),
        "model_parameters": {"epsilon": 0.01},
    },
    {
        "id": "eps_008",
        "family": "epsilon",
        "role": "compare",
        "title": "Strong dispatch penalty",
        "axis_label": "ε = 0.08",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 3 aggregates epsilon 0.08; Fig. 6-8",
        "model_parameters": {"epsilon": 0.08},
    },
    {
        "id": "eps_012",
        "family": "epsilon",
        "role": "compare",
        "title": "Strongest dispatch penalty",
        "axis_label": "ε = 0.12",
        "temporal_profile": "bimodal",
        "outside_paper_range": False,
        "paper_reference": "Table 3 aggregates epsilon 0.12; Fig. 6-8",
        "model_parameters": {"epsilon": 0.12},
    },

    # -- family: rhythm (Table 2 temporal profiles; Fig. 12) ----------------
    {
        "id": "rhythm_uniform",
        "family": "rhythm",
        "role": "compare",
        "title": "Flat day",
        "axis_label": "Uniform (1/3 each)",
        "temporal_profile": "uniform",
        "outside_paper_range": False,
        "paper_reference": "Table 2 uniform profile; Fig. 12",
        "model_parameters": {},
    },
    {
        "id": "rhythm_sharp",
        "family": "rhythm",
        "role": "compare",
        "title": "Sharp morning peak",
        "axis_label": "Unimodal sharp (0.6 / 0.2 / 0.2)",
        "temporal_profile": "sharp",
        "outside_paper_range": False,
        "paper_reference": "Table 2 unimodal-sharp profile; Fig. 12",
        "model_parameters": {},
    },
    {
        "id": "rhythm_geneva",
        "family": "rhythm",
        "role": "compare",
        "title": "Geneva weekday rhythm",
        "axis_label": "Geneva weekday (observed)",
        "temporal_profile": "geneva_weekday",
        "outside_paper_range": True,
        "paper_reference": ("Not one of Table 2's three profiles: the rhythm "
                            "measured from Geneva's observed trips "
                            "(data/profiles.json), kept for Fig. 12's "
                            "comparison on local data"),
        "model_parameters": {},
    },
)


def period_weights_for(profile):
    """The period weights of one temporal profile.

    The measured profile is read from `data/profiles.json` at generation
    time rather than copied into this file, so a recalibration of the
    observed trips reaches the scenarios by regenerating them.

    :param profile: a key of :data:`TEMPORAL_PROFILES`.
    :return: list of weights, one per demand period, summing to 1.
    """
    if profile not in TEMPORAL_PROFILES:
        raise KeyError(f"unknown temporal profile {profile!r}; "
                       f"known: {', '.join(sorted(TEMPORAL_PROFILES))}")
    weights = TEMPORAL_PROFILES[profile]
    if weights is not None:
        return list(weights)
    from .profiles import load_profiles          # reads data/profiles.json
    return [float(w) for w in load_profiles()["period_weights"]["weekday"]]


def scenario_document(entry):
    """One grid entry as the scenario JSON the demo layer reads.

    :param entry: an item of :data:`PAPER_GRID`.
    :return: the complete scenario dict ("schema": "scenario-v3"), with
             `model_parameters` merged over :data:`BASELINE_PARAMETERS` and
             `period_weights` resolved from the entry's temporal profile.
    """
    parameters = dict(BASELINE_PARAMETERS)
    parameters.update(entry.get("model_parameters", {}))
    weights = period_weights_for(entry["temporal_profile"])
    if len(weights) != parameters["demand_periods"]:
        raise ValueError(
            f"{entry['id']}: profile {entry['temporal_profile']!r} has "
            f"{len(weights)} weights but demand_periods is "
            f"{parameters['demand_periods']}")

    document = {
        "id": entry["id"],
        "schema": SCENARIO_SCHEMA,
        "family": entry["family"],
        "role": entry["role"],
    }
    if "card" in entry:
        document["card"] = entry["card"]
    document.update({
        "title": entry["title"],
        "axis_label": entry["axis_label"],
        "temporal_profile": entry["temporal_profile"],
        "outside_paper_range": bool(entry["outside_paper_range"]),
        "paper_reference": entry["paper_reference"],
    })
    if "card" in entry:
        document["audience_pitch"] = entry["audience_pitch"]
        document["narrative"] = entry["narrative"]
    document["model_parameters"] = {
        "total_budget": parameters["total_budget"],
        "op_budget_ratio": parameters["op_budget_ratio"],
        "demand_periods": parameters["demand_periods"],
        "period_weights": weights,
        "split_method": parameters["split_method"],
        "seed": parameters["seed"],
        "epsilon": parameters["epsilon"],
        "solve_mode": parameters["solve_mode"],
    }
    return document


def paper_scenarios():
    """Every scenario of :data:`PAPER_GRID`, as complete documents.

    :return: list of 18 scenario dicts, in grid order.
    """
    return [scenario_document(entry) for entry in PAPER_GRID]


def write_scenarios(out_dir=SCENARIOS_DIR, overwrite=False):
    """Write the paper grid to `<out_dir>/<id>.json`, one file per run.

    The files are what the notebook, the evaluator and the front end read;
    they are generated rather than hand-written so the grid has one
    definition. Existing files are left alone unless `overwrite` is set --
    a scenario's copy (title, pitch, narrative) may be edited in place after
    generation, and regenerating must not silently discard those edits.

    :param out_dir: directory to write into (default: `scenarios/`).
    :param overwrite: rewrite files that already exist.
    :return: list of the paths written (skipped files are not included).
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written, skipped = [], []
    for document in paper_scenarios():
        path = out_dir / f"{document['id']}.json"
        if path.exists() and not overwrite:
            skipped.append(path)
            continue
        # ensure_ascii=False: these files are read by people (the copy is
        # hand-edited after generation), so "80 000 EUR" stays legible.
        with open(path, "w", encoding="utf-8") as f:
            json.dump(document, f, indent=2, ensure_ascii=False)
            f.write("\n")
        written.append(path)
    print(f"[run_model] scenarios -> {out_dir}: {len(written)} written"
          + (f", {len(skipped)} left as they are (use --overwrite)"
             if skipped else ""))
    return written


def available_scenarios(scenarios_dir=None):
    """The scenario ids that can be run.

    Every `*.json` in `scenarios/` carrying a `model_parameters` block: the
    generated paper grid, the legacy `S*` designs, and anything hand-written
    dropped in next to them. A JSON file that is not a scenario (an index, a
    schema) is skipped rather than offered as runnable.

    :param scenarios_dir: directory to list (default: `scenarios/`).
    :return: sorted list of ids (the JSON stems).
    """
    directory = Path(scenarios_dir) if scenarios_dir else SCENARIOS_DIR
    ids = []
    for path in sorted(directory.glob("*.json")):
        try:
            with open(path, encoding="utf-8") as f:
                document = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(document, dict) and "model_parameters" in document:
            ids.append(path.stem)
    return sorted(ids)


def load_scenario(scenario_id):
    """Read one scenario definition.

    :param scenario_id: e.g. "S2_balanced", or a path to a scenario JSON.
    :return: the scenario dict, with its `model_parameters` block.
    """
    path = Path(scenario_id)
    if not path.is_file():
        path = SCENARIOS_DIR / f"{scenario_id}.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"No scenario {scenario_id!r}. Available: {', '.join(available_scenarios())}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _ensure_sdk_importable():
    if str(SDK_DIR) not in sys.path:
        sys.path.insert(0, str(SDK_DIR))


@contextlib.contextmanager
def scenario_parameters(params):
    """Make `generate_h3_instances()` build *this* scenario, for one run.

    The frozen function is restored on exit, so a process can run several
    scenarios in a row without leaking parameters between them.

    :param params: a scenario's `model_parameters` block.
    :yield: the replacement function.
    """
    import instance_builder
    from scenario.scenario_config import ScenarioConfig, DemandConfig, BudgetConfig
    from input_handler.instance_generator import InstanceGenerator

    weights = tuple(float(w) for w in params["period_weights"])
    periods = int(params.get("demand_periods", len(weights)))
    if len(weights) != periods:
        raise ValueError(
            f"period_weights has {len(weights)} entries but demand_periods is {periods}")
    if abs(sum(weights) - 1.0) > 1e-6:
        raise ValueError(f"period_weights must sum to 1, got {sum(weights)}")

    def generate_h3_instances():
        """Same body as the frozen function, with the scenario's values.

        The frozen original draws `period_weights` from `np.random.dirichlet`;
        the scenarios replace them with the weights measured from the observed
        trips (`profiles.py`), so a run targets the real daily rhythm and is
        reproducible.
        """
        scenario = ScenarioConfig(
            name=params.get("name", "Geneva"),
            demand_config=DemandConfig(
                seed=int(params["seed"]),
                demand_periods=periods,
                period_weights=weights,
                split_method=params.get("split_method", "multinomial"),
                demand_scale=float(params.get("demand_scale", 1.0)),
            ),
            budget_config=BudgetConfig(
                total_budget=int(params["total_budget"]),
                op_budget_ratio=float(params["op_budget_ratio"]),
            ),
        )
        instance = InstanceGenerator(scenario)
        instance.build_realistic_scenario()
        instance.save_to_file("h3_instances_json")
        return instance

    original = instance_builder.generate_h3_instances
    instance_builder.generate_h3_instances = generate_h3_instances
    try:
        yield generate_h3_instances
    finally:
        instance_builder.generate_h3_instances = original


def _git_commit(args):
    """A git ref's commit hash, or None on any failure (never raises).

    Used for provenance only: src is synced from an upstream repository, so
    a result should record which src version produced it, but a missing
    git binary or a non-repo checkout must never break a scenario run.
    """
    try:
        out = subprocess.run(["git", *args], cwd=REPO_ROOT, check=True,
                             capture_output=True, text=True)
        commit = out.stdout.strip()
        return commit or None
    except Exception:
        return None


def run_scenario(scenario_id, out_dir=None, verbose=True, save=True):
    """Solve one scenario with the frozen model and save its design.

    Writes `stations.json`, `metrics.json`, `model_plan.json` and
    `instance.json` into `results/<scenario_id>/`, plus the shared
    `results/shared/bike_arcs.json` -- overwriting any earlier placeholder
    file-for-file, same schema, with `"placeholder": false` and a provenance
    block recording the parameters, the solver status and the wall clock.

    `stations.json` is the design alone; `model_plan.json` is the rest of what
    the solve decided (per-period inventory, rebalancing, rider flows, path
    assignments), which is what lets the demo simulator replay the model's own
    plan rather than re-deriving one from the station list.

    :param scenario_id: e.g. "S2_balanced", or a path to a scenario JSON.
    :param out_dir: where to write; defaults to `results/<scenario_id>/`.
    :param verbose: print stage timings as the run progresses.
    :param save: write the files (False returns the results without touching disk).
    :return: dict with keys scenario, title, stations, metrics, provenance,
             out_dir, run_object, and the paths of the three files this added:
             instance, model_plan, bike_arcs.
    """
    _ensure_sdk_importable()
    from sum_network_design_bss import NetworkDesignRun

    scenario = load_scenario(scenario_id)
    params = scenario["model_parameters"]
    name = scenario["id"]
    out_dir = Path(out_dir) if out_dir else RESULTS_DIR / name
    out_dir = out_dir.resolve()          # bootstrap() chdirs; resolve first.

    started = time.time()
    caller_cwd = Path.cwd()

    # NetworkDesignRun.__init__ runs bootstrap(), which puts the frozen model on
    # sys.path and chdirs into it -- both required before instance_builder can be
    # imported, so the parameters can only be swapped in after this line.
    run = NetworkDesignRun(
        solve_mode=params.get("solve_mode", "integrated"),
        epsilon=float(params["epsilon"]) if params.get("epsilon") is not None else None,
        verbose=verbose,
    )

    try:
        with scenario_parameters(params):
            run.build_instance()
        run.build_network()
        run.solve()
        run.report()

        # Read the solved model out while it is still live. Pure reads of
        # in-memory objects -- no file is touched here and nothing needs the
        # model's working directory, but it stays inside the try so that a
        # failure still restores the caller's cwd.
        from util.cost import CostParameters   # src is on sys.path since bootstrap.

        periods = int(run.demand_generator.time_periods)
        plan = extract_model_plan(
            run.model, run.shortest_path_solver, periods,
            dispatch_fixed_cost=CostParameters.dispatch_fixed_cost,
            rebalancing_unit_cost=CostParameters.rebalancing_unit_cost)
        instance = slim_instance(
            run.instance.to_dict(), name,
            source=f"network-design-bss/src/h3_instances_json/{run.config_name}.txt")
        arcs = extract_bike_arcs(run.model.A_bike_network)
    finally:
        os.chdir(caller_cwd)             # leave the caller where it started.

    elapsed = time.time() - started
    gurobi_model = run.model.model
    stations = run.stations
    metrics = dict(run.metrics)
    # The full evaluator row, not just the 15 headline metrics: every
    # `ExperimentRow` field the frozen model's own MetricsEvaluator computed
    # (compactness, capacity/utilisation by station type, rebalancing volume,
    # solver bound...). `run.metrics` is a subset of it, re-applied so those
    # keys are present even if a future SDK stops carrying one of them.
    experiment_row = dict(run.experiment_row or {})
    experiment_row.update(metrics)

    provenance = {
        "placeholder": False,
        "provenance": (
            f"NetworkDesignRun(solve_mode={run.solve_mode!r}, epsilon={run.epsilon}) "
            f"on the frozen model in network-design-bss/src/ -- real optimiser output"),
        "scenario": name,
        "run": {
            "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "config_name": run.config_name,
            "solve_mode": run.solve_mode,
            "epsilon": run.epsilon,
            "model_parameters": params,
            "gurobi_status": int(gurobi_model.Status),
            "gurobi_status_optimal": int(gurobi_model.Status) == 2,
            "mip_gap": float(getattr(gurobi_model, "MIPGap", float("nan"))),
            "n_variables": int(gurobi_model.NumVars),
            "n_constraints": int(gurobi_model.NumConstrs),
            "wall_clock_s": round(elapsed, 1),
            # src is synced from an upstream repository; record which version
            # of it (and of this repo) produced this result.
            "src_commit": _git_commit(["log", "-1", "--format=%H", "--",
                                       "network-design-bss/src"]),
            "repo_commit": _git_commit(["rev-parse", "HEAD"]),
        },
    }
    # A solve that found no solution leaves MIPGap as NaN, which json.dump
    # writes as the literal NaN -- valid Python, invalid JSON. Sanitise the
    # provenance once, here, so every artefact below carries it clean.
    provenance = _json_safe(provenance)

    # The model's capital constraint uses the FULL total_budget (Q) for
    # station/dock/bike CAPEX; op_budget_ratio carves out a separate
    # operational envelope Q_r = total_budget * op_budget_ratio for
    # rebalancing opex, it does not shrink Q. capex_budget_eur therefore
    # equals total_budget (kept under this key name because the frontend
    # reads it); operational_budget_eur is the separate Q_r envelope.
    stations_doc = {
        **provenance,
        "capex_budget_eur": params["total_budget"],
        "operational_budget_eur": round(
            params["total_budget"] * params["op_budget_ratio"], 1),
        "stations": stations,
    }
    metrics_doc = {**provenance, **_json_safe(experiment_row)}
    model_plan_doc = {**provenance, **plan}

    # The ride network depends on the station layout and the street network
    # only -- not on the budget, the demand or the solve -- so it is the same
    # file for every scenario of this instance and lives outside them.
    bike_arcs_doc = {
        "h3_version": run.h3_version,
        "src_commit": provenance["run"]["src_commit"],
        "n_arcs": len(arcs),
        "note": ("The model's bike arcs: OSM-routed distance/time between "
                 "candidate stations within RIDE_CATCHMENT_RADIUS; identical "
                 "for every scenario of this instance."),
        "arcs": arcs,
    }

    instance_path = out_dir / "instance.json"
    model_plan_path = out_dir / "model_plan.json"
    bike_arcs_path = RESULTS_DIR / "shared" / "bike_arcs.json"

    if save:
        out_dir.mkdir(parents=True, exist_ok=True)
        _write(out_dir / "stations.json", stations_doc)
        _write(out_dir / "metrics.json", metrics_doc)
        _write(model_plan_path, model_plan_doc)
        _write(instance_path, instance)
        bike_arcs_path.parent.mkdir(parents=True, exist_ok=True)
        _write(bike_arcs_path, bike_arcs_doc)
        if verbose:
            print(f"[run_model] {name}: {len(stations)} stations, "
                  f"{sum(s['capacity'] for s in stations):.0f} docks -> {out_dir}")
            print(f"[run_model] {name}: plan with "
                  f"{len(plan['assignments'])} assignments, "
                  f"{len(plan['rebalancing'])} rebalancing moves -> "
                  f"{model_plan_path.name}; {len(arcs)} bike arcs -> "
                  f"{bike_arcs_path}")

    return {
        "scenario": name,
        "title": scenario.get("title", name),
        "stations": stations,
        "metrics": metrics,
        "provenance": provenance,
        "out_dir": out_dir,
        "instance": instance_path,
        "model_plan": model_plan_path,
        "bike_arcs": bike_arcs_path,
        "run_object": run,
    }


def _json_safe(value):
    """The same value, in types `json.dump` writes as valid JSON.

    The evaluator row is built for a pandas CSV, not for JSON: it carries
    tuples (`time_weights`), numpy scalars from the metric computations and,
    when a solve found no solution, NaN. Tuples and sets become lists, numpy
    scalars (and arrays) their Python counterpart, NaN and infinity None.
    Numbers are never rounded or otherwise altered.
    """
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_json_safe(item) for item in value]
    if not isinstance(value, (int, float)) and hasattr(value, "tolist"):
        try:                    # numpy scalar or array -> python equivalent
            return _json_safe(value.tolist())
        except Exception:
            return str(value)
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, int):
        return value
    return str(value)


def _write(path, document):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(document, f, indent=2)


def main(argv=None):
    """Command line entry point: `python -m demo.experiments.run_model`."""
    parser = argparse.ArgumentParser(
        prog="python -m demo.experiments.run_model",
        description="Run prebuilt scenarios against the frozen optimisation model.")
    parser.add_argument("scenarios", nargs="*", default=None,
                        help="scenario ids to run; default: every scenario in "
                             "scenarios/ (the paper grid plus the legacy "
                             "designs), which is a Gurobi solve each")
    parser.add_argument("--out-dir", default=None,
                        help="write here instead of results/<scenario_id>/")
    parser.add_argument("--quiet", action="store_true", help="suppress stage logs")
    parser.add_argument("--write-scenarios", action="store_true",
                        help="write the paper grid to scenarios/<id>.json and "
                             "exit without running anything")
    parser.add_argument("--overwrite", action="store_true",
                        help="--write-scenarios: rewrite files that exist "
                             "(discards hand-edited copy)")
    args = parser.parse_args(argv)

    if args.write_scenarios:
        write_scenarios(out_dir=args.out_dir or SCENARIOS_DIR,
                        overwrite=args.overwrite)
        return 0

    ids = args.scenarios or available_scenarios()
    print(f"[run_model] running {len(ids)} scenario(s): {', '.join(ids)}")
    for scenario_id in ids:
        print(f"\n{'=' * 70}\n{scenario_id}\n{'=' * 70}")
        result = run_scenario(scenario_id, out_dir=args.out_dir,
                              verbose=not args.quiet)
        for key, value in result["metrics"].items():
            print(f"  {key:<24} {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
