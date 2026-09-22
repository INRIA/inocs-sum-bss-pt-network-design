# Network Design of Bike Sharing Systems with Public Transport Integration

An optimisation model that decides **where to build bike-sharing stations, how many docks each
gets and how many bikes it starts the day with**, so that a bike-sharing system serves as much
demand as possible — direct cycling trips *and* trips that combine cycling with public transport
— under an infrastructure budget and a rebalancing budget. The model is a path-based integer
program solved with Gurobi; it was developed by the INOCS team at Inria Lille and applied to the
Geneva living lab of the EU **SUM — Seamless Shared Urban Mobility** project.

This repository contains the model, a small SDK to run it, a Geneva sample instance, the paper's
sensitivity grid of scenarios with KPI evaluation and a stress-test replay, three notebooks, and
the interactive web demo built from those results.

| | |
| --- | --- |
| 🗺️ **Interactive demo** | <https://inria.github.io/inocs-sum-bss-pt-network-design/> — *"Where should the bikes live?"*, a five-step decision experience built around the four questions the paper's sensitivity analysis answers, on the Geneva sample |
| 🎮 **Play the planner** | [`/play`](https://inria.github.io/inocs-sum-bss-pt-network-design/play/) — place the stations yourself on a budget, then compare against what the paper's own optimiser does with the same money |
| 📄 **Paper** | *Network Design of Bike Sharing Systems with Public Transport Integration* — see [The research](#the-research) |
| 🇪🇺 **Project** | [SUM — Seamless Shared Urban Mobility](http://sum-project.eu/) (Horizon Europe); this tool on the [SUM Open Data Platform](https://odp.sum-project.eu/tools/resources/6) |
| 📦 **Install without cloning** | the [built wheel](network-design-bss/sdk/) bundles the model and the Geneva sample; API docs in [`network-design-bss/sdk/docs/`](network-design-bss/sdk/docs/) |
| 🧭 **Contributing / agents** | [AGENTS.md](AGENTS.md) — layout, rules and commands for people and coding agents working on the repository |

## The research

**Network Design of Bike Sharing Systems with Public Transport Integration**
Zhenyu Wu¹, Shadi Sharif Azadeh², Luce Brotcorne¹ (corresponding author, luce.brotcorne@inria.fr)
¹ INOCS team, Centre Inria de l'Université de Lille, Villeneuve d'Ascq, France
² Department of Transport and Planning, Delft University of Technology, Delft, The Netherlands
*Manuscript in preparation.*

> Bike sharing systems (BSS) are increasingly deployed as a flexible first- and last-mile layer
> that complements fixed public transport (PT) networks. Effective integration requires
> coordinated infrastructure decisions on station locations, docking capacities, and fleet
> allocation that account for both multimodal travel patterns and operational sustainability
> under limited budgets. We propose a path-based integer programming formulation that maximizes
> served bike-related demand, covering direct cycling and PT-integrated cycling trips, under
> joint infrastructure and rebalancing budget constraints. Multimodal paths are pre-generated for
> each origin–destination (OD) pair and path feasibility is enforced endogenously through station
> activation constraints. Rebalancing is incorporated as an aggregate flow representation, and a
> penalty term on operational cost is added to the objective to favor solutions with lower
> operational cost among those with equivalent coverage levels. The model is applied to Geneva
> where the OD matrix is estimated by combining survey data and stop-level ridership counts via
> Iterative Proportional Fitting, interpreted as a proxy for potential multimodal demand.
> Computational experiments confirm tractability on realistic instances and robustness of served
> demand coverage to the penalty coefficient. Sensitivity analyzes reveal diminishing returns to
> infrastructure investment, and show that the temporal structure of demand affects both the
> spatial configuration of deployed stations and the achievable level of served demand.

In one picture: for every origin–destination pair the model pre-enumerates a few candidate
paths (bike-only, and bike + public transport), then chooses which candidate stations to open
(*y*), their capacity (*w*), their initial stock (*v*), how much demand each path carries (*x*)
and how many rebalancing truck moves to make (*n*), maximising served demand minus an
ε-weighted rebalancing cost, subject to a capital budget (stations 100 € + docks 20 € + bikes
60 €) and an operational budget. The formulas, as implemented, are written out in
[`demo/experiments/README.md`](demo/experiments/README.md#stage-3--the-optimisation-model).

> **Note on the data shipped here.** The OD matrix described in the paper (survey + ridership,
> fitted by IPF) is not distributed in this repository. The committed Geneva sample
> (`geneva_1.5km-radius`: 59 H3 cells, 438 PT stops) carries an `od.csv` of 703 OD pairs /
> 1,453 trips counted directly from observed shared-bike trips, which is what every result and
> notebook here is computed on.

## What is in this repository

| Path | What it is | Read |
| --- | --- | --- |
| [`network-design-bss/src/`](network-design-bss/src/) | **The model** (Zhenyu Wu). Instance building, multimodal network and *k*-shortest paths, the Gurobi formulation (`model/`), metrics and plots. Kept byte-identical to the submitted version; `docs/` holds the author's research notes on the ALNS heuristic and solver scale tests (in Chinese). | [`src/docs/`](network-design-bss/src/docs/) |
| [`network-design-bss/sdk-builder/`](network-design-bss/sdk-builder/) | **The SDK** `sum_network_design_bss`: `NetworkDesignRun`, the runtime shims that let the frozen model run unmodified, the OD-table builder, and the scripts that build the wheel and its docs. | [README](network-design-bss/sdk-builder/README.md) |
| [`network-design-bss/sdk/`](network-design-bss/sdk/) | The **built wheel** and its **API documentation**, committed so nothing needs building. | [README](network-design-bss/sdk/README.md) |
| [`demo/experiments/`](demo/experiments/) | **Scenario grid, evaluation, stress test**: the paper's 18-run sensitivity grid (budget, operational ratio, ε, temporal profile) run through the real model, KPI evaluation in the paper's own terms, and a stdlib replay of Geneva's observed trips kept as a labelled stress test. Its `results/` are the data the web demo shows. | [README](demo/experiments/README.md) · [METHODS](demo/experiments/METHODS.md) · [SPEC](demo/experiments/SPEC.md) · [scenarios](demo/experiments/scenarios/README.md) · [tests](demo/experiments/tests/README.md) |
| [`demo/frontend/`](demo/frontend/) | **The web demo**: a static Astro + React site, English/French, built from `demo/experiments/` and published to GitHub Pages. | [README](demo/frontend/README.md) |
| [`notebooks/`](notebooks/) | Three Jupyter notebooks — see [Notebooks](#notebooks). | |

## Quick start

**Requirements.** Python ≥ 3.9, [pipenv](https://pipenv.pypa.io/), and a Gurobi licence: the
size-limited licence bundled with `gurobipy` (2,000 variables / 2,000 constraints) is far too
small for the Geneva instance (~53,000 variables / ~36,500 constraints). Academic licences are
free at <https://www.gurobi.com/academia/>.

```bash
git clone https://github.com/INRIA/inocs-sum-bss-pt-network-design.git
cd sum-network-design-bike-sharing
pip install pipenv
pipenv install --dev
```

**Run the model on the Geneva sample**, from Python:

```python
import sys
sys.path.insert(0, "network-design-bss/sdk-builder")

from sum_network_design_bss import NetworkDesignRun

run = NetworkDesignRun(solve_mode="integrated", epsilon=0.04).execute()

run.metrics["n_selected_stations"], run.metrics["covered_od_ratio"]   # 80, 0.925 on the sample
run.stations_frame().head()      # station, type, lon, lat, capacity, initial_bikes
run.export("out/")               # the selected stations as GeoJSON
```

or from the shell:

```bash
PYTHONPATH=network-design-bss/sdk-builder pipenv run python -m sum_network_design_bss
PYTHONPATH=network-design-bss/sdk-builder pipenv run python -m sum_network_design_bss --export out/
PYTHONPATH=network-design-bss/sdk-builder pipenv run python -m sum_network_design_bss --help
```

`execute()` runs four stages that are also callable one by one — `build_instance()`,
`build_network()`, `solve()`, `report()` — so a session can stop between any two of them.
`solve_mode` is `"integrated"` (one mixed-integer program, the exact optimum) or `"sequential"`
(design first, then operations); `epsilon` is the weight of the rebalancing cost in the objective.
The first run spends about **50 minutes** enumerating shortest paths over the street network;
that stage is cached and takes ~11 s afterwards. The solve itself takes ~15 s.

**Use it from another project** without cloning: install the wheel and give it a working directory.

```bash
pip install https://github.com/INRIA/inocs-sum-bss-pt-network-design/raw/main/network-design-bss/sdk/sum_network_design_bss-0.2.0-py3-none-any.whl
```

```python
from sum_network_design_bss import NetworkDesignRun
run = NetworkDesignRun(work_dir="./bss-run").execute()
```

The full API is documented in [`network-design-bss/sdk/docs/`](network-design-bss/sdk/docs/);
installation details, Python-version notes and troubleshooting are in the
[SDK builder README](network-design-bss/sdk-builder/README.md).

## Notebooks

```bash
pipenv run jupyter notebook notebooks/
```

| Notebook | What it shows |
| --- | --- |
| [`gva_demo.ipynb`](notebooks/gva_demo.ipynb) | **The pipeline, step by step, on Geneva**: the 1.5 km input sample, the OD demand, the instance, the multimodal network and shortest paths, the solve, the metrics, the selected design and its map. Start here to see *how* the model works. |
| [`simulation_demo.ipynb`](notebooks/simulation_demo.ipynb) | **The reference run**: what the model optimises, the values a run should reproduce, every tunable parameter, and the known gaps. |
| [`demo_scenarios.ipynb`](notebooks/demo_scenarios.ipynb) | **The paper's scenario grid end to end**: generate the 18 scenario JSONs, run them through the model one at a time (Gurobi, user-run), replay the observed-trip stress test, evaluate against the paper's own metrics, and compare across the four questions. |

If the notebook is opened from VS Code or a Jupyter server started outside `pipenv run`, select
the pipenv environment as the kernel first.

## Demo and experiment scenarios

[`demo/experiments/`](demo/experiments/README.md) stages the four questions the paper's own
sensitivity analysis answers: how much a city should invest and where the next euro stops
paying off; when bike sharing starts feeding trams and buses instead of just replacing short
rides; whether money is better spent on rebalancing trucks or on more docks and stations; and
whether the rhythm of the day — commuters on Monday, leisure on Sunday — changes where stations
should go. Every run shares the paper's potential-demand day (1 453 trips, 703 OD pairs, 100
candidate stations, T = 3 periods); the paper's own baseline (Table D.8: 80 000 €, operational
ratio 5 %, ε = 0.04, bimodal profile 0.40/0.20/0.40) is the reference every other run varies
exactly one parameter from, so every difference in outcome is attributable to that one change.

The full grid is **18 runs** across four families — budget (six points, 20–120 k€),
operational ratio (five points, 0–12.5 %), ε (five points, 0–0.12) and temporal profile
(bimodal / uniform / unimodal-sharp / the observed Geneva weekday) — generated with
`python -m demo.experiments.run_model --write-scenarios` and solved one scenario at a time
(Gurobi) from [`notebooks/demo_scenarios.ipynb`](notebooks/demo_scenarios.ipynb); nobody else
runs the experiments. Three budget points are the cards the web demo leads with:

| | Essential | Reference | Ambitious |
| --- | --- | --- | --- |
| Budget | 60 000 € | 80 000 € — the paper's baseline (Table D.8) | 120 000 € |

Until the grid is run, the site still shows the three scenarios it shipped with before this
realignment (`S1_essential` / `S2_balanced` / `S3_ambitious`, at 20 k€ / 80 k€ / 140 k€ with the
observed Geneva weekday weights rather than the paper's bimodal profile), flagged `legacy: true`
— real Gurobi solves from 2026-09-10, kept only until the paper grid replaces them.

Every KPI the demo shows is read from **the model's own solution** — served demand per period,
the share of served trips routed through public transport, travel-time savings, the layout
built (regular vs transfer stations, fill ratio, compactness), the rebalancing it needs —
exactly as the paper reports them, not from a re-simulation. A separate, clearly labelled
**stress test** replays the trips Geneva actually recorded (`simulate.py`, ~125× smaller than
the planning day) as a demo-side robustness check, not part of the paper's own evaluation.
Every number carries its provenance, and the assumption register is in
[`METHODS.md`](demo/experiments/METHODS.md).

```bash
python3 -m demo.experiments.run_model --write-scenarios                                       # generate the 18 scenario JSONs
python3 -m demo.experiments.run_model budget_080k                                             # one model run (Gurobi); the notebook is the supported way
python3 -m demo.experiments.simulate --stations demo/experiments/results/budget_080k/stations.json --day monday   # stress-test replay only
python3 -m demo.experiments.evaluate demo/experiments/results/budget_060k demo/experiments/results/budget_080k demo/experiments/results/budget_120k --compare
```

Evaluation and the stress-test replay run on the standard library alone; only `run_model` needs
the full environment and a Gurobi licence. How a scenario is defined and generated, and how to
add one to the grid: [`scenarios/README.md`](demo/experiments/scenarios/README.md).

### The web demo

<https://inria.github.io/inocs-sum-bss-pt-network-design/> is
[`demo/frontend/`](demo/frontend/README.md), a static site whose only data source is
`demo/experiments/` (scenarios, results, the sample's grid, stops, lines and stations). Five
steps as header tabs — the questions, the city, choose a plan, the results, compare plans — walk
from the four questions above to a plan built by the model and its consequences; an "Advanced
view" toggle reveals the full technical metrics (objective value, MIP gap, solve time, covered
OD pairs, compactness, …) alongside the headline numbers. It is **published automatically by
GitHub Pages** on every push to `main` that touches the front-end or the experiment data
([`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)), so regenerating
results and pushing is the whole publication flow. Adding a results folder plus a scenario JSON
adds a scenario to the site without code changes.

```bash
cd demo/frontend
npm install
npm run dev        # http://localhost:4321/inocs-sum-bss-pt-network-design/
```

## Input data

The model reads one directory of five files, `network-design-bss/src/data/geojson/<h3_version>/`
(`h3_version` is set in `network-design-bss/src/util/util.py`, currently `geneva_1.5km-radius`):

| File | Contents |
| --- | --- |
| `grid.geojson` | H3 hexagonal grid over the study area (resolution 9) |
| `stops.geojson` | Public transport stops |
| `itineraries.geojson` | Public transport lines with travel time per segment |
| `bike_trips.geojson` | Observed shared-bike trips |
| `od.csv` | Origin–destination demand between grid cells, derived from the trips (`python -m sum_network_design_bss.od_builder`) |

The GeoJSON files are produced from a GTFS feed and the operator's trip data by the companion
package [inocs-sum-gtfs-geojson](https://github.com/INRIA/inocs-sum-gtfs-geojson); pointing the
model at another area means producing that directory for it. `demo/experiments/data/` holds the
demo's own copy plus the observed layers it adds (GBFS station capacities, PT ridership, POIs).

## Tests

```bash
pytest                                                                          # demo pipeline suite
DEMO_TESTS_FAST=1 python3 -m unittest discover -s demo/experiments/tests -t .   # same, skipping the slow replay
```

Golden tests pin the committed calibration, simulation and KPI artefacts, and parity tests pin
the constants the demo shares with the model — see [`tests/README.md`](demo/experiments/tests/README.md).

## Contributing

The model under `network-design-bss/src/` is **not edited in this repository**: it is synced
from its author and its results must stay attributable to the submitted code. Everything needed
to run it lives beside it, and [AGENTS.md](AGENTS.md) lists the rules, the layout and the
commands to verify a change. Questions about the formulation or the results belong to the
authors; questions about installing, running or the demo belong here.

## Acknowledgements and funding

The optimisation model is the work of Zhenyu Wu ([@Curryforfire](https://github.com/Curryforfire)),
with Shadi Sharif Azadeh and Luce Brotcorne. The SDK, the demonstration, the notebooks and the
web demo are maintained in this repository by Rebeca Murillo (Inria, INOCS).

This work is carried out as part of the **SUM — Seamless Shared Urban Mobility** project
(<http://sum-project.eu/>), funded by the **European Union's Horizon Europe research and
innovation programme**. Views and opinions expressed are those of the author(s) only and do not
necessarily reflect those of the European Union or the granting authority; neither the European
Union nor the granting authority can be held responsible for them.

## License

[European Union Public Licence v. 1.2 (EUPL-1.2)](LICENSE) — see [eupl.eu](https://eupl.eu/).
