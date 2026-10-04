"""Edge Stats — LuxAlgo's open-source conditional-probability engine, run as an optional local service.

What it is: https://github.com/LuxAlgo/edge-stats (MIT). It syncs intraday bars into a local DuckDB
store, derives session features once, and answers P(outcome | conditions) with the sample size and a
Wilson 95% interval on every number. This module is the plugin's side of it — no statistics are
computed here, and none are re-implemented: the engine is the single source of every number the pane
and the agent show.

How it is hosted (the same shape as the vectorbt tier, console/backend/backtest_service.py):

  * the console stays stdlib-only and up even when the engine is absent — everything here degrades to
    a structured "not installed / no data / busy" answer, never a traceback;
  * the engine is a Node process (`edgestats serve`) bound to 127.0.0.1 and started lazily on first
    use, so a user who never opens Edge Stats pays nothing;
  * it is NOT bundled: `./install.sh --with-edge` clones the pinned commit into
    ~/.local/share/traders-agent/edge/engine and runs `pnpm install --frozen-lockfile` there, exactly
    the way `--with-backtest` fetches vectorbt (see THIRD-PARTY.md).

The one fact the design bends around: DuckDB takes a single-writer lock on its file, so the running
service and a `sync` cannot hold the store at once (measured: "Could not set lock on file … Conflicting
lock is held"). A data job therefore PAUSES the service, runs the sync, and brings the service back —
and while it runs, every question answers `edge_busy` instead of hanging.
"""

from __future__ import annotations

import atexit
import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# The commit the installer checks out and the tests pin (install.sh carries the same string; a test
# fails if the two drift). Bumping it is a deliberate act with its own verification, never a side effect.
PINNED_COMMIT = "a48259887962d0f67a27d2b0815e2df9a52efca5"
ENGINE_REPO = "https://github.com/LuxAlgo/edge-stats"
MIN_NODE_MAJOR = 20

DEFAULT_PORT = 8789
START_WAIT = 40.0            # seconds: tsx compile + DuckDB open measured at ~3 s; the budget is generous
REQUEST_TIMEOUT = 45.0
STOP_WAIT = 6.0
JOB_TAIL = 60                # lines of job output kept (the UI shows the last few)
MAX_JOB_YEARS = 15
CONFIG_NAME = "edge-stats.config.json"

# A symbol the engine can be asked about is whatever the workspace config says. What the plugin will
# ADD is deliberately narrower than the engine's adapter list: only the two keyless, free sources whose
# bars are public archives. Anything else (a CSV path, a keyed vendor) is a hand-edit of the config —
# an agent must not be able to point the engine at an arbitrary file.
_BINANCE_SYMBOL = re.compile(r"^[A-Z0-9]{5,15}$")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_IDENT = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,40}$")
_SESSION_KEY = re.compile(r"^[a-z][a-z0-9_-]{0,23}$")
_SESSION_ID = re.compile(r"^[A-Za-z0-9_.-]{1,40}\|[a-z][a-z0-9_-]{0,23}\|\d{4}-\d{2}-\d{2}$")
_PRESET_ID = re.compile(r"^[a-z][a-z0-9-]{0,60}$")
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

# Dukascopy instruments the plugin offers. The id is Dukascopy's own (what `dukascopy-node` takes);
# the symbol is what traders call it. Volumes are per-side tick volumes and index/commodity quotes are
# Dukascopy CFD prices — the engine's adapter says so, and so does `note` below.
DUKASCOPY = {
    "EURUSD": ("eurusd", "forex"), "GBPUSD": ("gbpusd", "forex"), "USDJPY": ("usdjpy", "forex"),
    "AUDUSD": ("audusd", "forex"), "USDCAD": ("usdcad", "forex"), "USDCHF": ("usdchf", "forex"),
    "NZDUSD": ("nzdusd", "forex"), "EURJPY": ("eurjpy", "forex"), "GBPJPY": ("gbpjpy", "forex"),
    "XAUUSD": ("xauusd", "forex"), "XAGUSD": ("xagusd", "forex"),
    "US500": ("usa500idxusd", "forex"), "US100": ("usatechidxusd", "forex"),
    "US30": ("usa30idxusd", "forex"), "WTI": ("lightcmdusd", "forex"),
}
BINANCE_SUGGESTED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"]

SOURCES = [
    {"id": "binance", "title": "Binance spot", "market": "crypto", "free": True, "keyless": True,
     "symbols": BINANCE_SUGGESTED, "freeform": True, "default_years": 3,
     "note": "Free, keyless 1-minute history from Binance's public archive (data.binance.vision)."},
    {"id": "dukascopy", "title": "Dukascopy", "market": "forex · metals · indices", "free": True,
     "keyless": True, "symbols": list(DUKASCOPY), "freeform": False, "default_years": 1,
     "note": "Free, keyless. Volume is tick count, and index/metal prices are Dukascopy's own CFD "
             "quotes. The first download is slow: it is built from tick files."},
    {"id": "demo", "title": "Demo data", "market": "synthetic", "free": True, "keyless": True,
     "symbols": ["DEMO_STK", "DEMO_FUT"], "freeform": False, "default_years": 2,
     "note": "Deterministic synthetic bars so you can try every report in seconds. "
             "Not market data."},
]


class EdgeError(Exception):
    """A refusal or failure with a stable code, so every caller (route, MCP tool, page) can say the
    same sentence. `status` is the HTTP status the console answers with."""

    def __init__(self, message: str, status: int = 500, code: str = "edge_error",
                 hint: str | None = None, detail=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.hint = hint
        self.detail = detail

    def as_detail(self) -> dict:
        out = {}
        if self.hint:
            out["hint"] = self.hint
        if self.detail is not None:
            out["detail"] = self.detail
        return out


# ── where things live ────────────────────────────────────────────────────────────────────────────


def home() -> Path:
    return Path(os.environ.get("TRADERS_EDGE_HOME")
                or Path.home() / ".local" / "share" / "traders-agent" / "edge")


def engine_dir() -> Path:
    return Path(os.environ.get("EDGESTATS_ENGINE") or home() / "engine")


def workspace_dir() -> Path:
    return home() / "workspace"


def config_path() -> Path:
    return workspace_dir() / CONFIG_NAME


def log_path() -> Path:
    return home() / "logs" / "edge-service.log"


def pid_path() -> Path:
    return home() / "run" / "edge-service.json"


def port() -> int:
    try:
        return int(os.environ.get("TRADERS_EDGE_PORT") or DEFAULT_PORT)
    except ValueError:
        return DEFAULT_PORT


def external_base() -> str | None:
    """LUXALGO_EDGESTATS=http://127.0.0.1:3343 points the console at an engine you run yourself (the
    way LUXALGO_BACKTEST does). The plugin then neither starts nor pauses it, so it cannot run data
    jobs — they would need the lock this process does not own."""
    base = (os.environ.get("LUXALGO_EDGESTATS") or "").strip().rstrip("/")
    return base or None


def base_url() -> str:
    return external_base() or f"http://127.0.0.1:{port()}"


# ── is it installed? ─────────────────────────────────────────────────────────────────────────────

_NODE_CACHE: dict = {"at": 0.0, "value": None}


def node_version() -> tuple[str, int] | None:
    """(`v22.22.0`, 22) or None. Cached: the status route is polled while a job runs."""
    now = time.monotonic()
    if now - _NODE_CACHE["at"] < 120 and _NODE_CACHE["at"]:
        return _NODE_CACHE["value"]
    value = None
    node = shutil.which("node")
    if node:
        try:
            out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
            m = re.match(r"^v(\d+)\.", out)
            if m:
                value = (out, int(m.group(1)))
        except (OSError, subprocess.SubprocessError):
            value = None
    _NODE_CACHE.update(at=now, value=value)
    return value


def tsx_path() -> Path:
    return engine_dir() / "node_modules" / ".bin" / "tsx"


def cli_entry() -> Path:
    return engine_dir() / "packages" / "cli" / "src" / "index.ts"


def engine_commit() -> str | None:
    head = engine_dir() / ".git" / "HEAD"
    try:
        ref = head.read_text().strip()
        if ref.startswith("ref:"):
            ref = (engine_dir() / ".git" / ref.split(None, 1)[1]).read_text().strip()
        return ref[:40] if re.fullmatch(r"[0-9a-f]{40}", ref) else None
    except OSError:
        return None


def install_state() -> dict:
    """Is there an engine to run? Never starts anything. `problem` is a stable code the page maps to a
    sentence; `fix` is the one command that resolves it."""
    if external_base():
        return {"installed": True, "external": True, "problem": None, "fix": None, "node": None}
    node = node_version()
    info = {"installed": False, "external": False, "node": node[0] if node else None,
            "engine": str(engine_dir()), "commit": engine_commit(), "pinned": PINNED_COMMIT}
    if not node:
        return {**info, "problem": "no_node",
                "fix": "Install Node.js 20 or newer (https://nodejs.org), then run ./install.sh --with-edge"}
    if node[1] < MIN_NODE_MAJOR:
        return {**info, "problem": "old_node",
                "fix": f"Node {node[0]} is too old (need {MIN_NODE_MAJOR}+). Upgrade it, then run ./install.sh --with-edge"}
    if not (cli_entry().is_file() and tsx_path().exists()):
        return {**info, "problem": "not_installed",
                "fix": "Run ./install.sh --with-edge from the plugin folder (one-time, needs the network)"}
    return {**info, "installed": True, "problem": None, "fix": None}


# ── the workspace: config + data ─────────────────────────────────────────────────────────────────

_CONFIG_LOCK = threading.RLock()


def read_config() -> dict | None:
    try:
        with open(config_path(), encoding="utf-8") as fh:
            cfg = json.load(fh)
        return cfg if isinstance(cfg, dict) else None
    except (OSError, ValueError):
        return None


def _write_config(cfg: dict) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def configured_symbols() -> list[dict]:
    cfg = read_config() or {}
    return [s for s in (cfg.get("symbols") or []) if isinstance(s, dict) and s.get("symbol")]


def _years_ago(years: float) -> str:
    seconds = int(years * 365.25 * 86400)
    return time.strftime("%Y-%m-%d", time.gmtime(time.time() - seconds))


def _symbol_entry(source: str, symbol: str, years: float, archive_only: bool) -> dict:
    """The config row for one symbol. Validated here — the engine would reject a bad one, but only
    after a download had been started."""
    symbol = (symbol or "").strip().upper()
    if source == "binance":
        if not _BINANCE_SYMBOL.match(symbol):
            raise EdgeError(f"'{symbol}' is not a Binance spot symbol (e.g. BTCUSDT)", 400, "bad_symbol")
        opts: dict = {"market": "spot", "start": _years_ago(years)}
        if archive_only:
            opts["archiveOnly"] = True
        return {"symbol": symbol, "adapter": "binance", "assetClass": "crypto", "tf": "1m",
                "orWindows": [5, 10, 15, 30, 60], "ibWindow": 60, "adapterOptions": opts}
    if source == "dukascopy":
        if symbol not in DUKASCOPY:
            raise EdgeError(f"'{symbol}' is not one of the Dukascopy instruments offered "
                            f"({', '.join(DUKASCOPY)})", 400, "bad_symbol")
        instrument, klass = DUKASCOPY[symbol]
        return {"symbol": symbol, "adapter": "dukascopy", "assetClass": klass, "tf": "1m",
                "orWindows": [5, 10, 15, 30, 60], "ibWindow": 60,
                "adapterOptions": {"instrument": instrument, "start": _years_ago(years)}}
    if source == "demo":
        if symbol not in ("DEMO_STK", "DEMO_FUT"):
            raise EdgeError("the demo data has DEMO_STK and DEMO_FUT", 400, "bad_symbol")
        eq = symbol == "DEMO_STK"
        return {"symbol": symbol, "adapter": "synthetic", "assetClass": "equity" if eq else "future",
                "tf": "1m", "orWindows": [5, 10, 15, 30, 60], "ibWindow": 60,
                "adapterOptions": {"profile": "equity" if eq else "future", "seed": 42 if eq else 1337}}
    raise EdgeError(f"unknown data source '{source}' (binance, dukascopy or demo)", 400, "bad_source")


def _add_symbol(source: str, symbol: str, years: float, archive_only: bool) -> dict:
    """Append (or refresh the start of) one symbol in the workspace config; return its row."""
    entry = _symbol_entry(source, symbol, years, archive_only)
    with _CONFIG_LOCK:
        cfg = read_config()
        if cfg is None:
            raise EdgeError("the Edge Stats workspace has not been created yet", 409, "no_workspace")
        rows = [s for s in (cfg.get("symbols") or []) if isinstance(s, dict)]
        existing = next((s for s in rows if s.get("symbol") == entry["symbol"]), None)
        if existing is not None:
            # Already there: keep its adapter and its watermark-defining start. Re-adding is "update it".
            if existing.get("adapter") != entry["adapter"]:
                raise EdgeError(f"{entry['symbol']} is already configured with the "
                                f"'{existing.get('adapter')}' adapter", 409, "symbol_exists")
            return existing
        rows.append(entry)
        cfg["symbols"] = rows
        _write_config(cfg)
    return entry


def store_bytes() -> int:
    """Disk used by the store. A walk, so it is cached for a few seconds by the caller."""
    total = 0
    root = workspace_dir() / (read_config() or {}).get("dataDir", ".edge-stats")
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(dirpath, name))
            except OSError:
                pass
    return total


# ── the service ──────────────────────────────────────────────────────────────────────────────────


def _opener():
    # Never through the environment's proxy: this is 127.0.0.1, and a corporate proxy answering for it
    # (or refusing it) would read as "the engine is down".
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _http(method: str, url: str, body: dict | None = None, timeout: float = REQUEST_TIMEOUT):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json", "Accept": "application/json",
                                          "User-Agent": "traders-agent-console/1.0"})
    with _opener().open(req, timeout=timeout) as res:
        raw = res.read()
    return json.loads(raw.decode("utf-8") or "{}")


def _pid_alive(pid: int) -> bool:
    """Alive means running — a killed child nobody has reaped yet still answers kill(pid, 0), so the
    process state is read too (a zombie is a corpse, and adopting or waiting on one is a bug)."""
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    try:
        state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
    except (OSError, IndexError):
        return True                                   # no /proc: the signal check stands
    return state != "Z"


def _is_our_engine(pid: int) -> bool:
    """A recorded pid is ours only if it is still the engine CLI — pids are recycled."""
    try:
        cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
    except OSError:
        return False
    return "packages/cli/src/index.ts" in cmd and " serve" in cmd


def _tail_log(lines: int = 8) -> str:
    try:
        text = log_path().read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    rows = [_ANSI.sub("", r).rstrip() for r in text.splitlines() if r.strip()]
    return "\n".join(rows[-lines:])


class Sidecar:
    """The engine process. One per console, started on demand, stopped when the console exits or a
    data job needs the store.

    Two locks, on purpose: `_lock` guards the few fields and is only ever held for an instant, so the
    status route can always answer; `_start_lock` serialises start/stop and may be held for the seconds
    a start takes. A request that arrives mid-start simply waits for the same start to finish."""

    def __init__(self):
        self._lock = threading.RLock()
        self._start_lock = threading.RLock()
        self._proc: subprocess.Popen | None = None
        self._adopted_pid: int | None = None
        self._state = "stopped"          # stopped | starting | ready | failed
        self._error: str | None = None

    # -- probes ----------------------------------------------------------------------------------

    def _health(self, timeout: float = 1.5) -> dict | None:
        try:
            data = _http("GET", base_url() + "/api/health", timeout=timeout)
        except (OSError, ValueError, urllib.error.URLError):
            return None
        return data if isinstance(data, dict) and data.get("ok") else None

    def _alive(self) -> bool:
        with self._lock:
            proc, pid = self._proc, self._adopted_pid
        if proc is not None:
            return proc.poll() is None
        if pid is not None:
            return _pid_alive(pid) and _is_our_engine(pid)
        return False

    def state(self) -> dict:
        with self._lock:
            state, error = self._state, self._error
        if state in ("ready", "starting") and not external_base() and not self._alive():
            with self._lock:
                if self._state in ("ready", "starting"):
                    self._state = state = "stopped"
        return {"state": state, "error": error, "external": bool(external_base())}

    def _set(self, state: str, error: str | None = None) -> None:
        with self._lock:
            self._state, self._error = state, error

    # -- lifecycle -------------------------------------------------------------------------------

    def _adopt(self) -> bool:
        """After a console restart the engine this machine started earlier may still be listening. Take
        it back rather than fight it for the port — but only if the pid file proves it is ours."""
        try:
            rec = json.loads(pid_path().read_text())
            pid = int(rec["pid"])
        except (OSError, ValueError, KeyError, TypeError):
            return False
        if rec.get("workspace") != str(workspace_dir()) or not _is_our_engine(pid):
            return False
        if self._health():
            with self._lock:
                self._adopted_pid, self._proc = pid, None
            self._set("ready")
            return True
        return False

    def ensure(self, wait: float = START_WAIT) -> None:
        """Make sure an engine is answering, or raise an EdgeError that says exactly why not."""
        busy = EdgeError("Edge Stats is updating its data — questions are paused until that finishes",
                         503, "edge_busy", hint="The Data view shows the progress.")
        if JOBS.running():
            raise busy
        if external_base():
            if self._health():
                self._set("ready")
                return
            raise EdgeError(f"no Edge Stats engine answers at {external_base()}", 503, "edge_down",
                            hint="Start it (edgestats serve) or unset LUXALGO_EDGESTATS.")
        problem = install_state()
        if not problem["installed"]:
            raise EdgeError("Edge Stats is not installed on this machine", 503, "edge_not_installed",
                            hint=problem["fix"], detail={"problem": problem["problem"]})
        if not configured_symbols():
            raise EdgeError("Edge Stats has no data yet", 409, "edge_no_data",
                            hint="Open the Data view and load the demo data, or download a symbol.")
        with self._start_lock:
            if JOBS.running():                # a job began while this request waited for the lock
                raise busy
            if self.state()["state"] == "ready" and self._health(1.0):
                return
            if self._adopt():
                return
            if not self._alive():
                self._spawn()
            self._wait_ready(wait)

    def _spawn(self) -> None:
        self._set("starting")
        ws = workspace_dir()
        log = log_path()
        log.parent.mkdir(parents=True, exist_ok=True)
        pid_path().parent.mkdir(parents=True, exist_ok=True)
        if log.exists() and log.stat().st_size > 1_000_000:
            log.write_text("")
        cmd = [str(tsx_path()), str(cli_entry()), "--dir", str(ws), "serve",
               "--port", str(port()), "--host", "127.0.0.1"]
        env = dict(os.environ, NO_COLOR="1", FORCE_COLOR="0")
        try:
            with open(log, "ab") as out:
                proc = subprocess.Popen(cmd, cwd=str(engine_dir()), stdout=out, stderr=subprocess.STDOUT,
                                        env=env, stdin=subprocess.DEVNULL)
        except OSError as exc:
            msg = f"could not start the engine: {exc}"
            self._set("failed", msg)
            raise EdgeError(msg, 503, "edge_start_failed", hint="Check ./install.sh --with-edge ran cleanly.")
        with self._lock:
            self._proc, self._adopted_pid = proc, None
        try:
            pid_path().write_text(json.dumps({"pid": proc.pid, "port": port(), "workspace": str(ws)}))
        except OSError:
            pass

    def _wait_ready(self, wait: float) -> None:
        deadline = time.monotonic() + wait
        while time.monotonic() < deadline:
            if self._health(1.0):
                self._set("ready")
                return
            if not self._alive():
                break
            time.sleep(0.25)
        # Not ready: say why, from the engine's own log (port taken, store locked, bad config, …).
        reason = _tail_log()
        if "EADDRINUSE" in reason:
            msg, code = f"port {port()} is already in use by another program", "edge_port_taken"
            hint = "Set TRADERS_EDGE_PORT to a free port and restart the console."
        elif "Could not set lock" in reason:
            msg, code = "the Edge Stats store is locked by another process", "edge_store_locked"
            hint = "Close any `edgestats` command or other service using this store, then try again."
        else:
            msg, code = "the Edge Stats engine did not start", "edge_start_failed"
            hint = "The last lines of its log are in `detail`."
        self._terminate()
        self._set("failed", msg)
        raise EdgeError(msg, 503, code, hint=hint, detail={"log": reason} if reason else None)

    def _terminate(self, wait: float = STOP_WAIT) -> None:
        with self._lock:
            proc, pid = self._proc, self._adopted_pid
            self._proc, self._adopted_pid = None, None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(wait)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(2)
        elif pid is not None and _pid_alive(pid) and _is_our_engine(pid):
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
            deadline = time.monotonic() + wait
            while _pid_alive(pid) and time.monotonic() < deadline:
                time.sleep(0.1)
            if _pid_alive(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass
        try:
            pid_path().unlink()
        except OSError:
            pass

    def stop(self, wait: float = STOP_WAIT) -> None:
        with self._start_lock:
            self._terminate(wait)
            if self.state()["state"] != "failed":
                self._set("stopped")

    # -- requests --------------------------------------------------------------------------------

    def call(self, method: str, path: str, body: dict | None = None, timeout: float = REQUEST_TIMEOUT):
        """One request to the engine, with the engine's own refusals turned into EdgeErrors."""
        self.ensure()
        for attempt in (1, 2):
            try:
                return _http(method, base_url() + path, body, timeout)
            except urllib.error.HTTPError as exc:
                raise self._engine_refusal(exc)
            except (urllib.error.URLError, ConnectionError, OSError) as exc:
                reason = getattr(exc, "reason", exc)
                if isinstance(reason, TimeoutError) or "timed out" in str(reason).lower():
                    raise EdgeError("the engine took too long to answer", 504, "edge_timeout",
                                    hint="Try a narrower date range, or ask again.")
                if attempt == 1 and not external_base():       # it died between ensure() and now
                    self._set("stopped")
                    self.ensure()
                    continue
                raise EdgeError("the Edge Stats engine is not answering", 503, "edge_down",
                                hint="It restarts on the next question.")
            except ValueError:
                raise EdgeError("the engine answered something that is not JSON", 502, "edge_bad_reply")

    @staticmethod
    def _engine_refusal(exc: urllib.error.HTTPError) -> EdgeError:
        try:
            payload = json.loads(exc.read().decode("utf-8") or "{}")
        except (ValueError, OSError):
            payload = {}
        message = str(payload.get("error") or f"the engine answered HTTP {exc.code}")
        hint = payload.get("hint")
        detail = {k: payload[k] for k in ("position", "length", "issues") if k in payload} or None
        if exc.code == 404:
            return EdgeError(message, 404, "edge_not_found", hint=hint, detail=detail)
        if exc.code == 400:
            return EdgeError(message, 400, "bad_query", hint=hint, detail=detail)
        return EdgeError(message, 502, "edge_engine_error", hint=hint, detail=detail)


SIDECAR = Sidecar()
atexit.register(lambda: SIDECAR.stop(2.0))


# ── data jobs ────────────────────────────────────────────────────────────────────────────────────
#
# A step is (label, "run", argv) — spawn the engine CLI — or (label, "call", fn) — do a small thing in
# this process (the config edit). Steps run in order on one thread; the first failure stops the job.


class Jobs:
    """One data job at a time, run as a child of the console with the service paused."""

    def __init__(self):
        self._lock = threading.RLock()
        self._job: dict | None = None
        self._proc: subprocess.Popen | None = None
        self._seq = 0

    def running(self) -> bool:
        with self._lock:
            return bool(self._job and self._job["status"] in ("running", "cancelling"))

    def snapshot(self) -> dict | None:
        with self._lock:
            if not self._job:
                return None
            job = dict(self._job)
            job["tail"] = list(self._job["tail"])
            job["symbols"] = list(self._job["symbols"])
            return job

    def start(self, steps: list, label: str, symbols: list[str]) -> dict:
        with self._lock:
            if self.running():
                raise EdgeError("a data job is already running", 409, "job_running",
                                hint="Wait for it to finish, or cancel it from the Data view.")
            if external_base():
                raise EdgeError("this console is using an Edge Stats engine it did not start, so it cannot "
                                "run data jobs", 409, "edge_external",
                                hint="Run `edgestats sync` yourself, or unset LUXALGO_EDGESTATS.")
            self._seq += 1
            job_id = self._seq
            self._job = {"id": job_id, "label": label, "symbols": list(symbols), "status": "running",
                         "started": time.time(), "finished": None, "tail": [], "lines": 0,
                         "error": None, "step": steps[0][0] if steps else "starting"}
            threading.Thread(target=self._run, args=(job_id, steps), daemon=True,
                             name=f"edge-job-{job_id}").start()
        return self.snapshot()

    def cancel(self) -> dict:
        with self._lock:
            if not self.running():
                raise EdgeError("no data job is running", 409, "no_job")
            self._job["status"] = "cancelling"
            proc = self._proc
        if proc is not None and proc.poll() is None:
            proc.terminate()
        return self.snapshot()

    def _note(self, job_id: int, line: str) -> None:
        line = _ANSI.sub("", line).rstrip()
        if not line.strip():
            return
        with self._lock:
            if self._job and self._job["id"] == job_id:
                self._job["tail"].append(line[:300])
                del self._job["tail"][:-JOB_TAIL]
                self._job["lines"] += 1

    def _cancelled(self, job_id: int) -> bool:
        with self._lock:
            return bool(self._job and self._job["id"] == job_id and self._job["status"] == "cancelling")

    def _finish(self, job_id: int, status: str, error: str | None = None) -> None:
        with self._lock:
            if self._job and self._job["id"] == job_id:
                self._job.update(status=status, error=error, finished=time.time(), step="done")

    def _run(self, job_id: int, steps: list) -> None:
        verdict: tuple = ("failed", "the job ended without a verdict")
        try:
            SIDECAR.stop()                                     # release the store's single-writer lock
            verdict = ("done", None)
            for label, kind, what in steps:
                if self._cancelled(job_id):
                    verdict = ("cancelled", None)
                    break
                with self._lock:
                    if self._job and self._job["id"] == job_id:
                        self._job["step"] = label
                code = self._call(job_id, what) if kind == "call" else self._exec(job_id, what)
                if self._cancelled(job_id):
                    verdict = ("cancelled", None)
                    break
                if code != 0:
                    with self._lock:
                        tail = [r for r in self._job["tail"] if r.strip()][-3:]
                    verdict = ("failed", " | ".join(tail) or f"exit code {code}")
                    break
        except Exception as exc:  # noqa: BLE001 - the thread must always leave a verdict behind
            verdict = ("failed", f"{type(exc).__name__}: {exc}")
        self._finish(job_id, *verdict)
        if verdict[0] == "done" and not external_base():
            try:                                               # bring the engine back so the next question is fast
                SIDECAR.ensure()
            except EdgeError:
                pass

    def _call(self, job_id: int, fn) -> int:
        try:
            fn()
            return 0
        except EdgeError as exc:
            self._note(job_id, exc.message)
            return 1

    def _exec(self, job_id: int, argv: list) -> int:
        env = dict(os.environ, NO_COLOR="1", FORCE_COLOR="0")
        proc = subprocess.Popen(argv, cwd=str(engine_dir()), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, env=env, stdin=subprocess.DEVNULL)
        with self._lock:
            self._proc = proc
        try:
            for line in proc.stdout:                           # ends when the child closes stdout
                self._note(job_id, line)
            return proc.wait()
        finally:
            proc.stdout.close()
            with self._lock:
                self._proc = None


JOBS = Jobs()


def _cli(*args: str) -> list:
    return [str(tsx_path()), str(cli_entry()), "--dir", str(workspace_dir()), *args]


def setup(body: dict) -> dict:
    """Start a data job. `source` + `symbol` (+ `years`) adds a symbol and downloads it; `source: demo`
    loads the synthetic symbols; with no source it refreshes every configured symbol."""
    state = install_state()
    if not state["installed"]:
        raise EdgeError("Edge Stats is not installed on this machine", 503, "edge_not_installed",
                        hint=state["fix"], detail={"problem": state["problem"]})
    source = str(body.get("source") or "").strip().lower()
    symbol = str(body.get("symbol") or "").strip().upper()
    try:
        years = float(body.get("years") or 0)
    except (TypeError, ValueError):
        raise EdgeError("years must be a number", 400, "bad_request")
    if years and not (0 < years <= MAX_JOB_YEARS):
        raise EdgeError(f"years must be between 0 and {MAX_JOB_YEARS}", 400, "bad_request")
    archive_only = bool(body.get("archive_only"))

    steps: list = []
    if not config_path().is_file():
        # `init` (no demo) writes the config AND copies calendars, events and presets into the data
        # dir — a store is self-contained by design, so it must be the one to create the workspace.
        workspace_dir().mkdir(parents=True, exist_ok=True)
        steps.append(("preparing the workspace", "run", _cli("init", "--quiet")))

    if source == "demo":
        names, label = ["DEMO_STK", "DEMO_FUT"], "Loading the demo data"
    elif source:
        default = next((s["default_years"] for s in SOURCES if s["id"] == source), 3)
        _symbol_entry(source, symbol, years or default, archive_only)       # validate before any disk work
        names, label = [symbol], f"Downloading {symbol} ({source})"
    else:
        names = [s["symbol"] for s in configured_symbols()]
        if not names:
            raise EdgeError("nothing to update — no symbols are configured yet", 409, "edge_no_data",
                            hint="Load the demo data or download a symbol first.")
        label = "Updating the data"

    if source:
        default = next((s["default_years"] for s in SOURCES if s["id"] == source), 3)

        def add_all(src=source, syms=tuple(names), yrs=years or default, arc=archive_only):
            for name in syms:
                _add_symbol(src, name, yrs, arc)
        steps.append(("adding it to the workspace", "call", add_all))
    steps.append(("downloading and deriving sessions", "run", _cli("sync", "--symbol", *names)))
    return JOBS.start(steps, label, names)


def cancel_job() -> dict:
    return JOBS.cancel()


# ── what the page and the agent ask ─────────────────────────────────────────────────────────────

_CACHE: dict = {}


def _cached(key: str, ttl: float, make):
    hit = _CACHE.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = make()
    _CACHE[key] = (now, value)
    return value


def _symbol(value) -> str:
    name = str(value or "").strip()
    known = [s["symbol"] for s in configured_symbols()]
    if name not in known:
        raise EdgeError(f"unknown symbol '{name}'" if name else "a symbol is required", 400, "bad_symbol",
                        hint=("configured symbols: " + ", ".join(known)) if known else None)
    return name


def _date(value, label: str) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not _ISO_DATE.match(text):
        raise EdgeError(f"{label} must be an ISO date like 2024-01-31", 400, "bad_request")
    return text


def _common(body: dict) -> dict:
    out: dict = {"symbol": _symbol(body.get("symbol"))}
    if body.get("sessionKey"):
        key = str(body["sessionKey"]).strip()
        if not _SESSION_KEY.match(key):
            raise EdgeError("sessionKey looks wrong (e.g. rth, utc, london)", 400, "bad_request")
        out["sessionKey"] = key
    for name in ("since", "until"):
        value = _date(body.get(name), name)
        if value:
            out[name] = value
    if body.get("groupBy"):
        group = str(body["groupBy"]).strip()
        if not _IDENT.match(group):
            raise EdgeError("groupBy must be a field name (see the registry)", 400, "bad_request")
        out["groupBy"] = group
    try:
        limit = int(body.get("sessionsLimit") if body.get("sessionsLimit") is not None else 25)
    except (TypeError, ValueError):
        raise EdgeError("sessionsLimit must be a whole number", 400, "bad_request")
    out["sessionsLimit"] = max(0, min(limit, 200))
    return out


def query(body: dict) -> dict:
    dsl = str(body.get("dsl") or "").strip()
    if not dsl:
        raise EdgeError("write a question first — for example: gapFill WHERE dayOfWeek = Tue", 400, "bad_request")
    if len(dsl) > 2000:
        raise EdgeError("that question is too long (2000 characters at most)", 400, "bad_request")
    return SIDECAR.call("POST", "/api/query", {"dsl": dsl, **_common(body)})


def preset(body: dict) -> dict:
    pid = str(body.get("presetId") or body.get("preset") or "").strip()
    if not _PRESET_ID.match(pid):
        raise EdgeError("presetId looks wrong (e.g. gap-fill)", 400, "bad_request")
    payload = {"presetId": pid, **_common(body)}
    params = body.get("params")
    if params not in (None, {}):
        if not isinstance(params, dict) or len(params) > 12:
            raise EdgeError("params must be an object of name → value", 400, "bad_request")
        clean = {}
        for key, value in params.items():
            if not _IDENT.match(str(key)) or isinstance(value, bool) or not isinstance(value, (int, float, str)):
                raise EdgeError(f"parameter '{key}' is not valid", 400, "bad_request")
            clean[str(key)] = value if not isinstance(value, str) else value[:80]
        payload["params"] = clean
    return SIDECAR.call("POST", "/api/preset", payload)


def sessions(ids: list) -> dict:
    if not isinstance(ids, list) or not ids or len(ids) > 200 or not all(
            isinstance(i, str) and _SESSION_ID.match(i) for i in ids):
        raise EdgeError("ids must be a list of 1–200 session ids", 400, "bad_request")
    return SIDECAR.call("POST", "/api/sessions", {"ids": ids})


def session_bars(session_id: str, context: int = 30) -> dict:
    if not _SESSION_ID.match(session_id or ""):
        raise EdgeError("that is not a session id (SYMBOL|session|YYYY-MM-DD)", 400, "bad_request")
    try:
        context = max(0, min(int(context), 120))
    except (TypeError, ValueError):
        context = 30
    quoted = urllib.parse.quote(session_id, safe="")
    return SIDECAR.call("GET", f"/api/sessions/{quoted}/bars?context={context}", timeout=60.0)


def registry(kind: str = "") -> dict:
    kind = (kind or "").strip().lower()
    if kind and kind not in ("field", "predicate", "outcome"):
        raise EdgeError("kind is field, predicate or outcome", 400, "bad_request")
    suffix = f"?kind={kind}" if kind else ""
    return _cached("registry:" + (engine_commit() or "ext") + kind, 600,
                   lambda: SIDECAR.call("GET", "/api/registry" + suffix))


def presets() -> dict:
    return _cached("presets:" + (engine_commit() or "ext"), 300, lambda: SIDECAR.call("GET", "/api/presets"))


def status() -> dict:
    """Everything the page needs to decide what to show, WITHOUT starting the engine: installed? data?
    a job? Cheap and always answers — the page polls it while a job runs."""
    inst = install_state()
    symbols = configured_symbols()
    return {
        "install": inst, "service": SIDECAR.state(), "job": JOBS.snapshot(),
        "symbols": [{"symbol": s["symbol"], "adapter": s.get("adapter"), "assetClass": s.get("assetClass"),
                     "tf": s.get("tf", "1m")} for s in symbols],
        "has_data": bool(symbols), "sources": SOURCES, "pinned": PINNED_COMMIT,
        "store_mb": round(_cached("store_bytes", 15, store_bytes) / 1_000_000, 1) if symbols else 0,
    }


def overview() -> dict:
    """The page's first call: status plus, when the engine can answer, what it holds (freshness) and
    the report catalog. Any reason it cannot is data in the answer (`reason`), not an HTTP error — a
    machine without Node is a normal first-run state, not a fault."""
    out = status()
    out.update(ready=False, reason=None, error=None, hint=None, freshness=None, presets=None)
    try:
        SIDECAR.ensure()
        fresh = SIDECAR.call("GET", "/api/freshness")
        out["freshness"] = fresh
        out["presets"] = presets().get("presets") or []
        last = {s["symbol"]: s for s in fresh.get("symbols") or []}
        for row in out["symbols"]:
            row["lastBar"] = (last.get(row["symbol"]) or {}).get("lastBar")
        out["ready"] = True
        out["service"] = SIDECAR.state()
    except EdgeError as exc:
        out.update(reason=exc.code, error=exc.message, hint=exc.hint)
        if exc.detail is not None:
            out["detail"] = exc.detail
    return out
