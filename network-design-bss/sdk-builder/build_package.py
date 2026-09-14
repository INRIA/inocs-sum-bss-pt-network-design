"""
File: build_package.py
Description: Build the distributable wheel of this repository.

The wheel bundles two things that live apart in the checkout:

  - `sdk-builder/sum_network_design_bss/`, the layer this repository maintains,
    already named after the import name;
  - `network-design-bss/src/`, the frozen model, copied verbatim into
    `sum_network_design_bss/model_src/` together with its GeoJSON inputs.

It is copied rather than imported because the model is a set of *top-level*
modules -- `util`, `model`, `network`, `config` -- that import each other
absolutely (`from util.util import *`, 29 times over). Installing those names at
the top level of a user's environment would collide with almost anything;
shipping them as package data and putting the directory on `sys.path` at
`bootstrap()` time keeps the frozen imports working without claiming a single
common name. It is also the only way to bundle them without editing them, which
is the constraint the whole repository is built around.

    python network-design-bss/sdk-builder/build_package.py                 # -> network-design-bss/sdk/*.whl
    python network-design-bss/sdk-builder/build_package.py --stage-only    # assemble build/package/, build nothing

The wheel is pure Python (`py3-none-any`), so unlike the superseded 0.1.0 build
under `network-design-bss/sdk/legacy/` it installs on any interpreter and
any platform that satisfies `requires-python`.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent          # network-design-bss/sdk-builder/
ROOT = HERE.parents[1]                          # repository root

#: Import name of the built package. Distribution name is the hyphenated form.
PACKAGE_NAME = "sum_network_design_bss"
DISTRIBUTION = "sum-network-design-bss"

#: Where the assembled build context goes. Git-ignored.
STAGING = ROOT / "build" / "package"

#: Where finished artefacts are committed. Kept flat so the wheel sits beside
#: the docs generated from the same source.
ARTEFACTS = ROOT / "network-design-bss" / "sdk"

MODEL = ROOT / "network-design-bss" / "src"
LAYER = HERE / PACKAGE_NAME

#: Modules of the layer that belong in the wheel, listed explicitly so a stray
#: file dropped next to them never ships by accident.
LAYER_MODULES = ("__init__.py", "__main__.py", "compat.py", "od_builder.py",
                 "runner.py")

#: Everything the model writes rather than reads. Copying it would bloat the
#: wheel with one machine's caches and make two builds differ.
MODEL_EXCLUDES = shutil.ignore_patterns(
    "__pycache__", "*.pyc", "*.pyo", ".DS_Store", ".git", ".gitignore",
    "osm_cache", "cache", "plot", "h3_instances_json", "output",
    "shortest_paths_result", "diagnostics",
    "experiment_results.csv", "optimization_statistics_results_*.csv",
    "*.log", "*.lp", "*.mps", "*.sol",
)

CLASSIFIERS = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Science/Research",
    "License :: OSI Approved :: European Union Public Licence 1.2 (EUPL 1.2)",
    "Operating System :: OS Independent",
    "Programming Language :: Python :: 3",
    "Topic :: Scientific/Engineering",
]

PACKAGE_README = """\
# sum-network-design-bss

Bike-sharing network design with bilevel optimisation, from the SUM (Shared
Urban Mobility) project. The package bundles the optimisation model together
with the layer that runs it, so a design can be computed in three lines.

```python
from sum_network_design_bss import NetworkDesignRun

run = NetworkDesignRun(work_dir="./bss-run").execute()
print(run.metrics)
print(run.stations[:5])
```

`work_dir` is where the run unpacks its own copy of the model and writes its
caches, plots and results. The model ships with a Geneva sample -- a 1.5 km
radius at H3 resolution 9 -- which is what a run reads unless the inputs under
`<work_dir>/data/geojson/` are replaced.

From a shell:

```sh
sum-network-design-bss --work-dir ./bss-run --export ./out
```

## Requirements

A Gurobi licence large enough for the instance. The licence bundled with
`gurobipy` stops at 2000 variables and 2000 constraints, which the Geneva sample
exceeds; academic licences are free: <https://www.gurobi.com/academia/>.

## Source and documentation

<https://github.com/INRIA/inocs-sum-bss-pt-network-design>

The optimisation model under `model_src/` is maintained upstream by Zhenyu WU
and is bundled here unmodified.

Licensed under the European Union Public Licence v. 1.2 (EUPL-1.2).
"""


def read_version():
    """Read `__version__` out of the layer without importing it.

    Importing the package would pull in shapely and the rest of the runtime,
    which a build machine does not need.

    :return: the version string.
    :raises ValueError: if the layer's `__init__.py` declares no `__version__`.
    """
    for line in (LAYER / "__init__.py").read_text().splitlines():
        if line.startswith("__version__"):
            return line.split("=", 1)[1].strip().strip('"\'')
    raise ValueError(f"No __version__ in {LAYER / '__init__.py'}")


def read_dependencies():
    """Read the model's runtime dependencies.

    `network-design-bss/src/requirements.txt` is the single source of truth for
    what the model needs: the root `Pipfile` is generated from it by
    `sdk-builder/sync_requirements.py`, and so is this list. Comment lines are dropped,
    including the commented-out optional entries.

    :return: list of PEP 508 requirement strings.
    """
    requirements = []
    for raw in (MODEL / "requirements.txt").read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            requirements.append(line)
    return requirements


def render_pyproject(version, dependencies):
    """Build the pyproject.toml the staged tree is built with.

    Generated rather than committed so that the version and the dependency list
    cannot drift from the layer's `__init__.py` and the model's `requirements.txt`.

    :param version: version string from read_version().
    :param dependencies: requirement strings from read_dependencies().
    :return: the file contents.
    """
    listed = "\n".join(f'    "{item}",' for item in dependencies)
    classifiers = "\n".join(f'    "{item}",' for item in CLASSIFIERS)
    return f"""\
# Generated by build_package.py -- edit that script, not this file.

[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "{DISTRIBUTION}"
version = "{version}"
description = "Bike-sharing network design with bilevel optimisation (SUM project)"
readme = "README.md"
requires-python = ">=3.9"
authors = [
    {{ name = "Zhenyu WU" }},
    {{ name = "Rebeca MURILLO" }},
]
keywords = ["bike sharing", "network design", "optimisation", "public transport", "mobility"]
classifiers = [
{classifiers}
]
dependencies = [
{listed}
]

[project.urls]
Homepage = "https://github.com/INRIA/inocs-sum-bss-pt-network-design"
Documentation = "https://inria.github.io/inocs-sum-bss-pt-network-design/network-design-bss/sdk/docs"

[project.scripts]
{DISTRIBUTION} = "{PACKAGE_NAME}.runner:main"

[tool.setuptools]
packages = ["{PACKAGE_NAME}"]

[tool.setuptools.package-data]
{PACKAGE_NAME} = ["model_src/**/*"]
"""


def stage(destination=STAGING):
    """Assemble the build context: layer, model and generated metadata.

    :param destination: directory to build into. Wiped first.
    :return: path of the staged project root.
    """
    if not MODEL.is_dir():
        raise FileNotFoundError(f"Frozen model not found at {MODEL}")

    version = read_version()
    dependencies = read_dependencies()

    if destination.exists():
        shutil.rmtree(destination)
    package = destination / PACKAGE_NAME
    package.mkdir(parents=True)

    for name in LAYER_MODULES:
        source = LAYER / name
        if not source.is_file():
            raise FileNotFoundError(f"Layer module not found: {source}")
        shutil.copyfile(source, package / name)

    shutil.copytree(MODEL, package / "model_src", ignore=MODEL_EXCLUDES)

    (destination / "pyproject.toml").write_text(
        render_pyproject(version, dependencies))
    (destination / "README.md").write_text(PACKAGE_README)
    shutil.copyfile(ROOT / "LICENSE", destination / "LICENSE")

    staged = sorted(p for p in package.rglob("*") if p.is_file())
    size_mb = sum(p.stat().st_size for p in staged) / 1024 ** 2
    print(f"staged {DISTRIBUTION} {version}: {len(staged)} files, {size_mb:.1f} MB "
          f"-> {destination}")
    print(f"  {len(dependencies)} dependencies from "
          f"{(MODEL / 'requirements.txt').relative_to(ROOT)}")
    return destination


def build(destination=STAGING, outdir=ARTEFACTS, isolated=False):
    """Build the wheel from a staged tree.

    :param destination: staged project root, from stage().
    :param outdir: directory the wheel is written to.
    :param isolated: let `build` create its own environment and fetch the build
                     backend. Off by default: the backend is already pinned in
                     `Pipfile.lock`, and an isolated build needs the network.
    :return: path of the wheel.
    :raises RuntimeError: if the build produced no wheel.
    """
    outdir.mkdir(parents=True, exist_ok=True)
    before = set(outdir.glob("*.whl"))

    command = [sys.executable, "-m", "build", "--wheel", "--outdir", str(outdir)]
    if not isolated:
        command.append("--no-isolation")
    subprocess.run(command, cwd=destination, check=True)

    produced = sorted(set(outdir.glob("*.whl")) - before)
    if not produced:
        # A rebuild of an identical version overwrites in place, so an empty
        # difference is normal; fall back to the newest file.
        produced = sorted(outdir.glob("*.whl"), key=lambda p: p.stat().st_mtime)[-1:]
    if not produced:
        raise RuntimeError(f"No wheel written to {outdir}")

    wheel = produced[-1]
    print(f"\n✅ {wheel.relative_to(ROOT)} ({wheel.stat().st_size / 1024 ** 2:.1f} MB)")
    print(f"   install with: pip install {wheel.relative_to(ROOT)}")
    return wheel


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python build_package.py", description=__doc__.split("\n\n")[1])
    parser.add_argument("--stage-only", action="store_true",
                        help="assemble build/package/ and stop")
    parser.add_argument("--isolated", action="store_true",
                        help="let `build` fetch its own backend (needs network)")
    parser.add_argument("--outdir", default=str(ARTEFACTS),
                        help=f"where to write the wheel (default: "
                             f"{ARTEFACTS.relative_to(ROOT)})")
    args = parser.parse_args(argv)

    staged = stage()
    if args.stage_only:
        return 0

    build(staged, outdir=Path(args.outdir).resolve(), isolated=args.isolated)
    return 0


if __name__ == "__main__":
    sys.exit(main())
