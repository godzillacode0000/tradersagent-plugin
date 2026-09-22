"""Read the chart now, not the chip it posted up to four seconds ago.

`/api/chart/state` is a heartbeat: the page republishes it every 4 s (STATE_EVERY in the console's
chart-bridge.js). Every tool that read that endpoint was therefore reading a value that could predate
the command the caller had just issued, and none of them could tell. Measured on the live chart: a
chart_batch switched the chart to ETHUSDT, and the very next chart_watch reported "SOLUSDT 1h" — a
plausible, wrong answer, which is worse than an error because nothing about it looks wrong.

A bare `market` command (no symbol) is a no-op the page answers with its own present market in ~100 ms,
so the tools that need the market now ask the page instead of the heartbeat.

These tests use the command channel's shape; the stub console records what was asked of it.
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
except ImportError:  # pragma: no cover
    HAVE_FASTMCP = False


class _Stub(BaseHTTPRequestHandler):
    routes = {}
    posts = []

    def log_message(self, *args):  # keep the test output readable
        pass

    def _answer(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._answer(self.routes.get(self.path, {"ok": True, "data": {}}))

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode() if length else "{}"
        try:
            command = json.loads(raw)
        except ValueError:
            command = {}
        type(self).posts.append(command)
        # The page answers a bare `market` probe with its own live state — this is the door the tools
        # were changed to use, so the stub has to answer it the way the real bridge does: the console
        # wraps the page's answer in `{pushed, command, result}` and `_command` reads `result`.
        if command.get("action") == "market" and not command.get("symbol"):
            self._answer({"ok": True, "data": {
                "pushed": 1, "command": {"id": 1, "action": "market"},
                "result": {"ok": True,
                           "detail": "switched to ETHUSDT 1h · last 2723.93 · bars 500",
                           "symbol": "ETHUSDT", "timeframe": "1h", "last": 2723.93,
                           "stream_ms": 110}}})
            return
        self._answer(self.routes.get(self.path, {"ok": True, "data": {"result": None}}))


def load_mcp(base_url, shots_dir):
    """Load console/mcp/server.py by path — it shares a filename with console/backend/server.py."""
    os.environ["LUXALGO_CONSOLE"] = base_url
    os.environ["LUXALGO_SHOTS"] = shots_dir
    spec = importlib.util.spec_from_file_location("mcp_server_under_test", MCP_FILE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.CONSOLE = base_url
    return module


@unittest.skipUnless(HAVE_FASTMCP, "fastmcp is not installed")
class ToolsReadTheChartNotTheHeartbeat(unittest.TestCase):
    def setUp(self):
        self.shots = tempfile.mkdtemp()
        _Stub.routes = {}
        _Stub.posts = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Stub)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.mcp = load_mcp(self.base, self.shots)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def _heartbeat(self, **over):
        state = {"open": True, "symbol": "SOLUSDT", "timeframe": "1h", "last": 116.26, "bars": 500,
                 "series": 2, "drawings": 0, "natives": ["ema", "rsi"], "age_s": 1.0}
        state.update(over)
        return {"ok": True, "data": state}

    def test_a_snapshot_records_the_live_market_not_the_stale_heartbeat(self):
        # The chart is on ETHUSDT; the heartbeat still says SOLUSDT. The snapshot must say ETHUSDT,
        # because that is the market chart_undo will be asked to restore.
        _Stub.routes["/api/chart/state"] = self._heartbeat()
        out = self.mcp.chart_snapshot()
        self.assertIn("ETHUSDT 1h", out)
        self.assertNotIn("SOLUSDT", out)

    def test_a_watch_reports_the_live_market(self):
        _Stub.routes["/api/chart/state"] = self._heartbeat()
        with unittest.mock.patch.object(self.mcp.time, "sleep", lambda *_: None):
            out = self.mcp.chart_watch(seconds=2)
        self.assertIn("ETHUSDT", out)
        self.assertNotIn("SOLUSDT", out)

    def test_the_probe_is_what_they_ask(self):
        # The fix IS the probe: without a bare `market` POST these tools fall back to the heartbeat and
        # the wrong-answer bug is back. Asserting the call keeps that from being quietly removed.
        _Stub.routes["/api/chart/state"] = self._heartbeat()
        self.mcp.chart_snapshot()
        probes = [c for c in _Stub.posts if c.get("action") == "market" and not c.get("symbol")]
        self.assertTrue(probes, "chart_snapshot must ask the page for its live market")

    def test_the_heartbeat_is_still_used_when_no_view_answers(self):
        # A closed page answers nothing. The helpers must fall through to the heartbeat rather than
        # claiming a market they could not read.
        _Stub.routes["/api/chart/state"] = self._heartbeat(symbol="SOLUSDT", timeframe="4h")

        def refuse(*_a, **_k):
            return "✗ no view attached"

        with unittest.mock.patch.object(self.mcp, "_command", side_effect=refuse):
            out = self.mcp.chart_snapshot()
        self.assertIn("SOLUSDT", out)

    def test_natives_still_come_from_the_heartbeat(self):
        # Measured: the live `market` probe answers with the market and price but reports
        # `natives: null`, and `probe` answers with a dump of the page's method handles. The heartbeat
        # is the only door carrying the indicator list, so this asserts the listing is NOT lost.
        _Stub.routes["/api/chart/state"] = self._heartbeat(natives=["ema", "rsi", "supertrend"])
        self.assertEqual(self.mcp._natives(), ["ema", "rsi", "supertrend"])


if __name__ == "__main__":
    unittest.main()
