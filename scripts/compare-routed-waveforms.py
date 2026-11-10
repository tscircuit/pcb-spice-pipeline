"""Compare native adaptive samples without time shifting or regular-grid decimation."""

import argparse
import gzip
from itertools import islice
import json
from pathlib import Path
import numpy as np


def compare(reference, candidate, threshold, idle=None):
    """Integrate squared piecewise-linear error exactly on the native union grid."""
    end = min(reference[-1, 0], candidate[-1, 0])
    start = max(reference[0, 0], candidate[0, 0])
    time = np.unique(np.r_[reference[:, 0], candidate[:, 0], start, end])
    time = time[(time >= start) & (time <= end)]
    probes = []
    for column in range(1, min(reference.shape[1], candidate.shape[1])):
        a = np.interp(time, reference[:, 0], reference[:, column])
        b = np.interp(time, candidate[:, 0], candidate[:, column])
        error = b - a
        rms = np.sqrt(
            np.sum(
                np.diff(time)
                * (error[:-1] ** 2 + error[:-1] * error[1:] + error[1:] ** 2)
                / 3
            )
            / (end - start)
        )
        baseline = idle[column - 1] if idle else a[0]
        peak = max(abs(b.max() - a.max()), abs(b.min() - a.min()))
        scale = max(a.max(), b.max()) - min(a.min(), b.min())
        peak_scale = max(abs(b.max() - baseline), abs(b.min() - baseline))
        edges = []
        counts = []
        for direction in [-1, 1]:
            crossings = []
            for wave in [a, b]:
                indices = np.flatnonzero(
                    (direction * (wave[:-1] - threshold) < 0)
                    & (direction * (wave[1:] - threshold) >= 0)
                )
                crossings.append(
                    time[indices]
                    + (threshold - wave[indices])
                    * np.diff(time)[indices]
                    / np.diff(wave)[indices]
                )
            counts.append([len(values) for values in crossings])
            if len(crossings[0]) == len(crossings[1]):
                edges.extend((crossings[1] - crossings[0]).tolist())
        probes.append(
            {
                "column": column,
                "rms_v": float(rms),
                "peak_difference_v": float(peak),
                "maximum_pointwise_error_v": float(abs(error).max()),
                "reference_min_v": float(a.min()),
                "candidate_min_v": float(b.min()),
                "reference_max_v": float(a.max()),
                "candidate_max_v": float(b.max()),
                "reference_idle_relative_positive_v": float(a.max() - baseline),
                "reference_idle_relative_negative_v": float(a.min() - baseline),
                "candidate_idle_relative_positive_v": float(b.max() - baseline),
                "candidate_idle_relative_negative_v": float(b.min() - baseline),
                "threshold_v": threshold,
                "edge_counts_falling_rising": counts,
                "maximum_edge_difference_s": max(map(abs, edges), default=None),
                "rms_edge_difference_s": float(np.sqrt(np.mean(np.square(edges))))
                if edges
                else None,
                "accepted": bool(
                    rms <= 0.001 + 0.01 * scale and peak <= 0.001 + 0.01 * peak_scale
                ),
            }
        )
    return {
        "window_s": [float(start), float(end)],
        "samples": len(time),
        "accepted": all(p["accepted"] for p in probes),
        "probes": probes,
    }


def stream_compare(
    path, candidate, probe_ids, threshold, plot_column=1, chunk_size=50000
):
    """Accumulate exact native-union metrics with bounded reference/plot memory."""
    opening = gzip.open if path.suffix == ".gz" else open
    start = float(candidate[0, 0])
    end = float(candidate[-1, 0])
    aggregate = None
    squared = np.zeros(len(probe_ids))
    reference_edges = [[[], []] for _ in probe_ids]
    plot = {}
    carry = None
    samples = 1
    idle = None
    with opening(path, "rt") as source:
        header = next(source).strip().split(",")
        columns = [0] + [header.index(name) for name in probe_ids]
        while block := list(islice(source, chunk_size)):
            current = np.loadtxt(block, delimiter=",", ndmin=2)[:, columns]
            a = np.vstack([carry, current]) if carry is not None else current
            carry = current[-1:].copy()
            if a[0, 0] > end:
                break
            left = max(0, int(np.searchsorted(candidate[:, 0], a[0, 0])) - 1)
            right = min(
                len(candidate),
                int(np.searchsorted(candidate[:, 0], a[-1, 0], side="right")) + 1,
            )
            if min(a[-1, 0], end) <= max(a[0, 0], start):
                continue
            if idle is None:
                idle = [
                    float(np.interp(start, a[:, 0], a[:, column]))
                    for column in range(1, len(columns))
                ]
            part = compare(a, candidate[left:right], threshold, idle)
            duration = part["window_s"][1] - part["window_s"][0]
            samples += part["samples"] - 1
            if aggregate is None:
                aggregate = part
            for i, probe in enumerate(part["probes"]):
                squared[i] += probe["rms_v"] ** 2 * duration
                total = aggregate["probes"][i]
                for key in ["reference_min_v", "candidate_min_v"]:
                    total[key] = min(total[key], probe[key])
                for key in [
                    "reference_max_v",
                    "candidate_max_v",
                    "maximum_pointwise_error_v",
                ]:
                    total[key] = max(total[key], probe[key])
                wave = a[:, i + 1]
                for edge, direction in enumerate([-1, 1]):
                    indices = np.flatnonzero(
                        (direction * (wave[:-1] - threshold) < 0)
                        & (direction * (wave[1:] - threshold) >= 0)
                    )
                    times = (
                        a[indices, 0]
                        + (threshold - wave[indices])
                        * np.diff(a[:, 0])[indices]
                        / np.diff(wave)[indices]
                    )
                    reference_edges[i][edge].extend(
                        times[(times >= start) & (times <= end)].tolist()
                    )
            visible = a[(a[:, 0] >= start) & (a[:, 0] <= end)]
            bins = np.minimum(
                1999, ((visible[:, 0] - start) / (end - start) * 2000).astype(int)
            )
            cuts = np.r_[0, np.flatnonzero(np.diff(bins)) + 1, len(visible)]
            for left, right in zip(cuts[:-1], cuts[1:]):
                rows = visible[left:right]
                if not len(rows):
                    continue
                low = rows[int(np.argmin(rows[:, plot_column]))]
                high = rows[int(np.argmax(rows[:, plot_column]))]
                index = int(bins[left])
                old_low, old_high = plot.get(
                    index, ((low[0], low[plot_column]), (high[0], high[plot_column]))
                )
                plot[index] = (
                    min(
                        old_low, (low[0], low[plot_column]), key=lambda value: value[1]
                    ),
                    max(
                        old_high,
                        (high[0], high[plot_column]),
                        key=lambda value: value[1],
                    ),
                )
    if (
        aggregate is None
        or aggregate["window_s"][0] > start + 1e-18
        or carry[0, 0] < end - 1e-18
    ):
        raise ValueError("Reference must cover the complete candidate window")
    for i, total in enumerate(aggregate["probes"]):
        total["rms_v"] = float(np.sqrt(squared[i] / (end - start)))
        total["peak_difference_v"] = max(
            abs(total["candidate_max_v"] - total["reference_max_v"]),
            abs(total["candidate_min_v"] - total["reference_min_v"]),
        )
        for kind in ["reference", "candidate"]:
            total[kind + "_idle_relative_positive_v"] = total[kind + "_max_v"] - idle[i]
            total[kind + "_idle_relative_negative_v"] = total[kind + "_min_v"] - idle[i]
        differences = []
        counts = []
        wave = candidate[:, i + 1]
        for edge, direction in enumerate([-1, 1]):
            indices = np.flatnonzero(
                (direction * (wave[:-1] - threshold) < 0)
                & (direction * (wave[1:] - threshold) >= 0)
            )
            times = (
                candidate[indices, 0]
                + (threshold - wave[indices])
                * np.diff(candidate[:, 0])[indices]
                / np.diff(wave)[indices]
            )
            original = np.array(reference_edges[i][edge])
            counts.append([len(original), len(times)])
            if len(original) == len(times):
                differences.extend((times - original).tolist())
        total["edge_counts_falling_rising"] = counts
        total["maximum_edge_difference_s"] = max(map(abs, differences), default=None)
        total["rms_edge_difference_s"] = (
            float(np.sqrt(np.mean(np.square(differences)))) if differences else None
        )
        scale = max(total["reference_max_v"], total["candidate_max_v"]) - min(
            total["reference_min_v"], total["candidate_min_v"]
        )
        peak_scale = max(
            abs(total["candidate_max_v"] - idle[i]),
            abs(total["candidate_min_v"] - idle[i]),
        )
        total["accepted"] = (
            total["rms_v"] <= 0.001 + 0.01 * scale
            and total["peak_difference_v"] <= 0.001 + 0.01 * peak_scale
        )
    aggregate.update(
        window_s=[start, end],
        samples=samples,
        accepted=all(probe["accepted"] for probe in aggregate["probes"]),
    )
    return aggregate, np.array(
        sorted(set(point for values in plot.values() for point in values))
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--threshold", type=float, default=0.75)
    args = parser.parse_args()
    result = compare(
        np.loadtxt(args.reference, delimiter=",", skiprows=1, ndmin=2),
        np.loadtxt(args.candidate, delimiter=",", skiprows=1, ndmin=2),
        args.threshold,
    )
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {
                "window_s": result["window_s"],
                "accepted": result["accepted"],
                "maximum_rms_v": max(p["rms_v"] for p in result["probes"]),
                "maximum_peak_difference_v": max(
                    p["peak_difference_v"] for p in result["probes"]
                ),
            }
        )
    )
