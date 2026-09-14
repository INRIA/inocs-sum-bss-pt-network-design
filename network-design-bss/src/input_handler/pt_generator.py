import random
import networkx as nx
import math
from network.node import PublicTransportStop
from network.node import TransferStation
from util.util import *
from dataclasses import dataclass
from shapely.geometry import Point


class PublicTransport:
    """
    Public transport network based on a grid.
    """

    def __init__(self, grid_generator):
        self.grid_generator = grid_generator  # GridGenerator instance
        self.routes = {}  # Stores routes {route_name: [PublicTransportStop]}
        self.pt_stops = {}
        self.coordinate_to_stop = dict()

    def generate_new_route(self, route_name, flag, fixed_line_points, num_points=5, seed=None):
        """
        Generate a random route with stops in the grid.
        :param fixed_line_points:
        :param flag: True if using fixed line points, False using random generated points
        fixed_line_points
        :param seed: fix random value
        :param route_name: Name of the route.
        :param num_points: Number of stops on the route.
        """
        if route_name in self.routes:
            raise ValueError(f"Route {route_name} already exists.")

        if seed is not None:
            random.seed(seed)

        if flag:
            points = fixed_line_points
        else:
            available_points = list(self.grid_generator.grid_centers.keys())
            points = random.sample(available_points, num_points)
        route_stops = []
        for i, point_id in enumerate(points):
            coord = self.grid_generator.grid_centers[point_id]
            zone = point_id
            catchment_area = self._calculate_catchment_area(coord, WALK_CATCHMENT_RADIUS)
            prev_stop = route_stops[-1] if route_stops else None
            # Regular PT nodes are replaced by transfer stations to downscale the model
            stop = TransferStation(f"transfer_{route_name}-{i}",
                                   coord,
                                   PublicTransportStop(
                                    node_id=f"{route_name}-{i}",
                                    coordinate=coord,
                                    line_id=route_name,
                                    zone=zone,
                                    catchment_area=catchment_area,
                                    prev_stop=prev_stop))
            if prev_stop:
                prev_stop.pt_attrs.next_stop = stop
                prev_stop.pt_attrs.next_stop_distance = self.calculate_distance(prev_stop.coordinate, stop.coordinate)
            route_stops.append(stop)
            self.coordinate_to_stop[coord] = stop
        self.routes[route_name] = route_stops
        self.pt_stops[route_name] = route_stops

    def build_route(self):
        """
        Build public transport routes from a GeoJSON file.
        read itineraries.geojson and stops.geojson to create routes and stops.
        :return:
        """
        self.stations, self.coordinate_to_stop = self._get_stations_info()

        self.coordinate_to_station = dict()

        data = load_geojson("itineraries.geojson")

        signature_to_route = {}

        for feature in data["features"]:
            props = feature["properties"]
            edge_travel_time_seconds = props.get("edge_travel_time_seconds", None)
            coords = feature["geometry"]["coordinates"]  # 线路遍历的坐标
            coords = [c for c in coords if self.grid_generator.grid_polygon.contains(Point(c[0], c[1]))]
            if len(coords) < 2:
                print(f"[Skipped] Route '{props.get('route_short_name', 'unknown')}' "
                      f"has insufficient in-bound coordinates ({len(coords)}) and was removed.")
                continue  # 无法构成路线，跳过

            route_name = "PT_" + props.get("route_short_name", "unknown")
            if route_name in self.routes:
                continue  # Avoid duplicate route

            # —— 计算“几何签名”（前/后向）——
            # 1) 统一精度，避免微小浮点差导致“看似不同”
            coords_norm = tuple((round(lon, 6), round(lat, 6)) for lon, lat in coords)
            sig_fwd = coords_norm
            sig_rev = tuple(reversed(coords_norm))  # 反向也视为相同

            # 2) 判重：若已有完全相同（或反向相同）的线路，则跳过本条
            if sig_fwd in signature_to_route or sig_rev in signature_to_route:
                dup_with = signature_to_route.get(sig_fwd) or signature_to_route.get(sig_rev)
                print(f"[dedupe] route {route_name} duplicates {dup_with}, skipped.")
                continue

            # 3) 记下签名
            signature_to_route[sig_fwd] = route_name

            route_stops = []
            prev_stop = None

            for i, coord in enumerate(coords):
                coord = tuple(coord)
                zone = h3.latlng_to_cell(coord[0], coord[1], H3_resolution)
                catchment_area = self._calculate_catchment_area(coord, WALK_CATCHMENT_RADIUS)

                stop_id = f"{route_name}-{i}"
                pt_stop = PublicTransportStop(
                    node_id=stop_id,
                    coordinate=coord,
                    line_id=route_name,
                    zone=zone,
                    catchment_area=catchment_area,
                    prev_stop=prev_stop
                )

                if coord in self.coordinate_to_station:
                    transfer_station = self.coordinate_to_station[coord]
                else:
                    transfer_station = TransferStation(f"transfer_{route_name}-{i}", coord, pt_stop)
                    self.coordinate_to_station[coord] = transfer_station
                route_stops.append(transfer_station)
                if prev_stop:
                    prev_stop.pt_attrs.next_stop = transfer_station
                    prev_stop.pt_attrs.next_stop_distance = self.calculate_distance(prev_stop.coordinate, transfer_station.coordinate)
                    prev_stop.pt_attrs.next_stop_travel_time = int(edge_travel_time_seconds[i - 1])
                prev_stop = transfer_station

            self.routes[route_name] = route_stops
            self.pt_stops[route_name] = route_stops
        return self

    def _get_stations_info(self):
        data = load_geojson("stops.geojson")
        self.stations = {}  # node_id -> PublicTransportStop
        for feat in data["features"]:
            stop = feature_to_pt_stop(feat)
            # 存储
            self.stations[stop.node_id] = stop
            self.coordinate_to_stop[stop.coordinate] = stop.node_id
        return self.stations, self.coordinate_to_stop

    def _calculate_catchment_area(self, coord, radius):
        """
        Calculate zones within a given radius from a coordinate.
        """
        catchment_area = []
        for zone_id, zone_coord in self.grid_generator.grid_centers.items():
            distance = self.calculate_distance(coord, zone_coord)
            if distance <= radius:
                catchment_area.append(zone_id)
        return catchment_area

    def calculate_distance(self, coord1, coord2):
        """
        Calculate the straight-line distance between two coordinates (Euclidean distance).
        """
        x1, y1 = coord1
        x2, y2 = coord2
        return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

    def get_route_info(self, route_name):
        """
        Retrieve detailed information about a route and its stops.
        """
        if route_name not in self.routes:
            raise ValueError(f"Route {route_name} does not exist.")
        return self.routes[route_name]

    def add_custom_stop(self, stop_instance):
        """
        Add a custom stop instance to the specified route and link it appropriately.

        :param stop_instance: An instance of PublicTransportStop with predefined properties.
                              Required attributes: node_id, coordinate, line_id, zone, prev_stop.
        """
        if not isinstance(stop_instance, PublicTransportStop):
            raise TypeError("The stop must be an instance of PublicTransportStop.")

        route_name = stop_instance.line_id

        # Check if the route exists
        if route_name not in self.routes:
            raise ValueError(f"Route {route_name} does not exist. Please add the route first.")

        # Retrieve the current route
        route_stops = self.routes[route_name]

        # Link the stop with its previous stop
        prev_stop = stop_instance.prev_stop
        if prev_stop:
            # Ensure the previous stop is part of the route
            prev_stop_instance = next((stop for stop in route_stops if stop.node_id == prev_stop), None)
            if not prev_stop_instance:
                raise ValueError(f"Previous stop ID {prev_stop} not found in the route {route_name}.")
            # Update links
            stop_instance.prev_stop = prev_stop_instance
            stop_instance.next_stop = prev_stop_instance.next_stop
            if prev_stop_instance.next_stop:
                prev_stop_instance.next_stop.prev_stop = stop_instance
            prev_stop_instance.next_stop = stop_instance
        else:
            # If no previous stop is provided, add the stop as the first stop
            if route_stops:
                stop_instance.next_stop = route_stops[0]
                route_stops[0].prev_stop = stop_instance

        # Add the stop instance to the route
        route_stops.append(stop_instance)

    def to_dict(self):
        return {
            "routes": {
                route_name: [stop.to_dict() for stop in stop_list]
                for route_name, stop_list in self.routes.items()
            }
            # pt_stops 不再序列化，from_dict 时自动重建
        }

    @classmethod
    def from_dict(cls, data, grid_generator):
        pt = cls(grid_generator)

        pt.routes = {}
        # pt.pt_stops = {}  # 构造时不再按 route name，而是 node_id 做映射
        for route_name, stop_list_data in data["routes"].items():
            pt.routes[route_name] = []
            for stop_data in stop_list_data:
                stop_type = stop_data.get("type", "PTStop")
                stop = (
                    TransferStation.from_dict(stop_data)
                    if stop_type == "TransferStation"
                    else PublicTransportStop.from_dict(stop_data)
                )
                pt.routes[route_name].append(stop)
                # pt.pt_stops[stop.node_id] = stop  # 用 node_id 建立扁平索引
                pt.coordinate_to_stop[tuple(stop.coordinate)] = stop
        pt.pt_stops = pt.routes
        return pt


def feature_to_pt_stop(feature) -> PublicTransportStop:
    props = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"]

    # ---- 必填参数 ----
    node_id = props["stop_id"]  # 站点唯一 ID
    coordinate = (lon, lat)
    line_id = None  # 暂无线路信息
    zone = props.get("zone_id")  # 可能是 None
    # 其它参数先设为 None
    catchment_area = None
    prev_stop = None
    next_stop = None
    next_stop_distance = None

    # 创建实例
    stop = PublicTransportStop(
        node_id=node_id,
        coordinate=coordinate,
        line_id=line_id,
        zone=zone,
        catchment_area=catchment_area,
        prev_stop=prev_stop,
        next_stop=next_stop,
        next_stop_distance=next_stop_distance,
        type="PTStop"  # 或 "Station"，按你需求改
    )
    return stop
