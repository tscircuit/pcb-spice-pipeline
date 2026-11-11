"""Measure the short native addr/cmd capture and its two quiet-victim experiments."""

import argparse
import csv
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def load(directory):
    """Reject incomplete native data; retain physical extraction and raw sample hashes."""
    result = json.loads((directory / "result.json").read_text())
    native = json.loads((directory / "native.json").read_text())
    ledger = json.loads((directory / "extraction.json").read_text())
    if result["status"] != "candidate-unqualified" or native["code"] or native["budgetError"]:
        raise ValueError(f"Incomplete/rejected capture: {directory}")
    data = np.genfromtxt(directory / "receiver.csv", delimiter=",", names=True)
    if data["time_s"][-1] < ledger["options"]["durationSeconds"] * .999:
        raise ValueError(f"Truncated capture: {directory}")
    return data, ledger, {"directory": str(directory), "native": native,
                          "hashes": result["hashes"], "waveform_sha256": hashlib.sha256(
                              (directory / "receiver.csv").read_bytes()).hexdigest()}


def changes(stimulus, duration):
    """Reconstruct the declared PRBS7/literal transition times, not receiver ringing crossings."""
    count = int(np.ceil(duration * stimulus["bit_rate_bps"])) + 1
    pattern = stimulus["pattern"]
    if pattern == "prbs7":
        state = stimulus["seed"]
        bits = []
        for _ in range(count):
            bits.append(state >> 6 & 1)
            state = (state << 1 | ((state >> 6) ^ (state >> 5)) & 1) & 127
    else:
        bits = [int(pattern[i % len(pattern)]) for i in range(count)]
    return np.array([stimulus["offset_s"] + i / stimulus["bit_rate_bps"]
                     for i in range(1, count) if bits[i] != bits[i - 1]])


def settling(time, voltage, supply, transitions):
    """Time after a 50% crossing to stay within 5% until the next transmitted edge."""
    edges = np.flatnonzero((voltage[:-1] < supply / 2) != (voltage[1:] < supply / 2))
    completed = []
    censored = 0
    for k, index in enumerate(edges):
        following = transitions[transitions > time[index + 1]]
        end = int(np.searchsorted(time, following[0])) if len(following) else len(time)
        target = supply if voltage[index + 1] > voltage[index] else 0
        bad = np.flatnonzero(abs(voltage[index + 1:end] - target) > .05 * supply)
        last = index + 1 + bad[-1] if len(bad) else index
        if last + 1 >= end:
            censored += 1
        else:
            crossing = time[index] + (supply / 2 - voltage[index]) * (
                time[index + 1] - time[index]) / (voltage[index + 1] - voltage[index])
            completed.append(float((time[last + 1] - crossing) * 1e9))
    return {"settle_ns": max(completed) if completed else None,
            "completed_edges": len(completed), "censored_edges": censored}


def main():
    """Write compact metrics, uniformly sampled CSV and an outer/inner first-edge overlay."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    data, ledger, provenance = load(args.root / "before")
    victims = [load(args.root / name) for name in ["victim-even", "victim-odd"]]
    time = data["time_s"]
    supply = 1.5
    records = []
    quiet_waves = {}
    for route in ledger["routes"]:
        name = route["port"]
        voltage = data[f"{name}_0"]
        lengths = {}
        for wire in ledger["wires"]:
            if wire["source"] == route["sourceTraceId"]:
                lengths[wire["layer"]] = lengths.get(wire["layer"], 0) + wire["end"] - wire["start"]
        layer = max(lengths, key=lengths.get)
        quiet = next(((wave, info) for wave, info, _ in victims
                      if any(s["name"] == name and s["pattern"] == "0" for s in info["stimuli"])), None)
        crosstalk = None
        if quiet:
            wave, _ = quiet
            baseline = float(np.mean(wave[f"{name}_0"][wave["time_s"] < .5e-9]))
            disturbance = wave[f"{name}_0"] - baseline
            crosstalk = float(np.max(abs(disturbance[wave["time_s"] >= 1e-9])) * 1000)
            quiet_waves[name] = wave["time_s"], disturbance
        stimulus = next(s for s in ledger["stimuli"] if s["name"] == name)
        records.append({"net": name, "layer": layer, "group": "outer" if layer in ["top", "bottom"] else "inner",
                        "min_v": float(voltage.min()), "max_v": float(voltage.max()),
                        "overshoot_pct": float(max(0, voltage.max() - supply) / supply * 100),
                        "undershoot_pct": float(max(0, -voltage.min()) / supply * 100),
                        **settling(time, voltage, supply, changes(stimulus, time[-1])), "quiet_victim_crosstalk_mv": crosstalk})
    summary = {"status": "native-candidate-unqualified", "supply_v": supply,
               "settling_definition": "after 50% receiver crossing, remain within 5% of rail until next transmitted edge; unfinished edges censored",
               "crosstalk_definition": "quiet low victim, other parity half-bus PRBS7 aggressors plus CK; DC baseline removed, t >= 1 ns; not a worst-case bound",
               "provenance": [provenance] + [p for _, _, p in victims], "nets": records}
    summary["groups"] = {group: {metric: float(np.median([r[metric] for r in records if r["group"] == group and r["net"] not in ["CK", "CKn"]]))
                                 for metric in ["overshoot_pct", "undershoot_pct", "quiet_victim_crosstalk_mv"]}
                         for group in ["outer", "inner"]}
    (args.root / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")
    with (args.root / "metrics.csv").open("w") as output:
        writer = csv.DictWriter(output, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)
    grid = np.arange(0, time[-1] + 1e-15, 5e-12)
    sampled = np.column_stack([grid] + [np.interp(grid, time, data[f"{r['net']}_0"]) for r in records])
    np.savetxt(args.root / "before.csv", sampled, delimiter=",", header="time_s," + ",".join(r["net"] for r in records), comments="", fmt="%.8g")
    fig, axes = plt.subplots(2, 1, figsize=(10, 7), layout="constrained")
    for name, color in [("A2", "#d66128"), ("A4", "#2166ac")]:
        record = next(r for r in records if r["net"] == name)
        axes[0].plot(time * 1e9, data[f"{name}_0"], color=color,
                     label=f"{name} ({record['layer']}): +{record['overshoot_pct']:.2f}% / −{record['undershoot_pct']:.2f}%")
        qt, qv = quiet_waves[name]
        axes[1].plot(qt * 1e9, qv * 1000, color=color, label=f"{name} held low; other parity half-bus + CK switches")
    axes[0].axhline(supply, color="gray", linestyle="--", linewidth=.8)
    axes[0].set(xlim=(2.3, 4.6), ylabel="Receiver ball voltage (V)", title="Before: real routed board, first rising command edge (400 Mbps)")
    axes[1].set(xlim=(0, time[-1] * 1e9), xlabel="Time (ns)", ylabel="Quiet-victim disturbance (mV)")
    for ax in axes:
        ax.grid(alpha=.2)
        ax.legend(fontsize=8)
    fig.suptitle("AM3352 Model_352 → W631GG6MB CMD · JLC08121H-3313\nNative 2D candidate; remaining terminal/coupling qualification limits apply", fontsize=11)
    fig.savefig(args.root / "outer-inner-overlay.png", dpi=160)
    plt.close(fig)
    print(json.dumps({"groups": summary["groups"], "nets": records}, indent=2))


if __name__ == "__main__":
    main()
