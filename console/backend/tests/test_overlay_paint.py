"""The overlay's paint path — three defects the SCREEN found, pinned (29 Sep).

The console has no JS runner here; UI behaviour is pinned as source-shape tests (see
`test_overlay_ladder.py` for the same convention). Each pin below corresponds to a defect the
operator hit and could see, and each would come back silently under a later "tidy-up":

  * **`__polylines__` was never read.** The engine keeps every `polyline.new()` in
    `context.plots['__polylines__']` as one snapshot row, points as `{index, price}` (or
    `{time, price}` when `xloc` is bar-time). `flatten()` put only plot-series paths in
    `spec.polylines`, so every volume-profile script computed a polyline and painted nothing —
    measured on the LuxAlgo AMD POC script (box and POC line landed, the blue profile did not).
  * **The canvas sat UNDER the candles.** `ensureCanvas()` appended it to `#chart` at z-index 25,
    while Vela's plot lives in its own stacking context inside `#chart` — so the paint was in the
    DOM, opaque, and invisible; `state()` counted pixels on a canvas nobody could see.
  * **The bars came from the wrong origin.** `chartBars()` fetched `api.binance.com` directly and
    the browser blocked the response (no `Access-Control-Allow-Origin` for
    `http://127.0.0.1:8787`), so every run reported "0 bars available". The console now serves
    `/api/bars` from the origin the page was served from.
"""

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


UNIFIED = read("console/frontend/unified.js")
OVERLAY = read("console/frontend/overlay.js")
APP = read("console/frontend/app.js")
SERVER = read("console/backend/server.py")


class TheEnginePolylinesReachTheOverlay(unittest.TestCase):
    """`polyline.new()` output is drawn, not dropped."""

    def test_unified_reads_the_polyline_container(self):
        self.assertIn("__polylines__", UNIFIED)
        self.assertIn("drawingPolylines", UNIFIED)

    def test_points_are_mapped_from_engine_form_to_paint_form(self):
        """{index, price} (and {time, price} for bar_time) -> {x, y} in bar-index space."""
        self.assertIn("pointXY", UNIFIED)
        self.assertIn("typeof p.price === 'number'", UNIFIED)
        self.assertIn("typeof p.index === 'number'", UNIFIED)

    def test_both_polyline_sources_reach_spec_polylines(self):
        self.assertIn("polylines: drawingPolylines().concat(seriesPaths())", UNIFIED)

    def test_overlay_fills_and_closes_a_closed_polyline(self):
        self.assertIn("if (pl.closed) ctx.closePath();", OVERLAY)
        self.assertIn("if (pl.fill)", OVERLAY)
        self.assertIn("emphasiseColour(pl.fill", OVERLAY)


class TheCanvasSitsAboveTheCandles(unittest.TestCase):
    """Our paint layer is a sibling of the candle canvas, after it in document order."""

    def test_the_host_is_the_candle_canvas_parent(self):
        self.assertIn("function overlayHost()", OVERLAY)
        self.assertIn("(plot && plot.parentElement) || chartEl()", OVERLAY)

    def test_both_the_rect_and_the_canvas_use_that_host(self):
        self.assertIn("const hs = overlayHost();", OVERLAY)
        self.assertIn("const target = overlayHost();", OVERLAY)

    def test_a_live_canvas_is_re_appended_to_stay_last(self):
        """Last child wins the paint order inside the same stacking context."""
        block = OVERLAY.split("function ensureCanvas()", 1)[1].split("function ", 1)[0]
        self.assertIn("target.appendChild(canvas);", block)


class TheBarsComeFromTheConsole(unittest.TestCase):
    """The page must not fetch the venue itself — CORS blocks it, silently."""

    def test_the_page_fetches_the_console_endpoint(self):
        self.assertIn("fetch(`/api/bars?", APP)

    def test_the_page_no_longer_fetches_binance_klines_itself(self):
        self.assertNotIn("https://api.binance.com/api/v3/klines", APP)

    def test_the_console_serves_that_endpoint(self):
        self.assertIn("def ep_bars(params: dict) -> dict:", SERVER)
        self.assertIn('"/api/bars": (ep_bars, ', SERVER)

    def test_the_endpoint_normalises_the_display_timeframe(self):
        """The chart reports "30M"/"4H"; the venue accepts only lowercase."""
        self.assertIn("_BINANCE_TF", SERVER)
        self.assertIn('"30M": "30m"', SERVER)


class TheReportDoesNotReadAsMissingData(unittest.TestCase):
    """"not drawn" was read as "the work was lost" — the series ARE stroked as paths."""

    def test_the_clause_says_native(self):
        self.assertIn("not drawn as a Vela native", UNIFIED)

    def test_the_old_wording_is_gone(self):
        self.assertNotIn("· not drawn: ", UNIFIED)
        self.assertNotIn("no exact Vela native", UNIFIED)


if __name__ == "__main__":
    unittest.main()
