"""
File: _helpers.py
Description: Small shared utilities for the demo pipeline's test suite --
             path constants, JSON loading, and a readable structural diff.

Not a test module itself (no "test_" prefix), so unittest discovery and
pytest both skip collecting it as a test file, but the other test modules
import it directly.
"""

import json
from pathlib import Path

#: Repository root -- three parents up from this file
#: (demo/experiments/tests/_helpers.py).
REPO_ROOT = Path(__file__).resolve().parents[3]

#: demo/experiments/results -- the committed simulation/evaluation outputs.
RESULTS = Path(__file__).resolve().parents[1] / "results"

#: demo/experiments/data -- the committed calibration/profile artefacts.
DATA = Path(__file__).resolve().parents[1] / "data"

#: demo/experiments/scenarios -- the scenario definitions (S*.json).
SCENARIOS = Path(__file__).resolve().parents[1] / "scenarios"

#: Keys that hold absolute filesystem paths and therefore differ between a
#: freshly-built artefact (written to a tempfile) and the committed one
#: (written on whoever's machine produced it). Stripped before comparison.
_PATH_KEYS = {"source", "demand_source"}


def load_json(path):
    """Read and parse a JSON file."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def strip_paths(obj):
    """Recursively remove keys named "source" or "demand_source" from dicts
    (they hold absolute paths that differ machine to machine). Lists are
    walked; other values are returned unchanged. Does not mutate ``obj``.
    """
    if isinstance(obj, dict):
        return {k: strip_paths(v) for k, v in obj.items() if k not in _PATH_KEYS}
    if isinstance(obj, list):
        return [strip_paths(v) for v in obj]
    return obj


def _first_diff_path(a, b, path=()):
    """Return (path, a_value, b_value) for the first differing key/index, or
    None if ``a == b``. ``path`` is a tuple of keys/indices for the readable
    message.
    """
    if a == b:
        return None
    if isinstance(a, dict) and isinstance(b, dict):
        for key in sorted(set(a) | set(b)):
            if key not in a:
                return path + (key,), "<missing>", b[key]
            if key not in b:
                return path + (key,), a[key], "<missing>"
            sub = _first_diff_path(a[key], b[key], path + (key,))
            if sub is not None:
                return sub
        return None  # equal dicts but a == b already caught this
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return path + ("<len>",), len(a), len(b)
        for i, (av, bv) in enumerate(zip(a, b)):
            sub = _first_diff_path(av, bv, path + (i,))
            if sub is not None:
                return sub
        return None
    return path, a, b


def assert_json_equal(testcase, a, b, msg=""):
    """Assert two parsed-JSON structures are equal, failing with the first
    differing key path and its two values when they are not.

    :param testcase: the ``unittest.TestCase`` instance (for ``.fail``).
    :param a: the "actual" structure (e.g. freshly computed).
    :param b: the "expected" structure (e.g. the committed artefact).
    :param msg: extra context prepended to the failure message.
    """
    if a == b:
        return
    diff = _first_diff_path(a, b)
    if diff is None:
        # a != b but no scalar diff found walking dict/list structure --
        # e.g. differing types at the top level.
        testcase.fail(f"{msg}: structures differ (type mismatch at root): "
                      f"{a!r} != {b!r}")
    path, av, bv = diff
    path_str = "".join(f"[{p!r}]" for p in path)
    testcase.fail(f"{msg}: first difference at {path_str or '<root>'}: "
                  f"actual={av!r} expected={bv!r}")
