"""The console's /api/edgestats/* routes, over a real socket, against the fake engine.

What these pin, each a way this surface could go wrong silently:

  * a question, a download or a cancel is a WRITE (it spends CPU, disk and bandwidth, or changes a job):
    it needs the token like every other POST — a cross-site page must not be able to start a download;
  * a machine without Node, or with no data yet, is a normal first-run ANSWER (200 + `reason`), because
    the page renders an onboarding card from it — a 5xx there would read as "the plugin is broken";
  * the engine's own explanation (did-you-mean, the error position) survives the trip to the page;
  * a question asked while a data job holds the store answers "busy" at once instead of hanging.
"""

import json
import os
import socket
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import edgestats  # noqa: E402
import server as srv  # noqa: E402
from edge_fakes import FakeEdgeHome  # noqa: E402

TOKEN = "test-token-0123456789"
JSON = {"content-type": "application/json"}


class RoutesBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        frontend = Path(cls.tmp.name) / "frontend"
        frontend.mkdir()
        (frontend / "index.html").write_text("<!doctype html><title>console</title>", encoding="utf-8")
        cls._orig_static = srv.Handler.static
        srv.Handler.static = srv.StaticFiles(str(frontend))
        cls.patches = [
            mock.patch.object(srv, "CONSOLE_TOKEN", TOKEN),
            mock.patch.object(srv, "AGENTS_ROOT", cls.tmp.name),
            mock.patch.dict(os.environ, {"LUXALGO_CHART_ROOT": cls.tmp.name}),
        ]
        for p in cls.patches:
            p.start()
        cls.httpd = srv.Server(("127.0.0.1", 0), srv.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        srv.Handler.static = cls._orig_static
        for p in cls.patches:
            p.stop()
        cls.tmp.cleanup()

    def call(self, path, method="GET", body=None, token=True, headers=None):
        hdrs = dict(JSON if body is not None else {})
        if token and method == "POST":
            hdrs["X-Trader-Token"] = TOKEN
        hdrs.update(headers or {})
        data = json.dumps(body).encode() if body is not None else (b"{}" if method == "POST" else None)
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}")

    def raw(self, request_line, headers, body=b""):
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as sock:
            head = request_line + "\r\n" + "".join(f"{k}: {v}\r\n" for k, v in headers.items()) + "\r\n"
            sock.sendall(head.encode() + body)
            reply = sock.makefile("rb").read()
        return int(reply.split(b"\r\n", 1)[0].decode("latin-1").split()[1])


class FirstRun(RoutesBase):
    def test_not_installed_is_a_200_the_page_can_render(self):
        with FakeEdgeHome(installed=False) as _:
            code, body = self.call("/api/edgestats/overview")
        self.assertEqual(code, 200)
        self.assertTrue(body["ok"])
        self.assertFalse(body["data"]["ready"])
        self.assertEqual(body["data"]["reason"], "edge_not_installed")
        self.assertIn("--with-edge", body["data"]["hint"])

    def test_no_data_is_a_200_with_the_sources_to_choose_from(self):
        with FakeEdgeHome() as _:
            code, body = self.call("/api/edgestats/overview")
        self.assertEqual(code, 200)
        self.assertEqual(body["data"]["reason"], "edge_no_data")
        self.assertEqual({s["id"] for s in body["data"]["sources"]}, {"binance", "dukascopy", "demo"})

    def test_status_is_cheap_and_never_starts_the_engine(self):
        with FakeEdgeHome(with_config=True) as _:
            code, body = self.call("/api/edgestats/status")
            self.assertEqual(code, 200)
            self.assertEqual(body["data"]["service"]["state"], "stopped")
            self.assertTrue(body["data"]["has_data"])
            self.assertFalse(edgestats.pid_path().exists())


class Reads(RoutesBase):
    def setUp(self):
        self.fake = FakeEdgeHome(with_config=True)
        self.fake.__enter__()
        self.addCleanup(self.fake.__exit__, None, None, None)

    def test_overview_when_ready_carries_the_catalogue_and_freshness(self):
        code, body = self.call("/api/edgestats/overview")
        data = body["data"]
        self.assertEqual(code, 200)
        self.assertTrue(data["ready"])
        self.assertGreaterEqual(len(data["presets"]), 6)
        self.assertEqual({s["symbol"] for s in data["symbols"]}, {"DEMO_STK", "DEMO_FUT"})

    def test_registry_by_kind(self):
        code, body = self.call("/api/edgestats/registry?kind=outcome")
        self.assertEqual(code, 200)
        self.assertIn("entries", body["data"])
        code, body = self.call("/api/edgestats/registry?kind=sandwich")
        self.assertEqual((code, body["code"]), (400, "bad_request"))

    def test_a_session_with_its_levels(self):
        q = urllib.parse.quote("DEMO_STK|rth|2024-12-17", safe="")
        code, body = self.call(f"/api/edgestats/session?id={q}&context=5")
        self.assertEqual(code, 200)
        self.assertEqual(body["data"]["sessionId"], "DEMO_STK|rth|2024-12-17")
        self.assertIn("levels", body["data"])

    def test_a_session_needs_a_real_id(self):
        code, body = self.call("/api/edgestats/session")
        self.assertEqual((code, body["code"]), (400, "bad_request"))
        code, body = self.call("/api/edgestats/session?id=" + urllib.parse.quote("../etc|rth|2024-01-01"))
        self.assertEqual(code, 400)
        q = urllib.parse.quote("DEMO_STK|rth|2000-01-01", safe="")
        code, body = self.call(f"/api/edgestats/session?id={q}")
        self.assertEqual((code, body["code"]), (404, "edge_not_found"))

    def test_a_foreign_host_is_refused_like_every_other_route(self):
        self.assertEqual(self.raw("GET /api/edgestats/status HTTP/1.1",
                                  {"Host": "evil.example", "Connection": "close"}), 403)


class Writes(RoutesBase):
    def setUp(self):
        self.fake = FakeEdgeHome(with_config=True)
        self.fake.__enter__()
        self.addCleanup(self.fake.__exit__, None, None, None)

    def test_a_question_needs_the_token(self):
        for action in ("query", "preset", "sessions", "setup", "cancel"):
            code, body = self.call(f"/api/edgestats/{action}", "POST", {}, token=False)
            self.assertEqual((code, body["code"]), (401, "no_token"), action)

    def test_a_foreign_origin_cannot_start_a_download(self):
        code, body = self.call("/api/edgestats/setup", "POST", {"source": "demo"},
                               headers={"Origin": "http://evil.example"})
        self.assertEqual((code, body["code"]), (403, "cross_origin"))
        self.assertIsNone(edgestats.JOBS.snapshot())

    def test_a_query_returns_the_honest_envelope(self):
        code, body = self.call("/api/edgestats/query", "POST",
                               {"dsl": "gapFill WHERE dayOfWeek = Tue", "symbol": "DEMO_STK"})
        self.assertEqual(code, 200)
        data = body["data"]
        for key in ("n", "estimate", "ci95", "guards", "stability", "perYear", "disclaimer"):
            self.assertIn(key, data)

    def test_the_engines_explanation_reaches_the_page(self):
        code, body = self.call("/api/edgestats/query", "POST", {"dsl": "gapFil", "symbol": "DEMO_STK"})
        self.assertEqual((code, body["code"]), (400, "bad_query"))
        self.assertIn("gapFill", body["detail"]["hint"])
        code, body = self.call("/api/edgestats/query", "POST", {"dsl": "gapFill WHERE dayOfWeek =", "symbol": "DEMO_STK"})
        self.assertEqual(body["detail"]["detail"]["position"], len("gapFill WHERE dayOfWeek ="))

    def test_a_preset_with_a_group(self):
        code, body = self.call("/api/edgestats/preset", "POST",
                               {"presetId": "gap-fill", "symbol": "DEMO_STK", "groupBy": "dayOfWeek"})
        self.assertEqual(code, 200)
        self.assertEqual(len(body["data"]["groups"]), 5)

    def test_an_unknown_action_is_a_404_with_the_list(self):
        code, body = self.call("/api/edgestats/nope", "POST", {})
        self.assertEqual((code, body["code"]), (404, "unknown_endpoint"))
        self.assertIn("query", body["detail"]["available"])

    def test_a_download_runs_and_questions_wait_for_it(self):
        with mock.patch.dict(os.environ, {"FAKE_SYNC_SECONDS": "1.5"}):
            code, body = self.call("/api/edgestats/setup", "POST", {})
            self.assertEqual(code, 200)
            self.assertEqual(body["data"]["status"], "running")
            code, body = self.call("/api/edgestats/query", "POST", {"dsl": "gapFill", "symbol": "DEMO_STK"})
            self.assertEqual((code, body["code"]), (503, "edge_busy"))
            code, status = self.call("/api/edgestats/status")
            self.assertEqual(status["data"]["job"]["status"], "running")
            code, body = self.call("/api/edgestats/cancel", "POST", {})
            self.assertEqual(code, 200)
            deadline = __import__("time").monotonic() + 8
            while edgestats.JOBS.running() and __import__("time").monotonic() < deadline:
                __import__("time").sleep(0.1)
            self.assertEqual(edgestats.JOBS.snapshot()["status"], "cancelled")

    def test_a_bad_download_request_is_a_400_before_anything_happens(self):
        code, body = self.call("/api/edgestats/setup", "POST", {"source": "binance", "symbol": "../x"})
        self.assertEqual((code, body["code"]), (400, "bad_symbol"))
        self.assertIsNone(edgestats.JOBS.snapshot())


if __name__ == "__main__":
    unittest.main()
