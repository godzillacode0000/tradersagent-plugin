"""`trader-chart edge …` against a real console in front of the fake engine.

The CLI is what a shell-driven agent (and a human) uses. Two things are pinned beyond the text itself:
a refusal from the console (401 / 400 / 409) must read as that refusal — urllib raises HTTPError for
every 4xx, and HTTPError is a URLError, which once made "unknown outcome 'gapFil'" print as "cannot reach
the console" — and the exit codes (0 answered · 1 refused · 2 no console).
"""

import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import server as srv  # noqa: E402
from edge_fakes import FakeEdgeHome, free_port  # noqa: E402

CLI = BACKEND.parent / "bin" / "trader-chart"
TOKEN = "cli-test-token-0123456789"


class EdgeCli(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        frontend = Path(cls.tmp.name) / "frontend"
        frontend.mkdir()
        (frontend / "index.html").write_text("<!doctype html>", encoding="utf-8")
        cls._static = srv.Handler.static
        srv.Handler.static = srv.StaticFiles(str(frontend))
        cls.token_file = Path(cls.tmp.name) / "console.token"
        cls.token_file.write_text(TOKEN)
        cls.patches = [mock.patch.object(srv, "CONSOLE_TOKEN", TOKEN), mock.patch.object(srv, "AGENTS_ROOT", cls.tmp.name),
                       mock.patch.dict(os.environ, {"LUXALGO_CHART_ROOT": cls.tmp.name})]
        for p in cls.patches:
            p.start()
        cls.httpd = srv.Server(("127.0.0.1", 0), srv.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        srv.Handler.static = cls._static
        for p in cls.patches:
            p.stop()
        cls.tmp.cleanup()

    def setUp(self):
        self.fake = FakeEdgeHome(with_config=True)
        self.fake.__enter__()
        self.addCleanup(self.fake.__exit__, None, None, None)

    def cli(self, *args, token=True, port=None):
        env = dict(os.environ, LUXALGO_CONSOLE=f"http://127.0.0.1:{port or self.port}",
                   TRADER_CONSOLE_TOKEN_FILE=str(self.token_file if token else "/nonexistent"))
        env.pop("HTTP_PROXY", None); env.pop("http_proxy", None)
        done = subprocess.run([sys.executable, str(CLI), *args], capture_output=True, text=True, timeout=60, env=env)
        return done.returncode, done.stdout, done.stderr

    def test_status(self):
        code, out, _ = self.cli("edge", "status")
        self.assertEqual(code, 0)
        self.assertIn("DEMO_STK", out)

    def test_ask_prints_n_and_the_interval_and_points_at_the_cli(self):
        code, out, _ = self.cli("edge", "ask", "gapFill WHERE dayOfWeek = Tue", "--symbol", "DEMO_STK", "--sessions", "2")
        self.assertEqual(code, 0)
        self.assertIn("estimate 79.4%   N = 102", out)
        self.assertIn("trader-chart edge session", out, "the shell must be pointed at shell commands, not MCP tools")
        self.assertNotIn("edgestats_session", out)

    def test_a_refused_estimate_still_exits_zero_and_prints_no_rate(self):
        code, out, _ = self.cli("edge", "ask", "gapFill WHERE gapPct BETWEEN 0.05% AND 0.06%", "--symbol", "DEMO_STK")
        self.assertEqual(code, 0)
        self.assertIn("NO ESTIMATE", out)

    def test_a_typo_is_a_refusal_not_an_unreachable_console(self):
        code, out, err = self.cli("edge", "ask", "gapFil", "--symbol", "DEMO_STK")
        self.assertEqual(code, 1)
        self.assertIn("did you mean 'gapFill'", err)
        self.assertNotIn("cannot reach", err)

    def test_a_syntax_error_reports_its_position(self):
        code, _, err = self.cli("edge", "ask", "gapFill WHERE dayOfWeek =", "--symbol", "DEMO_STK")
        self.assertEqual(code, 1)
        self.assertIn("(at character 25)", err)

    def test_a_missing_token_says_so(self):
        code, _, err = self.cli("edge", "ask", "gapFill", "--symbol", "DEMO_STK", token=False)
        self.assertEqual(code, 1)
        self.assertIn("token", err)
        self.assertNotIn("cannot reach", err)

    def test_no_console_is_exit_two(self):
        code, _, err = self.cli("edge", "status", port=free_port())
        self.assertEqual(code, 2)
        self.assertIn("cannot reach the console", err)

    def test_report_with_params(self):
        code, out, _ = self.cli("edge", "report", "gap-fill", "--symbol", "DEMO_STK", "--group", "dayOfWeek", "--param", "dir=up")
        self.assertEqual(code, 0)
        self.assertIn("Gap Fill (report)", out)
        self.assertIn("by dayOfWeek:", out)

    def test_bad_param_syntax_is_refused_before_any_request(self):
        code, _, err = self.cli("edge", "report", "gap-fill", "--symbol", "DEMO_STK", "--param", "oops")
        self.assertNotEqual(code, 0)
        self.assertIn("name=value", err)

    def test_presets_fields_session_and_json(self):
        self.assertIn("report(s)", self.cli("edge", "presets")[1])
        self.assertIn("OUTCOME [WHERE", self.cli("edge", "fields", "--kind", "outcome")[1])
        self.assertIn("prior session: high 388.11", self.cli("edge", "session", "DEMO_STK|rth|2024-12-17")[1])
        code, out, _ = self.cli("edge", "ask", "gapFill", "--symbol", "DEMO_STK", "--json")
        self.assertEqual(code, 0)
        import json
        self.assertEqual(json.loads(out)["n"], 102)

    def test_setup_and_cancel(self):
        code, out, _ = self.cli("edge", "setup", "--cancel")
        self.assertEqual(code, 1)                              # nothing is running
        self.assertIn("no data job is running", self.cli("edge", "setup", "--cancel")[2])
        code, out, _ = self.cli("edge", "setup")
        self.assertEqual(code, 0)
        self.assertIn("Updating the data", out)
        import time
        for _ in range(80):
            from edgestats import JOBS
            if not JOBS.running():
                break
            time.sleep(0.1)


if __name__ == "__main__":
    unittest.main()


class LiveTreeLayout(unittest.TestCase):
    """The live machine has bin/ and backend/ but no mcp/ — the CLI must find its renderer beside itself,
    and the sync script must put it there (a ModuleNotFoundError on `trader-chart edge` would only ever
    show on the one machine that matters)."""

    def test_the_sync_script_ships_the_renderer_beside_the_cli(self):
        sync = (BACKEND.parents[1] / "tools" / "sync-live.sh").read_text()
        self.assertIn('console/mcp/edge_text.py "$LIVE/bin/edge_text.py"', sync)
        self.assertIn("edgestats.py", sync)

    def test_the_cli_runs_with_the_renderer_beside_it_and_no_mcp_folder(self):
        import shutil
        with tempfile.TemporaryDirectory() as live:
            (Path(live) / "bin").mkdir()
            shutil.copy(CLI, Path(live) / "bin" / "trader-chart")
            shutil.copy(BACKEND.parent / "mcp" / "edge_text.py", Path(live) / "bin" / "edge_text.py")
            done = subprocess.run([sys.executable, str(Path(live) / "bin" / "trader-chart"), "edge", "presets", "--help"],
                                  capture_output=True, text=True, timeout=30)
            self.assertEqual(done.returncode, 0, done.stderr)
            # the import is lazy, so exercise it: a status call against a port nobody listens on still
            # imports edge_text first only when it has an answer — so call the helper directly instead
            probe = subprocess.run([sys.executable, "-c",
                                    "import importlib.machinery, importlib.util;"
                                    f"loader=importlib.machinery.SourceFileLoader('tc', r'{Path(live) / 'bin' / 'trader-chart'}');"
                                    "spec=importlib.util.spec_from_loader('tc', loader);"
                                    "m=importlib.util.module_from_spec(spec);loader.exec_module(m);"
                                    "t=m._edge_text();print(t.format_job(None))"],
                                   capture_output=True, text=True, timeout=30)
            self.assertEqual(probe.returncode, 0, probe.stderr)
            self.assertIn("no data job", probe.stdout)
