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

## 3. Simulation — the stress test

Demo v3 (2026-09-15) realigns the demonstration with the submitted paper: the paper never
simulates individual trips, and neither does the demonstration's primary evaluation any more
(§5). `simulate.py` is kept for exactly one purpose — a **stress test**, replaying the trips
Geneva actually recorded against a solved design, as a demo-side robustness check clearly
labelled as such, not part of the paper's own evaluation.

### 3.1 Trace-driven replay (`--mode replay`) — the only live mode

One engine: a rider starts at a coordinate, walks to the nearest design station within the
300 m catchment (trying up to 2), takes a bike if available, rides (haversine distance × 1.3
detour factor, 20 km/h), and docks near the destination under the same rule. Failures are
counted by cause: *no station nearby* (coverage), *no bike*, *no dock*
(capacity/rebalancing). A truck round restores initial stocks at 04h and after the last trip,
costed at the frozen model's own rates (fixed 40 € per dispatch + 20 €/bike-km, truck capacity
10).

The observed trips themselves are replayed: each trip at its recorded local hour, from its
recorded origin coordinate to its recorded destination coordinate. Every observed calendar day
of the requested type is replayed separately (112 weekdays for "monday", 18 Sundays), and the
reported totals are the **mean over those days**, with the day-to-day standard deviation in the
`replay_ensemble` block; the hourly detail kept in the file is the median-demand day. There is
no random number generation and no synthetic demand in this mode. Trace-driven simulation is the
standard evaluation method for network changes in bike-share operations research — but the
volume it replays (11.5 trips/day weekday, 9.4 Sunday) is ~125× smaller than the paper's
potential-demand day (1,453 trips) the designs are sized for, which is why it is a stress test
and not the headline evaluation.

### 3.2 Self-description

Every simulation output carries a `method` block recording mode, demand source, volumes, seeds,
timezone assumption and the behavioural parameters used, so a result file is interpretable on
its own.

### 3.3 Deprecated modes (kept, not called, removed after the paper-grid runs are validated)

`--mode sample` (empirical resampling at a `--scale` growth hypothesis) and `--mode instance`
(replaying the solved instance's own OD table with nearest-station/greedy-rebalancing fallback
rules) are superseded by reading the model's own solved plan directly
(`model_plan.json`, §5) rather than re-simulating it — a re-simulation that, for `instance` mode,
could not route bike+PT paths and undercounted served demand relative to the model's own count.
The code, `--mode sample|instance` CLI options and their golden tests remain in the tree,
marked `DEPRECATED (demo v3, 2026-09-15)`, until the paper-grid runs are run and validated.

## 4. Assumption register

What is still used, now that evaluation reads the model's own solution (§5) rather than a
simulation:

| Quantity | Value | Status |
| --- | --- | --- |
| Daily demand volumes (stress test) | 11.5 / 9.4 per day | **Measured** (calibration.json) |
| Hourly profiles, OD shares (stress test) | from observed trips | **Measured** |
| PT volumes and peaks | from ridership.geojson | **Measured** |
| Station capacities (today's network) | GBFS feed | **Measured** (128/139) |
| Timezone of trip timestamps | UTC | **Assumed, cross-validated** (§2) |
| Walk catchment 300 m, 2 retries, detour ×1.3, 20 km/h (stress test only) | — | **Assumed** (behavioural model; the model's own `DETOUR_RATIO = 0.2` is a k-shortest-path enumeration tolerance, not a distance multiplier, so no model value exists for this coefficient) |
| Period hour bounds (06–10 / 10–16 / 16–22 local) | — | **Assumed** (demo decision, used for the map's period control and the stress test; the model defines no hours, only three abstract periods with a weight vector) |
| Unit costs (station 100 €, dock 20 €, bike 60 €, rebalancing rates) | — | **Model's own** (`src/util/cost.py`) |
| Paper-grid optimiser designs & full evaluator row | `results/<id>/` | **Solver output** (§6) |

Deprecated (kept in `kpi_config.json`, marked `"_deprecated": true`, until the paper-grid runs
are validated — no longer read by `evaluate.py`'s live code paths):

| Quantity | Value | Status |
| --- | --- | --- |
| Growth scales ×10, ×25 | — | **Hypothesis, labelled** — deprecated, no growth-scale story in v3 |
| Mode substitution (car 10 % / PT 45 % / walk 35 % / induced 10 %) | — | **Assumed** (mid-range of European bike-share surveys) — deprecated |
| Emission factors (car 192, PT 55, bike fleet 12 g/pkm) | — | **Assumed** (mobitool-style Swiss lifecycle values) — deprecated |
| Fare 2 €, maintenance 0.5 €/bike/day, amortisation 8 y | — | **Assumed** — deprecated |
| Period→hour mapping in the deprecated instance mode | observed hourly profile within the period | **Assumed** (demo decision) — deprecated with instance mode |
| Ride arcs in the deprecated instance mode | the model's own OSM arcs when exported, haversine × 1.3 otherwise | **Model's own** / **Assumed fallback** — deprecated with instance mode |

## 5. Evaluation

`evaluate.py` writes `kpis.json` (`"schema": "kpis-v3"`) with three blocks, none of which reads
a coefficient from the deprecated part of `kpi_config.json`:

- **`paper`** — the paper's own metrics, computed from the model's solved plan
  (`model_plan.json`) and its full evaluator row (`metrics.json`): served demand total and by
  period, direct-cycling vs PT-assisted split, travel-time savings, the layout built (stations,
  docks, bikes, regular vs transfer), rebalancing (dispatches, bikes moved, cost), covered OD
  ratio, compactness (nearest-neighbour and mean pairwise distance). This is what the
  demonstration headlines.
- **`technical`** — the full `ExperimentRow` the frozen model's evaluator computes
  (`output_handler/metrics_evaluator.py` → `experiment.py`), plus the solver's own statistics
  (`n_variables`, `n_constraints`, `gurobi_status`, `mip_gap`, `wall_clock_s`, `ran_at`). Shown
  under the front end's advanced toggle.
- **`stress_test`** — the §3 replay (`sim_monday.json` / `sim_sunday.json`, when present): served
  %, unserved by cause, peak empty/full stations, explicitly labelled as a demo-side check on
  Geneva's recorded trips, not part of the paper's evaluation.

Real PT volumes still provide one context figure (bike trips per 1,000 PT boardings) shown
alongside, not inside, these three blocks.

## 6. Optimiser results

`results/<scenario>/` hold **real solver output**: `stations.json` (the design), `metrics.json`
(the model's **full** evaluator row — `NetworkDesignRun.experiment_row`, not only the 15
headline keys), `instance.json` (the instance solved, slimmed) and `model_plan.json` (the
solver's full per-period decision — inventories, rebalancing, path assignments). The instance is
53,558 variables / 36,535 constraints, well past the size-limited licence bundled with
`gurobipy`. Each file records, under `run`, the scenario parameters, the solver status, the MIP
gap, the wall clock, and the `src_commit`/`repo_commit` that produced it, so a design can be
audited without re-running it.

The runs are driven by `run_model.py`, which applies a scenario's parameters by replacing
`generate_h3_instances()` in `sys.modules` for the duration of one run — the frozen model source
is never edited. The 18-scenario paper grid (`run_model.PAPER_GRID`) is the demonstration's
current scenario set; the legacy `S1_essential`/`S2_balanced`/`S3_ambitious` (real solver output
from 2026-09-10, at the demo's earlier 20k/80k/140k € budgets and observed-weekday weights
rather than the paper's own bimodal baseline) stay until the grid is run and validated.

## 7. Known limitations

- The stress test's behavioural model is deliberately simple: no within-hour queueing, no rider
  rerouting beyond 2 stations, no bike+PT trip chaining — which is exactly why it is a secondary
  check and not the primary evaluation: the primary evaluation (§5, `paper`) reads served demand,
  the multimodal split and travel-time savings directly from what the model itself decided.
- The stress test replays *recorded* demand, ~125× smaller than the potential-demand day
  (1,453 trips) the designs are sized for: it cannot express demand induced by a better network,
  and a low served % there says more about the recorded volume than about the design. Read it as
  a robustness check, not a service-rate headline.
- PT daily averages divide yearly sums by 52 (holidays uncorrected).
- Today's real network is **not simulated**: its per-station bike stocks over time are not in
  any available source (would require GBFS `station_status` history). Visualization only, by
  decision.
- Dispatch cost is computed twice from the same rebalancing decisions — once inside the frozen
  evaluator's `experiment_row` (`technical.dispatch_cost`) and again by
  `pipeline/model_plan.py` (`paper.dispatch_cost_eur`). **Checked equal** on all 18 committed
  paper-grid `kpis.json` files (within the `paper` block's 2-decimal rounding); the legacy
  `S1`/`S2`/`S3` runs predate the `technical.dispatch_cost` field and were not part of the check.

## 8. The planner game's evaluator (`fixed_design.py`)

`demo/experiments/fixed_design.py` is the normative definition of "evaluate a visitor's station
layout": with the set of open stations `y` fixed, the paper's model collapses to its
**operational sub-problem** (dock sizing, initial fleet, optional truck rebalancing, demand
assignment), which the module solves as an LP relaxation (scipy `linprog`, `method="highs"`) —
constants read live from `network-design-bss/src/util/{cost,util}.py`, never copied
(`AGENTS.md` rule 2). It is the reference the browser engine in
`demo/frontend/src/domain/evaluation/` transcribes for the `/play` planner game
(`demo/frontend/README.md` §"Planner game"); `demo/experiments/game_export.py` writes the
compact payload both engines read from, under `results/shared/game/`, plus 21 golden vectors
that pin the two together.

**Measured fidelity**, on the 21 committed designs (`demo/experiments/tests/test_fixed_design.py`,
`FidelityTests`): the LP reproduces each run's published `paper` served flow within 2%
(measured range 0.9998x–1.0157x, mean 1.005x overshoot — the relaxation of integer `x`/`w`/`v`/
`r`/`n` can only overshoot, never undershoot by more than solver noise) and the PT-assisted
share within 0.015 absolute. The TypeScript engine in turn reproduces the Python LP itself far
more tightly (0.5% relative on served, 0.005 absolute on PT share, in
`domain/evaluation/engine.test.ts`) — the two solve the identical program, so that gap is a
transcription check, not a model-fidelity one.

**What it is not**: a re-run of the MILP. `y` is fixed by the visitor, not chosen by the solver,
so `fixed_design.py` never re-derives which stations to build — only how to operate a given set
of them. `CAPACITY_UB = 30` docks/station (`network-design-bss/src/util/util.py:71`) still caps
what any layout can serve once money stops binding (`AGENTS.md`'s known upstream issue 7).

New assumption-register entries this module and `game_export.py` add:

- **Docks and fleet are sized by the LP, for a visitor layout.** The optimiser's own committed
  designs use the integer MILP's values; a visitor's layout is evaluated by the LP relaxation
  above, not re-solved by Gurobi. This is why the served-flow tolerance above is 2%, not exact.
- **Truck counts are relaxed, and not shown for a visitor's layout.** `n = r /
  CAPACITY_REBALANCING_VEHICLE` is continuous, so the reported dispatch count runs 18–31% high
  on the 21 committed designs. `bikes_rebalanced` / `dispatches_relaxed` are reported for the
  optimiser's own layout (for comparison) but never headlined for what a visitor built; the game
  shows "trips that depend on trucks" (served with trucks minus served without) instead.
- **"Potential trips" is an upper bound, not a service figure.** `reach_options()` /
  `reach_flow()` answer "does at least one candidate path have every station open", the same
  test the LP's demand-gate constraint applies with `y` fixed — it ignores whether the LP can
  actually put a bike there. Measured overestimate against the optimiser's own served flow: 1.04x
  at 80k €, 1.90x at 20k €. The live "within reach" preview in the game and the estimate
  evaluator's calibration both rely on this being an upper bound, never a lower one.
- **The weekday-rush vs slower, week-end-like rhythm question has no week-end data behind it.**
  It compares two runs of the `rhythm` family at the same 80 k€: `rhythm_sharp` (period weights
  0.6/0.2/0.2, a sharp morning peak) stands for "a busy weekday" and `rhythm_uniform` (⅓ each
  period) for "a slower, week-end-like rhythm". Both carry the same 1 453 trips: the second is
  the same day flattened, not a quieter day, and Geneva's measured Sunday profile is
  evening-heavy rather than flat. The answer is computed, not hard-coded: the share of
  `rhythm_sharp`'s built stations that are also built in `rhythm_uniform` (75 of 75, against 84
  stations). No run in the paper grid replays observed week-end demand, and the game's own copy
  states that caveat explicitly.
