import json
from shapely.ops import unary_union
from shapely.geometry import shape
import h3
import os


def load_geojson(filename):
    # base_dir = os.getcwd()
    # 获取当前文件所在路径（假设这个脚本在 project/config 里）
    current_file_path = os.path.abspath(__file__)
    # 获取项目根路径（假设项目结构固定，回退两级）
    project_root = os.path.dirname(os.path.dirname(current_file_path))
    path = os.path.join(project_root, "data", "geojson", "geneva_1km-radius", filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


if __name__ == '__main__':
    geojson_data = load_geojson("grid.geojson")
    valid_polygons = [
        f for f in geojson_data["features"]
        if f["geometry"]["type"] == "Polygon" and shape(f["geometry"]).is_valid
    ]
    print(f"Number of grid cells: {len(valid_polygons)}")
    num_grids = len(geojson_data["features"])
    print(f"Number of grid cells: {num_grids}")

    # 查看整个 grid 的覆盖范围
    polygons = [shape(feature["geometry"]) for feature in geojson_data["features"]]
    grid_union = unary_union(polygons)
    overall_bounds = grid_union.bounds  # (min_lon, min_lat, max_lon, max_lat)
    print("Overall grid coverage:", overall_bounds)



    # 从 center 得到 h3_id
    lat, lon = 46.198287979999996, 6.14864527
    res = 9  # 假设你使用了 resolution 9
    # 可以用 H3 库反推
    h3_id = h3.geo_to_h3(lat, lon, res)
