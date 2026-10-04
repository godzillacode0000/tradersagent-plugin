"""Pins for the 4 Oct 2026 indicator audit (library Pine scripts vs built-ins).

The built-ins were stable and the LuxAlgo-library scripts were not, for reasons that were all measured in
a real browser and none of which a source-shape test of the old code could see:

1. the chart's timeframe was read off the page's text and always came out "1m" (Vela keeps its closed
   timeframe dropdown in the DOM, first item "1m"), so every Pine run used the last 500 MINUTES of bars;
2. the worker's projection did ``arr.map(jsonSafe)``, which hands the array INDEX to ``jsonSafe`` as its
   depth argument — everything past element 6 became null, so every script drew at most 7 boxes, 7 lines
   and 7 labels (the oldest ones);
3. the overlay was a picture of one run and never followed a symbol / timeframe change;
4. the "legend shows N studies" banner compared series with indicators and fired on a plain RSI;
5. the legend listed every script ever run although the overlay holds one;
6. a canvas made for an old host stayed in the DOM with its pixels.

The two functions that carried 1 and 2 are executed in Node here (skipped without it), not just grepped.
"""
import json
import os
import re
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
NODE = shutil.which("node")


def read(name):
    with open(os.path.join(ROOT, "console", "frontend", name), encoding="utf-8") as fh:
        return fh.read()


def function_source(src, name):
    """The text of ``function name(...) { ... }`` — found by brace matching, strings and comments aside."""
    m = re.search(r"(?:async\s+)?function\s+" + re.escape(name) + r"\s*\(", src)
    assert m, "function %s not found" % name
    i = src.index("{", m.end())
    depth = 0
    j = i
    while j < len(src):
        c = src[j]
        if c in "'\"`":
            q = c
            j += 1
            while src[j] != q:
                j += 2 if src[j] == "\\" else 1
        elif src.startswith("//", j):
            j = src.index("\n", j)
        elif src.startswith("/*", j):
            j = src.index("*/", j) + 1
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[m.start():j + 1]
        j += 1
    raise AssertionError("unbalanced braces in " + name)


def run_node(script):
    out = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=30, check=False)
    assert out.returncode == 0, out.stderr[-600:]
    return json.loads(out.stdout)


@unittest.skipUnless(NODE, "node not installed")
class WorkerKeepsEveryDrawing(unittest.TestCase):
    def test_a_container_row_with_many_objects_survives_projection(self):
        src = read("pinets-worker.js")
        script = function_source(src, "projectPlots") + "\n" + function_source(src, "jsonSafe") + """
        const objs = Array.from({length: 250}, (_, i) => ({x1: i, y1: 1, x2: i + 3, y2: 2, color: '#fff'}));
        const out = projectPlots({__lines__: [{value: objs, time: 1, options: {}}]});
        const kept = out.__lines__[0].value;
        console.log(JSON.stringify({n: kept.length, nulls: kept.filter(v => v === null).length, last: kept[249] && kept[249].x1}));
        """
        res = run_node(script)
        self.assertEqual(res, {"n": 250, "nulls": 0, "last": 249},
                         "objects past the 7th were dropped: the index went in as jsonSafe's depth")

    def test_the_map_callback_is_not_the_bare_function(self):
        src = read("pinets-worker.js")
        self.assertNotRegex(src, r"\.map\(\s*jsonSafe\s*\)",
                            "Array.map passes (value, index, array): index would be read as depth")


@unittest.skipUnless(NODE, "node not installed")
class TimeframeComesFromTheWorkspace(unittest.TestCase):
    CASES = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "2h": "2h", "4h": "4h",
             "1d": "1d", "1w": "1w", "60": "1h", "240": "4h", "1440": "1d", "90": "90m", "15": "15m",
             "D": "1d", "1D": "1d", "W": "1w", "1W": "1w", "1M": "1M", "H": "1h"}

    def test_every_format_a_cell_can_hold_maps_to_a_venue_interval(self):
        src = read("app.js")
        script = function_source(src, "intervalOf") + "\nconst c = %s;\n" % json.dumps(self.CASES) + \
            "console.log(JSON.stringify(Object.fromEntries(Object.keys(c).map(k => [k, intervalOf(k)]))));"
        self.assertEqual(run_node(script), self.CASES)

    def test_the_workspace_is_asked_before_the_dom_is_scraped(self):
        src = read("app.js")
        body = function_source(src, "marketFromDom")
        self.assertLess(body.index("marketFromWorkspace()"), body.index("querySelectorAll"),
                        "the workspace must be consulted before any DOM scan")
        self.assertIn("ws.cellsById", function_source(src, "marketFromWorkspace"))
        self.assertIn("ws.activeId", function_source(src, "marketFromWorkspace"))

    def test_the_dom_fallback_never_reads_a_closed_dropdown(self):
        body = function_source(read("app.js"), "marketFromDom")
        self.assertIn("vela-menu-item", body)
        self.assertIn("[role=\"menu\"]", body)


class OverlayFollowsTheMarket(unittest.TestCase):
    def test_a_replaced_script_replaces_the_legend_entry(self):
        body = function_source(read("unified.js"), "record")
        self.assertRegex(body, r"applied\.length\s*=\s*0;\s*applied\.push\(name\)",
                         "the overlay holds ONE script; the legend must name that one")

    def test_a_market_change_reruns_the_script_or_removes_it(self):
        src = read("unified.js")
        self.assertIn("async function rerun()", src)
        body = function_source(src, "rerun")
        self.assertIn("restoring: true", body, "a re-run must not re-save itself as a new 'last run'")
        self.assertIn("ChartOverlay.clear()", body, "a stale picture must come off when the re-run fails")
        watch = function_source(src, "watchMarket")
        self.assertIn("state:changed", watch)
        self.assertIn("setInterval(check", watch, "no event bus on an older Vela must not mean no re-run")
        self.assertIn("now === pendingSig", watch,
                      "state:changed fires constantly: a timer reset by every event never fires")
        self.assertRegex(src, r"addEventListener\('ws-ready', watchMarket")
        self.assertRegex(src, r"return \{[^}]*\brerun\b")

    def test_the_overlay_never_leaves_an_orphaned_canvas(self):
        src = read("overlay.js")
        self.assertIn("function sweepStale(keep)", src)
        self.assertIn("sweepStale(null);", function_source(src, "ensureCanvas"))
        self.assertIn("sweepStale(canvas);", function_source(src, "clear"))


class StaleLegendBannerIsNotAFalseAlarm(unittest.TestCase):
    def test_it_compares_with_what_the_console_can_name(self):
        src = read("chart-bridge.js")
        i = src.index("studyCounts: () => {")
        body = src[i:src.index("streamState", i)]
        self.assertIn("paneStudies()", body)
        self.assertIn("mismatch: series > 0 && named === 0", body)
        self.assertNotIn("mismatch: series > natives", body,
                         "RSI draws six series: a series count is not an indicator count")


if __name__ == "__main__":
    unittest.main()
