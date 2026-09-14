"""
File: test_model_plan.py
Description: Unit tests for demo.experiments.pipeline.model_plan -- the
             extraction of a solved run of the frozen optimisation model into
             plain dictionaries.

Runs without Gurobi, gurobipy, networkx or the frozen model. The solved model
is a hand-built fake: plain objects with the attribute names the real ones
carry (`node_id`, `coordinate`, `.X`, `arcs_traversed`, ...), whose expected
extraction is small enough to write out by hand below.

`slim_instance` is checked against the real thing instead: the committed
`results/S2_balanced/instance.json` must come back out of the instance `.txt`
the optimiser actually wrote. That test skips if the `.txt` is absent.
"""

import json
import unittest
from types import SimpleNamespace

from demo.experiments.pipeline.model_plan import (
    extract_bike_arcs, extract_model_plan, slim_instance)

from ._helpers import REPO_ROOT, RESULTS, load_json


# -- the fake solved model ---------------------------------------------------

def var(value):
    """A stand-in for a solved Gurobi variable: all the extraction reads is X."""
    return SimpleNamespace(X=float(value))


class station:
    """A stand-in for a `network.node.BikeStation` / `TransferStation`.

    Hashes and compares on `node_id`, exactly as `network.node.Node` does: the
    model's variable dictionaries and its bike network are keyed by these
    objects, so they have to be usable as dict keys.
    """

    def __init__(self, node_id, lon, lat, type_="BikeStation"):
        self.node_id = node_id
        self.coordinate = (lon, lat)
        self.type = type_

    def __hash__(self):
        return hash(self.node_id)

    def __eq__(self, other):
        return getattr(other, "node_id", None) == self.node_id

    def __repr__(self):
        return f"station({self.node_id!r})"


def arc(mode, start_node, end_node):
    """A stand-in for a `network.arc.Arc` -- only mode and endpoints are read."""
    return SimpleNamespace(mode=mode, start_node=start_node, end_node=end_node)


class FakeBikeNetwork:
    """The subset of a networkx DiGraph that model_plan uses.

    networkx is not a dependency of the demo layer and is not installed in the
    test environment, so the bike network is faked rather than built.
    """

    def __init__(self, edge_data):
        self._edges = dict(edge_data)

    @property
    def edges(self):
        return list(self._edges)

    def get_edge_data(self, i, j):
        return self._edges[(i, j)]


def build_fake_model():
    """A two-period, three-candidate solved model with known-by-hand answers.

    A and B are built (capacity 10 and 6), C is not. The operator moves 2 bikes
    A->B in period 0 with one vehicle, and sends two empty vehicles A->C in
    period 1; riders take 7 bikes A->B in period 0 and 3 back in period 1.
    Period 2 (= T, the end-of-horizon index the variables also carry) holds
    deliberately large values that must never reach the export.
    """
    a = station("S-A", 6.10, 46.20)
    b = station("S-B", 6.11, 46.21)
    c = station("S-C", 6.12, 46.22, type_="TransferStation")

    bike_network = FakeBikeNetwork({
        (a, b): {"distance": 0.5, "travel_time": 4.0},
        (b, a): {"distance": 0.5, "travel_time": 4.0},
        (a, c): {"distance": 0.8, "travel_time": 5.5},
        (c, a): {"distance": 0.8, "travel_time": 5.5},
    })

    inventory = {a: [5, 4, 6], b: [3, 4, 2], c: [0, 0, 0]}

    # Rider origin/destination points a path walks from and to; not stations.
    origin_point = SimpleNamespace(node_id="Z-o1", coordinate=(6.09, 46.19))
    pt_stop = SimpleNamespace(node_id="PT-7", coordinate=(6.13, 46.23))

    path_bike_only = SimpleNamespace(
        id=1, arcs_traversed=[arc("Walk", origin_point, a), arc("Bike", a, b)],
        total_time=6.0, total_distance=1.2, shortest_path_time_gain=3.0)
    path_bike_pt = SimpleNamespace(
        id=2,
        arcs_traversed=[arc("Walk", origin_point, a), arc("Bike", a, c),
                        arc("PT-12", c, pt_stop)],
        total_time=11.5, total_distance=2.4, shortest_path_time_gain=1.5)
    path_walk_pt = SimpleNamespace(
        id=3,
        arcs_traversed=[arc("Walk", origin_point, pt_stop),
                        arc("PT-12", pt_stop, c)],
        total_time=18.0, total_distance=3.0, shortest_path_time_gain=0.0)

    solver = SimpleNamespace(
        id_path_map={1: path_bike_only, 2: path_bike_pt, 3: path_walk_pt},
        path_ranking={1: 0, 2: 1, 3: 0},
        categorized_paths={
            "bike_only": {("o1", "d1"): [1]},
            "bike_pt": {("o1", "d2"): [2]},
            "walk_pt": {("o2", "d3"): [3]},
        },
    )

    model = SimpleNamespace(
        B=[a, b, c],
        A_bike_network=bike_network,
        demand_generator=SimpleNamespace(time_periods=2, num_sampled_od_pairs=4),
        y={a: var(1), b: var(1.0), c: var(0)},
        w={a: var(10), b: var(6), c: var(0)},
        v={(node, t): var(level)
           for node, levels in inventory.items()
           for t, level in enumerate(levels)},
        # 2 bikes A->B with one vehicle in period 0; two empty vehicles A->C in
        # period 1. The t=2 entries are the end-of-horizon index: never exported.
        r={(a, b, 0): var(2), (a, b, 1): var(0), (a, b, 2): var(99),
           (b, a, 0): var(0), (b, a, 1): var(0), (b, a, 2): var(0),
           (a, c, 0): var(0), (a, c, 1): var(0), (a, c, 2): var(0),
           (c, a, 0): var(0), (c, a, 1): var(0), (c, a, 2): var(0)},
        n={(a, b, 0): var(1), (a, b, 1): var(0), (a, b, 2): var(7),
           (b, a, 0): var(0), (b, a, 1): var(0), (b, a, 2): var(0),
           (a, c, 0): var(0), (a, c, 1): var(2), (a, c, 2): var(0),
           (c, a, 0): var(0), (c, a, 1): var(0), (c, a, 2): var(0)},
        f={(a, b, 0): var(7), (a, b, 1): var(0), (a, b, 2): var(50),
           (b, a, 0): var(0), (b, a, 1): var(3), (b, a, 2): var(0),
           (a, c, 0): var(0), (a, c, 1): var(0), (a, c, 2): var(0),
           (c, a, 0): var(0), (c, a, 1): var(0), (c, a, 2): var(0)},
        # (od, period, path id) -> flow. The zero entry must be dropped.
        x_b={(("o1", "d1"), 0, 1): var(5), (("o1", "d1"), 1, 1): var(0.0)},
        x_pt={(("o1", "d2"), 1, 2): var(4)},
        x_w={(("o2", "d3"), 0, 3): var(9)},
        demand_matrix={(("o1", "d1"), 0): 6, (("o1", "d2"), 1): 5,
                       (("o2", "d3"), 0): 10},
        shortest_path_solver=solver,
    )
    return model, solver, bike_network


class ExtractModelPlanTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.model, cls.solver, cls.bike_network = build_fake_model()
        cls.plan = extract_model_plan(cls.model, cls.solver, 2,
                                      dispatch_fixed_cost=40,
                                      rebalancing_unit_cost=20)

    # -- stations ------------------------------------------------------------

    def test_stations_keep_every_candidate_built_first(self):
        self.assertEqual([s["id"] for s in self.plan["stations"]],
                         ["S-A", "S-B", "S-C"])
        self.assertEqual([s["built"] for s in self.plan["stations"]],
                         [True, True, False])

    def test_station_carries_type_and_coordinates(self):
        by_id = {s["id"]: s for s in self.plan["stations"]}
        self.assertEqual(by_id["S-A"]["type"], "BikeStation")
        self.assertEqual(by_id["S-C"]["type"], "TransferStation")
        self.assertEqual((by_id["S-B"]["lon"], by_id["S-B"]["lat"]), (6.11, 46.21))

    def test_inventory_has_one_entry_per_period_boundary(self):
        by_id = {s["id"]: s for s in self.plan["stations"]}
        # T + 1 entries: the start of each of the 2 periods, plus the end state.
        self.assertEqual(by_id["S-A"]["inventory"], [5, 4, 6])
        self.assertEqual(by_id["S-B"]["inventory"], [3, 4, 2])
        self.assertEqual(by_id["S-C"]["inventory"], [0, 0, 0])

    def test_capacity_is_an_integer(self):
        by_id = {s["id"]: s for s in self.plan["stations"]}
        self.assertEqual(by_id["S-A"]["capacity"], 10)
        self.assertIsInstance(by_id["S-A"]["capacity"], int)

    # -- rebalancing and rider flows -----------------------------------------

    def test_rebalancing_keeps_rows_with_bikes_or_dispatches(self):
        self.assertEqual(self.plan["rebalancing"], [
            {"from": "S-A", "to": "S-B", "period": 0, "bikes": 2, "dispatches": 1},
            {"from": "S-A", "to": "S-C", "period": 1, "bikes": 0, "dispatches": 2},
        ])

    def test_rebalancing_excludes_the_end_of_horizon_index(self):
        # r[A,B,2] = 99 and n[A,B,2] = 7 exist as variables but describe no
        # period of the day: only t in 0..T-1 feeds the inventory balance.
        self.assertEqual([row["period"] for row in self.plan["rebalancing"]], [0, 1])

    def test_user_flows_are_the_rides_not_the_truck_moves(self):
        self.assertEqual(self.plan["user_flows"], [
            {"from": "S-A", "to": "S-B", "period": 0, "bikes": 7},
            {"from": "S-B", "to": "S-A", "period": 1, "bikes": 3},
        ])

    # -- assignments ---------------------------------------------------------

    def test_assignment_rows_drop_zero_flows_and_sort_by_period(self):
        rows = self.plan["assignments"]
        self.assertEqual(
            [(r["origin"], r["dest"], r["period"], r["category"]) for r in rows],
            [("o1", "d1", 0, "bike_only"),
             ("o2", "d3", 0, "walk_pt"),
             ("o1", "d2", 1, "bike_pt")])

    def test_bike_only_assignment_carries_the_path_and_its_stations(self):
        row = self.plan["assignments"][0]
        self.assertEqual(row["path_id"], 1)
        self.assertEqual(row["flow"], 5)
        self.assertEqual(row["rank"], 0)
        self.assertEqual(row["total_time_min"], 6.0)
        self.assertEqual(row["total_distance_km"], 1.2)
        self.assertEqual(row["time_gain_min"], 3.0)
        self.assertEqual(row["origin_station"], "S-A")
        self.assertEqual(row["dest_station"], "S-B")
        self.assertEqual(row["stations"], ["S-A", "S-B"])

    def test_bike_pt_assignment_ignores_the_walk_and_pt_legs(self):
        row = self.plan["assignments"][2]
        self.assertEqual(row["category"], "bike_pt")
        self.assertEqual(row["origin_station"], "S-A")
        self.assertEqual(row["dest_station"], "S-C")
        self.assertEqual(row["stations"], ["S-A", "S-C"])

    def test_walk_pt_assignment_touches_no_station(self):
        row = self.plan["assignments"][1]
        self.assertEqual(row["category"], "walk_pt")
        self.assertIsNone(row["origin_station"])
        self.assertIsNone(row["dest_station"])
        self.assertEqual(row["stations"], [])

    # -- demand --------------------------------------------------------------

    def test_demand_is_the_matrix_flattened_and_sorted(self):
        self.assertEqual(self.plan["demand"], [
            {"origin": "o1", "dest": "d1", "period": 0, "flow": 6},
            {"origin": "o2", "dest": "d3", "period": 0, "flow": 10},
            {"origin": "o1", "dest": "d2", "period": 1, "flow": 5},
        ])

    # -- summary -------------------------------------------------------------

    def test_summary_counts_only_built_stations(self):
        summary = self.plan["summary"]
        self.assertEqual(summary["n_built"], 2)
        self.assertEqual(summary["docks"], 16)          # 10 + 6
        self.assertEqual(summary["bikes_initial"], 8)   # 5 + 3

    def test_summary_flows_by_mode(self):
        summary = self.plan["summary"]
        self.assertEqual(summary["flow_bike_only"], 5)
        self.assertEqual(summary["flow_bike_pt"], 4)
        self.assertEqual(summary["flow_walk_pt"], 9)
        self.assertEqual(summary["demand_assigned_bike_related"], 9)
        self.assertEqual(summary["demand_total"], 21)

    def test_covered_od_ratio_counts_pairs_not_flow(self):
        summary = self.plan["summary"]
        # o1->d1 (bike only) and o1->d2 (bike + PT) are covered; o2->d3 rides
        # no bike. The denominator is the model's sampled OD pair count, 4.
        self.assertEqual(summary["od_pairs_covered"], 2)
        self.assertEqual(summary["od_pairs_total"], 4)
        self.assertEqual(summary["covered_od_ratio"], 0.5)

    def test_dispatch_cost_is_fixed_plus_distance_per_vehicle(self):
        summary = self.plan["summary"]
        self.assertEqual(summary["dispatches"], 3)          # 1 + 2
        self.assertEqual(summary["bikes_rebalanced"], 2)
        # 1 x (40 + 20 x 0.5 km) + 2 x (40 + 20 x 0.8 km) = 50 + 112
        self.assertEqual(summary["dispatch_cost_eur"], 162.0)

    # -- the whole document --------------------------------------------------

    def test_plan_is_json_serialisable(self):
        json.dumps(self.plan)

    def test_periods_is_recorded(self):
        self.assertEqual(self.plan["periods"], 2)


class ExtractBikeArcsTests(unittest.TestCase):

    def test_every_arc_in_both_directions_sorted(self):
        _, _, bike_network = build_fake_model()
        self.assertEqual(extract_bike_arcs(bike_network), [
            {"from": "S-A", "to": "S-B", "distance_km": 0.5, "travel_time_min": 4.0},
            {"from": "S-A", "to": "S-C", "distance_km": 0.8, "travel_time_min": 5.5},
            {"from": "S-B", "to": "S-A", "distance_km": 0.5, "travel_time_min": 4.0},
            {"from": "S-C", "to": "S-A", "distance_km": 0.8, "travel_time_min": 5.5},
        ])


#: The instance file the S2 run was solved on, as written by
#: `InstanceGenerator.save_to_file`. Absent from a fresh checkout that has never
#: run the model.
S2_CONFIG = ("Geneva_H3True_SEED20_DISmultinomial_"
             "P0.17-0.34-0.49_BUD80000_OP0.0250_SCALE1.00")
S2_INSTANCE_TXT = (REPO_ROOT / "network-design-bss" / "src" / "h3_instances_json"
                   / f"{S2_CONFIG}.txt")


class SlimInstanceTests(unittest.TestCase):

    @unittest.skipUnless(S2_INSTANCE_TXT.is_file(),
                         f"{S2_INSTANCE_TXT} not present in this checkout")
    def test_reproduces_the_committed_s2_instance(self):
        with open(S2_INSTANCE_TXT, encoding="utf-8") as f:
            raw = json.load(f)

        got = slim_instance(
            raw, "S2_balanced",
            source=f"network-design-bss/src/h3_instances_json/{S2_CONFIG}.txt")

        self.assertEqual(got, load_json(RESULTS / "S2_balanced" / "instance.json"))

    def test_od_demand_keys_are_parsed_and_sorted(self):
        raw = {
            "config_name": "cfg",
            "seed": 7,
            "time_period": 2,
            "time_period_weights": [0.4, 0.6],
            "total_budget": 1000,
            "operational_budget_ratio": 0.05,
            "od_demand": {"(('b', 'a'), 0)": 3, "(('a', 'b'), 1)": 4,
                          "(('a', 'b'), 0)": 5},
            "station_layout": [{"node_id": "BS-1", "coordinate": [6.1, 46.2],
                                "type": "BikeStation"}],
            "grid_network": {"nodes": [{"zone_id": "a",
                                        "coordinates": [6.0, 46.0],
                                        "type": "userOD",
                                        "polygon": {"dropped": True}}]},
            "pt_structure": {"dropped": True},
        }
        got = slim_instance(raw, "S9_test", source="somewhere.txt")

        self.assertEqual(got["od_demand"], [
            {"origin": "a", "dest": "b", "period": 0, "flow": 5},
            {"origin": "b", "dest": "a", "period": 0, "flow": 3},
            {"origin": "a", "dest": "b", "period": 1, "flow": 4},
        ])
        self.assertEqual(got["cells"], [{"id": "a", "lon": 6.0, "lat": 46.0}])
        self.assertEqual(got["candidate_stations"],
                         [{"id": "BS-1", "type": "BikeStation",
                           "lon": 6.1, "lat": 46.2}])
        self.assertEqual(got["scenario"], "S9_test")
        self.assertEqual(got["time_periods"], 2)
        self.assertNotIn("pt_structure", got)


if __name__ == "__main__":
    unittest.main()
