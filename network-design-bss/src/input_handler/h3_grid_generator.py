import networkx as nx
from network.node import UserOD
import os
import json
from util.util import get_grid_union_polygon
from shapely.geometry import shape, mapping
import osmnx as ox
from shapely.geometry import Point


class H3GridGenerator:
    def __init__(self, geojson_data=None):
        self.length = 0  # length of grid in km
        self.width = 0
        self.square_size = 0
        self.coordinate_to_zone = {}
        self.grid = nx.MultiDiGraph()
        self.grid_centers = {}
        self.id_to_node = {}
        if geojson_data is not None:
            self._construct_grid(geojson_data)  # 只有传了才构建
            self.grid_polygon = get_grid_union_polygon(self.grid)

    def _construct_grid(self, geojson_data):
        """
        Construct the grid from provided GeoJSON data.
        remove unbuildable areas using OSM data.
        :param geojson_data:
        :return:
        """
        tags = {
            'landuse': ['forest', 'cemetery'],
            'natural': ['water'],
            'leisure': ['nature_reserve']
        }
        gdf_unbuildable = ox.features_from_place("Geneva, Switzerland", tags=tags)

        for feature in geojson_data["features"]:
            zone_id = feature["properties"]["id"]
            center = eval(feature["properties"]["center"])  # string -> tuple
            # 数据中 center 没有对应好 经纬度顺序, 需要转换
            lat, lon = center
            center = (lon, lat)

            point = Point(center)
            if gdf_unbuildable.contains(point).any():
                continue

            polygon = shape(feature["geometry"])
            self.grid.add_node(zone_id,
                               type="userOD",
                               coordinates=center,
                               polygon=polygon)
            self.grid_centers[zone_id] = center
            self.coordinate_to_zone[center] = zone_id
            self.id_to_node[zone_id] = {
                "node_id": zone_id,
                "coordinates": center
            }

    def get_center(self, zone_id):
        return self.grid_centers.get(zone_id)

    def get_all_zones(self):
        return list(self.grid_centers.keys())

    def get_polygon(self, zone_id):
        return self.grid.nodes[zone_id]["polygon"]

    def serialize_grid(self, include_polygons: bool = True) -> dict:
        """
        将 H3GridGenerator 的网格结构序列化为 JSON 友好格式。
        - nodes: 来自 NetworkX 图的节点及其属性（zone_id, coordinates, type）
        - centers: {zone_id: [lon, lat]}
        - id_to_node: {zone_id: {node_id, coordinates, type}}
        - coordinate_to_zone: 可选，如果你也想写进去
        """
        # 1) nodes（来自 nx.MultiDiGraph）
        nodes = []
        for zone_id, attrs in self.grid.nodes(data=True):
            rec = {
                "zone_id": zone_id,
                "coordinates": list(attrs.get("coordinates")) if attrs.get("coordinates") else None,
                "type": attrs.get("type", "userOD"),
            }
            if include_polygons and attrs.get("polygon") is not None:
                # shapely Polygon -> GeoJSON dict
                rec["polygon"] = mapping(attrs["polygon"])
            nodes.append(rec)

        # 2) centers（注意把 tuple -> list，JSON 更友好）
        centers = {str(zid): list(coord) for zid, coord in self.grid_centers.items()}

        # 3) id_to_node（你的字典里已经是 dict，但确保坐标转 list，补齐 type）
        id_to_node = {}
        for zid, info in self.id_to_node.items():
            coords = info.get("coordinates") or info.get("center")
            id_to_node[str(zid)] = {
                "node_id": zid,
                "coordinates": list(coords) if coords is not None else None,
                "type": self.grid.nodes[zid].get("type", "userOD") if zid in self.grid else info.get("type", "userOD"),
            }

        # 4) （可选）coordinate_to_zone：键是坐标 tuple，转成字符串或列表作为 key
        coordinate_to_zone = {
            f"{lon:.6f},{lat:.6f}": zid
            for (lon, lat), zid in self.coordinate_to_zone.items()
        }

        out = {
            "nodes": nodes,
            "centers": centers,
            "id_to_node": id_to_node,
            "coordinate_to_zone": coordinate_to_zone,  # 如不需要可以去掉
        }
        return out

    @classmethod
    def from_instance(cls, grid_network: dict):
        """
        grid_network 结构:
        {
          "nodes": [
            {
              "zone_id": "...",
              "coordinates": [lon, lat],
              "type": "userOD",
              "polygon": { ... GeoJSON ... }   # 可选
            },
            ...
          ]
        }
        """
        inst = cls(geojson_data=None)
        G = inst.grid

        for rec in grid_network.get("nodes", []):
            zid = str(rec["zone_id"])
            coord_tuple = tuple(rec["coordinates"])  # 已是 (lon, lat)
            node_type = rec.get("type", "userOD")

            # 1) 还原为你的类实例
            node = UserOD(zid, coord_tuple, node_type)

            # 2) 还原 polygon（可选）
            attrs = {"type": node.type, "coordinates": node.coordinate}
            if rec.get("polygon"):
                try:
                    attrs["polygon"] = shape(rec["polygon"])  # GeoJSON -> shapely
                except Exception:
                    pass

            # 3) 把“类实例”作为图节点加入
            G.add_node(node, **attrs)

            # 4) 映射表：id -> 实例；坐标 -> 实例；centers 仍用 zid 作为键
            inst.grid_centers[zid] = node.coordinate
            inst.id_to_node[zid] = node
            inst.coordinate_to_zone[node.coordinate] = node

        return inst
