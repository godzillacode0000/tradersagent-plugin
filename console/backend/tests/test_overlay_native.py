"""Pins for 3 Oct: the overlay asks Vela where things are — it does not guess.

The operator's Order Block Detector floated ~400 USD above the candles, the order-block boxes hung
in empty space and a grey line left the chart. Two causes, both measured:

1. The overlay fitted a price scale from a SCREENSHOT of the chart and painted once. A pan, an
   autoscale or a new bar moved the candles and left the drawing where it was.
2. The page was 2286px wide inside an 868px pane (see test_page_width.py), so the chart the overlay
   was positioned on was mostly off-screen.

The cure for (1): ask the renderer. ``coords.timeToX(time)`` and ``coords.priceToY(price, scale,
bounds)`` are the calls Vela paints its own candles with. Two traps found while verifying on the
live chart with a box drawn exactly on the 100-bar high/low:

* the Vela canvas INCLUDES the price-axis column, so the plot is ``coords.width`` wide, not the
  canvas's ``rect.w``. A ``rect.w / coords.width`` ratio stretched x by 8% and pushed every right
  edge (and every ``extend.right`` line) over the axis labels;
* a drawing must be clipped to the price pane, or a long line paints across the axis anyway.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OVERLAY = os.path.join(ROOT, "console", "frontend", "overlay.js")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def native_block() -> str:
    """The body of nativeMapping() with its comments stripped, so a pin matches CODE — the comment
    that explains the old bug is allowed to quote it."""
    src = read(OVERLAY)
    block = src.split("async function nativeMapping()", 1)[1].split("async function guessedMapping", 1)[0]
    return re.sub(r"/\*.*?\*/", "", block, flags=re.S)


class ItAsksVelaWhereThingsAre(unittest.TestCase):
    def test_native_mapping_exists_and_is_tried_first(self):
        src = read(OVERLAY)
        self.assertTrue("async function nativeMapping()" in src, "no native mapping")
        body = src.split("async function mapping(", 1)[1].split("async function guessedMapping", 1)[0]
        self.assertTrue(body.index("nativeMapping()") < body.index("guessedMapping("),
                        "the chart's own coordinates come before the screenshot fit")

    def test_it_uses_the_renderers_own_coordinate_calls(self):
        block = native_block()
        self.assertTrue("co.timeToX(" in block)
        self.assertTrue("co.priceToY(" in block)


class TheEdgesOfThePlotAreTheEdgesOfThePlot(unittest.TestCase):
    def test_x_is_not_stretched_by_the_canvas_to_plot_ratio(self):
        block = native_block()
        self.assertFalse(re.search(r"rect\.w\s*/\s*co\.width", block),
                         "the canvas includes the price axis; this ratio stretched x by ~8%")

    def test_the_right_edge_is_the_plots_not_the_canvas(self):
        block = native_block()
        m = re.search(r"right:\s*([^,\n]+)", block)
        self.assertTrue(m is not None, "mapping must publish its right edge")
        self.assertTrue("co.width" in m.group(1), "right edge = rect.x + co.width, not rect.x + rect.w")

    def test_the_clip_is_the_plot_width(self):
        block = native_block()
        m = re.search(r"clip:\s*\{([^}]*)\}", block)
        self.assertTrue(m is not None)
        self.assertTrue("co.width" in m.group(1), "clip to the plot, or lines paint over the axis")

    def test_painting_is_clipped(self):
        src = read(OVERLAY)
        self.assertTrue("ctx.clip()" in src)
        self.assertTrue("ctx.restore()" in src)


class ItFollowsTheChart(unittest.TestCase):
    def test_it_repaints_when_the_viewport_scale_or_bars_change(self):
        src = read(OVERLAY)
        self.assertTrue("function follow()" in src)
        body = src.split("function follow()", 1)[1].split("function clear()", 1)[0]
        self.assertTrue("requestAnimationFrame" in body)
        self.assertTrue("m.sig !== lastSpec.sig" in body, "only a changed signature repaints")

    def test_the_signature_covers_what_moves_the_candles(self):
        block = native_block()
        sig = block.split("const sig = [", 1)[1].split("].join", 1)[0]
        for part in ("co.width", "co.rightEdgeLogical", "pane.scale.min", "pane.scale.max", "bars.length"):
            self.assertTrue(part in sig, part + " moves the candles, so it belongs in the signature")


if __name__ == "__main__":
    unittest.main()
