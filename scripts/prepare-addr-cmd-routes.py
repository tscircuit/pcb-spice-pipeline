"""Patch widths or one spacing dogleg in matching copied route data; preserve the source board."""

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path


def main():
    """Width-only subset of the existing route-edit fast-patch prototype, with match guards."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("board", type=Path)
    parser.add_argument("routes", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--width", type=float, default=None)
    parser.add_argument("--spacing", type=float, default=None)
    parser.add_argument("--route-delta", type=Path, action="append", default=[])
    args = parser.parse_args()
    if args.width is not None and not .17 <= args.width <= .19:
        raise ValueError("Expected outer width in [0.17, 0.19] mm")
    if (args.width is None) == (args.spacing is None):
        raise ValueError("Select one width or spacing experiment")
    if args.spacing is not None and not 0 < args.spacing <= .3:
        raise ValueError("Spacing shift must be in (0,0.3] mm")
    if args.output.resolve().is_relative_to(args.board.resolve().parent) or args.output.resolve().is_relative_to(args.routes.resolve().parent.parent):
        raise ValueError("Output must be outside the source board folder")
    board_bytes = args.board.read_bytes()
    route_bytes = args.routes.read_bytes()
    board = json.loads(board_bytes)
    original = json.loads(route_bytes)
    deltas = {}
    for path in args.route_delta:
        delta_bytes = path.read_bytes()
        delta = json.loads(delta_bytes)
        route = next(route for route in original["routes"] if route["name"] == delta["before"]["name"])
        if route["points"] != delta["before"]["points"]:
            raise ValueError("Route delta does not match its source data")
        route["points"] = delta["after"]["points"]
        deltas[path.name] = hashlib.sha256(delta_bytes).hexdigest()
    changed = copy.deepcopy(original)
    names = {"DDR_" + name for name in ["A0", "A1", "A2", "A3", "A5", "A9", "A10", "A12", "BA0", "CASn", "RASn", "CSn0", "ODT"]}
    if args.spacing is not None:
        names = {"DDR_A4"}
    routes = {route["name"]: route for route in original["routes"] if route["name"] in names}
    if routes.keys() != names:
        raise ValueError("Unexpected outer addr/cmd route set")
    for route in changed["routes"]:
        if route["name"] in names:
            if args.width is not None:
                if route["layer"] not in ["top", "bottom"]:
                    raise ValueError("Width experiment must only change outer routes")
                route["width"] = args.width
            else:
                points = route["points"]
                index = max(range(len(points) - 1), key=lambda i: math.dist(points[i], points[i + 1]))
                a, b = points[index:index + 2]
                if abs(a[0] - b[0]) > 1e-6 or abs(a[0] + 7.15) > 1e-6 or b[1] >= a[1]:
                    raise ValueError("Expected A4 vertical coupled body")
                shift = args.spacing
                points[index + 1:index + 1] = [[a[0] + shift, a[1] - shift], [b[0] + shift, b[1] + shift]]
    sources = {record["source_trace_id"]: record for record in board if record["type"] == "source_trace"}
    patched = []
    for trace in board:
        if trace["type"] != "pcb_trace":
            continue
        source = sources.get(trace.get("source_trace_id"), {})
        route = routes.get(source.get("name"))
        if route is None:
            continue
        points = [[round(point["x"], 6), round(point["y"], 6)] for point in trace["route"]
                  if point["route_type"] == "wire" and point["layer"] == route["layer"]]
        expected = [[round(x, 6), round(y, 6)] for x, y in route["points"]]
        # Board emitters may duplicate pad/via endpoints. Compare the innermost path.
        while len(points) > 1 and points[0] == points[1]:
            points.pop(0)
        while len(points) > 1 and points[-1] == points[-2]:
            points.pop()
        if points != expected:
            continue
        if args.width is not None:
            for point in trace["route"]:
                if point["route_type"] == "wire":
                    point["width"] = args.width
            source["min_trace_thickness"] = args.width
        else:
            changed_route = next(r for r in changed["routes"] if r["name"] == source["name"])
            added = [point for point in changed_route["points"] if point not in route["points"]]
            index = max(range(len(route["points"]) - 1), key=lambda i: math.dist(route["points"][i], route["points"][i + 1]))
            a = route["points"][index]
            position = next(i for i, point in enumerate(trace["route"]) if point["route_type"] == "wire" and point["layer"] == route["layer"] and math.dist([point["x"], point["y"]], a) < 1e-6)
            trace["route"][position + 1:position + 1] = [{"route_type": "wire", "x": x, "y": y, "width": .1, "layer": route["layer"]} for x, y in added]
            trace["trace_length"] += 2 * args.spacing * (math.sqrt(2) - 1)
        patched.append(source["name"])
    if set(patched) != names or len(patched) != len(names):
        raise ValueError(f"Expected exactly one physical route per net, found {patched}")
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "routes-before.json").write_text(json.dumps(original))
    (args.output / "routes-after.json").write_text(json.dumps(changed))
    (args.output / "circuit.json").write_text(json.dumps(board))
    manifest = {"source_board_sha256": hashlib.sha256(board_bytes).hexdigest(),
                "source_routes_sha256": hashlib.sha256(route_bytes).hexdigest(),
                "source_route_deltas_sha256": deltas,
                "patched": sorted(patched), "width_mm": args.width, "a4_shift_mm": args.spacing,
                "copy_sha256": hashlib.sha256((args.output / "circuit.json").read_bytes()).hexdigest(),
                "policy": "copied route-data candidate; original layer, endpoints and vias retained; DRC required"}
    (args.output / "patch.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if args.board.read_bytes() != board_bytes or args.routes.read_bytes() != route_bytes:
        raise ValueError("Read-only inputs changed")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
