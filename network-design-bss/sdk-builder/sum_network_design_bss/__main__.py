"""Entry point for `python -m sum_network_design_bss`, in a checkout (with
`network-design-bss/sdk-builder` on PYTHONPATH) and from the installed wheel
alike. Hands over to :func:`sum_network_design_bss.runner.main`."""

import sys

from .runner import main

if __name__ == "__main__":
    sys.exit(main())
