"""One-shot bridge from the Trader's Agent dock to the local Hermes CLI.

Why the CLI and not an HTTP call: `hermes -z` already carries the operator's provider config,
skills and the LuxAlgo MCP, so a study defined here inherits the same capabilities as the agent he
talks to on Telegram — and nothing new needs a key. Measured on this box: ~11 s for a trivial
prompt, so every call has a hard timeout and reports failure instead of hanging the request thread.

`resume` is the study's own Hermes session id: the first prompt creates the thread, every later
prompt continues it. Because every surface shares one session store, that thread also appears in
the desktop app's SESSIONS sidebar.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time

DEFAULT_CLI = os.environ.get(
    "HERMES_CLI",
    shutil.which("hermes") or "hermes",
)
PINE_RE = re.compile(r"```(?:pine|pinescript)\s*\n(.*?)```", re.S | re.I)
MAX_REPLY = 20000


def compose_prompt(agent: dict, message: str, context: dict | None = None,
                   learnings: str = "") -> str:
    """Study brief + what this study has learned + the live chart state + the operator's words.

    The learnings tail is what makes a study improve instead of starting cold every prompt.
    """
    ctx = context or {}
    lines = [agent.get("instruction", "").strip(), ""]
    if learnings and learnings.strip():
        lines.append("What this study already learned (from its own ledger — build on it, do not repeat it):")
        lines.append(learnings.strip()[-2000:])
        lines.append("")
    known = {k: v for k, v in ctx.items() if v not in (None, "", [], {})}
    if known:
        lines.append("Current chart state (do not ask for it):")
        lines += [f"- {k}: {v}" for k, v in known.items()]
        lines.append("")
    lines.append("Request from the operator:")
    lines.append(message.strip())
    return "\n".join(lines)


def extract_pine(reply: str) -> str:
    """The first fenced Pine block, or '' — the dock turns it into Run/Backtest actions."""
    match = PINE_RE.search(reply or "")
    return match.group(1).strip() if match else ""


CHART_ACTION_RE = re.compile(r"^\s*CHART:\s*(.+?)\s*$", re.I | re.M)
MARKET_KV_RE = re.compile(r"(\w+)\s*=\s*([A-Za-z0-9._\-/]+)")
ADD_RE = re.compile(r"^add\s+([a-z0-9\-]+)", re.I)


def parse_actions(reply: str) -> list[dict]:
    """The other half of the bidirectional link: directives the agent may put in its reply.

    Supported (deliberately tiny, and every one is reported back to the operator):
        CHART: symbol=BTCUSDT timeframe=15m     -> switch the chart's market
        CHART: add supertrend                   -> add Vela's native indicator of that type
        CHART: screenshot                       -> ask the dock to attach a fresh chart image
    Anything else is returned as `{"kind": "unknown"}` so the dock can say it did not act.
    """
    actions: list[dict] = []
    for raw in CHART_ACTION_RE.findall(reply or ""):
        line = raw.strip()
        if line.lower().startswith("add "):
            match = ADD_RE.match(line)
            if match:
                actions.append({"kind": "add", "type": match.group(1).lower()})
            continue
        if line.lower() in ("screenshot", "shot", "capture"):
            actions.append({"kind": "screenshot"})
            continue
        kv = dict(MARKET_KV_RE.findall(line))
        market = {k.lower(): v for k, v in kv.items() if k.lower() in ("symbol", "timeframe", "interval")}
        if market:
            if "interval" in market:
                market["timeframe"] = market.pop("interval")
            actions.append({"kind": "market", **market})
            continue
        actions.append({"kind": "unknown", "line": line[:120]})
    return actions


def run_agent(cli: str, agent: dict, message: str, context: dict | None = None,
              timeout: int = 180, workdir: str | None = None, resume: str | None = None,
              learnings: str = "", extra_args: list[str] | None = None) -> dict:
    """Run one prompt through `hermes -z`. Never raises; always returns a reportable dict."""
    prompt = compose_prompt(agent, message, context, learnings=learnings)
    usage_file = os.path.join("/tmp", f"hermes-usage-{os.getpid()}-{int(time.time() * 1000)}.json")
    cmd = [cli, "-z", prompt, "--usage-file", usage_file]
    for skill in agent.get("skills") or []:
        cmd += ["-s", skill]
    for toolset in agent.get("toolsets") or []:
        cmd += ["-t", toolset]
    if resume:
        cmd += ["--resume", resume]
    if workdir:
        cmd += ["--in", workdir]
    cmd += list(extra_args or [])

    started = time.time()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                              cwd=workdir or None, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": f"agent timed out after {timeout}s",
                "elapsed_ms": int((time.time() - started) * 1000)}
    except OSError as exc:
        return {"ok": False, "reason": f"could not start the agent CLI: {exc}", "elapsed_ms": 0}

    elapsed_ms = int((time.time() - started) * 1000)
    usage = None
    try:
        with open(usage_file, encoding="utf-8") as fh:
            usage = json.load(fh)
    except (OSError, json.JSONDecodeError):
        usage = None
    finally:
        try:
            os.unlink(usage_file)
        except OSError:
            pass

    session_id = usage.get("session_id") if isinstance(usage, dict) else None

    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()
        detail = tail[-1] if tail else "no output"
        return {"ok": False, "reason": f"agent CLI exit {proc.returncode}: {detail[:300]}",
                "elapsed_ms": elapsed_ms, "usage": usage, "session_id": session_id}

    reply = (proc.stdout or "").strip()[:MAX_REPLY]
    if not reply:
        return {"ok": False, "reason": "the agent returned an empty reply",
                "elapsed_ms": elapsed_ms, "usage": usage, "session_id": session_id}
    return {"ok": True, "reply": reply, "pine": extract_pine(reply), "actions": parse_actions(reply),
            "elapsed_ms": elapsed_ms, "usage": usage, "session_id": session_id}
