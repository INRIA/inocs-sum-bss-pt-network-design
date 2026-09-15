# SPEC — the decision experience: what was designed, from what, and what is assumed

> **v3 (2026-09-15).** The demonstration was realigned with the submitted paper: primary
> evaluation is now the optimisation model's own solution (served demand, PT-assisted share,
> travel-time savings, layout, rebalancing — the paper's own definitions), not a simulated day;
> the simulator's `sample`/`instance` modes, `baseline.py` and the CO₂/economics KPIs below are
> deprecated (kept, not called, removed once the paper-grid runs are validated); the scenario set
> is the paper's 18-run sensitivity grid (budget, operational ratio, ε, temporal profile) rather
> than three budget-only points. The sections below record the original accounting and are kept
> for history — they describe the demo as it stood before this change. Current method and
> numbers: [`README.md`](README.md) and [`METHODS.md`](METHODS.md).

Reference document for the demo layer built on 2026-09-04. It records how the design
was derived from the repository, which numbers are real, which are assumptions, and
which data is synthetic and still to be replaced. Companion documents:
[`README.md`](README.md) (how to use the layer), [`scenarios/README.md`](scenarios/README.md)
(how to run a scenario against the frozen model).

## 1. What the model scan established

- The entire scenario surface of the frozen model is **one function**:
  `generate_h3_instances()` in `network-design-bss/src/instance_builder.py`
  (budget, operational ratio, period count, period weights, seed, split method).
  The budget reaches the solver through
  `src/input_handler/instance_attribute_extracter.py:38`, which copies it into
  `CostParameters` — so no other file needs editing to run a scenario.
- `epsilon` (dispatch-cost weight) is passed at run time via `NetworkDesignRun(epsilon=...)`.
- The committed code draws **random** period weights (`np.random.dirichlet`); the
  scenarios replace them with weights measured from the observed trips so runs are
  reproducible and target the real daily rhythm.
- Model outputs consumed by this layer: `run.stations` (station, lon, lat, capacity,
  initial_bikes) and `run.metrics` (covered_od_ratio, time gains, modal flows, obj_val…),
  both defined in `network-design-bss/sdk-builder/sum_network_design_bss/runner.py`.
- Unit costs in `network-design-bss/src/util/cost.py`: station 100 €, dock 20 €, bike 60 €,
  truck dispatch 40 €, rebalancing 20 €/bike-km, truck capacity 10 bikes. These are the
  **model's own figures**; `pipeline/config.py` imports them from `util/cost.py` at
  runtime (no fallback if the import fails) so simulated spend matches optimiser spend.

> **Update (2026-09-04).** The layer now runs on its own real-data folder
> (`demo/experiments/data/geneva_1.5km-radius/`, incl. GBFS capacities and PT
> ridership), simulates in two documented modes (trace replay of the observed
> trips + resampling at labelled growth scales), and holds stamped placeholder
> optimiser results until the Gurobi runs. The current method reference is
> [`METHODS.md`](METHODS.md); sections below record the original accounting,
> amended where superseded.

## 2. What was measured from real data

All from files in the layer's data folder (`demo/experiments/data/geneva_1.5km-radius/`):

| Fact | Value | Source |
| --- | --- | --- |
| Weekday hourly profile | commute double peak, 8h and 17–18h local | `bike_trips.geojson`, 1 658 trips, 2024-06 → 2024-12 |
| Sunday hourly profile | no morning (2 % of trips before 10h), long afternoon/evening plateau | same |
| Period weights (06–10 / 10–16 / 16–22) | weekday 0.169 / 0.343 / 0.488 — Sunday 0.022 / 0.346 / 0.632 | same, computed by `profiles.py` |
| Sunday ÷ weekday volume | 0.82 | same |
| Fleet mix | 75 % mechanical / 25 % e-bike | `vehicle_type` field |
| Mean observed trip length | ~0.84 km | `distance_in_km` field |
| Spatial demand pattern | 704 OD pairs over 59 cells | `od.csv` (itself derived from the trips by the SDK's `od_builder.py`) |
| Cell centres | (lat, lon) per hex cell | `grid.geojson` `center` property |
| Daily volumes (per day type) | weekday 11.5 / Saturday 9.5 / Sunday 9.4 trips/day | `trips.py` → `data/calibration.json` |
| Station capacities, today's network | 128/139 stations with real capacity | `donkey_station_information.json` (official GBFS), joined by `stations_real.py` |
| PT volumes & peaks | e.g. Monday ≈ 221 k boardings/day in the area, peaks 16–18h | `ridership.geojson`, summarised by `ridership.py` |

One **interpretation** underlies the profiles: the trip timestamps are naive ISO strings
in a field named `trip_started_at_utc`. They were read as UTC and converted to
Europe/Zurich. Read naively instead, the morning peak lands at 06h local, which is not
credible for commuting — the UTC reading puts it at 08h. If the producer actually wrote
local time, the profiles shift by 1–2 h and `profiles.py` must drop the conversion.

## 3. What is assumed or invented — the honest list

Everything below is **not measured**. It lives in `kpi_config.json` (marked PLACEHOLDER
there) or is a design decision in code, and is meant to be recalibrated.

### Scale — resolved (2026-09-04)

~~The simulator replays an invented volume of 800/640 trips per day.~~ The
placeholders are gone: the simulator's base volume is now the **measured**
11.5 (weekday) / 9.4 (Sunday) trips/day from `data/calibration.json`, and the
default mode replays the observed trips themselves (no volume choice at all).
Larger volumes exist only as explicit `--scale` growth hypotheses (×10, ×25),
labelled as such in every output's `method` block. What remains true: today's
observed demand is one operator's feed, not city-level demand — the growth
scales stand in for adoption, as hypotheses.

### Behavioural coefficients (all invented or from literature memory, unsourced)

| Coefficient | Value | Status |
| --- | --- | --- |
| Mode substitution of a served trip (car / PT / walk / induced) | 0.10 / 0.45 / 0.35 / 0.10 | mid-range of European bike-share surveys, from memory — not a citation |
| Fallback of an unserved rider (car / PT / walk-or-forgo) | 0.25 / 0.55 / 0.20 | invented |
| Emission factors g CO₂e/pkm (car / PT blend / bike fleet) | 192 / 55 / 12 | mobitool-style Swiss lifecycle values, from memory — verify against mobitool v3 |
| Equivalences (kg CO₂ per car-day / per tree-year) | 12.6 / 25 | rough, from memory |
| Fare per trip | 2.00 € | invented |
| Maintenance | 0.50 €/bike/day | invented |
| CAPEX amortisation | 8 years | invented |
| Walk catchment 300 m, ride speed 20 km/h | from the model's `util.py` | model's own assumption, reused |
| Ride detour factor 1.3, rider tries 2 stations | invented behavioural rules (the model's own `DETOUR_RATIO = 0.2` is a k-shortest-path enumeration tolerance, not a distance multiplier — no model value exists for this coefficient) | |

### Design decisions in the simulator (simplifications, not data)

- Trips complete within their hour (fine at ≤3 km); no bike+PT routing — the
  multimodal split is taken from the model's `metrics.json` instead.
- Rebalancing: one truck round at 04h **plus an end-of-day restore to initial stocks**
  (added deliberately: without it the day's imbalance was never paid for and operating
  costs looked ~4× too good).
- Seeded RNG (`seed=42`) so a scenario replays identically in front of an audience.

### Scenario budgets

S2 = 80 000 € / 2.5 % is the **published PoC configuration** (see
`h3_instances_json/Geneva_…BUD80000_OP0.0250.txt`). S1 = 20 000 € and
S3 = 140 000 € / 5 % are **choices**, calibrated empirically: at the model's unit
costs, ~40 k€ already saturates the 59-cell area, so visible scarcity (riders finding
no station, empty/full stations) needs ≤20 k€.

## 4. What is synthetic in `results/` right now (updated 2026-09-04)

**Superseded (2026-09-08): `results/S1|S2|S3/` now hold real optimiser output.**
Run on 2026-09-08 with an academic Gurobi licence; all three solved to optimality (status 2, MIP gap ~0). The paragraph below records what was there before.

~~No optimiser output exists yet~~ — no Gurobi licence on this machine until next
week. `results/S1|S2|S3/` therefore held **stamped placeholders** written by
the earlier greedy placeholders (`mock_results.py`, removed 2026-09-09, see git
history): a greedy heuristic that spends each scenario's capital budget on the
real demand distribution at the model's own unit costs and capacity bounds. It
respects budgets and geography, but it is *not* the optimiser: routing,
multimodality and time periods are ignored, and its solver-style metrics (time
gains, flows, obj_val) are order-of-magnitude figures. Every such file carries
`"placeholder": true` + a provenance string, and `kpis.json` surfaces
`placeholder_model_results: true`. The real runs (`scenarios/README.md`)
overwrite them file-for-file with no other change to the pipeline.

`results/baseline_20k/` is produced by `baseline.py` — the deliberately naive
"human intuition" design — and is *meant* to be synthetic; its simulations now
run at the observed scale (replay: 10.8/11.5 served on the average weekday) and
at growth scales for the stress story.

## 5. Recalibration checklist (before public use)

1. ~~`daily_trips`~~ **done**: measured volumes (`data/calibration.json`); regenerate
   from the full one-year OD dataset when available (same schema, nothing downstream
   changes).
2. ~~Replace S1–S3 placeholder results with real model runs~~ **done** (2026-09-08,
   `run_model.py`). Still open from those runs: the naive baseline outperforms S1 at
   an equal 20 k€ on served trips, because the model and the simulator score different
   objectives — the "human vs optimiser" framing needs revisiting (README, known gaps).
3. Mode-substitution and fallback shares — local survey or literature with citations.
4. Emission factors and equivalences — mobitool v3 / a citable Swiss source.
5. Fare, maintenance, amortisation — operator figures.
6. Confirm the timestamp timezone with the data producer (§2) — now additionally
   cross-validated against the PT ridership peaks (`ridership.py`), which agree with
   the UTC reading.
7. Optionally: GBFS `station_status` history (weekly sampling) to give today's real
   network observed stocks and make it simulatable; Saturday as a third day type
   (volume measured already, hourly profile one step away).
