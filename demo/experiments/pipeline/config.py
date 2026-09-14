"""
File: config.py
Description: Load kpi_config.json and complete it with the frozen model's
             own unit costs, read live from network-design-bss/src/, so the
             two can never silently drift apart.

kpi_config.json used to carry a hand-copied duplicate of the model's cost
constants (station/dock/bike/dispatch/rebalancing unit costs). Copies rot;
this module removes the duplication by importing `CostParameters` from
network-design-bss/src/util/cost.py at load time and filling the
corresponding kpi_config keys from it. If the upstream module cannot be
imported, loading fails loudly rather than silently falling back to stale
copied numbers.
"""

import json
import sys
from pathlib import Path

from .. import REPO_ROOT

#: kpi_config.json keys that used to hold copies of the model's unit costs.
_COPIED_COST_KEYS = ("station_setup_cost_eur", "dock_cost_eur", "unit_bike_cost_eur")
_COPIED_REBALANCING_KEYS = ("dispatch_fixed_cost_eur", "unit_cost_eur_per_bike_km")

_DUPLICATE_KEY_MESSAGE = (
    "kpi_config.json still has {key!r}: unit costs are read from "
    "network-design-bss/src/util/cost.py, remove the key")


def _ensure_src_on_path():
    src_dir = REPO_ROOT / "network-design-bss" / "src"
    if str(src_dir) not in sys.path:
        sys.path.insert(0, str(src_dir))


def _load_cost_parameters():
    _ensure_src_on_path()
    try:
        from util.cost import CostParameters
    except ImportError as exc:
        raise RuntimeError(
            "could not import CostParameters from "
            "network-design-bss/src/util/cost.py -- the demo's unit costs "
            "are read live from the frozen model and cannot silently fall "
            "back to copied numbers") from exc
    return CostParameters()


def _check_sums_to_one(values, name):
    total = sum(v for k, v in values.items() if not k.startswith("_"))
    if abs(total - 1.0) > 1e-6:
        raise ValueError(f"{name} values must sum to 1, got {total}")


def load_kpi_config(path=None):
    """Read kpi_config.json, completed with the model's live unit costs.

    :param path: kpi_config.json path; defaults to the one next to
                demo/experiments/.
    :return: the config dict, with `costs`/`rebalancing` unit costs filled
             from `network-design-bss/src/util/cost.py::CostParameters` and
             `_model_constants_source` recording where from.
    """
    path = path or Path(__file__).resolve().parent.parent / "kpi_config.json"
    with open(path, encoding="utf-8") as f:
        config = json.load(f)

    costs = config.setdefault("costs", {})
    rebalancing = config.setdefault("rebalancing", {})
    for key in _COPIED_COST_KEYS:
        if key in costs:
            raise ValueError(_DUPLICATE_KEY_MESSAGE.format(key=key))
    for key in _COPIED_REBALANCING_KEYS:
        if key in rebalancing:
            raise ValueError(_DUPLICATE_KEY_MESSAGE.format(key=key))

    cost_parameters = _load_cost_parameters()
    costs["station_setup_cost_eur"] = cost_parameters.station_setup_cost
    costs["dock_cost_eur"] = cost_parameters.dock_cost
    costs["unit_bike_cost_eur"] = cost_parameters.unit_bike_cost
    rebalancing["dispatch_fixed_cost_eur"] = cost_parameters.dispatch_fixed_cost
    rebalancing["unit_cost_eur_per_bike_km"] = cost_parameters.rebalancing_unit_cost
    config["_model_constants_source"] = \
        "network-design-bss/src/util/cost.py::CostParameters"

    _check_sums_to_one(config.get("mode_substitution", {}), "mode_substitution")
    _check_sums_to_one(config.get("unserved_fallback", {}), "unserved_fallback")

    return config
