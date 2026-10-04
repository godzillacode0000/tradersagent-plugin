"""Test doubles for the Edge Stats tier — a stand-in engine that behaves like the real one.

The real engine is a Node program (LuxAlgo/edge-stats) that CI does not install, so the plugin's side of
it (the sidecar lifecycle, the data jobs, the routes, the MCP tools) is tested against a fake `tsx` that
speaks the same command line (`--dir D serve|init|sync …`) and the same HTTP API, answering with REAL
engine responses saved under tests/fixtures/edgestats/. It also keeps the one rule that shaped the whole
design — DuckDB's single-writer lock — so a job that forgets to stop the service first fails here the way
it would for a user ("Could not set lock on file").

Modes (env FAKE_EDGE_MODE): ok · lock (the service dies on the lock) · taken (EADDRINUSE) · hang (never
listens) · crash (exits at once). Sync: FAKE_SYNC_SECONDS, FAKE_SYNC_EXIT.
"""

import json
import os
import socket
import stat
import sys
import tempfile
import textwrap
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "edgestats"

FAKE_TSX = r'''#!{python}
import json, os, sys, time, signal, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

FIX = os.environ["FAKE_EDGE_FIXTURES"]
def fx(name):
    with open(os.path.join(FIX, name + ".json")) as fh:
        return json.load(fh)

args = sys.argv[2:]                         # argv[1] is the .../index.ts entry, as with the real tsx
ws = None
if args[:1] == ["--dir"]:
    ws = args[1]; args = args[2:]
cmd = args[0] if args else ""
data_dir = os.path.join(ws, ".edge-stats")
lock = os.path.join(data_dir, "store.lock")

def take_lock():
    if os.path.exists(lock):
        try:
            pid = int(open(lock).read())
            os.kill(pid, 0)
            print('IO Error: Could not set lock on file "%s/edge-stats.duckdb": Conflicting lock is held in node (PID %d)' % (data_dir, pid))
            sys.exit(1)
        except (ValueError, OSError):
            pass
    os.makedirs(data_dir, exist_ok=True)
    open(lock, "w").write(str(os.getpid()))
    import atexit
    atexit.register(lambda: os.path.exists(lock) and os.unlink(lock))

if cmd == "init":
    os.makedirs(data_dir, exist_ok=True)
    cfg = {"dataDir": ".edge-stats", "minN": {"warn": 30, "refuse": 10}, "recencyWindow": 250,
           "serve": {"port": 3343, "host": "127.0.0.1"}, "symbols": []}
    open(os.path.join(ws, "edge-stats.config.json"), "w").write(json.dumps(cfg, indent=2))
    print("wrote config"); sys.exit(0)

if cmd == "sync":
    take_lock()
    names = args[args.index("--symbol") + 1:] if "--symbol" in args else []
    cfg = json.load(open(os.path.join(ws, "edge-stats.config.json")))
    known = [s["symbol"] for s in cfg["symbols"]]
    for n in names:
        if n not in known:
            print("unknown symbol '%s' - configured symbols: %s" % (n, ", ".join(known))); sys.exit(1)
    for n in names:
        print("%s: downloading" % n, flush=True)
        time.sleep(float(os.environ.get("FAKE_SYNC_SECONDS", "0.1")))
        print("%s: +1000 bars" % n, flush=True)
    sys.exit(int(os.environ.get("FAKE_SYNC_EXIT", "0")))

if cmd != "serve":
    print("unknown command", cmd); sys.exit(2)

mode = os.environ.get("FAKE_EDGE_MODE", "ok")
port = int(args[args.index("--port") + 1])
if mode == "crash": print("boom"); sys.exit(3)
if mode == "lock":
    print('IO Error: Could not set lock on file "x": Conflicting lock is held'); sys.exit(1)
if mode == "taken":
    print("Error: listen EADDRINUSE: address already in use 127.0.0.1:%d" % port); sys.exit(1)
if mode == "hang":
    time.sleep(3600)
take_lock()

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/api/health": return self._send(200, fx("health"))
        if p == "/api/freshness": return self._send(200, fx("freshness"))
        if p == "/api/presets": return self._send(200, fx("presets"))
        if p == "/api/symbols": return self._send(200, fx("symbols"))
        if p == "/api/registry": return self._send(200, fx("registry"))
        if p.startswith("/api/sessions/") and p.endswith("/bars"):
            sid = unquote(p[len("/api/sessions/"):-len("/bars")])
            if sid.endswith("2000-01-01"): return self._send(404, {"error": "no such session '%s'" % sid})
            d = fx("session_bars"); d["sessionId"] = sid; return self._send(200, d)
        return self._send(404, {"error": "not found"})
    def do_POST(self):
        p = urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        known = [s["symbol"] for s in fx("symbols")["symbols"]]
        if body.get("symbol") not in known and p in ("/api/query", "/api/preset"):
            return self._send(400, {"error": "unknown symbol '%s' - configured symbols: %s" % (body.get("symbol"), ", ".join(known))})
        if p == "/api/query":
            dsl = body.get("dsl", "")
            if "gapFil " in dsl + " ": return self._send(400, {"error": "unknown outcome 'gapFil'", "hint": "did you mean 'gapFill'?"})
            if dsl.endswith("="): return self._send(400, {"error": "expected a value, found end of query", "hint": "values are numbers", "position": len(dsl), "length": 1})
            if "0.05%" in dsl: return self._send(200, fx("query_low"))
            d = fx("query"); d["query"]["dsl"] = dsl; d["query"]["symbol"] = body["symbol"]
            if body.get("sessionsLimit") is not None: d["sessions"] = d["sessions"][: body["sessionsLimit"]]
            return self._send(200, d)
        if p == "/api/preset":
            return self._send(200, fx("preset_grouped"))
        if p == "/api/sessions":
            return self._send(200, {"sessions": [{"sessionId": i} for i in body.get("ids", [])]})
        return self._send(404, {"error": "not found"})

srv = ThreadingHTTPServer(("127.0.0.1", port), H)
signal.signal(signal.SIGTERM, lambda *a: threading.Thread(target=srv.shutdown, daemon=True).start())
srv.serve_forever()
'''


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def fixture(name: str):
    with open(FIXTURES / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


class FakeEdgeHome:
    """A temp EDGE home with a fake engine installed, wired through the env the module reads.

        with FakeEdgeHome() as fake:
            ...                # edgestats.* now sees an installed engine on a free port
    """

    def __init__(self, installed: bool = True, with_config: bool = False, symbols=None, mode: str = "ok"):
        self.installed, self.with_config, self.mode = installed, with_config, mode
        self.symbols = symbols if symbols is not None else fixture("symbols")["symbols"]
        self._env: dict = {}

    def __enter__(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="edge-test-")
        self.home = Path(self._tmp.name)
        self.engine = self.home / "engine"
        self.workspace = self.home / "workspace"
        self.port = free_port()
        if self.installed:
            bin_dir = self.engine / "node_modules" / ".bin"
            bin_dir.mkdir(parents=True)
            entry = self.engine / "packages" / "cli" / "src"
            entry.mkdir(parents=True)
            (entry / "index.ts").write_text("// fake entry\n")
            tsx = bin_dir / "tsx"
            tsx.write_text(FAKE_TSX.replace("{python}", sys.executable))
            tsx.chmod(tsx.stat().st_mode | stat.S_IXUSR)
        if self.with_config:
            self.workspace.mkdir(parents=True)
            cfg = {"dataDir": ".edge-stats", "symbols": self.symbols}
            (self.workspace / "edge-stats.config.json").write_text(json.dumps(cfg))
            (self.workspace / ".edge-stats").mkdir()
        env = {"TRADERS_EDGE_HOME": str(self.home), "EDGESTATS_ENGINE": str(self.engine),
               "TRADERS_EDGE_PORT": str(self.port), "FAKE_EDGE_FIXTURES": str(FIXTURES),
               "FAKE_EDGE_MODE": self.mode}
        for key in ("LUXALGO_EDGESTATS",):
            self._env[key] = os.environ.pop(key, None)
        for key, value in env.items():
            self._env[key] = os.environ.get(key)
            os.environ[key] = value
        self._patch_node()
        return self

    def _patch_node(self):
        import edgestats
        from unittest import mock
        self._edge = edgestats
        self._node = mock.patch.object(edgestats, "node_version", return_value=("v22.0.0", 22))
        self._node.start()
        edgestats._CACHE.clear()
        edgestats.SIDECAR = edgestats.Sidecar()      # fresh singletons: no state leaks between tests
        edgestats.JOBS = edgestats.Jobs()

    def __exit__(self, *exc):
        try:
            self._edge.SIDECAR.stop(2.0)
            for _ in range(60):                       # let a still-running job thread finish
                if not self._edge.JOBS.running():
                    break
                self._edge.JOBS.cancel()
                import time
                time.sleep(0.1)
            self._edge.SIDECAR.stop(2.0)
        finally:
            self._node.stop()
            for key, value in self._env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            self._edge._CACHE.clear()
            self._tmp.cleanup()
        return False
