"""
File: trips.py
Description: The canonical table of observed bike trips -- the real demand
             every simulation mode is built on -- and the measured volume
             calibration derived from it.

`bike_trips.geojson` records 1,658 real shared-bike trips (Jun-Dec 2024) with
start/end coordinates and naive ISO timestamps in `trip_started_at_utc`. The
field name is trusted: timestamps are read as UTC and converted to
Europe/Zurich, which puts the weekday peaks at 08h and 17-18h local (the
commute signature) instead of the implausible 06h a naive reading gives. The
same conclusion follows independently from the PT ridership data
(ridership.py), whose peaks sit at the same local hours.

Two things come out of this module:

    load_trips()          every trip as a flat dict: local date/hour, day
                          type, origin/destination coordinates, distance.
                          This is what --mode replay feeds the simulator.
    build_calibration()   data/calibration.json: measured trips per day by
                          day type, with provenance. These volumes replace
                          the former daily_trips placeholders; anything
                          larger is an explicit growth hypothesis (--scale).

Everything is measured; nothing here is assumed except the UTC reading of
the timestamps, which is documented and cross-validated.
"""

import json
import statistics
from collections import Counter, defaultdict

from . import DATA_DIR, GEOJSON_DIR
from .pipeline.timeutil import (DAY_TYPES, TIMEZONE_NOTE, TZ_LOCAL, TZ_UTC,
                                day_type_of, to_local)


def load_trips(trips_file=None):
    """Every observed trip, flattened and in local time.

    :param trips_file: path of bike_trips.geojson; defaults to the layer's
                       Geneva data folder.
    :return: list of dicts with date (ISO), day_type (weekday/saturday/
             sunday), hour (local 0-23), o_lat/o_lon/d_lat/d_lon,
             distance_km. Trips missing a coordinate or timestamp are
             dropped (none in the current file).
    """
    trips_file = trips_file or GEOJSON_DIR / "bike_trips.geojson"
    with open(trips_file, encoding="utf-8") as f:
        features = json.load(f)["features"]

    rows = []
    for feature in features:
        p = feature["properties"]
        if not all(p.get(k) for k in ("trip_started_at_utc", "latitude_start",
                                      "longitude_start", "latitude_end",
                                      "longitude_end")):
            continue
        dt = to_local(p["trip_started_at_utc"])
        rows.append({
            "date": dt.date().isoformat(),
            "day_type": day_type_of(dt),
            "hour": dt.hour,
            "o_lat": float(p["latitude_start"]),
            "o_lon": float(p["longitude_start"]),
            "d_lat": float(p["latitude_end"]),
            "d_lon": float(p["longitude_end"]),
            "distance_km": float(p["distance_in_km"] or 0.0),
        })
    return rows


def trips_by_date(day, trips=None):
    """The observed trips of one simulator day type, grouped by calendar day.

    :param day: "monday", "saturday" or "sunday" (see :data:`DAY_TYPES`).
    :return: {date: [trip, ...]} for every observed calendar day of the type.
    """
    day_type = DAY_TYPES[day]
    grouped = defaultdict(list)
    for trip in trips or load_trips():
        if trip["day_type"] == day_type:
            grouped[trip["date"]].append(trip)
    return dict(grouped)


def build_calibration(trips_file=None, output_file=None):
    """Measure the daily volumes and write data/calibration.json.

    :return: the calibration dict written.
    """
    trips_file = trips_file or GEOJSON_DIR / "bike_trips.geojson"
    output_file = output_file or DATA_DIR / "calibration.json"
    trips = load_trips(trips_file)

    per_type = Counter(t["day_type"] for t in trips)
    days_seen = defaultdict(set)
    for t in trips:
        days_seen[t["day_type"]].add(t["date"])
    per_day = {sim_day: round(per_type[dt] / max(1, len(days_seen[dt])), 2)
               for sim_day, dt in DAY_TYPES.items()}
    distances = [t["distance_km"] for t in trips if t["distance_km"] > 0]

    calibration = {
        "source": str(trips_file),
        "n_trips": len(trips),
        "date_range": [min(t["date"] for t in trips),
                       max(t["date"] for t in trips)],
        "days_observed": {dt: len(days_seen[dt]) for dt in days_seen},
        "trips_per_day": per_day,
        "distance_km": {
            "median": round(statistics.median(distances), 2),
            "mean": round(statistics.mean(distances), 2),
        },
        "timezone_assumption": TIMEZONE_NOTE,
        "note": ("Measured volumes from the operator sample. These are the "
                 "simulator's base volumes; larger volumes are explicit "
                 "demand-growth hypotheses passed as --scale."),
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(calibration, f, indent=2)
    print(f"calibration written -> {output_file}")
    return calibration


def load_calibration(path=None):
    """Read calibration.json, building it first if absent."""
    path = path or DATA_DIR / "calibration.json"
    if not path.is_file():
        return build_calibration(output_file=path)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    c = build_calibration()
    print(json.dumps({k: c[k] for k in
                      ("n_trips", "date_range", "days_observed",
                       "trips_per_day", "distance_km")}, indent=2))
