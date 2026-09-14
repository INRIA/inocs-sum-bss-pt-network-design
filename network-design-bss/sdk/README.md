# Published artefacts

Everything in this folder is **generated** from the sources in the repository and committed so
that it can be installed and read without a build step. Nothing here is edited by hand; the
build scripts and the release procedure are documented in
[`../sdk-builder/README.md`](../sdk-builder/README.md).

| Path | Produced by | Contents |
| --- | --- | --- |
| `sum_network_design_bss-<version>-py3-none-any.whl` | `sdk-builder/build_package.py` | The installable package: the `sdk-builder/sum_network_design_bss/` layer under its distribution name, with `../src/` and the Geneva sample bundled inside it as `model_src/`. |
| `docs/` | `sdk-builder/build_docs.py` | pdoc API documentation for that package. Open `docs/index.html` locally. |
| `legacy/` | — | A superseded 0.1.0 build and its documentation, kept for reference. Not installable on anything but CPython 3.9 on macOS. |

## Install

```sh
pip install network-design-bss/sdk/sum_network_design_bss-0.2.0-py3-none-any.whl
# or straight from GitHub, without cloning:
pip install https://github.com/INRIA/inocs-sum-bss-pt-network-design/raw/main/network-design-bss/sdk/sum_network_design_bss-0.2.0-py3-none-any.whl
```

The wheel is pure Python (`py3-none-any`), so it installs on any platform and on any interpreter
from 3.9 up.

```python
from sum_network_design_bss import NetworkDesignRun

run = NetworkDesignRun(work_dir="./bss-run").execute()
print(run.metrics)
```

`work_dir` is where the run unpacks its own copy of the model and writes its caches, plots and
results. It is required when running from the wheel: the installed copy lives under
`site-packages`, which a run must not write into.

A Gurobi licence large enough for the instance is needed to solve. The licence bundled with
`gurobipy` stops at 2000 variables and 2000 constraints, which the Geneva sample exceeds;
academic licences are free at <https://www.gurobi.com/academia/>.

## Rebuild

From the repository root:

```sh
pipenv run python network-design-bss/sdk-builder/build_package.py     # wheel
pipenv run python network-design-bss/sdk-builder/build_docs.py        # docs/
```

Both assemble the same staging tree under `build/package/`, so the wheel and the documentation
always describe the same code. Bump `__version__` in
`network-design-bss/sdk-builder/sum_network_design_bss/__init__.py` before building a release,
delete the wheel of the previous version, and commit what the two commands write.

## Why the model is bundled rather than depended on

`../src/` is a set of *top-level* modules — `util`, `model`, `network`, `config` — that import
each other absolutely. Installing those names at the top level of an environment would collide
with almost anything, so they ship as package data inside `sum_network_design_bss/model_src/`
and are put on `sys.path` at `bootstrap()` time instead. That also keeps them byte-for-byte
identical to the frozen source, which is the constraint the whole repository is built around.

## The superseded 0.1.0 build

`legacy/shared_mobility_network_optimizer-0.1.0-cp39-cp39-macosx_10_9_universal2.whl` is a
Cython-compiled build of an **earlier** version of the same model. It is kept for reference only:

- its `cp39` / `macosx_universal2` tags make it installable only on CPython 3.9 on macOS;
- it exports top-level `config/`, `input_handler/`, `model/`, `network/` and `output_handler/`
  packages, so having it installed alongside a checkout would silently decide which copy of the
  model you are running.

Its documentation is in `legacy/docs/`.
