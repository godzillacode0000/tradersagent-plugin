"""The overlay's own two lessons, pinned (27 Sep).

Both were found the hard way — by painting something loud and looking at the screen:

  * **z-index.** The overlay canvas and the tables layer were at 6 and 7. They were in the DOM, in
    the pane, opaque, with text — and invisible: the chart's own layers sit above them. A big red
    probe box that showed nothing at 6 showed immediately at 5000. The band that works is *between*
    the chart and the console's own surfaces, so the numbers are bounded on both sides: above the
    chart (which beats 7) and below `--lx-z-overlay` (30), because the Indicators modal, the agent
    chips and the toasts must stay on top of anything we draw.
  * **What "top_left" means.** The tables host used to span the whole chart element, which includes
    the toolbar strip — so a script's `table.new(position.top_left)` dashboard landed *on the
    toolbar*, and a `bottom_right` one fell into the date-axis strip. The host now covers the price
    pane itself, so a corner is the pane's corner.

Read-source assertions: the console has no JS runner in this repo, and these are exactly the kind of
numbers a later "tidy-up" would quietly reset.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OVERLAY = os.path.join(ROOT, "console", "frontend", "overlay.js")
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")
UNIFIED = os.path.join(ROOT, "console", "frontend", "unified.js")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheOverlayLadder(unittest.TestCase):
    def test_the_ladder_is_a_named_band_not_a_magic_number(self):
        src = read(OVERLAY)
        canvas = re.search(r"const CANVAS_Z = (\d+);", src)
        tables = re.search(r"const TABLES_Z = (\d+);", src)
        if canvas is None:
            self.fail("overlay.js no longer names the canvas z-index")
        if tables is None:
            self.fail("overlay.js no longer names the tables z-index")
        self.assertGreater(int(canvas.group(1)), 7,
                           "the canvas z-index fell back to a value the chart's own layers beat")
        self.assertGreater(int(tables.group(1)), int(canvas.group(1)),
                           "tables must sit above the canvas — a dashboard is not a line")
        self.assertLess(int(tables.group(1)), 30,
                        "the tables layer is now above the console's own overlay band (30)")

    def test_the_console_band_is_what_the_comment_claims(self):
        """The upper bound above is only true while `--lx-z-overlay` really is 30."""
        src = read(CSS)
        match = re.search(r"--lx-z-overlay:\s*(\d+);", src)
        if match is None:
            self.fail("styles.css no longer defines --lx-z-overlay")
        self.assertEqual(int(match.group(1)), 30,
                         "the console's overlay band moved — re-check the overlay's z-index band")

    def test_both_layers_use_the_named_values(self):
        src = read(OVERLAY)
        self.assertIn("canvas.style.zIndex = String(CANVAS_Z);", src)
        self.assertIn("zIndex: String(TABLES_Z)", src)

    def test_the_tables_host_is_anchored_to_the_pane(self):
        src = read(OVERLAY)
        self.assertIn("function placeTablesHost()", src,
                      "the pane-anchored host helper is gone — tables will land on the toolbar again")
        paint = src[src.index("function paintTables("):]
        self.assertIn("placeTablesHost()", paint[:400],
                      "paintTables no longer anchors the host before drawing")

    def test_the_report_says_where_a_table_landed(self):
        """`1 table on screen` was read as "you can see it" while it sat off the pane."""
        src = read(UNIFIED)
        self.assertIn("tablesInPane", src)
        self.assertIn("table #1:", src)


if __name__ == "__main__":
    unittest.main()
