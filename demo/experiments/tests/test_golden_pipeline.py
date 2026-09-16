"""
File: test_golden_pipeline.py
Description: Characterization tests pinning the demo pipeline's current
             outputs to the committed artefacts in demo/experiments/data/
             and demo/experiments/results/.

These are the safety net for the pipeline/ refactor described in
.specs/demo-pipeline/plan.md: they run against whatever code is on disk
(today's flat modules, tomorrow's pipeline.* package, as long as the public
names in demo.experiments.{trips,profiles,simulate,evaluate,baseline} keep
their current signatures) and compare against the frozen, committed JSON.

IMPORTANT -- if one of these fails against the current code:
    Do NOT "fix" the test to match. The committed artefacts are the
    contract; a failure here means either the artefacts are stale or a
    real regression was introduced. Report the exact differing values.

The tests never write into demo/experiments/data/ or demo/experiments/results/;
every build_*() call is pointed at a tempfile.

Set DEMO_TESTS_FAST=1 to skip the full 112-day Monday replay (the slowest
characterization test; the other tests are cheap given the tiny observed
volumes, ~11.5 trips/day).

Demo v3 (2026-09-15): the classes pinning deprecated artefacts
(`sim_monday_x25.json`, `sim_instance.json`, `results/baseline_20k/`) are
kept but skipped -- the artefacts themselves are gone, and the code they
pinned is deprecated, not yet deleted. `EvaluateGoldenTests` now pins
`kpis.json` in its v3 form (`evaluate.evaluate_scenario`), and
`ScenarioValidationTests` validates the whole generated paper grid.
"""

import json
import os
import tempfile
import unittest
from pathlib import Path

from demo.experiments.evaluate import KPIS_SCHEMA, evaluate_scenario
from demo.experiments.profiles import build_profiles
from demo.experiments.run_model import PAPER_GRID, SCENARIO_SCHEMA
from demo.experiments.simulate import load_stations, replay
from demo.experiments.trips import build_calibration

from ._helpers import DATA, RESULTS, SCENARIOS, assert_json_equal, load_json, strip_paths

#: Skip the full 112-observed-day Monday replay (the one genuinely slow
#: characterization test) when set. Every other test here is cheap.
FAST = os.environ.get("DEMO_TESTS_FAST") == "1"

#: Why the sample / instance / baseline golden tests no longer run. The
#: classes stay so the pins come back with the code if a decision is
#: reversed; the artefacts they compared against were removed with the
#: modes themselves (implementation.md 2).
DEPRECATED = ("DEPRECATED (demo v3, 2026-09-15): the sample and instance "
              "simulation modes and baseline.py are replaced by the model's "
              "own solved plan; their committed artefacts "
              "(sim_monday_x25.json, sim_instance.json, results/baseline_20k/) "
              "were removed with them.")

#: Every result directory that ships committed artefacts to pin against.
_SCENARIO_DIRS = sorted(p for p in RESULTS.iterdir() if p.is_dir()) if RESULTS.is_dir() else []


class CalibrationGoldenTests(unittest.TestCase):
    """build_calibration()/build_profiles() must reproduce the committed
    data/calibration.json and data/profiles.json exactly (paths aside).
    """

    def test_build_calibration_matches_committed(self):
        committed = load_json(DATA / "calibration.json")
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / "calibration.json"
            build_calibration(output_file=out_path)
            # Round-trip through JSON (not the raw in-memory dict): the
            # committed file was parsed from JSON, and some fields (e.g.
            # tuples) serialise differently than they compare in memory.
            built = load_json(out_path)
        assert_json_equal(self, strip_paths(built), strip_paths(committed),
                          "build_calibration() vs data/calibration.json")

    def test_build_profiles_matches_committed(self):
        committed = load_json(DATA / "profiles.json")
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / "profiles.json"
            build_profiles(output_file=out_path)
            built = load_json(out_path)
        assert_json_equal(self, strip_paths(built), strip_paths(committed),
                          "build_profiles() vs data/profiles.json")


@unittest.skip(DEPRECATED)
class BaselineGoldenTest(unittest.TestCase):
    """build_baseline(20000) must reproduce results/baseline_20k/stations.json
    (the bare-list schema).

    Since Phase B the baseline picks from the model's own candidate sites, so
    the design depends on an instance.json: the test passes the same one the
    committed file was built from (the reference scenario's) rather than
    relying on the search order.
    """

    def test_build_baseline_20k_matches_committed(self):
        from demo.experiments.baseline import build_baseline
        from demo.experiments.pipeline.instance import find_instance

        committed_path = RESULTS / "baseline_20k" / "stations.json"
        if not committed_path.is_file():
            raise unittest.SkipTest("results/baseline_20k/stations.json not committed")
        instance_path = find_instance(committed_path)
        if instance_path is None:
            raise unittest.SkipTest("no instance.json committed under results/")
        committed = load_json(committed_path)
        built = json.loads(json.dumps(
            build_baseline(20000, instance=instance_path)))
        assert_json_equal(self, built, committed,
                          "build_baseline(20000) vs results/baseline_20k/stations.json")


_REPLAY_KEYS = ("totals", "replay_ensemble", "rebalancing", "n_stations",
               "total_capacity", "total_bikes_initial", "hourly", "stations")
_SAMPLE_KEYS = ("totals", "rebalancing")


class ReplayGoldenTests(unittest.TestCase):
    """replay(stations, day) must reproduce every committed sim_<day>.json
    whose method.mode is "replay" (trace-driven, deterministic)."""

    def _check_replay(self, day):
        checked_any = False
        for scenario_dir in _SCENARIO_DIRS:
            sim_path = scenario_dir / f"sim_{day}.json"
            if not sim_path.is_file():
                continue
            committed = load_json(sim_path)
            if committed.get("method", {}).get("mode") != "replay":
                continue  # e.g. a sample-mode file at this name -- skip
            stations_path = scenario_dir / "stations.json"
            with self.subTest(scenario=scenario_dir.name, day=day):
                stations = load_stations(stations_path)
                result = json.loads(json.dumps(replay(stations, day)))
                for key in _REPLAY_KEYS:
                    assert_json_equal(
                        self, result.get(key), committed.get(key),
                        f"replay({scenario_dir.name}, {day!r})[{key!r}] "
                        f"vs committed sim_{day}.json")
                checked_any = True
        if not checked_any:
            raise unittest.SkipTest(
                f"no committed replay-mode sim_{day}.json found under {RESULTS}")

    @unittest.skipIf(FAST, "DEMO_TESTS_FAST=1: skipping the 112-observed-day "
                          "Monday replay")
    def test_replay_monday_matches_committed(self):
        self._check_replay("monday")

    def test_replay_sunday_matches_committed(self):
        self._check_replay("sunday")


@unittest.skip(DEPRECATED)
class SampleGoldenTests(unittest.TestCase):
    """sample(..., scale, seeds, seed) must reproduce every committed
    sim_monday_x25.json (seeded Monte Carlo resampling is deterministic)."""

    def test_sample_x25_matches_committed(self):
        from demo.experiments.simulate import sample

        checked_any = False
        for scenario_dir in _SCENARIO_DIRS:
            sim_path = scenario_dir / "sim_monday_x25.json"
            if not sim_path.is_file():
                continue
            committed = load_json(sim_path)
            method = committed.get("method", {})
            if method.get("mode") != "sample":
                continue
            seeds_list = method["seeds"]
            stations_path = scenario_dir / "stations.json"
            with self.subTest(scenario=scenario_dir.name):
                stations = load_stations(stations_path)
                result = json.loads(json.dumps(sample(
                    stations, "monday", scale=method["scale"],
                    seeds=len(seeds_list), seed=seeds_list[0])))
                for key in _SAMPLE_KEYS:
                    assert_json_equal(
                        self, result.get(key), committed.get(key),
                        f"sample({scenario_dir.name}, x{method['scale']})"
                        f"[{key!r}] vs committed sim_monday_x25.json")
                if "seed_ensemble" in committed:
                    assert_json_equal(
                        self, result.get("seed_ensemble"),
                        committed.get("seed_ensemble"),
                        f"sample({scenario_dir.name}, x{method['scale']})"
                        f"[seed_ensemble] vs committed sim_monday_x25.json")
                checked_any = True
        if not checked_any:
            raise unittest.SkipTest(
                f"no committed sample-mode sim_monday_x25.json found under {RESULTS}")


_INSTANCE_KEYS = ("totals", "model_view", "seed_ensemble", "rebalancing",
                  "n_stations", "total_capacity", "total_bikes_initial",
                  "hourly", "stations")


@unittest.skip(DEPRECATED)
class InstanceGoldenTests(unittest.TestCase):
    """instance_run(...) must reproduce every committed sim_instance.json.

    The mode's only randomness is the hour drawn inside each demand row's
    period, and it is seeded, so a fixed seed list is a deterministic day.
    The parameters are read back out of the committed file's own `method`
    block -- seeds, and whether unrouted rides were allowed -- so the test
    keeps pinning the file even if the regeneration command changes.
    """

    def test_instance_mode_matches_committed(self):
        from demo.experiments.pipeline.instance import (find_instance,
                                                        load_bike_arcs,
                                                        load_instance,
                                                        load_model_plan)
        from demo.experiments.simulate import instance_run

        checked_any = False
        for scenario_dir in _SCENARIO_DIRS:
            sim_path = scenario_dir / "sim_instance.json"
            if not sim_path.is_file():
                continue
            committed = load_json(sim_path)
            method = committed.get("method", {})
            if method.get("mode") != "instance":
                continue
            stations_path = scenario_dir / "stations.json"
            instance_path = find_instance(stations_path)
            if instance_path is None:
                continue
            seeds_list = method["seeds"]
            with self.subTest(scenario=scenario_dir.name):
                result = json.loads(json.dumps(instance_run(
                    load_stations(stations_path), load_instance(instance_path),
                    seeds=len(seeds_list), seed=seeds_list[0],
                    plan=load_model_plan(scenario_dir), arcs=load_bike_arcs(),
                    allow_unrouted=method.get("allow_unrouted", False),
                    instance_path=instance_path)))
                for key in _INSTANCE_KEYS:
                    assert_json_equal(
                        self, result.get(key), committed.get(key),
                        f"instance_run({scenario_dir.name})[{key!r}] "
                        f"vs committed sim_instance.json")
                assert_json_equal(
                    self, strip_paths(result["method"]),
                    strip_paths(method),
                    f"instance_run({scenario_dir.name})['method'] "
                    f"vs committed sim_instance.json")
                checked_any = True
        if not checked_any:
            raise unittest.SkipTest(
                f"no committed sim_instance.json found under {RESULTS}")


class EvaluateGoldenTests(unittest.TestCase):
    """evaluate_scenario(dir) must reproduce every committed kpis.json.

    The v3 KPI file is computed from `model_plan.json` + `metrics.json`
    (+ the replay sims), so this pins the whole evaluation in one call --
    the paper block, the technical row and the stress test. Nothing is
    written: the committed files are read-only fixtures here.
    """

    def test_evaluate_scenario_matches_committed_kpis(self):
        checked_any = False
        for scenario_dir in _SCENARIO_DIRS:
            kpis_path = scenario_dir / "kpis.json"
            if not kpis_path.is_file():
                continue
            committed = load_json(kpis_path)
            with self.subTest(scenario=scenario_dir.name):
                self.assertEqual(committed.get("schema"), KPIS_SCHEMA,
                                 f"{kpis_path} is not {KPIS_SCHEMA}")
                got = json.loads(json.dumps(
                    evaluate_scenario(scenario_dir, write=False)))
                assert_json_equal(
                    self, strip_paths(got), strip_paths(committed),
                    f"evaluate_scenario({scenario_dir.name}) vs kpis.json")
                checked_any = True
        if not checked_any:
            raise unittest.SkipTest(f"no committed kpis.json found under {RESULTS}")


#: Keys every scenario definition must carry (implementation.md 0.2).
_SCENARIO_REQUIRED_KEYS = ("id", "family", "role", "model_parameters")

#: The sensitivity axes a scenario may belong to. "baseline" is the paper's
#: reference run, which belongs to every family at once.
_SCENARIO_FAMILIES = ("baseline", "budget", "ops_ratio", "epsilon", "rhythm")

#: Cards carry the copy the demonstration shows on its "choose a plan" step.
_CARD_KEYS = ("card", "audience_pitch", "narrative")


class ScenarioValidationTests(unittest.TestCase):
    """Every scenarios/*.json: the v3 contract, and the grid as a whole.

    The paper grid is generated from `run_model.PAPER_GRID`, so these check
    the generator's output as committed -- not a hand-maintained list.
    """

    @classmethod
    def setUpClass(cls):
        cls.scenarios = [(path, load_json(path))
                         for path in sorted(SCENARIOS.glob("*.json"))]

    def test_scenarios_are_committed(self):
        if not self.scenarios:
            raise unittest.SkipTest(f"no scenarios/*.json found under {SCENARIOS}")

    def test_schema_and_required_keys(self):
        for path, scenario in self.scenarios:
            with self.subTest(scenario=path.name):
                self.assertEqual(scenario.get("schema"), SCENARIO_SCHEMA,
                                 f"{path.name}: not {SCENARIO_SCHEMA}")
                for key in _SCENARIO_REQUIRED_KEYS:
                    self.assertIn(key, scenario, f"{path.name}: no {key!r}")
                self.assertEqual(scenario["id"], path.stem,
                                 f"{path.name}: id does not match its filename")
                self.assertIn(scenario["family"], _SCENARIO_FAMILIES,
                              f"{path.name}: unknown family")
                self.assertIn(scenario["role"], ("card", "compare"),
                              f"{path.name}: unknown role")

    def test_period_weights_sum_and_length(self):
        for path, scenario in self.scenarios:
            with self.subTest(scenario=path.name):
                params = scenario["model_parameters"]
                weights = params["period_weights"]
                periods = params["demand_periods"]
                self.assertEqual(
                    len(weights), periods,
                    f"{path.name}: {len(weights)} period_weights, "
                    f"demand_periods={periods}")
                total = sum(weights)
                self.assertAlmostEqual(
                    total, 1.0, delta=1e-6,
                    msg=f"{path.name}: period_weights sum to {total}, not 1")

    def test_cards_carry_their_copy(self):
        for path, scenario in self.scenarios:
            if scenario["role"] != "card":
                continue
            with self.subTest(scenario=path.name):
                for key in _CARD_KEYS:
                    self.assertTrue(scenario.get(key),
                                    f"{path.name}: a card needs {key!r}")

    def test_ids_are_unique(self):
        ids = [scenario["id"] for _, scenario in self.scenarios]
        self.assertEqual(sorted(ids), sorted(set(ids)), "duplicate scenario ids")

    def test_the_paper_grid_is_the_committed_grid(self):
        """18 non-legacy scenarios, exactly one of them the baseline."""
        grid = [scenario for _, scenario in self.scenarios
                if not scenario.get("legacy")]
        self.assertEqual(
            len(grid), len(PAPER_GRID),
            f"{len(grid)} non-legacy scenarios committed, "
            f"{len(PAPER_GRID)} in run_model.PAPER_GRID -- regenerate with "
            f"`python -m demo.experiments.run_model --write-scenarios`")
        self.assertEqual(len(grid), 18, "the paper grid is 18 runs")
        baselines = [s["id"] for s in grid if s["family"] == "baseline"]
        self.assertEqual(len(baselines), 1,
                         f"expected exactly one baseline scenario, got {baselines}")


if __name__ == "__main__":
    unittest.main()
