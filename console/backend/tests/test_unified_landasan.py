"""Every door must run on the one landasan, and the script pane must be back.

Three doors ask for Pine to run — the bridge behind chat (apply/draw/script), the Library detail
panel's Run PineTS, and the script editor restored on 23 Sep. Each used to carry its own partial
logic, and the differences showed as real defects on the operator's machine: `apply` reported
"no render surface … overlay needed" while drawing nothing for a structure script (SMC), a
0-series source resurrected a removed native through the ta.atr( paint heuristic, and the bridge's
`script` case still refused with "the Pine editor was removed, 17 Sep" after the pane returned.

The phrases banned here are quoted from that stale build, and the positive assertions pin the
shape that fixes it: one runner, both paint surfaces, the badge counting overlay runs, and the
editor's Run button wired to the same call chat makes. A revert that restores any door's private
logic fails here instead of quietly reopening the gap.
"""

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


UNIFIED = read("console/frontend/unified.js")
BRIDGE = read("console/frontend/chart-bridge.js")
APP = read("console/frontend/app.js")
HTML = read("console/frontend/index.html")
CSS = read("console/frontend/styles.css")
HANDOFF = read("docs/HANDOFF.md")
VELA_NOTES = read("docs/vela-chart-api-notes.md")


class TheOneLandasan(unittest.TestCase):
    """window.TraderRun is the single implementation; the doors only knock on it."""

    def test_runner_paints_both_surfaces(self):
        self.assertIn("window.TraderRun", UNIFIED)
        self.assertIn("ChartOverlay.apply", UNIFIED)
        self.assertIn("PineTSPaint.paintNative", UNIFIED)

    def test_native_paint_guards_on_series_actually_existing(self):
        """The dead-native bug: ta.atr( anywhere in a 0-series source matched the heuristic."""
        guard = UNIFIED.index("res.series.length > 0")
        self.assertLess(guard, UNIFIED.index("paintNative"))

    def test_overlay_runs_are_recorded_for_badge_and_legend(self):
        self.assertIn("applied.push", UNIFIED)
        self.assertIn("script-legend", UNIFIED)

    def test_bridge_doors_delegate_to_the_runner(self):
        self.assertGreaterEqual(BRIDGE.count("TraderRun.run"), 3)  # apply, draw, script
        self.assertIn("TraderRun.summarize", BRIDGE)

    def test_bridge_forgets_with_the_overlay(self):
        i = BRIDGE.index("case 'clear'")
        self.assertIn("TraderRun.reset()", BRIDGE[i:i + 400])

    def test_stale_phrasings_are_gone_everywhere_a_reader_looks(self):
        for path, text in (
            ("chart-bridge", BRIDGE),
            ("HANDOFF.md", HANDOFF),
            ("vela-chart-api-notes.md", VELA_NOTES),
        ):
            self.assertNotIn("overlay needed", text, path)
        self.assertNotIn("no render surface in this build", BRIDGE)
        self.assertNotIn("the Pine editor was removed, 17 Sep", BRIDGE)
        self.assertNotIn("no script panel", BRIDGE)


class TheScriptPaneIsBack(unittest.TestCase):
    """The LuxAlgo-style paste-and-Run pane, wired to the same landasan as chat."""

    def test_topbar_button_and_markup_exist(self):
        for needle in (
            'id="script-open"',
            'id="view-script"',
            'id="script-run"',
            'id="script-close"',
            'id="script-src"',
            'id="script-out"',
            'id="script-legend"',
        ):
            self.assertIn(needle, HTML)

    def test_unified_loads_before_the_bridge(self):
        self.assertLess(HTML.index("unified.js"), HTML.index("chart-bridge.js"))

    def test_editor_run_and_detail_run_share_the_call(self):
        self.assertIn("'#script-run'", APP)
        self.assertGreaterEqual(APP.count("TraderRun.run"), 2)   # editor + Library detail
        self.assertIn("TraderRun.summarize", APP)

    def test_draft_survives_reload(self):
        self.assertIn("luxalgo-web:script", APP)

    def test_right_column_hosts_both_views(self):
        self.assertIn("rightViewIs", APP)
        self.assertIn("showRightView", APP)
        # both views live in the one right-hand track
        self.assertLess(HTML.index('id="view-script"'), HTML.index('id="detail"'))

    def test_badge_counts_overlay_runs(self):
        i = APP.index("function refreshIndicatorCount")
        body = APP[i:i + 700]
        self.assertIn("TraderRun.list()", body)
        self.assertIn("overlay", body)

    def test_editor_surface_is_styled_and_legend_hides_via_hidden_attr(self):
        self.assertIn(".script__src", CSS)
        self.assertIn(".script__out", CSS)
        legend = CSS.split(".chart-legend", 1)[1].split("}", 1)[0]
        self.assertNotIn("display", legend)   # [hidden] must be able to hide it


if __name__ == "__main__":
    unittest.main()
