"""
File: test_timeutil.py
Description: Unit tests for demo.experiments.pipeline.timeutil -- the single
             UTC -> Europe/Zurich conversion and day-type mapping used
             across the calibration layer.

Skips entirely if the pipeline.timeutil module does not exist yet (it is
being extracted from trips.py/profiles.py by a concurrent refactor step).
"""

import unittest

try:
    from demo.experiments.pipeline.timeutil import day_type_of, to_local
    _IMPORT_ERROR = None
except ImportError as exc:  # pipeline.timeutil not created yet
    _IMPORT_ERROR = exc


@unittest.skipIf(_IMPORT_ERROR is not None,
                 f"demo.experiments.pipeline.timeutil not available yet: {_IMPORT_ERROR}")
class ToLocalTests(unittest.TestCase):

    def test_summer_cest_offset(self):
        # 2024-06-10T06:30:00 UTC -> 08:30 CEST (UTC+2), a weekday, hour 8.
        dt = to_local("2024-06-10T06:30:00")
        self.assertEqual(dt.hour, 8)
        self.assertEqual(dt.minute, 30)
        self.assertEqual(day_type_of(dt), "weekday")

    def test_winter_cet_offset(self):
        # 2024-11-04T06:30:00 UTC -> 07:30 CET (UTC+1), a weekday, hour 7.
        dt = to_local("2024-11-04T06:30:00")
        self.assertEqual(dt.hour, 7)
        self.assertEqual(dt.minute, 30)
        self.assertEqual(day_type_of(dt), "weekday")

    def test_dst_change_weekend(self):
        # 2024-10-27 is the CEST->CET fall-back date in Europe/Zurich.
        # Before 01:00 UTC that day, Zurich is still on CEST (UTC+2);
        # after, it is on CET (UTC+1).
        before = to_local("2024-10-27T00:30:00")
        after = to_local("2024-10-27T01:30:00")
        self.assertEqual(before.utcoffset().total_seconds(), 2 * 3600)
        self.assertEqual(after.utcoffset().total_seconds(), 1 * 3600)

    def test_accepts_tz_aware_input(self):
        # An already-aware ISO string (explicit +00:00) is treated as UTC.
        dt = to_local("2024-06-10T06:30:00+00:00")
        self.assertEqual(dt.hour, 8)


@unittest.skipIf(_IMPORT_ERROR is not None,
                 f"demo.experiments.pipeline.timeutil not available yet: {_IMPORT_ERROR}")
class DayTypeOfTests(unittest.TestCase):

    def test_weekday_saturday_sunday_mapping(self):
        cases = [
            ("2024-06-10T08:00:00", "weekday"),   # Monday
            ("2024-06-11T08:00:00", "weekday"),   # Tuesday
            ("2024-06-12T08:00:00", "weekday"),   # Wednesday
            ("2024-06-13T08:00:00", "weekday"),   # Thursday
            ("2024-06-14T08:00:00", "weekday"),   # Friday
            ("2024-06-15T08:00:00", "saturday"),
            ("2024-06-16T08:00:00", "sunday"),
        ]
        for naive_utc, expected in cases:
            with self.subTest(naive_utc=naive_utc):
                self.assertEqual(day_type_of(to_local(naive_utc)), expected)


if __name__ == "__main__":
    unittest.main()
