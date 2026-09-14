# demo/experiments/tests/

Test suite for the demo pipeline (`demo/experiments/`): calibration, design
baseline, simulation and evaluation. Stdlib `unittest` based throughout (no
pytest-only fixtures or decorators), so the same test files run with either
runner.

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

## What's here

- **`test_golden_pipeline.py`** -- the characterization / golden suite.
  Pins the current pipeline's outputs to the *committed* artefacts:
  `data/calibration.json`, `data/profiles.json`, every scenario's
  `stations.json` + `sim_monday.json` / `sim_sunday.json` (replay mode),
  `sim_monday_x25.json` (seeded Monte Carlo sample), `kpis.json`, and
  `results/baseline_20k/stations.json`. It also checks that every
  `scenarios/S*.json` has period weights summing to 1 with one weight per
  declared demand period.

  These tests compare *parsed JSON*, never raw bytes or in-memory Python
  objects straight out of the build functions -- some fields (e.g. tuples in
  `period_bounds_local`) serialise differently than they compare in memory,
  so every freshly-built artefact is round-tripped through
  `json.dumps`/`json.loads` (or read back from the tempfile it was written
  to) before comparison, exactly like the committed file was. Absolute-path
  fields (`source`, `demand_source`) are stripped before comparing, since
  they differ machine to machine.

  **If a golden test fails against the current code, the test is not wrong
  by default.** It means either the committed artefact is stale (code
  changed, artefacts weren't regenerated) or a real regression was
  introduced. Do not edit the test to match; investigate and report the
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
  `demo.experiments.pipeline.timeutil` / `.geometry`. They skip themselves
  (via `unittest.SkipTest`) if that module doesn't exist yet, so they are
  safe to run mid-refactor before `pipeline/` is fully extracted.

- **`_helpers.py`** -- shared path constants (`REPO_ROOT`, `DATA`,
  `RESULTS`, `SCENARIOS`) and `load_json`, `strip_paths`, `assert_json_equal`
  (a readable first-differing-key-path diff). Not a test module itself.

## Golden tests never write into `data/` or `results/`

Every `build_*()` call in the golden suite is pointed at a path inside a
`tempfile.TemporaryDirectory()`. The committed files under
`demo/experiments/data/` and `demo/experiments/results/` are read-only
fixtures as far as this suite is concerned.

## Regenerating the committed artefacts

The golden tests compare against the artefacts *already committed* in
`data/` and `results/`. There is no "regenerate and re-run" step baked into
the suite, and there should not be one added casually: these files are the
model's/demo's documented output contract (read by `demo/frontend/` and the
notebook), not scratch fixtures.

If a genuine, intentional change to the pipeline's numbers is made (a bug
fix, a recalibration, a new scenario), regenerate the affected artefact
explicitly with its own CLI entry point --

```bash
python3 -m demo.experiments.trips        # data/calibration.json
python3 -m demo.experiments.profiles     # data/profiles.json
python3 -m demo.experiments.baseline --budget 20000 --out demo/experiments/results/baseline_20k/stations.json
python3 -m demo.experiments.simulate --stations <design>/stations.json --day monday
python3 -m demo.experiments.evaluate <scenario_dir> ...
```

-- review the diff, update the golden test's expectations only if the new
numbers are correct on inspection, and say so explicitly in the commit
message. Never regenerate silently as a way to make a failing test pass.
