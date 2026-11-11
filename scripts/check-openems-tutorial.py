"""Run upstream MSL_NotchFilter.py headlessly and retain its extracted line Z."""

import argparse
import hashlib
import importlib
import json
from pathlib import Path
import runpy
import tempfile

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from openEMS import openEMS
from openEMS.ports import MSLPort


def main():
    """Preserve upstream geometry, mesh, excitation and termination unchanged."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tutorial", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    tempfile.tempdir = str(args.output)
    original_read = MSLPort.ReadUIData
    impedances = []

    def read(port, *arguments, **options):
        """Capture extracted impedance before CalcPort replaces it with 50 ohm."""
        original_read(port, *arguments, **options)
        impedances.append(np.array(port.Z_ref))

    MSLPort.ReadUIData = read
    # The upstream default thread count is all CPUs; patch only that default.
    class SingleThread(openEMS):
        """Override only the default used by the upstream example."""

        def Run(self, *arguments, **options):
            """Enforce one thread without changing upstream geometry."""
            options["numThreads"] = 1
            return super().Run(*arguments, **options)

    importlib.import_module("openEMS").openEMS = SingleThread
    plt.show = lambda: None
    result = runpy.run_path(str(args.tutorial))
    frequency = result["f"]
    mask = (frequency >= .5e9) & (frequency <= 2e9)
    impedance = impedances[0]
    metrics = {
        "source": str(args.tutorial),
        "sha256": hashlib.sha256(args.tutorial.read_bytes()).hexdigest(),
        "geometry": {"width_um": 600, "height_um": 254, "er": 3.66},
        "frequency_band_hz": [.5e9, 2e9],
        "expected_ohm": 50,
        "median_real_ohm": float(np.median(impedance[mask].real)),
        "min_real_ohm": float(np.min(impedance[mask].real)),
        "max_real_ohm": float(np.max(impedance[mask].real)),
        "max_abs_imag_ohm": float(np.max(abs(impedance[mask].imag))),
        "within_5_percent": bool(np.max(abs(impedance[mask].real - 50)) < 2.5),
    }
    (args.output / "tutorial.json").write_text(json.dumps(metrics, indent=2) + "\n")
    np.savetxt(args.output / "impedance.csv", np.column_stack(
        [frequency, impedance.real, impedance.imag]), delimiter=",",
        header="frequency_hz,real_ohm,imag_ohm")
    plt.savefig(args.output / "notch-s-parameters.png", dpi=160)
    print(json.dumps(metrics), flush=True)
    if not metrics["within_5_percent"]:
        raise SystemExit("Official tutorial failed the 50 ohm installation check")


if __name__ == "__main__":
    main()
