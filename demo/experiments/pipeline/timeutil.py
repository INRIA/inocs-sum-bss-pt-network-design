"""
File: timeutil.py
Description: The single UTC -> Europe/Zurich conversion used across the demo
             pipeline, and the day-type vocabulary built on top of it.

The observed trips (bike_trips.geojson, via trips.py) carry naive ISO
timestamps in `trip_started_at_utc`. The field name is trusted: timestamps
are read as UTC and converted to Europe/Zurich, which puts the weekday peaks
at 08h and 17-18h local (the commute signature) instead of the implausible
06h a naive reading gives. The same conclusion follows independently from the
PT ridership data (ridership.py), whose peaks sit at the same local hours.

trips.py and profiles.py both need this conversion; it lives here once so
the two can never drift apart.
"""

import datetime
from zoneinfo import ZoneInfo

TZ_LOCAL = ZoneInfo("Europe/Zurich")
TZ_UTC = ZoneInfo("UTC")

#: Simulator day type -> trip day type. "monday" pools all weekdays: the
#: sample (~1,650 trips) is too small to split single weekdays, and Monday
#: is a typical weekday within it.
DAY_TYPES = {"monday": "weekday", "saturday": "saturday", "sunday": "sunday"}

#: Python's Monday=0..Sunday=6 weekday index -> trip day type.
WEEKDAY_TO_DAY_TYPE = ("weekday",) * 5 + ("saturday", "sunday")

TIMEZONE_NOTE = ("naive `trip_started_at_utc` timestamps read as UTC and "
                 "converted to Europe/Zurich; validated against PT ridership "
                 "peak hours (ridership.py)")


def to_local(naive_utc_string):
    """Parse a naive (or tz-aware) ISO timestamp and return it in
    Europe/Zurich local time.

    :param naive_utc_string: ISO 8601 timestamp; if it has no tzinfo it is
                             assumed to already be UTC.
    :return: timezone-aware :class:`datetime.datetime` in Europe/Zurich.
    """
    dt = datetime.datetime.fromisoformat(naive_utc_string)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ_UTC)
    return dt.astimezone(TZ_LOCAL)


def day_type_of(dt):
    """The trip day type ("weekday", "saturday" or "sunday") of a local
    datetime, from its weekday index.
    """
    return WEEKDAY_TO_DAY_TYPE[dt.weekday()]
