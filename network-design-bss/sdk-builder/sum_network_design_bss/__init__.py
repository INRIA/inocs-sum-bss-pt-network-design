"""Runnable layer over the frozen `network-design-bss` optimisation model.

`network-design-bss/` is Zhenyu WU's model, imported with its full history and
treated as read-only so that its results stay attributable to the code as
submitted. This package is everything needed to *run* it: the compatibility
shims, the origin-destination table builder, and a driver that walks the
pipeline from GeoJSON inputs to selected stations.

    from sum_network_design_bss import NetworkDesignRun

    run = NetworkDesignRun().execute()
    run.metrics
    run.stations

The same code ships as the `sum_network_design_bss` wheel built by
`build_package.py`, which bundles the model tree alongside it, so the import
is identical in a checkout and from the installed wheel. The installed copy
just needs a directory to work in:

    run = NetworkDesignRun(work_dir="./bss-run").execute()

| Module | Role |
| --- | --- |
| `compat` | `bootstrap()` — locates the model, prepares the process, patches four defects in the frozen code at runtime. |
| `runner` | `NetworkDesignRun` — the pipeline, one method per stage. |
| `od_builder` | Builds `od.csv` from observed bike trips by point-in-polygon assignment to grid zones. |

`sync_requirements.py` sits one level up (in `sdk-builder/`) and is not part
of the wheel: it keeps the root `Pipfile` in step with the model's
`requirements.txt`, and has nothing to do at run time.
"""

__version__ = "0.2.0"

from .compat import bootstrap, locate_model  # noqa: F401
from .od_builder import build_od_from_trips  # noqa: F401
from .runner import NetworkDesignRun, run_design  # noqa: F401

__all__ = [
    "__version__",
    "bootstrap",
    "locate_model",
    "build_od_from_trips",
    "NetworkDesignRun",
    "run_design",
]
