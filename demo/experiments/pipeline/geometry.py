"""
File: geometry.py
Description: The single great-circle distance calculation used across the
             demo pipeline (simulate.py, stations_real.py).
"""

import math

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance between two lat/lon points, in kilometres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance between two lat/lon points, in metres."""
    return haversine_km(lat1, lon1, lat2, lon2) * 1000
