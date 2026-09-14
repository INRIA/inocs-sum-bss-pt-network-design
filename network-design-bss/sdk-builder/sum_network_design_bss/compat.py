"""
File: compat.py
Description: Makes the frozen model under `network-design-bss/src/` runnable
             without modifying a single one of its source files.

`network-design-bss/src/` is Zhenyu WU's optimisation model, imported with its
full history and topped by the commit "Submitted version". It is treated as
read-only: the results it produces must stay attributable to the code as
submitted. Everything this repository needs to change lives here instead.

Call bootstrap() BEFORE importing anything from the package. Twenty-nine of its
modules do `from util.util import *`, which copies module-level constants into
their own namespace at import time, so any adjustment made afterwards would
reach some modules and not others.

Four defects in the frozen code cannot be worked around with data, and are
patched at runtime here. Each patch names the file and line it compensates for.
"""

import os
import shutil
import sys
import types
from pathlib import Path

# Directories the frozen code writes into without creating them first.
# util/util.py:152 add_plot_cwd() and util/util.py:155 save_results_to_pickle()
# both join a path and open it directly, unlike add_output_cwd() which does
# call os.makedirs. They are relative to the process working directory.
_REQUIRED_DIRS = ("plot", "data/shortest_paths_result")

# Written by the frozen code, or rebuilt from scratch on demand: never worth
# copying into a working directory.
_TRANSIENT = shutil.ignore_patterns(
    "__pycache__", "*.pyc", ".DS_Store", ".git",
    "osm_cache", "cache", "plot", "h3_instances_json", "output",
    "shortest_paths_result", "experiment_results.csv",
    "optimization_statistics_results_*.csv",
)

_bootstrapped = False


def locate_model():
    """Find the frozen model tree, wherever this layer is running from.

    Three cases, in order of precedence:

    1. ``NDBSS_MODEL_DIR`` in the environment — an explicit override, for a
       checkout of the model kept outside this repository.
    2. ``model_src/`` next to this file — the copy bundled into the wheel built
       by ``build_package.py``.
    3. ``../../src`` relative to this file — a source checkout, where this
       package lives at ``network-design-bss/sdk-builder/sum_network_design_bss/``
       beside the model at ``network-design-bss/src/``.

    :return: path of the model tree.
    """
    override = os.environ.get("NDBSS_MODEL_DIR")
    if override:
        return Path(override).expanduser().resolve()

    here = Path(__file__).resolve().parent
    bundled = here / "model_src"
    if bundled.is_dir():
        return bundled

    return here.parents[1] / "src"


def _materialise(source, target):
    """Copy the model tree into a writable working directory, once.

    An installed wheel keeps the model under ``site-packages``, which a run must
    not write into: the frozen code drops caches, plots, logs and result GeoJSON
    beside its own sources. Copying the tree — sources plus the GeoJSON inputs,
    about 1.5 MB — gives a run the same layout it has in a checkout, and leaves
    every artefact under the caller's own directory.

    :param source: the model tree found by locate_model().
    :param target: directory to copy it into.
    :return: the target path.
    """
    marker = target / ".ndbss-model"
    if marker.is_file():
        return target

    shutil.copytree(source, target, dirs_exist_ok=True, ignore=_TRANSIENT)
    marker.write_text(f"Copied from {source}\n")
    return target


PACKAGE = locate_model()


def _stub_missing_benders():
    """Satisfy the import of a module that was never committed.

    model/sequential_optimization.py:2 does

        from model.benders_optimization import BendersBikeSharingModel

    at module level, but model/benders_optimization.py is absent from the
    repository. That makes the module fail to import, which takes down the
    "integrated" and "sequential" solve modes as well -- neither of which uses
    Benders decomposition at all.

    Registering the name in sys.modules is enough: the import machinery
    consults sys.modules before it goes looking on disk, so the `from ... import`
    resolves against this stub. Constructing the class still raises, so the
    "benders" mode fails loudly rather than silently doing something wrong.
    """
    name = "model.benders_optimization"
    if name in sys.modules:
        return

    module = types.ModuleType(name)
    module.__doc__ = ("Stub installed by sum_network_design_bss/compat.py; "
                      "the real module is not in this repository.")

    class BendersBikeSharingModel:
        def __init__(self, *args, **kwargs):
            raise ModuleNotFoundError(
                "model/benders_optimization.py is not part of this repository, so "
                "solve_mode='benders' cannot run. Use 'integrated' or 'sequential'.")

    module.BendersBikeSharingModel = BendersBikeSharingModel
    sys.modules[name] = module


def _guard_edge_lengths():
    """Stop osmnx from measuring a projected graph in degrees.

    network/osmnx_network.py:48 calls add_edge_lengths() immediately after
    project_graph(). add_edge_lengths reads each node's x/y as longitude and
    latitude in degrees, so once the graph carries UTM eastings and northings
    (e.g. 280015, 5122887) it returns nonsense -- measured here at ~86 000x too
    large, the median edge going from 17.6 m to 1 512 km -- and it overwrites
    the correct lengths that graph_from_point already supplied.

    The wrapper leaves a projected graph alone when it already has lengths, and
    measures it in the plane when it does not. Geographic graphs are passed
    through to the real implementation untouched.
    """
    import networkx as nx
    from osmnx import distance as ox_distance
    from pyproj import CRS

    if getattr(ox_distance.add_edge_lengths, "_ndbss_guarded", False):
        return

    original = ox_distance.add_edge_lengths

    def add_edge_lengths(G, *args, **kwargs):
        crs = G.graph.get("crs")
        is_projected = crs is not None and not CRS.from_user_input(crs).is_geographic

        if not is_projected:
            return original(G, *args, **kwargs)

        if any("length" in d for _, _, d in G.edges(data=True)):
            # graph_from_point already measured these on the geographic
            # coordinates, and project_graph carries edge attributes over.
            return G

        # No lengths to preserve: straight-line distance in the projected CRS
        # is metres, which is what the caller wanted in the first place.
        for u, v, data in G.edges(data=True):
            if "length" not in data:
                du, dv = G.nodes[u], G.nodes[v]
                data["length"] = ((du["x"] - dv["x"]) ** 2 + (du["y"] - dv["y"]) ** 2) ** 0.5
        return G

    add_edge_lengths._ndbss_guarded = True
    ox_distance.add_edge_lengths = add_edge_lengths

    # network/osmnx_network.py:6 binds the module (`from osmnx import distance
    # as ox_distance`) rather than the function, so replacing the attribute is
    # picked up at call time. osmnx also re-exports it at the top level.
    import osmnx as ox
    if getattr(ox, "add_edge_lengths", None) is original:
        ox.add_edge_lengths = add_edge_lengths

    _ = nx  # imported to assert the dependency is present before the run starts


def _memoise_undirected_graphs():
    """Stop the street network being copied once per shortest-path query.

    network/osmnx_network.py:97 does

        Gu = G.to_undirected()

    inside shortest_path_km_min, so every cache miss rebuilds an undirected
    copy of the whole street graph before searching it. Measured on the Geneva
    walk network (25 399 nodes, 72 920 edges): 0.809 s for the copy against
    0.027 s for the Dijkstra that follows -- about 97% of the time spent
    reproducing a graph that never changes.

    The copy is deterministic and the two projected graphs are only ever read
    after NetworkBuilder.__init__ returns, so the result is memoised per graph.
    Distances and travel times are unchanged; only the redundant work goes.
    """
    from network.osmnx_network import NetworkBuilder

    if getattr(NetworkBuilder._load_or_build, "_ndbss_memoised", False):
        return

    original = NetworkBuilder._load_or_build

    def _load_or_build(self, mode, path):
        G = original(self, mode, path)

        undirected = {}
        graph_to_undirected = G.to_undirected

        def to_undirected(*args, **kwargs):
            # Only the no-argument form is memoised; anything else is a
            # different request and goes straight through.
            if args or kwargs:
                return graph_to_undirected(*args, **kwargs)
            if "graph" not in undirected:
                undirected["graph"] = graph_to_undirected()
            return undirected["graph"]

        G.to_undirected = to_undirected
        return G

    _load_or_build._ndbss_memoised = True
    NetworkBuilder._load_or_build = _load_or_build


def _restore_stdout_around_solve():
    """Stop the solver from detaching a Jupyter session from its own output.

    model/model_template.py:82-84 sends the Gurobi log to a file by rebinding
    the stream, then puts it back:

        sys.stdout = log_file
        self.model.optimize()
        sys.stdout = sys.__stdout__

    In a plain interpreter those two are the same object and the round trip is
    harmless. Inside a Jupyter kernel they are not: `sys.stdout` is ipykernel's
    capture stream, while `sys.__stdout__` is the real process stdout. So the
    restore does not undo the redirect -- it replaces the kernel's stream with
    the terminal's, permanently. Everything printed after the first solve then
    goes to the process that launched the kernel instead of into the notebook,
    which is why the solve summary and the selected-station listing came out
    empty while appearing in the nbconvert log.

    Saving the stream that was actually in place and restoring it in a finally
    block fixes the routing and leaves the log file behaviour untouched. The
    finally also covers the case the frozen code does not: an exception inside
    optimize() would otherwise leave stdout pointing at a closed file.
    """
    from model.model_template import AbstractModel

    if getattr(AbstractModel._optimize, "_ndbss_stdout_safe", False):
        return

    original = AbstractModel._optimize

    def _optimize(self, *args, **kwargs):
        saved = sys.stdout
        try:
            return original(self, *args, **kwargs)
        finally:
            sys.stdout = saved

    _optimize._ndbss_stdout_safe = True
    AbstractModel._optimize = _optimize


def bootstrap(chdir=True, work_dir=None):
    """Prepare the process to run the frozen package. Idempotent.

    The working directory has to be the package itself. The frozen code
    resolves input paths two incompatible ways, and the model tree is the only
    place they agree:

      - util/util.py:512 load_geojson() anchors on __file__, so it always reads
        <model>/data/geojson/<h3_version>/
      - input_handler/instance_generator.py:134 reads
        "data/geojson/geneva_1.5km-radius/od.csv" relative to the cwd

    Outputs (plot/, data/output/, h3_instances_json/, osm_cache/) follow the
    cwd too, so they land inside the package. In a checkout they are covered by
    network-design-bss/src/.gitignore.

    :param chdir: change the working directory to the package. Pass False only
                  if the caller has already done so.
    :param work_dir: run against a private copy of the model placed here,
                     instead of in place. Required when running from an
                     installed wheel, whose copy lives in a directory a run
                     must not write into.
    :return: the package path actually used.
    """
    global _bootstrapped, PACKAGE

    package = locate_model()
    if not package.is_dir():
        raise FileNotFoundError(
            f"Model tree not found at {package}. Point NDBSS_MODEL_DIR at a "
            f"checkout of the model (network-design-bss/src/), or install the "
            f"sum-network-design-bss wheel, which bundles one.")

    if work_dir is not None:
        package = _materialise(package, Path(work_dir).expanduser().resolve())
    elif not os.access(package, os.W_OK):
        raise PermissionError(
            f"{package} is not writable, and a run writes its caches, plots and "
            f"results next to the model. Pass work_dir=... to bootstrap() (or "
            f"--work-dir on the command line) to run against a copy.")

    PACKAGE = package

    if str(package) not in sys.path:
        sys.path.insert(0, str(package))

    if chdir and Path.cwd() != package:
        os.chdir(package)

    for relative in _REQUIRED_DIRS:
        (package / relative).mkdir(parents=True, exist_ok=True)

    _stub_missing_benders()
    _guard_edge_lengths()
    _memoise_undirected_graphs()
    _restore_stdout_around_solve()

    _bootstrapped = True
    return package
