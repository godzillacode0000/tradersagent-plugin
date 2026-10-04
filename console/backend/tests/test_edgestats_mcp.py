"""The Edge Stats MCP tools, called the way an agent calls them: tool → console → engine → text.

A real console on an ephemeral port in front of the fake engine (edge_fakes), so what is pinned is the
whole path: the token the tool sends, the console's refusals surviving as sentences (did-you-mean, the
position of a syntax error), the honest guards in the text, and the chart-command tool's answer when no
page is attached. Skipped without fastmcp (CI sets TRADER_CHART_REQUIRE_MCP=1 so that is a failure there).
"""

import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import fastmcp  # noqa: F401
    HAVE_FASTMCP = True
except ImportError:                                          # pragma: no cover
    HAVE_FASTMCP = False
if os.environ.get("TRADER_CHART_REQUIRE_MCP") == "1" and not HAVE_FASTMCP:   # pragma: no cover
    raise RuntimeError("TRADER_CHART_REQUIRE_MCP=1 but fastmcp is not installed — the Edge Stats tools "
                       "would have gone untested")

import edgestats  # noqa: E402
import server as srv  # noqa: E402
from edge_fakes import FakeEdgeHome  # noqa: E402

MCP_FILE = BACKEND.parent / "mcp" / "server.py"
TOKEN = "mcp-test-token-0123456789"


def text_of(result) -> str:
    content = getattr(result, "content", None)
    if content is None:
        content = result[0] if isinstance(result, tuple) else result
    return "\n".join(getattr(c, "text", str(c)) for c in content)


@unittest.skipUnless(HAVE_FASTMCP, "fastmcp is not installed (the MCP wrapper's own dependency)")
class EdgeTools(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        frontend = Path(cls.tmp.name) / "frontend"
        frontend.mkdir()
        (frontend / "index.html").write_text("<!doctype html>", encoding="utf-8")
        cls._static = srv.Handler.static
        srv.Handler.static = srv.StaticFiles(str(frontend))
        token_file = Path(cls.tmp.name) / "console.token"
        token_file.write_text(TOKEN)
        cls.patches = [mock.patch.object(srv, "CONSOLE_TOKEN", TOKEN), mock.patch.object(srv, "AGENTS_ROOT", cls.tmp.name),
                       mock.patch.dict(os.environ, {"LUXALGO_CHART_ROOT": cls.tmp.name, "TRADER_CONSOLE_TOKEN_FILE": str(token_file)})]
        for p in cls.patches:
            p.start()
        cls.httpd = srv.Server(("127.0.0.1", 0), srv.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        os.environ["LUXALGO_CONSOLE"] = f"http://127.0.0.1:{cls.port}"
        spec = importlib.util.spec_from_file_location("td_mcp_edge", str(MCP_FILE))
        cls.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.mod)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        srv.Handler.static = cls._static
        for p in cls.patches:
            p.stop()
        os.environ.pop("LUXALGO_CONSOLE", None)
        cls.tmp.cleanup()

    def setUp(self):
        self.fake = FakeEdgeHome(with_config=True)
        self.fake.__enter__()
        self.addCleanup(self.fake.__exit__, None, None, None)

    def tool(self, name, **args):
        return text_of(asyncio.run(self.mod.mcp.call_tool(name, args)))

    def test_status_never_starts_the_engine(self):
        out = self.tool("edgestats_status")
        self.assertIn("Edge Stats installed", out)
        self.assertIn("DEMO_STK", out)
        self.assertIn("service stopped", out)

    def test_status_when_not_installed_says_how(self):
        with FakeEdgeHome(installed=False) as _:
            out = self.tool("edgestats_status")
        self.assertTrue(out.startswith("✗"))
        self.assertIn("--with-edge", out)

    def test_a_query_comes_back_with_n_and_the_interval(self):
        out = self.tool("edgestats_query", query="gapFill WHERE dayOfWeek = Tue", symbol="DEMO_STK", sessions=3)
        self.assertIn("estimate 79.4%   N = 102   95% CI [70.6%, 86.1%]", out)
        self.assertIn("Not predictions, not advice", out)

    def test_a_refused_estimate_is_relayed_without_a_rate(self):
        out = self.tool("edgestats_query", query="gapFill WHERE gapPct BETWEEN 0.05% AND 0.06%", symbol="DEMO_STK")
        self.assertIn("NO ESTIMATE", out)
        self.assertNotIn("estimate 6", out)

    def test_a_typo_is_explained_with_the_engines_suggestion(self):
        out = self.tool("edgestats_query", query="gapFil", symbol="DEMO_STK")
        self.assertTrue(out.startswith("✗"))
        self.assertIn("did you mean 'gapFill'", out)

    def test_a_syntax_error_says_where(self):
        out = self.tool("edgestats_query", query="gapFill WHERE dayOfWeek =", symbol="DEMO_STK")
        self.assertIn("(at character 25)", out)

    def test_an_unknown_symbol_lists_the_real_ones(self):
        out = self.tool("edgestats_query", query="gapFill", symbol="NOPE")
        self.assertIn("DEMO_STK", out)

    def test_a_report_with_groups(self):
        out = self.tool("edgestats_report", preset="gap-fill", symbol="DEMO_STK", group_by="dayOfWeek")
        self.assertIn("Gap Fill (report)", out)
        self.assertIn("by dayOfWeek:", out)

    def test_presets_fields_and_session(self):
        self.assertIn("report(s)", self.tool("edgestats_presets"))
        self.assertIn("OUTCOME [WHERE condition", self.tool("edgestats_fields", kind="outcome"))
        self.assertIn("prior session: high 388.11", self.tool("edgestats_session", session_id="DEMO_STK|rth|2024-12-17"))
        self.assertTrue(self.tool("edgestats_session", session_id="nonsense").startswith("✗"))

    def test_the_token_is_sent_so_a_write_is_accepted(self):
        out = self.tool("edgestats_setup", cancel=True)
        self.assertNotIn("missing console token", out)       # 409 "no job", not 401

    def test_a_missing_token_is_a_readable_refusal(self):
        with mock.patch.dict(os.environ, {"TRADER_CONSOLE_TOKEN_FILE": "/nonexistent"}):
            out = self.tool("edgestats_query", query="gapFill", symbol="DEMO_STK")
        self.assertIn("token", out)
        self.assertNotIn("not answering", out, "a console that said 401 is not 'not answering'")

    def test_setup_runs_a_job_and_status_shows_it(self):
        with mock.patch.dict(os.environ, {"FAKE_SYNC_SECONDS": "1.2"}):
            out = self.tool("edgestats_setup")
            self.assertIn("Updating the data", out)
            self.assertIn("questions are paused", self.tool("edgestats_status"))
            busy = self.tool("edgestats_query", query="gapFill", symbol="DEMO_STK")
            self.assertIn("updating its data", busy)
            self.assertIn("cancelling", self.tool("edgestats_setup", cancel=True))
            for _ in range(80):
                if not edgestats.JOBS.running():
                    break
                time.sleep(0.1)

    def test_a_download_for_a_bad_symbol_is_refused_in_words(self):
        out = self.tool("edgestats_setup", source="binance", symbol="../etc")
        self.assertTrue(out.startswith("✗"))

    def test_show_without_a_page_says_nothing_is_attached(self):
        out = self.tool("edgestats_show", op="ask", query="gapFill", symbol="DEMO_STK")
        self.assertTrue(out.startswith("✗"), out)

    def test_the_tools_carry_annotations_and_the_right_kind(self):
        from test_mcp_tool_annotations import hint, tools_of
        tools = tools_of(self.mod)
        for name in ("edgestats_status", "edgestats_fields", "edgestats_presets", "edgestats_query",
                     "edgestats_report", "edgestats_session"):
            self.assertTrue(hint(tools[name].annotations, "read_only_hint"), f"{name} changes nothing")
        self.assertFalse(hint(tools["edgestats_show"].annotations, "read_only_hint"))
        self.assertFalse(hint(tools["edgestats_show"].annotations, "destructive_hint"), "it only shows")
        self.assertFalse(hint(tools["edgestats_setup"].annotations, "read_only_hint"))
        self.assertTrue(hint(tools["edgestats_setup"].annotations, "open_world_hint"), "downloads leave this machine")


if __name__ == "__main__":
    unittest.main()
