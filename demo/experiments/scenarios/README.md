# Scenario definitions

Each `<id>.json` here is one prebuilt scenario for the frozen model: a `model_parameters` block
the model actually runs on, plus the copy and provenance the front end and the notebooks read
(`"schema": "scenario-v3"`).

## Generated, not hand-written

The 18 scenarios of the paper's sensitivity grid (budget, operational ratio, ε, temporal
profile — see [`README.md`](../README.md) for the four questions they answer) are **generated**
from one definition, `run_model.PAPER_GRID`, by `run_model.write_scenarios()`:

```bash
python -m demo.experiments.run_model --write-scenarios              # keeps existing files
python -m demo.experiments.run_model --write-scenarios --overwrite   # regenerate from PAPER_GRID
```

Existing files are kept unless `--overwrite` is passed, so copy edited in place survives a
regeneration. Hand-editing a generated file afterwards is fine for copy (`title`,
`axis_label`, `audience_pitch`, `narrative`) but not for `model_parameters` — an `--overwrite`
regeneration discards it. To change a run's parameters, edit its entry in `PAPER_GRID`
(`run_model.py`) and regenerate.

## Running a scenario against the model

```bash
python -m demo.experiments.run_model budget_080k rhythm_uniform
```

or, one scenario at a time with the evaluation around it,
[`notebooks/demo_scenarios.ipynb`](../../../notebooks/demo_scenarios.ipynb) — the supported way
to run the grid. **Nobody but the user runs the experiments**: a Gurobi licence larger than the
size-limited one bundled with `gurobipy` is required (the instance is ~53k variables / ~36.5k
constraints; academic licences are free).

The whole scenario surface of the model is one function, `generate_h3_instances()` in
`network-design-bss/src/instance_builder.py`, which takes no arguments and builds its
`ScenarioConfig` inline. Rather than editing it, [`run_model.py`](../run_model.py) **replaces it
in `sys.modules` for the duration of one run** with a function that builds the same
`ScenarioConfig` from a scenario JSON. `NetworkDesignRun.build_instance()` does
`from instance_builder import generate_h3_instances` at call time, so it picks up the
replacement. The file on disk is never touched: `git diff` stays empty, and each result file
records the parameters that produced it under `run.model_parameters`, so a design can be
audited without re-reading this page.

Each run writes `stations.json`, `metrics.json` (the model's **full** evaluator row —
`NetworkDesignRun.experiment_row`, not just the 15 headline keys), `instance.json` (the instance
solved, slimmed) and `model_plan.json` (the solver's full per-period decision: station
inventories, rebalancing moves and dispatches, per-OD path assignments) into
`demo/experiments/results/<scenario_id>/`, plus `demo/experiments/results/shared/bike_arcs.json`
(the model's OSM-routed ride arcs between candidate stations — one file, since the candidate
geography is identical across the whole grid).

A cold run spends ~50 min in shortest-path enumeration, but that stage is cached and **does not
depend on any scenario parameter** — so running the grid back to back pays it once; the rest
take minutes. Solve itself is ~15 s per scenario. `eps_001` (ε = 0.01) may hit the model's 3600 s
time limit — the paper's own "valley" (Fig. 6) — the notebook flags this and lets it be skipped.

## Scenario JSON fields

```json
{
  "id": "budget_080k",
  "schema": "scenario-v3",
  "family": "baseline",
  "role": "card",
  "card": "reference",
  "title": "Reference plan",
  "axis_label": "80 000 €",
  "temporal_profile": "bimodal",
  "outside_paper_range": false,
  "paper_reference": "Table D.8 baseline; Table 2",
  "audience_pitch": "...",
  "narrative": "...",
  "model_parameters": {
    "total_budget": 80000, "op_budget_ratio": 0.05, "demand_periods": 3,
    "period_weights": [0.4, 0.2, 0.4], "split_method": "multinomial", "seed": 20,
    "epsilon": 0.04, "solve_mode": "integrated"
  }
}
```

| Field | Meaning |
| --- | --- |
| `id` | matches the filename stem |
| `schema` | `"scenario-v3"` |
| `family` | `baseline` \| `budget` \| `ops_ratio` \| `epsilon` \| `rhythm` — the sensitivity axis this run belongs to. `baseline` belongs to every family at once, at its own axis value: the front end adds it to each family's chart. |
| `role` | `card` (carries front-end copy, shown on "choose a plan") or `compare` (a grid point only, shown in the Compare charts) |
| `card` | cards only: `starter` \| `essential` \| `reference` \| `ambitious` — the card slot, in the order "choose a plan" shows them |
| `title`, `axis_label` | front-end copy: the plan's name and the value shown on its axis |
| `temporal_profile` | `bimodal` \| `uniform` \| `sharp` \| `geneva_weekday` — which period-weight vector `model_parameters.period_weights` was built from (`bimodal` = the paper's baseline 0.40/0.20/0.40; `geneva_weekday` = the observed Geneva weekday split, measured by `profiles.py`) |
| `outside_paper_range` | true for the two budget points (20k, 40k) added below the paper's own Table 2 range (60–120k) to locate the PT-integration threshold |
| `paper_reference` | which section / table / figure of the paper this run maps to |
| `audience_pitch`, `narrative` | cards only: fallback copy for the front end until translated keys exist in `demo/frontend/src/i18n/*.json` |
| `legacy` | legacy `S1_essential`/`S2_balanced`/`S3_ambitious` only: `true` |
| `model_parameters` | `total_budget`, `op_budget_ratio`, `demand_periods`, `period_weights` (must sum to 1, one per period), `split_method`, `seed`, `epsilon`, `solve_mode` — everything the frozen model needs |

Common to every grid run: `demand_periods 3`, `seed 20`, `split_method "multinomial"`,
`solve_mode "integrated"`; the baseline's own values (`epsilon 0.04`, `op_budget_ratio 0.05`,
`total_budget 80000`, the bimodal profile) unless the run's own axis is what varies.

## Adding a run

To add a point to the paper grid: add an entry to `run_model.PAPER_GRID` (`run_model.py`) with a
unique `id`, its `family`/`role`, the `model_parameters` it overrides from the baseline, and
(for a card) `audience_pitch`/`narrative`; regenerate with `--write-scenarios --overwrite`; run
it with Gurobi; re-run `evaluate.py` to get its `kpis.json`.
`demo/experiments/tests/test_golden_pipeline.py::ScenarioValidationTests` checks the whole
committed grid against `PAPER_GRID` (18 runs, exactly one `baseline`) and every scenario's
contract (required keys, period weights summing to 1, unique ids), so a malformed or
out-of-sync addition fails loudly there.

## Legacy scenarios

`S1_essential.json`, `S2_balanced.json`, `S3_ambitious.json` (20k / 80k / 140k €, observed
Geneva weekday weights, operational ratio 2.5 % / 2.5 % / 5 % — not the paper's bimodal
baseline) are the three scenarios the demo shipped with before this realignment. They keep
their JSON and their `results/` **until the paper grid is run**, flagged `"legacy": true`, so
the site keeps building on real data during the transition. They are deleted in a later
clean-up step, once the user has run the paper grid and its results are validated.

## The manual alternative (fallback)

Equivalent to `run_model.py`, and what the layer did before it existed: edit
`generate_h3_instances()` in `network-design-bss/src/instance_builder.py` in place, run, save,
revert. Recorded here because it shows exactly which values a scenario sets, and because it is
the fallback if the module-swap technique ever stops matching the frozen code.

```python
def generate_h3_instances():
    T = 3
    np.random.seed(30)
    scenario = ScenarioConfig(
        name="Geneva",
        demand_config=DemandConfig(
            seed=20,
            demand_periods=T,
            period_weights=(0.4, 0.2, 0.4),   # <- from the scenario's model_parameters
            split_method="multinomial",
        ),
        budget_config=BudgetConfig(
            total_budget=80000,               # <- scenario budget
            op_budget_ratio=0.05,             # <- scenario operational ratio
        ),
    )
    ...
```

`epsilon` is passed at run time (`NetworkDesignRun(epsilon=...)`), not edited. Run and save:

```bash
pipenv run python - <<'PY'
import json, pathlib, sys
sys.path.insert(0, "network-design-bss/sdk-builder")
from sum_network_design_bss import NetworkDesignRun

SCENARIO = "budget_080k"                     # <- match the edit you made
run = NetworkDesignRun(epsilon=0.04).execute()

out = pathlib.Path("demo/experiments/results") / SCENARIO
out.mkdir(parents=True, exist_ok=True)
(out / "stations.json").write_text(json.dumps(run.stations, indent=2))
(out / "metrics.json").write_text(json.dumps(run.experiment_row, indent=2))
print("saved ->", out)
PY
```

Then revert:

```bash
git checkout -- network-design-bss/src/instance_builder.py
git diff HEAD -- 'network-design-bss/src/**/*.py'   # must print nothing
```

## Then evaluate (and, optionally, stress-test)

```bash
python3 -m demo.experiments.evaluate demo/experiments/results/budget_080k --compare
python3 -m demo.experiments.simulate --stations demo/experiments/results/budget_080k/stations.json --day monday   # optional: the replay stress test
```

`evaluate.py` reads `model_plan.json` + `metrics.json` (+ `sim_monday.json` / `sim_sunday.json`
when present) and writes `kpis.json` with three blocks — `paper`, `technical`, `stress_test` —
described in [`README.md`](../README.md) and [`METHODS.md`](../METHODS.md).
