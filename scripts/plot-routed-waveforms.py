"""Render receiver CSV/native wrdata as PNG; the caller must label incomplete or synthetic runs."""
import argparse
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

parser = argparse.ArgumentParser()
parser.add_argument("input", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--label", required=True)
parser.add_argument("--duration-ns", type=float)
parser.add_argument("--incomplete", action="store_true")
args = parser.parse_args()
header = args.input.read_text().splitlines()[0]
comma = "," in header
data = np.loadtxt(args.input, delimiter="," if comma else None, skiprows=1, ndmin=2)
labels = header.strip().split(",") if comma else header.strip().split()
indices = list(range(1, data.shape[1]))
groups = [indices]
if len(indices) > 4:
    dq = [i for i in indices if labels[i].startswith("DQ") and not labels[i].startswith(("DQM", "DQS"))]
    dqm = [i for i in indices if labels[i].startswith("DQM")]
    groups = [group for group in [dq, dqm, [i for i in indices if i not in dq + dqm]] if group]
fig, axes = plt.subplots(len(groups), 1, figsize=(10, 3.5 * len(groups)), sharex=True, constrained_layout=True, squeeze=False)
fig.suptitle(args.label + "\nJLC standard stackup (assumed)")
end = data[-1, 0] * 1e9
for axis, group in zip(axes[:, 0], groups):
    for index in group:
        axis.plot(data[:, 0] * 1e9, data[:, index], label=labels[index], linewidth=1.3)
    if args.incomplete:
        axis.axvline(end, color="#bb3344", linestyle="--", label=f"aborted at {end:.3f} ns")
        if args.duration_ns:
            axis.axvspan(end, args.duration_ns, color="#ffeeee")
    axis.set(ylabel="DRAM board-pin voltage (V)", ylim=(min(-.15, data[:, group].min() - .1), max(1.8, data[:, group].max() + .1)))
    axis.grid(alpha=.25)
    if args.duration_ns:
        axis.set_xlim(0, args.duration_ns)
    axis.legend(loc="upper left", fontsize=8, ncol=2 if any(labels[i].startswith("DQS") for i in group) else 4)
axes[-1, 0].set_xlabel("Time (ns)")
args.output.parent.mkdir(parents=True, exist_ok=True)
fig.savefig(args.output, dpi=180)
