# demo/experiments/tests/

Test suite for the demo pipeline (`demo/experiments/`): calibration, scenario grid validation,
the replay stress test, and evaluation. Stdlib `unittest` based throughout (no pytest-only
fixtures or decorators), so the same test files run with either runner.

## How to run

From the repository root:

```bash
# stdlib, no dependencies required
python3 -m unittest discover -s demo/experiments/tests -t . -v

# once pytest is installed (pipenv run pytest, or plain pip install pytest)
python3 -m pytest demo/experiments/tests
# or, using the pytest.ini at the repo root:
pytest
```

`pytest.ini` at the repo root points `testpaths` at this directory so a bare
`pytest` run from the repo root picks these tests up automatically.

Skip the slow 112-observed-day Monday replay in `test_golden_pipeline.py`
(the other tests are cheap -- the observed volumes are tiny, ~11.5
trips/day):

```bash
DEMO_TESTS_FAST=1 python3 -m unittest discover -s demo/experiments/tests -t .
```

## What's pinned now

- **`test_golden_pipeline.py`** -- the characterization / golden suite. Pins the current
  pipeline's outputs to the *committed* artefacts:
  - `data/calibration.json`, `data/profiles.json` (`CalibrationGoldenTests`).
  - every scenario's `sim_monday.json` / `sim_sunday.json` -- the replay stress test
    (`ReplayGoldenTests`), the only live simulation mode.
  - every scenario's `kpis.json` in its v3 form (`"schema": "kpis-v3"`, three blocks --
    `paper`, `technical`, `stress_test`) against `evaluate.evaluate_scenario(dir)`
    (`EvaluateGoldenTests`).
  - the whole scenario grid (`ScenarioValidationTests`): every `scenarios/*.json` carries the
    v3 contract (`schema`, `id` matching its filename, a known `family`, a known `role`, period
    weights summing to 1 with one weight per declared period, cards carrying their copy, unique
    ids), and the committed non-legacy grid matches `run_model.PAPER_GRID` exactly -- 18 runs,
    exactly one `baseline`.

  These tests compare *parsed JSON*, never raw bytes or in-memory Python objects straight out of
  the build functions -- some fields serialise differently than they compare in memory, so every
  freshly-built artefact is round-tripped through `json.dumps`/`json.loads` (or read back from
  the tempfile it was written to) before comparison, exactly like the committed file was.
  Absolute-path fields (`source`, `demand_source`) are stripped before comparing, since they
  differ machine to machine.

  **If a golden test fails against the current code, the test is not wrong by default.** It
  means either the committed artefact is stale (code changed, artefacts weren't regenerated) or
  a real regression was introduced. Do not edit the test to match; investigate and report the
  discrepancy instead.

- **`test_src_parity.py`** -- pins the values the demo mirrors from the
  frozen upstream model in `network-design-bss/src/` (unit costs, walk
  catchment, ride speed, truck capacity, the haversine formula), which is
  synced from another repository and never edited here. A "light" tier
  (cost constants only) always runs; a "heavy" tier needs the optional geo
  stack (`osmnx`/`geopandas`/`h3`) the frozen model depends on and is
  skipped with a clear reason when those are not installed -- as they are
  not in the base repo environment. These tests exist so a future sync that
  renames or changes one of these constants fails loudly here instead of
  the demo silently drifting out of parity.

- **`test_timeutil.py`**, **`test_geometry.py`** -- unit tests for
  `demo.experiments.pipeline.timeutil` / `.geometry`.

- **`_helpers.py`** -- shared path constants (`REPO_ROOT`, `DATA`,
  `RESULTS`, `SCENARIOS`) and `load_json`, `strip_paths`, `assert_json_equal`
  (a readable first-differing-key-path diff). Not a test module itself.

## What's skipped, and why

Demo v3 (2026-09-15) deprecates several simulation/evaluation code paths without deleting them
(see `AGENTS.md`'s "Deprecated" list) -- they stay callable, marked with a `DeprecationWarning`,
until the paper-grid runs are validated. The golden tests that pinned their artefacts are kept
(`@unittest.skip`, not removed) so the pins come back automatically if a decision is reversed,
but they no longer run because the artefacts they compared against are gone:

- `BaselineGoldenTest` (`baseline.py`'s `build_baseline` vs `results/baseline_20k/stations.json`)
  -- `results/baseline_20k/` was deleted with the module.
- `SampleGoldenTests` (`simulate.sample` vs `sim_monday_x25.json`) -- every `sim_monday_x25.json`
  was deleted with the `sample` mode.
- `InstanceGoldenTests` (`simulate.instance_run` vs `sim_instance.json`) -- every
  `sim_instance.json` was deleted with the `instance` mode.

## Golden tests never write into `data/` or `results/`

Every `build_*()` / `evaluate_scenario(..., write=False)` call in the golden suite is pointed at
a path inside a `tempfile.TemporaryDirectory()`, or called without writing. The committed files
under `demo/experiments/data/` and `demo/experiments/results/` are read-only fixtures as far as
this suite is concerned.

## Regenerating the committed artefacts

The golden tests compare against the artefacts *already committed* in
`data/` and `results/`. There is no "regenerate and re-run" step baked into
the suite, and there should not be one added casually: these files are the
model's/demo's documented output contract (read by `demo/frontend/` and the
notebook), not scratch fixtures.

If a genuine, intentional change to the pipeline's numbers is made (a bug fix, a recalibration,
a new or re-run scenario), regenerate the affected artefact explicitly with its own CLI entry
point --

```bash
python3 -m demo.experiments.trips                                                  # data/calibration.json
python3 -m demo.experiments.profiles                                               # data/profiles.json
python3 -m demo.experiments.run_model --write-scenarios --overwrite                # scenarios/*.json, from PAPER_GRID
python3 -m demo.experiments.run_model <scenario_id>...                             # stations/metrics/instance/model_plan.json (Gurobi; the notebook is the supported way)
python3 -m demo.experiments.simulate --stations <result_dir>/stations.json --day monday   # sim_monday.json (the stress test)
python3 -m demo.experiments.evaluate <scenario_dir>...                             # kpis.json
```

There is no `baseline.py` regeneration command and no `--compare-day` flag any more (`evaluate.py`
takes `--compare`, not a day argument -- the `paper` block already covers every period) -- review
the diff, update the golden test's expectations only if the new numbers are correct on
inspection, and say so explicitly in the commit message. Never regenerate silently as a way to
make a failing test pass.
