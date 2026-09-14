"""
File: evaluate.py
Description: Turn a simulated day (simulate.py output) into the KPIs the
             decision experience shows, and compare scenarios side by side.

Every coefficient -- emission factors, mode substitution shares, fares, unit
costs -- lives in kpi_config.json, so the arithmetic here is transparent and
the assumptions are adjustable in one place.

KPI families:

    service      how well the network serves the demand
    mobility     what happens to people and modes (incl. the car)
    environment  CO2 avoided, with broad-audience equivalences
    economics    what it costs, what it earns, what a trip costs the city

Model-level metrics (covered_od_ratio, time gains, modal split of served
flow) are merged in when a metrics.json -- the dump of
`NetworkDesignRun.metrics` -- sits next to the simulation file.
"""

import argparse
import json
from pathlib import Path

from . import DATA_DIR
from .pipeline.config import load_kpi_config


#: Simulated "days" that are not calendar day types and therefore have no PT
#: ridership of their own. The model's planning day carries no weekday label
#: (findings.md #10); the demo places its demand on the observed weekday
#: hourly profile, so the weekday's boardings are its PT context too.
_PT_DAY_ALIAS = {"instance": "monday"}


def _pt_daily_boardings(day):
    """Average daily PT boardings in the area for that day, from the real
    ridership summary (ridership.py) -- None when not built yet."""
    path = DATA_DIR / "pt_ridership_summary.json"
    if not path.is_file():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)["daily_boardings_avg"].get(
            _PT_DAY_ALIAS.get(day, day))


def evaluate_day(sim, config=None, model_metrics=None):
    """Compute the KPI set for one simulated day.

    :param sim: the dict simulate.py wrote.
    :param config: kpi_config dict; loaded from the default file if None.
    :param model_metrics: optional `NetworkDesignRun.metrics` dump for the
                          same design.
    :return: nested dict of KPIs.
    """
    config = config or load_kpi_config()
    totals = sim["totals"]
    demand = totals["demand"]
    served = totals["served"]
    ride_km = totals["ride_km"]

    # -- service --------------------------------------------------------------
    unserved = demand - served
    reachable = demand - totals["unserved_no_station"]
    service = {
        "demand_trips": demand,
        "served_trips": served,
        "served_ratio": _ratio(served, demand),
        "spatial_coverage_ratio": _ratio(reachable, demand),
        "availability_ratio": _ratio(served, reachable),
        "unserved_no_station": totals["unserved_no_station"],
        "unserved_no_bike": totals["unserved_no_bike"],
        "unserved_no_dock": totals["unserved_no_dock"],
        "stations": sim["n_stations"],
        "docks": sim["total_capacity"],
        "bikes": sim["total_bikes_initial"],
        "trips_per_bike": _ratio(served, sim["total_bikes_initial"]),
        "peak_empty_stations": max(h["empty_stations"] for h in sim["hourly"]),
        "peak_full_stations": max(h["full_stations"] for h in sim["hourly"]),
    }

    # -- mobility -------------------------------------------------------------
    subst = config["mode_substitution"]
    fallback = config["unserved_fallback"]
    car_km_avoided = ride_km * subst["car"]
    car_trips_from_unserved = unserved * fallback["car"]
    mobility = {
        "ride_km": ride_km,
        "ride_minutes": totals["ride_minutes"],
        "trips_shifted_from_car": round(served * subst["car"], 1),
        "trips_shifted_from_pt": round(served * subst["public_transport"], 1),
        "trips_shifted_from_walk": round(served * subst["walk"], 1),
        "new_trips_induced": round(served * subst["induced_new_trip"], 1),
        "car_km_avoided": round(car_km_avoided, 1),
        "unserved_trips_falling_back_to_car": round(car_trips_from_unserved, 1),
    }
    pt_boardings = _pt_daily_boardings(sim["day"])
    if pt_boardings:
        mobility["bike_trips_per_1000_pt_boardings"] = round(
            served / (pt_boardings / 1000.0), 2)
        mobility["pt_daily_boardings_observed"] = pt_boardings
    if model_metrics:
        flow_bike = model_metrics.get("flow_bike_only", 0)
        flow_pt = model_metrics.get("flow_bike_pt", 0)
        if flow_bike + flow_pt > 0:
            mobility["share_bike_only"] = _ratio(flow_bike, flow_bike + flow_pt)
            mobility["share_bike_plus_pt"] = _ratio(flow_pt, flow_bike + flow_pt)

    # -- environment ----------------------------------------------------------
    ef = config["emission_factors_g_per_pkm"]
    eq = config["equivalences"]
    gross_avoided_g = ride_km * (subst["car"] * ef["car"]
                                 + subst["public_transport"] * ef["public_transport_blend"])
    bike_emissions_g = ride_km * ef["bike_fleet"]
    net_avoided_kg = max(0.0, (gross_avoided_g - bike_emissions_g) / 1000.0)
    environment = {
        "co2_avoided_kg_per_day": round(net_avoided_kg, 2),
        "co2_avoided_kg_per_year_extrapolated": round(net_avoided_kg * 365, 0),
        "equivalent_car_days": round(net_avoided_kg / eq["kg_co2_per_car_day"], 1),
        "equivalent_trees_for_a_year": round(
            net_avoided_kg * 365 / eq["kg_co2_per_tree_year"], 0),
    }

    # -- economics ------------------------------------------------------------
    costs = config["costs"]
    capex = (sim["n_stations"] * costs["station_setup_cost_eur"]
             + sim["total_capacity"] * costs["dock_cost_eur"]
             + sim["total_bikes_initial"] * costs["unit_bike_cost_eur"])
    capex_per_day = capex / (costs["amortization_years"] * 365)
    opex_day = (sim["rebalancing"]["cost_eur"]
                + sim["total_bikes_initial"] * costs["maintenance_eur_per_bike_per_day"])
    revenue_day = served * costs["fare_eur_per_trip"]
    cost_day = capex_per_day + opex_day
    economics = {
        "capex_eur": capex,
        "capex_eur_per_day_amortized": round(capex_per_day, 2),
        "opex_eur_per_day": round(opex_day, 2),
        "rebalancing_cost_eur_per_day": sim["rebalancing"]["cost_eur"],
        "revenue_eur_per_day": round(revenue_day, 2),
        "operating_result_eur_per_day": round(revenue_day - cost_day, 2),
        "cost_per_served_trip_eur": _ratio(cost_day, served),
        "revenue_cost_ratio": _ratio(revenue_day, cost_day),
    }

    kpis = {
        "day": sim["day"],
        "service": service,
        "mobility": mobility,
        "environment": environment,
        "economics": economics,
    }
    if "method" in sim:  # carry the simulation's provenance into the KPIs
        kpis["method"] = sim["method"]
    if model_metrics:
        kpis["model"] = {
            key: model_metrics[key] for key in (
                "n_selected_stations", "covered_od_ratio", "total_time_gain",
                "average_time_gain", "obj_val", "dispatch_count")
            if key in model_metrics}
        if model_metrics.get("placeholder"):
            kpis["model"]["placeholder"] = True
    if "model_view" in sim:
        # The same day restated the model's way (utilisation, borrowable /
        # returnable rates, count-based coverage) -- carried through as the
        # simulator computed it, so a reader can put the two definitions
        # side by side rather than guess which one a number came from.
        kpis["model_view"] = sim["model_view"]
        comparison = _model_comparison(sim, model_metrics)
        if comparison:
            kpis["comparison"] = comparison
    return kpis


def _model_comparison(sim, model_metrics):
    """Line up the metrics both views define, model against simulation.

    Only pairs where both sides exist are reported: the model's planned day
    vs. the simulated one, on the model's own definitions. Empty (and
    therefore omitted) when the design has no metrics.json.
    """
    if not model_metrics:
        return {}
    view = sim.get("model_view", {})
    comparison = {}
    if "covered_od_ratio" in model_metrics and "covered_od_ratio" in view:
        comparison["covered_od_ratio"] = {
            "model": model_metrics["covered_od_ratio"],
            "simulated": view["covered_od_ratio"],
        }
    flow_bike = model_metrics.get("flow_bike_only")
    flow_pt = model_metrics.get("flow_bike_pt")
    if flow_bike is not None or flow_pt is not None:
        comparison["served_flow"] = {
            "model": round((flow_bike or 0) + (flow_pt or 0), 3),
            "simulated": sim["totals"]["served"],
        }
    if "dispatch_count" in model_metrics:
        comparison["dispatch_count"] = {
            "model": model_metrics["dispatch_count"],
            "simulated": sim["rebalancing"]["truck_dispatches"],
        }
    return comparison


def _ratio(a, b):
    return round(a / b, 3) if b else 0.0


def evaluate_scenario(scenario_dir, config=None):
    """Evaluate every sim_*.json in a scenario's result directory.

    Reads metrics.json (the `NetworkDesignRun.metrics` dump) if present and
    writes kpis.json holding one entry per simulated day.

    :param scenario_dir: e.g. demo/experiments/results/S2_balanced/.
    :return: the dict written.
    """
    scenario_dir = Path(scenario_dir)
    config = config or load_kpi_config()

    model_metrics = None
    metrics_file = scenario_dir / "metrics.json"
    if metrics_file.is_file():
        with open(metrics_file, encoding="utf-8") as f:
            model_metrics = json.load(f)

    days = {}
    for sim_file in sorted(scenario_dir.glob("sim_*.json")):
        with open(sim_file, encoding="utf-8") as f:
            sim = json.load(f)
        # Key by the file's variant name (monday, sunday, monday_x25, ...) so
        # a growth-hypothesis run never overwrites the observed-scale day.
        days[sim_file.stem[len("sim_"):]] = evaluate_day(sim, config, model_metrics)

    if not days:
        raise FileNotFoundError(f"No sim_*.json in {scenario_dir}; "
                                f"run demo.experiments.simulate first.")

    out = {"scenario": scenario_dir.name, "days": days}
    if model_metrics and model_metrics.get("placeholder"):
        out["placeholder_model_results"] = True
        out["placeholder_note"] = ("metrics.json is a mock, not an optimiser "
                                   "output (earlier greedy placeholders, removed 2026-09-09)")
    out_file = scenario_dir / "kpis.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"KPIs -> {out_file}")
    return out


#: (label, day-KPI path) rows of the comparison table, in display order.
COMPARISON_ROWS = (
    ("Stations built", "service.stations"),
    ("Docks", "service.docks"),
    ("Bikes", "service.bikes"),
    ("Demand served", "service.served_ratio"),
    ("Spatial coverage", "service.spatial_coverage_ratio"),
    ("Availability (served if reachable)", "service.availability_ratio"),
    ("Trips shifted from car / day", "mobility.trips_shifted_from_car"),
    ("Car-km avoided / day", "mobility.car_km_avoided"),
    ("CO2 avoided kg / day", "environment.co2_avoided_kg_per_day"),
    ("Investment (CAPEX, EUR)", "economics.capex_eur"),
    ("Operating cost EUR / day", "economics.opex_eur_per_day"),
    ("Revenue EUR / day", "economics.revenue_eur_per_day"),
    ("Cost per served trip EUR", "economics.cost_per_served_trip_eur"),
    # -- the model's own definitions (instance mode only; "-" elsewhere) ----
    ("Covered OD pairs (model definition)", "model_view.covered_od_ratio"),
    ("Utilisation (model definition)", "model_view.utilisation"),
    ("Borrowable rate (model definition)", "model_view.borrowable_rate"),
)

#: Printed for a KPI a day does not carry (a replay day has no `model_view`).
_MISSING_CELL = "-"


def compare(scenario_dirs, day="monday", output_file=None):
    """Build a markdown comparison table across scenarios for one day type.

    :param scenario_dirs: iterable of result directories, each holding a
                          kpis.json (built by :func:`evaluate_scenario`).
    :param day: which simulated day to compare.
    :return: the markdown string (also written to output_file if given).
    """
    columns = []
    for directory in scenario_dirs:
        with open(Path(directory) / "kpis.json", encoding="utf-8") as f:
            kpis = json.load(f)
        if day not in kpis["days"]:
            raise KeyError(f"{directory} has no simulated {day}")
        columns.append((kpis["scenario"], kpis["days"][day]))

    def dig(tree, dotted):
        """Follow a dotted path, or return None when the day has no such KPI
        (rows added for one mode must not break the table for the others)."""
        for part in dotted.split("."):
            if not isinstance(tree, dict) or part not in tree:
                return None
            tree = tree[part]
        return tree

    lines = [f"| KPI ({day}) | " + " | ".join(name for name, _ in columns) + " |",
             "|---" * (len(columns) + 1) + "|"]
    for label, path in COMPARISON_ROWS:
        values = [dig(day_kpis, path) for _, day_kpis in columns]
        if all(value is None for value in values):
            continue  # a row no compared day carries at all
        cells = [_MISSING_CELL if value is None else f"{value:,}"
                 for value in values]
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    table = "\n".join(lines)

    if output_file:
        Path(output_file).write_text(table + "\n", encoding="utf-8")
        print(f"comparison -> {output_file}")
    return table


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python -m demo.experiments.evaluate",
        description="Compute KPIs from simulated days, or compare scenarios.")
    parser.add_argument("scenario_dirs", nargs="+",
                        help="result directories (each with sim_*.json)")
    parser.add_argument("--compare-day", default=None,
                        help="also print a comparison table for this day "
                             "(monday, sunday, or a variant like monday_x25)")
    parser.add_argument("--out", default=None, help="write the comparison table here")
    args = parser.parse_args(argv)

    for directory in args.scenario_dirs:
        evaluate_scenario(directory)
    if args.compare_day:
        print()
        print(compare(args.scenario_dirs, day=args.compare_day,
                      output_file=args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
