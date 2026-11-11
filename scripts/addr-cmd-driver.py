"""Read the local vendor I/V data and solve the isolated first-arrival load line."""

import argparse
import json
import re
from pathlib import Path

import numpy as np


def number(value):
    """Decode IBIS engineering suffixes without changing or redistributing vendor tables."""
    match = re.fullmatch(r"([+\-\d.eE]+)([munpf]?)", value)
    return float(match[1]) * {"": 1, "m": 1e-3, "u": 1e-6, "n": 1e-9, "p": 1e-12, "f": 1e-15}[match[2]]


def main():
    """Use typical pullup/pulldown rows, not selector labels, as the impedance evidence."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ibis", type=Path)
    args = parser.parse_args()
    source = args.ibis.read_text()
    output = []
    for model in ["Model_352", "Model_345", "Model_273"]:
        body = re.split(r"(?im)^\[model\]\s+" + model + r"\s*$", source)[1]
        body = re.split(r"(?im)^\[model\]", body)[0]
        record = {"model": model, "typical": {}}
        for tag in ["Pullup", "Pulldown"]:
            table = re.split(r"(?im)^\[" + tag + r"\]", body)[1]
            table = re.split(r"(?m)^\[", table)[0]
            rows = [[number(cell) for cell in line.split()[:2]] for line in table.splitlines()
                    if re.match(r"^[-+\d.]", line)]
            voltage, current = np.array(rows).T
            current = -current if tag == "Pullup" else current
            midpoint = float(np.interp(.75, voltage, current))
            arrivals = []
            for impedance in [50, 65]:
                lo, hi = 0.0, 1.5
                for _ in range(60):
                    drop = (lo + hi) / 2
                    if np.interp(drop, voltage, current) > (1.5 - drop) / impedance:
                        hi = drop
                    else:
                        lo = drop
                drop = (lo + hi) / 2
                launch = 1.5 - drop
                arrivals.append({"line_ohms": impedance, "driver_ohms_at_launch": drop / (launch / impedance),
                                 "transition_at_far_end_v": 2 * launch,
                                 "excursion_pct": (2 * launch / 1.5 - 1) * 100})
            record["typical"][tag] = {"current_at_0_75_v_ma": midpoint * 1000,
                                       "resistance_at_0_75_v_ohms": .75 / midpoint, "ideal_step": arrivals}
        output.append(record)
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
