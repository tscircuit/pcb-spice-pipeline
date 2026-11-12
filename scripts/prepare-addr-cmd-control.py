"""Prepare an explicit control-corner numerical experiment from a compiled TSX case."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import re


def pad_corners(deck, padding):
    """Move only flat held-state padding; preserve every measured edge sample."""
    if not math.isfinite(padding) or not 0 < padding <= 10e-12:
        raise ValueError("Padding must be finite, positive and at most 10 ps")
    changes = []

    def replace(match):
        """Recognize only generated KU/KD voltage controls with a preceding flat hold."""
        tokens = match[2].split()
        if len(tokens) % 2:
            raise ValueError("Incomplete control PWL pair")
        pairs = [(float(tokens[i]), float(tokens[i + 1])) for i in range(0, len(tokens), 2)]
        for index in range(2, len(pairs)):
            previous = pairs[index - 2]
            held = pairs[index - 1]
            edge = pairs[index]
            interval = edge[0] - held[0]
            if 0 < interval <= 2e-15 and previous[1] == held[1]:
                target = edge[0] - padding
                if not previous[0] < target < held[0]:
                    raise ValueError("Requested padding cannot fit within the preceding flat hold")
                tokens[2 * (index - 1)] = format(target, ".15g")
                changes.append({"original_interval_seconds": interval,
                                "hold_time_shift_seconds": held[0] - target,
                                "coefficient_jump": abs(edge[1] - held[1])})
        return match[1] + " ".join(tokens) + match[3]

    result = re.sub(r"(?m)^(V(?:KU|KD)\d+\s+\S+\s+\S+\s+PWL\()([^()\n]*)(\))$", replace, deck)
    if not changes:
        raise ValueError("No eligible generated control corners; nothing was changed")
    return result, {"kind": "explicit held-coefficient corner padding experiment",
                    "padding_seconds": padding, "changed_hold_points": len(changes),
                    "maximum_hold_time_shift_seconds": max(row["hold_time_shift_seconds"] for row in changes),
                    "maximum_coefficient_jump": max(row["coefficient_jump"] for row in changes),
                    "original_deck_sha256": hashlib.sha256(deck.encode()).hexdigest(),
                    "prepared_deck_sha256": hashlib.sha256(result.encode()).hexdigest(),
                    "measured_edge_times_and_coefficients": "unchanged"}


def main():
    """Write derived SPICE/ledger inputs only; the existing TSX runner owns native guards."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--padding-ps", type=float, default=1)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise ValueError("Use a separate output directory")
    ledger = json.loads((args.source / "extraction.json").read_text())
    if ledger.get("control_numerics"):
        raise ValueError("Control experiment is already applied")
    deck, evidence = pad_corners((args.source / "simulation.cir").read_text(), args.padding_ps * 1e-12)
    evidence["preparation_script_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    ledger["control_numerics"] = evidence
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "simulation.cir").write_text(deck)
    (args.output / "extraction.json").write_text(json.dumps(ledger, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
