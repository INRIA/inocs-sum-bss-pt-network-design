"""
File: stations_real.py
Description: Today's real bike-share network, assembled from official data
             only -- for visualization, not simulation.

Joins two real sources:

    bike_stations.geojson             the 139 station locations inside the
                                      1.5 km area (from the operator's data)
    donkey_station_information.json   the official GBFS station_information
                                      feed (623 stations region-wide), which
                                      carries the real capacity of each

The join is by station name (the GBFS feed localises names; the French text
is used), with a nearest-coordinate fallback within 50 m for renamed
stations. Output: data/stations_real.geojson -- each in-area station with
its real capacity where the feed provides one, and `"match": "none"` +
`"capacity": null` where it does not (stations likely discontinued since).

Why visualization only: everything above is real, but *replaying a day*
against this network would additionally need each station's bike stock,
and no real source for that exists in the repository. Missing real data,
explicitly:

    - per-station bike counts over time (GBFS station_status history --
      the planned weekly sampling would provide it)
    - capacities for the unmatched stations

Until a stock source exists, simulating today's network would mean
inventing its most important state, so it is not done.
"""

import json

from . import DATA_DIR, GEOJSON_DIR
from .pipeline.geometry import haversine_m

#: Fallback match radius: two records within this distance are the same
#: physical station under a changed name.
MATCH_RADIUS_M = 50


def _feed_name(station):
    """The French text of a GBFS localised name (or the plain string)."""
    name = station["name"]
    if isinstance(name, list):
        for entry in name:
            if entry.get("language") == "fr":
                return entry["text"]
        return name[0]["text"] if name else ""
    return name


def build_stations_real(stations_file=None, feed_file=None, output_file=None):
    """Join locations with feed capacities and write stations_real.geojson.

    :return: (feature list, match report dict).
    """
    stations_file = stations_file or GEOJSON_DIR / "bike_stations.geojson"
    feed_file = feed_file or GEOJSON_DIR / "donkey_station_information.json"
    output_file = output_file or DATA_DIR / "stations_real.geojson"

    with open(stations_file, encoding="utf-8") as f:
        local = json.load(f)["features"]
    with open(feed_file, encoding="utf-8") as f:
        feed = json.load(f)["data"]["stations"]

    by_name = {}
    for s in feed:
        by_name.setdefault(_feed_name(s), s)

    features, report = [], {"by_name": 0, "by_distance": 0, "none": []}
    for feature in local:
        p = feature["properties"]
        entry = by_name.get(p["name"]) or by_name.get(p["station_id"])
        how = "name" if entry else None

        if entry is None:
            best, best_d = None, MATCH_RADIUS_M
            for s in feed:
                d = haversine_m(p["lat"], p["lon"], s["lat"], s["lon"])
                if d < best_d:
                    best, best_d = s, d
            if best is not None:
                entry, how = best, "distance"

        properties = {
            "station_id": p["station_id"],
            "name": p["name"],
            "lat": p["lat"],
            "lon": p["lon"],
            "capacity": entry["capacity"] if entry else None,
            "is_virtual_station": entry.get("is_virtual_station") if entry else None,
            "gbfs_station_id": entry["station_id"] if entry else None,
            "match": how or "none",
        }
        features.append({"type": "Feature", "properties": properties,
                         "geometry": {"type": "Point",
                                      "coordinates": [p["lon"], p["lat"]]}})
        if how == "name":
            report["by_name"] += 1
        elif how == "distance":
            report["by_distance"] += 1
        else:
            report["none"].append(p["name"])

    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "description": ("Today's bike-share network: real locations "
                            "joined with real GBFS capacities. Visualization "
                            "only -- no bike-stock data exists to simulate it."),
            "sources": [str(stations_file), str(feed_file)],
            "match_report": {"by_name": report["by_name"],
                             "by_distance": report["by_distance"],
                             "unmatched": len(report["none"])},
        },
        "features": features,
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(collection, f, indent=2)

    matched = report["by_name"] + report["by_distance"]
    print(f"stations_real: {matched}/{len(features)} matched with real "
          f"capacity ({report['by_name']} by name, {report['by_distance']} "
          f"by proximity) -> {output_file}")
    if report["none"]:
        print(f"no capacity (likely discontinued): {len(report['none'])} "
              f"stations: {', '.join(sorted(report['none'])[:8])}"
              + (" ..." if len(report["none"]) > 8 else ""))
    return features, report


if __name__ == "__main__":
    build_stations_real()
