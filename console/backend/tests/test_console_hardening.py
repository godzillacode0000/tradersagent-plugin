"""The POST door, and the two read-backs the audit's follow-up asked for (2 Oct).

There was no test anywhere for the token gate, the Origin/Host rules, the `diag` pass-through or the
frontend's "ok means something landed" rule — an audit found all four by reading, and reading is not
a regression guard. Same convention as `test_overlay_paint.py`: Python logic is exercised directly,
frontend behaviour is pinned as a source-shape test (there is no JS runner in this suite).

Each pin below corresponds to a defect or a claim, and each would come back silently without it:

  * **A cross-site page could drive the console.** Any page could POST `text/plain` to 127.0.0.1 (no
    preflight, CORS never runs) and the handler parsed every body as JSON — that page could run
    /api/chat (the Hermes CLI) and forge chart state. Every POST now needs a local Host, an
    absent-or-local Origin and the token.
  * **The token reached any local origin.** `cors_origin` reflected `localhost`/`127.0.0.1`/`::1` on
    ANY port, so a page on another local port could read `/api/session` (which returns the token) and
    then pass the Origin check. Only the console's own origin is reflected now.
  * **`diag` was dropped.** The page sends `diag.engine` (which Pine engine is registered) and
    `save_state` rebuilt the state from a fixed field list without it, so `chart_state` could never
    answer the question the reply claimed it answered.
  * **`ok` meant "the engine ran".** `apply` reported success while nothing was on the canvas (#55);
    the fix, its review, and the same door in `script` are pinned here.
"""

import io
import os
import sys
import unittest
from email.message import Message
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parent / "frontend"))
FRONTEND = BACKEND.parent / "frontend"

import server as srv                     # noqa: E402
import chart_bridge as cb                # noqa: E402


def fake_request(host=None, origin=None, token=None, cookie=None):
    """A stand-in `self` for the handler's request predicates: they read `self.headers` only."""
    headers = Message()
    if host is not None:
        headers["Host"] = host
    if origin is not None:
        headers["Origin"] = origin
    if token is not None:
        headers["X-Trader-Token"] = token
    if cookie is not None:
        headers["Cookie"] = cookie
    return type("Req", (), {"headers": headers})()


class TestTheTokenItself(unittest.TestCase):
    def test_mints_a_0600_file_and_reuses_it(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state" / "console.token"
            with mock.patch.object(srv, "TOKEN_PATH", path):
                first = srv.console_token()
                self.assertEqual(len(first), 43)                       # token_urlsafe(32)
                self.assertEqual(path.read_text().strip(), first)      # persisted, not just returned
                self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
                self.assertEqual(srv.console_token(), first)           # a restart keeps the same token

    def test_reads_an_existing_token_file(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "console.token"
            path.write_text("preset-token\n")
            with mock.patch.object(srv, "TOKEN_PATH", path):
                self.assertEqual(srv.console_token(), "preset-token")


class TestTheRequestPredicates(unittest.TestCase):
    def test_host_must_be_local(self):
        self.assertTrue(srv.Handler._host_ok(fake_request(host="127.0.0.1:8787")))
        self.assertTrue(srv.Handler._host_ok(fake_request(host="localhost:8787")))
        self.assertTrue(srv.Handler._host_ok(fake_request(host="[::1]:8787")))   # brackets stripped
        self.assertFalse(srv.Handler._host_ok(fake_request(host="evil.example")))
        self.assertFalse(srv.Handler._host_ok(fake_request(host="")))

    def test_origin_may_be_absent_or_local_only(self):
        self.assertTrue(srv.Handler._origin_ok(fake_request()))                       # CLI, MCP, curl
        self.assertTrue(srv.Handler._origin_ok(fake_request(origin="http://127.0.0.1:8787")))
        self.assertFalse(srv.Handler._origin_ok(fake_request(origin="null")))          # sandboxed page
        self.assertFalse(srv.Handler._origin_ok(fake_request(origin="http://evil.example")))

    def test_token_comes_from_the_header_or_the_cookie(self):
        with mock.patch.object(srv, "CONSOLE_TOKEN", "sekrit"):
            self.assertTrue(srv.Handler._token_ok(fake_request(token="sekrit")))
            self.assertTrue(srv.Handler._token_ok(fake_request(cookie="a=b; trader_token=sekrit; c=d")))
            self.assertFalse(srv.Handler._token_ok(fake_request(token="wrong")))
            self.assertFalse(srv.Handler._token_ok(fake_request(cookie="trader_token=wrong")))
            self.assertFalse(srv.Handler._token_ok(fake_request()))                    # absent = refused

    def test_cors_is_granted_only_to_the_console_own_origin(self):
        self.assertEqual(srv.cors_origin("http://127.0.0.1:8787", "127.0.0.1:8787"),
                         "http://127.0.0.1:8787")
        # another local port is a different origin and gets nothing — it could read /api/session
        self.assertIsNone(srv.cors_origin("http://127.0.0.1:9999", "127.0.0.1:8787"))
        self.assertIsNone(srv.cors_origin("http://evil.example", "127.0.0.1:8787"))
        self.assertIsNone(srv.cors_origin("null", "127.0.0.1:8787"))
        self.assertIsNone(srv.cors_origin(None, "127.0.0.1:8787"))


class TestTheDoorIsInThePath(unittest.TestCase):
    """Source-shape: the three checks must run BEFORE any route is looked at, and /api/session must
    exist and be Host-checked. A reordering that put them after the first route would pass the
    predicate tests above and still leave the door open — this is the pin for that."""

    def setUp(self):
        self.src = (BACKEND / "server.py").read_text(encoding="utf-8")

    def test_post_checks_precede_every_route(self):
        post = self.src[self.src.index("def do_POST"):]
        for check in ("self._host_ok()", "self._origin_ok()", "self._token_ok()"):
            self.assertIn(check, post)
        first_check = min(post.index(c) for c in ("self._host_ok()", "self._origin_ok()", "self._token_ok()"))
        first_route = min(post.index(r) for r in ('if path == "/api/agents"', 'if path == "/api/chat"'))
        self.assertLess(first_check, first_route)

    def test_session_route_exists_and_is_host_checked(self):
        self.assertIn('if path == "/api/session"', self.src)
        i = self.src.index('if path == "/api/session"')
        block = self.src[i:i + 900]
        self.assertIn("self._host_ok()", block)
        self.assertIn("CONSOLE_TOKEN", block)


class TestTheStateKeepsWhatThePageReports(unittest.TestCase):
    def test_save_state_passes_diag_through(self):
        """`diag` carries `engine` (which Pine engine a page registered) — the field the reply told
        the auditor to read. It was dropped here, so the claim was wrong until this test existed."""
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            cb.save_state(tmp, {"symbol": "BTCUSDT", "diag": {"engine": "PineEngine (patched)"}})
            written = json.loads((cb._chart_dir(tmp) / cb.STATE_FILE).read_text(encoding="utf-8"))
        self.assertEqual(written["diag"], {"engine": "PineEngine (patched)"})
        self.assertEqual(written["symbol"], "BTCUSDT")


class TestTheFrontendReportsWhatLanded(unittest.TestCase):
    """The three doors that put a Pine run on the chart (apply / draw / script) must all answer the
    same question — did anything land — and `script` used to answer a different one ("the engine
    ran"). Source-shape, because this suite has no JS runner."""

    def setUp(self):
        self.src = (FRONTEND / "chart-bridge.js").read_text(encoding="utf-8")

    def test_one_shared_rule(self):
        self.assertIn("function paintedAnything(r)", self.src)
        # The ink/has read-back is what makes a series-only script count (its paths are pixels).
        self.assertIn("v.has === true", self.src)
        self.assertIn("v.ink > 0", self.src)

    def test_every_door_uses_it(self):
        self.assertIn("out.ok = paintedAnything(r)", self.src)              # draw + script
        self.assertIn("out.ok = paintedOverlay || paintedNative", self.src)  # apply (with its fields)
        self.assertNotIn("out.ok = Boolean(r.ok)", self.src)                 # the old "it ran" rule


if __name__ == "__main__":
    unittest.main()
