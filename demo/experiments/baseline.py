"""
File: baseline.py
Description: The design a person would sketch from the data alone -- the
             pedagogical counterpart to the optimiser.

Given the same budget a scenario hands the optimisation model, this builds
the intuitive network: rank the sites the model could have built on by
observed trip activity, put a station at the busiest ones, size them all the
same, and stop when the budget runs out. No routing, no multimodal paths, no
capacity balancing over time -- exactly what a reasonable human with a
spreadsheet would do.

**The candidate set is the model's own** (Phase B, findings.md #7 and #8):
the 100 sites in the solved instance -- the 56 buildable H3 cell centres plus
the 44 PT stops the model kept, already merged within 100 m. Until 2026-09-09
this ranked the raw 59 grid cells instead, which let the human design place
stations the optimiser was never allowed to place and denied it the transfer
stops the optimiser could use. Same candidate set, same money: the comparison
is now about the *choice*, not about the menu.

Because a PT stop and a cell centre can sit almost on top of each other and
still be two candidates, a candidate within 100 m of one already chosen is
skipped -- the same merge radius the model applies -- so the greedy does not
spend twice to cover one spot.

Activity is measured per zone (od.csv in-flow + out-flow, the only demand
signal a human planner has); each candidate inherits the activity of the zone
whose centre is nearest to it. Ties are broken by candidate id, so the design
is reproducible.

The output uses the same stations.json schema as `NetworkDesignRun.stations`,
so the same simulator replays it, and the demo can show the two side by side:
"your plan" vs "the optimised plan", same money, different day.

The cost arithmetic mirrors network-design-bss/src/util/cost.py so the comparison
is at equal spend: station 100 + dock 20 each + bike 60 each.
"""

import argparse
import csv
import json
from collections import Counter
from pathlib import Path

from . import GEOJSON_DIR
from .pipeline.config import load_kpi_config
from .pipeline.geometry import haversine_km
from .pipeline.instance import (candidates_of, cells_of, find_instance,
                                load_instance)

#: Two candidate sites closer than this are the same place: the model merges
#: cell centres and PT stops within it, so the baseline must not buy both.
MERGE_RADIUS_KM = 0.1


def _resolve_instance(instance):
    """Accept a parsed instance, a path, or None (locate the reference one)."""
    if isinstance(instance, dict):
        return instance
    path = Path(instance) if instance else find_instance(None)
    if path is None:
        raise FileNotFoundError(
            "baseline needs the model's instance.json for its candidate "
            "sites; none found under results/ -- pass --instance PATH")
    return load_instance(path)


def build_baseline(total_budget, capacity=12, fill_ratio=0.5,
                   od_file=None, instance=None, output_file=None):
    """Build the naive design for a given budget.

    :param total_budget: EUR, same figure the scenario gives the model.
    :param capacity: docks per station -- uniform, as a person would plan it.
    :param fill_ratio: share of docks stocked with a bike at day start.
    :param od_file: od.csv to measure zone activity from.
    :param instance: the model's instance.json (path or parsed dict) whose
                     candidate sites the design picks from; located under
                     results/ when None.
    :param output_file: where to write stations.json; not written if None.
    :return: list of station dicts (stations.json schema).
    """
    config = load_kpi_config()["costs"]
    bikes_each = int(round(capacity * fill_ratio))
    cost_each = (config["station_setup_cost_eur"]
                 + capacity * config["dock_cost_eur"]
                 + bikes_each * config["unit_bike_cost_eur"])

    od_file = od_file or GEOJSON_DIR / "od.csv"
    activity = Counter()
    with open(od_file, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            flow = float(row["flow"])
            activity[row["origin_cell"]] += flow
            activity[row["dest_cell"]] += flow

    instance = _resolve_instance(instance)
    cells = cells_of(instance)
    candidates = candidates_of(instance)

    def zone_activity(candidate):
        """The activity of the zone this candidate site sits in -- the
        nearest cell centre (a BikeStation candidate *is* a cell centre, so
        its own zone always wins)."""
        best_cell = min(cells,
                        key=lambda cid: haversine_km(candidate["lat"],
                                                     candidate["lon"],
                                                     *cells[cid]))
        return activity.get(best_cell, 0.0)

    ranked = sorted(candidates,
                    key=lambda c: (-zone_activity(c), c["id"]))

    stations = []
    spent = 0
    for candidate in ranked:
        if spent + cost_each > total_budget:
            continue
        if any(haversine_km(candidate["lat"], candidate["lon"],
                            s["lat"], s["lon"]) < MERGE_RADIUS_KM
               for s in stations):
            continue  # the model merged this site with one already chosen
        stations.append({
            "station": f"baseline_{candidate['id']}",
            "type": "baseline",
            "lon": candidate["lon"], "lat": candidate["lat"],
            "capacity": capacity,
            "initial_bikes": bikes_each,
        })
        spent += cost_each

    print(f"baseline design: {len(stations)} stations x {capacity} docks, "
          f"{spent} EUR of {total_budget} EUR")

    if output_file:
        output_file = Path(output_file)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(stations, f, indent=2)
        print(f"written -> {output_file}")
    return stations


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python -m demo.experiments.baseline",
        description="Build the naive human design for a budget.")
    parser.add_argument("--budget", type=int, required=True, help="EUR")
    parser.add_argument("--capacity", type=int, default=12, help="docks per station")
    parser.add_argument("--instance", default=None,
                        help="instance.json whose candidate sites to pick "
                             "from (default: the reference scenario's)")
    parser.add_argument("--out", required=True, help="stations.json to write")
    args = parser.parse_args(argv)
    build_baseline(args.budget, capacity=args.capacity,
                   instance=args.instance, output_file=args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
