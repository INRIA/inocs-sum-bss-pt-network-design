import networkx as nx
from util.util import *


class Node:
    def __init__(self, node_id, coordinate, is_origin=False):
        """
        :param node_id:
        :param coordinate:
        :param is_pt: 是否是公共交通站点是给定的
        :param is_bike_station: 是否选中作为 bike station 是模型决策的结果
        :param is_origin:
        # todo: _id_counter = 0 其实可以自动分配序号 我这里自己给定了
        """
        self.node_id = node_id
        self.coordinate = coordinate
        self.is_origin = is_origin  # True if it's a user origin point, by default it's also a destination point
        # self.is_pt = is_pt  # True if it's a public transport stop
        # self.is_bike_station = is_bike_station  # True if it's a bike-sharing station
        # self.is_destination = is_destination  # True if it's a user destination point

    def __hash__(self):
        return hash(self.node_id)  # 让 Node 以 ID 为哈希值

    def __eq__(self, other):
        return isinstance(other, Node) and self.node_id == other.node_id  # 确保 ID 相同的 Node 视为相等

    def calculate_catchment_area(self, distance_threshold, nodes_set):
        """
        该函数强烈依赖于类的实例属性时 放在类的内部较为合适

        Calculate the catchment area for this node.
        :param distance_threshold: Maximum reachable distance.
        :param nodes_set: A list of all nodes.
        :return: A list of nodes within the catchment area.
        """
        catchment_area = []
        distance_accessing = []
        for node in nodes_set:
            if node != self:  # 不要限制坐标 因为剥夺了始发点直接前往自己 zone 内 bike station 的权利
                distance = compute_distance(self.coordinate, node.coordinate)
                if distance <= distance_threshold:
                    catchment_area.append(node)
                    distance_accessing.append(distance)
        return catchment_area, distance_accessing

    def __lt__(self, other):
        # node 之间可以比较 为了后续某处代码方便
        return self.coordinate < other.coordinate

    def __repr__(self):
        return (f"Node({self.node_id}, "
                f"coordinate={self.coordinate}, "
                f"is_origin={self.is_origin}, ")


class BikeStation(Node):
    def __init__(self, node_id, coordinate, capacity=None, initial_stock=None, capacity_ub=CAPACITY_UB,
                 catchment_area_walk=None, catchment_area_ride=None, type="BikeStation"):
        """
        A subclass of Node representing a bike station.
        :param capacity: Total capacity of the bike station.
        :param initial_stock: Initial number of bikes at the station.
        :param catchment_area: Nodes that can be reached by walking or biking from this station.
        """
        super().__init__(node_id, coordinate)
        self.node_id = node_id
        self.capacity = capacity
        self.initial_stock = initial_stock
        self.capacity_ub = capacity_ub
        self.catchment_area_walk = catchment_area_walk
        self.catchment_area_ride = catchment_area_ride
        self.type = type

    @classmethod
    def from_dict(cls, data):
        # cls 是 Python 中的一个约定俗成的名字，用在类方法（@classmethod）中，表示当前类自身（class）
        # 如果你的 coordinate 一开始从 JSON 文件或 .from_dict() 导入，是 list 类型，也建议在导入时就转为 tuple
        return cls(
            node_id=data["node_id"],
            coordinate=tuple(data["coordinate"]),
            type=data.get("type", "BikeStation")
        )

class PublicTransportStop(Node):
    def __init__(self, node_id, coordinate, line_id, zone,
                 catchment_area=None,
                 prev_stop=None,
                 next_stop=None,
                 next_stop_distance=None,
                 next_stop_travel_time=None,
                 type="PTStop"):
        """
        A subclass of Node representing a public transport stop.
        :param line_id: The ID of the line this stop belongs to.
        :param zone: The zone in which this stop is located.
        :param catchment_area: Nodes reachable by walking from this stop.
        :param prev_stop: The previous public transport stop on the line.
        :param next_stop: The next public transport stop on the line.
        """
        super().__init__(node_id, coordinate)
        self.line_id = line_id
        self.zone = zone
        self.catchment_area = catchment_area
        self.prev_stop = prev_stop
        self.next_stop = next_stop
        self.next_stop_distance = next_stop_distance
        self.next_stop_travel_time = next_stop_travel_time,
        self.type = type
        self.pt_attrs = PTAttributes()  # 默认空属性

    def to_dict(self):
        return {
            "node_id": self.node_id,
            "coordinate": self.coordinate,
            "line_id": self.line_id,
            "zone": self.zone,
            "catchment_area": self.catchment_area,  # 建议用 list of node_ids
            "prev_stop": self.prev_stop.node_id if self.prev_stop else None,
            "next_stop": self.next_stop.node_id if self.next_stop else None,
            "next_stop_distance": self.next_stop_distance,
            "next_stop_travel_time": self.next_stop_travel_time,
            "type": self.type,
            "pt_attrs": self.pt_attrs.to_dict() if self.pt_attrs else None
        }

    @classmethod
    def from_dict(cls, data):
        stop = cls(
            node_id=data["node_id"],
            coordinate=tuple(data["coordinate"]),
            line_id=data["line_id"],
            zone=data["zone"],
            catchment_area=data.get("catchment_area"),  # 可后续映射为 node 对象
            prev_stop=data.get("prev_stop"),  # 仅存 ID，需要之后匹配
            next_stop=data.get("next_stop"),
            next_stop_distance=data.get("next_stop_distance"),
            next_stop_travel_time=data.get("next_stop_travel_time"),
            type=data.get("type", "PTStop")
        )
        if data.get("pt_attrs"):
            stop.pt_attrs = PTAttributes.from_dict(data["pt_attrs"])
        return stop


class UserOD(Node):
    def __init__(self, node_id, coordinate, catchment_area=None, pt_stops=None, bike_stations=None, type="userOD"):
        """
        A subclass of Node representing a user's origin/destination point.
        :param pt_stops: Public transport stops in the catchment area of this node.
        :param bike_stations: Bike stations in the catchment area of this node.
        """
        super().__init__(node_id, coordinate, is_origin=True)
        if pt_stops is None:
            pt_stops = []
        self.catchment_area = catchment_area
        self.pt_stops = pt_stops
        self.bike_stations = bike_stations
        self.type = type


class PTAttributes:
    def __init__(self, next_stop=None, next_stop_distance=None, next_stop_travel_time=None):
        """
        PTAttributes.from_dict() 里只能恢复数值字段（如 next_stop_distance）。
        next_stop 是对象引用，JSON 只能存 ID，因此需要 two-pass linking（二次回连）
        :param next_stop:
        :param next_stop_distance:
        """
        self.next_stop = next_stop
        self.next_stop_distance = next_stop_distance
        self.next_stop_travel_time = next_stop_travel_time
        self._next_stop_id = None

    @classmethod
    def from_dict(cls, data):
        obj = cls(
            next_stop=None,  # 引用稍后二次回连
            next_stop_distance=data.get("next_stop_distance"),
            next_stop_travel_time=data.get("next_stop_travel_time")
        )
        obj._next_stop_id = data.get("next_stop_id")
        return obj

    def to_dict(self):
        return {
            "next_stop_id": self.next_stop.node_id if self.next_stop else None,
            "next_stop_distance": self.next_stop_distance
        }


class TransferStation(Node):
    # 可以使用组合（composition）而不是多继承，便于调用时清晰区分类型
    def __init__(self, node_id, coordinate,
                 pt_stop: PublicTransportStop = None,
                 bike_station: BikeStation = None,
                 type="TransferStation"):
        """
        A node that represents a transfer point between public transport and bike sharing.
        :param pt_stop: a PublicTransportStop instance (can be None)
        :param bike_station: a BikeStation instance (can be None)

        pt_attrs 使用了对象引用（stop.pt_attrs.next_stop = <Stop对象>） 但
        JSON 只能存值，没有“指针/引用”的概念；序列化后“这是谁”的信息就丢了，因此需要 two-pass linking（二次回连）
        从根设计上避免“二次回连”，需要将模型改为 ID 驱动 （或将这个信息直接后处理读出来）
        """
        super().__init__(node_id, coordinate)
        self.pt_attrs = pt_stop        # 保留 PT Stop 的所有信息
        self.bike_attrs = bike_station  # 保留 BikeStation 的所有信息
        self.type = type

    def to_dict(self):
        return {
            "node_id": self.node_id,
            "coordinate": list(self.coordinate),
            "type": self.type,
            "pt_attrs": self.pt_attrs.to_dict() if self.pt_attrs else None
        }

    @classmethod
    def from_dict(cls, data):
        stop = cls(
            node_id=data["node_id"],
            coordinate=tuple(data["coordinate"]),
            type=data.get("type", "TransferStation")
        )
        if data.get("pt_attrs"):
            stop.pt_attrs = PTAttributes.from_dict(data["pt_attrs"])
        return stop
