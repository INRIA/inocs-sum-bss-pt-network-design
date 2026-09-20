"""
File: test_fixed_design.py
Description: Pin demo/experiments/fixed_design.py -- the normative "evaluate a
             visitor's layout" reference -- and the game payload
             demo/experiments/game_export.py writes from it.

Four things are pinned here:

  1. FIDELITY. Applied to each of the 21 committed designs, the fixed-design LP
     must reproduce that run's published `kpis.json` `paper` block: served flow
     within 2 %, PT-assisted share within 0.015 absolute. The LP relaxes the
     integer model, so it can only overshoot; the measured range is 0.9998x to
     1.0157x. If a run ever exceeds the tolerance the test REPORTS it (which
     scenario, by how much) instead of the tolerance being loosened.
  2. TRUCKS OFF. The 80 k EUR design solved with a zero operating budget
     (`ops_000`) must be reproduced by evaluating that same design with
     `trucks=False`, within 1 %.
  3. GOLDEN. The committed files under results/shared/game/ must be exactly what
     the current code produces. Parsed JSON, floats compared with a 1e-6
     tolerance, never bytes -- the same policy as test_golden_pipeline.py.
  4. DEGENERATE LAYOUTS. Zero stations, every candidate at the smallest budget,
     transfer stations only, and a budget too small to pay for the stations
     placed: each has a defined, documented answer and none of them crashes.

scipy is an OPTIONAL dependency of the demo layer, so every solving test is
skipped (with a reason) when it is missing:
`DEMO_TESTS_FAST=1 python3 -m unittest discover -s demo/experiments/tests -t .`
still passes on a stdlib-only interpreter.
"""

import json
import unittest
from pathlib import Path

from demo.experiments import fixed_design
from demo.experiments.fixed_design import (GAME_DIR, Instance, evaluate,
                                           load_constants, summary)

from ._helpers import RESULTS, load_json

try:
    import scipy  # noqa: F401
    _SCIPY = None
except ImportError as exc:  # pragma: no cover - depends on the interpreter
    _SCIPY = str(exc)

_HAS_EXPORT = (GAME_DIR / "paths.json").is_file()
_EXPORT_REASON = (f"the game payload is not exported yet ({GAME_DIR}); run "
                  f"`python3 -m demo.experiments.game_export`")

#: Tolerances agreed in .specs/1demo-game-presentation/plan.md section 3.
SERVED_TOLERANCE = 0.02          # relative
PT_SHARE_TOLERANCE = 0.015       # absolute
TRUCKS_OFF_TOLERANCE = 0.01      # relative
GOLDEN_TOLERANCE = 1e-6          # absolute, on floats


def _scenarios():
    """Every committed design that has both a plan and published KPIs."""
    from demo.experiments.game_export import ALL_SCENARIOS
    return [s for s in ALL_SCENARIOS
            if (RESULTS / s / "kpis.json").is_file()
            and (RESULTS / s / "model_plan.json").is_file()]


def _built(scenario):
    plan = load_json(RESULTS / scenario / "model_plan.json")
    return [station["id"] for station in plan["stations"] if station["built"]]


def _envelopes(scenario):
    paper = load_json(RESULTS / scenario / "kpis.json")["paper"]
    metrics = RESULTS / scenario / "metrics.json"
    epsilon = 0.0
    if metrics.is_file():
        epsilon = float(load_json(metrics).get("epsilon") or 0.0)
    return paper, paper["budget_eur"], paper.get("op_budget_eur"), epsilon


def _close(actual, expected, tolerance):
    """Structural comparison with a float tolerance.

    :return: None when equal, else a readable path to the first difference.
    """
    def walk(a, b, path):
        if isinstance(a, bool) or isinstance(b, bool):
            return None if a is b else f"{path}: {a!r} != {b!r}"
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            if abs(float(a) - float(b)) <= tolerance:
                return None
            return f"{path}: {a!r} != {b!r} (delta {abs(float(a) - float(b)):g})"
        if isinstance(a, dict) and isinstance(b, dict):
            for key in sorted(set(a) | set(b)):
                if key not in a:
                    return f"{path}[{key!r}]: missing on the left"
                if key not in b:
                    return f"{path}[{key!r}]: missing on the right"
                found = walk(a[key], b[key], f"{path}[{key!r}]")
                if found:
                    return found
            return None
        if isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                return f"{path}: length {len(a)} != {len(b)}"
            for index, (left, right) in enumerate(zip(a, b)):
                found = walk(left, right, f"{path}[{index}]")
                if found:
                    return found
            return None
        return None if a == b else f"{path}: {a!r} != {b!r}"

    return walk(actual, expected, "")


@unittest.skipIf(_SCIPY is not None, f"scipy is not installed: {_SCIPY}")
@unittest.skipUnless(_HAS_EXPORT, _EXPORT_REASON)
class FidelityTests(unittest.TestCase):
    """The LP on each committed design vs that run's published `paper` block."""

    @classmethod
    def setUpClass(cls):
        cls.results = {}
        for scenario in _scenarios():
            instance = Instance.from_export(demand=scenario)
            paper, budget, ops_budget, epsilon = _envelopes(scenario)
            cls.results[scenario] = (
                instance, paper,
                evaluate(instance, _built(scenario), budget, ops_budget,
                         epsilon, trucks=True))

    def test_served_within_two_percent(self):
        drift = []
        for scenario, (_i, paper, result) in sorted(self.results.items()):
            published = paper["served_total"]
            ratio = result["served"] / published
            if abs(ratio - 1.0) > SERVED_TOLERANCE:
                drift.append(f"{scenario}: LP {result['served']:.1f} vs "
                             f"published {published} (ratio {ratio:.4f})")
        self.assertFalse(drift, "the fixed-design LP no longer reproduces the "
                                "published served flow within "
                                f"{SERVED_TOLERANCE:.0%}:\n  "
                         + "\n  ".join(drift)
                         + "\nDo NOT loosen the tolerance to make this pass: "
                           "report the scenarios above.")

    def test_pt_share_within_0_015(self):
        drift = []
        for scenario, (_i, paper, result) in sorted(self.results.items()):
            published = paper["pt_assisted_share"]
            delta = abs(result["pt_share"] - published)
            if delta > PT_SHARE_TOLERANCE:
                drift.append(f"{scenario}: LP {result['pt_share']:.4f} vs "
                             f"published {published} (delta {delta:.4f})")
        self.assertFalse(drift, "the fixed-design LP no longer reproduces the "
                                "published PT-assisted share within "
                                f"{PT_SHARE_TOLERANCE}:\n  "
                         + "\n  ".join(drift))

    def test_the_lp_never_underestimates_by_much(self):
        """The relaxation can only overshoot; a big shortfall means a bug."""
        for scenario, (_i, paper, result) in sorted(self.results.items()):
            with self.subTest(scenario=scenario):
                self.assertGreater(result["served"] / paper["served_total"],
                                   1.0 - SERVED_TOLERANCE)

    def test_losses_and_served_account_for_all_demand(self):
        for scenario, (instance, _p, result) in sorted(self.results.items()):
            with self.subTest(scenario=scenario):
                total = result["served"] + sum(result["losses"].values())
                self.assertAlmostEqual(total, instance.demand_total, places=6)

    def test_unreachable_demand_is_the_known_upstream_gap(self):
        """~60 trips sit on OD pairs with no path at all (upstream issue #3)."""
        for scenario, (_i, _p, result) in sorted(self.results.items()):
            with self.subTest(scenario=scenario):
                self.assertGreater(result["losses"]["unreachable"], 0)


@unittest.skipIf(_SCIPY is not None, f"scipy is not installed: {_SCIPY}")
@unittest.skipUnless(_HAS_EXPORT, _EXPORT_REASON)
class TrucksOffTests(unittest.TestCase):
    """`trucks=False` must reproduce the run that was solved with no operating
    budget at all."""

    def test_ops_000_design_without_trucks_matches_its_own_run(self):
        scenario = "ops_000"
        if scenario not in _scenarios():
            self.skipTest(f"{scenario} has no committed results")
        instance = Instance.from_export(demand=scenario)
        paper, budget, _ops, epsilon = _envelopes(scenario)
        result = evaluate(instance, _built(scenario), budget, ops_budget=None,
                          epsilon=epsilon, trucks=False)
        ratio = result["served"] / paper["served_total"]
        self.assertLess(
            abs(ratio - 1.0), TRUCKS_OFF_TOLERANCE,
            f"{scenario} solved without trucks gives {result['served']:.1f}, "
            f"the run itself published {paper['served_total']} "
            f"(ratio {ratio:.4f})")

    def test_trucks_off_forces_a_zero_operating_budget(self):
        instance = Instance.for_game()
        result = evaluate(instance, _built("budget_080k"), 80000,
                          ops_budget=99999, epsilon=0.04, trucks=False)
        self.assertEqual(result["ops_budget_eur"], 0.0)
        self.assertEqual(result["bikes_rebalanced"], 0.0)
        self.assertEqual(result["lp"]["rebalancing_columns"], 0)

    def test_trucks_off_never_serves_more_than_trucks_on(self):
        instance = Instance.for_game()
        stations = _built("budget_080k")
        _paper, budget, ops_budget, epsilon = _envelopes("budget_080k")
        with_trucks = evaluate(instance, stations, budget, ops_budget, epsilon,
                               trucks=True)
        without = evaluate(instance, stations, budget, ops_budget, epsilon,
                           trucks=False)
        self.assertLessEqual(without["served"], with_trucks["served"] + 1e-6)


@unittest.skipIf(_SCIPY is not None, f"scipy is not installed: {_SCIPY}")
@unittest.skipUnless(_HAS_EXPORT, _EXPORT_REASON)
class GoldenVectorTests(unittest.TestCase):
    """Every committed golden vector must be what the current code produces."""

    def test_every_scenario_has_a_golden_vector(self):
        expected = set(_scenarios())
        found = {p.stem for p in (GAME_DIR / "golden").glob("*.json")}
        self.assertEqual(found, expected)

    def test_golden_vectors_are_reproduced(self):
        for scenario in _scenarios():
            with self.subTest(scenario=scenario):
                committed = load_json(GAME_DIR / "golden" / f"{scenario}.json")
                instance = Instance.from_export(demand=scenario)
                _paper, budget, ops_budget, epsilon = _envelopes(scenario)
                stations = _built(scenario)
                fresh = {
                    "with_trucks": summary(evaluate(instance, stations, budget,
                                                    ops_budget, epsilon,
                                                    trucks=True)),
                    "without_trucks": summary(evaluate(instance, stations,
                                                       budget, ops_budget,
                                                       epsilon, trucks=False)),
                    "stations": sorted(instance.resolve(stations)),
                }
                # Round-tripped through JSON, exactly like the committed file.
                fresh = json.loads(json.dumps(fresh))
                for key in ("with_trucks", "without_trucks", "stations"):
                    difference = _close(fresh[key], committed[key],
                                        GOLDEN_TOLERANCE)
                    self.assertIsNone(
                        difference,
                        f"{scenario}.json {key} drifted: {difference}\n"
                        f"The committed game payload is the data contract the "
                        f"front-end reads. Do not edit this test; regenerate "
                        f"with `python3 -m demo.experiments.game_export` only "
                        f"for an intentional change, and review the diff.")

    def test_golden_vectors_carry_a_method_block(self):
        for scenario in _scenarios():
            with self.subTest(scenario=scenario):
                golden = load_json(GAME_DIR / "golden" / f"{scenario}.json")
                self.assertIn("method", golden)
                self.assertIn("generated_by", golden["method"])

    def test_no_absolute_path_and_no_timestamp_leaked_into_the_payload(self):
        """A clock or a home directory in these files would make every
        regeneration differ. The exporter must not write either."""
        home = str(Path.home())
        for path in sorted(GAME_DIR.rglob("*.json")):
            with self.subTest(file=path.name):
                text = path.read_text(encoding="utf-8")
                self.assertNotIn(home, text)
                self.assertNotIn("generated_at", text)


@unittest.skipIf(_SCIPY is not None, f"scipy is not installed: {_SCIPY}")
@unittest.skipUnless(_HAS_EXPORT, _EXPORT_REASON)
class PayloadTests(unittest.TestCase):
    """The non-golden game files: constants parity and internal consistency."""

    def test_constants_json_matches_the_frozen_model(self):
        exported = load_json(GAME_DIR / "constants.json")
        live = load_constants()
        for key, value in exported["costs"].items():
            with self.subTest(key=key):
                self.assertEqual(value, live[key])
        for key, value in exported["model"].items():
            with self.subTest(key=key):
                self.assertEqual(value, live[key])
        self.assertEqual(exported["h3_version"], live["h3_version"])

    def test_every_game_budget_matches_its_scenario_file(self):
        exported = load_json(GAME_DIR / "constants.json")
        scenarios_dir = Path(__file__).resolve().parents[1] / "scenarios"
        for block in exported["budgets"]:
            with self.subTest(budget=block["scenario"]):
                parameters = load_json(
                    scenarios_dir / f"{block['scenario']}.json")["model_parameters"]
                self.assertEqual(block["capex_eur"], parameters["total_budget"])
                self.assertEqual(block["epsilon"], parameters["epsilon"])
                self.assertAlmostEqual(
                    block["ops_budget_eur"],
                    parameters["total_budget"] * parameters["op_budget_ratio"],
                    places=6)

    def test_paths_carry_explicit_bike_legs(self):
        """The trap: a path's station list is not its legs. Every exported path
        must carry at least one explicit (from, to) pair."""
        paths = load_json(GAME_DIR / "paths.json")
        self.assertGreater(paths["count"], 0)
        for row in paths["paths"]:
            legs = row[7]
            self.assertTrue(legs)
            for leg in legs:
                self.assertEqual(len(leg), 2)

    def test_reach_is_an_upper_bound_on_served(self):
        """"Within reach" may overestimate service, never underestimate it."""
        instance = Instance.for_game()
        rows = fixed_design.reach_options(instance)
        for scenario, budget in (("budget_020k", 20000), ("budget_080k", 80000)):
            with self.subTest(scenario=scenario):
                layout = instance.resolve(_built(scenario))
                reach = fixed_design.reach_flow(rows, layout)
                _paper, _b, ops_budget, epsilon = _envelopes(scenario)
                served = evaluate(instance, layout, budget, ops_budget,
                                  epsilon, trucks=True)["served"]
                self.assertGreaterEqual(reach, served - 1e-6)

    def test_references_use_the_same_engine_on_both_sides(self):
        references = load_json(GAME_DIR / "references.json")
        self.assertEqual(len(references["budgets"]), 4)
        for block in references["budgets"]:
            with self.subTest(budget=block["budget_eur"]):
                optimiser = block["optimiser"]["with_trucks"]["served"]
                self.assertGreater(optimiser, block["random"]["served_median"])
                self.assertEqual(block["random"]["seed"], 20260920)
                self.assertEqual(block["random"]["layouts"], 30)

    def test_the_demand_rule_reproduces_the_assistant(self):
        """references.json's demand-rule layout must be exactly what
        `assistant_order` produces, or the game's Assistant and its reference
        would disagree."""
        references = load_json(GAME_DIR / "references.json")
        for block in references["budgets"]:
            with self.subTest(budget=block["budget_eur"]):
                instance = Instance.from_export(demand=block["scenario"])
                rows = fixed_design.reach_options(instance)
                order = fixed_design.assistant_order(
                    rows, len(instance.candidate_ids), block["n_stations"])
                self.assertEqual(order, block["demand_rule"]["stations"])


@unittest.skipUnless(_HAS_EXPORT, _EXPORT_REASON)
class ExporterReproducesThePayloadTests(unittest.TestCase):
    """The committed data files must be exactly what the exporter writes today.

    Only this test needs the UNCOMMITTED k-shortest-path pickle
    (`network-design-bss/src/data/shortest_paths_result/..._after.pkl`), because
    only the exporter reads it; it is skipped with a clear reason when the
    pickle is absent, which is the normal state of a fresh clone.

    `references.json` and `golden/` are left out here on purpose -- rebuilding
    them means ~150 LP solves, and they are already pinned by
    `GoldenVectorTests` and by `PayloadTests.test_the_demand_rule_reproduces_the_assistant`.
    """

    #: Everything the browser downloads, except the two files built from solves.
    DATA_FILES = ("constants.json", "candidates.json", "cells.json",
                  "paths.json", "arcs.json", "demand_reference.json",
                  "coverage.json")

    @classmethod
    def setUpClass(cls):
        from demo.experiments import game_export
        if not game_export.PICKLE.is_file():
            raise unittest.SkipTest(
                f"the k-shortest-path cache is not in this checkout "
                f"({game_export.PICKLE.name}); it is uncommitted by design and "
                f"only game_export.py needs it")
        cls.export = game_export

    def test_the_committed_data_files_are_reproduced(self):
        import tempfile
        from demo.experiments.fixed_design import GAME_DIR as committed_dir

        context = self.export.collect()
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            instance = self.export.instance_from_context(context)
            fresh = {
                "constants.json": self.export.write_constants(context, out),
                "candidates.json": self.export.write_candidates(context, out),
                "cells.json": self.export.write_cells(context, out),
                "paths.json": self.export.write_paths(context, out),
                "arcs.json": self.export.write_arcs(context, out),
                "demand_reference.json": self.export.write_demand(context, out),
                "coverage.json": self.export.write_coverage(context, out, instance),
            }
            for name in self.DATA_FILES:
                with self.subTest(file=name):
                    difference = _close(load_json(fresh[name]),
                                        load_json(committed_dir / name),
                                        GOLDEN_TOLERANCE)
                    self.assertIsNone(
                        difference,
                        f"results/shared/game/{name} drifted: {difference}\n"
                        f"This file is the data contract the front-end engine "
                        f"reads. Regenerate with "
                        f"`python3 -m demo.experiments.game_export` only for an "
                        f"intentional change, and review the diff.")


@unittest.skipIf(_SCIPY is not None, f"scipy is not installed: {_SCIPY}")
@unittest.skipUnless(_HAS_EXPORT, _EXPORT_REASON)
class DegenerateLayoutTests(unittest.TestCase):
    """The answers the game must be able to show without crashing.

    Documented behaviour, once:

      * NO STATION            -> feasible, served 0, capex 0, a `note` saying so.
      * EVERY CANDIDATE at 20 k EUR -> the capex is exactly what 100 stations
        plus their MIN_CAPACITY_IF_BUILT docks cost (100 x 100 + 100 x 5 x 20 =
        20 000), so it is FEASIBLE and buys no bike at all: served 0. The
        budget is spent on docks nobody can use.
      * A BUDGET BELOW THAT   -> the LP is infeasible. `feasible` is False,
        served is 0, and `note` carries the solver's message. Nothing raises.
      * TRANSFER STATIONS ONLY -> a legitimate, poor layout: most paths need a
        regular station at one end, so served collapses but stays >= 0.
    """

    @classmethod
    def setUpClass(cls):
        cls.instance = Instance.for_game()
        cls.constants = cls.instance.constants

    def test_zero_stations(self):
        result = evaluate(self.instance, [], 80000, 4000, 0.04, trucks=True)
        self.assertTrue(result["feasible"])
        self.assertEqual(result["served"], 0.0)
        self.assertEqual(result["n_stations"], 0)
        self.assertEqual(result["docks"], 0.0)
        self.assertEqual(result["capex_eur"], 0.0)
        self.assertEqual(result["flows"], [])
        self.assertIn("note", result)
        # Every trip is a loss, and none of them for want of stock.
        self.assertAlmostEqual(sum(result["losses"].values()),
                               self.instance.demand_total, places=6)
        self.assertEqual(result["losses"]["no_stock"], 0.0)

    def test_every_candidate_at_the_smallest_game_budget(self):
        everything = list(range(len(self.instance.candidate_ids)))
        floor = (self.constants["station_setup_cost"] * len(everything)
                 + self.constants["dock_cost"]
                 * self.constants["MIN_CAPACITY_IF_BUILT"] * len(everything))
        self.assertEqual(floor, 20000)          # the documented boundary
        result = evaluate(self.instance, everything, 20000, 1000, 0.04,
                          trucks=True)
        self.assertTrue(result["feasible"])
        self.assertEqual(result["n_stations"], 100)
        self.assertAlmostEqual(result["bikes"], 0.0, places=6)
        self.assertAlmostEqual(result["served"], 0.0, places=6)
        self.assertAlmostEqual(result["capex_eur"], 20000, places=6)

    def test_a_budget_too_small_for_the_stations_placed(self):
        everything = list(range(len(self.instance.candidate_ids)))
        result = evaluate(self.instance, everything, 15000, 750, 0.04,
                          trucks=True)
        self.assertFalse(result["feasible"])
        self.assertEqual(result["served"], 0.0)
        self.assertEqual(result["served_ratio"], 0.0)
        self.assertIn("note", result)
        self.assertEqual(result["flows"], [])

    def test_transfer_stations_only(self):
        transfer = [index for index, kind
                    in enumerate(self.instance.candidate_types)
                    if kind == "TransferStation"]
        self.assertGreater(len(transfer), 0)
        result = evaluate(self.instance, transfer, 80000, 4000, 0.04,
                          trucks=True)
        self.assertTrue(result["feasible"])
        self.assertEqual(result["n_stations"], len(transfer))
        self.assertEqual(result["n_transfer"], len(transfer))
        self.assertGreaterEqual(result["served"], 0.0)
        self.assertLess(result["served"], self.instance.demand_total)

    def test_an_unknown_station_id_is_rejected_loudly(self):
        with self.assertRaises(ValueError):
            evaluate(self.instance, ["BS-not-a-station"], 80000, 4000, 0.04)

    def test_evaluating_the_same_layout_twice_gives_the_same_answer(self):
        layout = _built("budget_020k")
        first = evaluate(self.instance, layout, 20000, 1000, 0.04, trucks=True)
        second = evaluate(self.instance, layout, 20000, 1000, 0.04, trucks=True)
        self.assertEqual(summary(first), summary(second))


@unittest.skipUnless(_HAS_EXPORT, _EXPORT_REASON)
class ImportWithoutScipyTests(unittest.TestCase):
    """fixed_design.py must be importable, and its pure helpers usable, on a
    stdlib-only interpreter. Only solving may require scipy."""

    def test_constants_load_without_solving(self):
        constants = load_constants()
        self.assertEqual(constants["station_setup_cost"], 100)
        self.assertGreater(constants["CAPACITY_UB"], 0)

    def test_max_stations_is_pure_arithmetic(self):
        constants = load_constants()
        floor_cost = (constants["station_setup_cost"]
                      + constants["dock_cost"]
                      * constants["MIN_CAPACITY_IF_BUILT"])
        self.assertEqual(fixed_design.max_stations(20000, constants),
                         20000 // floor_cost)
        self.assertEqual(fixed_design.max_stations(0, constants), 0)

    def test_assistant_order_is_deterministic_and_ties_break_by_id(self):
        rows = [
            {"od": [0, 1], "t": 0, "flow": 10, "sets": [[3], [1, 2]]},
            {"od": [0, 2], "t": 0, "flow": 10, "sets": [[5]]},
            {"od": [0, 3], "t": 0, "flow": 1, "sets": [[3]]},
        ]
        # 3 and 5 both unlock 10; the smaller id wins, then 5, then 1 or 2.
        self.assertEqual(fixed_design.assistant_order(rows, 6, 2), [3, 5])
        self.assertEqual(fixed_design.assistant_order(rows, 6, 2),
                         fixed_design.assistant_order(rows, 6, 2))

    def test_reach_flow_needs_every_station_of_a_set(self):
        rows = [{"od": [0, 1], "t": 0, "flow": 7, "sets": [[1, 2]]}]
        self.assertEqual(fixed_design.reach_flow(rows, [1]), 0.0)
        self.assertEqual(fixed_design.reach_flow(rows, [1, 2]), 7.0)
        self.assertEqual(fixed_design.reach_flow(rows, [1, 2, 9]), 7.0)


if __name__ == "__main__":
    unittest.main()
