"""Compare unchanged RFC TSX runs with the accepted complete native archives; write evidence and a local plot."""

from pathlib import Path
import sys
import json
import hashlib
import os
import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, "scripts")
from importlib import import_module

stream_compare = import_module("compare-routed-waveforms").stream_compare


def file_hash(path):
    """Hash large accepted archives with bounded temporary memory."""
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


root = Path(os.environ.get("SI_ROUTE_RUN_ROOT", "runs/routed-2d/step3/part-a-full"))
summaries = []
fig, axes = plt.subplots(3, 2, figsize=(13, 10), layout="constrained")
for ax, name in zip(
    axes.flat,
    [
        "single",
        "differential",
        "two",
        "three/TRAFFIC",
        "three/XTALK_LOW",
        "three/XTALK_HIGH",
    ],
):
    accepted = Path("runs/final-rfc") / name
    summary = json.loads((accepted / "summary.json").read_text())
    block = summary["blocks"][0]["simulation_signal_integrity_id"]
    path = (
        accepted
        / "blocks"
        / block
        / "experiments"
        / block
        / "numerical-refinement-2/waveform.csv.gz"
    )
    dest = root / name if "/" in name else root / name / "default"
    e = json.loads((dest / "extraction.json").read_text())
    physical_types = {
        "pcb_board",
        "pcb_stackup",
        "pcb_trace",
        "pcb_via",
        "pcb_copper_pour",
        "pcb_port",
        "pcb_smtpad",
        "pcb_plated_hole",
    }
    physical = [
        record
        for record in json.loads((dest / "input.json").read_text())
        if record["type"] in physical_types
    ]
    reference_physical = [
        record
        for record in json.loads((accepted / "input.json").read_text())
        if record["type"] in physical_types
    ]
    if physical != reference_physical:
        raise ValueError(
            f"{name}: physical board changed since accepted 3D acquisition"
        )
    reference_signals = sorted(
        [
            record
            for record in json.loads((accepted / "input.json").read_text())
            if record["type"] == "simulation_signal"
            and record["simulation_signal_integrity_id"] == block
        ],
        key=lambda record: record["name"],
    )
    if e["signals"] != reference_signals:
        raise ValueError(
            f"{name}: signal declarations differ from accepted 3D acquisition"
        )
    b = np.loadtxt(dest / "receiver.csv", delimiter=",", skiprows=1, ndmin=2)
    probe_ids = [
        probe["simulationVoltageProbeId"] + "_v"
        for probe in e["probes"]
        if not probe["name"].endswith(("_P", "_N"))
    ]
    column = 2 if "XTALK" in name else 1
    r, shown_a = stream_compare(
        path, b, probe_ids, 0 if name == "differential" else 1.65, column
    )
    r.update(
        name=name,
        native=json.loads((dest / "result.json").read_text()),
        probe_names=e["probe_names"],
        ibis_sha256=e["ibis_sha256"],
        signals=e["signals"],
        reference=str(path),
        reference_sha256=file_hash(path),
        candidate_sha256=hashlib.sha256(
            (dest / "receiver.csv").read_bytes()
        ).hexdigest(),
        physical_input_matches_accepted=True,
        signal_declarations_match_accepted=True,
        physical_input_records=len(physical),
        physical_input_sha256=hashlib.sha256(
            json.dumps(physical, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
    )
    for i, p in enumerate(r["probes"]):
        p["name"] = e["probe_names"][i]
        if name.startswith("three/XTALK") and i in [1, 2]:
            idle = next(
                x["idle_voltage_v"]
                for x in summary["blocks"][0]["results"]
                if x["type"] == "simulation_signal_waveform"
                and x["simulation_signal_waveform_id"]
                == e["probes"][i]["simulationVoltageProbeId"]
            )
            bi = float(np.interp(10e-9, b[:, 0], b[:, i + 1]))
            p["reference_idle_voltage_v"] = idle
            p["candidate_idle_voltage_v"] = bi
            p["reference_quiet_positive_v"] = p["reference_max_v"] - idle
            p["reference_quiet_negative_v"] = p["reference_min_v"] - idle
            p["candidate_quiet_positive_v"] = p["candidate_max_v"] - bi
            p["candidate_quiet_negative_v"] = p["candidate_min_v"] - bi
    r["original_duration_s"] = e["original_duration_s"]
    r["reference_measurement_gate_s"] = max(
        signal["offset_s"] + 16 / signal["bit_rate_bps"]
        for signal in e["signals"]
        if signal["pattern"] not in ("0", "1")
    )
    summaries.append(r)
    (dest / "comparison.json").write_text(json.dumps(r, indent=2) + "\n")
    column = 2 if "XTALK" in name else 1

    def display_rows(data):
        """Bound plot memory while retaining each display bucket's signed extrema."""
        cuts = np.linspace(0, len(data), min(2001, len(data)), dtype=int)
        indices = [0, len(data) - 1]
        for left, right in zip(cuts[:-1], cuts[1:]):
            if right > left:
                indices.extend(
                    [
                        left + int(np.argmin(data[left:right, column])),
                        left + int(np.argmax(data[left:right, column])),
                    ]
                )
        return data[np.unique(indices)]

    shown_b = display_rows(b)
    ax.plot(shown_a[:, 0] * 1e9, shown_a[:, 1], label="accepted 3D", lw=1)
    ax.plot(
        shown_b[:, 0] * 1e9,
        shown_b[:, column],
        label="routed 2D, 1 mm horizon",
        lw=0.9,
        alpha=0.8,
    )
    ax.set(
        title=name + (" — quiet far receiver" if "XTALK" in name else ""),
        xlabel="Time (ns)",
        ylabel="Voltage (V)",
    )
    ax.grid(alpha=0.2)
    ax.legend(fontsize=8)
fig.suptitle(
    "RFC validation: full native durations, identical TSX / models / patterns / seeds\nMetrics use all adaptive samples; plot retains bucket extrema; routed 2D remains unqualified"
)
fig.savefig(root / "comparison.png", dpi=160)
(root / "comparison.json").write_text(json.dumps(summaries, indent=2) + "\n")
Path("tests/evidence/signal-levels/routed-2d-comparison.json").write_text(
    json.dumps(summaries, indent=2) + "\n"
)
