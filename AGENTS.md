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

   **Declared, reviewed exception — the planner game's browser engine.** The LP in
   `demo/frontend/src/domain/evaluation/` (`lpModel.ts`, `kpis.ts`, `losses.ts`) is a
   TypeScript TRANSCRIPTION of `demo/experiments/fixed_design.py`, which is itself the
   normative "evaluate a visitor's station layout" reference — the frozen model's
   operational sub-problem with the station set `y` fixed, reproduced as an LP (constants
   read from `network-design-bss/src/` at runtime, never copied; see `fixed_design.py`'s
   module docstring for the constraint-by-constraint mapping to `model/constraints.py` and
   `model/objective.py`). A transcription is unavoidable: nothing in `src/` or the SDK runs
   in a browser. It is kept honest three ways: (a) constants flow one way, Python ->
   `results/shared/game/constants.json` -> TypeScript, never hand-copied; (b) every KPI line
   in both `fixed_design.py`'s `_read_kpis()` and the TS `kpis.ts`/`losses.ts` carries a
   `mirrors <file>:<lines>` comment pointing at the same upstream definition; (c) 21 golden
   vectors under `results/shared/game/golden/` are written by `game_export.py` from the
   Python LP and reproduced independently by both suites — `demo/experiments/tests/
   test_fixed_design.py`'s `GoldenVectorTests` (Python vs the committed file, 1e-6 float
   tolerance) and `demo/frontend/src/domain/evaluation/engine.test.ts` (HiGHS-in-node vs
   the same golden file, 0.5% relative on served flow and 0.005 absolute on PT share — tight
   because the two solve the identical program, so a wider gap is a transcription bug, not
   numerical noise). `fixed_design.py` in turn reproduces the frozen model's own published
   `kpis.json` within its own, looser tolerance (served within 2%, measured 0.9998x-1.0157x;
   PT share within 0.015 absolute) — that gap is the LP relaxation (integer `x`/`w`/`v`/`r`/`n`
   made continuous), not transcription error. Do not tighten or loosen either tolerance to
   make a test pass; a drift means investigate first.
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
   `demo/experiments/results/shared/game/**` (including `golden/`, 21 vectors) is both
   generated (rule 3) and golden-pinned (this rule): the only regeneration command is
   `python3 -m demo.experiments.game_export`, which additionally needs the **uncommitted**
   k-shortest-path pickle under `network-design-bss/src/data/shortest_paths_result/`
   (`game_export.py`'s module docstring names the exact file and the error it raises when
   the pickle is missing). Regenerating rewrites all 21 golden vectors; review the diff and
   re-run both `python3 -m unittest demo.experiments.tests.test_fixed_design` and
   (`cd demo/frontend &&`) `npm test`, since the TypeScript engine is pinned against the
   same vectors.

   A second, unrelated pin lives beside it: `demo/frontend/src/components/map/__guard__/`
   fixes the full demo's `CityMap`/`MapPanel` markup byte for byte (single-line HTML
   snapshots, ~250 KB each, via vitest's `toMatchFileSnapshot`) so the map-layer refactor
   the game needed could not silently change what the existing demo renders. Check it with
   `node demo/frontend/scripts/guard-diff.mjs` (never `cat` a snapshot or let the test
   runner print its own diff — both flood a terminal; the script reports only the first
   differing offset). Never regenerate these files to make a refactor pass. Regenerate them
   only when the committed results or the full demo's map markup legitimately changed:
   delete the files under `__guard__/` and run
   `npx vitest run src/components/map/cityMap.guard.test.tsx` once from `demo/frontend/` —
   `toMatchFileSnapshot` writes a fresh snapshot when the file it names does not exist, and
   compares against it otherwise, so a clean delete-then-run is how this suite's guard is
   deliberately updated.
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
  experiments/             scenarios/ (18-run paper grid + legacy S1-S3), run_model.py (PAPER_GRID,
                           write_scenarios), trips.py, profiles.py, ridership.py, stations_real.py,
                           simulate.py (replay only, live), evaluate.py (paper/technical/stress_test),
                           pipeline/, tests/, kpi_config.json
                           baseline.py, pipeline/instance.py  DEPRECATED, see below
                           fixed_design.py (normative LP: evaluate a visitor's station layout,
                           the paper's operational sub-problem with y fixed), game_export.py
                           (writes results/shared/game/, needs the uncommitted k-shortest-path
                           pickle), tests/test_fixed_design.py
                           data/  (the layer's own copy of the sample + observed layers)
                           results/<scenario>/ (stations, metrics [full evaluator row], model_plan,
                           instance, sim_monday/sim_sunday [stress test], kpis [schema kpis-v3]) +
                           results/shared/bike_arcs.json, results/shared/game/ (+ golden/,
                           21 vectors) [see "Hard rules" exception below]
  frontend/                Astro + React static site. TWO pages: index.astro is the public demo
                           (five header-tab steps, no advanced toggle); play.astro is the
                           "planner game" (/play, six tracked steps behind one entry screen).
                           scripts/prepare-data.mjs = the only data bridge (copies
                           results/shared/game/ verbatim, plus highs.wasm, into public/data/game/).
                           src/domain/          pure TS, no React/DOM/fetch: evaluation/ (the LP
                                                 port, transcribes fixed_design.py), placement/
                                                 (hit test, budget, assistant, reach), trips/
                                                 (run-animation sprites), game/ (session, steps,
                                                 predictions, ticket, results — the game's own
                                                 application logic; see its own README.md)
                           src/infra/           evaluator.worker.ts + highsEvaluator.ts (exact,
                                                 HiGHS/wasm), estimateEvaluator.ts (fallback),
                                                 gameData.ts (payload loader), sessionStore.ts
                                                 (localStorage, try/catch everywhere)
                           src/hooks/           useGameSession, useHashStep, usePlacement,
                                                 useEvaluation, useViewport (thin; logic in the
                                                 pure hashStep.ts/viewport.ts/evaluationPair.ts)
                           src/components/map/  MapCanvas + layers/ (composable: BaseLayer,
                                                 PtLinesLayer, StationsLayer, CandidatesLayer,
                                                 TripsLayer, ...), frame/MapFrame.tsx (camera,
                                                 zoom, four slots; parent composes the content),
                                                 AdvancedLayers.tsx (view kind + toggles -> layer
                                                 props, shared by MapPanel and CityMap),
                                                 __guard__/ (pinned CityMap/MapPanel markup,
                                                 byte-for-byte; never hand-edit, see Hard rules)
                           src/components/play/ the six /play screens, StepShell (responsive
                                                 frame), Tracker, Ticket
                           e2e/                 Playwright smoke test for /play (desktop + phone)
                           scripts/guard-diff.mjs   safe (non-flooding) diff for the map guard
notebooks/                 gva_demo.ipynb (pipeline walkthrough), simulation_demo.ipynb (reference values),
                           demo_scenarios.ipynb (generate the 18-scenario grid, run it one
                           scenario at a time, stress-test replay, evaluate, compare)
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
python3 -m demo.experiments.run_model --write-scenarios                        # (re)generate scenarios/*.json from PAPER_GRID
python3 -m demo.experiments.run_model budget_080k rhythm_uniform               # model runs; the notebook is the supported way to run the grid
python3 -m demo.experiments.simulate --stations demo/experiments/results/budget_080k/stations.json --day monday   # stress-test replay only
python3 -m demo.experiments.evaluate demo/experiments/results/budget_060k demo/experiments/results/budget_080k demo/experiments/results/budget_120k --compare

# tests (unittest-style, pytest-compatible; pytest.ini points at demo/experiments/tests)
DEMO_TESTS_FAST=1 python3 -m unittest discover -s demo/experiments/tests -t .   # ~0.3 s, skips the 112-day replay
pytest                                                                          # full suite

# game payload (needs the uncommitted k-shortest-path pickle; see Hard rule 4)
python3 -m demo.experiments.game_export                                        # results/shared/game/** (+ golden/)
python3 -m unittest demo.experiments.tests.test_fixed_design -v                # fidelity, golden, degenerate-layout tests

# front-end
cd demo/frontend && npm install && npm run dev        # http://localhost:4321/inocs-sum-bss-pt-network-design/
npm run build                                          # prebuild regenerates public/data from demo/experiments
npm run check < /dev/null                              # astro check (type-check); needs @astrojs/check (devDependency).
                                                         #   Redirect stdin: without it, a missing @astrojs/check prompts
                                                         #   to install and hangs forever if stdin is a TTY.
npm test                                                # vitest run: domain/infra unit tests + the golden-vector
                                                         #   engine.test.ts + the map markup guard
npx playwright install chromium                         # once, before the first npm run e2e
npm run build && npm run e2e                            # Playwright smoke test for /play (desktop + phone); builds
                                                         #   dist/ first and serves it under the real base path

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
  `instance_builder.generate_h3_instances` in `sys.modules`; writes `stations.json`, `metrics.json`
  (the SDK's full `experiment_row`, not just `HEADLINE_METRICS`), `instance.json`, `model_plan.json`,
  `results/shared/bike_arcs.json`, each with a `run` provenance block.
  `demo.experiments.run_model.write_scenarios()` turns `PAPER_GRID` (the 18-run definition) into
  `scenarios/<id>.json`.
- `demo.experiments.simulate.DaySimulation` / `replay()` — the **stress test**: the observed trips
  of Geneva replayed against a design. `sample`/`instance` modes are DEPRECATED (see below).
  Details: `demo/experiments/METHODS.md` §3.
- `demo.experiments.evaluate.evaluate_scenario(dir) / compare` — writes `kpis.json`
  (`"schema": "kpis-v3"`) with three blocks: `paper` (the paper's own metrics, from
  `model_plan.json` + `metrics.json`), `technical` (the full evaluator row + solver stats),
  `stress_test` (the replay, labelled as a demo-side check). `evaluate_day_legacy` is DEPRECATED.
  Pure dict → dict; no coefficient from `kpi_config.json` reaches `paper` or `technical`.
- `demo.experiments.fixed_design.evaluate(instance, station_ids, budget, ops_budget=None,
  epsilon=None, trucks=True)` — the normative "evaluate a visitor's layout" LP (scipy
  `linprog`, `method="highs"`); `Instance.for_game()` / `.from_export(demand=scenario_id)`
  builds the instance from the committed `results/shared/game/*.json`. Never raises for an
  infeasible or empty layout — `result["feasible"]` says so, `served` is 0, `note` explains
  why. `summary(result)` drops the bulky `flows` list and wall-clock timing for golden
  vectors. Importable and its pure helpers (`max_stations`, `reach_options`,
  `assistant_order`) usable without scipy; only `evaluate()` needs it.
- `demo.experiments.game_export` — `python3 -m demo.experiments.game_export [--out DIR]
  [--quiet]` writes the browser payload under `results/shared/game/`: `candidates.json`,
  `cells.json`, `paths.json` (candidate paths with explicit bike legs — a path's
  de-duplicated station list is NOT its legs, see the module docstring's "trap"),
  `arcs.json`, `demand_reference.json`, `coverage.json`, `constants.json`,
  `references.json` (per-budget optimiser/random/demand-rule comparisons) and 21
  `golden/<scenario>.json` vectors. Needs the uncommitted k-shortest-path pickle (Hard
  rule 4); everything downstream reads the committed JSON instead.
- `demo/frontend/src/domain/evaluation/` — the TypeScript port of `fixed_design.py` (see
  Hard rule 2's declared exception). `lpModel.buildLp(data, options)` builds the LP,
  `kpis.readEvaluation(...)` / `emptyEvaluation(...)` turn a solved (or empty) LP into an
  `Evaluation` (`ports.ts`): `quality: 'exact' | 'estimate'`, `feasible`, `served`,
  `servedByPeriod`, `ptShare`, `docks`, `bikes`, `losses` (`noStation`/`noStock`/
  `unreachable`), `flows`. The `Evaluator` interface (`evaluate(layout, budgetEur,
  { trucks })`) is implemented by `infra/highsEvaluator.ts` (exact, HiGHS wasm, in a
  worker in the browser) and `infra/estimateEvaluator.ts` (fallback: `served ≈
  withinReach(layout) * factor(budget)`, `flows` empty, tens-of-percent accuracy —
  never used to rank layouts).
- `demo/frontend/src/hooks/useGameSession.ts` — `useGameSession(store, env, options)`
  wraps `domain/game/session.ts`'s reducer: renders the empty session first (server and
  client match), restores the stored one in an effect after mount, exposes `hydrated`
  so a screen can hold back a decision until restoration is known to be done.
- `demo/frontend/src/components/map/frame/MapFrame.tsx` — owns the camera (pan/zoom,
  `controlsRef`), the zoom buttons and four slots (`top`, `bottom`, `overlay`, `popover`);
  a slot is fixed content or a `(view: { unitPx }) => ReactNode` render prop. The parent
  composes what is drawn — `MapPanel`/`CityMap` render `AdvancedLayers` inside it,
  `StepShell` (the game) renders the game's own layers — the frame itself draws nothing
  domain-specific. `onTap` fires on a pointer-up that was a tap, not a drag.
- `demo/frontend/src/lib/usePanZoom.ts`'s `onTap` — the camera captures the pointer for
  pan/zoom/pinch, so a click handler on an individual map element is not reliable
  (plan-technical §C.1). The game's placement flow is therefore `onTap` (map units) →
  `domain/placement/hitTest.ts` (pure) → `usePlacement`'s decision (`placed` / `removed`
  / `ambiguous` — zooms in and places nothing / `miss` / `refused`), never a per-station
  `onClick`.

## Data contracts

- Model input (`<geojson_dir>/`, name must equal `util.util.h3_version`): `grid.geojson` (H3 r9),
  `stops.geojson`, `itineraries.geojson`, `bike_trips.geojson`, `od.csv` (`origin_cell,dest_cell,flow`;
  703 rows / 1,453 trips, counted from the observed trips by `od_builder.py`). The four GeoJSON files
  come from the companion package `inocs-sum-gtfs-geojson`.
- `demo/experiments/results/<scenario>/` is what the front-end consumes; required:
  `stations.json`, `kpis.json`, `model_plan.json`; optional: `metrics.json`, `sim_monday.json`,
  `sim_sunday.json` (the stress-test replay, read into `kpis.json`'s `stress_test` block).
  `prepare-data.mjs` also writes a `plan_slim.json` (periods + built stations with per-period
  inventory) from `model_plan.json`, for the map. Scenarios are discovered by folder, a missing
  required file hides the scenario with a warning. A scenario also needs `scenarios/<id>.json`.
  Deleted, not written any more: `sim_monday_x25.json`, `sim_instance.json`, `results/baseline_20k/`.
- Scenario JSON (`scenarios/<id>.json`, `"schema": "scenario-v3"`; full field reference:
  `demo/experiments/scenarios/README.md`):
  `id`, `family` (`baseline`/`budget`/`ops_ratio`/`epsilon`/`rhythm`), `role` (`card`/`compare`),
  `card` + `audience_pitch` + `narrative` (cards only), `title`, `axis_label`, `temporal_profile`,
  `outside_paper_range`, `paper_reference`, `legacy` (S1-S3 only), and `model_parameters`:
  `total_budget`, `op_budget_ratio`, `demand_periods`, `period_weights` (must sum to 1),
  `split_method`, `seed`, `epsilon`, `solve_mode`. Generated by
  `python -m demo.experiments.run_model --write-scenarios` from `run_model.PAPER_GRID` (18 runs);
  existing files are kept unless `--overwrite` is passed. Legacy `S1_essential`/`S2_balanced`/
  `S3_ambitious` (20k/80k/140k €, observed weekday weights, solved optimal 2026-09-10) stay,
  flagged `legacy: true`, until the paper grid is run and validated.
- `evaluate.py` CLI: `python -m demo.experiments.evaluate <result_dir>... [--compare] [--out FILE]`
  writes/reads `kpis.json`; `--compare` renders the cross-scenario markdown table.
- `demo/experiments/results/shared/game/` (generated + golden-pinned, Hard rule 4). Every
  file carries a `method` block. Approximate uncompressed sizes:
  `candidates.json` (~4.6K, 100 rows: `[id, type_index, lon, lat]`), `cells.json` (~2.9K,
  56 rows: `[id, lon, lat, buildable]`), `paths.json` (~69K, one row per candidate path of
  a demanded OD pair with explicit bike legs), `arcs.json` (~68K, the ride network:
  `[from, to, km]`), `demand_reference.json` (~12K, the game's own per-period OD demand),
  `coverage.json` (~32K, per-candidate walk-catchment cells + potential flow + the reach
  table), `constants.json` (~2K, unit costs + behavioural constants read live from
  `network-design-bss/src/`, plus the four game budgets), `references.json` (~11K,
  per-budget optimiser/random/demand-rule comparisons). `golden/*.json` (21 files, ~156K
  total, **not shipped to the browser**): per committed design, its station ids and the
  engine's own evaluation with and without trucks.

## Gotchas

- First model run spends ~50 min enumerating shortest paths; cached under `src/osm_cache/` and
  `src/data/shortest_paths_result/` (keys carry no scenario parameter, so running the grid back
  to back pays it once).
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
- `demo/frontend/astro.config.mjs` sets `vite: { worker: { format: 'es' } }`: Vite's default
  IIFE worker output cannot be code-split, and the game's solver (`infra/evaluator.worker.ts`)
  lazy-imports the ~1.2 MB `highs` package so nothing downloads until a layout is frozen —
  that lazy import needs an ES module worker.
- The HiGHS wasm binary is served under the site's base path, not guessed: `prepare-data.mjs`
  copies it to `public/data/game/solver/highs-<version>.wasm`, and
  `infra/highsEvaluator.ts`/`workerEvaluator.ts` take the URL as an explicit option — under
  the GitHub Pages project path a relative guess resolves to the wrong place.
- `useHashStep` must not run before the session is restored: the session always renders EMPTY
  first (server and client must match) and is hydrated in an effect after mount; resolving
  `#/step/<id>` against that still-empty session would demote the visitor to the entry step
  and then persist the demotion. `useHashStep` therefore takes a `ready` flag and does nothing
  in either direction until it is true (fixed by `bcb4605` after the Playwright smoke test
  caught the reload-persistence bug it describes).
- The LP's truck figures (`bikes_rebalanced`, `dispatches_relaxed`) are relaxed — continuous
  `n = r / CAPACITY_REBALANCING_VEHICLE` buys fractional truck runs, so the reported dispatch
  count runs 18-31% high on the 21 committed designs. They are reported for the OPTIMISER's
  own layout (`OptimiserRun` in `domain/evaluation/types.ts`) but never for a visitor's: the
  UI shows "trips that depend on trucks" (`servedWithTrucks - servedWithoutTrucks`) instead of
  a truck count.

## Deprecated (to remove after the paper-grid runs are validated)

Demo v3 (2026-09-15) realigns the demonstration with the submitted paper. The following are
kept and marked (module docstring + `warnings.warn(..., DeprecationWarning)`), no longer called
by the live pipeline, and their tests are `@unittest.skip`ped rather than deleted — removal is a
separate clean-up step once the user has run the 18-scenario grid and it is validated:

- `simulate.py`: the `sample` and `instance` modes (`sample`, `instance_run`, `instance_trips`,
  `DaySimulation.draw_trips`, the `plan`/`arcs`/`candidates` arguments, `--mode sample|instance`).
  `replay` (the stress test) stays live.
- `baseline.py` — the whole module (naive "human" design). Superseded by the budget ladder
  itself: every point on it is an optimised design, so the contrast is between budgets, not
  between a human and the optimiser.
- `pipeline/instance.py` — the whole module (readers for the deprecated simulation modes).
- `evaluate.evaluate_day_legacy` (formerly `evaluate_day`) — the simulator-based service /
  mobility / environment / economics KPI families; replaced by `evaluate.paper_kpis` /
  `evaluate.stress_test_kpis`.
- `kpi_config.json` blocks `mode_substitution`, `unserved_fallback`,
  `emission_factors_g_per_pkm`, `equivalences`, and the `costs.amortization_years` /
  `maintenance_eur_per_bike_per_day` / `fare_eur_per_trip` keys — marked `"_deprecated": true`.
  `demand.growth_scenarios` (the ×10/×25 labels) likewise.
- Already deleted (not just deprecated): `sim_monday_x25.json`, `sim_instance.json`,
  `results/baseline_20k/`, for every scenario.

## Known upstream issues (report, do not fix in `src/`)

Tracked in the demo layer's findings (local `.specs/`, summarised here so they survive):

1. Is `od.csv` flow one day's demand or a horizon total? Decides how the "instance day" is presented.
2. `compute_distance` passes `(lon, lat)` to a haversine expecting `(lat, lon)`.
3. OD rows whose cell is unbuildable are not filtered (~60 trips can never be served).
4. `runner.SOLVE_MODES` lists `benders`/`alns`, but neither exists in the frozen dispatch;
   `compat._stub_missing_benders` targets an import that upstream has since removed (harmless).
5. `covered_od_ratio` counts OD *pairs* with any positive assignment, not flow volume
   (`output_handler/metrics_evaluator.py::_compute_coverage_metrics`).
6. Dispatch cost is computed twice: once inside the frozen evaluator's `experiment_row`
   (`dispatch_cost`, written into `metrics.json` → `kpis.json`'s `technical` block) and again by
   `demo/experiments/pipeline/model_plan.py` (`summary.dispatch_cost_eur`, read into `kpis.json`'s
   `paper` block) from the same `r`/`n` decisions. **Checked equal**: `paper.dispatch_cost_eur`
   and `technical.dispatch_cost` agree (within the 2-decimal rounding of the `paper` block) on
   every one of the 18 committed paper-grid `results/*/kpis.json` files (verified 2026-09-20 with
   a one-off script; the three legacy `S1`/`S2`/`S3` runs predate the `technical.dispatch_cost`
   field and were not part of the check).
7. `CAPACITY_UB = 30` docks per station (`network-design-bss/src/util/util.py:71`) caps served
   flow once the budget stops binding, independent of money: with all 100 stations open and both
   budgets unlimited, the fixed-design LP serves 1,321 of 1,453 trips (0.909) — of the 132
   unserved, ~60 have no candidate path at all (issue 3) and the other ~72 are blocked by the
   30-dock cap; raising the cap to 50 docks reaches 1,393 (0.959), the path-coverage ceiling
   (unaffected by the cap beyond that point). So the served-flow curve's flattening near 91% as
   budget grows is partly this modelling parameter, not purely diminishing economic returns —
   worth stating wherever that flattening is discussed.

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
| The planner game (`/play`): visitor steps, layered architecture, map composition, running its tests | `demo/frontend/README.md` §"Planner game (/play)" |
| The planner game's application logic (session, steps, predictions, ticket, results view-models) | `demo/frontend/src/domain/game/README.md` |
| The fixed-design LP (normative layout evaluation) and the game data export | `demo/experiments/README.md`, `demo/experiments/METHODS.md` (both have a short section); source of truth is `demo/experiments/fixed_design.py` and `game_export.py`'s own docstrings |
| Model internals stage by stage, executable | `notebooks/gva_demo.ipynb` |
| Upstream research notes (ALNS, scale tests) | `network-design-bss/src/docs/*.md` |

## Conventions

- Python: match surrounding style; docstrings in English; SDK and demo modules open with a
  file-level docstring stating purpose and constraints.
- Tests: `unittest.TestCase` only (no pytest fixtures), so both runners work.
- Every artefact a pipeline stage writes carries a `method`/`run`/`provenance` block; keep that.
- Front-end copy lives in `demo/frontend/src/i18n/{en,fr}.json`; a missing `fr` key falls back to `en`.
- Do not commit anything under `demo/frontend/public/data/`, `network-design-bss/src/{osm_cache,cache,plot,data/output,...}` or `build/`.
