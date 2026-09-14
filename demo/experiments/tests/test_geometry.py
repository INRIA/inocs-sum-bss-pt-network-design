"""
File: test_geometry.py
Description: Unit tests for demo.experiments.pipeline.geometry.haversine_km
             -- the single great-circle distance calculation used across the
             demo pipeline (simulate.py, stations_real.py).

Skips entirely if the pipeline.geometry module does not exist yet (it is
being extracted from simulate.py by a concurrent refactor step).
"""

import unittest

try:
    from demo.experiments.pipeline.geometry import haversine_km
    _IMPORT_ERROR = None
except ImportError as exc:  # pipeline.geometry not created yet
    _IMPORT_ERROR = exc


@unittest.skipIf(_IMPORT_ERROR is not None,
                 f"demo.experiments.pipeline.geometry not available yet: {_IMPORT_ERROR}")
class HaversineKmTests(unittest.TestCase):

    def test_same_point_is_zero(self):
        self.assertEqual(haversine_km(46.2, 6.15, 46.2, 6.15), 0.0)

    def test_one_hundredth_degree_latitude(self):
        # 0.01 degree of latitude is very close to 1.1119 km everywhere
        # (latitude degrees are ~equal-length great circles); allow 1 m.
        d = haversine_km(46.20, 6.15, 46.21, 6.15)
        self.assertAlmostEqual(d, 1.1119, delta=0.001)

    def test_symmetry(self):
        pairs = [
            ((46.2044, 6.1432), (46.2100, 6.1500)),
            ((46.1950, 6.1400), (46.2200, 6.1600)),
            ((46.21, 6.10), (46.19, 6.20)),
        ]
        for (lat1, lon1), (lat2, lon2) in pairs:
            with self.subTest(a=(lat1, lon1), b=(lat2, lon2)):
                self.assertAlmostEqual(
                    haversine_km(lat1, lon1, lat2, lon2),
                    haversine_km(lat2, lon2, lat1, lon1),
                    places=9)

    def test_known_short_distance(self):
        # Roughly 300 m apart in central Geneva -- sanity range check, not
        # a hand-derived exact value.
        d = haversine_km(46.2044, 6.1432, 46.2070, 6.1432)
        self.assertGreater(d, 0.25)
        self.assertLess(d, 0.35)


if __name__ == "__main__":
    unittest.main()
