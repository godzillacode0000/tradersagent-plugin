"""The MCP tool layer, against a stub console — no browser, no Hermes, no network.

This is the piece the agent actually calls, so the things worth pinning are the promises made in
the tool docstrings: a tool never hangs, never claims a view answered when none is attached, and
turns a dead console into a sentence instead of a traceback. The stub speaks the console's HTTP
shapes; the module is loaded by path because `console/mcp/server.py` and `console/backend/server.py`
share a filename.

Skipped when fastmcp is not installed (the console itself does not need it; only this wrapper does).
"""

import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest
import unittest.mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
MCP_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "mcp"))
MCP_FILE = os.path.join(MCP_DIR, "server.py")

try:
    import fastmcp  # noqa: F401
    HAVE_FASTMCP = True
except ImportError:                                          # pragma: no cover
    HAVE_FASTMCP = False

# CI sets this so a missing fastmcp is a failure, not a quiet skip: this layer is the one the agent
# actually calls, and "skipped" would read as green while nothing was tested.
if os.environ.get("TRADER_CHART_REQUIRE_MCP") == "1" and not HAVE_FASTMCP:   # pragma: no cover
    raise RuntimeError("TRADER_CHART_REQUIRE_MCP=1 but fastmcp is not installed — the MCP tool "
                       "layer would have gone untested")


class _Stub(BaseHTTPRequestHandler):
    """A console that says exactly what a test tells it to say."""

    routes = {}
    posts = []

    def _reply(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):                                        # noqa: N802 — stdlib naming
        path = self.path.split("?", 1)[0]
        self._reply(self.routes.get(path, {"ok": False, "error": f"stub has no route {path}"}))

    def do_POST(self):                                       # noqa: N802
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        _Stub.posts.append(json.loads(raw or b"{}"))
        path = self.path.split("?", 1)[0]
        self._reply(self.routes.get(path, {"ok": False, "error": f"stub has no route {path}"}))

    def log_message(self, *args):                            # keep the test output clean
        pass


def load_mcp(console_url: str, shot_dir: str, inline_wait: str = "0"):
    """Load console/mcp/server.py fresh, pointed at a given console."""
    os.environ["LUXALGO_CONSOLE"] = console_url
    os.environ["LUXALGO_SHOT_DIR"] = shot_dir
    os.environ["LUXALGO_CHART_INLINE_WAIT"] = inline_wait
    spec = importlib.util.spec_from_file_location("trader_chart_mcp", MCP_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def text_of(result) -> str:
    """FastMCP image returns arrive as [text, Image]; everything else is a plain string."""
    if isinstance(result, list):
        return result[0]
    return result


@unittest.skipUnless(HAVE_FASTMCP, "fastmcp is not installed (only the MCP wrapper needs it)")
class MCPToolsTest(unittest.TestCase):
    def setUp(self):
        self.shots = tempfile.mkdtemp()
        _Stub.routes = {}
        _Stub.posts = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Stub)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.mcp = load_mcp(base, self.shots)
        self.base = base

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    # ── views ───────────────────────────────────────────────────────────────
    def test_chart_views_without_a_view_says_so_plainly(self):
        _Stub.routes = {"/api/chart/stream/status": {"ok": True, "data": {"views": 0, "pushes": 0}}}
        out = self.mcp.chart_views()
        self.assertIn("0 views attached", out)
        self.assertIn("Trader's Agent", out)

    def test_chart_views_reports_the_attached_view(self):
        _Stub.routes = {"/api/chart/stream/status":
                        {"ok": True, "data": {"views": 1, "pushes": 7, "keepalive_s": 8.0}}}
        out = self.mcp.chart_views()
        self.assertIn("1 view(s) attached", out)
        self.assertIn("7 commands pushed", out)

    def test_chart_views_turns_a_dead_console_into_a_sentence(self):
        dead = load_mcp("http://127.0.0.1:9", self.shots)      # discard port: nothing listens
        out = dead.chart_views()
        self.assertTrue(out.startswith("✗"))
        self.assertIn("not answering", out)
        self.assertIn("console/start.sh", out)

    # ── state ───────────────────────────────────────────────────────────────
    def test_chart_state_reports_what_is_on_the_chart(self):
        _Stub.routes = {"/api/chart/state": {"ok": True, "data": {
            "open": True, "symbol": "BTCUSDT", "timeframe": "1h", "last": 76500.5, "bars": 500,
            "series": 5, "drawings": 0, "natives": ["volume", "ema", "donchian-channels"],
            "age_s": 1.2, "shot": "/tmp/chart.png"}}}
        out = self.mcp.chart_state()
        self.assertIn("BTCUSDT · 1h · last 76500.5", out)
        self.assertIn("volume, ema, donchian-channels", out)
        self.assertIn("/tmp/chart.png", out)

    def test_chart_state_reports_a_stale_frame_when_the_build_is_present(self):
        _Stub.routes = {"/api/chart/state": {"ok": True, "data": {
            "open": True, "symbol": "SOLUSDT", "timeframe": "1h", "last": 108.4, "bars": 500,
            "series": 4, "drawings": 0, "natives": [], "age_s": 2.0,
            "build": "1789819400", "viewer": "v0hutdsfb"}}}
        out = self.mcp.chart_state()
        self.assertIn("build 1789819400", out)
        self.assertIn("viewer v0hutdsfb", out)

    def test_chart_state_says_when_no_chart_is_open(self):
        _Stub.routes = {"/api/chart/state": {"ok": True, "data": {
            "open": False, "reason": "the last chart heartbeat was 2000s ago"}}}
        out = self.mcp.chart_state()
        self.assertTrue(out.startswith("✗ no chart open"))
        self.assertIn("heartbeat", out)

    # ── commands ────────────────────────────────────────────────────────────
    def test_a_command_with_no_view_is_not_pretended(self):
        _Stub.routes = {"/api/chart/command": {"ok": True, "data": {"pushed": 0, "command": {"id": 4}}}}
        out = self.mcp.chart_add_indicator("ema")
        self.assertIn("no chart view is attached", out)
        self.assertEqual(_Stub.posts[-1]["action"], "add")
        self.assertEqual(_Stub.posts[-1]["native"], "ema")

    def test_a_command_reports_the_result_and_the_wire_latency(self):
        _Stub.routes = {"/api/chart/command": {"ok": True, "data": {
            "pushed": 1, "command": {"id": 9},
            "result": {"id": 9, "ok": True, "detail": "ran in 42 ms over 500 bars", "stream_ms": 37.5}}}}
        out = self.mcp.chart_apply_pine("//@version=6\nindicator('x')\nplot(close)")
        self.assertTrue(out.startswith("✓"))
        self.assertIn("ran in 42 ms over 500 bars", out)
        self.assertIn("38 ms on the wire", out)
        self.assertIn("pine", _Stub.posts[-1])

    def test_a_slow_view_is_reported_not_waited_on_forever(self):
        _Stub.routes = {"/api/chart/command": {"ok": True, "data":
                        {"pushed": 1, "command": {"id": 11}, "result": None}}}
        out = self.mcp.chart_add_indicator("supertrend")
        self.assertIn("had not answered within", out)
        self.assertIn("chart_state", out)

    def test_a_frozen_page_is_refused_before_anything_is_queued(self):
        # The failure this exists for: the view is still registered (so pushed=1) but its
        # heartbeat is minutes old. Without the preflight the caller burns the whole inline
        # window and hears "had not answered" from a page that was never going to answer.
        _Stub.routes = {
            "/api/chart/state": {"ok": True, "data": {"open": False, "age_s": 37.0,
                                                      "reason": "heartbeat lost"}},
            "/api/chart/command": {"ok": True, "data": {"pushed": 1, "command": {"id": 13},
                                                        "result": None}}}
        out = self.mcp.chart_add_indicator("ema")
        self.assertIn("not answering", out)
        self.assertIn("37s", out)
        self.assertIn("Trader's Agent", out)
        self.assertIn("Nothing was queued", out)
        self.assertFalse(_Stub.posts, "the queue must not be touched when the page cannot claim")

    def test_a_live_page_still_reaches_the_queue(self):
        # The other half of the promise: a heartbeat one beat old must not turn into a refusal.
        _Stub.routes = {
            "/api/chart/state": {"ok": True, "data": {"open": True, "age_s": 1.0, "viewer": "v1"}},
            "/api/chart/command": {"ok": True, "data": {"pushed": 1, "command": {"id": 14},
                                                        "result": {"id": 14, "ok": True,
                                                                   "detail": "ran"}}}}
        out = self.mcp.chart_add_indicator("ema")
        self.assertTrue(out.startswith("✓"))
        self.assertEqual(_Stub.posts[-1]["action"], "add")

    def test_the_command_tools_refuse_empty_arguments(self):
        self.assertIn("no Pine source", self.mcp.chart_apply_pine("   "))
        self.assertIn("no indicator name", self.mcp.chart_add_indicator("  "))
        self.assertIn("both symbol and timeframe", self.mcp.chart_set_market("", "1h"))

    def test_set_market_normalises_the_symbol(self):
        _Stub.routes = {"/api/chart/command": {"ok": True, "data": {
            "pushed": 1, "command": {"id": 12}, "result": {"id": 12, "ok": True, "detail": "now btcusdt 15m"}}}}
        self.mcp.chart_set_market("btcusdt", "15m")
        self.assertEqual(_Stub.posts[-1]["symbol"], "BTCUSDT")
        self.assertEqual(_Stub.posts[-1]["timeframe"], "15m")

    def test_reload_is_once_per_view(self):
        _Stub.routes = {"/api/chart/command": {"ok": True, "data": {
            "pushed": 1, "command": {"id": 20},
            "result": {"id": 20, "ok": True, "detail": "reloading"}}}}
        out = self.mcp.chart_reload()
        self.assertTrue(out.startswith("✓"))
        self.assertTrue(_Stub.posts[-1].get("once_per_view"))
        self.assertEqual(_Stub.posts[-1]["action"], "reload")

    def test_remove_refuses_empty_and_palette_is_read_by_default(self):
        self.assertIn("give a name", self.mcp.chart_remove_indicator())
        _Stub.routes = {"/api/chart/command": {"ok": True, "data": {
            "pushed": 1, "command": {"id": 21},
            "result": {"id": 21, "ok": True, "detail": "background #151619"}}}}
        self.mcp.chart_palette()
        self.assertEqual(_Stub.posts[-1]["action"], "palette")
        self.assertNotIn("try", _Stub.posts[-1])
        self.mcp.chart_palette(try_apply=True)
        self.assertTrue(_Stub.posts[-1].get("try"))

    # ── captures ────────────────────────────────────────────────────────────
    def test_chart_shot_writes_the_picture_and_says_where(self):
        import base64
        png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"payload" * 40).decode()
        _Stub.routes = {"/api/chart/command": {"ok": True, "data": {
            "pushed": 1, "command": {"id": 13},
            "result": {"id": 13, "ok": True, "shot": "data:image/png;base64," + png}}}}
        out = text_of(self.mcp.chart_shot("unit"))
        self.assertIn("chart captured", out)
        path = out.split("→", 1)[1].strip()
        self.assertTrue(os.path.exists(path))
        self.assertGreater(os.path.getsize(path), 100)
        self.assertTrue(os.path.basename(path).startswith("unit-"))

    def test_chart_shot_reports_a_capture_that_did_not_happen(self):
        _Stub.routes = {"/api/chart/command": {"ok": True, "data": {
            "pushed": 1, "command": {"id": 14}, "result": {"id": 14, "ok": False, "detail": "unusable capture"}}}}
        out = text_of(self.mcp.chart_shot())
        self.assertTrue(out.startswith("✗ no picture"))
        self.assertIn("unusable capture", out)

    # ── library ─────────────────────────────────────────────────────────────
    def test_library_search_formats_the_hits(self):
        _Stub.routes = {"/api/search": {"ok": True, "data": {"results": [
            {"title": "Dynamic Order Blocks", "type": "indicator", "slug": "dynamic-order-blocks"},
            {"title": "Order block anatomy", "type": "concept", "slug": "order-block-anatomy"}]}}}
        out = self.mcp.library_search("order block")
        self.assertIn("2 hit(s)", out)
        self.assertIn("[indicator] Dynamic Order Blocks (dynamic-order-blocks)", out)
        self.assertIn("[concept] Order block anatomy", out)

    def test_library_search_with_no_hits_says_no_hits(self):
        _Stub.routes = {"/api/search": {"ok": True, "data": {"results": []}}}
        self.assertIn("no hits for", self.mcp.library_search("nothing at all"))

    def test_library_indicator_resolves_a_name_and_carries_the_licence(self):
        _Stub.routes = {
            "/api/search": {"ok": True, "data": {"results": [{"slug": "ict-killzones"}]}},
            "/api/indicator": {"ok": True, "data": {"indicator": {
                "title": "ICT Killzones", "summary": "Session boxes.", "license": "CC BY-NC-SA 4.0"}}},
            "/api/source": {"ok": True, "data": {"source": "//@version=6\nindicator('ICT Killzones')"}},
        }
        out = self.mcp.library_indicator("ICT Killzones")
        self.assertIn("# ICT Killzones (ict-killzones)", out)
        self.assertIn("CC BY-NC-SA 4.0", out)
        self.assertIn("not redistributable", out)
        self.assertIn("```pine", out)

    # ── chart_alert: the market, not the chart ───────────────────────────────

    def test_chart_alert_reports_the_move_once_price_travels(self):
        """The promise: name the direction, both prices, and the size of the move.

        This is the tool's whole point, so the assertions are on the sentence a trader reads.
        """
        prices = iter([100.0, 101.0])

        def moving(_path, *a, **k):
            # _call already unwraps the console's envelope and returns `data` itself, so the stub
            # hands back the state directly — nesting it under "data" again is what made this test
            # report "no chart open" against a correct tool.
            return {"open": True, "symbol": "SOLUSDT", "timeframe": "4h",
                    "last": next(prices, 101.0), "bars": 500, "series": 2, "drawings": 0,
                    "natives": ["ema"], "age_s": 1.0}

        with unittest.mock.patch.object(self.mcp, "_call", side_effect=moving), \
                unittest.mock.patch.object(self.mcp.time, "sleep", lambda *_: None):
            out = self.mcp.chart_alert(seconds=10, move_pct=0.5)
        self.assertIn("moved up", out)
        self.assertIn("100.0 → 101.0", out)
        self.assertIn("1.000%", out)

    def test_chart_alert_names_the_pause_when_nothing_moves(self):
        """No move is an answer too — and the excursion seen is the evidence for saying so."""
        quiet = {"open": True, "symbol": "BTCUSDT", "timeframe": "1h", "last": 70000.0,
                 "bars": 500, "series": 3, "drawings": 0, "natives": [], "age_s": 1.0}
        with unittest.mock.patch.object(self.mcp, "_call", return_value=quiet), \
                unittest.mock.patch.object(self.mcp.time, "sleep", lambda *_: None):
            out = self.mcp.chart_alert(seconds=2, move_pct=5.0)
        self.assertIn("no qualifying move", out)
        self.assertIn("BTCUSDT 1h", out)
        self.assertIn("needed 5.0%", out)

    def test_chart_alert_refuses_a_number_that_cannot_be_a_percentage(self):
        # A caller passing 25 meaning "25 dollars", or a plain mistake, gets told the unit rather than
        # a chart that never fires because the bar is unreachable.
        out = self.mcp.chart_alert(seconds=1, move_pct=250)
        self.assertIn("percentage of price", out)

    def test_chart_alert_does_not_wait_when_the_feed_has_no_price(self):
        # A chart with no price yet must say that, not spin for the full window comparing NaNs.
        _Stub.routes = {"/api/chart/state": {"ok": True, "data": {
            "open": True, "symbol": "BTCUSDT", "timeframe": "1h", "last": None, "bars": 0,
            "series": 0, "drawings": 0, "natives": [], "age_s": 1.0}}}
        out = self.mcp.chart_alert(seconds=30, move_pct=0.1)
        self.assertIn("no usable price", out)


if __name__ == "__main__":
    unittest.main()
