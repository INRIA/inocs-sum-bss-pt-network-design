from input_handler.grid_generator import GridGenerator
from input_handler.pt_generator import PublicTransport
from network.node import TransferStation
from input_handler.station_generator import BikeStationGenerator
from input_handler.demand_generator import DemandGenerator
from util.util import *


def preprocess(length, width, square_size, total_trips, od_coverage_ratio,
               demand_type, seed=42):
    """
    :param od_coverage_ratio:
    :param OD_COVERAGE_RATIO:
    :param total_trips:
    :param demand_type:
    :param seed:
    :param length:
    :param width:
    :param square_size:
    :return: 注意区分类对象和图（networkx）对象
    """
    # 生成 grid
    grid_generator = GridGenerator(length, width, square_size)
    public_transport = PublicTransport(grid_generator)

    # generate potential bike station locations
    bike_station_generator = BikeStationGenerator(grid_generator)
    bike_stations = bike_station_generator.bike_stations

    # 创建并生成一条随机线路
    pt_line_number = len(FIXED_LINE_POINTS_LST)
    for pt, fixed_line_points in zip(range(1, pt_line_number + 1), FIXED_LINE_POINTS_LST):
        public_transport.generate_new_route(f"PT_{pt}", flag=True, fixed_line_points=fixed_line_points)

    public_transport, bike_stations = match_transfer_station_with_bss(public_transport, bike_stations)

    # Generate demand
    demand_generator = DemandGenerator(grid_generator, public_transport, seed, total_trips,
                                       demand_type, od_coverage_ratio)
    # demand_matrix = demand_generator.generate_demand()
    # Visualize demand
    # demand_generator.visualize_demand()

    return grid_generator, public_transport, bike_stations, demand_generator


def match_transfer_station_with_bss(public_transport, bike_stations):
    """
    Combine a PT stop with nearby bike stations
    :param public_transport:
    :param bike_stations:
    :return:
    """
    transfer_mapping = {}
    removed_bike_ids = set()
    transfer_stations = []
    transfer_stations_coordinates = set()
    for route_name, route in public_transport.routes.items():
        for transfer_station in route:
            # skip if already matched
            if transfer_station.coordinate in transfer_stations_coordinates:
                continue
            nearby_bikes_station = [
                bike_station for bike_station in bike_stations
                if compute_distance(transfer_station.coordinate, bike_station.coordinate) <= PT_TRANSFER_RADIUS
                # 0.5km 较为合理，过大比如0.5*跟号2 会将网格相交点周围的四个站点都囊括进去
            ]
            if nearby_bikes_station:
                transfer_station.bike_attrs = nearby_bikes_station[0]   # only take the first one as bike_attrs
                transfer_mapping[transfer_station.node_id] = transfer_station
                removed_bike_ids.update(b.node_id for b in nearby_bikes_station)
                transfer_stations.append(transfer_station)
                transfer_stations_coordinates.add(transfer_station.coordinate)

    # 更新 bike_stations，剔除被合并进 transfer 的
    bike_stations = [station for station in bike_stations if station.node_id not in removed_bike_ids]
    bike_stations.extend(transfer_stations)
    return public_transport, bike_stations
