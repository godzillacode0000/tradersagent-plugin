"""Prop-firm challenge simulator — LuxAlgo's own engine, run locally (19 Oct 2026).

`@luxalgo/prop-firm-sim-cli` (MIT) plays ten thousand complete challenge journeys through a firm's
exact ruleset and returns: pass probability per attempt (with a Wilson 95% CI), per-step rates and
failure reasons, attempts until funded, expected cost, days to funded, and an EV block over the funded
horizon. Deterministic under a seed, pure TypeScript, no I/O.

The console shells out to the installed CLI with `--json` and hands the result to the sheet. Nothing
here is computed by us: every number in the verdict card comes from the engine, and the card carries
the engine's own honesty block (paths, seed, engine version, rules provenance, simplification flags).

Where the data comes from: firm rules are read by the CLI itself from LuxAlgo's public directory
(keyless, the same source the Prop-firms tab already reads); trader stats come from the form, or later
from the desk's own journal. Nothing leaves this machine except that keyless directory read.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

MIN_NODE_MAJOR = 20
NPM_PACKAGE = "@luxalgo/prop-firm-sim-cli"
INSTALL_HINT = "run ./install.sh --with-prop (needs Node 20+; installs @luxalgo/prop-firm-sim-cli)"
RUN_TIMEOUT_S = 90.0
CACHE_TTL_S = 120.0
MAX_PATHS = 50_000
MIN_PATHS = 500


class SimError(Exception):
    """Something the operator can act on: not installed, bad input, engine failure."""

    def __init__(self, message: str, code: str = "sim_error", fix: str | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.fix = fix

    def as_detail(self) -> dict:
        return {"code": self.code, "fix": self.fix}


def home() -> Path:
    return Path(os.environ.get("TRADERS_SIM_HOME")
                or Path.home() / ".local" / "share" / "traders-agent" / "propfirmsim")


def cli_path() -> Path:
    """The installed CLI. PROPFIRMSIM_CLI wins (tests, a second engine)."""
    override = os.environ.get("PROPFIRMSIM_CLI")
    return Path(override) if override else home() / "node_modules" / ".bin" / "prop-firm-sim"


def node_version() -> tuple[str, int] | None:
    node = shutil.which("node")
    if not node:
        return None
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
        major = int(out.lstrip("v").split(".")[0])
        return out, major
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def _package_version(name: str) -> str | None:
    """The version npm recorded, read from the install tree (never re-run npm to ask)."""
    try:
        pkg = json.loads((home() / "node_modules" / name / "package.json").read_text(encoding="utf-8"))
        return str(pkg.get("version") or "") or None
    except (OSError, ValueError):
        return None


def status() -> dict:
    """Installed? which engine? which node? — the sheet's first question, never a walk of the filesystem."""
    cli = cli_path()
    node = node_version()
    info = {
        "installed": cli.exists(),
        "cli": str(cli),
        "node": node[0] if node else None,
        "engine": _package_version("@luxalgo/prop-firm-sim-core"),
        "cli_version": _package_version("@luxalgo/prop-firm-sim-cli"),
        "problem": None,
        "fix": None,
        "hint": INSTALL_HINT,
    }
    if info["installed"]:
        return info
    if not node:
        return {**info, "problem": "no_node",
                "fix": "Install Node.js 20 or newer (https://nodejs.org), then " + INSTALL_HINT}
    if node[1] < MIN_NODE_MAJOR:
        return {**info, "problem": "old_node",
                "fix": f"Node {node[0]} is too old (need {MIN_NODE_MAJOR}+), then " + INSTALL_HINT}
    return {**info, "problem": "not_installed", "fix": INSTALL_HINT}


# ── input validation: the operator gets a sentence, not a stack trace ───────────────────────────────

def _num(where: str, raw, lo: float, hi: float, default: float | None = None) -> float:
    if raw in (None, ""):
        if default is None:
            raise SimError(f"{where} is required", "bad_request")
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise SimError(f"{where} must be a number, got {raw!r}", "bad_request") from None
    if not (lo <= value <= hi):
        raise SimError(f"{where} must be between {lo} and {hi}, got {value}", "bad_request")
    return value


def build_args(params: dict) -> list[str]:
    """The CLI arguments for one simulation. Percentages are passed as the engine's own '1%' form."""
    firm = str(params.get("firm") or "").strip()
    challenge = str(params.get("challenge") or "").strip()
    if not firm or not challenge:
        raise SimError("a simulation needs both firm and challenge (see the directory)", "bad_request")
    args = ["--firm", firm, "--challenge", challenge]
    winrate = _num("winrate", params.get("winrate"), 0.0001, 1.0)
    args += ["--winrate", f"{winrate:g}"]
    args += ["--avg-win", f"{_num('avg win (R)', params.get('avg_win'), 0.01, 100.0):g}"]
    args += ["--avg-loss", f"{_num('avg loss (R)', params.get('avg_loss'), 0.01, 100.0, 1.0):g}"]
    args += ["--trades-per-day", f"{_num('trades per day', params.get('trades_per_day'), 0.1, 100.0):g}"]
    risk = params.get("risk")
    if risk in (None, ""):
        raise SimError("risk per trade is required (percent of balance, e.g. 1)", "bad_request")
    try:
        risk_value = float(risk)
    except (TypeError, ValueError):
        raise SimError(f"risk per trade must be a number (percent), got {risk!r}", "bad_request") from None
    if not (0.01 <= risk_value <= 100.0):
        raise SimError(f"risk per trade must be between 0.01 and 100 (percent), got {risk_value}", "bad_request")
    args += ["--risk", f"{risk_value:g}%"]
    mode = str(params.get("risk_mode") or "percent-of-balance").strip()
    if mode not in ("percent-of-balance", "percent-of-initial", "fixed-amount"):
        raise SimError(f"unknown risk mode {mode!r}", "bad_request")
    args += ["--risk-mode", mode]
    args += ["--paths", str(int(_num("paths", params.get("paths"), MIN_PATHS, MAX_PATHS, 10000)))]
    seed = str(params.get("seed") or "42").strip()
    if seed:
        args += ["--seed", seed]
    args += ["--attempt-cap", str(int(_num("attempt cap", params.get("attempt_cap"), 1, 200, 25)))]
    args += ["--funded-horizon", str(int(_num("funded horizon (days)", params.get("funded_horizon"), 1, 1000, 90)))]
    if str(params.get("no_funded") or "") in ("1", "true", "yes"):
        args += ["--no-funded"]
    return args


# ── running the engine ───────────────────────────────────────────────────────────────────────────────

_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_LOCK = threading.Lock()


def _cached(key: str):
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
    if hit and hit[0] > time.monotonic():
        return {**hit[1], "cached": True}
    return None


def _store(key: str, value: dict):
    with _CACHE_LOCK:
        _CACHE[key] = (time.monotonic() + CACHE_TTL_S, value)
        while len(_CACHE) > 40:
            _CACHE.pop(next(iter(_CACHE)))


def simulate(params: dict) -> dict:
    """One simulation. Same inputs + seed = same numbers (the engine is deterministic)."""
    state = status()
    if not state["installed"]:
        # The fix IS the message: a user who presses Simulate on a machine without the engine should
        # read the command that installs it, not the word "not_installed".
        raise SimError(state["fix"] or "the prop-firm simulator is not installed",
                       state["problem"] or "not_installed", state["fix"])
    args = build_args(params)
    key = json.dumps({"argv": args, "engine": state["engine"]}, sort_keys=True)
    hit = _cached(key)
    if hit:
        return hit
    started = time.monotonic()
    try:
        proc = subprocess.run([str(cli_path()), "simulate", *args, "--json"],
                              capture_output=True, text=True, timeout=RUN_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise SimError(f"the engine did not answer within {RUN_TIMEOUT_S:.0f}s", "timeout") from None
    except OSError as exc:
        raise SimError(f"the engine could not be started: {exc}", "spawn_failed",
                       INSTALL_HINT) from None
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        raise SimError(detail[-1] if detail else f"the engine exited {proc.returncode}", "engine_failed")
    try:
        result = json.loads(proc.stdout)
    except ValueError:
        raise SimError("the engine answered with something that is not JSON", "bad_output") from None
    out = {
        "result": result,
        "command": [NPM_PACKAGE, "simulate", *args],
        "elapsed_ms": round((time.monotonic() - started) * 1000.0, 1),
        "engine": result.get("engineVersion") or state["engine"],
        "cached": False,
    }
    _store(key, out)
    return out
