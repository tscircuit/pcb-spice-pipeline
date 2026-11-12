"""Compare complete guarded native captures without treating them as qualified hardware."""

import argparse
import csv
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
from matplotlib import pyplot
import numpy

from importlib import import_module
measurement = import_module("summarize-addr-cmd")


def lobes(time, voltage):
    """Integrate positive piecewise-linear excursions, splitting at exact rail crossings."""
    areas = []
    area = 0.0
    for index in range(1, len(time)):
        a, b = voltage[index - 1:index + 1]
        dt = (time[index] - time[index - 1]) * 1e9
        if a > 0 and b > 0:
            area += (a + b) * dt / 2
        elif a > 0:
            area += a * dt * a / (a - b) / 2
            areas.append(area)
            area = 0.0
        elif b > 0:
            area = b * dt * b / (b - a) / 2
    if area:
        areas.append(area)
    return max(areas, default=0.0), sum(areas)


def metrics(directory, stop_ns):
    """Clip the recorded trace to one exact window, interpolating only its boundary."""
    data, ledger, provenance = measurement.load(directory)
    stop = stop_ns * 1e-9
    if not numpy.isfinite(stop) or stop <= data["time_s"][0] or stop > data["time_s"][-1] + 1e-18:
        raise ValueError("Comparison window must lie within the recorded capture")
    stop = min(stop, data["time_s"][-1])
    end = int(numpy.searchsorted(data["time_s"], stop, side="right"))
    clipped = data[:end]
    if end < len(data) and clipped["time_s"][-1] < stop:
        left = data[end - 1]
        right = data[end]
        fraction = (stop - left["time_s"]) / (right["time_s"] - left["time_s"])
        boundary = numpy.array([tuple(stop if name == "time_s" else left[name] + fraction * (right[name] - left[name])
                                      for name in data.dtype.names)], dtype=data.dtype)
        clipped = numpy.concatenate([clipped, boundary])
    data = clipped
    time = data["time_s"]
    records = []
    waves = {}
    for route in ledger["routes"]:
        name = route["port"]
        if name in ["CK", "CKn"]:
            continue
        voltage = data[f"{name}_0"]
        lengths = {}
        for wire in ledger["wires"]:
            if wire["source"] == route["sourceTraceId"]:
                lengths[wire["layer"]] = lengths.get(wire["layer"], 0) + wire["end"] - wire["start"]
        layer = max(lengths, key=lengths.get)
        stimulus = next(s for s in ledger["stimuli"] if s["name"] == name)
        quiet = stimulus["pattern"] == "0"
        baseline = float(numpy.mean(voltage[time < .5e-9]))
        above, total_above = lobes(time, voltage - 1.5)
        below, total_below = lobes(time, -voltage)
        records.append({"net": name, "layer": layer, "group": "outer" if layer in ["top", "bottom"] else "inner",
                        "min_v": float(voltage.min()), "max_v": float(voltage.max()),
                        "pre_edge_dc_v": baseline,
                        "late_first_pulse_mean_v": float(numpy.mean(voltage[(time >= 4.5e-9) & (time <= 4.9e-9)])),
                        "overshoot_pct": max(0, float(voltage.max()) - 1.5) / 1.5 * 100,
                        "undershoot_pct": max(0, -float(voltage.min())) / 1.5 * 100,
                        "quiet_victim_mv": float(numpy.max(abs(voltage[time >= 1e-9] - baseline)) * 1000) if quiet else None,
                        "max_overshoot_lobe_v_ns": above, "total_overshoot_v_ns": total_above,
                        "max_undershoot_lobe_v_ns": below, "total_undershoot_v_ns": total_below,
                        **measurement.settling(time, voltage, 1.5, measurement.changes(stimulus, time[-1]))})
        waves[name] = (time, voltage - baseline if quiet else voltage)
    return records, waves, {**provenance, "window_ns": stop_ns, "cells": ledger["cells"],
                            "window_boundary": "linear interpolation between recorded samples when needed",
                            "control_numerics": ledger.get("control_numerics"),
                            "native_deck_sha256": hashlib.sha256((directory / "simulation.cir").read_bytes()).hexdigest(),
                            "stimuli_sha256": hashlib.sha256(json.dumps(ledger["stimuli"], sort_keys=True).encode()).hexdigest(),
                            "declared_duration_ns": ledger["options"]["durationSeconds"] * 1e9,
                            "maximum_timestep_ps": ledger["options"]["stepSeconds"] * 1e12,
                            "maximum_cell_delay_ps": ledger["maximum_cell_delay_s"] * 1e12,
                            "radius_mm": ledger["scope"]["lateralDistanceMm"], "changes": ledger.get("changes", {})}


def main():
    """Manifest entries describe matched baselines, stimulus windows and optional overlays."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    cases = {}
    waves = {}
    rows = []
    for case in manifest:
        records, waveform, provenance = metrics(Path(case["directory"]), case.get("stop_ns", 8))
        cases[case["name"]] = {"provenance": provenance, "nets": records}
        waves[case["name"]] = waveform
        for record in records:
            rows.append({"case": case["name"], **record})
    comparisons = []
    for case in manifest:
        if "baseline" not in case:
            continue
        for key in ["window_ns", "stimuli_sha256"]:
            if cases[case["name"]]["provenance"][key] != cases[case["baseline"]]["provenance"][key]:
                raise ValueError(f"Comparison requires identical {key}: {case['name']}")
        before = {row["net"]: row for row in cases[case["baseline"]]["nets"]}
        after = cases[case["name"]]["nets"]
        differences = [{"net": row["net"], **{key: row[key] - before[row["net"]][key]
                       for key in ["max_v", "min_v", "overshoot_pct", "undershoot_pct", "max_overshoot_lobe_v_ns"]},
                       "quiet_delta_mv": row["quiet_victim_mv"] - before[row["net"]]["quiet_victim_mv"]
                       if row["quiet_victim_mv"] is not None and before[row["net"]]["quiet_victim_mv"] is not None else None}
                       for row in after]
        for row in differences:
            ta, va = waves[case["baseline"]][row["net"]]
            tb, vb = waves[case["name"]][row["net"]]
            grid = numpy.arange(0, min(ta[-1], tb[-1]) + 1e-15, 5e-12)
            difference = numpy.interp(grid, tb, vb) - numpy.interp(grid, ta, va)
            row["waveform_rms_change_v"] = float(numpy.sqrt(numpy.mean(difference ** 2)))
            row["waveform_max_change_v"] = float(numpy.max(abs(difference)))
        comparisons.append({"case": case["name"], "baseline": case["baseline"], "nets": differences})
        if not case.get("overlay"):
            continue
        quiet = case.get("quiet_case")
        fig, axes = pyplot.subplots(3 if quiet else 2, 1, figsize=(9, 8 if quiet else 6), layout="constrained")
        for ax, name in zip(axes[:2], case.get("nets", ["A5", "A4"])):
            held_low = before[name]["quiet_victim_mv"] is not None and next(row for row in after if row["net"] == name)["quiet_victim_mv"] is not None
            for key, style, label in [(case["baseline"], "--", case.get("baseline_label", "Before")), (case["name"], "-", case["label"])]:
                time, voltage = waves[key][name]
                ax.plot(time * 1e9, voltage * (1000 if held_low else 1), style, linewidth=1.1, label=label)
            ax.set(ylabel=f"{name} held low: change from DC (mV)" if held_low else f"{name} receiver (V)", xlim=(2.3, case.get("stop_ns", 8)))
            if not held_low:
                ax.axhline(1.5, color="gray", linewidth=.6)
                ax.axhline(1.975, color="red", linewidth=.6, linestyle=":", label="1.975 V absolute upper rating")
            ax.grid(alpha=.2)
            ax.legend(fontsize=8)
        if quiet:
            for key, style, label in [(case["quiet_baseline"], "--", "Before"), (quiet, "-", case["label"])]:
                time, voltage = waves[key]["A4"]
                axes[-1].plot(time * 1e9, voltage * 1000, style, linewidth=1.1, label=label)
            axes[-1].set(ylabel="A4 held low: change from DC (mV)", xlim=(0, case.get("stop_ns", 8)))
            axes[-1].grid(alpha=.2)
            axes[-1].legend(fontsize=8)
        axes[-1].set_xlabel("Time (ns)")
        fig.suptitle(case["label"] + " · guarded native 2D candidate\nSame comparison window/stimuli; hardware accuracy remains unqualified", fontsize=10)
        fig.savefig(args.output / case["overlay"], dpi=120)
        pyplot.close(fig)
    with (args.output / "metrics.csv").open("w") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    (args.output / "measurements.json").write_text(json.dumps({"cases": cases, "comparisons": comparisons}, indent=2, allow_nan=False) + "\n")
    (args.output / "provenance.json").write_text(json.dumps({"status": "native-candidate-unqualified",
        "analysis_script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "cases": {name: case["provenance"] for name, case in cases.items()}}, indent=2, allow_nan=False) + "\n")
    for name, case in cases.items():
        driven = [row for row in case["nets"] if row["quiet_victim_mv"] is None]
        quiet = [row["quiet_victim_mv"] for row in case["nets"] if row["quiet_victim_mv"] is not None]
        print(name, "peak", max((row["max_v"] for row in driven), default=0),
              "median overshoot", numpy.median([row["overshoot_pct"] for row in driven]) if driven else 0,
              "quiet max", max(quiet, default=0))


if __name__ == "__main__":
    main()
