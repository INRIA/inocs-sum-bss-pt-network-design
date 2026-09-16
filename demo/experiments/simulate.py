"""
File: simulate.py
Description: Replay one day of bike-sharing demand against a station design,
             and record how the city behaves hour by hour.

The optimisation model answers "which stations should exist"; this simulator
answers "what happens on a given day once they do". Three demand modes, all
standard practice in bike-share operations research and documented in
METHODS.md:

    replay   trace-driven simulation: the actual recorded trips (real local
             times, real origin/destination coordinates) are replayed against
             the design. Every observed calendar day of the requested type is
             replayed and the results averaged, so the output describes the
             average observed Monday (or Sunday) with its day-to-day spread.
             Zero synthetic demand -- the "proof" mode.

    sample   Monte Carlo resampling: trips are drawn from the observed
             empirical distributions (hourly profile x OD flow shares) at a
             volume of measured-base x --scale, over --seeds independent
             seeds, reported as mean +/- spread. Volumes above scale 1 are
             explicit demand-growth hypotheses -- the "what-if" mode.

    instance the model's OWN planning day: the 1,453 trips of the solved
             instance's per-period OD demand (results/<scenario>/instance.json),
             placed at the model's cell centres, its three abstract periods
             spread over the demo's period hours by the observed weekday
             profile. This is the only mode whose numbers are comparable
             with metrics.json -- replay simulates the observed 11.5
             trips/day, ~125x smaller than the demand the designs were sized
             for (.specs/demo-pipeline/findings.md #1). Where the model's own
             artefacts are exported it uses them: routed ride arcs
             (results/shared/bike_arcs.json) for distance and time, and the
             solved plan (results/<scenario>/model_plan.json) for station
             choice and rebalancing. Where they are absent it falls back to
             the demo's approximations and says so in the `method` block.

All three modes share one engine: a rider starts at a coordinate, walks to the
nearest design station within the walk catchment (trying a couple), takes a
bike if one is there, docks it near the destination. Failures are counted by
cause -- no station nearby (coverage), no bike / no dock (capacity and
rebalancing), and, when the model's arcs are in use, no ride arc between the
two stations (the model links stations only within 1 km). At the configured
hours plus end of day, a truck round restores initial stocks at the frozen
model's own cost rates -- unless a solved rebalancing plan is available, which
is then replayed instead.

The output JSON is self-describing: a `method` block records mode, data
sources, volumes, seeds and behaviour parameters used, and a `model_view`
block restates the day the way the model's own MetricsEvaluator would
(utilisation, borrowable/returnable rates, and in instance mode the
count-based covered_od_ratio).

Units: distances km, times minutes, money EUR (matching the frozen model).

DEPRECATED (demo v3, 2026-09-15): the `sample` and `instance` modes --
`sample`, `instance_run`, `instance_trips`, `DaySimulation.draw_trips` and
the `plan` / `arcs` / `candidates` arguments of `DaySimulation`, plus the
`--mode sample|instance` CLI options -- are replaced by the model's own
solved plan, read by `evaluate.paper_kpis` from `model_plan.json`; removed
once the paper-grid runs are validated. What stays is `replay`: the observed
trips of Geneva against a design, the demonstration's stress test.
"""

import argparse
import csv
import json
import math
import random
import statistics
import warnings
from pathlib import Path

from . import GEOJSON_DIR
from .pipeline.config import load_kpi_config
from .pipeline.geometry import haversine_km
from .profiles import PERIOD_BOUNDS, load_profiles
from .trips import TIMEZONE_NOTE, load_calibration, trips_by_date

#: Local hour at which each of the model's three abstract periods starts --
#: the hour a period's rebalancing moves are applied at, and the lower bound
#: of the hours its demand is spread over. From profiles.PERIOD_BOUNDS
#: ((6, 10), (10, 16), (16, 22)); the model itself has no hour semantics
#: (findings.md #10).
PERIOD_START_HOURS = tuple(lo for lo, _ in PERIOD_BOUNDS)

#: Shared by every deprecated entry point below (demo v3, 2026-09-15).
_DEPRECATION = ("DEPRECATED (demo v3, 2026-09-15): the simulator's sample "
                "and instance modes are replaced by the model's own solved "
                "plan (model_plan.json, read by evaluate.paper_kpis); "
                "removed once the paper-grid runs are validated. Use "
                "mode 'replay' -- the observed trips -- for the stress test.")

#: A design station is matched to a model candidate site by id first; when
#: the ids differ (baseline designs rename them) the nearest candidate within
#: this distance is used, since both sit exactly on the same point.
_CANDIDATE_MATCH_KM = 0.05


def load_stations(path):
    """Read a design: the JSON dump of `NetworkDesignRun.stations`.

    :return: list of dicts with station, lon, lat, capacity, initial_bikes.
    """
    with open(path, encoding="utf-8") as f:
        stations = json.load(f)
    if isinstance(stations, dict):  # tolerate {"stations": [...]} wrappers
        stations = stations["stations"]
    for s in stations:
        s["capacity"] = int(round(s["capacity"]))
        s["initial_bikes"] = int(round(s["initial_bikes"]))
    return stations


def load_cells(grid_file=None):
    """Grid cells as {cell_id: (lat, lon)} from the layer's grid.geojson.

    The `center` property is (lat, lon); the geometry is (lon, lat). The
    property is used directly.
    """
    grid_file = grid_file or GEOJSON_DIR / "grid.geojson"
    with open(grid_file, encoding="utf-8") as f:
        grid = json.load(f)
    cells = {}
    for feature in grid["features"]:
        props = feature["properties"]
        center = props["center"]
        if isinstance(center, str):  # serialised as "(lat, lon)"
            center = [float(x) for x in center.strip("()[] ").split(",")]
        cells[props["id"]] = (float(center[0]), float(center[1]))
    return cells


def load_od_shares(od_file=None):
    """OD pairs and their relative weights from the layer's od.csv."""
    od_file = od_file or GEOJSON_DIR / "od.csv"
    pairs, weights = [], []
    with open(od_file, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pairs.append((row["origin_cell"], row["dest_cell"]))
            weights.append(float(row["flow"]))
    return pairs, weights


#: Fourth meta element of a trip whose origin or destination cell the model
#: dropped: demand the model counts but can never serve.
OUTSIDE_MODEL = "outside_model"


def instance_trips(instance, profiles, rng, cells=None, day="monday"):
    """The model's own planning day, as trips the engine can replay.

    DEPRECATED (demo v3, 2026-09-15): replaced by reading the solved plan
    directly (`evaluate.paper_kpis`); removed once the paper-grid runs are
    validated.

    Every unit of the instance's OD demand becomes one trip between the two
    cell centres. The model's periods carry no hour semantics (findings.md
    #10), so each trip's hour is drawn inside its period's local-hour window
    (``profiles.PERIOD_BOUNDS``) with the observed weekday ``hourly_share``
    restricted to those hours and renormalised -- the demand keeps the
    model's per-period totals exactly while following the real intra-period
    shape (the morning peak sits at 08h inside 06-10, not spread flat).

    :param instance: the parsed instance.json.
    :param profiles: the profiles.json dict (hourly_share per day type).
    :param rng: a seeded ``random.Random`` -- the only randomness in the mode.
    :param cells: ``{cell_id: (lat, lon)}``; defaults to the instance's own
                  cells. Demand rows touching a cell the model dropped (its
                  demand still lists 60 trips on two unbuildable cells,
                  findings.md #7) are emitted as flagged trips the engine
                  counts as demand but never serves -- exactly what the
                  model does: it enumerates paths only between its kept
                  cells, so that demand stays in its coverage denominator
                  and can never be assigned.
    :param day: which observed hourly profile shapes the intra-period draw.
    :return: ``{hour: [(o_lat, o_lon, d_lat, d_lon, meta), ...]}`` with
             ``meta = (origin_cell, dest_cell, period)``.
    """
    warnings.warn(_DEPRECATION, DeprecationWarning, stacklevel=2)
    from .pipeline.instance import cells_of, demand_of

    cells = cells_of(instance) if cells is None else cells
    hourly_share = profiles["hourly_share"][day]

    per_period = []
    for lo, hi in PERIOD_BOUNDS:
        hours = list(range(lo, hi))
        weights = [hourly_share[h] for h in hours]
        if sum(weights) <= 0:  # a profile with no observed trips in a period
            weights = [1.0] * len(hours)
        per_period.append((hours, weights))

    trips = {h: [] for h in range(24)}
    for origin, dest, period, flow in demand_of(instance):
        if flow <= 0:
            continue
        o, d = cells.get(origin), cells.get(dest)
        hours, weights = per_period[period]
        if o is None or d is None:
            meta = (origin, dest, period, OUTSIDE_MODEL)
            for hour in rng.choices(hours, weights=weights, k=flow):
                trips[hour].append((None, None, None, None, meta))
            continue
        meta = (origin, dest, period)
        for hour in rng.choices(hours, weights=weights, k=flow):
            trips[hour].append((o[0], o[1], d[0], d[1], meta))

    for hour in range(24):
        rng.shuffle(trips[hour])
    return trips


class DaySimulation:
    """One design x one day of demand -> hourly system behaviour.

    The engine is demand-agnostic: :meth:`run` takes trips as coordinate
    pairs per hour, whatever produced them (observed records or sampling).

    :param stations: the design, as :func:`load_stations` returns it.
    :param day: "monday" or "sunday" (labelling; the trips carry the demand).
    :param config: the kpi_config dict.
    :param seed: RNG seed for the sampling path; replay uses no randomness.
    :param candidates: the model's candidate sites (``candidates_of``), used
                       only to map design stations onto model arc/plan ids.
    :param plan: the solved ``model_plan.json``; when given, station choice
                 follows the model's own path assignments and rebalancing
                 replays the model's ``r``/``n`` schedule instead of the
                 greedy restore-to-initial round.
    :param arcs: the model's routed ride arcs (``load_bike_arcs``); when
                 given, a served trip's km/minutes are the model's, and a
                 station pair with no arc is unserved (the model's 1 km ride
                 limit) unless ``allow_unrouted``.
    :param allow_unrouted: keep serving trips whose station pair has no model
                           arc, falling back to haversine x detour for them.

    DEPRECATED (demo v3, 2026-09-15): the `candidates`, `plan` and `arcs`
    arguments (the model-artefact machinery of the instance mode) are
    replaced by reading `model_plan.json` directly in `evaluate.paper_kpis`;
    removed once the paper-grid runs are validated. A replay passes none of
    them and is unaffected.
    """

    def __init__(self, stations, day, config=None, profiles=None, seed=42,
                 cells=None, od=None, candidates=None, plan=None, arcs=None,
                 allow_unrouted=False):
        self.stations = stations
        self.day = day
        self.config = config or load_kpi_config()
        self.profiles = profiles or load_profiles()
        self.rng = random.Random(seed)
        self.seed = seed
        self.cells = cells or load_cells()
        self.od_pairs, self.od_weights = od or load_od_shares()

        demand_cfg = self.config["demand"]
        self.catchment_km = demand_cfg["walk_catchment_m"] / 1000.0
        self.retry = demand_cfg["station_retry_count"]
        self.detour = demand_cfg["ride_detour_factor"]
        self.speed = demand_cfg["ride_speed_kmh"]

        self._cand_cache = {}

        # -- the model's own artefacts, all optional (deprecated) ----------
        if candidates is not None or plan is not None or arcs is not None:
            warnings.warn(_DEPRECATION, DeprecationWarning, stacklevel=2)
        self.candidates = candidates
        self.plan = plan
        self.arcs = arcs
        self.allow_unrouted = allow_unrouted
        self.n_periods = len(PERIOD_BOUNDS)
        self._model_id = self._map_stations_to_model_ids()
        self._by_model_id = {}
        for idx, model_id in enumerate(self._model_id):
            self._by_model_id.setdefault(model_id, idx)
        self._assignments = self._index_assignments(plan)

    def _map_stations_to_model_ids(self):
        """Design station index -> the model's id for the same site.

        Optimiser designs already carry the candidate ids; ``baseline.py``
        prefixes them with ``baseline_``; anything else is matched on
        coordinates (both sit exactly on the candidate point). Falls back to
        the design's own id, which is correct whenever the plan/arcs were
        produced for that same design.
        """
        by_id = {c["id"]: c for c in (self.candidates or [])}
        model_ids = []
        for station in self.stations:
            name = station["station"]
            if name in by_id or not self.candidates:
                model_ids.append(name)
                continue
            stripped = name[len("baseline_"):] if name.startswith("baseline_") else None
            if stripped and stripped in by_id:
                model_ids.append(stripped)
                continue
            best, best_km = name, _CANDIDATE_MATCH_KM
            for candidate in self.candidates:
                km = haversine_km(station["lat"], station["lon"],
                                  candidate["lat"], candidate["lon"])
                if km <= best_km:
                    best, best_km = candidate["id"], km
            model_ids.append(best)
        return model_ids

    def _index_assignments(self, plan):
        """(origin, dest, period) -> the plan's station pairs, best first.

        "Best" is the model's own ranking: ``rank`` ascending, then flow
        descending -- the path the optimiser sent the most travellers along.
        """
        if not plan:
            return {}
        index = {}
        for row in plan.get("assignments", ()):
            origin_station = row.get("origin_station")
            dest_station = row.get("dest_station")
            if not origin_station or not dest_station:
                continue
            key = (row["origin"], row["dest"], int(row["period"]))
            index.setdefault(key, []).append(
                (row.get("rank", 0), -float(row.get("flow", 0)),
                 origin_station, dest_station))
        for key in index:
            index[key].sort()
        return index

    def _candidates_for(self, lat, lon):
        """Design stations within the walk catchment of a point, nearest
        first. Cached per coordinate -- the only geometry work."""
        key = (round(lat, 6), round(lon, 6))
        cached = self._cand_cache.get(key)
        if cached is None:
            near = []
            for idx, s in enumerate(self.stations):
                d = haversine_km(lat, lon, s["lat"], s["lon"])
                if d <= self.catchment_km:
                    near.append((d, idx))
            near.sort()
            cached = self._cand_cache[key] = [idx for _, idx in near]
        return cached

    def draw_trips(self, n_trips):
        """Sample-mode demand: n_trips drawn from the observed empirical
        distributions (hourly profile x od.csv flow shares), placed at the
        cell centres.

        DEPRECATED (demo v3, 2026-09-15): replaced by the model's own demand
        (`model_plan.json`); removed once the paper-grid runs are validated.

        :return: {hour: [(o_lat, o_lon, d_lat, d_lon), ...]}.
        """
        warnings.warn(_DEPRECATION, DeprecationWarning, stacklevel=2)
        hourly_share = self.profiles["hourly_share"][self.day]
        hours = self.rng.choices(range(24), weights=hourly_share, k=n_trips)
        ods = self.rng.choices(range(len(self.od_pairs)),
                               weights=self.od_weights, k=n_trips)
        trips = {h: [] for h in range(24)}
        for h, od_idx in zip(hours, ods):
            o_cell, d_cell = self.od_pairs[od_idx]
            (o_lat, o_lon), (d_lat, d_lon) = self.cells[o_cell], self.cells[d_cell]
            trips[h].append((o_lat, o_lon, d_lat, d_lon))
        return trips

    def _pick_with_bike(self, candidates, bikes, limit=None):
        for idx in candidates[:limit or self.retry]:
            if bikes[idx] > 0:
                return idx
        return None

    def _pick_with_dock(self, candidates, bikes, limit=None):
        for idx in candidates[:limit or self.retry]:
            if bikes[idx] < self.stations[idx]["capacity"]:
                return idx
        return None

    def _prefer(self, candidates, model_station_id, limit):
        """Put the plan's own station at the head of the candidate list.

        The model chose that station for this OD pair and period; the
        nearest-station rule stays behind it as the fallback for when the
        plan's station has no bike (or no dock) at this hour. Prepending an
        station that is not already in the walk catchment costs one extra
        retry slot, so the nearest-station fallback keeps its full depth.

        :return: (candidate list, retry limit for it).
        """
        idx = self._by_model_id.get(model_station_id)
        if idx is None:
            return candidates, limit
        if candidates and candidates[0] == idx:
            return candidates, limit
        return [idx] + [c for c in candidates if c != idx], limit + 1

    def _distance_km(self, i, j):
        """Distance between two design stations: the model's routed arc when
        it exported one, straight-line otherwise."""
        if self.arcs:
            arc = self.arcs.get((self._model_id[i], self._model_id[j]))
            if arc:
                return arc[0]
        return haversine_km(self.stations[i]["lat"], self.stations[i]["lon"],
                            self.stations[j]["lat"], self.stations[j]["lon"])

    def _plan_rebalance(self, bikes, period):
        """Replay the optimiser's own rebalancing moves for one period.

        The plan's ``r[i,j,t]`` bikes are moved from i to j at the hour the
        period starts, clamped by what is actually there (a bike the plan
        assumed present may have been ridden away in this simulation) and by
        the free docks at the destination. Clamped bikes are reported as
        ``plan_moves_infeasible`` rather than silently dropped -- they are
        the measure of how far the simulated day drifted from the plan.

        Cost follows the plan, not the clamp: the operator dispatched the
        trucks and drove the distance whether or not every bike was there,
        so ``cost_eur`` and ``bike_km`` use the planned bike counts and the
        plan's own ``n[i,j,t]`` dispatch count.
        """
        reb = self.config["rebalancing"]
        moved = planned = infeasible = dispatches = 0
        bike_km = 0.0
        for move in (self.plan or {}).get("rebalancing", ()):
            if int(move["period"]) != period:
                continue
            want = int(round(float(move["bikes"])))
            if want <= 0:
                continue
            planned += want
            dispatches += int(round(float(move.get("dispatches", 0) or 0)))
            source = self._by_model_id.get(move["from"])
            target = self._by_model_id.get(move["to"])
            if source is None or target is None:
                infeasible += want  # the plan moves bikes this design has not
                continue
            bike_km += want * self._distance_km(source, target)
            free_docks = self.stations[target]["capacity"] - bikes[target]
            take = max(0, min(want, bikes[source], free_docks))
            bikes[source] -= take
            bikes[target] += take
            moved += take
            infeasible += want - take

        cost = (dispatches * reb["dispatch_fixed_cost_eur"]
                + bike_km * reb["unit_cost_eur_per_bike_km"])
        return {"bikes_moved": moved, "bike_km": round(bike_km, 2),
                "truck_dispatches": dispatches, "cost_eur": round(cost, 2),
                "bikes_planned": planned, "plan_moves_infeasible": infeasible,
                "period": period}

    def _rebalance(self, bikes):
        """Move bikes back toward each station's initial level, nearest
        surplus station first, and cost the operation at the model's rates.

        :return: dict with moved bikes, bike-km, truck dispatches and cost.
        """
        reb = self.config["rebalancing"]
        surplus = [[bikes[i] - s["initial_bikes"], i]
                   for i, s in enumerate(self.stations)
                   if bikes[i] > s["initial_bikes"]]
        deficit = [[s["initial_bikes"] - bikes[i], i]
                   for i, s in enumerate(self.stations)
                   if bikes[i] < s["initial_bikes"]]

        moved, bike_km = 0, 0.0
        for need, di in deficit:
            d_station = self.stations[di]
            surplus.sort(key=lambda su: haversine_km(
                d_station["lat"], d_station["lon"],
                self.stations[su[1]]["lat"], self.stations[su[1]]["lon"]))
            for su in surplus:
                if need == 0:
                    break
                if su[0] == 0:
                    continue
                take = min(need, su[0])
                s_station = self.stations[su[1]]
                distance = haversine_km(s_station["lat"], s_station["lon"],
                                        d_station["lat"], d_station["lon"])
                bikes[su[1]] -= take
                bikes[di] += take
                su[0] -= take
                need -= take
                moved += take
                bike_km += take * distance

        trucks = math.ceil(moved / reb["truck_capacity_bikes"]) if moved else 0
        cost = (trucks * reb["dispatch_fixed_cost_eur"]
                + bike_km * reb["unit_cost_eur_per_bike_km"])
        return {"bikes_moved": moved, "bike_km": round(bike_km, 2),
                "truck_dispatches": trucks, "cost_eur": round(cost, 2)}

    def run(self, trips):
        """Simulate one day of the given trips.

        :param trips: {hour: [(o_lat, o_lon, d_lat, d_lon[, meta]), ...]}.
                      The optional fifth element is the instance mode's
                      ``(origin_cell, dest_cell, period)`` label, which makes
                      the per-OD and per-period statistics possible; replay
                      and sample pass plain 4-tuples.
        :return: result dict, ready for evaluate.py.
        """
        bikes = [s["initial_bikes"] for s in self.stations]
        capacity_total = sum(s["capacity"] for s in self.stations)

        hourly = []
        station_departures = [0] * len(self.stations)
        station_arrivals = [0] * len(self.stations)
        rebalancing_ops = []
        totals = {"demand": 0, "served": 0, "unserved_no_station": 0,
                  "unserved_no_bike": 0, "unserved_no_dock": 0,
                  "ride_km": 0.0, "ride_minutes": 0.0}

        # Statistics the model's own MetricsEvaluator reports, accumulated
        # from the same hourly snapshots the `hourly` rows are taken at.
        bike_hours = [0] * len(self.stations)
        borrowable_hours = [0] * len(self.stations)
        returnable_hours = [0] * len(self.stations)
        no_arc = followed_assignment = outside_model = 0
        demand_pairs, served_pairs = set(), set()
        demand_by_period = [0] * self.n_periods
        served_by_period = [0] * self.n_periods

        for hour in range(24):
            if self.plan is not None:
                if hour in PERIOD_START_HOURS:
                    op = self._plan_rebalance(bikes,
                                              PERIOD_START_HOURS.index(hour))
                    op["hour"] = hour
                    rebalancing_ops.append(op)
            elif hour in self.config["rebalancing"]["hours"]:
                op = self._rebalance(bikes)
                op["hour"] = hour
                rebalancing_ops.append(op)

            counts = {"demand": 0, "served": 0, "unserved_no_station": 0,
                      "unserved_no_bike": 0, "unserved_no_dock": 0}
            ride_km = 0.0
            ride_minutes = None if self.arcs is None else 0.0

            for trip in trips.get(hour, ()):
                o_lat, o_lon, d_lat, d_lon = trip[:4]
                meta = trip[4] if len(trip) > 4 else None
                counts["demand"] += 1
                if meta is not None:
                    demand_pairs.add(meta[:2])
                    if meta[2] < self.n_periods:
                        demand_by_period[meta[2]] += 1
                    if len(meta) > 3 and meta[3] == OUTSIDE_MODEL:
                        # A zone the model dropped: no station can exist
                        # there on either side, a coverage failure.
                        counts["unserved_no_station"] += 1
                        outside_model += 1
                        continue
                o_cand = self._candidates_for(o_lat, o_lon)
                d_cand = self._candidates_for(d_lat, d_lon)
                o_limit = d_limit = self.retry
                assigned = self._assignments.get(meta) if meta else None
                if assigned:
                    _, _, plan_origin, plan_dest = assigned[0]
                    o_cand, o_limit = self._prefer(o_cand, plan_origin, o_limit)
                    d_cand, d_limit = self._prefer(d_cand, plan_dest, d_limit)
                if not o_cand or not d_cand:
                    counts["unserved_no_station"] += 1
                    continue
                o_idx = self._pick_with_bike(o_cand, bikes, o_limit)
                if o_idx is None:
                    counts["unserved_no_bike"] += 1
                    continue
                d_idx = self._pick_with_dock(d_cand, bikes, d_limit)
                if d_idx is None:
                    counts["unserved_no_dock"] += 1
                    continue
                o_s, d_s = self.stations[o_idx], self.stations[d_idx]
                arc = None
                if self.arcs is not None:
                    arc = self.arcs.get((self._model_id[o_idx],
                                         self._model_id[d_idx]))
                    if arc is None and not self.allow_unrouted:
                        # The model links stations only within 1 km: without
                        # an arc there is no ride it would have allowed.
                        no_arc += 1
                        continue
                bikes[o_idx] -= 1
                bikes[d_idx] += 1
                station_departures[o_idx] += 1
                station_arrivals[d_idx] += 1
                counts["served"] += 1
                if meta is not None:
                    served_pairs.add(meta[:2])
                    if meta[2] < self.n_periods:
                        served_by_period[meta[2]] += 1
                if assigned and self._model_id[o_idx] == assigned[0][2] \
                        and self._model_id[d_idx] == assigned[0][3]:
                    followed_assignment += 1
                if arc is not None:
                    ride_km += arc[0]
                    ride_minutes += arc[1]
                else:
                    distance = haversine_km(o_s["lat"], o_s["lon"],
                                            d_s["lat"], d_s["lon"]) * self.detour
                    ride_km += distance
                    if ride_minutes is not None:
                        ride_minutes += distance / self.speed * 60

            for key in counts:
                totals[key] += counts[key]
            totals["ride_km"] += ride_km
            totals["ride_minutes"] += (ride_km / self.speed * 60
                                       if ride_minutes is None else ride_minutes)

            for i, b in enumerate(bikes):
                bike_hours[i] += b
                borrowable_hours[i] += 1 if b > 0 else 0
                returnable_hours[i] += 1 if b < self.stations[i]["capacity"] else 0

            hourly.append({
                "hour": hour, **counts, "ride_km": round(ride_km, 2),
                "fill_ratio": round(sum(bikes) / capacity_total, 3)
                if capacity_total else 0.0,
                "empty_stations": sum(1 for b in bikes if b == 0),
                "full_stations": sum(1 for i, b in enumerate(bikes)
                                     if b >= self.stations[i]["capacity"]),
            })

        if self.plan is None:
            # End-of-day truck round: restoring every station to its initial
            # stock for the next morning is part of the day's operating cost
            # even though it happens after the last rider. A solved plan has
            # no such round -- the optimiser's schedule is the whole of it.
            end_op = self._rebalance(bikes)
            end_op["hour"] = 24
            rebalancing_ops.append(end_op)

        totals["ride_km"] = round(totals["ride_km"], 2)
        totals["ride_minutes"] = round(totals["ride_minutes"], 1)

        model_view = self._model_view(
            bike_hours, borrowable_hours, returnable_hours, len(hourly),
            no_arc, outside_model, followed_assignment, demand_pairs,
            served_pairs, demand_by_period, served_by_period)

        return {
            "day": self.day,
            "n_stations": len(self.stations),
            "total_capacity": capacity_total,
            "total_bikes_initial": sum(s["initial_bikes"] for s in self.stations),
            "totals": totals,
            "hourly": hourly,
            "model_view": model_view,
            "rebalancing": {
                "operations": rebalancing_ops,
                "bikes_moved": sum(op["bikes_moved"] for op in rebalancing_ops),
                "bike_km": round(sum(op["bike_km"] for op in rebalancing_ops), 2),
                "truck_dispatches": sum(op["truck_dispatches"] for op in rebalancing_ops),
                "cost_eur": round(sum(op["cost_eur"] for op in rebalancing_ops), 2),
                **({"source": "model_plan",
                    "bikes_planned": sum(op["bikes_planned"]
                                         for op in rebalancing_ops),
                    "plan_moves_infeasible": sum(op["plan_moves_infeasible"]
                                                 for op in rebalancing_ops)}
                   if self.plan is not None else {}),
            },
            "stations": [
                {"station": s["station"], "lat": s["lat"], "lon": s["lon"],
                 "capacity": s["capacity"], "initial_bikes": s["initial_bikes"],
                 "departures": station_departures[i],
                 "arrivals": station_arrivals[i], "final_bikes": bikes[i]}
                for i, s in enumerate(self.stations)
            ],
        }

    def _model_view(self, bike_hours, borrowable_hours, returnable_hours,
                    n_hours, no_arc, outside_model, followed_assignment,
                    demand_pairs, served_pairs,
                    demand_by_period, served_by_period):
        """Restate the simulated day the way the model's MetricsEvaluator
        defines its own metrics, so the two views can be put side by side
        (findings.md #5 and #6).

        The model averages over its three abstract periods; the simulator has
        24 hourly snapshots of the same quantities, so the hour is the unit
        here -- ``utilisation`` is the mean over stations of the mean over
        hours of ``bikes / capacity``, ``borrowable_rate`` the mean over
        stations of the share of hours with a bike available,
        ``returnable_rate`` the share of hours with a free dock.

        In instance mode the block also carries the model's count-based
        ``covered_od_ratio`` -- OD *pairs* with at least one served trip over
        OD pairs in the demand, unweighted by flow, exactly as
        ``_compute_coverage_metrics`` counts it.
        """
        n_stations = len(self.stations)
        if not n_stations or not n_hours:
            view = {"utilisation": 0.0, "borrowable_rate": 0.0,
                    "returnable_rate": 0.0}
        else:
            view = {
                "utilisation": round(sum(
                    bike_hours[i] / (n_hours * self.stations[i]["capacity"])
                    for i in range(n_stations)
                    if self.stations[i]["capacity"]) / n_stations, 4),
                "borrowable_rate": round(
                    sum(borrowable_hours) / (n_stations * n_hours), 4),
                "returnable_rate": round(
                    sum(returnable_hours) / (n_stations * n_hours), 4),
            }
        view["hours_observed"] = n_hours
        view["unserved_no_arc"] = no_arc
        # Demand on zones the model dropped (findings.md #7): counted as
        # unserved_no_station in totals, made visible here.
        view["unserved_outside_model"] = outside_model
        if demand_pairs:
            view["covered_od_ratio"] = round(
                len(served_pairs) / len(demand_pairs), 3)
            view["od_pairs_demanded"] = len(demand_pairs)
            view["od_pairs_served"] = len(served_pairs)
            view["demand_by_period"] = list(demand_by_period)
            view["served_by_period"] = list(served_by_period)
        if self.plan is not None:
            view["followed_model_assignment"] = followed_assignment
        return view

    def _behavior_parameters(self):
        return {"walk_catchment_m": self.config["demand"]["walk_catchment_m"],
                "station_retry_count": self.retry,
                "ride_detour_factor": self.detour,
                "ride_speed_kmh": self.speed}


def _mean_std(rows, keys):
    """Per-key mean and sample std over a list of dicts."""
    mean, std = {}, {}
    for key in keys:
        values = [row[key] for row in rows]
        mean[key] = round(statistics.mean(values), 2)
        std[key] = round(statistics.stdev(values), 2) if len(values) > 1 else 0.0
    return mean, std


_TOTAL_KEYS = ("demand", "served", "unserved_no_station", "unserved_no_bike",
               "unserved_no_dock", "ride_km", "ride_minutes")


def replay(stations, day, date=None, config=None):
    """Trace-driven replay of the observed trips against a design.

    Every observed calendar day of the requested type is replayed (or just
    `date`); the returned result carries the mean totals across those days,
    the full hourly detail of the representative (median-demand) day, and a
    per-day ensemble.

    :param stations: the design (:func:`load_stations` schema).
    :param day: "monday" (pools observed weekdays) or "sunday".
    :param date: replay only this ISO calendar date.
    :return: result dict, evaluate.py-compatible.
    """
    observed = trips_by_date(day)
    if date:
        if date not in observed:
            raise KeyError(f"no observed trips on {date} for day type {day}; "
                           f"dates run {min(observed)}..{max(observed)}")
        observed = {date: observed[date]}
    if not observed:
        raise ValueError(f"no observed trips for day type {day}")

    sim = DaySimulation(stations, day, config=config)
    per_day = []
    for d in sorted(observed):
        trips = {h: [] for h in range(24)}
        for t in observed[d]:
            trips[t["hour"]].append((t["o_lat"], t["o_lon"],
                                     t["d_lat"], t["d_lon"]))
        result = sim.run(trips)
        result["date"] = d
        per_day.append(result)

    per_day.sort(key=lambda r: r["totals"]["demand"])
    representative = per_day[len(per_day) // 2]
    totals_mean, totals_std = _mean_std([r["totals"] for r in per_day],
                                        _TOTAL_KEYS)
    reb_mean, _ = _mean_std([r["rebalancing"] for r in per_day],
                            ("bikes_moved", "bike_km", "truck_dispatches",
                             "cost_eur"))

    result = dict(representative)
    result["totals"] = totals_mean
    result["rebalancing"] = {**result["rebalancing"], **reb_mean}
    result["method"] = {
        "mode": "replay",
        "description": ("trace-driven simulation: observed trips replayed "
                        "at their recorded local time and coordinates; "
                        "totals are the mean over all replayed days, hourly "
                        "detail is the median-demand day"),
        "demand_source": str(GEOJSON_DIR / "bike_trips.geojson"),
        "timezone_assumption": TIMEZONE_NOTE,
        "n_days_replayed": len(per_day),
        "representative_date": representative["date"],
        "behavior_parameters": sim._behavior_parameters(),
    }
    result["replay_ensemble"] = {
        "n_days": len(per_day),
        "totals_mean": totals_mean,
        "totals_std": totals_std,
        "per_day_totals": [{"date": r["date"], **r["totals"]}
                           for r in sorted(per_day, key=lambda r: r["date"])],
    }
    return result


def sample(stations, day, scale=1.0, seeds=1, seed=42, config=None):
    """Monte Carlo resampling from the observed empirical distributions.

    DEPRECATED (demo v3, 2026-09-15): the demo no longer scales the observed
    day (decision 2 of the v3 plan: no "x25"); the demand scale that matters
    is the model's own planning day. Removed once the paper-grid runs are
    validated.

    :param stations: the design (:func:`load_stations` schema).
    :param day: "monday" or "sunday".
    :param scale: demand-growth multiplier on the measured daily volume;
                  values above 1 are explicit hypotheses, not observations.
    :param seeds: number of independent seeded runs (seed, seed+1, ...);
                  totals become the mean across them.
    :return: result dict, evaluate.py-compatible.
    """
    warnings.warn(_DEPRECATION, DeprecationWarning, stacklevel=2)
    calibration = load_calibration()
    base = calibration["trips_per_day"][day]
    volume = max(1, round(base * scale))

    runs = []
    for i in range(seeds):
        sim = DaySimulation(stations, day, config=config, seed=seed + i)
        result = sim.run(sim.draw_trips(volume))
        result["seed"] = seed + i
        runs.append(result)

    totals_mean, totals_std = _mean_std([r["totals"] for r in runs], _TOTAL_KEYS)
    reb_mean, _ = _mean_std([r["rebalancing"] for r in runs],
                            ("bikes_moved", "bike_km", "truck_dispatches",
                             "cost_eur"))

    result = dict(runs[0])
    result["totals"] = totals_mean
    result["rebalancing"] = {**result["rebalancing"], **reb_mean}
    result["method"] = {
        "mode": "sample",
        "description": ("Monte Carlo resampling from observed empirical "
                        "distributions (hourly profile x OD flow shares); "
                        "totals are the mean across seeds, hourly detail is "
                        "the first seed"),
        "demand_source": str(GEOJSON_DIR / "od.csv"),
        "volume_base_measured_per_day": base,
        "scale": scale,
        "volume_simulated": volume,
        "volume_is_hypothesis": scale != 1.0,
        "seeds": [seed + i for i in range(seeds)],
        "behavior_parameters":
            DaySimulation(stations, day, config=config)._behavior_parameters(),
    }
    if seeds > 1:
        result["seed_ensemble"] = {
            "n_seeds": seeds,
            "totals_mean": totals_mean,
            "totals_std": totals_std,
            "per_seed_totals": [{"seed": r["seed"], **r["totals"]}
                                for r in runs],
        }
    return result


def _instance_cells(instance):
    """Cell centres of the zones the model kept (56 of the layer's 59).

    The model's demand still references two of the dropped cells (60 of the
    1,453 trips, findings.md #7); their centres are deliberately NOT
    recovered from the layer's grid: the model enumerates paths only between
    its kept cells, so that demand can never be served on its side either.
    ``instance_trips`` flags it and the engine counts it unserved.

    DEPRECATED (demo v3, 2026-09-15), with the rest of the instance mode.
    """
    from .pipeline.instance import cells_of

    return cells_of(instance)


def _mean_model_view(views):
    """Element-wise mean of the per-run `model_view` blocks."""
    if not views:
        return {}
    mean = {}
    for key, value in views[0].items():
        values = [v.get(key) for v in views]
        if isinstance(value, list):
            mean[key] = [round(statistics.mean(col), 2)
                         for col in zip(*values)]
        elif isinstance(value, bool) or not isinstance(value, (int, float)):
            mean[key] = value
        elif isinstance(value, int):
            mean[key] = round(statistics.mean(values), 2)
        else:
            mean[key] = round(statistics.mean(values), 4)
    return mean


def instance_run(stations, instance, seeds=1, seed=42, config=None,
                 plan=None, arcs=None, allow_unrouted=False, cells=None,
                 day="monday", instance_path=None, profiles=None):
    """Replay the model's own planning day against a design.

    DEPRECATED (demo v3, 2026-09-15): re-simulating the planning day cannot
    reproduce the model's own result (it re-routes trips and cannot follow a
    bike+PT path, so it reported 45 % served where the model served 87 %);
    the served demand is now read from `model_plan.json` by
    `evaluate.paper_kpis`. Removed once the paper-grid runs are validated.

    The demand is the instance's 1,453 trips over 703 OD pairs and three
    periods -- the day the designs were actually sized for. Only the
    within-period hour of each trip is random, so `seeds` independent runs
    bracket that one assumption; totals are their mean, hourly detail is the
    first seed's, exactly as sample mode reports its ensemble.

    :param stations: the design (:func:`load_stations` schema).
    :param instance: the parsed instance.json.
    :param seeds: number of independent seeded runs (seed, seed+1, ...).
    :param plan: the design's ``model_plan.json``, when it has one.
    :param arcs: the model's routed ride arcs, when they are exported.
    :param allow_unrouted: serve trips with no model arc anyway (haversine).
    :return: result dict, evaluate.py-compatible.
    """
    warnings.warn(_DEPRECATION, DeprecationWarning, stacklevel=2)
    from .pipeline.instance import candidates_of, demand_of

    profiles = profiles or load_profiles()
    cells = _instance_cells(instance) if cells is None else cells
    candidates = candidates_of(instance)
    demand = demand_of(instance)
    volume = sum(flow for _, _, _, flow in demand)

    runs, sim = [], None
    for i in range(seeds):
        # The instance's own cells and demand replace the observed-trip
        # readers entirely: this mode never draws from od.csv.
        sim = DaySimulation(stations, day, config=config, profiles=profiles,
                            seed=seed + i, cells=cells, od=([], []),
                            candidates=candidates, plan=plan, arcs=arcs,
                            allow_unrouted=allow_unrouted)
        trips = instance_trips(instance, profiles, sim.rng, cells=cells,
                               day=day)
        result = sim.run(trips)
        result["seed"] = seed + i
        runs.append(result)

    totals_mean, totals_std = _mean_std([r["totals"] for r in runs], _TOTAL_KEYS)
    reb_mean, _ = _mean_std([r["rebalancing"] for r in runs],
                            ("bikes_moved", "bike_km", "truck_dispatches",
                             "cost_eur"))

    result = dict(runs[0])
    result["day"] = "instance"
    result["totals"] = totals_mean
    result["rebalancing"] = {**result["rebalancing"], **reb_mean}
    result["model_view"] = _mean_model_view([r["model_view"] for r in runs])
    result["method"] = {
        "mode": "instance",
        "description": ("the optimiser's own planning day: every unit of the "
                        "solved instance's per-period OD demand replayed as "
                        "one trip between cell centres; totals are the mean "
                        "across seeds, hourly detail is the first seed"),
        "demand_source": str(instance_path) if instance_path else "instance.json",
        "demand_volume_trips": volume,
        "demand_od_rows": len(demand),
        "demand_od_pairs": len({(o, d) for o, d, _, _ in demand}),
        "period_to_hours": [f"period {t}: {lo:02d}-{hi:02d} local"
                            for t, (lo, hi) in enumerate(PERIOD_BOUNDS)],
        "period_hour_weighting": (f"observed {day} hourly_share restricted to "
                                  "each period's hours and renormalised"),
        "ride_distance_source": ("model_bike_arcs" if arcs
                                 else "haversine_x_detour"),
        "rebalancing_source": "model_plan" if plan else "greedy_restore",
        "station_choice": ("model_assignment_then_nearest" if plan
                           else "nearest"),
        "allow_unrouted": bool(allow_unrouted),
        "seeds": [seed + i for i in range(seeds)],
        "behavior_parameters": sim._behavior_parameters(),
    }
    if seeds > 1:
        result["seed_ensemble"] = {
            "n_seeds": seeds,
            "totals_mean": totals_mean,
            "totals_std": totals_std,
            "per_seed_totals": [{"seed": r["seed"], **r["totals"]}
                                for r in runs],
        }
    return result


def simulate_day(stations_file, day, mode="replay", scale=1.0, seeds=1,
                 seed=42, date=None, output_file=None, instance=None,
                 allow_unrouted=False):
    """Run one day and write the result next to the design.

    :param stations_file: path of a stations.json design.
    :param day: "monday" or "sunday".
    :param mode: "replay" (observed trips), "sample" (resampled demand) or
                 "instance" (the model's own planning day).
    :param instance: instance.json path for instance mode; located next to
                     the design (or from the reference scenario) if None.
    :param allow_unrouted: instance mode: serve trips whose station pair has
                           no model ride arc.
    :return: (result dict, path written).

    DEPRECATED (demo v3, 2026-09-15): modes "sample" and "instance"; "replay"
    stays as the demonstration's stress test.
    """
    if mode != "replay":
        warnings.warn(_DEPRECATION, DeprecationWarning, stacklevel=2)
    stations_file = Path(stations_file)
    stations = load_stations(stations_file)

    label = day
    if mode == "replay":
        result = replay(stations, day, date=date)
    elif mode == "sample":
        result = sample(stations, day, scale=scale, seeds=seeds, seed=seed)
    elif mode == "instance":
        from .pipeline.instance import (find_instance, load_bike_arcs,
                                        load_instance, load_model_plan)

        instance_path = (Path(instance).resolve() if instance
                         else find_instance(stations_file))
        if instance_path is None:
            raise FileNotFoundError(
                "instance mode needs an instance.json (none next to the "
                f"design {stations_file} and no reference instance under "
                "results/); pass --instance PATH")
        result = instance_run(
            stations, load_instance(instance_path), seeds=seeds,
            seed=seed, plan=load_model_plan(stations_file.parent),
            arcs=load_bike_arcs(), allow_unrouted=allow_unrouted,
            instance_path=instance_path)
        label = "instance"
    else:
        raise ValueError(f"unknown mode {mode!r}")

    output_file = Path(output_file) if output_file else \
        stations_file.parent / f"sim_{label}.json"
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    totals = result["totals"]
    print(f"simulated {label} [{mode}]: {totals['served']}/{totals['demand']} "
          f"trips served (daily mean) -> {output_file}")
    return result, output_file


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python -m demo.experiments.simulate",
        description="Replay a standard day against a station design.")
    parser.add_argument("--stations", required=True,
                        help="stations.json of the design to test")
    parser.add_argument("--day", default="monday", choices=("monday", "sunday"))
    parser.add_argument("--mode", default="replay",
                        choices=("replay", "sample", "instance"),
                        help="replay = observed trips (default); "
                             "sample = resampled demand at --scale "
                             "(DEPRECATED); instance = the model's own "
                             "planning day (DEPRECATED)")
    parser.add_argument("--date", default=None,
                        help="replay only this observed date (YYYY-MM-DD)")
    parser.add_argument("--scale", type=float, default=1.0,
                        help="sample mode: demand-growth multiplier on the "
                             "measured volume (>1 is a labelled hypothesis)")
    parser.add_argument("--seeds", type=int, default=1,
                        help="sample/instance mode: number of independent "
                             "seeded runs")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--instance", default=None,
                        help="instance mode: the instance.json to replay "
                             "(default: next to the design, else the "
                             "reference scenario's)")
    parser.add_argument("--allow-unrouted", action="store_true",
                        help="instance mode: serve trips whose station pair "
                             "has no model ride arc (default: count them "
                             "unserved, as the model's 1 km limit implies)")
    parser.add_argument("--out", default=None,
                        help="output path (default: sim_<day>.json, or "
                             "sim_instance.json, next to the design)")
    args = parser.parse_args(argv)
    simulate_day(args.stations, args.day, mode=args.mode, scale=args.scale,
                 seeds=args.seeds, seed=args.seed, date=args.date,
                 output_file=args.out, instance=args.instance,
                 allow_unrouted=args.allow_unrouted)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
