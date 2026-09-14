# `sdk-builder/` — the runnable layer over the frozen model, and how it is built

This folder is everything this repository adds so that the optimisation model in
`../src/` can be run, packaged and documented **without modifying it**. Human overview of the
whole project: [../../README.md](../../README.md). Agent orientation: [../../AGENTS.md](../../AGENTS.md).

| Path | Role |
| --- | --- |
| `sum_network_design_bss/runner.py` | `NetworkDesignRun` — drives the pipeline, one method per stage. Behind `python -m sum_network_design_bss`, in a checkout and from the installed wheel alike. |
| `sum_network_design_bss/compat.py` | `bootstrap()` — locates the model, prepares the process, applies the runtime patches below. |
| `sum_network_design_bss/od_builder.py` | Builds `od.csv` from `bike_trips.geojson` by point-in-polygon assignment to grid zones. |
| `build_package.py` | Builds the wheel into `../sdk/`. |
| `build_docs.py` | Builds the pdoc API documentation into `../sdk/docs/`. |
| `sync_requirements.py` | Keeps the root `Pipfile` in step with `../src/requirements.txt`. Repository tooling, not shipped. |

The package is named after its import name so that it imports identically from a checkout
(with this folder on `PYTHONPATH`) and once installed from the wheel.

## The frozen model

`../src/` is Zhenyu Wu's model, synced from upstream and topped by the commit *"Submitted
version"*. **None of its `.py` files may change**: the results it produces have to stay
attributable to the code as submitted. Only three things inside it are ours to add —
`requirements.txt`, `.gitignore` and `data/geojson/`. Acceptance test:

```bash
git status --short network-design-bss/src     # must list no modified .py file
```

Everything that would otherwise have been an edit lives here instead. `NetworkDesignRun` calls
`bootstrap()` itself; a script or notebook that drives the frozen modules directly must start
with it:

```python
from sum_network_design_bss.compat import bootstrap
PACKAGE = bootstrap()
```

`bootstrap()` puts the model folder on `sys.path`, changes the working directory into it (the
model resolves some paths from `__file__` and others from the cwd, and this is the only place
the two agree), creates the output directories it writes into, and applies the runtime patches.
Call it **before importing anything from the model**: 29 of its modules do
`from util.util import *`, which copies module-level constants at import time.

| Patch | Compensates for |
| --- | --- |
| `sys.modules` stub for `model.benders_optimization` | An earlier `model/sequential_optimization.py` imported a module that was never committed. Upstream has since dropped the import; the stub is kept and is harmless. |
| Guard on `osmnx.distance.add_edge_lengths` | `network/osmnx_network.py` calls it *after* `project_graph()`. It reads node `x`/`y` as degrees, so on UTM coordinates it overwrites every correct edge length with one about 86 000× too large. |
| Memoised `G.to_undirected()` | `network/osmnx_network.py` rebuilds an undirected copy of the whole street graph on every shortest-path query (0.809 s against 0.027 s for the search that follows). Results are identical. |
| Saved/restored `sys.stdout` around the solve | `model/model_template.py` routes the Gurobi log to a file, then restores with `sys.stdout = sys.__stdout__`, which in a Jupyter kernel is the *process* stdout — every later `print` would leave the notebook. |

### Solve modes

`optimization_model_solver()` in `../src/model/sequential_optimization.py` dispatches
`"integrated"` (one mixed-integer program, the exact optimum) and `"sequential"` (design first,
then operations). `runner.SOLVE_MODES` also lists `"benders"` and `"alns"`: neither is
implemented in the frozen tree. `../src/alns_solver/` is an experimental heuristic with its own
benchmark script and design notes (`../src/docs/`, in Chinese); it is not reachable through the SDK.

## Two ways to run

|  | Clone the repository | Install the wheel |
| --- | --- | --- |
| Get it | `git clone …` then `pipenv install --dev` | `pip install …/sum_network_design_bss-0.2.0-py3-none-any.whl` |
| Import | `from sum_network_design_bss import NetworkDesignRun` (with this folder on `PYTHONPATH`) | same |
| Where it runs | in place, inside `../src/` | in a `work_dir` of your choosing (required: `site-packages` must not be written to) |
| Good for | following the notebooks, reproducing a published run, working on the demo | using the model from another project |

The wheel is `sum_network_design_bss/` with `../src/` and the Geneva sample bundled inside it as
`model_src/`. `--export DIR` (or `run.export(DIR)`) copies the station GeoJSON a solve produced.

## Where the dependencies come from

`../src/requirements.txt` is the single source of truth for runtime dependencies. The root
`Pipfile`'s `[packages]` section is **generated from it** — do not edit that section by hand and
do not `pipenv install <package>`:

```bash
# 1. add the requirement to network-design-bss/src/requirements.txt
# 2. regenerate [packages]
python network-design-bss/sdk-builder/sync_requirements.py
# CI / pre-commit: fails with a diff if the two have drifted
python network-design-bss/sdk-builder/sync_requirements.py --check
```

`[dev-packages]` is hand-maintained: pytest, the notebook tooling, and the
`build`/`setuptools`/`wheel`/`pdoc` set used below.

## Python versions

`../src/` needs **Python ≥ 3.9** (PEP 585 builtin generics in annotations). On an older
interpreter it fails at *import* with `TypeError: 'type' object is not subscriptable` — that is
the interpreter, not a dependency. Verified on 3.13 and 3.14.

The `Pipfile` deliberately carries **no `[requires] python_version` pin**: a pin is the first
thing pipenv checks, and a missing interpreter aborts the install before any dependency is
resolved. To reproduce a run on a specific interpreter: `pipenv --python 3.13 install --dev`.

Diagnose an existing environment with `python -c "import sys; print(sys.version, sys.executable)"`
or `cat env/pyvenv.cfg`. To install interpreters side by side we use [`uv`](https://docs.astral.sh/uv/):

```bash
uv python install 3.13
rm -rf env && uv venv env --python 3.13 && source env/bin/activate
uv pip install pipenv && pipenv install --dev
```

Re-select the notebook kernel afterwards (VS Code: *Python: Select Interpreter*, or the kernel
picker) and re-run from the top.

On Debian-like systems with an externally-managed Python, create a venv first
(`python3 -m venv env && source env/bin/activate && pip install pipenv`); pipenv installs into it.

## Build and publish the package

Everything in `../sdk/` is generated and committed, so the model can be installed and its API
read without cloning or building. From the repository root:

```bash
pipenv run python network-design-bss/sdk-builder/build_package.py     # -> network-design-bss/sdk/*.whl
pipenv run python network-design-bss/sdk-builder/build_docs.py        # -> network-design-bss/sdk/docs/
pipenv run python network-design-bss/sdk-builder/build_docs.py --serve   # preview on http://localhost:8080
```

| Command | What it does |
| --- | --- |
| `build_package.py` | Stages `sum_network_design_bss/`, copies `../src/` into it as `model_src/` (sources and GeoJSON inputs, no caches or results), generates `pyproject.toml` from `__version__` and `../src/requirements.txt`, builds a pure-Python (`py3-none-any`) wheel. `--stage-only` to inspect the staging tree under `build/package/` (gitignored). |
| `build_docs.py` | Runs `pdoc` over the *same* staged tree, so wheel and docs always describe the same code. Only this layer is documented: the frozen modules read their constants at import time and cannot be imported by pdoc out of a prepared process; `notebooks/gva_demo.ipynb` documents them stage by stage instead. |

The GitHub Pages workflow currently publishes only the front-end (`demo/frontend/dist`), so the
committed `../sdk/docs/` is read locally (`index.html`) or via `--serve`.

### Release checklist

```bash
# 1. bump the version, declared in one place:
#    network-design-bss/sdk-builder/sum_network_design_bss/__init__.py   __version__ = "0.2.0"
# 2. rebuild both artefacts
pipenv run python network-design-bss/sdk-builder/build_package.py
pipenv run python network-design-bss/sdk-builder/build_docs.py
# 3. keep exactly one wheel in the folder
git rm network-design-bss/sdk/sum_network_design_bss-<old-version>-*.whl
# 4. commit
git add network-design-bss/sdk network-design-bss/sdk-builder
git commit -m "build: sum_network_design_bss <version>"
```

### Why the model is bundled rather than depended on

`../src/` is a set of *top-level* modules — `util`, `model`, `network`, `config`, … — that import
each other absolutely. Installing those names at the top level of an environment would collide
with almost anything, so the wheel ships them as package data under
`sum_network_design_bss/model_src/` and puts that directory on `sys.path` at `bootstrap()` time.
That is also the only way to bundle them without editing them.

The superseded **0.1.0** build (`../sdk/legacy/`) did claim those top-level names and was a
Cython build installable only on CPython 3.9 / macOS. Kept for reference only.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `TypeError: 'type' object is not subscriptable` on import | Interpreter older than 3.9 | [Python versions](#python-versions) |
| Notebook errors on an import that works from the terminal | Kernel is not the pipenv interpreter | Re-select the kernel |
| `pipenv: command not found` after activating a fresh venv | pipenv not installed into it | `pip install pipenv` |
| Gurobi error about model size (2000 variables / 2000 constraints) | Bundled size-limited licence | Free [academic licence](https://www.gurobi.com/academia/) |
| `git status` shows a modified `.py` under `network-design-bss/src/` | The frozen model was edited | Revert it |
| `PermissionError: … is not writable` from `bootstrap()` | Running from the installed wheel without `work_dir` | Pass `work_dir="./bss-run"` (or `--work-dir`) |
| `FileNotFoundError: … is missing grid.geojson, …` | Input directory name ≠ `h3_version` in `util/util.py` | Rename the directory |
| `ModuleNotFoundError: No module named 'util'` | A frozen module was imported before `bootstrap()` | Call `bootstrap()` first, or use `NetworkDesignRun` |
| First run takes ~50 min | Shortest-path enumeration, uncached | Normal; cached afterwards (~11 s) |
