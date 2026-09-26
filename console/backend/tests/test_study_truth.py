"""Pins for "what is on the chart" — one reader per place a study can be, and removal that reaches it.

The lesson, measured live on 26 Sep 2026: the pane showed CRT range boxes and "Manipulation" labels
while `chart_state` reported `natives: [] · series 0`, and `remove all` answered "nothing removed".
Vela's own names are not the truth about the chart: a script mounted from the Library (Run PineTS /
Add to chart) lives on the console's overlay/paint layer, and the operator was told his chart was
clean while he could see it was not.

So these pins hold three properties:

  1. the readers stay plural (a study can be seen by any of them, and the row says which saw it);
  2. the doors that report state (`state`, `studies`, `clear`, `remove`) all read that same list,
     never `presentNativeIndicators()` alone;
  3. something that IS on the chart but is not a native never reads as a bare "nothing removed".
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
APP = os.path.join(ROOT, "console", "frontend", "app.js")
BRIDGE = os.path.join(ROOT, "console", "frontend", "chart-bridge.js")
STORE = os.path.join(ROOT, "console", "backend", "chart_bridge.py")
CLI = os.path.join(ROOT, "console", "bin", "trader-chart")
MCP = os.path.join(ROOT, "console", "mcp", "server.py")
TOOLS_DOC = os.path.join(ROOT, "docs", "MCP-TOOLS.md")
CATALOG = os.path.join(ROOT, "docs", "plugin-catalog-entry.yaml")

READERS = ("c.inspect()", "onChartRows()", "TraderRun", "PineTSPaint", "presentNativeIndicators()")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheTruthHasFiveReaders(unittest.TestCase):
    def test_every_reader_is_asked(self):
        src = read(BRIDGE)
        block = src.split("function paneStudies()", 1)
        self.assertEqual(len(block), 2, "the bridge must have one reader of 'what is on the chart'")
        body = block[1].split("\n  }", 1)[0]
        for reader in READERS:
            self.assertIn(reader, body, f"paneStudies() must ask {reader}")

    def test_one_row_per_study_however_many_readers_see_it(self):
        body = read(BRIDGE).split("function paneStudies()", 1)[1].split("\n  }", 1)[0]
        self.assertIn("byName", body, "rows are keyed by name, or one EMA reads as three indicators")
        self.assertIn("sources", body, "the row must keep every reader that saw it")

    def test_the_heartbeat_publishes_it_and_the_store_stores_it(self):
        self.assertIn("studies: paneStudies()", read(BRIDGE),
                      "a heartbeat with natives-only is how 'clean' was reported over a busy chart")
        store = read(STORE)
        self.assertIn('"studies": payload.get("studies") or []', store,
                      "save_state must carry the list, or the tool side reads nothing")


class TheDoorsReportFromIt(unittest.TestCase):
    def test_state_doors_never_read_natives_alone(self):
        cli, mcp = read(CLI), read(MCP)
        self.assertIn("on the chart: ", cli, "the CLI state readout must name what is on the chart")
        self.assertIn("study_label(", cli)
        self.assertIn("on the chart: {on_chart}", mcp, "chart_state must report the same list")
        self.assertNotIn('f"indicators on the chart: {', mcp,
                         "natives-only wording is the bug this pins")

    def test_clear_and_remove_report_from_it(self):
        src = read(BRIDGE)
        for door in ("case 'clear':", "case 'remove':"):
            block = src.split(door, 1)[1].split("case '", 1)[0]
            self.assertIn("paneStudies()", block, f"{door} must report the pane's truth")

    def test_remove_all_reaches_the_overlay_layer(self):
        block = read(BRIDGE).split("case 'remove':", 1)[1].split("\n        }", 1)[0]
        for call in ("ChartOverlay.clear", "TraderRun.reset", "PineTSPaint.clear"):
            self.assertIn(call, block,
                          "a Library run lives on the overlay/paint layer: `all` must reach it")
        self.assertIn("overlay cleared:", block, "and the answer must say the layer was wiped")

    def test_a_non_native_name_says_why_it_cannot_be_removed_alone(self):
        block = read(BRIDGE).split("case 'remove':", 1)[1].split("\n        }", 1)[0]
        self.assertIn("all-or-nothing", block,
                      "'nothing removed' with no reason is what the operator hit on 26 Sep")

    def test_the_studies_door_exists_in_all_three_doors(self):
        self.assertIn("'studies',", read(BRIDGE))
        self.assertIn('add_parser("studies"', read(CLI))
        self.assertIn("def chart_studies(", read(MCP))
        self.assertIn("chart_studies", read(TOOLS_DOC))
        self.assertIn("chart_studies", read(CATALOG))


class ThePreviewPicturesAreUsed(unittest.TestCase):
    """The catalogue always carried `image_url`; the cards simply did not show it."""

    def test_the_card_renders_the_catalogue_shot(self):
        src = read(APP)
        self.assertIn("ind-card__shot", src, "the LIBRARY card must render the preview")
        self.assertIn("shot: r.image_url", src, "…from the row's own image_url")
        self.assertIn("function indicatorShot(", src, "the Details pane resolves it the same way")

    def test_the_star_remembers_the_picture(self):
        src = read(APP)
        self.assertIn("indicator-shots", src, "a favourite keeps its thumbnail between sessions")
        self.assertIn("rememberShot(", src)

    def test_images_are_lazy_off_the_main_thread(self):
        css = read(os.path.join(ROOT, "console", "frontend", "styles.css"))
        self.assertIn(".ind-card__shot", css)
        self.assertIn(".detail__shot", css)
        app = read(APP)
        self.assertRegex(app, r'loading="lazy"[\s\S]{0,80}decoding="async"',
                         "60 cards is 60 pictures: load and decode them off the critical path")

    def test_the_door_reports_it_read_off_the_rendered_card(self):
        app = read(APP)
        self.assertIn("shot: Boolean(c.querySelector('img.ind-card__shot'))", app,
                      "the door proves a preview is in the grid, not that the data had a URL")


if __name__ == "__main__":
    unittest.main()
