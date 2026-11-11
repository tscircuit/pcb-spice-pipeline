"""Compare unaligned controlled waveforms and render standalone overlay PNGs."""

import argparse
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def metrics(time, voltage, quiet=False):
    """Report signed extrema and first 1.65 V rising edge without alignment."""
    crossings = np.flatnonzero((voltage[:-1] < 1.65) & (voltage[1:] >= 1.65))
    edge = None
    if len(crossings) and not quiet:
        i = crossings[0]
        edge = float((time[i] + (1.65 - voltage[i]) *
                      (time[i + 1] - time[i]) / (voltage[i + 1] - voltage[i])) * 1e12)
    return {"max_v": float(voltage.max()), "min_v": float(voltage.min()),
            "max_time_ps": float(time[np.argmax(voltage)] * 1e12),
            "min_time_ps": float(time[np.argmin(voltage)] * 1e12),
            "first_rising_50_ps": edge,
            "peak_abs_v": float(abs(voltage).max())}


def load_fdtd(path, count, allow_unsettled=False):
    """Reconstruct the original PULSE only after checking a settled step tail."""
    manifest = json.loads((path / "manifest.json").read_text())
    usage = json.loads((path / "usage.json").read_text())
    if (usage["exit_code"] or usage["stopped_reason"] or manifest["pilot_steps"]
            or "wall_seconds" not in usage):
        raise RuntimeError(f"Incomplete/rejected FDTD output: {path}")
    if (usage["seconds"] > 2700 or usage["peak_tree_rss_kib"] > 2 * 1024 ** 2
            or usage["omp_threads"] not in [1, 2] or usage["minimum_free_bytes"] < 5e9):
        raise RuntimeError(f"Resource limits exceeded: {path}")
    if manifest.get("mirror_mesh_axes") != ["x", "y"]:
        raise RuntimeError(f"Rejected asymmetric mesh: {path}")
    source = Path(manifest["source_geometry"])
    if hashlib.sha256(source.read_bytes()).hexdigest() != manifest["source_sha256"]:
        raise RuntimeError(f"Archived geometry changed after simulation: {path}")
    probes = {}
    tails = {}
    hashes = {}
    source_errors = {}
    raw_metrics = {}
    direct_pulse_metrics = {}
    mirror_errors = {}
    for i in range(count):
        if count == 3 and i == 1:
            continue
        data = np.loadtxt(path / f"source-{i}", comments="%")
        expected = 3.3 * np.clip(data[:, 0] / 3e-10, 0, 1)
        if not manifest["step_response"]:
            expected = sum(sign * 3.3 * np.clip((data[:, 0] - delay) / 3e-10, 0, 1)
                           for delay, sign in [(2e-9, 1), (6.3e-9, -1), (12e-9, 1), (16.3e-9, -1)])
        source_errors[str(i)] = float(np.max(abs(data[:, 1] - expected)))
        if source_errors[str(i)] > .001:
            raise RuntimeError(f"Source voltage verification failed: {source_errors}")
    for end in ["near", "far"]:
        for i in range(count):
            name = f"{end}-{i}"
            raw = path / name
            data = np.loadtxt(raw, comments="%")
            hashes[name] = hashlib.sha256(raw.read_bytes()).hexdigest()
            if data[-1, 0] < manifest["duration_ns"] * 1e-9 - 1e-12:
                raise RuntimeError(f"Truncated probe: {raw}")
            t, v = data[:, 0], data[:, 1]
            raw_metrics[name] = metrics(t, v, count == 3 and i == 1)
            if manifest["step_response"]:
                steady = 0 if count == 3 and i == 1 else 3.3
                tail = v[t >= t[-1] - .5e-9]
                tails[name] = float(np.max(np.abs(tail - steady)))
                if tails[name] > .0001 and not allow_unsettled:
                    raise RuntimeError(f"Unsettled step tail {name}: {tails[name]} V; extend run")
                time = np.arange(40001) * .5e-12
                voltage = np.zeros_like(time)
                for delay, sign in [(2e-9, 1), (6.3e-9, -1), (12e-9, 1), (16.3e-9, -1)]:
                    voltage += sign * np.interp(time - delay, t, v, left=0, right=steady)
                probes[name] = (time, voltage)
                direct = time <= 2e-9 + t[-1]
                direct_pulse_metrics[name] = metrics(time[direct], voltage[direct], count == 3 and i == 1)
            else:
                probes[name] = (t, v)
    if count == 3:
        for end in ["near", "far"]:
            a = np.loadtxt(path / f"{end}-0", comments="%")
            b = np.loadtxt(path / f"{end}-2", comments="%")
            mirror_errors[end] = float(np.max(abs(a[:, 1] - np.interp(a[:, 0], b[:, 0], b[:, 1]))))
        if max(mirror_errors.values()) > .001:
            raise RuntimeError(f"Mirrored traces disagree by more than 1 mV: {mirror_errors}")
    provenance = {"manifest": manifest, "usage": usage, "probe_sha256": hashes,
                  "max_source_voltage_error_v": source_errors,
                  "max_mirror_waveform_difference_v": mirror_errors,
                  "last_half_ns_max_deviation_v": tails,
                  "tail_100uv_check_passed": all(value <= .0001 for value in tails.values()),
                  "raw_step_metrics": raw_metrics,
                  "pulse_metrics_using_only_measured_step_samples": direct_pulse_metrics,
                  "direct_pulse_window_end_ns": 2 + t[-1] * 1e9
                  if manifest["step_response"] else manifest["duration_ns"],
                  "pulse_reconstruction": "LTI superposition; beyond saved step use exact PEC DC limit"
                  if manifest["step_response"] else None}
    return probes, provenance


def main():
    """Accept only complete FDTD outputs; keep recorded 3D/2D provenance."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--recorded-only", action="store_true")
    parser.add_argument("--allow-unsettled-tail", action="store_true",
                        help="Render explicitly qualified DC-tail extrapolations; retain raw step metrics")
    parser.add_argument("--cases", nargs="+", default=["1-0.3", "3-0.3", "3-1-short"])
    args = parser.parse_args()
    evidence = {"cases": {}, "status": "recorded-reference-baseline" if args.recorded_only
                else "conditional-PEC-local-return-comparison"}
    for case in args.cases:
        count = 1 if case.startswith("1-") else 3
        directory = Path("runs/routed-2d/step4/controlled") / case
        waves = {}
        hashes = {}
        fdtd_provenance = {}
        lossless_metrics = {}
        lossless_waves = {}
        reference_checks = {}
        for method in ["threeD", "twoD"]:
            path = directory / method / "waveform.dat"
            data = np.loadtxt(path, skiprows=1)
            waves[method] = {f"far-{i}": (data[:, 0], data[:, i + 1])
                             for i in range(count)}
            hashes[method] = hashlib.sha256(path.read_bytes()).hexdigest()
            rerun = args.root / case / method / "waveform.dat"
            if rerun.exists():
                expanded = np.loadtxt(rerun, skiprows=1)
                errors = []
                for i in range(count):
                    error = np.max(np.abs(np.interp(data[:, 0], expanded[:, 0],
                                                  expanded[:, i + 1]) - data[:, i + 1]))
                    if error > 1e-7:
                        raise RuntimeError(f"Near-probe rerun changed far response by {error} V")
                    waves[method][f"near-{i}"] = (expanded[:, 0], expanded[:, count + i + 1])
                    errors.append(float(error))
                reference_checks[method] = {"far_max_error_v": max(errors),
                                            "expanded_waveform_sha256": hashlib.sha256(
                                                rerun.read_bytes()).hexdigest()}
            lossless = args.root / case / f"{method}-loss-0" / "waveform.dat"
            if lossless.exists():
                data = np.loadtxt(lossless, skiprows=1)
                lossless_metrics[method] = {
                    f"{end}-{i}": metrics(data[:, 0], data[:, offset + i + 1],
                                          count == 3 and i == 1)
                    for end, offset in [("far", 0), ("near", count)] for i in range(count)}
                lossless_waves[method + " R=0"] = {
                    f"{end}-{i}": (data[:, 0], data[:, offset + i + 1])
                    for end, offset in [("far", 0), ("near", count)] for i in range(count)}
        if not args.recorded_only:
            for density in [1, 2]:
                path = args.root / case / f"mesh-{density}"
                waves[f"openEMS-{density}"], fdtd_provenance[str(density)] = load_fdtd(
                    path, count, args.allow_unsettled_tail)
        results = {}
        for method, probes in waves.items():
            results[method] = {name: metrics(t, v, count == 3 and name.endswith("1"))
                               for name, (t, v) in probes.items()}
        first_pulse = {}
        direct_end = None
        if fdtd_provenance:
            direct_end = min(p["direct_pulse_window_end_ns"] for p in fdtd_provenance.values())
            first_pulse = {method: {
                name: metrics(t[t <= direct_end * 1e-9], v[t <= direct_end * 1e-9],
                              count == 3 and name.endswith("1"))
                for name, (t, v) in probes.items()}
                for method, probes in {**waves, **lossless_waves}.items()}
        convergence = {}
        first_edge_errors = {}
        if "openEMS-2" in waves:
            for name in waves["openEMS-2"]:
                a = fdtd_provenance["1"]["raw_step_metrics"][name]
                b = fdtd_provenance["2"]["raw_step_metrics"][name]
                coarse = np.loadtxt(args.root / case / "mesh-1" / name, comments="%")
                fine = np.loadtxt(args.root / case / "mesh-2" / name, comments="%")
                fine = fine[fine[:, 0] <= coarse[-1, 0]]
                convergence[name] = {
                    "directly_simulated_overlap_ns": float(fine[-1, 0] * 1e9),
                    "max_waveform_change_mv": float(np.max(np.abs(
                        np.interp(fine[:, 0], coarse[:, 0], coarse[:, 1]) - fine[:, 1]))) * 1000,
                    "max_change_mv": abs(a["max_v"] - b["max_v"]) * 1000,
                    "min_change_mv": abs(a["min_v"] - b["min_v"]) * 1000,
                    "edge_change_ps": None if b["first_rising_50_ps"] is None else
                    abs(a["first_rising_50_ps"] - b["first_rising_50_ps"])}
                first_edge_errors[name] = {}
                window = fine[fine[:, 0] <= 3e-9]
                mesh_error = np.interp(window[:, 0], coarse[:, 0], coarse[:, 1]) - window[:, 1]
                convergence[name]["first_edge_rms_waveform_change_mv"] = float(
                    np.sqrt(np.mean(mesh_error ** 2)) * 1000)
                for method, probes in {**waves, **lossless_waves}.items():
                    if method.startswith("openEMS") or name not in probes:
                        continue
                    t, v = probes[name]
                    error = np.interp(window[:, 0] + 2e-9, t, v) - window[:, 1]
                    first_edge_errors[name][method] = {
                        "max_waveform_error_mv": float(np.max(abs(error)) * 1000),
                        "rms_waveform_error_mv": float(np.sqrt(np.mean(error ** 2)) * 1000)}
        evidence["cases"][case] = {"metrics": results, "convergence": convergence,
                                   "first_pulse_metrics": first_pulse,
                                   "first_pulse_window_end_ns": direct_end,
                                   "recorded_sha256": hashes, "fdtd_provenance": fdtd_provenance,
                                   "near_probe_rerun_checks": reference_checks,
                                   "first_edge_errors_against_fine": first_edge_errors,
                                   "first_edge_error_window_ns": 3,
                                   "lossless_channel_metrics": lossless_metrics}
        rows = 1 if count == 1 else 3
        columns = 2 if args.recorded_only else 3
        fig, axes = plt.subplots(rows, columns, figsize=(5.3 * columns, 3.2 * rows), squeeze=False)
        for row in range(rows):
            probe = ["far-0", "far-1", "near-1"][row]
            for col, limits in enumerate([(0, 20), (1.9, 3.3)]):
                ax = axes[row, col]
                for method, probes in waves.items():
                    if probe in probes:
                        t, v = probes[probe]
                        ax.plot(t * 1e9, v * (1000 if row else 1),
                                label=method, lw=1.2,
                                linestyle="--" if method == "openEMS-1" else "-")
                ax.set_xlim(*limits)
                ax.set_xlabel("Time (ns)")
                ax.set_ylabel(f"{probe} ({'mV' if row else 'V'})")
                ax.grid(alpha=.3)
                if ax.get_legend_handles_labels()[0]:
                    ax.legend(fontsize=8)
                if row == 2 and not any(probe in probes for probes in waves.values()):
                    ax.text(.5, .5, "Near-end probes were not recorded", ha="center",
                            transform=ax.transAxes)
            if not args.recorded_only:
                ax = axes[row, 2]
                t, reference = waves["openEMS-2"][probe]
                selected = (t >= 1.9e-9) & (t <= 3.3e-9)
                for method, probes in {**waves, **lossless_waves}.items():
                    if method.startswith("openEMS") or probe not in probes:
                        continue
                    error = np.interp(t[selected], *probes[probe]) - reference[selected]
                    ax.plot(t[selected] * 1e9, error * 1000, label=method,
                            linestyle=":" if method.endswith("R=0") else "-")
                ax.axhline(0, color="black", lw=.6)
                ax.set_xlim(1.9, 3.3)
                ax.set_xlabel("Time (ns)")
                ax.set_ylabel("Model minus fine FDTD (mV)")
                ax.grid(alpha=.3)
                ax.legend(fontsize=8)
        fig.suptitle(case + (" — recorded models only; no FDTD" if args.recorded_only else
                            " — PEC/local ports; pulse derived from shortened step (DC tail assumed)"))
        fig.tight_layout()
        args.root.mkdir(parents=True, exist_ok=True)
        fig.savefig(args.root / f"{case}-overlay.png", dpi=160)
        plt.close(fig)
    (args.root / "comparison.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
