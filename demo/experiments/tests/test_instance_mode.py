"""
File: test_instance_mode.py
Description: Unit tests for the simulator's `instance` mode -- the mode that
             replays the model's own planning day instead of the observed
             11.5 trips/day.

Everything here runs in a hand-built 2-station micro-world so the expected
values can be read off the fixture rather than off a previous run:

    zone A (46.2000, 6.1400) -- station SA, 4 docks, 2 bikes
    zone B (46.2050, 6.1400) -- station SB, 4 docks, 0 bikes  (~556 m north)

    demand: A -> B, period 0, flow 2
            B -> A, period 2, flow 1

The fixture hourly profile puts all its weight on 08h and 17h, so a trip in
period 0 (06-10) can only land at 08h and one in period 2 (16-22) only at
17h: the drawn hour is pinned without pinning the RNG's internals.
"""

import unittest

from demo.experiments.pipeline.config import load_kpi_config
from demo.experiments.simulate import (PERIOD_START_HOURS, DaySimulation,
                                       instance_run, instance_trips)

import random

#: Two zones, ~556 m apart on the same meridian.
CELL_A = (46.2000, 6.1400)
CELL_B = (46.2050, 6.1400)

INSTANCE = {
    "cells": [{"id": "A", "lat": CELL_A[0], "lon": CELL_A[1]},
              {"id": "B", "lat": CELL_B[0], "lon": CELL_B[1]}],
    "candidate_stations": [
        {"id": "SA", "type": "BikeStation", "lat": CELL_A[0], "lon": CELL_A[1]},
        {"id": "SB", "type": "BikeStation", "lat": CELL_B[0], "lon": CELL_B[1]}],
    "od_demand": [
        {"origin": "A", "dest": "B", "period": 0, "flow": 2},
        {"origin": "B", "dest": "A", "period": 2, "flow": 1}],
}


def _hourly_share():
    """All observed trips at 08h and 17h -- one hour inside period 0, one
    inside period 2, none inside period 1."""
    share = [0.0] * 24
    share[8] = 0.5
    share[17] = 0.5
    return share


PROFILES = {"hourly_share": {"monday": _hourly_share(),
                             "sunday": _hourly_share()}}


def _stations(bikes_a=2, bikes_b=0, capacity=4):
    return [{"station": "SA", "type": "BikeStation",
             "lat": CELL_A[0], "lon": CELL_A[1],
             "capacity": capacity, "initial_bikes": bikes_a},
            {"station": "SB", "type": "BikeStation",
             "lat": CELL_B[0], "lon": CELL_B[1],
             "capacity": capacity, "initial_bikes": bikes_b}]


def _simulation(stations=None, **kwargs):
    """A DaySimulation over the micro-world, with the observed-trip readers
    stubbed out (this mode never touches grid.geojson or od.csv)."""
    kwargs.setdefault("cells", {"A": CELL_A, "B": CELL_B})
    kwargs.setdefault("od", ([("A", "B")], [1.0]))
    kwargs.setdefault("profiles", PROFILES)
    kwargs.setdefault("config", load_kpi_config())
    return DaySimulation(stations or _stations(), "monday", **kwargs)


class InstanceTripsTests(unittest.TestCase):
    """One trip per unit of demand, at the cell centres, in its period."""

    def test_one_trip_per_demand_unit_at_cell_centres(self):
        trips = instance_trips(INSTANCE, PROFILES, random.Random(1))
        flat = [t for hour in range(24) for t in trips[hour]]
        self.assertEqual(len(flat), 3)  # flows 2 + 1
        a_to_b = [t for t in flat if t[4] == ("A", "B", 0)]
        b_to_a = [t for t in flat if t[4] == ("B", "A", 2)]
        self.assertEqual(len(a_to_b), 2)
        self.assertEqual(len(b_to_a), 1)
        self.assertEqual(a_to_b[0][:4], (CELL_A[0], CELL_A[1],
                                         CELL_B[0], CELL_B[1]))
        self.assertEqual(b_to_a[0][:4], (CELL_B[0], CELL_B[1],
                                         CELL_A[0], CELL_A[1]))

    def test_hours_stay_inside_their_period(self):
        trips = instance_trips(INSTANCE, PROFILES, random.Random(7))
        self.assertEqual(len(trips[8]), 2, "period 0 demand belongs at 08h")
        self.assertEqual(len(trips[17]), 1, "period 2 demand belongs at 17h")
        self.assertEqual(sum(len(v) for h, v in trips.items()
                             if h not in (8, 17)), 0)

    def test_uniform_within_period_when_the_profile_is_flat_there(self):
        """Period 1 (10-16) has no observed trips in this profile: the draw
        falls back to uniform over its hours instead of dividing by zero."""
        instance = {**INSTANCE, "od_demand": [
            {"origin": "A", "dest": "B", "period": 1, "flow": 60}]}
        trips = instance_trips(instance, PROFILES, random.Random(3))
        hours = {h for h in range(24) if trips[h]}
        self.assertTrue(hours <= set(range(10, 16)), hours)
        self.assertGreater(len(hours), 1, "a uniform draw should spread")

    def test_same_seed_same_day(self):
        first = instance_trips(INSTANCE, PROFILES, random.Random(42))
        second = instance_trips(INSTANCE, PROFILES, random.Random(42))
        self.assertEqual(first, second)

    def test_demand_on_a_dropped_cell_is_kept_but_flagged(self):
        """The model counts demand on zones it dropped but can never serve
        it (findings.md #7); the simulator must do the same."""
        from demo.experiments.simulate import OUTSIDE_MODEL
        instance = {**INSTANCE, "od_demand": INSTANCE["od_demand"] + [
            {"origin": "A", "dest": "GONE", "period": 0, "flow": 5}]}
        trips = instance_trips(instance, PROFILES, random.Random(1))
        flat = [t for v in trips.values() for t in v]
        self.assertEqual(len(flat), 3 + 5)
        flagged = [t for t in flat if len(t[4]) > 3 and t[4][3] == OUTSIDE_MODEL]
        self.assertEqual(len(flagged), 5)
        self.assertTrue(all(t[0] is None for t in flagged))

        sim = _simulation()
        result = sim.run(trips)
        self.assertEqual(result["totals"]["demand"], 8)
        self.assertGreaterEqual(result["totals"]["unserved_no_station"], 5)
        self.assertEqual(result["model_view"]["unserved_outside_model"], 5)
        # the dropped pair still counts in the coverage denominator
        pairs = {(r["origin"], r["dest"]) for r in instance["od_demand"]}
        self.assertEqual(result["model_view"]["od_pairs_demanded"], len(pairs))


class ArcDistanceTests(unittest.TestCase):
    """With the model's arcs loaded, a served trip's km/minutes are the
    model's, and a pair with no arc is a ride the model would not allow."""

    def _one_trip(self, sim, origin=CELL_A, dest=CELL_B, meta=("A", "B", 0)):
        return sim.run({8: [(origin[0], origin[1], dest[0], dest[1], meta)]})

    def test_arc_km_and_minutes_are_used(self):
        sim = _simulation(arcs={("SA", "SB"): (0.8, 4.4)})
        result = self._one_trip(sim)
        self.assertEqual(result["totals"]["served"], 1)
        self.assertEqual(result["totals"]["ride_km"], 0.8)
        self.assertEqual(result["totals"]["ride_minutes"], 4.4)

    def test_missing_arc_is_unserved_no_arc(self):
        sim = _simulation(arcs={("SB", "SA"): (0.8, 4.4)})  # the other way
        result = self._one_trip(sim)
        self.assertEqual(result["totals"]["served"], 0)
        self.assertEqual(result["model_view"]["unserved_no_arc"], 1)
        self.assertEqual(result["totals"]["ride_km"], 0.0)
        # the bike was never taken: the ride was refused before the move
        self.assertEqual(result["stations"][0]["final_bikes"], 2)

    def test_allow_unrouted_falls_back_to_haversine(self):
        sim = _simulation(arcs={("SB", "SA"): (0.8, 4.4)}, allow_unrouted=True)
        result = self._one_trip(sim)
        self.assertEqual(result["totals"]["served"], 1)
        self.assertEqual(result["model_view"]["unserved_no_arc"], 0)
        self.assertAlmostEqual(result["totals"]["ride_km"], 0.72, places=2)

    def test_without_arcs_nothing_is_no_arc(self):
        sim = _simulation()
        result = self._one_trip(sim)
        self.assertEqual(result["totals"]["served"], 1)
        self.assertEqual(result["model_view"]["unserved_no_arc"], 0)


class PlanRebalancingTests(unittest.TestCase):
    """With a solved plan, the optimiser's own moves replace the greedy
    restore-to-initial round -- clamped by what is actually there."""

    PLAN = {"periods": 3, "rebalancing": [
        {"from": "SA", "to": "SB", "period": 0, "bikes": 5, "dispatches": 1},
        {"from": "SA", "to": "SB", "period": 1, "bikes": 1, "dispatches": 1},
        {"from": "SB", "to": "SA", "period": 2, "bikes": 1, "dispatches": 1}]}

    def test_moves_are_applied_at_the_period_start_hours(self):
        sim = _simulation(plan=self.PLAN)
        result = sim.run({})
        hours = [op["hour"] for op in result["rebalancing"]["operations"]]
        self.assertEqual(hours, list(PERIOD_START_HOURS))
        self.assertEqual(hours, [6, 10, 16])

    def test_no_greedy_round_and_no_end_of_day_round(self):
        sim = _simulation(plan=self.PLAN)
        result = sim.run({})
        hours = [op["hour"] for op in result["rebalancing"]["operations"]]
        self.assertNotIn(4, hours, "the greedy round is the no-plan fallback")
        self.assertNotIn(24, hours, "a solved plan has no end-of-day round")

    def test_moves_are_clamped_and_the_shortfall_reported(self):
        sim = _simulation(plan=self.PLAN)  # SA starts with 2 bikes
        result = sim.run({})
        first = result["rebalancing"]["operations"][0]
        self.assertEqual(first["bikes_planned"], 5)
        self.assertEqual(first["bikes_moved"], 2)   # only 2 bikes were there
        self.assertEqual(first["plan_moves_infeasible"], 3)
        # period 1 then finds SA empty; period 2 moves one bike back
        second, third = result["rebalancing"]["operations"][1:]
        self.assertEqual(second["bikes_moved"], 0)
        self.assertEqual(second["plan_moves_infeasible"], 1)
        self.assertEqual(third["bikes_moved"], 1)
        self.assertEqual(result["rebalancing"]["plan_moves_infeasible"], 4)
        self.assertEqual(result["rebalancing"]["source"], "model_plan")

    def test_moves_are_clamped_by_free_docks(self):
        plan = {"rebalancing": [
            {"from": "SA", "to": "SB", "period": 0, "bikes": 4,
             "dispatches": 1}]}
        sim = _simulation(_stations(bikes_a=4, bikes_b=3), plan=plan)
        result = sim.run({})
        first = result["rebalancing"]["operations"][0]
        self.assertEqual(first["bikes_moved"], 1)  # 4 docks, 3 already taken
        self.assertEqual(first["plan_moves_infeasible"], 3)

    def test_cost_follows_the_plan_not_the_clamp(self):
        sim = _simulation(plan=self.PLAN)
        result = sim.run({})
        config = load_kpi_config()["rebalancing"]
        first = result["rebalancing"]["operations"][0]
        expected_km = 5 * 0.5560  # 5 planned bikes over ~556 m
        self.assertAlmostEqual(first["bike_km"], expected_km, places=1)
        self.assertAlmostEqual(
            first["cost_eur"],
            config["dispatch_fixed_cost_eur"]
            + first["bike_km"] * config["unit_cost_eur_per_bike_km"],
            places=1)

    def test_plan_station_is_tried_before_the_nearest(self):
        """SB is 556 m from zone A -- outside the 300 m walk catchment -- so
        only the model's own assignment can put a rider there."""
        plan = {"assignments": [
            {"origin": "A", "dest": "B", "period": 0, "rank": 1, "flow": 2,
             "origin_station": "SB", "dest_station": "SA"}]}
        sim = _simulation(_stations(bikes_a=0, bikes_b=2), plan=plan)
        result = sim.run({8: [(CELL_A[0], CELL_A[1], CELL_B[0], CELL_B[1],
                               ("A", "B", 0))]})
        self.assertEqual(result["totals"]["served"], 1)
        self.assertEqual(result["model_view"]["followed_model_assignment"], 1)
        self.assertEqual(result["stations"][1]["departures"], 1)
        self.assertEqual(result["stations"][0]["arrivals"], 1)


class ModelViewTests(unittest.TestCase):
    """The model's own definitions, computed on a state we can read off."""

    def test_definitions_on_a_static_state(self):
        # No trips: SA holds 2 of 4 docks all 24 hours, SB holds 0 of 4.
        sim = _simulation(_stations(bikes_a=2, bikes_b=0))
        view = sim.run({})["model_view"]
        self.assertEqual(view["hours_observed"], 24)
        # mean over stations of mean over hours of bikes/capacity
        self.assertAlmostEqual(view["utilisation"], (0.5 + 0.0) / 2, places=4)
        # SA borrowable every hour, SB never
        self.assertAlmostEqual(view["borrowable_rate"], 0.5, places=4)
        # both returnable every hour
        self.assertAlmostEqual(view["returnable_rate"], 1.0, places=4)

    def test_full_station_is_never_returnable(self):
        sim = _simulation(_stations(bikes_a=4, bikes_b=4))
        view = sim.run({})["model_view"]
        self.assertAlmostEqual(view["utilisation"], 1.0, places=4)
        self.assertAlmostEqual(view["borrowable_rate"], 1.0, places=4)
        self.assertAlmostEqual(view["returnable_rate"], 0.0, places=4)

    def test_covered_od_ratio_counts_pairs_not_flow(self):
        """Zone C has no station in range, so its 5 trips -- more flow than
        the other two pairs together -- cost exactly one pair of coverage:
        2 of 3 pairs, 0.667, not the flow-weighted 3/8."""
        cell_c = (46.3000, 6.3000)  # far outside every walk catchment
        instance = {
            "cells": INSTANCE["cells"] + [{"id": "C", "lat": cell_c[0],
                                           "lon": cell_c[1]}],
            "candidate_stations": INSTANCE["candidate_stations"],
            "od_demand": INSTANCE["od_demand"] + [
                {"origin": "C", "dest": "A", "period": 0, "flow": 5}],
        }
        sim = _simulation(_stations(bikes_a=2, bikes_b=0))
        trips = instance_trips(instance, PROFILES, random.Random(5))
        view = sim.run(trips)["model_view"]
        self.assertEqual(view["demand_by_period"], [7, 0, 1])
        self.assertEqual(view["served_by_period"], [2, 0, 1])
        self.assertEqual(view["od_pairs_demanded"], 3)
        self.assertEqual(view["od_pairs_served"], 2)
        self.assertEqual(view["covered_od_ratio"], 0.667)

    def test_no_od_keys_without_trip_metadata(self):
        """Replay and sample pass plain 4-tuples: no OD block for them."""
        sim = _simulation()
        view = sim.run({8: [(CELL_A[0], CELL_A[1], CELL_B[0], CELL_B[1])]})["model_view"]
        self.assertNotIn("covered_od_ratio", view)
        self.assertIn("utilisation", view)


class InstanceRunTests(unittest.TestCase):
    """The seeded ensemble around the one random choice in the mode."""

    def _run(self, **kwargs):
        return instance_run(_stations(bikes_a=2, bikes_b=1), INSTANCE,
                            config=load_kpi_config(), profiles=PROFILES,
                            cells={"A": CELL_A, "B": CELL_B},
                            instance_path="micro.json", **kwargs)

    def test_totals_cover_the_whole_instance_demand(self):
        result = self._run(seeds=3)
        self.assertEqual(result["day"], "instance")
        self.assertEqual(result["totals"]["demand"], 3)
        self.assertEqual(result["method"]["demand_volume_trips"], 3)
        self.assertEqual(result["method"]["demand_od_pairs"], 2)
        self.assertEqual(result["seed_ensemble"]["n_seeds"], 3)

    def test_method_block_names_its_fallbacks(self):
        method = self._run()["method"]
        self.assertEqual(method["mode"], "instance")
        self.assertEqual(method["ride_distance_source"], "haversine_x_detour")
        self.assertEqual(method["rebalancing_source"], "greedy_restore")
        self.assertEqual(method["station_choice"], "nearest")
        self.assertEqual(method["period_to_hours"],
                         ["period 0: 06-10 local", "period 1: 10-16 local",
                          "period 2: 16-22 local"])

    def test_method_block_names_the_model_artefacts_when_present(self):
        method = self._run(arcs={("SA", "SB"): (0.8, 4.4)},
                           plan={"rebalancing": []})["method"]
        self.assertEqual(method["ride_distance_source"], "model_bike_arcs")
        self.assertEqual(method["rebalancing_source"], "model_plan")
        self.assertEqual(method["station_choice"],
                         "model_assignment_then_nearest")

    def test_same_seed_same_result(self):
        self.assertEqual(self._run(seeds=2)["totals"],
                         self._run(seeds=2)["totals"])


if __name__ == "__main__":
    unittest.main()
