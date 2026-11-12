"""Analytical waveform checks; these are synthetic data, not native circuit evidence."""

from importlib import import_module
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import numpy

summary = import_module("summarize-addr-cmd-qualification")


class QualificationSummary(unittest.TestCase):
    """Check integration against a known ramp crossing an arbitrary capture boundary."""

    def setUp(self) -> None:
        """Supply an analytical trace through the existing summary interface."""
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        (self.path / "simulation.cir").write_text("* Synthetic integration fixture\n.end\n")
        data = numpy.array([(0, 0), (4e-9, 1.5), (4.5e-9, 2), (4.99e-9, 2.49),
                            (5e-9, 2.5), (8e-9, 0)], dtype=[("time_s", float), ("A4_0", float)])
        ledger = {"routes": [{"port": "A4", "sourceTraceId": "synthetic"}],
                  "wires": [{"source": "synthetic", "layer": "top", "start": 0, "end": 1}],
                  "stimuli": [{"name": "A4", "pattern": "1", "seed": 1,
                               "bit_rate_bps": 4e8, "offset_s": 0}],
                  "cells": 1, "maximum_cell_delay_s": 1e-10,
                  "scope": {"lateralDistanceMm": 1},
                  "options": {"durationSeconds": 8e-9, "stepSeconds": 1e-11}}
        loader = patch.object(summary.measurement, "load", return_value=(data, ledger, {}))
        loader.start()
        self.addCleanup(loader.stop)

    def test_integrates_to_requested_boundary(self) -> None:
        """The above-rail ramp has area one half times 0.999 ns squared."""
        rows, waves, _ = summary.metrics(self.path, 4.999)
        self.assertAlmostEqual(rows[0]["max_overshoot_lobe_v_ns"], .4990005, places=10)
        self.assertAlmostEqual(waves["A4"][0][-1] * 1e9, 4.999, places=12)

    def test_keeps_complete_window_area(self) -> None:
        """The full triangle spans 2.2 ns at a one-volt height."""
        rows, _, _ = summary.metrics(self.path, 8)
        self.assertAlmostEqual(rows[0]["max_overshoot_lobe_v_ns"], 1.1, places=10)

    def test_rejects_window_past_capture(self) -> None:
        """A manifest cannot claim a longer window than its recorded waveform."""
        with self.assertRaises(ValueError):
            summary.metrics(self.path, 9)


if __name__ == "__main__":
    unittest.main()
