"""
File: evaluate.py
Description: Turn one solved scenario into the KPIs the demonstration shows --
             the paper's own definitions, read off the model's own plan --
             and compare plans side by side.

The primary evaluation is the optimisation model's solution, exactly as in
the submitted paper: served demand per period, direct cycling vs PT-assisted
trips, travel-time savings, the layout that was built, the rebalancing it
needs. Nothing here re-simulates, re-routes or re-prices anything the frozen
model already decided; every number is read from `model_plan.json` (the solved
variables) or `metrics.json` (the model's own evaluator row), and unit costs
come live from `network-design-bss/src/util/cost.py`.

Three blocks, written to `kpis.json` ("schema": "kpis-v3"):

    paper       what the paper reports and the demonstration headlines
    technical   the full evaluator row plus the solver's own statistics,
                for the advanced view
    stress_test the observed-trip replay (simulate.py, `--mode replay`):
                a demo-side robustness check on Geneva's recorded trips,
                ~125x smaller than the planning day, and labelled as such

DEPRECATED (demo v3, 2026-09-15): `evaluate_day_legacy` (the simulator-based
service / mobility / environment / economics families, formerly
`evaluate_day`) is replaced by :func:`paper_kpis` and :func:`stress_test_kpis`;
removed once the paper-grid runs are validated. It is the only function here
that reads coefficients from `kpi_config.json`; `paper` and `technical` use
none.
"""

import argparse
import json
import warnings
from pathlib import Path

from . import DATA_DIR
from .pipeline.config import load_kpi_config

#: Schema tag written into every kpis.json this module produces.
KPIS_SCHEMA = "kpis-v3"

#: Deprecation notice shared by the simulator-based KPI families.
_DEPRECATION = ("DEPRECATED (demo v3, 2026-09-15): replaced by "
                "evaluate.paper_kpis / evaluate.stress_test_kpis; removed "
                "once the paper-grid runs are validated.")

#: Keys of metrics.json that are this repository's provenance, not the frozen
#: model's evaluator row (`run` is unpacked separately, see technical_kpis).
_PROVENANCE_KEYS = ("placeholder", "provenance", "scenario", "run")

#: Fields of the `run` block that belong in the technical view: the solver
#: statistics the paper's Table 3 discusses, which the evaluator row does not
#: carry (they are read off the Gurobi model at run time).
_RUN_FIELDS = ("n_variables", "n_constraints", "gurobi_status", "mip_gap",
               "wall_clock_s")


def _ratio(a, b):
    """a / b rounded to 3 decimals, 0.0 when b is zero or missing."""
    return round(a / b, 3) if b else 0.0


def _round(value, digits):
    """Round, passing None through (a KPI a legacy artefact cannot supply)."""
    return None if value is None else round(value, digits)


def _unit_costs():
    """The frozen model's unit costs (station, dock, bike), in euros.

    Read live from `network-design-bss/src/util/cost.py::CostParameters` by
    `pipeline/config.py` -- these three keys are never stored in
    kpi_config.json, so the CAPEX below can never drift from what the
    optimiser spent.
    """
    costs = load_kpi_config()["costs"]
    return (costs["station_setup_cost_eur"], costs["dock_cost_eur"],
            costs["unit_bike_cost_eur"])


def _per_period(rows, periods, value_key="flow", where=None):
    """Sum one field of `rows` into a per-period list.

    :param rows: `model_plan` demand or assignment rows (each with `period`).
    :param periods: number of demand periods T.
    :param where: optional predicate on a row.
    :return: list of T numbers, ints where the sums are whole.
    """
    totals = [0.0] * periods
    for row in rows:
        if where is not None and not where(row):
            continue
        period = int(row["period"])
        if 0 <= period < periods:
            totals[period] += float(row.get(value_key, 0.0) or 0.0)
    return [int(t) if float(t).is_integer() else round(t, 3) for t in totals]


def _flow_weighted_travel_time(assignments):
    """Flow-weighted mean path time of the served assignments, in minutes.

    The fallback for a `metrics.json` written before the full evaluator row
    was saved: the same definition the model's own `avg_travel_time` uses
    (sum of x * path time over sum of x), computed from the plan's own
    assignment rows.
    """
    flow = sum(float(row.get("flow", 0.0) or 0.0) for row in assignments)
    if not flow:
        return None
    total = sum(float(row.get("flow", 0.0) or 0.0)
                * float(row.get("total_time_min", 0.0) or 0.0)
                for row in assignments)
    return total / flow


def _budget(metrics):
    """(total budget, operational budget) in euros, from the evaluator row
    when it carries them and from the run's parameters otherwise."""
    parameters = (metrics.get("run") or {}).get("model_parameters", {})
    budget = metrics.get("total_budget", parameters.get("total_budget"))
    op_budget = metrics.get("reb_budget")
    if op_budget is None:
        ratio = metrics.get("operational_budget_ratio",
                            parameters.get("op_budget_ratio"))
        op_budget = None if (budget is None or ratio is None) else budget * ratio
    return budget, op_budget


def paper_kpis(model_plan, metrics):
    """The KPIs the paper reports, for one solved scenario.

    Every value is the model's own: the per-period arrays come from the
    solved plan's demand and path assignments, the totals from its summary,
    the compactness and travel-time metrics from the frozen model's
    evaluator row. Nothing is simulated and no assumption-based coefficient
    is involved.

    :param model_plan: the parsed `model_plan.json`.
    :param metrics: the parsed `metrics.json`.
    :return: the `paper` block of kpis.json.
    """
    summary = model_plan["summary"]
    assignments = model_plan.get("assignments", ())
    demand_rows = model_plan.get("demand", ())
    periods = int(model_plan.get("periods")
                  or max((int(r["period"]) for r in demand_rows), default=-1) + 1)

    flow_bike_only = summary["flow_bike_only"]
    flow_bike_pt = summary["flow_bike_pt"]
    served_total = flow_bike_only + flow_bike_pt
    demand_total = summary["demand_total"]

    avg_time_gain = metrics.get("average_time_gain")
    avg_travel_time = metrics.get("avg_travel_time")
    if avg_travel_time is None:
        avg_travel_time = _flow_weighted_travel_time(assignments)
    saving_ratio = None
    if avg_time_gain is not None and avg_travel_time is not None:
        denominator = avg_time_gain + avg_travel_time
        saving_ratio = _ratio(avg_time_gain, denominator)

    stations = summary["n_built"]
    docks = summary["docks"]
    bikes = summary["bikes_initial"]
    station_cost, dock_cost, bike_cost = _unit_costs()
    budget, op_budget = _budget(metrics)
    od_total = summary["od_pairs_total"]
    od_covered = summary["od_pairs_covered"]

    return {
        "demand_total": demand_total,
        "served_total": served_total,
        "served_ratio": _ratio(served_total, demand_total),
        "demand_by_period": _per_period(demand_rows, periods),
        "served_by_period": _per_period(assignments, periods),
        "bike_only_by_period": _per_period(
            assignments, periods, where=lambda r: r.get("category") == "bike_only"),
        "bike_pt_by_period": _per_period(
            assignments, periods, where=lambda r: r.get("category") == "bike_pt"),
        "flow_bike_only": flow_bike_only,
        "flow_bike_pt": flow_bike_pt,
        "pt_assisted_share": _ratio(flow_bike_pt, served_total),
        "avg_time_gain_min": _round(avg_time_gain, 2),
        "avg_travel_time_min": _round(avg_travel_time, 2),
        "time_saving_ratio": saving_ratio,
        "stations": stations,
        "n_reg": metrics.get("n_reg_station"),
        "n_trans": metrics.get("n_trans_station"),
        "docks": docks,
        "bikes": bikes,
        "capex_used_eur": (stations * station_cost + docks * dock_cost
                           + bikes * bike_cost),
        "budget_eur": budget,
        "op_budget_eur": _round(op_budget, 1),
        "dispatches": summary["dispatches"],
        "bikes_rebalanced": summary["bikes_rebalanced"],
        "dispatch_cost_eur": summary["dispatch_cost_eur"],
        "investment_per_served_trip_eur": (
            None if budget is None else _round(budget / served_total, 1)
            if served_total else None),
        "covered_od_ratio": _ratio(od_covered, od_total),
        "od_pairs_total": od_total,
        "od_pairs_covered": od_covered,
        "nearest_neighbor_m": _round(metrics.get("nearest_neighbor_distance"), 1),
        "mean_pairwise_m": _round(metrics.get("mean_pairwise_distance"), 1),
    }


def technical_kpis(metrics):
    """The evaluator row and the solver statistics, as written.

    No recomputation: every field `metrics.json` carries from the frozen
    model's `ExperimentRow` is passed through (a legacy file carrying only
    the 15 headline metrics therefore yields only those), plus the solver
    facts the run recorded off the Gurobi model.

    :param metrics: the parsed `metrics.json`.
    :return: the `technical` block of kpis.json.
    """
    technical = {key: value for key, value in metrics.items()
                 if key not in _PROVENANCE_KEYS}
    run = metrics.get("run") or {}
    for key in _RUN_FIELDS:
        if key in run:
            technical[key] = run[key]
    ran_at = run.get("ran_at")
    if ran_at:
        technical["ran_at"] = str(ran_at)[:10]      # the date, not the second
    return technical


def stress_test_kpis(sim):
    """The observed-trip replay, as a robustness check on a design.

    A demo-side stress test, not part of the paper: Geneva's recorded trips
    (~11.5 a day) replayed against the design, counted by cause of failure.
    Service only -- no mobility, environment or economics family survives
    into v3.

    :param sim: the dict `simulate.replay` wrote (`sim_<day>.json`).
    :return: one day's `stress_test` entry.
    """
    totals = sim["totals"]
    hourly = sim.get("hourly", ())
    method = sim.get("method", {})
    return {
        "demand": totals["demand"],
        "served": totals["served"],
        "served_ratio": _ratio(totals["served"], totals["demand"]),
        "unserved_no_station": totals["unserved_no_station"],
        "unserved_no_bike": totals["unserved_no_bike"],
        "unserved_no_dock": totals["unserved_no_dock"],
        "peak_empty_stations": max((h["empty_stations"] for h in hourly),
                                   default=0),
        "peak_full_stations": max((h["full_stations"] for h in hourly),
                                  default=0),
        "n_days_replayed": method.get("n_days_replayed"),
        "representative_date": method.get("representative_date") or sim.get("date"),
        "method": method,
    }


def _load_required(path, what):
    """Read a JSON artefact the evaluation cannot do without."""
    if not Path(path).is_file():
        raise FileNotFoundError(
            f"{path} is missing: kpis-v3 is computed from the model's own "
            f"{what}. Run `python -m demo.experiments.run_model "
            f"{Path(path).parent.name}` (Gurobi) to produce it.")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


#: Replay days looked for next to a design, in report order.
STRESS_TEST_DAYS = ("monday", "sunday")


def evaluate_scenario(scenario_dir, write=True):
    """Evaluate one scenario and write its `kpis.json` (schema kpis-v3).

    Reads `model_plan.json` and `metrics.json` (both required), plus
    `sim_monday.json` / `sim_sunday.json` when the replay stress test has
    been run for this design.

    :param scenario_dir: e.g. demo/experiments/results/S2_balanced/.
    :param write: write kpis.json (False returns the dict only -- what the
                  golden tests use, since they never write into results/).
    :return: the KPI dict.
    """
    scenario_dir = Path(scenario_dir)
    model_plan = _load_required(scenario_dir / "model_plan.json",
                                "solved plan")
    metrics = _load_required(scenario_dir / "metrics.json",
                             "evaluator row")

    kpis = {
        "scenario": scenario_dir.name,
        "schema": KPIS_SCHEMA,
        "paper": paper_kpis(model_plan, metrics),
        "technical": technical_kpis(metrics),
    }

    stress_test = {}
    for day in STRESS_TEST_DAYS:
        sim_path = scenario_dir / f"sim_{day}.json"
        if not sim_path.is_file():
            continue
        with open(sim_path, encoding="utf-8") as f:
            sim = json.load(f)
        if sim.get("method", {}).get("mode") != "replay":
            continue          # only the observed-trip replay is a stress test
        stress_test[day] = stress_test_kpis(sim)
    if stress_test:
        kpis["stress_test"] = stress_test

    if write:
        out_file = scenario_dir / "kpis.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(kpis, f, indent=2)
        print(f"KPIs -> {out_file}")
    return kpis


#: Rows of the comparison table: (label, how to read one scenario's cell).
#: Each reader takes the parsed kpis.json, the scenario's model parameters
#: (from metrics.json) and its scenario definition, and returns a string or
#: None for "this scenario cannot say".
COMPARISON_ROWS = (
    ("Investment budget", lambda k, p, s: _money(k["paper"]["budget_eur"])),
    ("Operational ratio", lambda k, p, s: _percent(
        p.get("op_budget_ratio"), digits=1)),
    ("Dispatch penalty", lambda k, p, s: _number(
        k["technical"].get("epsilon", p.get("epsilon")), 3)),
    ("Temporal profile", lambda k, p, s: (s or {}).get("temporal_profile")),
    ("Trips served", lambda k, p, s: _percent(k["paper"]["served_ratio"])),
    ("PT-assisted share", lambda k, p, s: _percent(k["paper"]["pt_assisted_share"])),
    ("Time saved per trip", lambda k, p, s: _number(
        k["paper"]["avg_time_gain_min"], 1, " min")),
    ("Stations (regular + transfer)", lambda k, p, s: _stations(k["paper"])),
    ("Docks", lambda k, p, s: _number(k["paper"]["docks"], 0)),
    ("Bikes", lambda k, p, s: _number(k["paper"]["bikes"], 0)),
    ("Truck dispatches / day", lambda k, p, s: _number(k["paper"]["dispatches"], 0)),
    ("Dispatch cost / day", lambda k, p, s: _money(k["paper"]["dispatch_cost_eur"], 2)),
    ("Investment per served trip", lambda k, p, s: _money(
        k["paper"]["investment_per_served_trip_eur"], 1)),
    ("Covered OD pairs", lambda k, p, s: _percent(k["paper"]["covered_od_ratio"])),
    ("Nearest-neighbour distance", lambda k, p, s: _number(
        k["paper"]["nearest_neighbor_m"], 1, " m")),
)

#: Printed for a KPI a scenario's artefacts cannot supply.
_MISSING_CELL = "-"


def _money(value, digits=0):
    return None if value is None else f"{value:,.{digits}f} EUR"


def _percent(value, digits=1):
    return None if value is None else f"{value * 100:.{digits}f} %"


def _number(value, digits=0, unit=""):
    return None if value is None else f"{value:,.{digits}f}{unit}"


def _stations(paper):
    reg, trans = paper.get("n_reg"), paper.get("n_trans")
    if reg is None or trans is None:
        return _number(paper.get("stations"), 0)
    return f"{paper['stations']} ({reg} + {trans})"


def compare(scenario_dirs, output_file=None):
    """Build the markdown comparison table of the paper KPIs.

    One column per scenario, one row per headline the paper discusses.
    Reads each directory's `kpis.json` (written by :func:`evaluate_scenario`)
    and, for the run parameters a KPI block does not carry, its
    `metrics.json` and its `scenarios/<id>.json`.

    :param scenario_dirs: iterable of result directories.
    :param output_file: also write the table here.
    :return: the markdown string.
    """
    from .run_model import SCENARIOS_DIR

    columns = []
    for directory in scenario_dirs:
        directory = Path(directory)
        with open(directory / "kpis.json", encoding="utf-8") as f:
            kpis = json.load(f)
        if kpis.get("schema") != KPIS_SCHEMA:
            raise ValueError(
                f"{directory}/kpis.json is {kpis.get('schema')!r}, not "
                f"{KPIS_SCHEMA!r}: re-run evaluate_scenario on it")
        parameters = {}
        metrics_path = directory / "metrics.json"
        if metrics_path.is_file():
            with open(metrics_path, encoding="utf-8") as f:
                parameters = (json.load(f).get("run") or {}).get(
                    "model_parameters", {})
        definition = None
        scenario_path = SCENARIOS_DIR / f"{kpis['scenario']}.json"
        if scenario_path.is_file():
            with open(scenario_path, encoding="utf-8") as f:
                definition = json.load(f)
        columns.append((kpis["scenario"], kpis, parameters, definition))

    lines = ["| Paper KPI | " + " | ".join(name for name, _, _, _ in columns) + " |",
             "|---" * (len(columns) + 1) + "|"]
    for label, read in COMPARISON_ROWS:
        cells = []
        for _, kpis, parameters, definition in columns:
            try:
                cell = read(kpis, parameters, definition)
            except (KeyError, TypeError):
                cell = None
            cells.append(_MISSING_CELL if cell is None else cell)
        if all(cell == _MISSING_CELL for cell in cells):
            continue
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    table = "\n".join(lines)

    if output_file:
        Path(output_file).write_text(table + "\n", encoding="utf-8")
        print(f"comparison -> {output_file}")
    return table


# -------------------------------------------------------------------------
# Deprecated: the v2, simulator-based KPI families.
# -------------------------------------------------------------------------

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


def evaluate_day_legacy(sim, config=None, model_metrics=None):
    """Compute the v2 KPI set for one simulated day.

    DEPRECATED (demo v3, 2026-09-15): replaced by evaluate.paper_kpis
    (the model's own served demand, the paper's definitions) and
    evaluate.stress_test_kpis (the observed-trip replay); removed once the
    paper-grid runs are validated. Nothing calls it: it is kept so the v2
    numbers can still be reproduced from the committed artefacts while the
    grid is being run.

    :param sim: the dict simulate.py wrote.
    :param config: kpi_config dict; loaded from the default file if None.
    :param model_metrics: optional `NetworkDesignRun.metrics` dump for the
                          same design.
    :return: nested dict of KPIs.
    """
    warnings.warn(_DEPRECATION, DeprecationWarning, stacklevel=2)
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


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python -m demo.experiments.evaluate",
        description="Compute the paper KPIs of solved scenarios, or compare them.")
    parser.add_argument("scenario_dirs", nargs="+",
                        help="result directories (each with model_plan.json "
                             "and metrics.json)")
    parser.add_argument("--compare", action="store_true",
                        help="also print the comparison table across them")
    parser.add_argument("--out", default=None,
                        help="write the comparison table here")
    args = parser.parse_args(argv)

    for directory in args.scenario_dirs:
        evaluate_scenario(directory)
    if args.compare or args.out:
        print()
        print(compare(args.scenario_dirs, output_file=args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
