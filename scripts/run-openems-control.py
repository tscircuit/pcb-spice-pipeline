"""FDTD controls derived from the existing rendered ReturnAgreement TSX fixture.

The conductor volumes, board dielectric and finite plane use saved geometry.json;
the TSX pad extension and local vertical circuit ports are explicit approximations.
No field dumps are requested. Run through openems-guard.py, never concurrently.
"""

import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from CSXCAD import ContinuousStructure
from CSXCAD.SmoothMeshLines import SmoothRange
from openEMS import openEMS


def ramp_expression():
    """Match SPICE PULSE(0 3.3 2n 300p 300p 4n 10n) over 20 ns."""
    edges = [(2e-9, 1), (6.3e-9, -1), (12e-9, 1), (16.3e-9, -1)]
    return "3.3*(" + "+".join(
        f"({sign})*min(1,max(0,(t-{edge:.15g})/3e-10))"
        for edge, sign in edges) + ")"


def grade_lines(lines):
    """Grade short anchor gaps too; the upstream smoother only fills >max_res."""
    lines = np.asarray(lines)
    for _ in range(4):
        gaps = np.diff(lines)
        additions = []
        for i, gap in enumerate(gaps):
            before = gaps[max(0, i - 1)]
            after = gaps[min(len(gaps) - 1, i + 1)]
            if gap > 1.5 * min(before, after):
                additions.extend(SmoothRange(lines[i], lines[i + 1], before, after, .8, 1.4))
        if not additions:
            break
        lines = np.unique(np.concatenate([lines, additions]))
    return lines


def main():
    """Build a finite-board, finite-thickness PEC baseline with lumped R and C."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", choices=["1-0.3", "3-0.3", "3-1-short"])
    parser.add_argument("output", type=Path)
    parser.add_argument("--density", type=int, choices=[1, 2], default=1)
    parser.add_argument("--duration-ns", type=float, default=20)
    parser.add_argument("--pilot-steps", type=int, default=0)
    parser.add_argument("--padding-mm", type=float, default=3)
    parser.add_argument("--longitudinal-mm", type=float, default=.25,
                        help="Density-1 longitudinal anchor spacing; density 2 halves it")
    parser.add_argument("--setup-only", action="store_true")
    parser.add_argument("--step-response", action="store_true")
    parser.add_argument("--threads", type=int, choices=[1, 2], default=1)
    args = parser.parse_args()
    source = Path("runs/routed-2d/step4/controlled") / args.case / "geometry.json"
    geometry = json.loads(source.read_text())
    cell = geometry["cells"][0]
    copper = cell["routedCopper"]
    dielectric = cell["dielectric"]
    args.output.mkdir(parents=True, exist_ok=True)
    fdtd = openEMS(NrTS=args.pilot_steps or 1e9, EndCriteria=0,
                   MaxTime=args.duration_ns * 1e-9, OverSampling=100)
    csx = ContinuousStructure()
    fdtd.SetCSX(csx)
    grid = csx.GetGrid()
    grid.SetDeltaUnit(1e-3)
    fdtd.SetBoundaryCond(["PML_8"] * 6)
    expression = "3.3*min(1,max(0,t/3e-10))" if args.step_response else ramp_expression()
    # Current upstream CalcCustomExcitation uses f0 for probe Nyquist sampling,
    # overriding fmax. Setting f0=0 silently records essentially no probe data.
    fdtd.SetCustomExcite(expression, 10e9, 10e9)
    metal = csx.AddMetal("copper-pec")
    corners = np.array(dielectric["polygon"][0])
    low = corners.min(axis=0)
    high = corners.max(axis=0)
    for layer in dielectric["layers"]:
        material = csx.AddMaterial(layer["material"],
                                   epsilon=layer["relativePermittivity"])
        material.AddBox([*low, layer["zMinMm"]],
                        [*high, layer["zMaxMm"]], priority=1)
    for plane in copper["pours"]:
        polygon = np.array(plane["polygon"][0])
        metal.AddBox([*polygon.min(axis=0), plane["zMinMm"]],
                     [*polygon.max(axis=0), plane["zMaxMm"]], priority=10)
    signals = copper["signals"]
    z_top = geometry["stackup"]["copperLayers"][-1]
    z0 = z_top["zMinMm"]
    z1 = z_top["zMaxMm"]
    # Keep exact material boundaries and finite metal thickness. Resolve each
    # trace by 4/8 cells laterally; halve longitudinal and vertical cell limits.
    width = signals[0]["segments"][0]["widthMm"]
    transverse = width / (4 * args.density)
    longitudinal = args.longitudinal_mm / args.density
    axes = {"x": list(low[:1]) + list(high[:1]),
            "y": [low[1], high[1]], "z": [-.03, 0, z0, z1]}
    x_ends = signals[0]["terminals"]
    x_near = x_ends[0][0]
    x_far = x_ends[1][0]
    port_span = width / 2
    axes["x"] += list(np.linspace(x_near, x_far,
                                  int(np.ceil((x_far - x_near) / longitudinal)) + 1))
    for signal in signals:
        for segment in signal["segments"]:
            a = np.array(segment["a"])
            b = np.array(segment["b"])
            half = segment["widthMm"] / 2
            metal.AddBox([a[0], a[1] - half, z0],
                         [b[0], b[1] + half, z1], priority=10)
        y = signal["terminals"][0][1]
        # Follow the official MSL tutorial's one-third/two-thirds edge rule.
        # Face-aligned lateral nodes produce a large coarse-grid width bias.
        axes["y"] += list(np.linspace(y - width / 2 + transverse / 3,
                                      y + width / 2 - transverse / 3,
                                      4 * args.density + 1))
        axes["y"] += [y - width / 2 - 2 * transverse / 3,
                      y + width / 2 + 2 * transverse / 3]
    for plane in copper["pours"]:
        points = np.array(plane["polygon"][0])
        axes["x"] += list(points[:, 0])
        axes["y"] += list(points[:, 1])
    axes["z"] += list(np.linspace(0, z0, 4 * args.density + 1))
    padding = args.padding_mm
    axes["x"] += [low[0] - padding, high[0] + padding,
                  x_near + port_span, x_far - port_span]
    axes["y"] += [low[1] - padding, high[1] + padding]
    axes["z"] += [-padding, z1 + padding]
    for axis in "xyz":
        grid.AddLine(axis, np.unique(np.round(axes[axis], 12)))
        # Grow cells outside the explicitly resolved line/port region. Uniform
        # fine air padding wastes cells without resolving any more metal.
        grid.SmoothMeshLines(axis, .8, 1.4)
        lines = grade_lines(grid.GetLines(axis))
        if axis in "xy":
            # All three controls are centred rectangles. The upstream greedy
            # smoother is directional: mirror one half to preserve their exact
            # geometric symmetry without imposing a half-domain boundary.
            positive = lines[lines >= 0]
            lines = np.concatenate([-positive[positive > 0][::-1], positive])
        grid.SetLines(axis, lines)
        # Keep all eight PML cells OUTSIDE the declared clear-air padding.
        # Consuming the graded padding itself brings the absorber near copper.
        lines = grid.GetLines(axis)
        grid.AddLine(axis, lines[0] - .8 * np.arange(1, 9))
        grid.AddLine(axis, lines[-1] + .8 * np.arange(1, 9))
    for index, signal in enumerate(signals):
        y = signal["terminals"][0][1]
        y_low = y - width / 2
        excited = not (len(signals) == 3 and index == 1)
        # Soft LumpedPort excitation is an E-field increment, not a prescribed
        # Thevenin voltage. Use a hard voltage feed below a series 30-ohm R.
        midpoint = z0 / 2 if excited else 0
        resistance = csx.AddLumpedElement(f"source-r-{index}", ny=2, caps=True, R=30)
        resistance.AddBox([x_near, y_low, midpoint],
                          [x_near + port_span, y + width / 2, z0], priority=20)
        if excited:
            feed = csx.AddExcitation(f"voltage-source-{index}", exc_type=1,
                                     exc_val=[0, 0, -1 / (midpoint * 1e-3)])
            feed.AddBox([x_near, y_low, 0],
                        [x_near + port_span, y + width / 2, midpoint], priority=20)
        if excited:
            source_probe = csx.AddProbe(f"source-{index}", p_type=0, weight=-1)
            source_probe.AddBox([x_near, y, 0], [x_near, y, midpoint])
        load = csx.AddLumpedElement(f"load-{index}", ny=2, caps=True, C=5e-12)
        load.AddBox([x_far - port_span, y_low, 0],
                    [x_far, y + width / 2, z0], priority=20)
        # Probe at the actual electrical endpoint, with the same local plane
        # reference as the lumped capacitor. This path must be stated explicitly.
        for end, x in [("near", x_near), ("far", x_far)]:
            probe = csx.AddProbe(f"{end}-{index}", p_type=0, weight=-1)
            probe.AddBox([x, y, 0], [x, y, z0])
    shape = [len(grid.GetLines(axis)) for axis in "xyz"]
    cells = int(np.prod(np.array(shape) - 1))
    if cells > 2500000:
        raise RuntimeError(f"Refusing {cells} cells before solver allocation")
    manifest = {"case": args.case, "density": args.density,
                "source_geometry": str(source),
                "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "mesh_lines": shape, "cells": cells,
                "duration_ns": args.duration_ns, "pilot_steps": args.pilot_steps,
                "longitudinal_spacing_mm": longitudinal,
                "padding_mm": padding, "source_v": expression,
                "pml": "8 uniform 0.8-mm cells outside the clear-air padding",
                "step_response": args.step_response,
                "solver_threads": args.threads,
                "metal_edge_rule": "lateral one-third inside/two-thirds outside",
                "short_gap_grading_passes": 4,
                "mirror_mesh_axes": ["x", "y"],
                "approximations": [
                    "PEC finite-thickness copper; conductor loss is not solved",
                    "Local vertical R/C circuit ports contact the plane under each trace",
                    "Port spans extend half a trace width inward from the endpoint",
                    "Only trace copper and plane; TSX terminal pad end extensions omitted",
                    "Open voltage probes integrate vertical E to the local plane",
                    "The 3D extractor instead has two shared radius-0.15-mm ground contacts",
                ]}
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    fdtd.Write2XML(str(args.output / "model.xml"))
    print(json.dumps(manifest), flush=True)
    start = time.monotonic()
    fdtd.Run(str(args.output), cleanup=False, setup_only=args.setup_only,
             numThreads=args.threads, dump_statistics=True)
    (args.output / "wall-seconds.txt").write_text(str(time.monotonic() - start))


if __name__ == "__main__":
    main()
