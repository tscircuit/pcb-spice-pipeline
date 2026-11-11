"""Add near-end probes to archived linear decks without changing their models."""

import argparse
import hashlib
import json
from pathlib import Path
import re


def main():
    """Prepare scratch decks; invoke ngspice separately under the serial guard."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--loss-scale", type=float)
    args = parser.parse_args()
    for case in ["1-0.3", "3-0.3", "3-1-short"]:
        count = 1 if case.startswith("1-") else 3
        for method in ["threeD", "twoD"]:
            source = Path("runs/routed-2d/step4/controlled") / case / method / "simulation.cir"
            original = source.read_text()
            probes = " ".join(f"v({end}{i})" for end in ["out", "in"] for i in range(count))
            deck, changes = re.subn(r"^wrdata waveform.dat .+$",
                                   "wrdata waveform.dat " + probes, original, flags=re.M)
            if changes != 1:
                raise ValueError(f"Expected exactly one wrdata command: {source}")
            if args.loss_scale is not None:
                inside = False
                lines = []
                for line in deck.splitlines():
                    if line.lower().startswith(".subckt"):
                        inside = True
                    elif line.lower().startswith(".ends"):
                        inside = False
                    if inside and line[:1] in ["R", "H"]:
                        fields = line.split()
                        value = float(fields[-1]) * args.loss_scale
                        fields[-1] = str(max(value, 1e-6) if line.startswith("R") else value)
                        line = " ".join(fields)
                    lines.append(line)
                deck = "\n".join(lines) + "\n"
            target = method if args.loss_scale is None else f"{method}-loss-{args.loss_scale:g}"
            path = args.root / case / target
            path.mkdir(parents=True, exist_ok=True)
            (path / "simulation.cir").write_text(deck)
            (path / "manifest.json").write_text(json.dumps({
                "source": str(source),
                "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "change": "Append v(in*) to wrdata" + (
                    "; all model and solver settings identical" if args.loss_scale is None
                    else "; scale channel R and mutual-resistance H terms only"),
                "channel_resistance_scale": args.loss_scale,
                "resistor_floor_ohm": 1e-6 if args.loss_scale is not None else None,
            }, indent=2) + "\n")


if __name__ == "__main__":
    main()
