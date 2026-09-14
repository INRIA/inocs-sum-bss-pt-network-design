"""
File: od_builder.py
Location: demo/ -- deliberately outside network-design-bss/, which is frozen.
Description: Build the origin-destination demand table (od.csv) that
             InstanceGenerator.build_realistic_scenario() reads, from the
             observed bike trips in bike_trips.geojson.

Notes:
- Trip endpoints are assigned to grid cells by point-in-polygon test against the
  geometries in grid.geojson, NOT by recomputing an H3 index from the
  coordinates. The cell ids in grid.geojson are produced by the SUM
  GTFS-to-GeoJSON package with the latitude and longitude arguments
  transposed, so an id recomputed here with the correct argument order would
  never match one of them. Matching on geometry sidesteps that entirely and
  stays correct if the producer is ever fixed.
- Intra-cell trips (origin cell == destination cell) are dropped: the model
  optimises movement between zones, and a trip that starts and ends in the
  same zone carries no information about inter-zone connectivity.
"""

import csv
import json
import os

from shapely.geometry import Point, shape
from shapely.strtree import STRtree


def build_od_from_trips(geojson_dir, trips_file="bike_trips.geojson",
                        grid_file="grid.geojson", output_file="od.csv",
                        keep_intrazone=False):
    """
    :param geojson_dir: directory holding grid_file and trips_file.
    :param trips_file: observed trips, as produced by sum-gtfs-geojson.
    :param grid_file: hex grid whose cells define the model's zones.
    :param output_file: name of the CSV written into geojson_dir.
    :param keep_intrazone: keep trips whose origin and destination coincide.
    :return: path of the CSV written.
    """
    with open(os.path.join(geojson_dir, grid_file), encoding="utf-8") as f:
        grid = json.load(f)

    polygons = [shape(feature["geometry"]) for feature in grid["features"]]
    cell_ids = [feature["properties"]["id"] for feature in grid["features"]]
    index = STRtree(polygons)

    def cell_of(lon, lat):
        point = Point(lon, lat)
        for i in index.query(point):
            if polygons[i].covers(point):
                return cell_ids[i]
        return None

    with open(os.path.join(geojson_dir, trips_file), encoding="utf-8") as f:
        trips = json.load(f)["features"]

    flows = {}
    outside = 0
    for trip in trips:
        props = trip["properties"]
        origin = cell_of(props["longitude_start"], props["latitude_start"])
        destination = cell_of(props["longitude_end"], props["latitude_end"])
        if origin is None or destination is None:
            outside += 1
            continue
        if origin == destination and not keep_intrazone:
            continue
        flows[(origin, destination)] = flows.get((origin, destination), 0) + 1

    path = os.path.join(geojson_dir, output_file)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["origin_cell", "dest_cell", "flow"])
        for (origin, destination), flow in sorted(flows.items(), key=lambda kv: -kv[1]):
            writer.writerow([origin, destination, flow])

    print(f"✅ Saved: {path}")
    print(f"   {len(trips)} trips read, {outside} with an endpoint outside the grid, "
          f"{sum(flows.values())} counted over {len(flows)} OD pairs")
    return path


if __name__ == '__main__':
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from compat import bootstrap

    package = bootstrap()
    from util.util import h3_version  # noqa: E402  (must follow bootstrap)

    build_od_from_trips(os.path.join(str(package), "data", "geojson", h3_version))
