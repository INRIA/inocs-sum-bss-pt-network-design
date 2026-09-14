"""
The decision-experience layer: scenarios, day simulation and KPI evaluation
built on top of the frozen optimisation model in network-design-bss/src/.

Maintained in this repository (demonstration side); the model itself is not
touched -- scenarios are run by adjusting its input parameters locally, as
documented in scenarios/README.md.
"""

__version__ = "0.1.0"

from pathlib import Path

#: Repository root, resolved from this file (demo/experiments/__init__.py).
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The demonstration's own copy of the Geneva 1.5 km data: the model's input
#: sample plus the real observed layers (GBFS stations + capacities, PT
#: ridership). The layer reads only from here, never from the frozen model.
GEOJSON_DIR = Path(__file__).resolve().parent / "data" / "geneva_1.5km-radius"

#: Where scenario runs and simulation results live.
RESULTS_DIR = Path(__file__).resolve().parent / "results"

#: Where derived data (demand profiles) lives.
DATA_DIR = Path(__file__).resolve().parent / "data"
