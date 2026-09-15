"""
File: test_evaluate.py
Description: Unit tests for the v3 KPI blocks -- `evaluate.paper_kpis`,
             `evaluate.technical_kpis` and `evaluate.stress_test_kpis`.

Everything runs on a hand-built micro-fixture (two OD pairs, two periods,
three stations) so every expected value can be read off the fixture with a
pencil rather than off a previous run. The functions are pure dict -> dict:
no file, no simulation, no solver.

The fixture's arithmetic, once:

    demand   period 0: 10 trips, period 1: 6 trips        -> 16 potential
    served   period 0: 4 bike_only + 3 bike_pt = 7
             period 1: 2 bike_only + 1 bike_pt = 3        -> 10 served
    travel   flow-weighted (4*6 + 3*12 + 2*9 + 1*15) / 10 = 9.3 min
"""

import unittest

from demo.experiments.evaluate import (KPIS_SCHEMA, paper_kpis,
                                       stress_test_kpis, technical_kpis)

#: The solved plan of the micro-fixture, in `model_plan.json` shape.
MODEL_PLAN = {
    "periods": 2,
    "summary": {
        "n_built": 3,
        "docks": 20,
        "bikes_initial": 12,
        "flow_bike_only": 6,
        "flow_bike_pt": 4,
        "flow_walk_pt": 0,
        "demand_total": 16,
        "demand_assigned_bike_related": 10,
        "od_pairs_total": 4,
        "od_pairs_covered": 3,
        "covered_od_ratio": 0.75,
        "dispatches": 1,
        "bikes_rebalanced": 5,
        "dispatch_cost_eur": 50.0,
    },
    "demand": [
        {"origin": "A", "dest": "B", "period": 0, "flow": 10},
        {"origin": "B", "dest": "A", "period": 1, "flow": 6},
    ],
    "assignments": [
        {"origin": "A", "dest": "B", "period": 0, "category": "bike_only",
         "flow": 4, "total_time_min": 6.0, "time_gain_min": 3.0},
        {"origin": "A", "dest": "B", "period": 0, "category": "bike_pt",
         "flow": 3, "total_time_min": 12.0, "time_gain_min": 5.0},
        {"origin": "B", "dest": "A", "period": 1, "category": "bike_only",
         "flow": 2, "total_time_min": 9.0, "time_gain_min": 4.0},
        {"origin": "B", "dest": "A", "period": 1, "category": "bike_pt",
         "flow": 1, "total_time_min": 15.0, "time_gain_min": 6.0},
    ],
    "stations": [],
    "rebalancing": [],
}

#: A metrics.json carrying the full evaluator row.
METRICS = {
    "placeholder": False,
    "provenance": "test fixture",
    "scenario": "micro",
    "run": {
        "ran_at": "2026-09-15T08:30:00+00:00",
        "model_parameters": {"total_budget": 1000, "op_budget_ratio": 0.05},
        "gurobi_status": 2,
        "mip_gap": 0.0,
        "n_variables": 120,
        "n_constraints": 80,
        "wall_clock_s": 1.5,
    },
    "total_budget": 1000,
    "operational_budget_ratio": 0.05,
    "reb_budget": 50,
    "n_reg_station": 2,
    "n_trans_station": 1,
    "average_time_gain": 4.0,
    "avg_travel_time": 8.0,
    "nearest_neighbor_distance": 123.456,
    "mean_pairwise_distance": 789.012,
    "epsilon": 0.04,
    "status": 2,
    "obj_val": 42.0,
}

#: The same metrics.json as written before the full row was saved: the
#: headline metrics only, and no compactness or travel-time field.
LEGACY_METRICS = {
    "placeholder": False,
    "provenance": "test fixture",
    "scenario": "micro",
    "run": METRICS["run"],
    "n_reg_station": 2,
    "n_trans_station": 1,
    "average_time_gain": 4.0,
}


class PaperKpiTests(unittest.TestCase):
    """paper_kpis() reads the model's own plan, and only that."""

    @classmethod
    def setUpClass(cls):
        cls.paper = paper_kpis(MODEL_PLAN, METRICS)

    def test_demand_and_served_totals(self):
        self.assertEqual(self.paper["demand_total"], 16)
        self.assertEqual(self.paper["served_total"], 10)
        self.assertEqual(self.paper["served_ratio"], 0.625)

    def test_per_period_arrays_split_by_category(self):
        self.assertEqual(self.paper["demand_by_period"], [10, 6])
        self.assertEqual(self.paper["served_by_period"], [7, 3])
        self.assertEqual(self.paper["bike_only_by_period"], [4, 2])
        self.assertEqual(self.paper["bike_pt_by_period"], [3, 1])

    def test_periods_sum_to_the_totals(self):
        self.assertEqual(sum(self.paper["served_by_period"]),
                         self.paper["served_total"])
        self.assertEqual(sum(self.paper["bike_only_by_period"]),
                         self.paper["flow_bike_only"])
        self.assertEqual(sum(self.paper["bike_pt_by_period"]),
                         self.paper["flow_bike_pt"])

    def test_pt_assisted_share(self):
        self.assertEqual(self.paper["pt_assisted_share"], 0.4)

    def test_time_saving_ratio_is_gain_over_gain_plus_travel(self):
        self.assertEqual(self.paper["avg_time_gain_min"], 4.0)
        self.assertEqual(self.paper["avg_travel_time_min"], 8.0)
        self.assertEqual(self.paper["time_saving_ratio"], 0.333)

    def test_layout_and_capex(self):
        self.assertEqual(self.paper["stations"], 3)
        self.assertEqual((self.paper["n_reg"], self.paper["n_trans"]), (2, 1))
        # 3 stations x 100 + 20 docks x 20 + 12 bikes x 60 (the model's own
        # unit costs, read live from src/util/cost.py).
        self.assertEqual(self.paper["capex_used_eur"], 1420)

    def test_budgets_and_investment_per_trip(self):
        self.assertEqual(self.paper["budget_eur"], 1000)
        self.assertEqual(self.paper["op_budget_eur"], 50)
        self.assertEqual(self.paper["investment_per_served_trip_eur"], 100.0)

    def test_coverage_and_compactness(self):
        self.assertEqual(self.paper["covered_od_ratio"], 0.75)
        self.assertEqual(self.paper["od_pairs_total"], 4)
        self.assertEqual(self.paper["od_pairs_covered"], 3)
        self.assertEqual(self.paper["nearest_neighbor_m"], 123.5)
        self.assertEqual(self.paper["mean_pairwise_m"], 789.0)

    def test_rebalancing_comes_from_the_plan_summary(self):
        self.assertEqual(self.paper["dispatches"], 1)
        self.assertEqual(self.paper["bikes_rebalanced"], 5)
        self.assertEqual(self.paper["dispatch_cost_eur"], 50.0)


class LegacyMetricsTests(unittest.TestCase):
    """A metrics.json without the full row still yields a paper block."""

    @classmethod
    def setUpClass(cls):
        cls.paper = paper_kpis(MODEL_PLAN, LEGACY_METRICS)

    def test_compactness_is_null_rather_than_invented(self):
        self.assertIsNone(self.paper["nearest_neighbor_m"])
        self.assertIsNone(self.paper["mean_pairwise_m"])

    def test_travel_time_falls_back_to_the_plans_own_assignments(self):
        # (4*6 + 3*12 + 2*9 + 1*15) / 10 = 9.3 minutes
        self.assertEqual(self.paper["avg_travel_time_min"], 9.3)
        self.assertEqual(self.paper["time_saving_ratio"], 0.301)

    def test_budget_falls_back_to_the_run_parameters(self):
        self.assertEqual(self.paper["budget_eur"], 1000)
        self.assertEqual(self.paper["op_budget_eur"], 50.0)


class TechnicalKpiTests(unittest.TestCase):
    """technical_kpis() passes the row through and adds the solver facts."""

    @classmethod
    def setUpClass(cls):
        cls.technical = technical_kpis(METRICS)

    def test_provenance_keys_are_dropped(self):
        for key in ("placeholder", "provenance", "scenario", "run"):
            self.assertNotIn(key, self.technical)

    def test_every_row_field_is_passed_through_unchanged(self):
        for key in ("total_budget", "operational_budget_ratio", "reb_budget",
                    "n_reg_station", "n_trans_station", "average_time_gain",
                    "avg_travel_time", "nearest_neighbor_distance",
                    "mean_pairwise_distance", "epsilon", "status", "obj_val"):
            self.assertEqual(self.technical[key], METRICS[key], key)

    def test_solver_facts_come_from_the_run_block(self):
        self.assertEqual(self.technical["n_variables"], 120)
        self.assertEqual(self.technical["n_constraints"], 80)
        self.assertEqual(self.technical["gurobi_status"], 2)
        self.assertEqual(self.technical["mip_gap"], 0.0)
        self.assertEqual(self.technical["wall_clock_s"], 1.5)

    def test_ran_at_is_the_date(self):
        self.assertEqual(self.technical["ran_at"], "2026-09-15")

    def test_a_legacy_row_yields_only_what_it_has(self):
        technical = technical_kpis(LEGACY_METRICS)
        self.assertNotIn("nearest_neighbor_distance", technical)
        self.assertEqual(technical["average_time_gain"], 4.0)
        self.assertEqual(technical["ran_at"], "2026-09-15")


class StressTestKpiTests(unittest.TestCase):
    """stress_test_kpis() reports service only -- no mobility, no economics."""

    SIM = {
        "day": "monday",
        "date": "2024-08-23",
        "totals": {"demand": 8.0, "served": 6.0, "unserved_no_station": 1.0,
                   "unserved_no_bike": 0.5, "unserved_no_dock": 0.5,
                   "ride_km": 7.0, "ride_minutes": 21.0},
        "hourly": [{"hour": 7, "empty_stations": 1, "full_stations": 2},
                   {"hour": 8, "empty_stations": 3, "full_stations": 0}],
        "method": {"mode": "replay", "n_days_replayed": 112,
                   "representative_date": "2024-08-23"},
    }

    def test_service_counts_and_peaks(self):
        block = stress_test_kpis(self.SIM)
        self.assertEqual(block["served_ratio"], 0.75)
        self.assertEqual(block["peak_empty_stations"], 3)
        self.assertEqual(block["peak_full_stations"], 2)
        self.assertEqual(block["n_days_replayed"], 112)
        self.assertEqual(block["representative_date"], "2024-08-23")
        self.assertEqual(block["method"], self.SIM["method"])

    def test_no_mobility_environment_or_economics_family(self):
        block = stress_test_kpis(self.SIM)
        for key in ("mobility", "environment", "economics", "co2_avoided_kg_per_day",
                    "revenue_eur_per_day", "cost_per_served_trip_eur"):
            self.assertNotIn(key, block)


class SchemaTests(unittest.TestCase):
    """The KPI file's schema tag is the one the front end reads."""

    def test_schema_tag(self):
        self.assertEqual(KPIS_SCHEMA, "kpis-v3")


if __name__ == "__main__":
    unittest.main()
