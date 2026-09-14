"""
File: profiles.py
Description: Derive the temporal demand profiles the simulator replays -- an
             hourly share vector per day type -- from the observed bike trips
             in the model's input sample.

The trips in bike_trips.geojson carry naive ISO timestamps in the field
`trip_started_at_utc`. The name is trusted: they are read as UTC and converted
to Europe/Zurich, which puts the weekday peaks at 08h and 17-18h local -- the
classic commute signature -- instead of the implausible 06h a naive reading
gives.

Outputs `demo/experiments/data/profiles.json`:

    {
      "source": "...", "n_trips": ..., "days_observed": {...},
      "period_weights": {"weekday": [p1, p2, p3], "sunday": [...]},
      "hourly_share": {"monday": [24 floats summing to 1], "sunday": [...]},
      "daily_ratio_sunday_over_weekday": ...
    }

`period_weights` aggregates the same distribution into the model's three
demand periods (06-10, 10-16, 16-22 local) -- these are the values the
scenarios put into DemandConfig.period_weights. `hourly_share` keeps the full
24-hour resolution for the day simulator. "monday" uses all weekdays pooled:
the sample is too small (~1 650 trips) to split single weekdays, and Monday is
a typical weekday in it.

When the full one-year OD dataset is available, regenerate this file from it
with the same schema; nothing downstream changes.
"""

import json
from collections import Counter

from . import DATA_DIR, GEOJSON_DIR
from .trips import load_trips

#: Local-time boundaries of the model's three demand periods.
PERIOD_BOUNDS = ((6, 10), (10, 16), (16, 22))


def build_profiles(trips_file=None, output_file=None):
    """Extract the hourly and per-period demand shares from observed trips.

    :param trips_file: path of bike_trips.geojson; defaults to the model's
                       Geneva sample.
    :param output_file: where to write profiles.json; defaults to
                        demo/experiments/data/profiles.json.
    :return: the profiles dict written.
    """
    trips_file = trips_file or GEOJSON_DIR / "bike_trips.geojson"
    output_file = output_file or DATA_DIR / "profiles.json"

    trips = load_trips(trips_file)

    hourly = {"weekday": Counter(), "sunday": Counter(), "saturday": Counter()}
    days_seen = {"weekday": set(), "sunday": set(), "saturday": set()}

    for trip in trips:
        key = trip["day_type"]
        hourly[key][trip["hour"]] += 1
        days_seen[key].add(trip["date"])

    def hourly_share(counter):
        total = sum(counter.values())
        return [round(counter.get(h, 0) / total, 5) for h in range(24)]

    def period_weights(counter):
        in_period = [sum(v for h, v in counter.items() if lo <= h < hi)
                     for lo, hi in PERIOD_BOUNDS]
        core = sum(in_period)
        return [round(v / core, 3) for v in in_period]

    trips_per_day = {key: sum(hourly[key].values()) / max(1, len(days_seen[key]))
                     for key in hourly}

    profiles = {
        "source": str(trips_file),
        "n_trips": len(trips),
        "days_observed": {k: len(v) for k, v in days_seen.items()},
        "trips_per_day_observed": {k: round(v, 2) for k, v in trips_per_day.items()},
        "period_bounds_local": PERIOD_BOUNDS,
        "period_weights": {
            "weekday": period_weights(hourly["weekday"]),
            "sunday": period_weights(hourly["sunday"]),
        },
        "hourly_share": {
            "monday": hourly_share(hourly["weekday"]),
            "sunday": hourly_share(hourly["sunday"]),
        },
        "daily_ratio_sunday_over_weekday": round(
            trips_per_day["sunday"] / trips_per_day["weekday"], 3),
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(profiles, f, indent=2)
    print(f"profiles written -> {output_file}")
    return profiles


def load_profiles(path=None):
    """Read profiles.json, building it first if absent."""
    path = path or DATA_DIR / "profiles.json"
    if not path.is_file():
        return build_profiles(output_file=path)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    p = build_profiles()
    print(json.dumps({k: p[k] for k in
                      ("period_weights", "trips_per_day_observed",
                       "daily_ratio_sunday_over_weekday")}, indent=2))
