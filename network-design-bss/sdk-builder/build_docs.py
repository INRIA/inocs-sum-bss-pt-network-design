"""
File: build_docs.py
Description: Generate the API documentation published alongside the wheel.

`pdoc` documents what it can import, so the docs are generated from the same
staged tree `build_package.py` builds the wheel from. The two therefore always
describe the same code.

    python network-design-bss/sdk-builder/build_docs.py            # -> network-design-bss/sdk/docs/
    python network-design-bss/sdk-builder/build_docs.py --serve    # live preview on http://localhost:8080

Only the layer this repository maintains is documented. The frozen model under
`model_src/` is a set of top-level modules that import each other absolutely and
read their constants at import time, so `pdoc` cannot import them out of a
prepared process; `notebooks/gva_demo.ipynb` documents that code stage by stage
instead.

The result is committed to `network-design-bss/sdk/docs/`. The GitHub Pages workflow
publishes only the front-end, so open docs/index.html locally or use --serve.
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

from build_package import ARTEFACTS, LAYER_MODULES, PACKAGE_NAME, ROOT, stage

DOCS = ARTEFACTS / "docs"

#: Fallback landing page. pdoc writes one of its own when it is given more than
#: the package itself; this only fills in if a future version stops.
INDEX_REDIRECT = f"""\
<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=./{PACKAGE_NAME}.html"/>
    <title>sum-network-design-bss API documentation</title>
</head>
<body>
    <a href="./{PACKAGE_NAME}.html">sum-network-design-bss API documentation</a>
</body>
</html>
"""


def modules():
    """Name every module pdoc should render a page for.

    The package alone would give a single page: `__init__` re-exports the public
    names, and pdoc documents a submodule separately only when it is asked to.
    Naming them here keeps one page per module, so the docs mirror the source.

    :return: dotted module names, package first.
    """
    skip = {"__init__.py", "__main__.py"}   # the package page, and a two-line shim
    submodules = [name[:-3] for name in LAYER_MODULES if name not in skip]
    return [PACKAGE_NAME] + [f"{PACKAGE_NAME}.{name}" for name in sorted(submodules)]


def build(output=DOCS, serve=False):
    """Run pdoc over the staged package.

    :param output: directory to write the HTML into. Replaced wholesale, so a
                   module that has gone away does not leave a stale page behind.
    :param serve: preview on a local server instead of writing files.
    :return: the output directory, or None when serving.
    """
    staged = stage()

    environment = dict(os.environ, PYTHONPATH=str(staged))
    command = [sys.executable, "-m", "pdoc", *modules(), "--docformat", "google"]

    if serve:
        subprocess.run(command, check=True, env=environment)
        return None

    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    subprocess.run(command + ["--output-dir", str(output)], check=True,
                   env=environment)

    if not (output / "index.html").is_file():
        (output / "index.html").write_text(INDEX_REDIRECT)

    pages = sorted(str(p.relative_to(output)) for p in output.rglob("*.html"))
    print(f"\n✅ {output.relative_to(ROOT)}: {', '.join(pages)}")
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python build_docs.py",
        description="Generate the API documentation for the packaged layer.")
    parser.add_argument("--serve", action="store_true",
                        help="preview on http://localhost:8080 instead of writing")
    parser.add_argument("--output", default=str(DOCS),
                        help=f"directory to write into (default: "
                             f"{DOCS.relative_to(ROOT)})")
    args = parser.parse_args(argv)

    build(output=Path(args.output).resolve(), serve=args.serve)
    return 0


if __name__ == "__main__":
    sys.exit(main())
