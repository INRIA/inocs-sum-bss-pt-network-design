# Running a scenario against the frozen model

Each `S*.json` here is one prebuilt scenario: the `model_parameters` block holds every
value the frozen model needs, and nothing outside that block varies between the three.

## The supported way: `run_model.py`

```bash
python -m demo.experiments.run_model S1_essential S2_balanced S3_ambitious
```

or, one scenario at a time with the simulation and the KPIs around it,
[`notebooks/demo_scenarios.ipynb`](../../../notebooks/demo_scenarios.ipynb).

The whole scenario surface of the model is one function,
`generate_h3_instances()` in `network-design-bss/src/instance_builder.py`, which takes no
arguments and builds its `ScenarioConfig` inline. Rather than editing it,
[`run_model.py`](../run_model.py) **replaces it in `sys.modules` for the duration of one
run** with a function that builds the same `ScenarioConfig` from a scenario JSON.
`NetworkDesignRun.build_instance()` does `from instance_builder import
generate_h3_instances` at call time, so it picks up the replacement.

The file on disk is never touched: `git diff` stays empty, there is nothing to remember
to revert, and each result file records the parameters that produced it under
`run.model_parameters` — so a design can be audited without re-reading this page.

Each run writes `stations.json` and `metrics.json` into
`demo/experiments/results/<scenario_id>/`, overwriting the earlier greedy
placeholders (`mock_results.py`, removed 2026-09-09, see git history)
file-for-file. It also writes `instance.json` (the instance the model solved,
slimmed) and, from the live solved model object, `model_plan.json` (the
solver's full per-period decision: station inventories, rebalancing moves
and dispatches, per-OD path assignments) into the same directory, plus
`demo/experiments/results/shared/bike_arcs.json` (the model's OSM-routed
ride arcs between candidate stations — one file, shared by all three
scenarios since their candidate geography is identical).

Requirements: a Gurobi licence larger than the size-limited one bundled with `gurobipy`
(the instance is well past 2 000 variables / 2 000 constraints; academic licences are
free). A cold run spends ~50 min in shortest-path enumeration, but that stage is cached
and **does not depend on any scenario parameter** — so run S1/S2/S3 back to back and only
the first pays it; the rest take minutes.

## The manual alternative

Equivalent, and what the layer did before `run_model.py` existed: edit
`generate_h3_instances()` in place, run, save, revert. Recorded here because it shows
exactly which values a scenario sets, and because it is the fallback if the module swap
ever stops matching the frozen code.

### The one edit

Every scenario parameter lands in `network-design-bss/src/instance_builder.py`,
`generate_h3_instances()` — the budget flows from there into the solver via
`src/input_handler/instance_attribute_extracter.py`, so nothing else needs touching.
Replace the body with the values from the scenario's `model_parameters`, e.g. for
`S2_balanced`:

```python
def generate_h3_instances():
    T = 3
    np.random.seed(30)
    scenario = ScenarioConfig(
        name="Geneva",
        demand_config=DemandConfig(
            seed=20,
            demand_periods=T,
            period_weights=(0.169, 0.343, 0.488),   # <- observed weekday pattern, was np.random.dirichlet
            split_method="multinomial",
        ),
        budget_config=BudgetConfig(
            total_budget=80000,                     # <- scenario budget
            op_budget_ratio=0.025,                  # <- scenario operational ratio
        ),
    )
    ...
```

`epsilon` is passed at run time (`NetworkDesignRun(epsilon=...)`), not edited.

The period weights `(0.169, 0.343, 0.488)` are the observed weekday split over the
model's three periods (06–10 / 10–16 / 16–22 local) — computed by
`python -m demo.experiments.profiles` from `bike_trips.geojson`. All three scenarios share
them so the designs differ only by money, which keeps the comparison honest.

### Run and save (manual)

```bash
pipenv run python - <<'PY'
import json, pathlib, sys
sys.path.insert(0, "network-design-bss/sdk-builder")
from sum_network_design_bss import NetworkDesignRun

SCENARIO = "S2_balanced"                     # <- match the edit you made
run = NetworkDesignRun(epsilon=0.04).execute()

out = pathlib.Path("demo/experiments/results") / SCENARIO
out.mkdir(parents=True, exist_ok=True)
(out / "stations.json").write_text(json.dumps(run.stations, indent=2))
(out / "metrics.json").write_text(json.dumps(run.metrics, indent=2))
print("saved ->", out)
PY
```

### Revert (manual)

```bash
git checkout -- network-design-bss/src/instance_builder.py
git diff HEAD -- 'network-design-bss/src/**/*.py'   # must print nothing
```

## Then simulate and evaluate

```bash
python3 -m demo.experiments.simulate --stations demo/experiments/results/S2_balanced/stations.json --day monday
python3 -m demo.experiments.simulate --stations demo/experiments/results/S2_balanced/stations.json --day sunday
python3 -m demo.experiments.simulate --stations demo/experiments/results/S2_balanced/stations.json --day monday --mode instance --seeds 5
python3 -m demo.experiments.evaluate demo/experiments/results/S1_essential \
                               demo/experiments/results/S2_balanced \
                               demo/experiments/results/S3_ambitious --compare-day monday
```

The `--mode instance` run above replays the model's own demand from
`instance.json`, following the `model_plan.json` rebalancing plan and the
`shared/bike_arcs.json` ride arcs written alongside `stations.json` and
`metrics.json` when they are present (falling back to nearest-station choice,
greedy rebalancing and haversine distance otherwise). It is the only
simulated day sized the way the scenario was actually solved.

## The human baseline

For the "you vs the optimiser" moment of the demo, build the naive design at the same
budget and push it through the same simulator:

```bash
python3 -m demo.experiments.baseline --budget 80000 --out demo/experiments/results/baseline_80k/stations.json
python3 -m demo.experiments.simulate --stations demo/experiments/results/baseline_80k/stations.json --day monday
```
