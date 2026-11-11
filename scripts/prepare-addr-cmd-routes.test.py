"""Synthetic width-step checks; real-board reproduction remains the TSX fixture."""

import copy
import importlib
import math
import unittest

patch = importlib.import_module("prepare-addr-cmd-routes")


class NeckdownTest(unittest.TestCase):
    def test_rectangular_obstacle_keeps_endpoints_and_length(self):
        points = [{"route_type": "wire", "x": x, "y": 0, "layer": "top", "width": .18} for x in [0, 10]]
        trace = {"route": copy.deepcopy(points)}
        length = patch.neckdown(trace, [{"center": {"x": 6, "y": .25}, "obstacle_radius_mm": .8, "layer": "top"}])
        self.assertAlmostEqual(length, 3.1)
        self.assertEqual(trace["route"][0], points[0])
        self.assertEqual(trace["route"][-1], points[-1])
        segments = list(zip(trace["route"], trace["route"][1:]))
        self.assertAlmostEqual(sum(math.dist([a["x"], a["y"]], [b["x"], b["y"]]) for a, b in segments), 10)
        self.assertTrue(all(b["width"] == .1 for a, b in segments if a["x"] < 6.8 and b["x"] > 5.2))
        self.assertTrue(any(a["x"] == b["x"] and a["width"] != b["width"] for a, b in segments))

    def test_other_layer_remains_byte_identical(self):
        trace = {"route": [{"route_type": "wire", "x": x, "y": 0, "layer": "bottom", "width": .18} for x in [0, 10]]}
        original = copy.deepcopy(trace)
        self.assertEqual(patch.neckdown(trace, [{"center": {"x": 6, "y": 0}, "layer": "top"}]), 0)
        self.assertEqual(trace, original)


if __name__ == "__main__":
    unittest.main()
