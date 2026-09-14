from pathlib import Path as FsPath
import osmnx as ox
import networkx as nx
import geopandas as gpd
from shapely.geometry import Point
from osmnx import distance as ox_distance
from functools import lru_cache
from util.util import *
from osmnx import graph


class NetworkBuilder:
    def __init__(self, center_lat=46.2044, center_lon=6.1432, dist_m=3000, cache_dir="osm_cache"):
        self.center_lat = center_lat
        self.center_lon = center_lon
        self.dist_m = dist_m

        self.cache_dir = FsPath(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self.walk_path = self.cache_dir / f"walk_{center_lat:.4f}_{center_lon:.4f}_{dist_m}m.graphml"
        self.bike_path = self.cache_dir / f"bike_{center_lat:.4f}_{center_lon:.4f}_{dist_m}m.graphml"

        self.G_walk_proj = self._load_or_build("walk", self.walk_path)
        self.G_bike_proj = self._load_or_build("bike", self.bike_path)

        self.sp_cache_path = self.cache_dir / "shortest_path_cache.pkl"
        self.sp_cache = {}

        self._load_sp_cache()

    def _load_or_build(self, mode: str, path: Path):
        if path.exists():
            G = ox.load_graphml(path)
            # 确保有 length
            if not any("length" in d for _, _, d in G.edges(data=True)):
                G = ox_distance.add_edge_lengths(G)
            return G

        # 没缓存：下载
        G = ox.graph_from_point(
            (self.center_lat, self.center_lon),
            dist=self.dist_m,
            network_type=mode,
            simplify=True
        )

        G = ox.project_graph(G)  # 投影后 nearest_nodes 不需要 scikit-learn。 先投影再算距离（差异是什么）
        G = ox_distance.add_edge_lengths(G)

        ox.save_graphml(G, path)

        return G

    @staticmethod
    def _lonlat_to_xy(G_proj, lon, lat):
        # 把 (lon,lat) 转成图的投影坐标 (x,y)
        g = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs(G_proj.graph["crs"])
        p = g.iloc[0]
        return p.x, p.y

    @lru_cache(maxsize=200000)
    def shortest_path_km_min(self, mode: str, lon1, lat1, lon2, lat2):
        """
        返回 (dist_km, time_min)，dist 来自 OSM 路网最短路径 length（米）
        time 用 speed_kmh 换算（你也可以改成 edge travel_time）
        """
        # key：建议把 (A->B) 和 (B->A) 也统一（路网无向/基本对称时能再省一半）
        a = (round(lon1, 5), round(lat1, 5))
        b = (round(lon2, 5), round(lat2, 5))
        key = (mode.lower(), a, b) if a <= b else (mode.lower(), b, a)

        if key in self.sp_cache:
            return self.sp_cache[key]  # (dist_km, time_min)

        G = self.G_walk_proj if mode.lower() == "walk" else self.G_bike_proj
        # G = graph.get_largest_component(G, strongly=False)

        x1, y1 = self._lonlat_to_xy(G, lon1, lat1)
        x2, y2 = self._lonlat_to_xy(G, lon2, lat2)

        u = ox.distance.nearest_nodes(G, X=x1, Y=y1)
        v = ox.distance.nearest_nodes(G, X=x2, Y=y2)

        Gu = G.to_undirected()  # 测试无向图 关注“物理可达距离”，而不是严格的单行方向约束
        dist_m = nx.shortest_path_length(Gu, u, v, weight="length")
        dist_km = dist_m / 1000.0

        speed_kmh = WALK_SPEED if mode.lower() == "walk" else RIDE_SPEED

        time_h = dist_km / speed_kmh
        time_min = time_h * 60.0

        self.sp_cache[key] = (dist_km, time_min)

        return dist_km, time_min

    def _load_sp_cache(self):
        if self.sp_cache_path.exists():
            with open(self.sp_cache_path, "rb") as f:
                self.sp_cache = pickle.load(f)
            print(f"[SP cache] Loaded {len(self.sp_cache)} entries")
        else:
            self.sp_cache = {}
            print("[SP cache] No cache found, start fresh")

    def save_sp_cache(self):
        with open(self.sp_cache_path, "wb") as f:
            pickle.dump(self.sp_cache, f)
        print(f"[SP cache] Saved {len(self.sp_cache)} entries")

