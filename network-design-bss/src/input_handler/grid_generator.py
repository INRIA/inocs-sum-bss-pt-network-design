import math
import networkx as nx
from network.node import UserOD
import igraph as ig
from util.util import *


class GridGenerator:
    """
    Generate an m * n grid where each cell represents a square of the same size.
    The center of each square is considered a potential location for a bike station
    as well as a possible user origin or destination.
    这一步核心是生成 grid 每个 cell 的中心都是用户的起始点
    grid 只是原始版图，不用来计算距离等，真正的距离计算需要在构建network之后
    这一步就考虑 networkx 的 G 是为了直观的画图感受网络结构，而并不在意网络中更多细节，细节在 network_constructor 模块
    """

    def __init__(self, length=AREA_LENGTH, width=AREA_WIDTH, square_size=CELL_SIZE):
        self.length = length  # length of grid in km
        self.width = width
        self.square_size = square_size  # Size of each square in km
        self.coordinate_to_zone = dict()
        self.grid, self.grid_centers, self.id_to_node = self._generate_grid()
        self.grid_polygon = get_grid_union_polygon(self.grid)

    def _generate_grid(self):
        """
        Generate the coordinates of the center of each grid cell.
        """
        # G = ig.Graph(directed=False)
        # G = nx.Graph()
        G = nx.MultiDiGraph()  # 允许同一对节点存储多个边
        # G = nx.DiGraph()
        centers = {}
        for i in range(self.length):
            for j in range(self.width):
                zone_id = self.length * i + j   # f"Zone-{i}-{j}"
                center_coordinates = compute_coordinate(i, j, self.square_size)
                node = UserOD(zone_id, center_coordinates)
                centers[zone_id] = center_coordinates      # zone_id = i + j 则会损失很多点，因为 id 重复了
                G.add_node(node, type="userOD", coordinates=center_coordinates)
                # G.add_vertex(node, type="userOD", coordinates=center_coordinates)
                self.coordinate_to_zone[center_coordinates] = node
        id_to_node = {node.node_id: node for node in G.nodes}
        return G, centers, id_to_node

    def get_center(self, zone_id):
        """
        Get the center coordinates of a given zone.
        """
        return self.grid_centers.get(zone_id)

    def get_all_zones(self):
        """
        Get all zones in the grid.
        """
        return list(self.grid_centers.keys())

    def serialize_grid(self):
        return {
            "nodes": [
                {
                    "node_id": node.node_id,
                    "coordinate": node.coordinate,
                    "type": data["type"]
                }
                for node, data in self.grid.nodes(data=True)
            ],
            "centers": {
                str(zone_id): coord for zone_id, coord in self.grid_centers.items()
            },
            "id_to_node": {
                str(node_id): {
                    "node_id": node.node_id,
                    "coordinate": node.coordinate,
                    "type": node.type
                }
                for node_id, node in self.id_to_node.items()
            }
        }


def compute_coordinate(i, j, size) -> tuple[float, float]:
    return i * size + size / 2, j * size + size / 2
