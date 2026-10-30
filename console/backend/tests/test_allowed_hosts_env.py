"""TRADERS_AGENT_ALLOWED_HOSTS must extend LOCAL_HOSTS at import.

The phone path (`tailscale serve` forwards `Host: macmini.tailXXXX.ts.net` to 127.0.0.1:8787)
depends on this hook; a silent drop would only show up as "refused: non-local Host" on Kevin's
phone while localhost keeps working. The env is read once (at import), so each case runs the
import in a subprocess.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]


class AllowedHostsEnvTest(unittest.TestCase):
    def probe(self, value: str) -> str:
        env = dict(os.environ)
        env["TRADERS_AGENT_ALLOWED_HOSTS"] = value
        env.pop("PYTHONPATH", None)      # keep the probe on the venv that runs this suite
        env.pop("PYTHONHOME", None)
        code = (
            "import sys; sys.path.insert(0, r'%s'); import server; "
            "print('macmini.test.example' in server.LOCAL_HOSTS)" % BACKEND
        )
        done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                              env=env, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout.strip()

    def test_extra_host_is_allowed(self):
        self.assertEqual(self.probe("macmini.test.example"), "True")

    def test_lowercased_variant_is_always_added(self):
        self.assertEqual(self.probe("MacMini.Test.Example"), "True")

    def test_empty_value_changes_nothing(self):
        self.assertEqual(self.probe(""), "False")


if __name__ == "__main__":
    unittest.main()


class AllowedHostBehindAProxyIsATrustedPeer(unittest.TestCase):
    """What an allowlisted Host actually BUYS the caller — pinned, because it is easy to misread.

    `tailscale serve` terminates on this machine and forwards the request to 127.0.0.1 carrying the
    tailnet name as Host. So every device on that tailnet arrives as a LOOPBACK peer: `_peer_is_local()`
    is true for all of them, and the Host gate is the only thing left that could say no — which is
    exactly what TRADERS_AGENT_ALLOWED_HOSTS switches off for the names you list.

    The consequence, measured and asserted below: an allowlisted name gets the POST token and can WRITE
    (the paper broker's approve path included) WITHOUT `TRADERS_AGENT_ALLOW_LAN=1`, because ALLOW_LAN
    guards a non-loopback peer and a proxied caller is not one. That is the intended trade for reaching
    your own console from your own phone; it is pinned here so nobody reads the README's ALLOW_LAN row
    ("LAN peers get a read-only console") and concludes this path is read-only too. A name that is NOT
    on the list is still refused, which is the half that must never regress.
    """

    PROXY = "macmini.tail1234.ts.net"

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(BACKEND))
        import server as srv                       # noqa: PLC0415 - the suite's usual late import
        cls.srv = srv
        cls.tmp = tempfile.TemporaryDirectory()
        frontend = Path(cls.tmp.name) / "frontend"
        frontend.mkdir(parents=True)
        (frontend / "index.html").write_text("<!doctype html><title>console</title>", encoding="utf-8")
        cls._orig_static = srv.Handler.static
        srv.Handler.static = srv.StaticFiles(str(frontend))
        cls.token = "allowed-hosts-token-0123456789"
        # LOCAL_HOSTS is what the gate consults per request; the env that fills it is read at import,
        # so patch the resolved set rather than re-importing the module into this process.
        cls.patches = [
            mock.patch.object(srv, "CONSOLE_TOKEN", cls.token),
            mock.patch.object(srv, "LOCAL_HOSTS", srv.LOCAL_HOSTS | {cls.PROXY}),
            mock.patch.object(srv, "AGENTS_ROOT", cls.tmp.name),
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
        cls.srv.Handler.static = cls._orig_static
        for p in cls.patches:
            p.stop()
        cls.tmp.cleanup()

    def call(self, path, method="GET", headers=None, body=None, host=None):
        data = json.dumps(body).encode() if body is not None else b""
        head = {"Host": host or f"127.0.0.1:{self.port}", "Connection": "close"}
        head.update(headers or {})
        if body is not None:
            head.setdefault("Content-Type", "application/json")
        head["Content-Length"] = str(len(data))
        with socket.create_connection(("127.0.0.1", self.port), timeout=10) as sock:
            sock.sendall((f"{method} {path} HTTP/1.1\r\n"
                          + "".join(f"{k}: {v}\r\n" for k, v in head.items())
                          + "\r\n").encode() + data)
            reply = sock.makefile("rb").read()
        top, _, payload = reply.partition(b"\r\n\r\n")
        status = int(top.decode("latin-1").split("\r\n")[0].split()[1])
        try:
            return status, json.loads(payload.decode() or "null")
        except ValueError:
            return status, payload

    def test_an_allowlisted_proxy_name_is_handed_the_post_token(self):
        code, body = self.call("/api/session", host=self.PROXY)
        self.assertEqual(code, 200)
        self.assertEqual(body["data"]["token"], self.token,
                         "an allowlisted Host is a trusted peer: it receives the write token")

    def test_and_that_token_really_writes_without_allow_lan(self):
        self.assertFalse(self.srv.ALLOW_LAN, "this test is only meaningful while ALLOW_LAN is off")
        code, _ = self.call("/api/broker", "POST", {
            "X-Trader-Token": self.token,
            "Origin": f"http://{self.PROXY}",
        }, {"op": "state"}, host=self.PROXY)
        self.assertEqual(code, 200, "the proxied caller reaches a token-gated writer, not a 401/403")

    def test_a_name_that_is_not_on_the_list_is_still_refused(self):
        code, _ = self.call("/api/session", host="evil.example.com")
        self.assertEqual(code, 403, "the DNS-rebinding refusal must survive the allowlist")
