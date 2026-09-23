"""The staleness warning must fire when the chart is old and stay quiet when it is not.

Why this is a test and not a convention: a warning that fires on a healthy chart is noise an agent
learns to ignore, and one that never fires is decoration. Both are worse than no warning at all,
because the agent has been told there is a guard and stops checking for itself.

The failure this exists for is real and was seen in this repo: a chart pane closed for three hours
still answered every read with a perfectly plausible symbol, price and bar count. Nothing in the
payload said "this is three hours old" — the age was there, but with no scale attached to it.

Needs no fastmcp: `_freshness` is the pure part, and the boundaries are the whole question.
"""

import importlib.util
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MCP_SERVER = os.path.join(ROOT, "console", "mcp", "server.py")


def _load():
    """Import the freshness guard itself.

    Deliberately not the MCP server: that file exits without fastmcp, and a guard that only exists
    when a dependency is installed is not a guard. The logic under test is pure, so it is reachable
    from the plain suite.
    """
    path = os.path.join(ROOT, "console", "mcp", "freshness.py")
    name = "trader_freshness_under_test"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class FreshnessWarning(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def test_a_live_chart_says_nothing(self):
        # The page republishes every 4s, so a few seconds old is normal and must not be flagged.
        for age in (0, 4, 29):
            with self.subTest(age=age):
                self.assertEqual(self.mod._freshness(age), "",
                                 f"a chart {age}s old is healthy and must not warn")

    def test_a_stale_chart_says_so(self):
        for age in (30, 120, 299):
            with self.subTest(age=age):
                self.assertIn("last spoke", self.mod._freshness(age))

    def test_a_dead_chart_says_the_numbers_are_not_live(self):
        # The real case: a pane closed for hours still answers, and the agent has to be told that
        # what it is reading describes an older moment.
        msg = self.mod._freshness(10900)
        self.assertIn("STALE", msg)
        self.assertIn("181 min", msg)
        self.assertIn("never run", msg)

    def test_a_missing_age_is_not_treated_as_fresh(self):
        # Silence about age is not evidence of freshness, and must not read as if it were.
        msg = self.mod._freshness(None)
        self.assertIn("unverified", msg)
        self.assertNotEqual(msg, "")

    def test_thresholds_are_in_the_documented_order(self):
        self.assertLess(self.mod.STALE_AFTER_S, self.mod.DEAD_AFTER_S)
        self.assertGreater(self.mod.STALE_AFTER_S, 4,
                           "must be longer than the page's own 4s republish interval")


class CommandGate(unittest.TestCase):
    """The read warns at 30s and still delivers its numbers; a command nobody can claim is eight
    seconds of pretending. So the gate must fire exactly when the page can no longer claim — and
    never before: one refusal on a healthy chart teaches the agent to route around the gate, which
    is worse than having no gate at all."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def test_a_healthy_or_unknown_age_lets_the_command_through(self):
        # None, garbage, and anything under the gate must queue: push-and-wait already handles
        # those honestly (pushed=0, the timeout sentence), and guessing here would refuse a chart
        # that is merely mid-run.
        for age in (None, 0, 4, 9.9, "n/a"):
            with self.subTest(age=age):
                self.assertEqual(self.mod._command_gate(age), "")

    def test_the_boundary_fires_exactly_at_the_gate(self):
        gate = self.mod.COMMAND_MAX_AGE_S
        self.assertEqual(self.mod._command_gate(gate - 0.1), "")
        self.assertIn("not answering", self.mod._command_gate(gate))

    def test_a_frozen_page_is_refused_with_the_fix_and_no_queue(self):
        msg = self.mod._command_gate(37)
        self.assertIn("37s", msg)
        self.assertIn("Trader's Agent", msg)
        self.assertIn("Nothing was queued", msg)

    def test_the_gate_sits_below_the_read_warning_and_over_missed_beats(self):
        # Commands gate harder than reads (a refused command costs a retry; a warned read still
        # arrives), but never tighter than two missed 4s heartbeats.
        self.assertLess(self.mod.COMMAND_MAX_AGE_S, self.mod.STALE_AFTER_S)
        self.assertGreaterEqual(self.mod.COMMAND_MAX_AGE_S, 9)


if __name__ == "__main__":
    unittest.main()
