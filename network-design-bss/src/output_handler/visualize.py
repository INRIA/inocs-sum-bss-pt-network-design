from collections import defaultdict

import contextily as cx
import numpy as np
import pyproj
from matplotlib import patches, cm
from matplotlib import pyplot as plt
from matplotlib.axes import Axes
from matplotlib.cm import ScalarMappable
from matplotlib.colors import Normalize
from pyproj import Transformer
from shapely import LineString
from shapely.geometry import Point
from result_visualization.realmap_station_viewer import plot_bike_stations_with_pt
from util.cost import CostParameters
from util.util import *
from pathlib import Path as FilePath
import matplotlib.lines as mlines


def calculate_zone_boundaries(length, width, square_size):
    """
    Calculate the boundaries of each zone in the grid.

    :param length: The number of rows in the grid.
    :param width: The number of columns in the grid.
    :param square_size: The size of each zone.
    :return: A list of zone boundaries, where each boundary is a tuple of (x_min, x_max, y_min, y_max).
    """
    boundaries = []
    for i in range(length):
        for j in range(width):
            x_min = i * square_size
            x_max = (i + 1) * square_size
            y_min = j * square_size
            y_max = (j + 1) * square_size
            boundaries.append((x_min, x_max, y_min, y_max))
    return boundaries


class Visualize:
    def __init__(self, grid_generator, pt, shortest_path_solver, demand_generator, model=None,
                 origin=None, destination=None):
        """
        :param grid: The grid (networkx graph) created by GridGenerator.
        :param routes: The routes dictionary from PublicTransport class {route_name: [stops]}.
        """
        self.grid, self.grid_centers = grid_generator.grid, grid_generator.grid_centers
        self.routes = pt.routes
        self.shortest_path_solver = shortest_path_solver
        self.origin = origin
        self.destination = destination
        self.model = model
        if H3_BASED_GRID:
            plot_bike_stations_with_pt(pt, grid_generator.grid_centers, demand_generator.demand_matrix)
            self.boundary = h3_cells_to_gdf(list(grid_generator.grid_centers.keys()))
            # self._plot_h3_on_osm(self.boundary)
            self._plot_pt_lines_on_h3_osm(self.boundary)
            self._plot_h3_partition_with_radius(self.boundary)
        else:
            self.boundary = calculate_zone_boundaries(grid_generator.length,
                                                      grid_generator.length,
                                                      grid_generator.square_size)
            self._plot_model_output(self.boundary)
        # self._plot_demand_flow(self.boundary, demand_generator)
        if self.origin and self.destination:
            self._plot_shortest_path_result(self.boundary, self.origin, self.destination)

    def _plot_demand_flow(self, boundaries, demand_generator):
        plt.figure(figsize=(10, 10))
        for x_min, x_max, y_min, y_max in boundaries:
            # 绘制边框的四条边
            plt.plot([x_min, x_max], [y_min, y_min], color="black")  # 下边
            plt.plot([x_min, x_max], [y_max, y_max], color="black")  # 上边
            plt.plot([x_min, x_min], [y_min, y_max], color="black")  # 左边
            plt.plot([x_max, x_max], [y_min, y_max], color="black")  # 右边

        for zone_id, (center_x, center_y) in self.grid_centers.items():
            plt.scatter(center_x, center_y, color="red", s=10)  # 标记中心点
            plt.text(center_x, center_y, str(zone_id), fontsize=8, ha='center', va='center')  # 添加编号

        # 3️⃣ 计算 OD 需求流量
        od_flows = {}
        for ((i, j), t), demand in demand_generator.demand_matrix.items():
            if demand > 0:
                if (i, j) in od_flows:
                    od_flows[(i, j)] += demand  # 叠加所有时间期的需求量
                else:
                    od_flows[(i, j)] = demand

        # 计算平均需求
        for key in od_flows:
            od_flows[key] /= len(self.model.T)  # 计算每条路径的平均需求

        # 4️⃣ 画弧形 OD 流量线
        ax = plt.gca()
        for (i, j), avg_demand in od_flows.items():
            if i in self.grid_centers and j in self.grid_centers:
                x_start, y_start = self.grid_centers[i]
                x_end, y_end = self.grid_centers[j]

                # 设置弧线方向，防止相反方向重叠
                rad = 0.2 if (j, i) in od_flows else -0.2

                # 计算线条宽度（需求大，线条更粗）
                min_width, max_width = 0.5, 3
                flow_width = min_width + (avg_demand / max(od_flows.values())) * (max_width - min_width)

                # 画弧形箭头
                arrow = patches.FancyArrowPatch((x_start, y_start), (x_end, y_end),
                                                connectionstyle=f"arc3,rad={rad}",
                                                arrowstyle="-|>,head_width=0.4,head_length=0.6",
                                                linewidth=flow_width,
                                                color="blue", alpha=0.7)
                ax.add_patch(arrow)
        plt.xlim(0, boundaries[-1][1])
        plt.ylim(0, boundaries[-1][1])
        plt.gca().set_aspect("equal", adjustable="box")
        plt.title("OD Demand Flow (Curved Arrows)")

        # 6️⃣ 保存图片
        output_path = add_plot_cwd(f"OD_Demand_Flow_{len(self.model.T)}_periods_{self.model.today_str}.png")
        plt.savefig(output_path, format="png", dpi=300)
        plt.show()

    def _plot_h3_on_osm(self, boundary_gdf):

        for t in range(len(self.model.T)):
            fig, ax = plt.subplots(figsize=(10, 10))

            # 投影为 Web Mercator（required by contextily）
            boundary_gdf = boundary_gdf.to_crs(epsg=3857)

            # 画 H3 边界（灰色线条）
            # boundary_gdf.boundary.plot(ax=ax, linewidth=1, edgecolor='black', alpha=0.7)   # 黑色太重
            boundary_gdf.boundary.plot(ax=ax, linewidth=0.5, edgecolor='grey', alpha=0.5)  # grey太浅  blue

            center_point = gpd.GeoSeries(
                [Point(CENTER_LON, CENTER_LAT)],
                crs="EPSG:4326"
            )

            # ------ 2. 转到 Web Mercator（米） ------
            center_point_3857 = center_point.to_crs(epsg=3857)

            # ------ 3. buffer 2000m 得到 2km 圆 ------
            circle_2km_3857 = center_point_3857.buffer(1000 * RADIUS)

            # ------ 4. 转成 GeoDataFrame 方便绘图 ------
            circle_gdf = gpd.GeoDataFrame(geometry=circle_2km_3857, crs="EPSG:3857")

            # ------ 5. 画圆（和 boundary_gdf 同 CRS） ------
            # circle_gdf.boundary.plot(
            #     ax=ax,
            #     edgecolor="red",
            #     linewidth=1.5,
            #     alpha=0.8,
            #     linestyle="--"
            # )

            # minx, miny, maxx, maxy = boundary_gdf.total_bounds
            # ax.set_xlim(minx, maxx)
            # ax.set_ylim(miny, maxy)

            # 添加 OpenStreetMap 背景图
            # cx.add_basemap(ax, source=cx.providers.OpenStreetMap.Mapnik)  # 真实地图
            cx.add_basemap(ax, source=cx.providers.CartoDB.Positron)  # 非常干净的底图

            # NEW: 画 PT 线路（routes）
            # ==========================================================
            # route_lines = []
            # route_points = []
            #
            # for route_name, stop_list in self.routes.items():
            #     # stop_list: List[TransferStation] or List[Node]
            #     coords = []
            #     for s in stop_list:
            #         if s is None:
            #             continue
            #         lonlat = getattr(s, "coordinate", None)
            #         if not lonlat or len(lonlat) != 2:
            #             continue
            #         lon, lat = lonlat  # 你这里 coordinate 看起来是 (lon, lat)
            #         coords.append((lon, lat))
            #         route_points.append({"route": route_name, "geometry": Point(lon, lat)})
            #
            #     if len(coords) >= 2:
            #         route_lines.append({"route": route_name, "geometry": LineString(coords)})
            #
            # # 线路（LineString）
            # if route_lines:
            #     routes_gdf = gpd.GeoDataFrame(route_lines, crs="EPSG:4326").to_crs(epsg=3857)
            #     # 画线：建议透明一点，不要压过底图
            #     routes_gdf.plot(ax=ax, linewidth=1.2, alpha=0.8)

            route_lines = []
            route_points = []

            # ---------- 1. 收集 geometry ----------
            for route_name, stop_list in self.routes.items():
                coords = []
                for s in stop_list:
                    if s is None:
                        continue
                    lonlat = getattr(s, "coordinate", None)
                    if not lonlat or len(lonlat) != 2:
                        continue

                    lon, lat = lonlat  # (lon, lat)
                    coords.append((lon, lat))
                    route_points.append({
                        "route": route_name,
                        "geometry": Point(lon, lat)
                    })

                if len(coords) >= 2:
                    route_lines.append({
                        "route": route_name,
                        "geometry": LineString(coords)
                    })

            # ---------- 2. 转成 GeoDataFrame ----------
            routes_gdf = gpd.GeoDataFrame(route_lines, crs="EPSG:4326").to_crs(epsg=3857)
            points_gdf = gpd.GeoDataFrame(route_points, crs="EPSG:4326").to_crs(epsg=3857)

            # ---------- 3. 颜色映射 ----------
            routes = routes_gdf["route"].unique()
            n_routes = len(routes)

            cmap = plt.colormaps["tab20"].resampled(max(n_routes, 1))
            color_map = {r: cmap(i) for i, r in enumerate(routes)}

            route_names = sorted({r["route"] for r in route_lines})
            route_color = {
                route: cmap(i)
                for i, route in enumerate(route_names)
            }

            # ---------- 4. 分线路画 ----------
            for r in routes:
                line = routes_gdf[routes_gdf["route"] == r]
                pts = points_gdf[points_gdf["route"] == r]

                color = color_map[r]

                # 线路
                line.plot(
                    ax=ax,
                    color=color,
                    linewidth=1.5,
                    alpha=0.75,
                    zorder=3
                )

                # 站点
                pts.plot(
                    ax=ax,
                    color=color,
                    markersize=20,
                    alpha=0.9,
                    zorder=4
                )

            legend_handles = [
                mlines.Line2D(
                    [], [], color=route_color[route],
                    linewidth=2,
                    label=route
                )
                for route in route_names
            ]

            ax.legend(
                handles=legend_handles,
                title="PT Lines",
                loc="center left",
                bbox_to_anchor=(1.02, 0.5),  # 右侧
                frameon=False
            )

            ax.set_axis_off()
            # plt.title("H3 Grid Partitioning of Geneva Study Area", fontsize=14)
            plt.title("Public Transport Lines in the Geneva Study Area", fontsize=14)
            plt.tight_layout()
            plt.savefig(add_plot_cwd(f"H3_Grid_withOSM_{self.model.today_str}.png"), dpi=300, bbox_inches='tight')
            # plt.show()  # 立即渲染并关闭当前的 fig 和 ax  因此返回的是一个 “失效的画布”

            self._plot_model_results_h3_newversion(t, ax=ax, show_capacity_colorbar=True)
            # self.plot_all_periods()

    def _plot_pt_lines_on_h3_osm(
            self,
            boundary_gdf,
            center_lon=CENTER_LON,
            center_lat=CENTER_LAT,
            radius_km=RADIUS,
            filename=None
    ):
        """
        Plot public transport lines over the H3-partitioned study region.

        Improvements:
        1. PT stops are clearly distinguished from PT lines.
        2. Route legend is placed outside the map and arranged in two columns.
        3. H3 boundaries are kept subtle in the background.
        """

        import geopandas as gpd
        import matplotlib.pyplot as plt
        import contextily as cx
        import matplotlib.lines as mlines
        import matplotlib.cm as cm
        from shapely.geometry import Point, LineString
        from mpl_toolkits.axes_grid1.anchored_artists import AnchoredSizeBar
        import matplotlib.font_manager as fm

        # ------------------------------------------------------------------
        # 1. Prepare CRS
        # ------------------------------------------------------------------
        if boundary_gdf.crs is None:
            boundary_gdf = boundary_gdf.set_crs(epsg=4326)

        boundary_3857 = boundary_gdf.to_crs(epsg=3857)

        center_gs = gpd.GeoSeries(
            [Point(center_lon, center_lat)],
            crs="EPSG:4326"
        ).to_crs(epsg=3857)

        center_point_3857 = center_gs.iloc[0]
        radius_m = radius_km * 1000.0

        circle_gdf = gpd.GeoDataFrame(
            geometry=center_gs.buffer(radius_m),
            crs="EPSG:3857"
        )

        # Optional: keep only H3 cells whose centroids fall inside the study radius
        hex_centroids_3857 = boundary_3857.geometry.centroid
        inside_radius = hex_centroids_3857.distance(center_point_3857) <= radius_m + 1e-6
        boundary_3857 = boundary_3857.loc[inside_radius].copy()

        # ------------------------------------------------------------------
        # 2. Collect PT route geometries
        # ------------------------------------------------------------------
        route_lines = []
        route_points = []

        for route_name, stop_list in self.routes.items():
            coords = []

            for s in stop_list:
                if s is None:
                    continue

                lonlat = getattr(s, "coordinate", None)
                if not lonlat or len(lonlat) != 2:
                    continue

                lon, lat = lonlat
                coords.append((lon, lat))

                route_points.append({
                    "route": route_name,
                    "geometry": Point(lon, lat)
                })

            if len(coords) >= 2:
                route_lines.append({
                    "route": route_name,
                    "geometry": LineString(coords)
                })

        if not route_lines:
            raise ValueError("No valid PT route lines found in self.routes.")

        routes_gdf = gpd.GeoDataFrame(route_lines, crs="EPSG:4326").to_crs(epsg=3857)
        points_gdf = gpd.GeoDataFrame(route_points, crs="EPSG:4326").to_crs(epsg=3857)

        route_names = sorted(routes_gdf["route"].unique())
        n_routes = len(route_names)

        # Use tab20; if more than 20 routes, colors will still be assigned but may repeat visually
        cmap = plt.colormaps["tab20"].resampled(max(n_routes, 1))
        color_map = {
            route: cmap(i)
            for i, route in enumerate(route_names)
        }

        # ------------------------------------------------------------------
        # 3. Figure
        # ------------------------------------------------------------------
        fig, ax = plt.subplots(figsize=(10, 8))

        # Study extent based on circle
        minx, miny, maxx, maxy = circle_gdf.total_bounds
        margin = radius_m * 0.12
        ax.set_xlim(minx - margin, maxx + margin)
        ax.set_ylim(miny - margin, maxy + margin)

        # Basemap
        cx.add_basemap(
            ax,
            source=cx.providers.CartoDB.Positron,
            attribution_size=6,
            zorder=1
        )

        # H3 boundaries: subtle background
        boundary_3857.boundary.plot(
            ax=ax,
            linewidth=0.45,
            edgecolor="grey",
            alpha=0.35,
            zorder=2
        )

        # Optional study-area boundary
        circle_gdf.boundary.plot(
            ax=ax,
            edgecolor="red",
            linewidth=1.0,
            alpha=0.55,
            linestyle="--",
            zorder=3
        )

        # ------------------------------------------------------------------
        # 4. Plot PT lines and stops
        # ------------------------------------------------------------------
        for route in route_names:
            line = routes_gdf[routes_gdf["route"] == route]
            pts = points_gdf[points_gdf["route"] == route]

            color = color_map[route]

            # PT line
            line.plot(
                ax=ax,
                color=color,
                linewidth=2.0,
                alpha=0.85,
                zorder=4
            )

            # PT stops:
            # white fill + colored edge + black outer visibility
            # This makes stops visually distinct from the lines.
            pts.plot(
                ax=ax,
                marker="o",
                facecolor="white",
                edgecolor=color,
                linewidth=1.2,
                markersize=34,
                alpha=1.0,
                zorder=5
            )

            # Small black center dot for readability in print
            pts.plot(
                ax=ax,
                marker="o",
                color="black",
                markersize=5,
                alpha=0.75,
                zorder=6
            )

        # ------------------------------------------------------------------
        # 5. Scale bar
        # ------------------------------------------------------------------
        fontprops = fm.FontProperties(size=8)

        scalebar = AnchoredSizeBar(
            ax.transData,
            500,
            "500 m",
            loc="lower left",
            pad=0.35,
            color="black",
            frameon=False,
            size_vertical=6,
            fontproperties=fontprops
        )
        ax.add_artist(scalebar)

        # ------------------------------------------------------------------
        # 6. Legends
        # ------------------------------------------------------------------
        # PT stop symbol legend
        stop_handle = mlines.Line2D(
            [], [],
            marker="o",
            linestyle="None",
            markerfacecolor="white",
            markeredgecolor="black",
            markeredgewidth=1.1,
            markersize=7,
            label="PT stop"
        )

        h3_handle = mlines.Line2D(
            [], [],
            color="grey",
            linewidth=1.0,
            alpha=0.5,
            label="H3 boundary"
        )

        # boundary_handle = mlines.Line2D(
        #     [], [],
        #     color="red",
        #     linestyle="--",
        #     linewidth=1.0,
        #     alpha=0.7,
        #     label=f"Study area boundary ({radius_km:.1f} km radius)"
        # )

        # symbol_legend = ax.legend(
        #     handles=[stop_handle, h3_handle, boundary_handle],
        #     loc="upper left",
        #     bbox_to_anchor=(1.02, 1.00),
        #     frameon=True,
        #     framealpha=0.95,
        #     fontsize=9,
        #     title="Map elements",
        #     title_fontsize=10,
        #     borderpad=0.8
        # )
        #
        # ax.add_artist(symbol_legend)

        # PT route legend
        route_handles = [
            mlines.Line2D(
                [], [],
                color=color_map[route],
                linewidth=2.4,
                label=str(route)
            )
            for route in route_names
        ]

        ax.legend(
            handles=route_handles,
            title="PT lines",
            title_fontsize=10,
            fontsize=8.5,
            loc="upper left",
            bbox_to_anchor=(1.02, 0.72),
            frameon=True,
            framealpha=0.95,
            ncol=2,
            columnspacing=1.2,
            handlelength=2.2,
            borderpad=0.8,
            labelspacing=0.55
        )

        # ------------------------------------------------------------------
        # 7. Styling and save
        # ------------------------------------------------------------------
        ax.set_title(
            "Public Transport Lines in the Geneva Study Area",
            fontsize=13
        )

        ax.set_axis_off()

        plt.tight_layout()

        if filename is None:
            filename = add_plot_cwd(
                f"PT_lines_H3_OSM_{self.model.today_str}.png"
            )

        plt.savefig(filename, dpi=300, bbox_inches="tight")
        plt.close(fig)

        return filename

    def _plot_h3_partition_with_radius_filtered(
            self,
            boundary_gdf,
            center_lon=CENTER_LON,
            center_lat=CENTER_LAT,
            radius_km=RADIUS,
            h3_resolution=9,
            filename=None,
            cell_filter="centroid",  # "centroid" or "within"
    ):
        """
        Plot H3 tessellation of the study area with:
          1) hexagon boundaries
          2) study-area circle
          3) center point
          4) hexagon centroids
          5) legend + scale bar in a right-side external panel

        Parameters
        ----------
        boundary_gdf : GeoDataFrame
            H3 polygons.
        center_lon, center_lat : float
            Study-area center in EPSG:4326.
        radius_km : float
            Study-area radius in km.
        h3_resolution : int
            H3 resolution for title/legend only.
        filename : str or None
            Output filename.
        cell_filter : str
            "centroid" -> keep cells whose centroid is inside radius
            "within"   -> keep cells fully contained in the radius
        """

        import numpy as np
        import geopandas as gpd
        import matplotlib.pyplot as plt
        import matplotlib.lines as mlines
        import contextily as cx
        from shapely.geometry import Point, LineString
        from matplotlib.gridspec import GridSpec

        # ------------------------------------------------------------
        # 1. Prepare CRS
        # ------------------------------------------------------------
        if boundary_gdf.crs is None:
            boundary_gdf = boundary_gdf.set_crs(epsg=4326)

        metric_crs = "EPSG:2056"  # Swiss projected CRS (meters)
        map_crs = "EPSG:3857"  # For OSM/CARTO basemap
        radius_m = radius_km * 1000.0

        boundary_metric = boundary_gdf.to_crs(metric_crs)

        center_gdf = gpd.GeoDataFrame(
            geometry=[Point(center_lon, center_lat)],
            crs="EPSG:4326"
        )
        center_metric = center_gdf.to_crs(metric_crs)
        center_point_metric = center_metric.geometry.iloc[0]

        # Study-area circle in metric CRS
        circle_geom_metric = center_point_metric.buffer(radius_m)
        circle_metric = gpd.GeoDataFrame(
            geometry=[circle_geom_metric],
            crs=metric_crs
        )

        # ------------------------------------------------------------
        # 2. Filter H3 cells in the SAME metric CRS
        # ------------------------------------------------------------
        if cell_filter == "centroid":
            centroids_metric_all = boundary_metric.geometry.centroid
            mask = centroids_metric_all.distance(center_point_metric) <= radius_m + 1e-9
            boundary_metric = boundary_metric.loc[mask].copy()
            centroids_metric = boundary_metric.geometry.centroid

        elif cell_filter == "within":
            mask = boundary_metric.geometry.within(circle_geom_metric)
            boundary_metric = boundary_metric.loc[mask].copy()
            centroids_metric = boundary_metric.geometry.centroid

        else:
            raise ValueError("cell_filter must be either 'centroid' or 'within'")

        centroid_metric = gpd.GeoDataFrame(
            geometry=centroids_metric,
            crs=metric_crs
        )

        # radius line in metric CRS
        cx0, cy0 = center_point_metric.x, center_point_metric.y
        radius_line_metric = gpd.GeoDataFrame(
            geometry=[LineString([(cx0, cy0), (cx0 + radius_m, cy0)])],
            crs=metric_crs
        )

        # ------------------------------------------------------------
        # 3. Convert to plotting CRS
        # ------------------------------------------------------------
        boundary_plot = boundary_metric.to_crs(map_crs)
        centroid_plot = centroid_metric.to_crs(map_crs)
        circle_plot = circle_metric.to_crs(map_crs)
        center_plot = center_gdf.to_crs(map_crs)
        radius_line_plot = radius_line_metric.to_crs(map_crs)

        center_point_plot = center_plot.geometry.iloc[0]
        radius_line = radius_line_plot.geometry.iloc[0]
        x0, y0 = radius_line.coords[0]
        x1, y1 = radius_line.coords[-1]

        # ------------------------------------------------------------
        # 4. Create figure: map axis + right info panel
        # ------------------------------------------------------------
        fig = plt.figure(figsize=(10.8, 8.0))
        gs = GridSpec(
            nrows=1, ncols=2,
            width_ratios=[4.9, 1.35],
            wspace=0.02,
            figure=fig
        )

        ax = fig.add_subplot(gs[0, 0])  # map
        info_ax = fig.add_subplot(gs[0, 1])  # external panel
        info_ax.set_axis_off()

        # ------------------------------------------------------------
        # 5. Plot map layer
        # ------------------------------------------------------------
        # basemap extent from the study circle
        minx, miny, maxx, maxy = circle_plot.total_bounds
        margin = radius_m * 0.15  # okay as rough map padding

        ax.set_xlim(minx - margin, maxx + margin)
        ax.set_ylim(miny - margin, maxy + margin)

        cx.add_basemap(
            ax,
            source=cx.providers.CartoDB.Positron,
            attribution_size=6,
            zorder=1
        )

        # hexagon boundaries
        boundary_plot.boundary.plot(
            ax=ax,
            linewidth=0.7,
            edgecolor="#4C78FF",
            alpha=0.65,
            zorder=3
        )

        # centroids (subtle)
        ax.scatter(
            centroid_plot.geometry.x,
            centroid_plot.geometry.y,
            s=8,
            c="black",
            alpha=0.28,
            linewidths=0,
            zorder=4
        )

        # study-area circle
        circle_plot.boundary.plot(
            ax=ax,
            edgecolor="red",
            linewidth=1.2,
            linestyle="--",
            alpha=0.9,
            zorder=5
        )

        # center point
        ax.scatter(
            [center_point_plot.x],
            [center_point_plot.y],
            s=36,
            c="red",
            edgecolor="white",
            linewidth=0.6,
            zorder=6
        )

        # radius line
        radius_line_plot.plot(
            ax=ax,
            color="red",
            linewidth=1.0,
            alpha=0.85,
            zorder=5
        )

        # radius label on the map
        ax.text(
            (x0 + x1) / 2,
            (y0 + y1) / 2 + 35,
            f"radius = {radius_km:.1f} km",
            color="red",
            fontsize=9,
            ha="center",
            va="bottom",
            zorder=6
        )

        # ------------------------------------------------------------
        # 6. Legend OUTSIDE the map (right panel)
        # ------------------------------------------------------------
        if cell_filter == "centroid":
            centroid_label = "Hexagon centroid\n(candidate location)"
        else:
            centroid_label = "Hexagon centroid"

        legend_handles = [
            mlines.Line2D(
                [], [], color="red", linestyle="--", linewidth=1.2,
                label=f"Study area boundary\n(radius = {radius_km:.1f} km)"
            ),
            mlines.Line2D(
                [], [], color="#4C78FF", linewidth=1.2,
                label=f"H3 hexagon boundary\n(resolution $r={h3_resolution}$)"
            ),
            mlines.Line2D(
                [], [], marker="o", color="none",
                markerfacecolor="red", markeredgecolor="white",
                markersize=7, label="Center point"
            ),
            mlines.Line2D(
                [], [], marker="o", color="none",
                markerfacecolor="black", alpha=0.28,
                markersize=5, label=centroid_label
            ),
        ]

        info_ax.legend(
            handles=legend_handles,
            loc="upper left",
            frameon=True,
            framealpha=0.95,
            fontsize=9,
            borderpad=0.8,
            labelspacing=0.9,
            handlelength=2.4
        )

        # ------------------------------------------------------------
        # 7. Scale bar in right panel (NOT inside map)
        # ------------------------------------------------------------
        # draw a simple 500 m bar in axis coordinates
        # panel coordinates: x in [0,1], y in [0,1]
        y_bar = 0.22
        x_left = 0.12
        x_right = 0.82
        x_mid = (x_left + x_right) / 2

        # main bar
        info_ax.plot(
            [x_left, x_right], [y_bar, y_bar],
            color="black", lw=3, transform=info_ax.transAxes, clip_on=False
        )
        # ticks
        for xx in [x_left, x_mid, x_right]:
            info_ax.plot(
                [xx, xx], [y_bar - 0.025, y_bar + 0.025],
                color="black", lw=1.2, transform=info_ax.transAxes, clip_on=False
            )

        info_ax.text(x_left, y_bar + 0.045, "0", ha="center", va="bottom",
                     fontsize=9, transform=info_ax.transAxes)
        info_ax.text(x_mid, y_bar + 0.045, "250", ha="center", va="bottom",
                     fontsize=9, transform=info_ax.transAxes)
        info_ax.text(x_right, y_bar + 0.045, "500 m", ha="center", va="bottom",
                     fontsize=9, transform=info_ax.transAxes)

        # optional note
        filter_note = "Selection: centroid within radius" if cell_filter == "centroid" \
            else "Selection: hexagon fully within radius"
        info_ax.text(
            0.12, 0.12,
            filter_note,
            fontsize=8.5,
            ha="left", va="center",
            transform=info_ax.transAxes
        )

        # ------------------------------------------------------------
        # 8. Styling
        # ------------------------------------------------------------
        ax.set_title(
            f"H3 Tessellation of Geneva Study Area (resolution $r={h3_resolution}$)",
            fontsize=13
        )
        ax.set_axis_off()

        if filename is None:
            filename = add_plot_cwd(
                f"H3_partition_radius_r{h3_resolution}_{cell_filter}_{self.model.today_str}.png"
            )

        plt.tight_layout()
        plt.savefig(filename, dpi=300, bbox_inches="tight")
        plt.close(fig)

        return filename

    def _plot_h3_partition_with_radius(
            self,
            boundary_gdf,
            center_lon=CENTER_LON,
            center_lat=CENTER_LAT,
            radius_km=RADIUS,
            h3_resolution=9,
            filename=None
    ):
        """
        Plot H3 tessellation of the study area with:
        1) H3 hexagon boundaries
        2) study-area radius boundary
        3) center point
        4) hexagon centroids
        5) map scale bar
        """

        import geopandas as gpd
        import matplotlib.pyplot as plt
        import contextily as cx
        import matplotlib.lines as mlines
        from shapely.geometry import Point
        from mpl_toolkits.axes_grid1.anchored_artists import AnchoredSizeBar
        import matplotlib.font_manager as fm

        # ------------------------------------------------------------------
        # 1. Prepare CRS
        # ------------------------------------------------------------------
        if boundary_gdf.crs is None:
            boundary_gdf = boundary_gdf.set_crs(epsg=4326)

        boundary_3857 = boundary_gdf.to_crs(epsg=3857)

        center_gs = gpd.GeoSeries(
            [Point(center_lon, center_lat)],
            crs="EPSG:4326"
        ).to_crs(epsg=3857)

        center_point_3857 = center_gs.iloc[0]
        center_x, center_y = center_point_3857.x, center_point_3857.y

        radius_m = radius_km * 1000.0

        circle_gdf = gpd.GeoDataFrame(
            geometry=center_gs.buffer(radius_m),
            crs="EPSG:3857"
        )

        # ------------------------------------------------------------------
        # Filter H3 cells: keep only hexagons whose centroids fall inside the study radius
        # ------------------------------------------------------------------
        hex_centroids_3857 = boundary_3857.geometry.centroid

        inside_radius = hex_centroids_3857.distance(center_point_3857) <= radius_m + 1e-6

        boundary_3857 = boundary_3857.loc[inside_radius].copy()

        # ------------------------------------------------------------------
        # 2. Figure
        # ------------------------------------------------------------------
        fig, ax = plt.subplots(figsize=(8, 8))

        # H3 hexagon boundaries
        boundary_3857.boundary.plot(
            ax=ax,
            linewidth=0.6,
            edgecolor="#4C78FF",
            alpha=0.55,
            zorder=3
        )

        # Hexagon centroids: subtle, not too visible
        centroids = boundary_3857.geometry.centroid
        ax.scatter(
            centroids.x,
            centroids.y,
            s=8,
            color="black",
            alpha=0.35,
            linewidths=0,
            zorder=4
        )

        # Study-area boundary circle
        circle_gdf.boundary.plot(
            ax=ax,
            edgecolor="red",
            linewidth=1.1,
            alpha=0.85,
            linestyle="--",
            zorder=5
        )



        # Center point
        ax.scatter(
            [center_x],
            [center_y],
            s=35,
            color="red",
            edgecolor="white",
            linewidth=0.6,
            zorder=6
        )

        # Radius line
        ax.plot(
            [center_x, center_x + radius_m],
            [center_y, center_y],
            color="red",
            linewidth=0.9,
            linestyle="-",
            alpha=0.8,
            zorder=5
        )

        ax.text(
            center_x + radius_m * 0.48,
            center_y + radius_m * 0.03,
            f"radius = {radius_km:.1f} km",
            color="red",
            fontsize=9,
            ha="center",
            va="bottom",
            zorder=6
        )

        # ------------------------------------------------------------------
        # 3. Map extent
        # ------------------------------------------------------------------
        minx, miny, maxx, maxy = circle_gdf.total_bounds
        margin = radius_m * 0.12

        ax.set_xlim(minx - margin, maxx + margin)
        ax.set_ylim(miny - margin, maxy + margin)

        # Clean OSM basemap
        cx.add_basemap(
            ax,
            source=cx.providers.CartoDB.Positron,
            attribution_size=6,
            zorder=1
        )

        # ------------------------------------------------------------------
        # 4. Scale bar
        # ------------------------------------------------------------------
        fontprops = fm.FontProperties(size=8)

        scalebar = AnchoredSizeBar(
            ax.transData,
            500,  # 500 meters
            "500 m",
            loc="lower left",
            pad=0.4,
            color="black",
            frameon=False,
            size_vertical=8,
            fontproperties=fontprops
        )
        ax.add_artist(scalebar)

        # ------------------------------------------------------------------
        # 5. Legend
        # ------------------------------------------------------------------
        legend_handles = [
            mlines.Line2D(
                [], [], color="red", linestyle="--", linewidth=1.1,
                label=f"Study area boundary"  # ({radius_km:.1f} km radius)
            ),
            mlines.Line2D(
                [], [], color="#4C78FF", linewidth=1.0,
                label=f"H3 hexagon boundary"  # (resolution $r={h3_resolution}$)
            ),
            mlines.Line2D(
                [], [], marker="o", color="none",
                markerfacecolor="red", markeredgecolor="white",
                markersize=6,
                label="Center point"
            ),
            mlines.Line2D(
                [], [], marker="o", color="none",
                markerfacecolor="black", alpha=0.35,
                markersize=4,
                label="Hexagon centroid"
            )
        ]

        ax.legend(
            handles=legend_handles,
            loc="upper right",
            frameon=True,
            framealpha=0.9,
            fontsize=8
        )

        # ------------------------------------------------------------------
        # 6. Styling and save
        # ------------------------------------------------------------------
        ax.set_title(
            f"H3 Tessellation of Geneva Study Area (resolution $r={h3_resolution}$)",
            fontsize=12
        )

        ax.set_axis_off()
        plt.tight_layout()

        if filename is None:
            filename = add_plot_cwd(
                f"H3_partition_radius_r{h3_resolution}_{self.model.today_str}.png"
            )

        plt.savefig(filename, dpi=300, bbox_inches="tight")
        plt.close(fig)

        return filename

    def plot_all_periods(self):
        num_t = len(self.model.T)
        fig, axs = plt.subplots(nrows=1, ncols=num_t, figsize=(6 * num_t, 8), constrained_layout=True)

        # 创建坐标转换器
        transformer = pyproj.Transformer.from_crs("epsg:4326", "epsg:3857", always_xy=True)

        # 统一收集站点 capacity（固定的）作为 colorbar
        station_caps = [
            self.model.w[b].X for b in self.model.B if self.model.y[b].X >= 0.5
        ]
        cap_norm = Normalize(vmin=min(station_caps), vmax=max(station_caps))
        cap_cmap = plt.cm.Blues

        # 统一收集 flow（所有周期）用于 flow colorbar
        all_flows = [
            self.model.f[arc[0], arc[1], t].X
            for arc in self.model.A_bike_network.edges
            for t in range(num_t)
            if self.model.f[arc[0], arc[1], t].X > 0
        ]
        flow_norm = Normalize(vmin=min(all_flows), vmax=max(all_flows))
        flow_cmap = plt.cm.Reds

        # 开始逐期画图
        for t in range(num_t):
            ax = axs[t]
            ax.set_title(f"Period = {t}", fontsize=14)

            # 背景地图
            self._plot_model_results_h3_newversion(ax=ax)

            # flow 和 inventory
            self._plot_bike_flow_at_period(
                t=t,
                ax=ax,
                transformer=transformer,
                flow_norm=flow_norm,
                flow_cmap=flow_cmap,
                cap_norm=cap_norm,
                cap_cmap=cap_cmap
            )

        # 右侧统一放 legend
        # Station Capacity
        cbar_ax1 = fig.add_axes([0.92, 0.35, 0.015, 0.3])
        sm1 = plt.cm.ScalarMappable(norm=cap_norm, cmap=cap_cmap)
        sm1.set_array([])
        cb1 = plt.colorbar(sm1, cax=cbar_ax1)
        cb1.set_label("Station Capacity", fontsize=12)

        # Bike Flow
        cbar_ax2 = fig.add_axes([0.96, 0.35, 0.015, 0.3])
        sm2 = plt.cm.ScalarMappable(norm=flow_norm, cmap=flow_cmap)
        sm2.set_array([])
        cb2 = plt.colorbar(sm2, cax=cbar_ax2)
        cb2.set_label("Bike Flow", fontsize=12)

        plt.show()

    def _plot_model_output(self, boundaries):
        """
        Plot the grid with zone boundaries.
        :param boundaries: A list of zone boundaries, where each boundary is a tuple of (x_min, x_max, y_min, y_max).
        """
        plt.figure(figsize=(10, 10))
        for x_min, x_max, y_min, y_max in boundaries:
            # 绘制边框的四条边
            plt.plot([x_min, x_max], [y_min, y_min], color="black")  # 下边
            plt.plot([x_min, x_max], [y_max, y_max], color="black")  # 上边
            plt.plot([x_min, x_min], [y_min, y_max], color="black")  # 左边
            plt.plot([x_max, x_max], [y_min, y_max], color="black")  # 右边

        colors = ["orange", "purple", "blue", "green", "brown"]  # 用于不同线路的颜色 超过则又循环
        for i, (route_name, stops) in enumerate(self.routes.items()):
            route_color = colors[i % len(colors)]  # 循环选择颜色
            route_coords = [stop.coordinate for stop in stops]  # 提取线路点的坐标
            x, y = zip(*route_coords)  # 分离 x 和 y 坐标
            plt.plot(x, y, '-o', label=route_name, color=route_color, markersize=2)  # 绘制线路连线
            plt.savefig(add_plot_cwd(f"Network_PT_{FIXED_LINE_POINTS_LST}.png"), dpi=300, bbox_inches='tight')

        self.plot_model_results(plt, boundaries)

    def _plot_model_results_h3_newversion(self, t, ax: Axes, show_capacity_colorbar=False, cap_norm=None,
                                          cap_cmap=None):
        """
        Overlay the model results onto the H3 grid visualization with OSM background.
        - Stations shown as colored circles based on capacity
        - Text shows initial inventory
        - Arrows show bike flows (t=0 only)
        - Colorbar shows capacity scale
        """
        transformer = Transformer.from_crs("epsg:4326", "epsg:3857", always_xy=True)

        # for t in self.model.T:  # 外部比较好，ax 无法复制，必须一个 ax 画一个 t

        station_coords = []
        station_caps = []
        station_texts = []

        # ----------- Plot stations -------------
        for bike_station in self.model.B:
            y_val = self.model.y[bike_station].X
            v_val = self.model.v[bike_station, t].X
            z_val = self.model.w[bike_station].X

            if y_val == 1:
                lon, lat = bike_station.coordinate
                x, y = transformer.transform(lon, lat)

                station_coords.append((x, y))
                station_caps.append(z_val)
                station_texts.append((x, y, v_val))  # for inventory

        station_coords = np.array(station_coords)
        station_caps = np.array(station_caps)

        norm = Normalize(vmin=0, vmax=max(station_caps))  # MIN_CAPACITY_IF_BUILT 防止为最小值时颜色太浅
        scatter = ax.scatter(
            station_coords[:, 0], station_coords[:, 1],
            c=station_caps,
            cmap='Reds',  # Reds
            norm=norm,
            s=80,
            edgecolors='black',
            linewidths=1.2
        )

        # ----------- Plot inventory text ----------
        for x, y, inv in station_texts:
            ax.text(x + 50, y + 50, f"{int(inv)}", fontsize=9,
                    ha="left", va="center", color="black")

        # ----------- Plot bike flows (t=0 only) ----------
        flow_values = []
        arrow_artists = []
        for arc in self.model.A_bike_network.edges:
            start_node, end_node = arc
            flow = self.model.f[start_node, end_node, t].X
            if flow > 0:
                lon_start, lat_start = start_node.coordinate
                lon_end, lat_end = end_node.coordinate
                x_start, y_start = transformer.transform(lon_start, lat_start)
                x_end, y_end = transformer.transform(lon_end, lat_end)

                # 直接显示 arc
                # arrow = patches.FancyArrowPatch(
                #     (x_start, y_start), (x_end, y_end),
                #     connectionstyle=f"arc3,rad=0.2",
                #     arrowstyle="-|>,head_width=0.5,head_length=0.7",
                #     linewidth=flow / 2.5,
                #     color="blue", alpha=0.6
                # )
                # ax.add_patch(arrow)

                # 添加 legend 显示 arc 的 flow 大小
                flow_values.append(flow)
                arrow_artists.append(((x_start, y_start), (x_end, y_end), flow))

        if flow_values:
            flow_norm = Normalize(vmin=min(flow_values), vmax=max(flow_values))

            for (x_start, y_start), (x_end, y_end), flow in arrow_artists:
                arrow = patches.FancyArrowPatch(
                    (x_start, y_start), (x_end, y_end),
                    connectionstyle=f"arc3,rad=0.2",
                    arrowstyle="-|>,head_width=0.5,head_length=0.7",
                    linewidth=1 + 2.5 * (flow_norm(flow)),  # linewidth scaled
                    color=plt.cm.Blues(flow_norm(flow)), alpha=0.6  # plt.cm.Blues
                )
                ax.add_patch(arrow)

            # ----------- Add colorbar for flow -------------
            flow_cbar = plt.colorbar(
                ScalarMappable(norm=flow_norm, cmap='Reds'),
                ax=ax, shrink=0.8, pad=0.02
            )
            flow_cbar.set_label(f"Bike Flow")  # (t={t})

        # ----------- Add colorbar --------------
        if show_capacity_colorbar:
            cbar = plt.colorbar(ScalarMappable(norm=norm, cmap='Blues'), ax=ax, shrink=0.8)
            cbar.set_label("Station Capacity")

        # ----------- Formatting + Save + Show ---------
        ax.set_aspect("equal", adjustable="box")
        ax.set_title(f"Bike Flow for Period {t + 1}", fontsize=14, loc='center')

        fig = ax.figure
        output_path = add_plot_cwd(
            f"Network_{self.model.today_str}_Period{t + 1}_withH3.png"
        )
        fig.savefig(output_path, format="png", dpi=300)
        # plt.show()
        plt.close(fig)

    def _plot_bike_flow_at_period(self, t, ax, transformer, flow_norm, flow_cmap, cap_norm, cap_cmap):
        flow_values = []
        arrow_artists = []

        # flow arrows
        for arc in self.model.A_bike_network.edges:
            start_node, end_node = arc
            flow = self.model.f[start_node, end_node, t].X
            if flow > 0:
                lon_start, lat_start = start_node.coordinate
                lon_end, lat_end = end_node.coordinate
                x_start, y_start = transformer.transform(lon_start, lat_start)
                x_end, y_end = transformer.transform(lon_end, lat_end)
                flow_values.append(flow)
                arrow_artists.append(((x_start, y_start), (x_end, y_end), flow))

        for (x_start, y_start), (x_end, y_end), flow in arrow_artists:
            arrow = patches.FancyArrowPatch(
                (x_start, y_start), (x_end, y_end),
                connectionstyle="arc3,rad=0.2",
                arrowstyle="-|>,head_width=0.5,head_length=0.7",
                linewidth=1 + 2.5 * flow_norm(flow),
                color=flow_cmap(flow_norm(flow)),
                alpha=0.6
            )
            ax.add_patch(arrow)

        # station markers + inventory annotation
        for b in self.model.B:
            if self.model.y[b].X >= 0.5:
                cap = self.model.w[b].X
                inventory = self.model.v[b, t].X
                lon, lat = b.coordinate
                x, y = transformer.transform(lon, lat)

                # Station marker (colored by capacity)
                ax.scatter(x, y, s=80, c=[cap_cmap(cap_norm(cap))], edgecolors='black', linewidths=1, zorder=3)

                # Inventory annotation
                ax.text(x + 10, y + 10, f"{int(inventory)}", fontsize=8, color="black", zorder=4)

    def _plot_model_results_h3(self, ax: Axes):
        """
        Overlay the model results onto the H3 grid visualization with OSM background.
        todo：问题出在 ax 是 Web Mercator 投影，但我的坐标是经纬度

        """
        transformer = Transformer.from_crs("epsg:4326", "epsg:3857", always_xy=True)
        station_capacities = {}
        for bike_station in self.model.B:
            y_val = self.model.y[bike_station].X
            v_val = self.model.v[bike_station, 0].X
            z_val = self.model.w[bike_station].X
            if y_val == 1:
                lon, lat = bike_station.coordinate
                x, y = transformer.transform(lon, lat)
                ax.scatter(x, y,
                           color="gold", s=20 * z_val, marker="*",
                           edgecolors="red", linewidth=1.5,
                           label="Selected Station")
                ax.text(x + 0.1, y + 0.1,
                        f"({int(v_val)},{int(z_val)})",
                        fontsize=10, ha="left", va="center", color="black",
                        weight="bold")
                station_capacities[bike_station.node_id] = z_val

        # Draw bike flows
        for arc in self.model.A_bike_network.edges:
            start_node, end_node = arc
            outbound_bikeflow = sum(self.model.f[start_node, end_node, t].X for t in self.model.T)
            if outbound_bikeflow > 0:
                # x_start, y_start = start_node.coordinate
                # x_end, y_end = end_node.coordinate

                lon_start, lat_start = start_node.coordinate
                lon_end, lat_end = end_node.coordinate

                x_start, y_start = transformer.transform(lon_start, lat_start)
                x_end, y_end = transformer.transform(lon_end, lat_end)
                arrow = patches.FancyArrowPatch((x_start, y_start), (x_end, y_end),
                                                connectionstyle=f"arc3,rad={0.2}",
                                                arrowstyle="-|>,head_width=0.5,head_length=0.7",
                                                linewidth=outbound_bikeflow / (3 * self.model.demand_generator.time_periods),
                                                color="red", alpha=0.7)
                ax.add_patch(arrow)

        # 设置坐标比例和标题
        # ax.set_aspect("equal", adjustable="box")
        # ax.set_title(
        #     f"Optimized Network with Demand={TOTAL_TRIPS_NUN} & Budget={CostParameters.total_budget}"
        #     f" & Shortest Paths K={self.shortest_path_solver.k}\n"
        #     f" & CAPACITY UB={CAPACITY_UB} & PENALTY={PENALTY_COEFFICIENT} & PERIOD={self.model.demand_generator.time_periods}",
        #     fontsize=12, multialignment='center')

        # fig = ax.figure
        # output_path = add_plot_cwd(
        #     f"Network_{self.model.today_str}_Size{AREA_LENGTH}_{CostParameters.total_budget}_withH3.png"
        # )
        # fig.savefig(output_path, format="png", dpi=300)
        # plt.show()

    def _plot_flows_by_period(self):
        transformer = Transformer.from_crs("epsg:4326", "epsg:3857", always_xy=True)
        for t in self.model.T:
            fig, ax = plt.subplots(figsize=(10, 10))
            flow_values = []
            arrow_artists = []

            for arc in self.model.A_bike_network.edges:
                start_node, end_node = arc
                flow = self.model.f[start_node, end_node, t].X
                if flow > 0:
                    lon_start, lat_start = start_node.coordinate
                    lon_end, lat_end = end_node.coordinate
                    x_start, y_start = transformer.transform(lon_start, lat_start)
                    x_end, y_end = transformer.transform(lon_end, lat_end)
                    flow_values.append(flow)
                    arrow_artists.append(((x_start, y_start), (x_end, y_end), flow))

            if flow_values:
                flow_norm = Normalize(vmin=min(flow_values), vmax=max(flow_values))

                for (x_start, y_start), (x_end, y_end), flow in arrow_artists:
                    arrow = patches.FancyArrowPatch(
                        (x_start, y_start), (x_end, y_end),
                        connectionstyle=f"arc3,rad=0.2",
                        arrowstyle="-|>,head_width=0.5,head_length=0.7",
                        linewidth=1 + 2.5 * (flow_norm(flow)),
                        color=plt.cm.Reds(flow_norm(flow)),
                        alpha=0.6
                    )
                    ax.add_patch(arrow)

                # 添加 colorbar
                flow_cbar = plt.colorbar(
                    ScalarMappable(norm=flow_norm, cmap="Reds"), ax=ax, shrink=0.8, pad=0.02
                )
                flow_cbar.set_label(f"Bike Flow (t={t})")

            # 你可以添加背景图层等，比如已有的 basemap
            ax.set_title(f"Bike Flow at Period t={t}")
            ax.set_aspect("equal")
            plt.tight_layout()

            # 保存图像（或展示）
            fig.savefig(f"bike_flow_t{t}.png", dpi=300)
            plt.close(fig)

    def plot_model_results(self, plt, boundaries):
        """
        Overlay the model results onto the grid visualization.
        """
        station_capacities = {}
        for bike_station in self.model.B:
            y_val = self.model.y[bike_station].X  # 获取决策变量 y[i] 的最优值
            v_val = self.model.v[bike_station, 0].X  # 获取初始阶段每个站点车辆
            z_val = self.model.w[bike_station].X  # 获取容量
            if y_val == 1:
                plt.scatter(bike_station.coordinate[0], bike_station.coordinate[1],
                            color="gold", s=20 * z_val, marker="*",
                            edgecolors="red", linewidth=1.5,
                            label="Selected Station")
                plt.text(bike_station.coordinate[0] + 0.1, bike_station.coordinate[1] + 0.1,
                         f"({int(v_val)},{int(z_val)})",
                         fontsize=10, ha="left", va="center", color="black",
                         weight="bold")
                station_capacities[bike_station.node_id] = z_val

        # display bike flow
        ax = plt.gca()
        for arc in self.model.A_bike_network.edges:
            start_node, end_node = arc
            outbound_bikeflow = sum(self.model.f[start_node, end_node, t].X for t in self.model.T)
            if outbound_bikeflow > 0:
                x_start, y_start = start_node.coordinate
                x_end, y_end = end_node.coordinate
                arrow = patches.FancyArrowPatch((x_start, y_start), (x_end, y_end),
                                                connectionstyle=f"arc3,rad={0.2}",
                                                arrowstyle="-|>,head_width=0.5,head_length=0.7",
                                                linewidth=outbound_bikeflow / (3 * self.model.demand_generator.time_periods),
                                                color="red", alpha=0.7)
                ax.add_patch(arrow)
                # **在箭头中间显示流量数值**
                # mid_x, mid_y = (x_start + x_end) / 2, (y_start + y_end) / 2
                # plt.text(mid_x, mid_y, f"{int(outbound_bikeflow)}", fontsize=9, ha="center", va="center", color="red",
                #          bbox=dict(facecolor="white", alpha=0.6, edgecolor="none"))

        # 设置图形显示范围
        total_size = boundaries[-1][1]  # Grid 的最大宽度
        plt.xlim(0, total_size)
        plt.ylim(0, total_size)
        plt.gca().set_aspect("equal", adjustable="box")
        plt.title(
            f"Optimized Network with Demand={TOTAL_TRIPS_NUN} & Budget={CostParameters.total_budget}"
            f" & Shortest Paths K={self.shortest_path_solver.k}\n"
            f" & CAPACITY UB={CAPACITY_UB} & PENALTY={PENALTY_COEFFICIENT} & PERIOD={self.model.demand_generator.time_periods}",
            multialignment='center')
        output_path = add_plot_cwd(
            f"Network_{self.model.today_str}_{CostParameters.total_budget}.png")
        plt.savefig(output_path, format="png", dpi=300)
        plt.show()

        # plot the od flow diagram that actually uses the bike
        # 创建 OD → 总流量字典（按模式区分）
        od_flow_dict = {
            "bike_only": defaultdict(float),
            "bike_pt": defaultdict(float)
        }

        # 遍历两个模式的路径流
        for mode, x_flow in [("bike_only", self.model.x_b), ("bike_pt", self.model.x_pt)]:
            for (od_pair, t, path), var in x_flow.items():
                if var.X > 0:
                    od_flow_dict[mode][od_pair] += var.X

        # node_id -> (x, y)
        node_coord = self.grid_centers

        # 设置颜色
        mode_colors = {
            "bike_only": "red",
            "bike_pt": "blue"
        }

        self.plot_od_flow_arcs(od_flow_dict, node_coord, mode_colors)

    def _plot_shortest_path_result(self, boundaries, origin, destination):
        """
        """
        shortest_paths = self.shortest_path_solver.shortest_path[(origin, destination)]

        mode_colors = {
            'Walk': 'green',
            'Bike': 'blue',
            'PT_1': 'orange',  # 可以区分不同PT线路
            'PT_2': 'purple',
            'PT': 'purple',  # 如果只有PT不分线路
        }

        plt.figure(figsize=(8, 8))
        for x_min, x_max, y_min, y_max in boundaries:
            # 绘制边框的四条边
            plt.plot([x_min, x_max], [y_min, y_min], color="black")  # 下边
            plt.plot([x_min, x_max], [y_max, y_max], color="black")  # 上边
            plt.plot([x_min, x_min], [y_min, y_max], color="black")  # 左边
            plt.plot([x_max, x_max], [y_min, y_max], color="black")  # 右边

        # for zone_id, (center_x, center_y) in self.grid_centers.items():
        #     plt.scatter(center_x, center_y, color="red", s=10)  # 标记中心点
        #     plt.text(center_x, center_y, str(zone_id), fontsize=8, ha='center', va='center')  # 添加编号
        #
        # label_arc_idx = {
        #     0: 3,  # Path 1 在第2条弧（index从0开始）
        #     1: 3,  # Path 2 在第2条弧
        #     2: 4  # Path 3 在第3条弧
        # }

        for path_idx, shortest_path in enumerate(shortest_paths):
            nodes = shortest_path.path.path  # 注意：这里假设你的 Path 有 nodes 属性，是Node对象列表
            modes = shortest_path.modes  # mode数量比node少1个

            path_labeled = False

            # 画路径
            for i in range(len(nodes) - 1):
                start_node = nodes[i]
                end_node = nodes[i + 1]
                mode = modes[i]

                start_x, start_y = start_node.coordinate
                end_x, end_y = end_node.coordinate

                color = mode_colors.get(mode, 'gray')  # mode不认识就默认gray
                plt.plot(
                    [start_x, end_x],
                    [start_y, end_y],
                    color=color,
                    linewidth=2,
                    label=mode if path_idx == 0 else None  # 只在第一条路径里加label避免重复
                )

                # if i == label_arc_idx.get(path_idx, None):
                #     mid_x = (start_x + end_x) / 2
                #     mid_y = (start_y + end_y) / 2
                #     plt.text(
                #         mid_x + 0.05,
                #         mid_y + 0.05,
                #         f"P{path_idx + 1}",
                #         fontsize=9,
                #         color="black",
                #         weight="bold"
                #     )

        colors = ["orange", "purple", "blue", "green", "brown"]  # 用于不同线路的颜色
        for i, (route_name, stops) in enumerate(self.routes.items()):
            route_color = colors[i % len(colors)]  # 循环选择颜色
            route_coords = [stop.coordinate for stop in stops]  # 提取线路点的坐标
            x, y = zip(*route_coords)  # 分离 x 和 y 坐标
            plt.plot(x, y, '--', label=route_name, color=route_color, markersize=2)

        # 避免重复图例
        handles, labels = plt.gca().get_legend_handles_labels()
        by_label = dict(zip(labels, handles))
        plt.legend(by_label.values(), by_label.keys(), title="Travel Mode",
                   # loc="center left",
                   # bbox_to_anchor=(1.02, 0.5),
                   # borderaxespad=0
                   )
        for node in [origin, destination]:
            plt.scatter(node.coordinate[0], node.coordinate[1], color="red", s=10)  # 标记中心点
            plt.text(node.coordinate[0], node.coordinate[1], str(node.node_id), fontsize=8, ha='center',
                     va='center')  # 添加编号
        plt.title(f"Shortest paths from zone {origin.node_id} to zone {destination.node_id}")
        plt.xlabel("X Coordinate")
        plt.ylabel("Y Coordinate")
        plt.grid(True)
        plt.savefig(add_plot_cwd(f"Shortest_Path_{origin.node_id}_{destination.node_id}.png"),
                    dpi=300, bbox_inches='tight')
        plt.show()

    def plot_od_flow_arcs(self, od_flows_by_mode, node_coord, mode_colors, title="Bike related OD flow"):
        fig, ax = plt.subplots(figsize=(10, 10))

        # 1. 绘制区域边框
        for x_min, x_max, y_min, y_max in self.boundary:
            ax.plot([x_min, x_max], [y_min, y_min], color="black", linewidth=1.2, linestyle='--')  # Bottom
            ax.plot([x_min, x_max], [y_max, y_max], color="black", linewidth=1.2, linestyle='--')  # Top
            ax.plot([x_min, x_min], [y_min, y_max], color="black", linewidth=1.2, linestyle='--')  # Left
            ax.plot([x_max, x_max], [y_min, y_max], color="black", linewidth=1.2, linestyle='--')  # Right

        # 2. 绘制OD路径（箭头）
        for mode, od_flows in od_flows_by_mode.items():
            color = mode_colors.get(mode, "gray")
            for (origin, destination), flow in od_flows.items():
                if flow > 0:
                    x0, y0 = node_coord[origin]
                    x1, y1 = node_coord[destination]

                    width = max(0.3, min(flow * 0.3, 2.5))
                    rad = 0.2 if x0 != x1 or y0 != y1 else 0.05  # 避免自环箭头太弯

                    arrow = patches.FancyArrowPatch(
                        (x0, y0), (x1, y1),
                        connectionstyle=f"arc3,rad={rad}",
                        arrowstyle="-|>,head_width=0.4,head_length=0.5",
                        linewidth=width,
                        color=color,
                        alpha=0.65,
                        label=mode if mode not in ax.get_legend_handles_labels()[1] else ""
                    )
                    ax.add_patch(arrow)

        # 3. 绘制节点
        for node_id, (x, y) in node_coord.items():
            ax.scatter(x, y, color='black', s=15, zorder=5)
            # 可选标签（适用于小型图）
            # ax.text(x+0.1, y+0.1, str(node_id), fontsize=8, color='gray')

        # 4. 标题与图例
        ax.set_title(f"Bike-related OD Flow\nSize={AREA_LENGTH}, Budget={CostParameters.total_budget}", fontsize=14)
        ax.set_xlabel("X", fontsize=12)
        ax.set_ylabel("Y", fontsize=12)
        ax.grid(True, linestyle='--', alpha=0.5)
        ax.legend(title="Travel Mode", loc="upper left", fontsize=10, title_fontsize=11)

        # 5. 保存图像
        filename = (f"OD_flow_Size{AREA_LENGTH}_Budget{CostParameters.total_budget}_CoverageMax{IS_MAX_COVERAGE}"
                    f"_{OD_COVERAGE_RATIO}_{self.model.today_str}.png")
        plt.savefig(add_plot_cwd(filename), dpi=300, bbox_inches='tight')
        plt.show()


def plot_h3_grid_and_stations(
        config_name: str,
        grid_generator,
        station_layout,
        output_prefix: str = "H3_Grid_with_Candidate_Stations",
):
    """
    Plot H3 grid boundary and all candidate sharing stations
    on top of an OSM basemap.

    Parameters
    ----------
    config_name : str
        Name of the current instance / config, used in figure title & filename.
    grid_generator :
        Your grid generator object. For H3 grid, it should expose a way
        to export the grid as a GeoDataFrame (see `grid_to_geodataframe` below).
    station_layout : list
        List of station objects (BikeStation / TransferStation), each having
        a `coordinate` attribute = (lon, lat).
    output_prefix : str, optional
        Prefix of the output PNG filename.
    """

    # 1) 从 grid_generator 拿到 H3 cell 边界的 GeoDataFrame（EPSG:4326）
    boundary_gdf = h3_cells_to_gdf(list(grid_generator.grid_centers.keys()))
    if boundary_gdf is None or boundary_gdf.empty:
        print("[plot] No grid boundary found, skip plotting.")
        return

    # 2) 所有潜在 sharing station -> GeoDataFrame（EPSG:4326）
    stations_gdf = gpd.GeoDataFrame(
        {
            "type": [s.__class__.__name__ for s in station_layout],
        },
        geometry=[Point(s.coordinate[0], s.coordinate[1]) for s in station_layout],
        crs="EPSG:4326",
    )

    # 3) 投影到 Web Mercator（米），以适配 contextily
    boundary_gdf_3857 = boundary_gdf.to_crs(epsg=3857)
    stations_gdf_3857 = stations_gdf.to_crs(epsg=3857)

    # 4) 正式画图
    fig, ax = plt.subplots(figsize=(10, 10))

    # H3 边界
    boundary_gdf_3857.boundary.plot(
        ax=ax,
        linewidth=0.5,
        edgecolor="blue",
        alpha=0.5,
    )

    # save_boundary(boundary_gdf, add_plot_cwd("h3_boundary.gpkg"))

    # 所有潜在 sharing station
    stations_gdf_3857.plot(
        ax=ax,
        markersize=25,
        color="orange",
        alpha=0.9,
        linewidth=0,
    )

    # OSM 背景图
    cx.add_basemap(ax, source=cx.providers.CartoDB.Positron)

    ax.set_axis_off()
    plt.title("H3 Grid with Candidate Stations\n", fontsize=14)
    plt.tight_layout()

    # 这里用你现有的 add_plot_cwd，如果没有就改为自己路径
    filename = add_plot_cwd(f"{output_prefix}.png")
    plt.savefig(filename, dpi=300, bbox_inches="tight")
    plt.close(fig)

    print(f"[plot] Figure saved to: {filename}")


def plot_h3_grid_and_pt_stops(
        config_name: str,
        grid_generator,
        public_transport,
        output_prefix: str = "H3_Grid_with_PT_Stops",
):
    """
    Plot H3 grid boundary and all public transport stops
    on top of an OSM basemap.

    Parameters
    ----------
    config_name : str
        Name of the current instance / config, used in figure title & filename.
    grid_generator :
        Grid generator object, used to extract H3 cell geometries.
    public_transport :
        PublicTransport object, with a `routes` dict mapping route_name to
        a list of stops, each having a `coordinate` attribute (lon, lat).
    output_prefix : str, optional
        Prefix of the output PNG filename.
    """

    # 1) 从 grid_generator 拿到 H3 cell 边界的 GeoDataFrame（EPSG:4326）
    boundary_gdf = h3_cells_to_gdf(list(grid_generator.grid_centers.keys()))
    if boundary_gdf is None or boundary_gdf.empty:
        print("[plot] No grid boundary found, skip plotting PT stops.")
        return

    # 2) 收集所有 PT stops（去重）
    pt_coords = []
    seen = set()
    for route_name, stops in public_transport.routes.items():
        for stop in stops:
            lon, lat = stop.coordinate  # 或者 stop.lon, stop.lat
            key = (lon, lat)
            if key in seen:
                continue
            seen.add(key)
            pt_coords.append(key)

    if not pt_coords:
        print("[plot] No PT stops found to plot.")
        return

    pt_stops_gdf = gpd.GeoDataFrame(
        geometry=[Point(lon, lat) for lon, lat in pt_coords],
        crs="EPSG:4326",
    )

    # 3) 投影到 Web Mercator（米），以适配 contextily
    boundary_gdf_3857 = boundary_gdf.to_crs(epsg=3857)
    pt_stops_gdf_3857 = pt_stops_gdf.to_crs(epsg=3857)

    # 4) 正式画图
    fig, ax = plt.subplots(figsize=(10, 10))

    # H3 边界
    boundary_gdf_3857.boundary.plot(
        ax=ax,
        linewidth=0.5,
        edgecolor="blue",
        alpha=0.5,
    )

    # PT stops
    pt_stops_gdf_3857.plot(
        ax=ax,
        markersize=20,
        color="green",
        alpha=0.9,
        linewidth=0,
    )

    # OSM 背景图
    cx.add_basemap(ax, source=cx.providers.CartoDB.Positron)

    ax.set_axis_off()
    plt.title("H3 Grid with Public Transport Stops\n", fontsize=14)
    plt.tight_layout()

    filename = add_plot_cwd(f"{output_prefix}.png")
    plt.savefig(filename, dpi=300, bbox_inches="tight")
    plt.close(fig)

    print(f"[plot] PT stops figure saved to: {filename}")


# def save_boundary(boundary_gdf: gpd.GeoDataFrame, out_path: str):
#     out_path = FilePath(out_path)
#     out_path.parent.mkdir(parents=True, exist_ok=True)
#
#     # 确保 CRS 正确
#     if boundary_gdf.crs is None:
#         boundary_gdf = boundary_gdf.set_crs("EPSG:4326")
#
#     # 给每个cell一个id（方便以后 join / debug）
#     boundary_gdf = boundary_gdf.copy()
#     if "cell_id" not in boundary_gdf.columns:
#         boundary_gdf["cell_id"] = [str(i) for i in range(len(boundary_gdf))]
#
#     # GeoPackage: 单文件、支持字段类型、非常稳
#     boundary_gdf.to_file(out_path, layer="h3_boundary", driver="GPKG")
#     print(f"[saved] {out_path}")

def save_boundary(boundary_gdf: gpd.GeoDataFrame, out_path: str):
    """
    Save H3 boundary GeoDataFrame to GeoPackage.
    """
    out_path = FilePath(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # 强制只保留 geometry，避免以后字段污染
    gdf_to_save = boundary_gdf[["cell_id", "geometry"]].copy()

    # 用 GeoPackage（稳定、推荐）
    gdf_to_save.to_file(
        out_path,
        layer="h3_boundary",
        driver="GPKG"
    )
