# AGENTS.md — orientation for coding agents

Read this first. It tells you what this repository is, which parts you may change,
where to find things, and how to verify your work. Human-facing overview: [README.md](README.md).

## What this repository is

An optimisation model for **bike-sharing network design integrated with public transport**
(station locations, dock capacities, initial fleet, aggregate rebalancing; path-based integer
program solved with Gurobi), plus everything needed to **run, demonstrate and publish** it on
the Geneva living-lab sample of the EU SUM project.

Two halves, with different ownership:

| Half | Path | Owner | May you edit `.py` files? |
| --- | --- | --- | --- |
| The model | `network-design-bss/src/` | Zhenyu Wu (upstream, synced in) | **No.** Frozen. See rule 1. |
| Everything that runs it | `network-design-bss/sdk-builder/`, `demo/`, `notebooks/`, root files | this repository | Yes |

Canonical repository: `https://github.com/INRIA/inocs-sum-bss-pt-network-design`.
Public demo: `https://inria.github.io/inocs-sum-bss-pt-network-design/`.
(Older files may still say `inocs-sum-bss-pt-network-design`; that is the previous name.)

## Hard rules

1. **Never edit `network-design-bss/src/**/*.py`.** Results must stay attributable to the
   submitted code. Only `requirements.txt`, `.gitignore` and `data/geojson/` in that tree belong
   to this repo. Work around defects at runtime in
   `network-design-bss/sdk-builder/sum_network_design_bss/compat.py` (see its four patches) or by
   swapping a function in `sys.modules` for one run (see `demo/experiments/run_model.py`).
   Check: `git status --short network-design-bss/src` shows no modified `.py`.
   Chinese comments in `src/` are upstream's; do not translate or "clean" them.
2. **Do not duplicate model logic in `demo/`.** Anything `src/` or the SDK already computes
   (unit costs, catchment radii, speeds, capacities, haversine, metrics definitions) must be
   imported, not re-implemented. `demo/experiments/pipeline/config.py` shows the pattern (reads
   `util/cost.py` at runtime). `demo/experiments/tests/test_src_parity.py` pins the mirrored
   constants. Trade-off to flag rather than decide silently: importing `util.util` pulls in
   osmnx/geopandas/h3 and needs `compat.bootstrap()`, while `simulate.py`/`evaluate.py` are
   stdlib-only by design.
3. **Generated, do not hand-edit:** `Pipfile` `[packages]` (regenerate with
   `python network-design-bss/sdk-builder/sync_requirements.py`), everything in
   `network-design-bss/sdk/` (`build_package.py` / `build_docs.py`), and
   `demo/frontend/public/data/` (gitignored; `scripts/prepare-data.mjs` rebuilds it on every
   `npm run dev`/`build`).
4. **Golden tests pin the committed artefacts** (`demo/experiments/data/*.json`,
   `demo/experiments/results/**`). If a golden test fails, do not edit the test or regenerate to
   make it pass: the artefacts are the data contract the front-end and notebooks read. Regenerate
   only for an intentional change, review the diff, and say so in the commit message.
   `tests/README.md` has the per-artefact regeneration commands.
5. `.specs/` is **gitignored, local-only** design history. Never link to it from committed docs.
6. Commit only when asked. Attribution trailer rules arrive in the session, follow them.

## Where things are

```
network-design-bss/
  src/                     frozen model. Entry: main.py (main_run_single_instance), instance_builder.py
    model/                 BikeSharingModel: sets.py, variables.py, objective.py, constraints.py, parameters.py
    input_handler/         instance_generator.py (build_realistic_scenario), demand_*, station_generator, pt_generator
    network/, shortest_path/  multimodal graph (NetworkConstructor) + k-shortest paths (Yen)
    output_handler/        metrics_evaluator.py (metric definitions), experiment.py (CSV row), post_process.py (GeoJSON)
    util/util.py           ALL tunable constants (h3_version, NUM_SHORTEST_PATHS, EPSILON, radii, speeds, capacities)
    util/cost.py           unit costs (station 100, dock 20, bike 60, dispatch 40, rebalancing 20 €/bike-km)
    scenario/scenario_config.py   DemandConfig / BudgetConfig / ScenarioConfig dataclasses
    alns_solver/           experimental ALNS heuristic + benchmark; NOT wired into the solve modes
    docs/                  upstream design notes (Chinese): ALNS design, ALNS-vs-Gurobi scale tests, OD scale
    data/geojson/geneva_1.5km-radius/   the input sample the model reads (name = util.util.h3_version)
  sdk-builder/
    sum_network_design_bss/  the SDK: runner.py (NetworkDesignRun), compat.py (bootstrap + patches), od_builder.py
    build_package.py, build_docs.py, sync_requirements.py, README.md (maintainer doc)
  sdk/                     committed wheel + pdoc docs (generated). legacy/ = superseded 0.1.0 build
demo/
  experiments/             scenarios/, run_model.py, trips.py, profiles.py, ridership.py, stations_real.py,
                           baseline.py, simulate.py, evaluate.py, pipeline/, tests/, kpi_config.json
                           data/  (the layer's own copy of the sample + observed layers)
                           results/<scenario>/ (stations, metrics, instance, model_plan, sim_*, kpis) + results/shared/bike_arcs.json
  frontend/                Astro + React static site (the public demo). scripts/prepare-data.mjs = the only data bridge
notebooks/                 gva_demo.ipynb (pipeline walkthrough), simulation_demo.ipynb (reference values),
                           demo_scenarios.ipynb (S1–S3 + baseline + evaluation)
config/configuration.json  legacy parameter-sweep ranges read by util.util (budget / k paths / penalty); not used by the SDK
.github/workflows/deploy-pages.yml   builds demo/frontend and publishes it to GitHub Pages on push to main
```

## Environment and commands

Python ≥ 3.9 (PEP 585 generics in `src/`), pipenv, a Gurobi licence larger than the bundled
size-limited one (the Geneva instance is ~53k variables / ~36k constraints). macOS has no
`timeout` command.

```bash
pipenv install --dev                                   # Pipfile [packages] mirrors src/requirements.txt

# the model, through the SDK (checkout mode: sdk-builder on PYTHONPATH, runs inside src/)
PYTHONPATH=network-design-bss/sdk-builder pipenv run python -m sum_network_design_bss --help
PYTHONPATH=network-design-bss/sdk-builder pipenv run python -m sum_network_design_bss --export out/

# demo pipeline (stdlib except run_model, which needs the full env + Gurobi)
python3 -m demo.experiments.run_model S1_essential S2_balanced S3_ambitious
python3 -m demo.experiments.simulate --stations demo/experiments/results/S2_balanced/stations.json --day monday
python3 -m demo.experiments.simulate --stations demo/experiments/results/S2_balanced/stations.json --day monday --mode instance --seeds 5
python3 -m demo.experiments.evaluate demo/experiments/results/S1_essential demo/experiments/results/S2_balanced --compare-day monday
python3 -m demo.experiments.baseline --budget 20000 --instance demo/experiments/results/S2_balanced/instance.json --out demo/experiments/results/baseline_20k/stations.json

# tests (unittest-style, pytest-compatible; pytest.ini points at demo/experiments/tests)
DEMO_TESTS_FAST=1 python3 -m unittest discover -s demo/experiments/tests -t .   # ~0.3 s, skips the 112-day replay
pytest                                                                          # full suite

# front-end
cd demo/frontend && npm install && npm run dev        # http://localhost:4321/inocs-sum-bss-pt-network-design/
npm run build                                          # prebuild regenerates public/data from demo/experiments

# packaging (writes network-design-bss/sdk/)
pipenv run python network-design-bss/sdk-builder/build_package.py
pipenv run python network-design-bss/sdk-builder/build_docs.py
python network-design-bss/sdk-builder/sync_requirements.py --check
```

## Key APIs

- `sum_network_design_bss.NetworkDesignRun(work_dir=None, solve_mode="integrated", epsilon=None, rebuild_od=False, verbose=True)`
  — stages `check_inputs() → build_od() → build_instance() → build_network() → solve() → report()`;
  `execute()` runs them all. Results: `.metrics` (dict, keys in `runner.HEADLINE_METRICS`),
  `.stations` (list of dicts: station, type, lon, lat, capacity, initial_bikes), `.stations_frame()`,
  `.export(dir)`. `work_dir` is required when running from the installed wheel.
- `sum_network_design_bss.compat.bootstrap(work_dir=None)` — must run **before importing anything
  from `src/`**: puts the model on `sys.path`, `chdir`s into it, creates output dirs, applies the
  runtime patches. 29 modules do `from util.util import *` and copy constants at import time.
- Solve modes that actually dispatch in `model/sequential_optimization.py::optimization_model_solver`:
  `"integrated"` (one MIP) and `"sequential"` (design, then operations). `"benders"` and `"alns"`
  are declared in `runner.SOLVE_MODES` but not implemented in the frozen tree.
- `demo.experiments.run_model.run_scenario(id)` — injects `scenarios/<id>.json` by replacing
  `instance_builder.generate_h3_instances` in `sys.modules`; writes `stations.json`, `metrics.json`,
  `instance.json`, `model_plan.json`, `results/shared/bike_arcs.json`, each with a `run` provenance block.
- `demo.experiments.simulate.DaySimulation` — one engine, three modes: `replay` (observed trips,
  the proof), `sample` (resampled × `--scale`), `instance` (the model's own 1,453-trip day; the only
  day comparable to `metrics.json`). Details: `demo/experiments/METHODS.md` §3.
- `demo.experiments.evaluate.evaluate_day / evaluate_scenario / compare` — KPIs from
  `kpi_config.json`; pure dict → dict.

## Data contracts

- Model input (`<geojson_dir>/`, name must equal `util.util.h3_version`): `grid.geojson` (H3 r9),
  `stops.geojson`, `itineraries.geojson`, `bike_trips.geojson`, `od.csv` (`origin_cell,dest_cell,flow`;
  703 rows / 1,453 trips, counted from the observed trips by `od_builder.py`). The four GeoJSON files
  come from the companion package `inocs-sum-gtfs-geojson`.
- `demo/experiments/results/<scenario>/` is what the front-end consumes; required:
  `stations.json`, `kpis.json`, `sim_monday.json`, `sim_sunday.json`, `sim_monday_x25.json`;
  optional: `metrics.json`, `sim_instance.json`. Scenarios are discovered by folder, a missing file
  hides the scenario with a warning. A scenario also needs `scenarios/<id>.json`.
- Scenario parameters (`scenarios/S*.json → model_parameters`): `total_budget`, `op_budget_ratio`,
  `demand_periods`, `period_weights` (must sum to 1), `split_method`, `seed`, `epsilon`, `solve_mode`.
  Committed S1/S2/S3: 20k/80k/140k €, all solved optimal on 2026-09-10.

## Gotchas

- First model run spends ~50 min enumerating shortest paths; cached under `src/osm_cache/` and
  `src/data/shortest_paths_result/` (keys carry no scenario parameter, so S1→S3 pay it once).
  Solve itself is ~15 s.
- `bootstrap()` changes the cwd. Resolve paths before calling it, or use `NetworkDesignRun`.
- Running from the wheel: `PermissionError` from `bootstrap()` means `work_dir` was omitted.
- `FileNotFoundError ... grid.geojson`: input dir name ≠ `h3_version`.
- `ModuleNotFoundError: util`: something imported `src/` before `bootstrap()`.
- `TypeError: 'type' object is not subscriptable` on import: Python < 3.9.
- In Jupyter, pick the pipenv interpreter as kernel; `compat` restores stdout around the solve
  because the model redirects it to a file.
- Golden tests strip absolute-path fields and compare parsed JSON, never bytes.
- The Pages workflow publishes only `demo/frontend/dist`; `network-design-bss/sdk/docs/` is
  committed but not served at the Pages URL that older comments mention. Open it locally or run
  `build_docs.py --serve`.
- No git remote is configured in this checkout and history starts here (files staged, no commit
  yet at the time of writing): `git diff HEAD` fails until the first commit.

## Known upstream issues (report, do not fix in `src/`)

Tracked in the demo layer's findings (local `.specs/`, summarised here so they survive):

1. Is `od.csv` flow one day's demand or a horizon total? Decides how the "instance day" is presented.
2. `compute_distance` passes `(lon, lat)` to a haversine expecting `(lat, lon)`.
3. OD rows whose cell is unbuildable are not filtered (~60 trips can never be served).
4. `runner.SOLVE_MODES` lists `benders`/`alns`, but neither exists in the frozen dispatch;
   `compat._stub_missing_benders` targets an import that upstream has since removed (harmless).
5. `covered_od_ratio` counts OD *pairs* with any positive assignment, not flow volume
   (`output_handler/metrics_evaluator.py::_compute_coverage_metrics`).

## Documentation map

| Question | Read |
| --- | --- |
| What the project is, how to install and run | `README.md` |
| Frozen-model rules, runtime patches, build/release, Python versions, troubleshooting | `network-design-bss/sdk-builder/README.md` |
| What the wheel contains | `network-design-bss/sdk/README.md` |
| Demo pipeline stage by stage, with formulas | `demo/experiments/README.md` |
| Simulation/evaluation method and assumption register | `demo/experiments/METHODS.md` |
| What is measured vs assumed vs synthetic | `demo/experiments/SPEC.md` |
| Running a scenario against the model | `demo/experiments/scenarios/README.md` |
| Test suite and artefact regeneration policy | `demo/experiments/tests/README.md` |
| Front-end data flow, i18n, deployment | `demo/frontend/README.md` |
| Model internals stage by stage, executable | `notebooks/gva_demo.ipynb` |
| Upstream research notes (ALNS, scale tests) | `network-design-bss/src/docs/*.md` |

## Conventions

- Python: match surrounding style; docstrings in English; SDK and demo modules open with a
  file-level docstring stating purpose and constraints.
- Tests: `unittest.TestCase` only (no pytest fixtures), so both runners work.
- Every artefact a pipeline stage writes carries a `method`/`run`/`provenance` block; keep that.
- Front-end copy lives in `demo/frontend/src/i18n/{en,fr}.json`; a missing `fr` key falls back to `en`.
- Do not commit anything under `demo/frontend/public/data/`, `network-design-bss/src/{osm_cache,cache,plot,data/output,...}` or `build/`.
