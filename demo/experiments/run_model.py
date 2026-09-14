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

    python -m demo.experiments.run_model S1_essential S2_balanced S3_ambitious

Cost note: the shortest-path enumeration is the expensive stage (~50 min cold) and
is cached on disk under keys that carry **no scenario parameter** -- so running the
three scenarios back to back pays it once and the rest take minutes.

Files a run writes:

    results/<scenario>/stations.json    the stations built, with capacity and
                                        starting bikes (the design)
    results/<scenario>/metrics.json     the reporting row of the frozen model
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


def available_scenarios():
    """The scenario ids that can be run.

    :return: sorted list of ids (the `S*.json` stems).
    """
    return sorted(p.stem for p in SCENARIOS_DIR.glob("S*.json"))


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
    metrics_doc = {**provenance, **metrics}
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


def _write(path, document):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(document, f, indent=2)


def main(argv=None):
    """Command line entry point: `python -m demo.experiments.run_model`."""
    parser = argparse.ArgumentParser(
        prog="python -m demo.experiments.run_model",
        description="Run prebuilt scenarios against the frozen optimisation model.")
    parser.add_argument("scenarios", nargs="*", default=None,
                        help=f"scenario ids (default: all of {', '.join(available_scenarios())})")
    parser.add_argument("--out-dir", default=None,
                        help="write here instead of results/<scenario_id>/")
    parser.add_argument("--quiet", action="store_true", help="suppress stage logs")
    args = parser.parse_args(argv)

    ids = args.scenarios or available_scenarios()
    for scenario_id in ids:
        print(f"\n{'=' * 70}\n{scenario_id}\n{'=' * 70}")
        result = run_scenario(scenario_id, out_dir=args.out_dir,
                              verbose=not args.quiet)
        for key, value in result["metrics"].items():
            print(f"  {key:<24} {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
