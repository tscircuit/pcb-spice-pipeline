"""Synthetic PWL invariants; native convergence must be checked independently."""

from importlib import import_module
import unittest

control = import_module("prepare-addr-cmd-control")


class ControlPadding(unittest.TestCase):
    """Keep measured data fixed while widening only an artificial flat-state guard."""

    def test_preserves_edge_samples_and_circuit(self) -> None:
        """Only the held-state timestamp changes; the measured samples remain exact."""
        source = "Rload out vtt 50\nVKD0 kd 0 PWL(0 1 2.499999e-9 1 2.5e-9 .999367 2.6e-9 .5)\nVVTT vtt 0 .75\n"
        result, evidence = control.pad_corners(source, 1e-12)
        self.assertEqual(result, source.replace("2.499999e-9", "2.499e-09"))
        self.assertEqual(evidence["changed_hold_points"], 1)
        self.assertLess(evidence["maximum_hold_time_shift_seconds"], 1e-12)

    def test_rejects_measured_small_interval(self) -> None:
        """A short interval without a preceding equal-value hold is not padding."""
        with self.assertRaises(ValueError):
            control.pad_corners("VKU0 ku 0 PWL(0 0 2.499999e-9 .1 2.5e-9 .2)\n", 1e-12)

    def test_rejects_invalid_padding(self) -> None:
        """An experimental caller cannot request a nonfinite or large timing change."""
        for padding in [0, -1, float("nan"), 11e-12]:
            with self.assertRaises(ValueError):
                control.pad_corners("", padding)


if __name__ == "__main__":
    unittest.main()
