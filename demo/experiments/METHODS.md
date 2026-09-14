# Simulation and evaluation methods

This document is the reference for how the demonstration's numbers are
produced: what data they rest on, what the algorithms do, and the exact
status of every assumption. It exists so that any figure shown by the demo
can be traced to either an observation or a stated hypothesis.

## 1. Data sources

All inputs live in `data/geneva_1.5km-radius/` (the demonstration's own
copy; the frozen model in `network-design-bss/src/` is never read or
modified by this layer).

| File | Content | Nature |
| --- | --- | --- |
| `bike_trips.geojson` | 1,658 shared-bike trips, 2024-06-06 → 2024-12-04, with start/end coordinates and timestamps | **Observed** (operator data) |
| `ridership.geojson` | PT boardings/alightings at 156 stops, per day of week × hour, summed over a year | **Observed** (PT operator) |
| `bike_stations.geojson` | 139 bike-share station locations in the area | **Observed** (operator) |
| `donkey_station_information.json` | Official GBFS `station_information` feed: 623 stations with real capacities | **Observed** (provider API) |
| `grid.geojson`, `stops.geojson`, `itineraries.geojson` | H3 zones (59 cells), 438 PT stops, PT lines | **Observed / derived** (model input sample) |
| `od.csv` | Cell-to-cell flow table derived from the observed trips | **Derived** from `bike_trips.geojson` |

## 2. Preprocessing

**Timezone.** `trip_started_at_utc` carries naive ISO timestamps. The field
name is trusted: timestamps are read as UTC and converted to Europe/Zurich.
Two independent checks support this reading: (a) the converted weekday
profile shows the classic commute peaks at 08h and 17–18h, where a naive
local reading would put the morning peak at an implausible 06h; (b) the PT
ridership data — which is in local time by construction — peaks at 16–18h
on weekdays, coinciding with the converted bike profile
(`python3 -m demo.experiments.ridership` prints the cross-check). Remaining
action: confirm with the data producer.

**Calibration** (`trips.py` → `data/calibration.json`). Measured from the
observed trips: 11.5 trips/day on weekdays, 9.5 on Saturdays, 9.4 on
Sundays (112 / 21 / 18 observed days respectively); median trip 0.84 km.
These volumes are the simulator's base demand. **They replace the former
800/640 placeholders**: any larger volume is an explicit growth hypothesis
(§4).

**Station capacities** (`stations_real.py` → `data/stations_real.geojson`).
The 139 local stations are joined to the GBFS feed by French name, with a
nearest-coordinate fallback within 50 m: 128/139 obtain their real capacity
(115 by name, 13 by proximity); 11 stations — likely discontinued — remain
without one.

## 3. Simulation

Both modes share one engine (`simulate.py`): a rider starts at a
coordinate, walks to the nearest design station within the 300 m catchment
(trying up to 2), takes a bike if available, rides (haversine distance ×
1.3 detour factor, 20 km/h), and docks near the destination under the same
rule. Failures are counted by cause: *no station nearby* (coverage), *no
bike*, *no dock* (capacity/rebalancing). A truck round restores initial
stocks at 04h and after the last trip, costed at the frozen model's own
rates (fixed 40 € per dispatch + 20 €/bike-km, truck capacity 10).

### 3.1 Trace-driven replay (`--mode replay`) — the proof mode

The observed trips themselves are replayed: each trip at its recorded local
hour, from its recorded origin coordinate to its recorded destination
coordinate. Every observed calendar day of the requested type is replayed
separately (112 weekdays for "monday", 18 Sundays), and the reported totals
are the **mean over those days**, with the day-to-day standard deviation in
the `replay_ensemble` block; the hourly detail kept in the file is the
median-demand day. There is no random number generation and no synthetic
demand in this mode. Trace-driven simulation is the standard evaluation
method for network changes in bike-share operations research.

### 3.2 Empirical resampling (`--mode sample`) — the what-if mode

Demand is drawn from the observed empirical distributions: trip hour from
the day type's hourly profile (`profiles.py`), origin–destination pair from
the `od.csv` flow shares, placed at cell centres. The daily volume is
*measured base × `--scale`*: scale 1 reproduces the observed volume; larger
scales are labelled demand-growth hypotheses (the demo presents ×1, ×10,
×25). With `--seeds K`, K independent seeded runs are performed and the
totals reported are their mean, with per-seed values and standard deviation
in the `seed_ensemble` block. Sampling is seeded and therefore exactly
reproducible.

### 3.3 Instance replay (`--mode instance`) — the model's day

Demand is the **solved instance's own OD table** (`instance.json`, `od_demand`: 1,453
trips over 703 pairs, 3 periods) rather than the observed or resampled trips of §3.1/
§3.2 — it is the day S1–S3 were actually sized for
(`.specs/demo-pipeline/findings.md` #1), the model's `metrics.json` being the only
other view of it. Each period's flow is placed at the origin/destination cell centres
and spread over that period's hours (06–10 / 10–16 / 16–22) by the observed hourly
profile *within* the period — an assumed placement, not a model rule (the model has no
hour semantics, only three abstract periods; see the assumption register). `--seeds K`
runs a seeded ensemble as in sample mode.

Two model exports, when present, replace the generic behavioural rules of §3 with the
model's own:

- **Station choice and rebalancing** (`model_plan.json`, written by the design layer
  after a Gurobi run with the Phase B export code): a trip uses the stations the
  solver actually assigned its OD pair to, rather than nearest-station choice; a
  truck round at the start of each period (hours 6/10/16) applies the model's own
  `r`/`n` moves, rather than a greedy restore-to-initial.
- **Ride distance/time** (`results/shared/bike_arcs.json`, the model's OSM-routed
  arcs): a trip between two stations linked by an arc uses that arc's distance and
  time; a trip between stations with no arc is `unserved_no_arc` — the model's own
  1 km ride-catchment limit (`RIDE_CATCHMENT_RADIUS`) — unless `--allow-unrouted` is
  passed, in which case it falls back to the haversine rule below.

Without a given export, instance mode falls back to the §3 rules it replaces:
nearest-station choice, the greedy restore-to-initial round, and haversine × 1.3.
Every `sim_instance.json` records which rules were actually in force, in its `method`
block (`rebalancing_source`, `ride_distance_source`, `station_choice`), so a result
file is self-describing regardless of which exports existed when it was produced.

Output additionally carries a `model_view` block computed the way the model's own
`output_handler/metrics_evaluator.py` defines its metrics — average utilisation,
borrowable/returnable rates, a count-based `covered_od_ratio` — plus served/demand by
period, so it is comparable to `metrics.json` term for term (§6, `evaluate.py`'s
`comparison` block).

### 3.4 Self-description

Every simulation output carries a `method` block recording mode, demand
source, volumes, scale, seeds, timezone assumption and the behavioural
parameters used, so a result file is interpretable on its own.

## 4. Assumption register

| Quantity | Value | Status |
| --- | --- | --- |
| Daily demand volumes | 11.5 / 9.4 per day | **Measured** (calibration.json) |
| Hourly profiles, OD shares | from observed trips | **Measured** |
| PT volumes and peaks | from ridership.geojson | **Measured** |
| Station capacities (today's network) | GBFS feed | **Measured** (128/139) |
| Timezone of trip timestamps | UTC | **Assumed, cross-validated** (§2) |
| Growth scales ×10, ×25 | — | **Hypothesis, labelled** |
| Walk catchment 300 m, 2 retries, detour ×1.3, 20 km/h | — | **Assumed** (behavioural model; the model's own `DETOUR_RATIO = 0.2` is a k-shortest-path enumeration tolerance, not a distance multiplier, so no model value exists for this coefficient) |
| Period hour bounds (06–10 / 10–16 / 16–22 local) | — | **Assumed** (demo decision; the model defines no hours, only three abstract periods with a weight vector) |
| Mode substitution (car 10 % / PT 45 % / walk 35 % / induced 10 %) | — | **Assumed** (mid-range of European bike-share surveys) |
| Emission factors (car 192, PT 55, bike fleet 12 g/pkm) | — | **Assumed** (mobitool-style Swiss lifecycle values) |
| Fare 2 €, maintenance 0.5 €/bike/day, amortisation 8 y | — | **Assumed** |
| Unit costs (station 100 €, dock 20 €, bike 60 €, rebalancing rates) | — | **Model's own** (`src/util/cost.py`) |
| S1–S3 optimiser designs & model metrics | `results/S*/` | **Solver output** (§6) |
| Period→hour mapping in instance mode | observed hourly profile within the period | **Assumed** (demo decision) |
| Ride arcs (instance mode) | the model's own OSM arcs when exported, haversine × 1.3 otherwise | **Model's own** / **Assumed fallback** |

## 5. Evaluation

`evaluate.py` turns a simulated day into four KPI families (service,
mobility, environment, economics); every coefficient comes from
`kpi_config.json` and appears in the register above. Real PT volumes
provide a context KPI (bike trips per 1,000 PT boardings). Where a
`metrics.json` from the optimiser sits next to the simulation, its metrics
are merged in — and if it is a placeholder, `kpis.json` says so at the top
level (`placeholder_model_results: true`).

## 6. Optimiser results

`results/S1|S2|S3/` hold **real solver output**. Run on 2026-09-08 with an academic Gurobi licence; all three solved to optimality (status 2, MIP gap ~0). The instance is
53 558 variables / 36 535 constraints, well past the size-limited licence
bundled with `gurobipy`. Each `stations.json` and `metrics.json` records,
under `run`, the scenario parameters, the solver status, the MIP gap, the wall
clock, and the `src_commit`/`repo_commit` that produced it, so a design can be
audited without re-running it.

The runs are driven by `run_model.py`, which applies a scenario's parameters
by replacing `generate_h3_instances()` in `sys.modules` for the duration of
one run — the frozen model source is never edited.

The earlier greedy placeholders (`mock_results.py`, stamped
`"placeholder": true`, removed 2026-09-09, see git history) are superseded and
no longer written.

## 7. Known limitations

- The behavioural model is deliberately simple: no within-hour queueing, no
  rider rerouting beyond 2 stations, no bike+PT trip chaining (the
  multimodal split is taken from the model's own metrics when available).
- Replay evaluates designs against *recorded* demand: it cannot express
  demand induced by a better network; the growth scenarios approximate
  that, as labelled hypotheses.
- The optimiser's designs separate clearly at the observed volume
  (served 0.705 / 0.874 / 0.966 for S1 / S2 / S3), unlike the earlier
  placeholders which all served ~100 %. The binding failure is docking, not
  bike availability: at 20 k€ the model builds 35 stations of ~7 docks and
  riders cannot return a bike. This makes the naive `baseline.py` design
  *outperform* S1 on served trips at equal budget when tested at the observed
  volume — but that volume is ~125× smaller than the 1,453-trip day the
  designs were actually sized for (`.specs/demo-pipeline/findings.md` #1), so
  the comparison at that scale mostly measures over-provisioning for a demand
  that was never going to arrive. §3.3's `instance` mode replays the model's
  own day instead; read the human-vs-optimiser comparison there before
  concluding the two score genuinely different objectives (see README, known
  gaps).
- PT daily averages divide yearly sums by 52 (holidays uncorrected).
- Today's real network is **not simulated**: its per-station bike stocks
  over time are not in any available source (would require GBFS
  `station_status` history). Visualization only, by decision.
