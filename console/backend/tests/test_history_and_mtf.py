"""Pins for 5 Oct 2026: a Pine run's history follows the script, and multi-timeframe is not silent.

* A lookback longer than the 500 bars a run was given produced NOTHING (a 52-week high on a 4h chart
  came back na on all 500 bars; a 500-bar lookback gave one point). The run now fetches what the script
  states it needs (up to 5000), /api/bars pages back through Binance's 1000-per-request ceiling, and the
  overlay maps drawing indices through the bars the script ran on, not through a fresh 500.
* request.security RUNS in this engine and ignores the timeframe ("D" close == the chart's close), so a
  multi-timeframe indicator drew the chart's own levels without a word. It now says so.

The JS helpers are executed in Node (skipped without it); the paging is tested with a fake venue.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
NODE = shutil.which("node")

import server as srv  # noqa: E402


def function_source_for_tests(src, name):
    """A function inside unified.js's IIFE, by indentation: it starts at `  function name(` and ends at the
    first line that is exactly `  }`. (A brace matcher chokes on the quote characters inside regex literals.)"""
    m = re.search(r"^  (?:async )?function %s\(" % re.escape(name), src, re.M)
    assert m, "function %s not found" % name
    end = re.search(r"^  \}$", src[m.start():], re.M)
    assert end, "no closing brace for %s" % name
    return src[m.start():m.start() + end.end()]


def read(name):
    with open(os.path.join(ROOT, "console", "frontend", name), encoding="utf-8") as fh:
        return fh.read()


def run_node(script):
    out = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=30, check=False)
    assert out.returncode == 0, out.stderr[-600:]
    return json.loads(out.stdout)


def fake_venue(total, step_ms=3600_000, newest=1_700_000_000_000):
    """A venue holding `total` bars; answers like klines (limit, endTime), oldest first, string numbers."""
    calls = []
    series = [newest - (total - 1 - i) * step_ms for i in range(total)]

    def klines(symbol, interval, limit, end_time=None):
        calls.append((limit, end_time))
        pool = [t for t in series if end_time is None or t <= end_time]
        return [[t, "1", "2", "0.5", "1.5", "10"] for t in pool[-limit:]]
    return klines, calls, series


class BarsArePagedThroughTheVenueCeiling(unittest.TestCase):
    def test_a_deep_request_is_several_pages_stitched_in_order(self):
        venue, calls, series = fake_venue(6000)
        with mock.patch.object(srv, "_fetch_klines", venue):
            out = srv.fetch_bars("BTCUSDT", "1h", 2500)
        self.assertEqual(out["count"], 2500)
        self.assertEqual([b["time"] for b in out["bars"]], series[-2500:], "oldest first, no gaps, no repeats")
        self.assertEqual([c[0] for c in calls], [1000, 1000, 500], "pages of at most 1000")
        self.assertIsNone(calls[0][1], "the first page is the newest")
        self.assertEqual(calls[1][1], series[-1000] - 1, "each next page ends just before the last began")
        self.assertNotIn("error", out)

    def test_the_ceiling_is_5000_bars(self):
        venue, calls, _ = fake_venue(9000)
        with mock.patch.object(srv, "_fetch_klines", venue):
            out = srv.fetch_bars("BTCUSDT", "1h", 99999)
        self.assertEqual(out["count"], 5000)
        self.assertEqual(len(calls), 5)

    def test_a_short_history_stops_cleanly(self):
        venue, calls, _ = fake_venue(1300)
        with mock.patch.object(srv, "_fetch_klines", venue):
            out = srv.fetch_bars("NEWCOIN", "1h", 4000)
        self.assertEqual(out["count"], 1300)
        self.assertNotIn("error", out, "running out of history is not an error")

    def test_a_failing_later_page_returns_what_was_gathered(self):
        venue, _, _ = fake_venue(5000)
        state = {"n": 0}

        def flaky(symbol, interval, limit, end_time=None):
            state["n"] += 1
            if state["n"] == 2:
                raise OSError("tunnel closed")
            return venue(symbol, interval, limit, end_time)
        with mock.patch.object(srv, "_fetch_klines", flaky):
            out = srv.fetch_bars("BTCUSDT", "1h", 3000)
        self.assertEqual(out["count"], 1000)
        self.assertTrue(out["partial"])
        self.assertIn("OSError", out["error"])

    def test_a_dead_venue_is_an_answer_not_a_crash(self):
        with mock.patch.object(srv, "_fetch_klines", side_effect=OSError("403")):
            out = srv.fetch_bars("BTCUSDT", "1h", 500)
        self.assertEqual(out["bars"], [])
        self.assertFalse(out["partial"])

    def test_the_endpoint_clamps_and_normalises(self):
        venue, calls, _ = fake_venue(3000)
        with mock.patch.object(srv, "_fetch_klines", venue):
            out = srv.ep_bars({"symbol": ["btcusdt"], "interval": ["4H"], "limit": ["1200"]})
        self.assertEqual((out["symbol"], out["interval"], out["count"]), ("BTCUSDT", "4h", 1200))
        with mock.patch.object(srv, "_fetch_klines", venue):
            self.assertEqual(srv.ep_bars({"symbol": ["btcusdt"], "limit": ["junk"]})["count"], 500)
            self.assertEqual(srv.ep_bars({})["error"], "symbol_required")


@unittest.skipUnless(NODE, "node not installed")
class TheRunWindowFollowsTheScript(unittest.TestCase):
    @staticmethod
    def helpers():
        src = read("unified.js")
        consts = "".join(re.search(r"const %s = \d+;" % n, src).group(0) + "\n" for n in ("BASE_BARS", "MAX_BARS", "WARM_BARS"))
        return consts + "\n".join(function_source_for_tests(src, n)
                                  for n in ("stripComments", "lookbackNeeded", "depthFor", "tfKey", "scriptNotes"))

    def test_the_longest_stated_lookback_is_found(self):
        cases = {
            "plot(ta.highest(high, 2184))": 2184,
            "x = close[250]\nplot(ta.sma(close, 20))": 250,
            "len = input.int(1500, 'Length')": 1500,
            "length = 800": 800,
            "plot(ta.ema(close, input.int(50)))": 50,                   # an input default is a stated length
            "plot(ta.ema(close, myLen))": 0,                            # no literal: nothing stated
            "// ta.highest(high, 9999)\nplot(close)": 0,                # comments do not count
            'label.new(bar_index, high, "ta.sma(close, 3000)")': 0,     # neither do strings
            "plot(ta.rsi(close, 14))": 14,
            "a = ta.highest(high, 90000)": 0,                            # absurd: ignored, not obeyed
        }
        script = self.helpers() + "\nconst c = %s;\nconsole.log(JSON.stringify(Object.fromEntries(Object.keys(c).map(k => [k, lookbackNeeded(k)]))));" % json.dumps(cases)
        got = run_node(script)
        for src, want in cases.items():
            self.assertEqual(got[src], want, src)

    def test_depth_has_a_floor_a_warmup_and_a_ceiling(self):
        script = self.helpers() + """
        console.log(JSON.stringify({
          none: depthFor('plot(close)').limit, small: depthFor('plot(ta.sma(close, 200))').limit,
          deep: depthFor('plot(ta.highest(high, 2184))').limit, huge: depthFor('plot(ta.highest(high, 19000))').limit }));"""
        got = run_node(script)
        self.assertEqual(got, {"none": 500, "small": 500, "deep": 2484, "huge": 5000})

    def test_timeframe_spellings_compare_equal(self):
        cases = {"1h": "1h", "60": "1h", "240": "4h", "4h": "4h", "D": "1d", "1D": "1d", "1d": "1d", "W": "1w",
                 "15": "15m", "15m": "15m", "1M": "1M"}
        script = self.helpers() + "\nconst c = %s;\nconsole.log(JSON.stringify(Object.fromEntries(Object.keys(c).map(k => [k, tfKey(k)]))));" % json.dumps(cases)
        self.assertEqual(run_node(script), cases)

    def test_request_security_is_called_out_unless_it_asks_for_the_charts_own_timeframe(self):
        cases = [
            ('d = request.security(syminfo.tickerid, "D", close)', "1h", 1),
            ('d = request.security(syminfo.tickerid, "W", [high, low])', "4h", 1),
            ('x = request.security(syminfo.tickerid, "60", close)', "1h", 0),          # the chart's own: honest
            ('x = request.security(syminfo.tickerid, "240", close)', "4h", 0),
            ('x = request.security(syminfo.tickerid, tf, close)', "1h", 1),             # unknown timeframe: flag it
            ('x = request.security(ticker.new("a", "b"), "D", close)', "1h", 1),
            ('a = request.security(syminfo.tickerid, "D", close)\nb = request.security(syminfo.tickerid, "W", close)', "1h", 1),
            ('// request.security(syminfo.tickerid, "D", close)\nplot(close)', "1h", 0),  # a comment
            ('plot(ta.sma(close, 20))', "1h", 0),
            ('x = mysecurity(1, 2, 3)', "1h", 0),
        ]
        script = self.helpers() + "\nconst cases = %s;\nconsole.log(JSON.stringify(cases.map(([s, tf]) => scriptNotes(s, tf).length)));" % json.dumps(cases)
        got = run_node(script)
        for (src, tf, want), n in zip(cases, got):
            self.assertEqual(n, want, "%s on %s" % (src, tf))

    def test_the_note_says_what_is_wrong_in_plain_words(self):
        script = self.helpers() + "\nconsole.log(JSON.stringify(scriptNotes('request.security(syminfo.tickerid, \"D\", close)', '1h')));"
        note = run_node(script)[0]
        self.assertIn("OWN timeframe", note)
        self.assertIn("equal this chart", note)


class WiringIsInPlace(unittest.TestCase):
    def test_chartbars_takes_a_depth_and_the_default_stays_cheap(self):
        app = read("app.js")
        self.assertIn("async function chartBars(opts)", app)
        self.assertIn("limit=${want}", app)
        self.assertIn("|| 500", app, "the heartbeat and overlay still ask for 500")
        self.assertNotIn("limit=500`", app)

    def test_a_run_fetches_by_script_and_scales_its_deadline(self):
        src = read("unified.js")
        self.assertIn("depthFor(pine)", src)
        self.assertIn("chartBars({ limit: depth.limit })", src)
        self.assertRegex(src, r"timeoutMs: Math\.min\(90000, Math\.round\(20000 \* Math\.max\(1, bars\.length / BASE_BARS\)\)\)")

    def test_the_overlay_maps_through_the_bars_the_script_ran_on(self):
        ov, un = read("overlay.js"), read("unified.js")
        self.assertIn("runBars = (opts && Array.isArray(opts.bars) && opts.bars.length) ? opts.bars : null;", ov)
        self.assertIn("if (runBars) return runBars;", ov)
        self.assertIn("const ref = runBars || barsCache.bars;", ov)
        self.assertIn("Object.assign({}, opts || {}, { bars })", un)
        remember = re.search(r"if \(!\(opts && opts\.restoring\)\) remember\(([^)]*)\)", un)
        self.assertTrue(remember and "bars" not in remember.group(1),
                        "the run's 5000 bars must never be written to localStorage")

    def test_the_note_reaches_the_summary_and_the_legend(self):
        un = read("unified.js")
        self.assertIn("record(label, drew, warnings);", un)
        self.assertIn("r.warnings.join(", un)
        self.assertIn("see note", un)
        self.assertIn("warnings, depth,", un)

    def test_the_docs_no_longer_call_request_security_a_clean_run(self):
        with open(os.path.join(ROOT, "docs", "studies", "pinets-smc-studies.md"), encoding="utf-8") as fh:
            doc = fh.read()
        row = [ln for ln in doc.splitlines() if "request.security" in ln and "**RUN**" in ln]
        self.assertEqual(row, [], "request.security runs but ignores the timeframe — it is not a clean RUN")
        with open(os.path.join(ROOT, "docs", "studies", "capability.py"), encoding="utf-8") as fh:
            cap = fh.read()
        self.assertIn("ignores the timeframe", cap)


if __name__ == "__main__":
    unittest.main()
