"""
File: runner.py
Location: sdk-builder/sum_network_design_bss/ -- deliberately outside
network-design-bss/src/, which is frozen.
Description: One object that drives a complete run of the bike-sharing network
             design model, from the GeoJSON inputs to the selected stations.

The frozen model has no single entry point that a caller can drive: `main.py`
wires the stages together but also runs verification, reporting and plotting,
and every stage reads module-level constants that only exist once
`compat.bootstrap()` has run. This class is that entry point.

    from sum_network_design_bss import NetworkDesignRun

    run = NetworkDesignRun().execute()
    print(run.metrics["n_selected_stations"], run.metrics["covered_od_ratio"])
    for station in run.stations:
        print(station["station"], station["capacity"])

Or from a shell:

    python -m sum_network_design_bss --solve-mode integrated

Each stage is also a public method, so a notebook can stop between any two of
them and look at what the previous one produced -- which is what
`gva_demo.ipynb` does, section by section. `execute()` simply calls them in
order.

Nothing here reimplements the model. Every stage calls the frozen code with the
arguments `main.main_run_single_instance` gives it, and the results are the same
ones that function produces.
"""

import argparse
import shutil
import sys
import time
from pathlib import Path

from .compat import bootstrap

#: Solve modes the frozen code implements. "benders" and "alns" are declared by
#: `model/sequential_optimization.py` but their modules are absent from the
#: repository, so selecting one fails with a message saying so rather than
#: silently doing something else.
SOLVE_MODES = ("integrated", "sequential", "benders", "alns")

#: Reporting metrics lifted out of the `experiment_results.csv` row, in the
#: order they are worth reading. Anything else the row carries is still
#: available in full through `NetworkDesignRun.experiment_row`.
HEADLINE_METRICS = (
    "n_candidates", "n_selected_stations", "n_reg_station", "n_trans_station",
    "avg_capacity_reg", "avg_capacity_trans", "fill_ratio_reg", "fill_ratio_trans",
    "covered_od_ratio", "total_time_gain", "average_time_gain",
    "flow_bike_only", "flow_bike_pt", "dispatch_count", "obj_val",
)


class NetworkDesignRun:
    """A single run of the model, stage by stage.

    :param work_dir: run against a private copy of the model placed here rather
                     than in place. Required when running from the installed
                     wheel; leave as None in a checkout of this repository.
    :param solve_mode: one of :data:`SOLVE_MODES`.
    :param epsilon: penalty weight on dispatch cost. None takes `EPSILON` from
                    the frozen `util/util.py`.
    :param rebuild_od: regenerate `od.csv` from `bike_trips.geojson` before
                       building the instance. Off by default: the committed
                       sample already ships one, and rebuilding it needs the
                       trips file, which a custom input set may not carry.
    :param verbose: print stage timings and shapes as the run progresses.
    """

    def __init__(self, work_dir=None, solve_mode="integrated", epsilon=None,
                 rebuild_od=False, verbose=True):
        if solve_mode not in SOLVE_MODES:
            raise ValueError(
                f"solve_mode must be one of {SOLVE_MODES}, not {solve_mode!r}")

        self.solve_mode = solve_mode
        self.rebuild_od = rebuild_od
        self.verbose = verbose

        #: The model tree this run reads and writes. Set by bootstrap().
        self.package = bootstrap(work_dir=work_dir)

        # Safe only now: 29 of the frozen modules do `from util.util import *`,
        # which copies module-level constants at import time.
        from util.util import EPSILON, h3_version

        self.epsilon = EPSILON if epsilon is None else epsilon
        self.h3_version = h3_version

        self.instance = None
        self.config_name = None
        self.demand_generator = None
        self.grid_generator = None
        self.public_transport = None
        self.station_layout = None
        self.network = None
        self.shortest_path_solver = None
        self.model = None
        self.experiment_row = None

    # -- inputs --------------------------------------------------------------

    @property
    def geojson_dir(self):
        """Directory the frozen code reads its inputs from.

        Which subdirectory is fixed by `h3_version` in the frozen
        `util/util.py`, so input files have to be named to match it rather than
        the other way round.

        :return: path of `<model>/data/geojson/<h3_version>/`.
        """
        return self.package / "data" / "geojson" / self.h3_version

    @property
    def output_dir(self):
        """Directory a solve writes its result GeoJSON into.

        :return: path of `<model>/data/output/geojson/`.
        """
        return self.package / "data" / "output" / "geojson"

    def check_inputs(self):
        """Fail early, and by name, on a missing input file.

        Without this the first missing file surfaces deep inside the frozen
        code as a bare `FileNotFoundError` on a path relative to the working
        directory, which is not the directory the caller started in.

        :return: the input directory.
        :raises FileNotFoundError: if the directory or any required file is absent.
        """
        required = ["grid.geojson", "stops.geojson", "itineraries.geojson"]
        if not self.rebuild_od:
            required.append("od.csv")
        else:
            required.append("bike_trips.geojson")

        if not self.geojson_dir.is_dir():
            raise FileNotFoundError(
                f"No input directory at {self.geojson_dir}. It is named after "
                f"h3_version in the frozen util/util.py (currently "
                f"{self.h3_version!r}).")

        missing = [name for name in required if not (self.geojson_dir / name).is_file()]
        if missing:
            raise FileNotFoundError(
                f"{self.geojson_dir} is missing {', '.join(missing)}. The "
                f"GeoJSON inputs come from the inocs-sum-gtfs-geojson package; "
                f"od.csv is derived from bike_trips.geojson by "
                f"demo.od_builder.build_od_from_trips().")

        return self.geojson_dir

    def build_od(self):
        """Rebuild `od.csv` from the observed bike trips.

        :return: path of the CSV written.
        """
        from .od_builder import build_od_from_trips
        return build_od_from_trips(str(self.geojson_dir))

    # -- stages --------------------------------------------------------------

    def build_instance(self):
        """Assemble the scenario the model solves.

        Loads the grid, the public transport lines and stops, derives the
        candidate stations, reads the OD table and splits it into time periods.
        The scenario itself -- budget, demand split, seed -- is defined inline in
        the frozen `instance_builder.generate_h3_instances`.

        :return: the InstanceGenerator, also serialised to `h3_instances_json/`.
        """
        self.check_inputs()
        if self.rebuild_od:
            self.build_od()

        from instance_builder import generate_h3_instances

        started = time.time()
        self.instance = generate_h3_instances()
        self._log(f"instance built in {time.time() - started:.0f} s: "
                  f"{len(self.instance.grid_generator.grid_centers)} zones, "
                  f"{len(self.instance.all_stations)} candidate stations, "
                  f"{len(self.instance.od_demand)} demand entries")
        return self.instance

    def build_network(self):
        """Build the multimodal network and enumerate the shortest paths.

        Draws walk, bike and public transport arcs over the OSM street network,
        then enumerates `NUM_SHORTEST_PATHS` paths per origin-destination pair.
        This is the expensive stage on a cold run -- most of the wall clock of a
        first run is here -- and it is cached under `osm_cache/` and
        `data/shortest_paths_result/`, so a repeat run skips it.

        :return: (network, shortest path solver).
        """
        if self.instance is None:
            self.build_instance()

        from input_handler.instance_attribute_extracter import get_instance_attribute
        from main import get_shortest_path_solver

        started = time.time()
        (self.config_name, self.demand_generator, self.grid_generator,
         self.public_transport, self.station_layout) = \
            get_instance_attribute(self.instance)

        self.network, self.shortest_path_solver = get_shortest_path_solver(
            self.grid_generator, self.public_transport, self.station_layout)

        self._log(f"network built in {time.time() - started:.0f} s: "
                  f"{self.network.graph.number_of_nodes()} nodes, "
                  f"{self.network.graph.number_of_edges()} arcs")
        return self.network, self.shortest_path_solver

    def solve(self):
        """Solve the design problem.

        `"integrated"` solves the whole mixed-integer program in one shot,
        giving the exact optimum: which stations to build, how large each one
        is, and how many bikes it holds in each period, all decided together.
        `"sequential"` fixes the design first, then optimises operations on it.

        Needs a Gurobi licence large enough for the instance. The licence
        bundled with `gurobipy` stops at 2000 variables and 2000 constraints,
        which the Geneva sample exceeds; academic licences are free.

        :return: the solved BikeSharingModel.
        """
        if self.network is None:
            self.build_network()

        from model.sequential_optimization import optimization_model_solver

        started = time.time()
        try:
            self.model = optimization_model_solver(
                self.demand_generator, self.epsilon, self.network,
                self.shortest_path_solver, solve_mode=self.solve_mode)
        except Exception as error:
            # Gurobi reports a missing licence from deep inside the frozen
            # code, after the expensive stages have already run. Saying so here
            # saves the next person the traceback.
            if "size-limited license" in str(error):
                raise RuntimeError(
                    "This instance is too large for the size-limited licence "
                    "bundled with gurobipy (2000 variables / 2000 constraints). "
                    "Academic licences are free: https://www.gurobi.com/academia/"
                ) from error
            raise

        gurobi_model = self.model.model
        self._log(f"solved in {time.time() - started:.0f} s: "
                  f"status {gurobi_model.Status} (2 = optimal), "
                  f"objective {gurobi_model.ObjVal:.2f}, "
                  f"{gurobi_model.NumVars} variables, "
                  f"{gurobi_model.NumConstrs} constraints")
        return self.model

    def report(self):
        """Compute the reporting metrics and append them to the results file.

        Constructing `ExperimentHandler` is what does the work: its `__init__`
        calls `record()` and `save()`, so the row is on disk in
        `experiment_results.csv` by the time it returns.

        :return: the metrics row, as a dict.
        """
        if self.model is None:
            self.solve()

        from output_handler.experiment import ExperimentHandler

        experiment = ExperimentHandler(self.model, self.network, self.config_name)
        self.experiment_row = dict(experiment.last_row)
        return self.experiment_row

    def execute(self):
        """Run every stage in order.

        :return: self, so the results can be read straight off the call.
        """
        self.build_instance()
        self.build_network()
        self.solve()
        self.report()
        return self

    # -- results -------------------------------------------------------------

    @property
    def metrics(self):
        """The headline reporting metrics.

        :return: dict of :data:`HEADLINE_METRICS` present in the results row.
        :raises RuntimeError: if the run has not reached report() yet.
        """
        if self.experiment_row is None:
            raise RuntimeError("No metrics yet: call report() or execute() first.")
        return {key: self.experiment_row[key]
                for key in HEADLINE_METRICS if key in self.experiment_row}

    @property
    def stations(self):
        """The stations the solve selected.

        Reads the three design variables the model exposes per candidate
        station: `y` (built or not), `w` (capacity in bikes) and `v1` (bikes
        stocked at the start of the first period).

        :return: list of dicts, largest capacity first.
        :raises RuntimeError: if the run has not been solved yet.
        """
        if self.model is None:
            raise RuntimeError("Nothing solved yet: call solve() or execute() first.")

        design = self.model.get_design_solution()
        selected = [
            {
                "station": getattr(node, "node_id", str(node)),
                "type": getattr(node, "type", type(node).__name__),
                "lon": node.coordinate[0],
                "lat": node.coordinate[1],
                "capacity": round(design["w"][node], 1),
                "initial_bikes": round(design["v1"][node], 1),
            }
            for node, built in design["y"].items() if built > 0.5
        ]
        return sorted(selected, key=lambda s: -s["capacity"])

    def stations_frame(self):
        """The same table as :attr:`stations`, as a pandas DataFrame.

        Kept separate so that importing this module never requires pandas.

        :return: DataFrame of the selected stations.
        """
        import pandas as pd
        return pd.DataFrame(self.stations)

    def latest_geojson(self):
        """The GeoJSON of selected stations the last solve wrote.

        :return: path of the most recent file in `data/output/geojson/`, or
                 None if the solve wrote none.
        """
        if not self.output_dir.is_dir():
            return None
        written = sorted(self.output_dir.glob("*.geojson"),
                         key=lambda p: p.stat().st_mtime)
        return written[-1] if written else None

    def export(self, destination, name="bike_stations.geojson"):
        """Copy the result GeoJSON somewhere useful.

        `demo/frontend/` renders exactly this file, so pointing this at
        `demo/frontend/data/simulations/<name>/` is how a run reaches the map.

        :param destination: directory to write into; created if absent.
        :param name: file name to write under.
        :return: path written.
        :raises FileNotFoundError: if the solve produced no GeoJSON.
        """
        source = self.latest_geojson()
        if source is None:
            raise FileNotFoundError(
                f"No result GeoJSON in {self.output_dir}. Run solve() first.")

        destination = Path(destination).expanduser().resolve()
        destination.mkdir(parents=True, exist_ok=True)
        target = destination / name
        shutil.copyfile(source, target)
        self._log(f"exported {source.name} -> {target}")
        return target

    # -- internals -----------------------------------------------------------

    def _log(self, message):
        if self.verbose:
            print(f"[network-design-bss] {message}", flush=True)


def run_design(**kwargs):
    """Run the whole pipeline in one call.

    :param kwargs: passed to :class:`NetworkDesignRun`.
    :return: the completed run.
    """
    return NetworkDesignRun(**kwargs).execute()


def main(argv=None):
    """Command line entry point: `python -m sum_network_design_bss`.

    :param argv: argument list, defaulting to sys.argv[1:].
    :return: process exit status.
    """
    parser = argparse.ArgumentParser(
        # Same module path in a checkout and from the installed wheel -- which
        # also exposes the console script `sum-network-design-bss`.
        prog=f"python -m {__package__}",
        description="Run the bike-sharing network design model end to end.")
    parser.add_argument("--work-dir", default=None,
                        help="run against a copy of the model placed here "
                             "(required when running from the installed wheel)")
    parser.add_argument("--solve-mode", default="integrated", choices=SOLVE_MODES,
                        help="how the design problem is solved (default: integrated)")
    parser.add_argument("--epsilon", type=float, default=None,
                        help="penalty weight on dispatch cost "
                             "(default: EPSILON from the frozen util/util.py)")
    parser.add_argument("--rebuild-od", action="store_true",
                        help="regenerate od.csv from bike_trips.geojson first")
    parser.add_argument("--export", default=None, metavar="DIR",
                        help="copy the resulting station GeoJSON into DIR")
    parser.add_argument("--quiet", action="store_true", help="suppress stage logs")
    args = parser.parse_args(argv)

    run = run_design(work_dir=args.work_dir, solve_mode=args.solve_mode,
                     epsilon=args.epsilon, rebuild_od=args.rebuild_od,
                     verbose=not args.quiet)

    print()
    for key, value in run.metrics.items():
        print(f"{key:<24} {value}")

    stations = run.stations
    print(f"\n{len(stations)} stations selected, "
          f"{sum(s['capacity'] for s in stations):.0f} bikes of capacity")

    if args.export:
        run.export(args.export)

    return 0


if __name__ == "__main__":
    sys.exit(main())
