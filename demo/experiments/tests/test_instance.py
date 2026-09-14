"""
File: test_instance.py
Description: Unit tests for pipeline/instance.py -- the readers of the
             artefacts describing the problem the optimiser solved.

Two halves: the committed S2 instance is pinned (it is the reference the
demo's instance mode replays, and its shape -- 56 zones, 100 candidates,
973 demand rows, 1,453 trips -- is quoted throughout the documentation), and
the optional artefacts (model_plan.json, bike_arcs.json) are checked to
degrade to None rather than raise when they have not been exported yet.
"""

import json
import tempfile
import unittest
from pathlib import Path

from demo.experiments.pipeline.instance import (REFERENCE_INSTANCE_SCENARIO,
                                                candidates_of, cells_of,
                                                demand_of, demand_pairs,
                                                find_instance, load_bike_arcs,
                                                load_instance, load_model_plan)

from ._helpers import RESULTS

#: The committed instance every optimiser scenario shares.
INSTANCE_PATH = RESULTS / REFERENCE_INSTANCE_SCENARIO / "instance.json"


@unittest.skipUnless(INSTANCE_PATH.is_file(),
                     f"{INSTANCE_PATH} not committed")
class CommittedInstanceTests(unittest.TestCase):
    """The shape of the solved instance, as documented and as replayed."""

    @classmethod
    def setUpClass(cls):
        cls.instance = load_instance(INSTANCE_PATH)

    def test_cells_are_the_56_buildable_zones(self):
        cells = cells_of(self.instance)
        self.assertEqual(len(cells), 56)
        for cell_id, (lat, lon) in cells.items():
            self.assertIsInstance(cell_id, str)
            self.assertTrue(45 < lat < 47, f"{cell_id}: latitude {lat}")
            self.assertTrue(5 < lon < 7, f"{cell_id}: longitude {lon}")

    def test_candidates_are_the_100_model_sites(self):
        candidates = candidates_of(self.instance)
        self.assertEqual(len(candidates), 100)
        self.assertEqual({c["type"] for c in candidates},
                         {"BikeStation", "TransferStation"})
        self.assertEqual(len({c["id"] for c in candidates}), 100)

    def test_bike_station_candidates_sit_on_cell_centres(self):
        cells = cells_of(self.instance)
        on_centre = [c for c in candidates_of(self.instance)
                     if c["type"] == "BikeStation"]
        self.assertEqual(len(on_centre), len(cells))
        for candidate in on_centre:
            cell_id = candidate["id"].split("-", 1)[1]
            self.assertIn(cell_id, cells)
            self.assertEqual((candidate["lat"], candidate["lon"]),
                             cells[cell_id])

    def test_demand_is_973_rows_of_1453_trips(self):
        demand = demand_of(self.instance)
        self.assertEqual(len(demand), 973)
        self.assertEqual(sum(flow for _, _, _, flow in demand), 1453)
        self.assertEqual({period for _, _, period, _ in demand}, {0, 1, 2})
        self.assertTrue(all(flow > 0 for _, _, _, flow in demand))

    def test_demand_pairs_is_the_coverage_denominator(self):
        self.assertEqual(len(demand_pairs(self.instance)), 703)

    def test_find_instance_prefers_the_design_s_own(self):
        stations = INSTANCE_PATH.parent / "stations.json"
        self.assertEqual(find_instance(stations), INSTANCE_PATH)

    def test_find_instance_falls_back_to_the_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            found = find_instance(Path(tmp) / "stations.json")
        self.assertEqual(found, INSTANCE_PATH)


class OptionalArtefactTests(unittest.TestCase):
    """model_plan.json and bike_arcs.json are absent until a Gurobi run
    exports them; the loaders must say "None", not raise."""

    def test_missing_model_plan_is_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(load_model_plan(tmp))
        self.assertIsNone(load_model_plan(None))

    def test_missing_bike_arcs_is_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(load_bike_arcs(Path(tmp) / "bike_arcs.json"))

    def test_model_plan_is_read_when_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "model_plan.json"
            path.write_text(json.dumps({"periods": 3, "stations": []}),
                            encoding="utf-8")
            self.assertEqual(load_model_plan(tmp)["periods"], 3)

    def test_bike_arcs_are_keyed_by_station_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bike_arcs.json"
            path.write_text(json.dumps({"arcs": [
                {"from": "A", "to": "B", "distance_km": 0.8,
                 "travel_time_min": 4.4}]}), encoding="utf-8")
            arcs = load_bike_arcs(path)
        self.assertEqual(arcs, {("A", "B"): (0.8, 4.4)})


if __name__ == "__main__":
    unittest.main()
