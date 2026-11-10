"""Retain controlled native comparisons and the exact shared-return energy decomposition."""

from pathlib import Path
import hashlib
import importlib
import json
import numpy as np

compare = importlib.import_module("compare-routed-waveforms").compare
root = Path("runs/routed-2d/step4/controlled")
controlled = []
for name in ["1-0.3", "3-0.3", "3-1-short"]:
    directory = root / name
    values = json.loads((directory / "matrices.json").read_text())
    reference = np.loadtxt(directory / "threeD/waveform.dat", skiprows=1)
    candidate = np.loadtxt(directory / "twoD/waveform.dat", skiprows=1)
    result = compare(reference, candidate, 1.65)
    (directory / "comparison.json").write_text(json.dumps(result, indent=2) + "\n")
    geometry = json.loads((directory / "geometry.json").read_text())
    cell = geometry["cells"][0]
    controlled.append({
        "name": name,
        "fixture": "tests/fixtures/return-agreement.tsx",
        "rendered_input_sha256": hashlib.sha256((directory / "input.json").read_bytes()).hexdigest(),
        "length_mm": cell["conductors"][0]["lengthM"] * 1000,
        "trace_width_mm": cell["conductors"][0]["widthM"] * 1000,
        "dielectric": geometry["stackup"]["dielectrics"],
        "comparison": result,
        "matrices": {"threeD": {kind: values["threeD"][kind] for kind in ["R", "L", "C"]}, "twoD": values["twoD"]},
        "native_checks": {key: values["threeD"]["checks"][key] for key in ["convergence", "capConvergence", "energyResidual"]},
        "native_usage": {p.parent.name: json.loads(p.read_text()) for p in sorted(directory.glob("*/usage.json"))},
        "waveform_sha256": {method: hashlib.sha256((directory / method / "waveform.dat").read_bytes()).hexdigest() for method in ["threeD", "twoD"]},
    })

directory = Path("runs/final-rfc/three/TRAFFIC/blocks/simulation_signal_integrity_0")
extracted = json.loads((directory / "stage-0/extraction.json").read_text())
geometry = json.loads((directory / "geometry.json").read_text())
decomposition = {}
for kind in ["R", "L"]:
    primitive = np.array(extracted["modelPrimitiveImpedance"][kind])
    primitive = (primitive + primitive.T) / 2
    common = primitive[-1, -1]
    mutual = primitive[:-1, -1]
    shorted = primitive[:-1, :-1] - np.outer(mutual, mutual) / common
    closure = common * np.outer(1 - mutual / common, 1 - mutual / common)
    loop = primitive[:-1, :-1] - mutual[:, None] - mutual[None, :] + common
    assert np.allclose(loop, shorted + closure, rtol=1e-12, atol=1e-20)
    decomposition[kind] = {"primitive": primitive.tolist(), "shorted_return": shorted.tolist(), "shared_return_closure": closure.tolist(), "fixed_return_loop": loop.tolist()}
board = json.loads(Path("runs/final-rfc/three/TRAFFIC/input.json").read_text())
ground_ports = [r["source_port_id"] for r in board if r["type"] == "source_port" and r.get("name") == "GND"]

evidence = {
    "status": "routed-2d-unqualified",
    "controlled": controlled,
    "rfc_return": {
        "source": str(directory / "stage-0/extraction.json"),
        "source_sha256": hashlib.sha256((directory / "stage-0/extraction.json").read_bytes()).hexdigest(),
        "primitive_order": extracted["primitiveOrder"],
        "frequency_hz": extracted["frequencyHz"],
        "decomposition": decomposition,
        "rendered_ground_ports": ground_ports,
        "extracted_ground_ports": geometry["cells"][0]["routedCopper"]["referenceSourcePortIds"],
        "limitation": "The accepted 3D model extracts two selected ground leads, not a multi-contact return for all six rendered chips. The exact energy decomposition is not a measured physical ground-bounce attribution.",
    },
    "rejected_controls": [
        {"case": "single with 9/17 filaments", "peak_rss_kib": 1055568, "reason": "sampled 1 GiB guard stopped FastHenry; result discarded"},
        {"case": "10 mm three-trace, 1 mm spacing", "peak_rss_kib": 1081696, "reason": "FasterCap exceeded the sampled 1 GiB guard; no accepted C or waveform; replaced by a 5 mm TSX control"},
    ],
}
checks = {}
for kind in ["space", "time"]:
    path = Path(f"runs/routed-2d/step4/magnetic-{kind}/comparison.json")
    if path.exists():
        checks[kind] = json.loads(path.read_text())
evidence["magnetic_xtalk_high_refinement"] = checks
path = Path("runs/routed-2d/step4/magnetic-space/three/XTALK_HIGH/reference-comparison.json")
if path.exists():
    evidence["magnetic_xtalk_high_refined_vs_3d"] = json.loads(path.read_text())
Path("tests/evidence/signal-levels/routed-2d-mechanisms.json").write_text(json.dumps(evidence, indent=2) + "\n")
for case in controlled:
    probes = case["comparison"]["probes"]
    print(case["name"], case["comparison"]["accepted"], max(p["rms_v"] for p in probes) * 1000, max(p["peak_difference_v"] for p in probes) * 1000)
