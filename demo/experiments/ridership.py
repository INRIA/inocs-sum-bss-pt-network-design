"""
File: ridership.py
Description: The real public-transport ridership of the area -- hourly
             boardings/alightings at 156 stops, by day of week -- and what
             the demonstration uses it for.

`ridership.geojson` is observed data from the PT operator: one feature per
(stop, day of week, hour) with boardings and alightings summed over a year.
Three uses:

    1. Validation. The PT hourly profile is in *local* time by construction.
       Its weekday peaks (08h, 17-18h) landing on the same hours as the bike
       profile confirms the UTC reading of the bike timestamps (trips.py) --
       an independent check recorded in METHODS.md.
    2. Context KPI. Real PT volumes give the served bike trips a denominator
       a broad audience understands: bike trips per 1,000 PT boardings
       (evaluate.py).
    3. Visualization. data/pt_ridership_summary.json is a compact export the
       front-end can draw (per-stop totals, citywide hourly profiles).

Day labels in the file are French (Lun..Dim). Daily averages divide the
yearly sums by 52 occurrences of each weekday -- approximate (52.18 weeks a
year, holidays uncorrected) and marked as such.
"""

import json
from collections import defaultdict

from . import DATA_DIR, GEOJSON_DIR

#: French day label -> simulator day type.
DAY_LABELS = {"Lun": "monday", "Mar": "tuesday", "Mer": "wednesday",
              "Jeu": "thursday", "Ven": "friday", "Sam": "saturday",
              "Dim": "sunday"}
WEEKS_PER_YEAR = 52  # approximation used for daily averages


def load_ridership(path=None):
    """The raw (stop, day, hour) records, flattened.

    :return: list of dicts with stop_id, stop_name, lat, lon, day
             (english, lowercase), hour (int), boardings, alightings.
    """
    path = path or GEOJSON_DIR / "ridership.geojson"
    with open(path, encoding="utf-8") as f:
        features = json.load(f)["features"]
    rows = []
    for feature in features:
        p = feature["properties"]
        day = DAY_LABELS.get(p.get("day_label"))
        if day is None or p.get("timeslot") is None:
            continue
        rows.append({
            "stop_id": p["stop_id"],
            "stop_name": p["stop_name"],
            "lat": p["stop_lat"],
            "lon": p["stop_lon"],
            "day": day,
            "hour": int(float(p["timeslot"])),
            "boardings": p["boardings"] or 0,
            "alightings": p["alightings"] or 0,
        })
    return rows


def build_summary(path=None, output_file=None):
    """Aggregate the ridership into the summary the layer consumes.

    :return: the summary dict written to data/pt_ridership_summary.json.
    """
    output_file = output_file or DATA_DIR / "pt_ridership_summary.json"
    rows = load_ridership(path)

    hourly = defaultdict(lambda: [0] * 24)   # day -> boardings per hour
    daily = defaultdict(int)                 # day -> yearly boardings
    stops = defaultdict(lambda: {"boardings": 0, "alightings": 0})
    for r in rows:
        hourly[r["day"]][r["hour"]] += r["boardings"]
        daily[r["day"]] += r["boardings"]
        s = stops[r["stop_id"]]
        s["boardings"] += r["boardings"]
        s["alightings"] += r["alightings"]
        s.setdefault("name", r["stop_name"])
        s.setdefault("lat", r["lat"])
        s.setdefault("lon", r["lon"])

    def share(counts):
        total = sum(counts)
        return [round(c / total, 5) if total else 0.0 for c in counts]

    def peaks(counts, n=3):
        return sorted(range(24), key=lambda h: -counts[h])[:n]

    summary = {
        "source": str(path or GEOJSON_DIR / "ridership.geojson"),
        "n_stops": len(stops),
        "aggregation": (f"yearly sums per (stop, day-of-week, hour); daily "
                        f"averages divide by {WEEKS_PER_YEAR} (approximate)"),
        "daily_boardings_avg": {d: round(v / WEEKS_PER_YEAR)
                                for d, v in sorted(daily.items())},
        "hourly_share": {d: share(hourly[d]) for d in sorted(hourly)},
        "peak_hours": {d: peaks(hourly[d]) for d in sorted(hourly)},
        "stops": [{"stop_id": sid, **info}
                  for sid, info in sorted(stops.items(),
                                          key=lambda kv: -kv[1]["boardings"])],
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"PT ridership summary -> {output_file}")
    return summary


def load_summary(path=None):
    """Read the summary, building it first if absent."""
    path = path or DATA_DIR / "pt_ridership_summary.json"
    if not path.is_file():
        return build_summary(output_file=path)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def validate_bike_timezone(summary=None, profiles=None):
    """Compare PT and bike peak hours -- the timezone cross-check.

    :return: dict with both sets of peaks, printed by the CLI and quoted in
             METHODS.md.
    """
    from .profiles import load_profiles
    summary = summary or load_summary()
    profiles = profiles or load_profiles()

    bike = profiles["hourly_share"]["monday"]
    bike_peaks = sorted(range(24), key=lambda h: -bike[h])[:3]
    return {
        "pt_weekday_peak_hours": summary["peak_hours"]["monday"],
        "bike_weekday_peak_hours_after_utc_conversion": bike_peaks,
        "consistent": bool(set(summary["peak_hours"]["monday"])
                           & set(bike_peaks)),
    }


if __name__ == "__main__":
    s = build_summary()
    print(json.dumps({"daily_boardings_avg": s["daily_boardings_avg"],
                      "peak_hours": s["peak_hours"]}, indent=2))
    print("timezone cross-check:",
          json.dumps(validate_bike_timezone(summary=s), indent=2))
