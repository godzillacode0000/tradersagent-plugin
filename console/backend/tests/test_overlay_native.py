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

And a third lesson from the live chart (3 Oct): the follow loop used to re-fetch the bar series on
every frame it re-mapped — 56 /api/bars in 10 s with one overlay on (an idle chart at 6). The loop
now reads a cheap SYNCHRONOUS signature off the renderer and asks for bars at most once per burst.
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


def follow_block() -> str:
    """The body of follow() with comments stripped — the comment above it may describe the loop
    without the pin matching prose."""
    src = read(OVERLAY)
    body = src.split("function follow()", 1)[1].split("function clear()", 1)[0]
    return re.sub(r"/\*.*?\*/", "", body, flags=re.S)


def cheap_block() -> str:
    """The body of cheapSig() with comments stripped."""
    src = read(OVERLAY)
    body = src.split("function cheapSig()", 1)[1].split("function follow()", 1)[0]
    return re.sub(r"/\*.*?\*/", "", body, flags=re.S)


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
    def test_only_a_changed_signature_repaints(self):
        body = follow_block()
        self.assertTrue("requestAnimationFrame" in body)
        self.assertTrue("cheap !== lastCheap" in body, "only a changed signature repaints")

    def test_the_per_frame_read_is_synchronous_and_free(self):
        body = follow_block()
        self.assertFalse("chartBars" in body, "the frame path must not ask for the bar series")
        self.assertFalse("await nativeMapping" in body, "the frame path must not re-map")

    def test_the_cheap_signature_covers_what_moves_the_candles(self):
        block = cheap_block()
        for part in ("co.width", "co.rightEdgeLogical", "pane.scale.min", "pane.scale.max", "b.top", "b.height"):
            self.assertTrue(part in block, part + " moves the candles, so it belongs in the signature")
        self.assertGreaterEqual(block.count("co.timeToX("), 2,
                                "a pan shifts where a fixed bar time sits; anchor both ends")


class TheBarsAreFetchedOncePerBurst(unittest.TestCase):
    """One overlay used to fire ~5.6 /api/bars a second (56 in 10 s, measured live 3 Oct) because the
    follow loop re-fetched the series on every frame it re-mapped. The memo holds the list for a
    short TTL and both mappings read it."""

    def test_both_mappings_read_the_memo(self):
        nat = native_block()
        self.assertFalse("await window.chartBars()" in nat, "nativeMapping must read the memo")
        self.assertTrue("barsNow()" in nat)
        guess = read(OVERLAY).split("async function guessedMapping", 1)[1]
        self.assertFalse("await window.chartBars()" in guess, "guessedMapping must read the memo too")

    def test_the_memo_holds_the_bars_for_a_ttl(self):
        src = read(OVERLAY)
        block = src.split("async function barsNow()", 1)[1].split("async function nativeMapping", 1)[0]
        self.assertTrue("BARS_TTL_MS" in block)
        self.assertTrue("Date.now()" in block)
        self.assertTrue("barsCache" in block)


class ARepaintCanBeProvenFromTheDoor(unittest.TestCase):
    """The pan test, from 3 Oct: a drag cannot be judged by eye (two readings of the same screenshot
    disagreed by 35 px), so the follow loop counts its own repaints and the bridge hands the count
    back through a read-only `overlay` door. Read it before and after a drag — it must rise."""

    def test_the_follow_loop_counts_its_repaints(self):
        body = follow_block()
        self.assertTrue("repaints += 1" in body, "no counter, no proof")

    def test_state_reports_the_count(self):
        block = read(OVERLAY).split("function state() {", 1)[1]
        self.assertTrue("repaints" in block, "state() must carry the count for the door to read")

    def test_the_bridge_exposes_the_layer(self):
        src = read(os.path.join(ROOT, "console", "frontend", "chart-bridge.js"))
        self.assertTrue("case 'overlay':" in src, "no read-only door for the layer")
        self.assertTrue("'overlay',]" in src, "the action list must publish it, or the server refuses the call")
        self.assertTrue("st.repaints" in src, "the point of the door is the repaint count")


if __name__ == "__main__":
    unittest.main()
