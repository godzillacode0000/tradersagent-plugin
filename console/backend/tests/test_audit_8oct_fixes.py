"""The 8 Oct 2026 full audit: the findings that were ours on the backend, fixed and held.

Each test drives the real code (threads, a real socket, the real handler) rather than grepping for a string,
because the audit's own finding about the suite was that string pins stay green while behaviour breaks.

  BE-1/SEC-11  chart bridge: parallel writers (500s, duplicate ids, lost commands)
  BE-16        command ids never restart
  BE-15        a result keeps what the page reported; an id is required
  BE-4         `once_per_view` reaches the stream (through the HTTP handler)
  BE-2         the replay price belongs to the replayed symbol
  BE-3/8/12/13 broker: entry fee in P&L, transactional approve, read errors, large quantities
  BE-6         "1M" is a month; unknown intervals are refused with the list
  BE-11        a partial catalogue is not kept
  SEC-3/4/9    the token, the Origin port, cross-site GETs
  SEC-6/2/17   run_id, agent definitions, the quadratic regex
  SEC-8        thumbnails: exact hosts, content sniffing
  TC-2         static-file traversal has a test
"""
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import agents_store  # noqa: E402
import chart_bridge as cb  # noqa: E402
import chat  # noqa: E402
import library_thumbs  # noqa: E402
import server as srv  # noqa: E402
from broker import BrokerError, PaperBroker  # noqa: E402


# ── chart bridge ───────────────────────────────────────────────────────────────────────────────────────

class ChartBridgeUnderParallelCalls(unittest.TestCase):
    def test_sixty_parallel_commands_all_land_with_their_own_id(self):
        with tempfile.TemporaryDirectory() as root:
            ids, errors = [], []
            lock = threading.Lock()
            start = threading.Barrier(20)

            def worker(n):
                start.wait()
                for k in range(3):
                    try:
                        entry = cb.enqueue(root, {"action": "clear", "tag": f"{n}-{k}"})
                        with lock:
                            ids.append(entry["id"])
                    except Exception as exc:  # noqa: BLE001
                        with lock:
                            errors.append(repr(exc))

            threads = [threading.Thread(target=worker, args=(n,)) for n in range(20)]
            [t.start() for t in threads]
            [t.join() for t in threads]
            self.assertEqual(errors, [])
            self.assertEqual(len(ids), 60)
            self.assertEqual(len(set(ids)), 60, "no two commands share an id")
            self.assertEqual(sorted(ids), list(range(1, 61)))
            self.assertEqual(len(cb.commands_since(root, 0)), cb.MAX_RESULTS)    # the newest 60 survive

    def test_heartbeats_and_results_in_parallel_never_error(self):
        with tempfile.TemporaryDirectory() as root:
            cmd = cb.enqueue(root, {"action": "clear"})
            errors = []

            def beat():
                for _ in range(15):
                    try:
                        cb.save_state(root, {"symbol": "BTCUSDT", "timeframe": "1h"})
                        cb.record_result(root, {"id": cmd["id"], "ok": True})
                    except Exception as exc:  # noqa: BLE001
                        errors.append(repr(exc))

            threads = [threading.Thread(target=beat) for _ in range(8)]
            [t.start() for t in threads]
            [t.join() for t in threads]
            self.assertEqual(errors, [])

    def test_ids_never_restart_even_if_the_queue_file_is_lost(self):
        with tempfile.TemporaryDirectory() as root:
            for _ in range(3):
                cb.enqueue(root, {"action": "clear"})
            (cb._chart_dir(root) / cb.COMMANDS_FILE).write_text("{not json", "utf-8")
            self.assertEqual(cb.enqueue(root, {"action": "clear"})["id"], 4)

    def test_a_result_needs_a_positive_integer_id_and_keeps_what_the_page_reported(self):
        with tempfile.TemporaryDirectory() as root:
            for bad in ({}, {"id": 0}, {"id": -3}, {"id": "abc"}, {"id": None}, {"id": float("inf")}):
                with self.assertRaises(ValueError, msg=repr(bad)):
                    cb.record_result(root, bad)
            out = cb.record_result(root, {"id": 7, "ok": True, "trades": [{"t": 1}], "count": 1,
                                          "overlay": {"a": 1}, "palette": {"b": 2}})
            self.assertEqual(out["trades"], [{"t": 1}])
            self.assertEqual(cb.get_result(root, 7)["overlay"], {"a": 1})


# ── a live console ─────────────────────────────────────────────────────────────────────────────────────

class LiveConsole(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        frontend = Path(cls.tmp.name) / "frontend"
        (frontend / "vendor").mkdir(parents=True)
        (frontend / "index.html").write_text("<!doctype html><title>console</title>", encoding="utf-8")
        (frontend / "app.js").write_text("// app", encoding="utf-8")
        (Path(cls.tmp.name) / "secret.txt").write_text("OUTSIDE", encoding="utf-8")
        cls._orig_static = srv.Handler.static
        srv.Handler.static = srv.StaticFiles(str(frontend))
        cls.token = "audit-token-0123456789"
        cls.patches = [
            mock.patch.object(srv, "CONSOLE_TOKEN", cls.token),
            mock.patch.object(srv, "AGENTS_ROOT", cls.tmp.name),
            mock.patch.dict(os.environ, {"LUXALGO_CHART_ROOT": cls.tmp.name}),
        ]
        for p in cls.patches:
            p.start()
        cls.httpd = srv.Server(("127.0.0.1", 0), srv.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        srv.Handler.static = cls._orig_static
        for p in cls.patches:
            p.stop()
        cls.tmp.cleanup()

    def call(self, path, method="GET", headers=None, body=None, host=None):
        """A raw request, so Host / Origin / Sec-Fetch-* are exactly what we set."""
        data = json.dumps(body).encode() if body is not None else b""
        head = {"Host": host or f"127.0.0.1:{self.port}", "Connection": "close"}
        head.update(headers or {})
        if body is not None:
            head.setdefault("Content-Type", "application/json")
        head["Content-Length"] = str(len(data))
        with socket.create_connection(("127.0.0.1", self.port), timeout=10) as sock:
            sock.sendall((f"{method} {path} HTTP/1.1\r\n" + "".join(f"{k}: {v}\r\n" for k, v in head.items()) + "\r\n").encode() + data)
            reply = sock.makefile("rb").read()
        top, _, payload = reply.partition(b"\r\n\r\n")
        lines = top.decode("latin-1").split("\r\n")
        status = int(lines[0].split()[1])
        hdrs = {k.lower(): v for k, v in (l.split(": ", 1) for l in lines[1:] if ": " in l)}
        try:
            return status, json.loads(payload.decode() or "null"), hdrs
        except ValueError:
            return status, payload, hdrs

    def post(self, path, body, **extra):
        headers = {"X-Trader-Token": self.token}
        headers.update(extra.pop("headers", {}))
        return self.call(path, "POST", headers, body, **extra)

    # SEC-3 ----------------------------------------------------------------------------------------------
    def test_the_token_goes_to_the_own_page_and_to_local_tools_only(self):
        code, body, _ = self.call("/api/session")                                   # curl / CLI
        self.assertEqual((code, body["data"]["token"]), (200, self.token))
        code, body, _ = self.call("/api/session", headers={"Sec-Fetch-Site": "same-origin"})
        self.assertEqual(code, 200)
        for site in ("cross-site", "same-site"):
            code, body, _ = self.call("/api/session", headers={"Sec-Fetch-Site": site})
            self.assertEqual(code, 403, site)
            self.assertNotIn(self.token, json.dumps(body))
        code, _, _ = self.call("/api/session", headers={"Origin": "http://127.0.0.1:1"})   # another localhost app
        self.assertEqual(code, 403)
        code, _, _ = self.call("/api/session", host="evil.example")
        self.assertEqual(code, 403)

    def test_a_lan_peer_is_not_handed_the_token(self):
        with mock.patch.object(srv.Handler, "_peer_is_local", lambda self: False):
            code, body, _ = self.call("/api/session")
            self.assertEqual(code, 403)
            self.assertNotIn(self.token, json.dumps(body))
            with mock.patch.object(srv, "ALLOW_LAN", True):
                self.assertEqual(self.call("/api/session")[0], 200)

    # SEC-4 ----------------------------------------------------------------------------------------------
    def test_another_localhost_port_cannot_post(self):
        mine = f"http://127.0.0.1:{self.port}"
        self.assertEqual(self.post("/api/chart/state", {}, headers={"Origin": mine})[0], 200)
        code, body, _ = self.post("/api/chart/state", {}, headers={"Origin": "http://127.0.0.1:9999"})
        self.assertEqual(code, 403)
        self.assertEqual(self.post("/api/chart/state", {}, headers={"Origin": "http://localhost:" + str(self.port)})[0], 403)

    # SEC-9 ----------------------------------------------------------------------------------------------
    def test_a_cross_site_get_of_an_api_route_is_refused_but_a_local_tool_is_not(self):
        self.assertEqual(self.call("/api/chart/state")[0], 200)
        self.assertEqual(self.call("/api/chart/state", headers={"Sec-Fetch-Site": "same-origin"})[0], 200)
        for site in ("cross-site", "same-site"):
            code, body, _ = self.call("/api/chart/state", headers={"Sec-Fetch-Site": site})
            self.assertEqual((code, body["code"]), (403, "cross_site"))

    # headers --------------------------------------------------------------------------------------------
    def test_the_page_carries_a_csp_and_every_answer_is_nosniff(self):
        code, _, hdrs = self.call("/")
        self.assertEqual(code, 200)
        self.assertIn("default-src 'self'", hdrs["content-security-policy"])
        self.assertNotIn("frame-ancestors", hdrs["content-security-policy"])     # Hermes embeds the page
        self.assertEqual(hdrs["x-content-type-options"], "nosniff")
        self.assertEqual(hdrs["referrer-policy"], "no-referrer")
        self.assertEqual(self.call("/api/health")[2]["x-content-type-options"], "nosniff")

    def test_the_cookie_is_set_for_a_local_peer_only(self):
        self.assertIn("trader_token=", self.call("/")[2].get("set-cookie", ""))
        with mock.patch.object(srv.Handler, "_peer_is_local", lambda self: False):
            self.assertNotIn("set-cookie", self.call("/")[2])

    # BE-4 -----------------------------------------------------------------------------------------------
    def test_once_per_view_reaches_the_stream_so_every_view_may_reload(self):
        cid_a, _ = srv.STREAM.attach()
        cid_b, _ = srv.STREAM.attach()
        try:
            code, body, _ = self.post("/api/chart/command", {"action": "reload", "once_per_view": True})
            self.assertEqual(code, 200, body)
            rid = body["data"]["command"]["id"]
            self.assertTrue(srv.STREAM.is_once(rid))
            self.assertTrue(srv.STREAM.claim(rid, "viewA", once=True))
            self.assertTrue(srv.STREAM.claim(rid, "viewB", once=True), "a second view may run a once-per-view command")
        finally:
            srv.STREAM.detach(cid_a)
            srv.STREAM.detach(cid_b)

    # 400s -----------------------------------------------------------------------------------------------
    def test_bad_numbers_are_a_400_not_a_500(self):
        for path in ("/api/chart/commands?since=abc", "/api/chart/result?id=abc", "/api/library/warm?w=abc"):
            self.assertEqual(self.call(path)[0], 400, path)
        for body in ({"id": "abc"}, {"id": None}, {"id": 0}, {}):
            self.assertEqual(self.post("/api/chart/result", body)[0], 400, body)
        self.assertEqual(self.post("/api/chart/claim", {"id": "x"})[0], 400)
        self.assertEqual(self.post("/api/agents", {"id": "ab", "name": "n", "instruction": "i", "counters": [1]})[0], 400)
        self.assertEqual(self.post("/api/agents/learning", {"agent_id": "no-such-study", "text": "x"})[0], 404)

    # SEC-6 ----------------------------------------------------------------------------------------------
    def test_run_id_cannot_leave_the_results_folder(self):
        base = Path(self.tmp.name) / "_chart" / "backtest"
        base.mkdir(parents=True, exist_ok=True)
        (base / "good.json").write_text('{"ok": 1}', "utf-8")
        (Path(self.tmp.name) / "outside.json").write_text('{"secret": 1}', "utf-8")
        got = srv.load_backtest_result(self.tmp.name, "good")
        self.assertTrue(got["ok"])
        for bad in ("../../outside", "../outside", "/etc/passwd", "a/b", "good.json", "x" * 80):
            got = srv.load_backtest_result(self.tmp.name, bad)
            self.assertFalse(got["ok"], bad)
            self.assertNotIn("secret", json.dumps(got))

    # SEC-2 ----------------------------------------------------------------------------------------------
    def test_chat_ignores_a_client_workdir_and_clamps_the_timeout(self):
        seen = {}

        def fake_run(**kw):
            seen.update(kw)
            return {"ok": True, "reply": "hi", "pine": None, "actions": [], "elapsed_ms": 1, "usage": None, "session_id": None}

        agents_store.ensure_seed(self.tmp.name)
        with mock.patch.object(srv, "run_agent", fake_run):
            self.post("/api/chat", {"agent_id": "desk", "message": "hi", "workdir": "/etc", "timeout": 99999})
        self.assertTrue(seen, "the chat call must have reached run_agent")
        self.assertNotEqual(seen["workdir"], "/etc")
        self.assertLessEqual(seen["timeout"], 600)
        self.assertEqual(self.post("/api/chat", {"agent_id": "desk", "message": "hi", "timeout": "abc"})[0], 400)

    # SEC-10 ---------------------------------------------------------------------------------------------
    def test_a_silent_socket_is_dropped_rather_than_held_for_ever(self):
        self.assertEqual(srv.Handler.timeout, 30)
        self.assertLessEqual(srv.Server.MAX_CONNECTIONS, 256)

    # TC-2 -----------------------------------------------------------------------------------------------
    def test_static_files_cannot_be_traversed_out_of_the_frontend_root(self):
        static = srv.Handler.static
        secret = str(Path(self.tmp.name) / "secret.txt")
        for url in ("/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2fsecret.txt", "/..%5csecret.txt",
                    "//etc/passwd", "///etc/passwd", "/index.html%00.png", "/%00", "/vendor/../../secret.txt",
                    "/%252e%252e/secret.txt", "/../frontend2/x", "/" + "%2e%2e/" * 14 + "etc/passwd"):
            got = static.resolve(url)
            self.assertTrue(got is None or Path(got).resolve() != Path(secret).resolve(), url)
            if got:
                self.assertTrue(os.path.realpath(got).startswith(os.path.realpath(static.root) + os.sep), (url, got))
        self.assertTrue(static.resolve("/app.js").endswith("app.js"))
        self.assertTrue(static.resolve("/").endswith("index.html"))

    def test_the_mjs_type_and_the_cookie_only_on_the_page(self):
        self.assertNotIn("set-cookie", self.call("/app.js")[2])
        self.assertIn("javascript", srv.CONTENT_TYPES.get(".mjs", ""))


# ── replay price ───────────────────────────────────────────────────────────────────────────────────────

class ReplayPriceIsPerSymbol(unittest.TestCase):
    def setUp(self):
        srv._REPLAY.update(active=False, price=None, time=None, symbol=None)
        self._real = srv.binance_price
        srv.binance_price = lambda symbol: {"BTCUSDT": 60000.0, "ETHUSDT": 3000.0}[symbol]
        self._pub = srv.STREAM.publish
        srv.STREAM.publish = lambda *a, **k: 0

    def tearDown(self):
        srv.binance_price = self._real
        srv.STREAM.publish = self._pub
        srv._REPLAY.update(active=False, price=None, time=None, symbol=None)

    def test_an_eth_order_does_not_fill_at_the_btc_cursor_price(self):
        srv.broker_action("replay", {"active": True, "price": 50000, "time": 1, "symbol": "BTCUSDT"}, from_page=True)
        self.assertEqual(srv.broker_price("BTCUSDT"), 50000.0)
        self.assertEqual(srv.broker_price("ETHUSDT"), 3000.0, "another symbol is priced live")
        srv.broker_action("replay", {"active": False}, from_page=True)
        self.assertEqual(srv.broker_price("BTCUSDT"), 60000.0)
        self.assertIsNone(srv._REPLAY["symbol"])

    def test_a_push_with_no_symbol_still_prices_everything(self):
        srv.broker_action("replay", {"active": True, "price": 123.0}, from_page=True)
        self.assertEqual(srv.broker_price("ETHUSDT"), 123.0)

    def test_a_silly_symbol_is_refused(self):
        with self.assertRaises(srv.ApiError):
            srv.broker_action("replay", {"active": True, "price": 1, "symbol": "../x"}, from_page=True)


# ── paper broker ───────────────────────────────────────────────────────────────────────────────────────

class BrokerMoney(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "paper.json")
        self.px = {"XYZ": 100.0}
        self.b = PaperBroker(self.path, lambda s: self.px[s])

    def fill(self, side, qty, sym="XYZ"):
        return self.b.approve(self.b.propose(sym, side, qty)["id"])

    def test_realized_includes_the_entry_fee_and_reconciles_with_equity(self):
        self.fill("buy", 10)
        self.fill("sell", 10)
        st = self.b.state()
        self.assertAlmostEqual(st["realized"], -2.0, places=9)                     # 1.0 in + 1.0 out
        self.assertAlmostEqual(st["equity"] - st["start_cash"], st["realized"] + sum(p["unrealized"] for p in st["positions"]), places=9)
        self.fill("buy", 5)
        self.px["XYZ"] = 110.0
        st = self.b.state()
        self.assertAlmostEqual(st["equity"] - st["start_cash"], st["realized"] + sum(p["unrealized"] for p in st["positions"]), places=9)

    def test_a_failed_save_leaves_the_account_exactly_as_it_was(self):
        oid = self.b.propose("XYZ", "buy", 1)["id"]
        with mock.patch.object(PaperBroker, "_save", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.b.approve(oid)
        st = self.b.state()
        self.assertEqual((st["cash"], st["positions"], [o["id"] for o in st["pending"]]), (10000.0, [], [oid]))
        self.assertEqual(self.b.approve(oid)["status"], "filled", "the retry works")

    def test_large_quantities_sell_cleanly_with_no_ghost_position(self):
        self.px["XYZ"] = 0.00001
        for _ in range(3):
            self.fill("buy", 1234567.891)
        self.fill("sell", 3703703.673)
        self.assertEqual(self.b.state()["positions"], [])
        for _ in range(3):
            self.fill("buy", 1234567.891)
        for _ in range(3):
            self.fill("sell", 1234567.891)
        self.assertEqual(self.b.state()["positions"], [])

    def test_a_read_error_does_not_reset_the_account(self):
        self.fill("buy", 1)
        with mock.patch("builtins.open", side_effect=OSError(5, "EIO")):
            with self.assertRaises(BrokerError) as cm:
                PaperBroker(self.path, lambda s: 1.0)
        self.assertEqual(cm.exception.code, "broker_unavailable")
        self.assertEqual([f for f in os.listdir(self.dir) if ".bad" in f], [])
        self.assertEqual(PaperBroker(self.path, lambda s: 100.0).state()["positions"][0]["qty"], 1.0)

    def test_an_unparsable_file_is_still_set_aside_and_a_thin_one_is_completed(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        PaperBroker(self.path, lambda s: 1.0)
        self.assertTrue([f for f in os.listdir(self.dir) if ".bad" in f])
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump({"cash": 500.0, "orders": [{"id": 4, "status": "filled"}], "positions": {}}, fh)
        b = PaperBroker(self.path, lambda s: 1.0)
        st = b.state()
        self.assertEqual((st["cash"], st["realized"]), (500.0, 0.0))
        self.assertEqual(b.propose("XYZ", "buy", 1)["id"], 5, "ids continue after the highest seen")

    def test_ids_continue_across_a_reset(self):
        a = self.b.propose("XYZ", "buy", 1)["id"]
        self.b.reset()
        self.assertGreater(self.b.propose("XYZ", "buy", 1)["id"], a)

    def test_state_does_not_hold_the_lock_while_pricing(self):
        self.fill("buy", 1)
        gate = threading.Event()
        release = threading.Event()

        def slow(sym):
            gate.set()
            release.wait(5)
            return 100.0

        self.b.price_of = slow
        t = threading.Thread(target=self.b.state)
        t.start()
        self.assertTrue(gate.wait(5))
        started = time.time()
        self.b.propose("XYZ", "buy", 1)                       # would block until `release` if the lock were held
        self.assertLess(time.time() - started, 2.0)
        release.set()
        t.join()


# ── intervals ──────────────────────────────────────────────────────────────────────────────────────────

class Intervals(unittest.TestCase):
    def test_one_capital_m_is_a_month_and_display_forms_are_minutes(self):
        n = srv.normalise_interval
        self.assertEqual((n("1M"), n("30M"), n("3M"), n("15m"), n("1h"), n("4H"), n("1D"), n("1W"), n("1d")),
                         ("1M", "30m", "3m", "15m", "1h", "4h", "1d", "1w", "1d"))
        self.assertEqual(n(""), "1h")

    def test_an_interval_binance_does_not_serve_is_refused_with_the_list(self):
        for bad in ("45M", "3H", "2D", "60", "banana"):
            out = srv.ep_bars({"symbol": ["BTCUSDT"], "interval": [bad]})
            self.assertEqual(out["bars"], [], bad)
            self.assertIn("bad_interval", out["error"])
            self.assertIn("1M", out["error"])

    def test_a_month_is_asked_of_binance_as_a_month(self):
        seen = []
        srv._BARS_MEMO.clear()
        with mock.patch.object(srv, "_fetch_klines", lambda s, i, l, end_time=None: seen.append(i) or []):
            srv.ep_bars({"symbol": ["BTCUSDT"], "interval": ["1M"]})
        self.assertEqual(seen, ["1M"])


# ── catalogue ──────────────────────────────────────────────────────────────────────────────────────────

class CatalogueIsNotKeptWhenPartial(unittest.TestCase):
    def test_a_short_walk_is_served_but_not_saved(self):
        with tempfile.TemporaryDirectory() as root:
            def pages(params):
                page = int(params["page"][0])
                if page == 0:
                    return {"indicators": [{"slug": f"s{i}"} for i in range(srv.CATALOGUE_PAGE)], "total": 806}
                return {"indicators": [], "total": 806}                        # a hiccup on page 1
            with mock.patch.object(srv, "AGENTS_ROOT", root), mock.patch.object(srv, "ep_indicators", pages), \
                    mock.patch.object(srv, "ep_concepts", lambda p: {"concepts": []}), \
                    mock.patch.object(srv, "ep_families", lambda p: {"families": []}):
                out = srv.ep_catalogue({})
                self.assertTrue(out["partial"])
                self.assertEqual(out["upstream_total"], 806)
                self.assertFalse(os.path.exists(os.path.join(root, "catalogue.json")))

    def test_a_complete_walk_is_saved(self):
        with tempfile.TemporaryDirectory() as root:
            def pages(params):
                return {"indicators": [{"slug": "a"}] if params["page"][0] == "0" else [], "total": 1}
            with mock.patch.object(srv, "AGENTS_ROOT", root), mock.patch.object(srv, "ep_indicators", pages), \
                    mock.patch.object(srv, "ep_concepts", lambda p: {"concepts": []}), \
                    mock.patch.object(srv, "ep_families", lambda p: {"families": []}):
                out = srv.ep_catalogue({})
                self.assertNotIn("partial", out)
                self.assertTrue(os.path.exists(os.path.join(root, "catalogue.json")))


# ── agents, chat, thumbnails ───────────────────────────────────────────────────────────────────────────

class AgentDefinitions(unittest.TestCase):
    BASE = {"id": "ab", "name": "n", "instruction": "i"}

    def test_names_that_would_read_as_options_are_refused(self):
        for field, value in (("toolsets", ["-t", "--yolo"]), ("toolsets", ["--yolo"]), ("skills", ["-x"]),
                             ("skills", ["a b"]), ("skills", [5]), ("session_id", "--dangerous"), ("session_id", "a b")):
            with self.assertRaises(ValueError, msg=(field, value)):
                agents_store.validate({**self.BASE, field: value})

    def test_ordinary_names_pass(self):
        out = agents_store.validate({**self.BASE, "skills": ["trader-desk", "trading/trader-desk"], "toolsets": ["terminal"],
                                     "session_id": "20260508_101314_ab12cd"})
        self.assertEqual(out["skills"], ["trader-desk", "trading/trader-desk"])


class ChatParsing(unittest.TestCase):
    def test_a_reply_of_blank_lines_does_not_stall_the_server(self):
        for reply in ("\n" * 20000, "CHART: a" + " " * 19980 + "x", " \t" * 10000 + "\nCHART: add rsi"):
            t0 = time.time()
            chat.parse_actions(reply)
            self.assertLess(time.time() - t0, 0.3)
        self.assertEqual(chat.parse_actions("hello\n  CHART: add supertrend  \nbye"), [{"kind": "add", "type": "supertrend"}])

    def test_the_usage_file_lives_in_a_private_directory_that_is_removed(self):
        seen = {}

        def fake_run(cmd, **kw):
            usage = cmd[cmd.index("--usage-file") + 1]
            seen["dir"] = os.path.dirname(usage)
            seen["mode"] = os.stat(seen["dir"]).st_mode & 0o777
            return mock.Mock(returncode=0, stdout="hi", stderr="")
        with mock.patch.object(chat.subprocess, "run", fake_run):
            out = chat.run_agent("hermes", {"skills": [], "toolsets": [], "instruction": "x"}, "hi", workdir=None)
        self.assertTrue(out["ok"])
        self.assertEqual(seen["mode"], 0o700)
        self.assertFalse(os.path.exists(seen["dir"]))

    def test_a_missing_workdir_is_said_plainly(self):
        out = chat.run_agent("hermes", {"skills": [], "toolsets": [], "instruction": "x"}, "hi", workdir="/no/such/folder")
        self.assertFalse(out["ok"])
        self.assertIn("working folder does not exist", out["reason"])


class Thumbnails(unittest.TestCase):
    PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64

    def test_only_a_real_picture_is_kept_and_a_concurrent_second_ask_never_sees_a_partial_file(self):
        with tempfile.TemporaryDirectory() as cache:
            url = "https://luxalgo-production.s3.amazonaws.com/a.png"
            calls = []

            def shrink(src, dst, width):
                calls.append(1)
                dst.write_bytes(b"\xff\xd8\xff" + b"1" * 10)
                time.sleep(0.3)
                dst.write_bytes(b"\xff\xd8\xff" + b"1" * 1000)               # the whole file arrives later
                return True

            got = []
            with mock.patch.object(library_thumbs, "CACHE_DIR", Path(cache)), \
                    mock.patch.object(library_thumbs, "_fetch", lambda u: self.PNG), \
                    mock.patch.object(library_thumbs, "_shrink", shrink):
                t = threading.Thread(target=lambda: got.append(library_thumbs.thumb("s", url, 320)))
                t.start()
                time.sleep(0.1)
                got.append(library_thumbs.thumb("s", url, 320))                  # while the first is mid-build
                t.join()
            self.assertEqual([len(g[0]) for g in got], [1003, 1003])
            self.assertEqual(len(calls), 1, "built once")

    def test_html_or_svg_bytes_never_reach_the_converters(self):
        with tempfile.TemporaryDirectory() as cache:
            url = "https://luxalgo-production.s3.amazonaws.com/a.png"
            for payload in (b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"#!/bin/sh\n", b"push graphic-context"):
                with mock.patch.object(library_thumbs, "CACHE_DIR", Path(cache)), \
                        mock.patch.object(library_thumbs, "_fetch", lambda u, p=payload: p), \
                        mock.patch.object(library_thumbs, "_shrink", side_effect=AssertionError("converter reached")):
                    self.assertIsNone(library_thumbs.thumb("s", url, 320))

    def test_a_redirect_is_not_followed_and_the_body_is_capped(self):
        handler = library_thumbs._NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 301, "x", {}, "http://127.0.0.1/"))
        self.assertLessEqual(library_thumbs.MAX_BYTES, 8_000_000)


# ── backtest service (pandas is not installed in the console venv; the checks need none) ──────────────

class BacktestService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import importlib.util
        spec = importlib.util.spec_from_file_location("backtest_service_audit", BACKEND / "backtest_service.py")
        cls.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.mod)

    def test_a_local_name_is_a_bare_file_name(self):
        for bad in ("../../etc/passwd", "/etc/hostname", "a/b", "..", ".hidden/x", ""):
            with self.assertRaises((ValueError, ImportError), msg=bad):
                self.mod._bars_local(bad)

    def test_symbol_and_interval_are_validated_before_they_reach_a_url(self):
        for symbol, interval in (("BTC&limit=1", "1h"), ("BTCUSDT", "1h&x=1"), ("", "1h"), ("BTCUSDT", "")):
            with self.assertRaises((ValueError, ImportError)):
                self.mod._klines_binance(symbol, interval, 10)

    def test_json_never_carries_nan(self):
        out = self.mod._clean_nan({"a": float("nan"), "b": [float("inf"), 1.5], "c": {"d": float("-inf")}})
        self.assertEqual(out, {"a": None, "b": [None, 1.5], "c": {"d": None}})
        json.dumps(out, allow_nan=False)


if __name__ == "__main__":
    unittest.main()


# ── the agent-facing layer (needs fastmcp; CI's second step has it) ────────────────────────────────────

from http.server import ThreadingHTTPServer  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))      # a sibling test module, whichever way the suite is started
from test_mcp_server import HAVE_FASTMCP, _Stub, load_mcp, text_of  # noqa: E402


@unittest.skipUnless(HAVE_FASTMCP, "fastmcp is not installed")
class AgentSurface(unittest.TestCase):
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

    def test_a_long_library_script_is_cut_and_says_so_and_the_rest_can_be_read(self):
        pine = "//@version=6\n" + "x = 1\n" * 14000                                  # ~84,000 characters
        _Stub.routes = {"/api/source": {"ok": True, "data": {"source": pine}}}
        first = text_of(self.mcp.library_source("big-one"))
        self.assertIn("truncated: showing characters 0-60000 of", first)
        self.assertIn("offset=60000", first)
        self.assertIn("Do NOT run or port this fragment", first)
        rest = text_of(self.mcp.library_source("big-one", offset=60000))
        self.assertNotIn("truncated", rest)
        self.assertIn("characters 60000-", rest)

    def test_a_script_that_fits_comes_back_whole_with_no_notice(self):
        pine = "//@version=6\nplot(close)\n" * 600                                   # ~15,000 characters, over the old 8,000 cap
        _Stub.routes = {"/api/source": {"ok": True, "data": {"source": pine}}}
        out = text_of(self.mcp.library_source("mid-one"))
        self.assertNotIn("truncated", out)
        self.assertEqual(out.count("plot(close)"), 600)

    def test_a_cut_list_says_how_many_there_were(self):
        _Stub.routes = {"/api/edge/presets": {"ok": True, "data": {"count": 40, "presets": [{"name": f"p{i}"} for i in range(40)]}}}
        out = text_of(self.mcp.edge_presets())
        self.assertIn("30 of 40 preset(s) shown", out)

    def test_a_one_word_name_that_is_not_a_slug_falls_back_to_a_search(self):
        calls = []

        class Routes(dict):
            def get(self, key, default=None):
                calls.append(key)
                if key == "/api/indicator":
                    return {"ok": False, "error": "not found"} if len([c for c in calls if c == key]) == 1 else {"ok": True, "data": {"title": "Killzones"}}
                if key == "/api/search":
                    return {"ok": True, "data": {"results": [{"slug": "killzones-ict"}]}}
                if key == "/api/source":
                    return {"ok": True, "data": {"source": "plot(1)"}}
                return default
        _Stub.routes = Routes()
        out = text_of(self.mcp.library_indicator("killzone"))
        self.assertIn("killzones-ict", out)
        self.assertIn("plot(1)", out)

    def test_the_backtest_tools_answer_with_a_sentence_when_the_tier_is_down(self):
        _Stub.routes = {"/api/backtest": {"ok": False, "error": "backtest service unreachable (URLError)"},
                        "/api/backtest/sweep": {"ok": False, "error": "backtest service unreachable (URLError)"},
                        "/api/backtest/results": {"ok": False, "error": "backtest service unreachable (URLError)"}}
        for out in (self.mcp.bt_run(), self.mcp.bt_optimize(), self.mcp.bt_status()):
            self.assertIsInstance(out, str)
            self.assertIn("unreachable", out)
            self.assertIn("optional", out)

    def test_chart_batch_takes_a_list_as_documented(self):
        _Stub.routes = {"/api/chart/state": {"ok": True, "data": {"open": True, "age_s": 1.0}},
                        "/api/chart/command": {"ok": True, "data": {"pushed": 1, "command": {"id": 1}, "result": {"ok": True, "detail": "cleared"}}}}
        out = text_of(self.mcp.chart_batch([{"action": "clear"}]))
        self.assertNotIn("not valid JSON", out)
        self.assertIn("clear", out.lower())

    def test_chart_shot_says_when_no_view_is_attached(self):
        _Stub.routes = {"/api/chart/state": {"ok": True, "data": {"open": True, "age_s": 1.0}},
                        "/api/chart/command": {"ok": True, "data": {"pushed": 0, "command": {"id": 1}, "result": None}}}
        out = text_of(self.mcp.chart_shot())
        self.assertIn("no chart view is attached", out)

    def test_an_empty_chart_is_called_empty(self):
        _Stub.routes = {"/api/chart/state": {"ok": True, "data": {"open": True, "age_s": 1.0, "symbol": "BTCUSDT", "timeframe": "1h",
                                                                   "bars": None, "last": None, "studies": []}}}
        self.assertIn("holds no bars", text_of(self.mcp.chart_state()))

    def test_calls_to_the_console_do_not_go_through_a_proxy(self):
        _Stub.routes = {"/api/chart/stream/status": {"ok": True, "data": {"views": 1, "pushes": 0, "keepalive_s": 8.0}}}
        with mock.patch.dict(os.environ, {"http_proxy": "http://127.0.0.1:9", "HTTP_PROXY": "http://127.0.0.1:9"}):
            self.assertIn("1 view(s) attached", text_of(self.mcp.chart_views()))
