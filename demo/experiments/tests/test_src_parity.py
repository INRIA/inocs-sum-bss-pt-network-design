"""
File: test_src_parity.py
Description: Pin the values the demo mirrors from the frozen, upstream
             model in network-design-bss/src/ -- unit costs (util/cost.py)
             and a few behavioural constants + the haversine formula
             (util/util.py).

network-design-bss/src/ is synced from another repository and is never
edited here (see .specs/demo-pipeline/plan.md, "Never touch
network-design-bss/src/"). These tests exist so that a future sync which
silently renames or changes one of these constants fails loudly here,
instead of the demo quietly drifting out of parity with the model it is
supposed to mirror.

Two tiers:

  * "light" (always runs): util.cost is a plain dataclass with zero heavy
    imports, so CostParameters is always importable.
  * "heavy" (skipped when the optional geo stack -- osmnx/geopandas/h3 --
    is not installed): util.util pulls in that stack at import time.
"""

import contextlib
import os
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SRC_DIR = REPO_ROOT / "network-design-bss" / "src"


def _ensure_src_on_path():
    src = str(SRC_DIR)
    if src not in sys.path:
        sys.path.insert(0, src)


_ensure_src_on_path()

try:
    from demo.experiments.pipeline.config import load_kpi_config
    _CONFIG_IMPORT_ERROR = None
except ImportError as exc:  # pipeline.config not created yet
    _CONFIG_IMPORT_ERROR = exc

try:
    from util.cost import CostParameters
    _COST_IMPORT_ERROR = None
except ImportError as exc:  # pragma: no cover - util.cost has no heavy deps
    _COST_IMPORT_ERROR = exc


def _try_import_util_util():
    """Import util.util, tolerating both the expected ImportError (missing
    osmnx/geopandas/h3) and any exception raised by its module-level code
    reading a config file relative to the current working directory.

    :return: (module_or_none, reason_or_none) -- reason is set (and module
             is None) whenever the import could not be completed.
    """
    cwd = os.getcwd()
    try:
        import util.util as util_util
        return util_util, None
    except ImportError as exc:
        return None, f"util.util needs optional deps (osmnx/geopandas/h3): {exc}"
    except Exception as exc:  # noqa: BLE001 - module-level code, unknown failure modes
        return None, f"util.util raised on import: {exc!r}"
    finally:
        os.chdir(cwd)


_UTIL_UTIL, _UTIL_UTIL_SKIP_REASON = _try_import_util_util()


class CostFieldNamesTests(unittest.TestCase):
    """Guards against an upstream rename of the five cost fields
    demo/experiments/baseline.py and pipeline/config.py depend on by name.
    """

    def test_cost_py_still_has_the_five_fields(self):
        cost_py = SRC_DIR / "util" / "cost.py"
        self.assertTrue(cost_py.is_file(), f"missing {cost_py}")
        text = cost_py.read_text(encoding="utf-8")
        for field in ("station_setup_cost", "dock_cost", "unit_bike_cost",
                      "rebalancing_unit_cost", "dispatch_fixed_cost"):
            with self.subTest(field=field):
                self.assertIn(field, text,
                              f"CostParameters no longer defines {field!r} "
                              f"-- upstream rename in network-design-bss/src/")


@unittest.skipIf(_COST_IMPORT_ERROR is not None,
                 f"util.cost.CostParameters not importable: {_COST_IMPORT_ERROR}")
@unittest.skipIf(_CONFIG_IMPORT_ERROR is not None,
                 f"demo.experiments.pipeline.config not available yet: "
                 f"{_CONFIG_IMPORT_ERROR}")
class LightCostParityTests(unittest.TestCase):
    """Always runs: kpi_config.json's costs/rebalancing must equal the
    frozen model's CostParameters defaults.
    """

    def test_costs_match_cost_parameters(self):
        costs = load_kpi_config()["costs"]
        params = CostParameters()
        cases = [
            ("station_setup_cost_eur", "station_setup_cost"),
            ("dock_cost_eur", "dock_cost"),
            ("unit_bike_cost_eur", "unit_bike_cost"),
        ]
        for config_key, param_attr in cases:
            with self.subTest(config_key=config_key):
                self.assertEqual(costs[config_key], getattr(params, param_attr))

    def test_rebalancing_matches_cost_parameters(self):
        rebalancing = load_kpi_config()["rebalancing"]
        params = CostParameters()
        cases = [
            ("dispatch_fixed_cost_eur", "dispatch_fixed_cost"),
            ("unit_cost_eur_per_bike_km", "rebalancing_unit_cost"),
        ]
        for config_key, param_attr in cases:
            with self.subTest(config_key=config_key):
                self.assertEqual(rebalancing[config_key], getattr(params, param_attr))


@unittest.skipIf(_UTIL_UTIL is None,
                 f"util.util not importable, skipping heavy parity tests: "
                 f"{_UTIL_UTIL_SKIP_REASON}")
@unittest.skipIf(_CONFIG_IMPORT_ERROR is not None,
                 f"demo.experiments.pipeline.config not available yet: "
                 f"{_CONFIG_IMPORT_ERROR}")
class HeavyBehaviorParityTests(unittest.TestCase):
    """Requires the optional geo stack (osmnx/geopandas/h3); skipped when
    absent, as it is in this environment.
    """

    def test_walk_catchment_matches(self):
        config = load_kpi_config()
        self.assertAlmostEqual(
            config["demand"]["walk_catchment_m"],
            _UTIL_UTIL.WALK_CATCHMENT_RADIUS * 1000)

    def test_ride_speed_matches(self):
        config = load_kpi_config()
        self.assertEqual(config["demand"]["ride_speed_kmh"], _UTIL_UTIL.RIDE_SPEED)

    def test_truck_capacity_matches(self):
        config = load_kpi_config()
        self.assertEqual(config["rebalancing"]["truck_capacity_bikes"],
                         _UTIL_UTIL.CAPACITY_REBALANCING_VEHICLE)

    def test_haversine_matches_geneva_pairs(self):
        from demo.experiments.pipeline.geometry import haversine_km
        pairs = [
            ((46.2044, 6.1432), (46.2100, 6.1500)),
            ((46.1950, 6.1400), (46.2200, 6.1600)),
            ((46.21, 6.10), (46.19, 6.20)),
            ((46.2000, 6.1500), (46.2000, 6.1500)),  # same point
            ((46.1800, 6.1300), (46.2300, 6.1700)),
        ]
        for (lat1, lon1), (lat2, lon2) in pairs:
            with self.subTest(a=(lat1, lon1), b=(lat2, lon2)):
                mine = haversine_km(lat1, lon1, lat2, lon2)
                # util.haversine expects (lat, lon) tuples, in that order.
                theirs = _UTIL_UTIL.haversine((lat1, lon1), (lat2, lon2))
                self.assertAlmostEqual(mine, theirs, delta=1e-9)


if __name__ == "__main__":
    unittest.main()
