"""
trader-chart-mcp — the Trader's Agent chart as Hermes tools.

The console already exposes everything over HTTP on 127.0.0.1:8787; this file is the thin MCP
wrapper that turns those endpoints into tools an agent can call directly, with no shell in between:

    chart_views            is anything attached to push commands to? (0 = the console is not open)
    chart_caps             what the attached page will actually execute (its own heartbeat)
    chart_state            what the live chart is showing right now
    chart_shot             one PNG of the chart (returned as an image, plus the path)
    chart_apply_pine       run Pine over the chart's live bars and paint a matching native
    chart_draw             run Pine and paint the boxes/lines/labels it builds on the overlay
    chart_clear            clear our overlay and painted natives, then report what is left
    chart_add_indicator    add a Vela native (ema, supertrend, donchian-channels, …)
    chart_remove_indicator take studies OFF the chart (one name, or all=True)
    chart_set_market       switch symbol / timeframe
    chart_reload           remount every attached console (once-per-view)
    chart_palette          what colours the chart is wearing (try=True applies the console theme)
    library_search         search the LuxAlgo Library (concepts + indicators)
    library_indicator      one indicator: metadata, licence and its Pine source

Commands go through the console's push channel (SSE), so a call that used to wait 1-2s for the
page's poll answers in tens of milliseconds. When no view is attached the tool says so plainly
instead of hanging — the chart is not a headless renderer.

Run it (stdio transport, what Hermes expects):

    uvx fastmcp run server.py                       # framework run
    hermes mcp add traders-chart --command "$HOME/.hermes/bin/uvx" \
        --args fastmcp run "$PWD/console/mcp/server.py"          # run it from the repo root
    hermes mcp test traders-chart

Env: LUXALGO_CONSOLE (default http://127.0.0.1:8787), LUXALGO_CHART_INLINE_WAIT (default 8).
"""

from __future__ import annotations

import base64
import json
import math
import os
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

try:
    from fastmcp import FastMCP
except ImportError:  # the MCP SDK ships the same FastMCP class; prefer it over failing
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError:  # pragma: no cover - a helpful message beats a stack trace
        raise SystemExit(
            "neither `fastmcp` nor `mcp` is installed. Run this server with "
            "`uvx fastmcp run server.py`, or `uv pip install fastmcp` first."
        )

try:
    from mcp.types import ToolAnnotations
except ImportError:  # pragma: no cover - older/!!fastmcp-only installs
    try:
        from fastmcp import ToolAnnotations  # type: ignore
    except ImportError:
        ToolAnnotations = None

try:  # FastMCP's image helper: lets chart_shot return the picture itself, not just a path
    from fastmcp import Image as MCPImage
except ImportError:  # pragma: no cover
    MCPImage = None

# The staleness guard lives in its own module so the stdlib-only suite can test it — this file cannot
# be imported without fastmcp, and a guard that only runs when a dependency is present is not a guard.
try:
    from freshness import DEAD_AFTER_S, STALE_AFTER_S, _command_gate, _freshness
except ImportError:  # pragma: no cover - running as a path, not a package
    import sys as _sys

    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from freshness import DEAD_AFTER_S, STALE_AFTER_S, _command_gate, _freshness  # noqa: F401 (re-exported for callers)

try:
    import edge_text
except ImportError:  # pragma: no cover - running as a path, not a package
    import sys as _sys2

    _sys2.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import edge_text

BASE = os.environ.get("LUXALGO_CONSOLE", "http://127.0.0.1:8787").rstrip("/")
INLINE_WAIT = float(os.environ.get("LUXALGO_CHART_INLINE_WAIT", "8"))
SHOT_DIR = os.environ.get("LUXALGO_SHOT_DIR", "/tmp")

mcp = FastMCP("trader-chart")


def _ann(title: str, read_only: bool = False, destructive: bool | None = None,
         open_world: bool = False):
    """Tool annotations — the machine-readable contract a client's review/consent UI reads.

    `read_only` tools never change the chart; the chart-mutating tools say so instead of leaving it
    to be discovered; `open_world` marks the ones that leave this machine (the LuxAlgo Library).
    Returns None on a build whose SDK has no ToolAnnotations, so the server still starts.
    """
    if ToolAnnotations is None:
        return None
    return ToolAnnotations(title=title, readOnlyHint=read_only, destructiveHint=destructive,
                           openWorldHint=open_world)


# ── plumbing ────────────────────────────────────────────────────────────────────────────────────
def _console_token() -> str:
    """The token the console requires on POSTs (minted beside its runtime state, mode 0600). Empty
    when the file is absent — the console's own 401 sentence is then the tool's answer."""
    path = os.environ.get("TRADER_CONSOLE_TOKEN_FILE") or os.path.join(
        os.path.expanduser("~"), ".local", "state", "traders-agent", "console.token"
    )
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return ""


# Calls to the console are loopback: an `http_proxy` in the environment must not get them (it would be sent the console
# token and every Pine script), so this opener has no proxy handler (audit SEC-13).
_LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _call(path: str, payload: dict | None = None, timeout: float = 20.0) -> dict:
    """One console request. Returns the unwrapped `data`, or raises RuntimeError with the console's
    own message — the tools below turn that into a sentence rather than a traceback."""
    headers = {"content-type": "application/json"} if payload is not None else {}
    token = _console_token()
    if token:
        headers["X-Trader-Token"] = token
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers=headers,
        method="POST" if payload is not None else "GET",
    )
    try:
        with _LOCAL.open(req, timeout=timeout) as res:
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # The console answers refusals with a JSON body (401 no token, 400 a bad query, 409 busy…).
        # Read it: "the console is not answering" would be a lie for a console that just said no.
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except (ValueError, OSError):
            raise RuntimeError(f"the console answered HTTP {exc.code}") from exc
    except TimeoutError as exc:
        # Not an URLError: py3.13 surfaces a response-read timeout unwrapped, so the handler
        # below never sees it and the agent would get a traceback instead of the sentence this
        # docstring promises. Caught live by the preflight evidence run, whose stub accepted
        # the socket and then went silent.
        raise RuntimeError(
            f"the console accepted the connection but did not reply within {timeout:.0f}s — "
            f"it may be wedged or mid-restart; call chart_state, or restart the console's "
            f"service (luxalgo-web / traders-agent unit)"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"the console is not answering at {BASE} ({exc.reason}) — is the console running? "
            f"(console/start.sh, or the traders-agent systemd unit)"
        ) from exc
    except ValueError as exc:
        raise RuntimeError(f"the console sent something unreadable: {exc}") from exc
    if not body.get("ok", False):
        message = f"console refused: {body.get('error') or body}"
        detail = body.get("detail")
        if isinstance(detail, dict):
            # An engine-side explanation (did-you-mean, where the syntax error is, how to install) is the
            # most useful part of a refusal — keep it.
            inner = detail.get("detail") if isinstance(detail.get("detail"), dict) else {}
            if inner.get("position") is not None:
                message += f" (at character {inner['position']})"
            if detail.get("hint"):
                message += f" — {detail['hint']}"
        raise RuntimeError(message)
    return body.get("data") or {}


def _page_age() -> float | None:
    """The console page's heartbeat age in seconds — or None when it cannot be known.

    Every command is executed by the page (push → claim → run), so this age is the one fact that
    decides whether queueing is pointless. None — console restarting, an older build without the
    field, unreadable state — means "proceed and let push-and-wait decide".
    """
    try:
        state = _call("/api/chart/state", timeout=3.0)
    except Exception:
        return None
    age = state.get("age_s")
    return float(age) if isinstance(age, (int, float)) else None


def _command(action: str, timeout: float = INLINE_WAIT + 8.0, **fields) -> str:
    """Queue one chart command and wait for the page's answer (push channel → same round trip).

    The heartbeat preflight runs first (freshness.py's command gate): a page old enough that
    nobody will claim the command is told so in milliseconds, instead of the caller waiting the
    full inline window for "had not answered". A view can be registered and still be frozen —
    pushed=1 does not mean an answer is coming; the heartbeat does.
    """
    blocked = _command_gate(_page_age())
    if blocked:
        return f"✗ {blocked}"
    try:
        queued = _call("/api/chart/command", {"action": action, "wait": INLINE_WAIT, **fields},
                       timeout=timeout)
    except RuntimeError as exc:
        return f"✗ {exc}"
    if not queued.get("pushed"):
        return ("✗ no chart view is attached — open the Trader's Agent row in Hermes Desktop (or "
                f"{BASE} in a browser) and call this tool again. The command was queued but nothing "
                "is listening for it.")
    result = queued.get("result")
    if result is None:
        # The view is slower than our window: report honestly instead of pretending it worked.
        return (f"… command {queued.get('command', {}).get('id')} was pushed but the chart had not "
                f"answered within {INLINE_WAIT:.0f}s. Check the chart, or call chart_state.")
    stamp = result.get("stream_ms")
    ms = f" · {stamp:.0f} ms on the wire" if isinstance(stamp, (int, float)) else ""
    detail = result.get("detail") or "no detail"
    if result.get("ok"):
        mark = "✓"
    elif result.get("result") == "metrics":
        # A strategy()-only run: its metrics ran, there is nothing to draw (round 5). A bare ✗ beside
        # "ran, metrics only" read as a failure; ◆ keeps the distinction the page now reports.
        mark = "◆"
        if detail.startswith("◆ "):
            detail = detail[2:]
    else:
        mark = "✗"
    line = f"{mark} {detail}{ms}"
    err = result.get("error")
    if isinstance(err, dict) and err.get("code"):
        # The page's structured failure (see console/frontend/pinets-runner.js): keep the code and the
        # hint in the answer, so a client can branch and a human knows what to do next.
        bits = [str(err["code"])]
        if err.get("feature") or err.get("kind"):
            bits.append(str(err.get("feature") or err.get("kind")))
        where = f" (line {err['line']})" if err.get("line") else ""
        head = bits[0] + (f"[{'/'.join(bits[1:])}]" if len(bits) > 1 else "")
        line += f"\n  {head}{where}: {err.get('message')}"
        if err.get("hint"):
            line += f"\n  → {err['hint']}"
    return line


MAX_PINE_CHARS = 60000      # one answer; a longer script is read in slices with `offset`


def _pine_slice(pine: str, offset: int = 0) -> str:
    """A fenced Pine block that never cuts silently. The tools used to stop at 6000 / 8000 characters with no word, while
    saying "full source": an agent ran or ported a fragment as if it were the script (audit 8 Oct, AS-1)."""
    text = pine.strip()
    total = len(text)
    start = max(0, min(int(offset or 0), total))
    end = min(total, start + MAX_PINE_CHARS)
    block = "```pine\n" + text[start:end] + "\n```"
    if end < total:
        block += (f"\n… truncated: showing characters {start}-{end} of {total} — call again with offset={end} "
                  "for the rest. Do NOT run or port this fragment as the whole script.")
    elif start:
        block += f"\n(characters {start}-{total} of {total})"
    return block


def _more(shown: int, total: int, what: str) -> str:
    """One line saying a list was cut, or nothing when it was not."""
    return f"… {shown} of {total} {what} shown — narrow the query to see the rest" if total > shown else ""


# ── chart tools ─────────────────────────────────────────────────────────────────────────────────
# ── vectorbt backtesting (the tier in console/backend/backtest_service.py, own venv, :8788) ──
# These are thin HTTP clients like every other tool here: the console proxies, the service computes.
# Read-only by contract for bt_status/bt_data_list; bt_run/bt_optimize write results into
# _chart/backtest/ (their own namespace) and never touch the live chart's state.

def _bt(path: str, payload: dict | None = None, timeout: float = 240.0) -> dict:
    """The backtest tier, or an answer that says why not. Every other tool turns a refusal into a sentence; these four
    raised, and the agent saw a traceback (audit AS-5)."""
    try:
        return _call(path, payload, timeout=timeout)
    except RuntimeError as exc:
        return {"ok": False, "error": f"{exc} — the vectorbt tier is optional: install it with ./install.sh --with-backtest and "
                                      "start console/backend/backtest_service.py in its own venv"}


@mcp.tool(annotations=_ann("Backtest a strategy with vectorbt", read_only=False, open_world=True, destructive=False))
def bt_run(source: str = "binance:BTCUSDT:30m", fast: int = 20, slow: int = 50,
           fee: float = 0.001, bars: int = 1000) -> str:
    """Run one MA-cross backtest and return its metrics (return, Sharpe, drawdown, trades).

    `source` is `binance:SYMBOL:TF` (public klines, no key) or `local:NAME` for a CSV/Parquet in
    the operator's data dir. The heavy engine lives in its own venv; results are saved under
    _chart/backtest/<run_id>.json and never written into the live chart's state.
    """
    r = _bt("/api/backtest", {"kind": "ma_cross", "source": source, "fast": fast, "slow": slow,
                              "fee": fee, "bars": bars})
    if not r.get("ok"):
        return f"backtest failed: {r.get('error')}"
    m = r["metrics"]
    return (f"MA {fast}/{slow} · {source} · {r['bars']} bars · {r['ms']:.0f}ms\n"
            f"return {m['total_return_pct']:+.2f}% · maxDD {m['max_drawdown_pct']:.2f}% · "
            f"Sharpe {m['sharpe']:.2f} · Sortino {m['sortino']:.2f}\n"
            f"trades {m['trades']} · win {m['win_rate_pct']:.0f}% · PF {m['profit_factor']:.2f} · "
            f"expectancy {m['expectancy']:.2f}\nrun_id {r['run_id']} (trades saved; use bt_status)")


@mcp.tool(annotations=_ann("Sweep MA parameters with vectorbt", read_only=False, open_world=True, destructive=False))
def bt_optimize(source: str = "binance:BTCUSDT:30m", lo: int = 5, hi: int = 60,
                fee: float = 0.001, bars: int = 1000, top: int = 10) -> str:
    """Sweep every MA pair in [lo, hi] at once (vectorbt's real strength) and rank by return.

    Also reports the median and worst combo — a top result far above the median is usually
    overfitting, not edge.
    """
    r = _bt("/api/backtest/sweep", {"kind": "ma_cross_sweep", "source": source, "window": [lo, hi],
                                    "fee": fee, "bars": bars, "top": top})
    if not r.get("ok"):
        return f"sweep failed: {r.get('error')}"
    lines = [f"{r['combos']} combos · {r['bars']} bars · {r['ms']:.0f}ms · fee {fee*100:.2f}%",
             f"best {r['best_pct']:+.2f}% · median {r['median_pct']:+.2f}% · worst {r['worst_pct']:+.2f}%",
             f"{'fast/slow':<12}{'return':>9}{'trades':>8}{'win%':>7}{'maxDD':>8}"]
    for row in r["top"]:
        lines.append(f"{row['fast']}/{row['slow']:<9}{row['return_pct']:>8.2f}%{row['trades']:>8}"
                     f"{row['win_rate_pct']:>6.0f}%{row['max_drawdown_pct']:>7.2f}%")
    lines.append(f"run_id {r['run_id']}")
    return "\n".join(lines)


@mcp.tool(annotations=_ann("Read a saved backtest result", read_only=True))
def bt_status(run_id: str = "") -> str:
    """Read a saved backtest result: the newest one, or the run you name.

    Files live in _chart/backtest/<run_id>.json — a namespace of its own, so a live session's
    state.json is never involved.
    """
    r = _bt("/api/backtest/results", {"run_id": run_id})
    if not r.get("ok"):
        return f"no result: {r.get('error')}"
    return json.dumps(r.get("result", r), indent=1)[:4000]


@mcp.tool(annotations=_ann("List the operator's local data files", read_only=True))
def bt_data_list() -> str:
    """List OHLC files the operator owns (CSV/Parquet) and what the engine expects.

    Expected schema: a DatetimeIndex (UTC) plus open/high/low/close/volume columns. Use them with
    `source="local:NAME"` in bt_run / bt_optimize.
    """
    r = _bt("/api/backtest/data", {})
    if not r.get("ok"):
        return f"data dir not readable: {r.get('error')}"
    files = r.get("files") or []
    if not files:
        return (f"no local data yet in {r.get('data_dir')}\n"
                f"drop a CSV/Parquet there (DatetimeIndex + open/high/low/close/volume) and it "
                f"appears here; or keep using binance:SYMBOL:TF.")
    return "\n".join(f"{f['name']}  {f['size_kb']}KB  {f.get('rows', '?')} rows" for f in files)


@mcp.tool(annotations=_ann("Paper account", read_only=True))
def broker_state() -> str:
    """The PAPER (simulated Binance spot) account: cash, equity, open positions with live P&L, and the
    orders waiting for the operator's approval. Nothing here is real money."""
    try:
        d = _call("/api/broker", timeout=10.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    lines = [f"PAPER · cash {d['cash']:,.2f} · equity {d['equity']:,.2f} · realised {d['realized']:+,.2f}"]
    rp = d.get("replay") or {}
    if rp.get("active"):
        lines.append(f"  ⏪ replay pricing ON — fills use the replay cursor price ({float(rp['price']):,.2f})")
    for p in d["positions"]:
        lines.append(f"  {p['symbol']} {p['qty']:g} @ {p['avg']:,.2f} → {p['mark']:,.2f} ({p['unrealized']:+,.2f})")
    for o in d["pending"]:
        lines.append(f"  ⏳ #{o['id']} {o['side']} {o['qty']:g} {o['symbol']} — waiting for the operator")
    return "\n".join(lines)


@mcp.tool(annotations=_ann("Propose a paper order", destructive=False))
def broker_propose(symbol: str, side: str, qty: float, note: str = "") -> str:
    """Propose a PAPER order (Binance spot, simulated). It does NOT trade: it puts an Approve/Reject card on
    the chart and waits. Only the operator can approve it, on the card — there is deliberately no tool for
    that. It fills at the live price at the moment the operator approves — or the replay cursor price
    while the operator is replaying — not at today's price.
    `side` is buy or sell; spot has no shorting. `note` is the reason shown on the card — say why."""
    try:
        d = _call("/api/broker/propose", {"symbol": symbol, "side": side, "qty": qty, "note": note}, timeout=10.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    o = d["order"]
    return (f"⏳ proposed #{o['id']}: {o['side']} {o['qty']:g} {o['symbol']} — paper, waiting for the operator "
            "to Approve or Reject on the chart. Nothing has traded.")


@mcp.tool(annotations=_ann("Chart views attached", read_only=True))
def chart_views() -> str:
    """Is a chart view attached right now? Every command tool needs one (the chart is not headless)."""
    try:
        stats = _call("/api/chart/stream/status", timeout=5.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    views = int(stats.get("views") or 0)
    if not views:
        return ("✗ 0 views attached — open the Trader's Agent row (or the console in a browser) "
                "before using the chart tools.")
    return (f"✓ {views} view(s) attached · {stats.get('pushes', 0)} commands pushed so far · "
            f"keepalive {stats.get('keepalive_s')}s")


@mcp.tool(annotations=_ann("Chart capabilities", read_only=True))
def chart_caps() -> str:
    """What the attached page will actually execute. Read this first: an action this build does not
    have fails at the page, not here."""
    try:
        state = _call("/api/chart/state", timeout=5.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    actions = sorted(state.get("actions") or [])
    if not state.get("open"):
        return f"✗ no chart open — {state.get('reason') or 'the console page is not mounted'}"
    if not actions:
        return ("the attached page has not published its action list — it is running an older console "
                "build. The console falls back to its own built-in list.")
    return (f"page can execute: {', '.join(actions)}\n"
            f"  reported {state.get('age_s')}s ago · {state.get('symbol')} {state.get('timeframe')}"
            f"{_freshness(state.get('age_s'))}")


@mcp.tool(annotations=_ann("Chart state", read_only=True))
def chart_state() -> str:
    """What the live chart is showing: symbol, timeframe, last price, bars and the indicators on it."""
    try:
        state = _call("/api/chart/state", timeout=5.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    if not state.get("open"):
        return f"✗ no chart open — {state.get('reason') or 'the console page is not mounted'}"
    # The PANE's truth, not Vela's names alone: a script mounted from the Library is not a native,
    # and the state used to report `natives: []` while the pane's own chip read "1 indicator" (26 Sep).
    studies = [s for s in (state.get("studies") or []) if isinstance(s, dict)]

    def _label(s: dict) -> str:
        srcs = s.get("sources") or [s.get("source")]
        return f"{s.get('name')} ({'/'.join(str(x) for x in srcs)})"

    on_chart = ", ".join(_label(s) for s in studies) or "nothing"
    lines = [
        f"{state.get('symbol')} · {state.get('timeframe')} · last {state.get('last')}",
        f"bars {state.get('bars')} · series {state.get('series')} · drawings {state.get('drawings')}",
        f"on the chart: {on_chart}",
        f"heartbeat {state.get('age_s')}s ago" + (f" · picture: {state['shot']}" if state.get("shot") else ""),
    ]
    if state.get("build") or state.get("viewer"):
        lines.append(f"build {state.get('build') or '—'} · viewer {state.get('viewer') or '—'}")
    # A stale chart is the one failure an agent cannot see for itself: the values below look perfectly
    # plausible whether they were measured a second ago or an hour ago. Say so in words.
    warning = _freshness(state.get("age_s"))
    if warning:
        lines.append(warning.lstrip("\n"))
    if not state.get("bars"):
        lines.append(_NO_BARS)
    return "\n".join(lines)


_NO_BARS = ("⚠ the chart holds no bars (the market feed may be unreachable): an empty chart is what any picture or "
            "indicator result will show.")


@mcp.tool(annotations=_ann("Capture the chart", read_only=True))
def chart_shot(name: str = ""):
    """Capture the chart as a PNG. Returns the image (when the client takes images) and its path."""
    blocked = _command_gate(_page_age())          # the same preflight every other chart tool runs
    if blocked:
        return f"✗ {blocked}"
    try:
        queued = _call("/api/chart/command", {"action": "shot", "wait": INLINE_WAIT + 10.0},
                       timeout=INLINE_WAIT + 14.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    if not queued.get("pushed"):
        return ("✗ no chart view is attached — open the Trader's Agent row in Hermes Desktop (or "
                f"{BASE} in a browser) and call this tool again.")
    result = queued.get("result") or {}
    shot = result.get("shot") or ""
    if not result:
        return ("✗ the chart did not answer within the wait window — the view may have closed "
                "mid-capture. Check with chart_views, then call chart_state.")
    if not result.get("ok") or not shot:
        return f"✗ no picture: {result.get('detail') or 'the chart did not answer'}"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    safe = "".join(ch for ch in (name or "chart") if ch.isalnum() or ch in "-_") or "chart"
    path = os.path.join(SHOT_DIR, f"{safe}-{stamp}.png")
    try:
        if shot.startswith("data:"):            # an inline data URL: decode it into the file
            body = "".join(shot.split(",", 1)[-1].split())
            body += "=" * (-len(body) % 4)
            with open(path, "wb") as fh:
                fh.write(base64.b64decode(body))
        elif os.path.exists(shot):              # the bridge's usual answer: a file it already wrote
            shutil.copy(shot, path)
        else:
            return f"✗ the chart reported a picture at {shot!r}, but it is not on disk"
    except (OSError, ValueError) as exc:
        return f"✗ captured the chart but could not write {path}: {exc}"
    size_kb = round(os.path.getsize(path) / 1024, 1)
    text = f"✓ chart captured ({size_kb} KB) → {path}"
    try:
        if not (_call("/api/chart/state", timeout=5.0).get("bars")):
            text += "\n" + _NO_BARS
    except RuntimeError:
        pass
    if MCPImage is None:
        return text
    return [text, MCPImage(path=path)]


MAX_INPUTS = 64
_INPUTS_SHAPE = 'inputs must be an object that maps an input\u2019s label to its value, e.g. {"Length": 50}'


def _clean_inputs(inputs: Any) -> tuple[dict | None, str]:
    """`inputs` as the page wants it — { label: number | bool | text | null } — or the sentence that says
    what is wrong. Checked here so a malformed call is refused in milliseconds, before anything is queued;
    whether a LABEL exists is the page's to say (it reads the script), and it answers with the ones that do."""
    if inputs is None:
        return None, ""
    if not isinstance(inputs, dict):
        return None, f"✗ {_INPUTS_SHAPE}"
    if len(inputs) > MAX_INPUTS:
        return None, f"✗ {len(inputs)} inputs given; the most one call takes is {MAX_INPUTS}"
    clean: dict[str, Any] = {}
    for key, value in inputs.items():
        label = str(key).strip()
        if not label or len(label) > 200:
            return None, f"✗ an input label must be 1-200 characters, got {str(key)[:40]!r}"
        if value is not None and not isinstance(value, (bool, int, float, str)):
            return None, f"✗ the value for {label!r} must be a number, true/false, text or null"
        if isinstance(value, float) and not math.isfinite(value):
            return None, f"✗ the value for {label!r} is not a finite number"
        if isinstance(value, str) and len(value) > 500:
            return None, f"✗ the value for {label!r} is too long ({len(value)} characters; 500 at most)"
        clean[label] = value
    return clean, ""


@mcp.tool(annotations=_ann("Run Pine on the chart", destructive=True))
def chart_apply_pine(pine: str, inputs: dict[str, Any] | None = None) -> str:
    """Run Pine source over the chart's live bars (LuxAlgo PineTS) and paint what it makes.

    One landasan for every door (chat, script pane, Library): geometry (boxes/lines/labels/tables)
    lands on the console's overlay and is read back after drawing; plot series lands as a matching
    Vela native — only when the script actually plots. PineTS implements most of Pine v6: `while`,
    `for…in`, tuples, `request.security` (higher timeframes are fetched), box/line/label/table and
    strategy() all run. The one thing refused outright is `import` (answer `NOT_RUNNABLE[import]`; the
    answer says so rather than pretending). `request.security` reached only under a last-bar condition
    (`barstate.islast` and the like) is an open engine bug and comes back empty.

    `inputs` sets the script's own settings (its `input.*()` values) by label, e.g.
    {"Length": 50, "Show upper band": false}; anything you leave out keeps the script's default, and
    null puts one back to its default. Colours are "#RRGGBB" or "#RRGGBBAA"; a choice must be one of its
    options; a number outside the input's range is limited to it and the answer says so. A label the
    script does not have is reported together with the labels it does have (chart_pine_inputs lists them
    without running anything). The values also show in the script pane's Settings when the pane holds
    this script, so the operator can see and change them.
    """
    if not pine.strip():
        return "✗ no Pine source given"
    clean, problem = _clean_inputs(inputs)
    if problem:
        return problem
    return _command("apply", pine=pine, **({} if clean is None else {"inputs": clean}))


@mcp.tool(annotations=_ann("Draw a script's levels", destructive=True))
def chart_draw(pine: str, inputs: dict[str, Any] | None = None) -> str:
    """Run Pine source and paint the geometry it BUILDS — boxes, lines and labels — on the chart.

    Use this for the scripts that compute levels instead of plotting a line (most Smart-Money /
    liquidity models): the console runs them and paints their objects on its own overlay, because
    the charting engine has no drawing surface of its own.

    `inputs` works as in chart_apply_pine: the script's own settings by label, e.g. {"Swing length": 10}.
    """
    clean, problem = _clean_inputs(inputs)
    if problem:
        return problem
    return _command("draw", pine=pine, **({} if clean is None else {"inputs": clean}))


@mcp.tool(annotations=_ann("List a script's settings", read_only=True))
def chart_pine_inputs(pine: str) -> str:
    """List the settings a Pine script declares (its `input.*()` values): label, type, default, range or
    options, group. Runs nothing and changes nothing — the chart and the script pane are left as they are.

    Call this before chart_apply_pine / chart_draw with `inputs` when you do not know the labels. The
    labels are matched as written (ignoring case and spacing); the script's variable name or the id
    (`in_0`) work too.
    """
    if not pine.strip():
        return "✗ no Pine source given"
    return _command("script", mode="inputs", pine=pine)


@mcp.tool(annotations=_ann("Clear drawings and painted indicators", destructive=True))
def chart_clear() -> str:
    """Clear the overlay drawings and remove the Vela indicators our paint layer added.

    Reports what is left on the chart afterwards, so a silent no-op is visible.
    """
    return _command("clear")


@mcp.tool(annotations=_ann("Add a Vela indicator", destructive=False))
def chart_add_indicator(native: str) -> str:
    """Add a Vela native indicator to the chart, by name (ema, supertrend, donchian-channels, …)."""
    if not native.strip():
        return "✗ no indicator name given"
    return _command("add", native=native.strip())


@mcp.tool(annotations=_ann("Remove Vela indicator(s)", destructive=True))
def chart_remove_indicator(native: str = "", all: bool = False) -> str:
    """Remove indicators from the chart: one by name (native='macd'), or every study (all=True).

    Measured in this Vela build: the door that works is the *ledger entry's own* remove() — the
    chart's `indicators()` returns entries carrying `nativeType` ('macd', 'ema', …) and an id like
    'native-1'. The cell doors (removeNative / removeInstance / removeFromChart) accept ids and names
    and remove NOTHING, which is why this tool's answer carries the before → after list from the
    chart rather than a claim.
    """
    if not native.strip() and not all:
        return "✗ give a name (native='macd') or all=True"
    if all:
        return _command("remove", all=True)
    return _command("remove", native=native.strip())


@mcp.tool(annotations=_ann("Switch symbol/timeframe", destructive=True))
def chart_set_market(symbol: str, timeframe: str) -> str:
    """Switch the chart to another symbol/timeframe (e.g. BTCUSDT, 1h).

    The answer includes last price and bar count from the chart after the switch — do not follow up
    with chart_state just to confirm.
    """
    if not symbol.strip() or not timeframe.strip():
        return "✗ both symbol and timeframe are required"
    return _command("market", symbol=symbol.strip().upper(), timeframe=timeframe.strip())


@mcp.tool(annotations=_ann("Read or set the workspace grid", destructive=True))
def chart_set_layout(layout: str = "") -> str:
    """Read or change the chart grid — Vela's own workspace layout presets.

    Presets: '1' (single), '2h' (2 side by side), '2v' (2 stacked), '4' (2x2), '8' (4x2), or a
    custom grid 'g<cols>x<rows>' with 1-4 each. No argument = read the grid the page is wearing
    (a read never writes). The answer carries the layout id and every cell's own symbol/timeframe.

    This is the door the chart's own Layout button writes through (`ws.setLayout()`), and it is the
    only way in after boot: a page built with `layout: false` sets monoLayout, where setLayout() is
    a no-op — workspace.js must boot with a preset. The grid is part of the page's own state, so a
    change here survives a console reload.
    """
    want = (layout or "").strip().lower()
    if not want:
        return _command("layout")
    return _command("layout", layout=want)


@mcp.tool(annotations=_ann("List what is on the chart right now", read_only=True))
def chart_studies() -> str:
    """Everything on the chart, each row labelled with the reader that saw it.

    Five readers, because one is one blind spot: `study` (what the console's own chip counts),
    `cell` (the workspace cell's on-chart rows), `overlay` (a script run through the console's
    landasan), `paint` (the PineTS paint layer) and `native` (Vela's own names). Ask this BEFORE
    saying a chart is clean, and after any `chart_remove_indicator`/`chart_clear`, because
    `chart_state`'s `natives` list is Vela's names only — a script mounted from the Library is not
    one of them, and a natives-only report called a chart clean while CRT boxes sat on it (26 Sep).
    """
    return _command("studies")


@mcp.tool(annotations=_ann("List the chart's built-in indicators", read_only=True))
def chart_natives() -> str:
    """What Vela can put on THIS chart from its own side: the built-ins for the current market.

    Returns the count, which are already on the chart, and each entry's type/title/supported/beta.
    The console's Indicators panel shows the same list (BUILT-INS), so a name that works here is a
    name that panel offers — and `chart_add_indicator` takes these `type` values.
    """
    return _command("natives")


@mcp.tool(annotations=_ann("Open the Indicators surface", read_only=False, destructive=False))
def chart_indicators(section: str = "", q: str = "", family: str = "",
                     star: str = "", unstar: str = "",
                     mount: str = "", show: bool = True) -> str:
    """The console's Indicators surface: BUILT-INS + LIBRARY + favourites — the DRAWER.

    The ⌗ modal is deleted (3 Oct, the operator's doc §1): the drawer holds all three halves and
    Vela's own Indicators button is the door. `section` is 'favorites', 'builtins' or 'library';
    `q` fills the search box; `family` narrows the catalogue to one family ('trend', 'smc-ict',
    'wyckoff'… — 'all' clears it); `star`/`unstar` take 'KIND:ID' ('library:order-blocks') and use
    the same favourites the operator's ☆ writes; `mount` mounts a built-in through the surface itself
    ('supertrend' or 'native:supertrend') — library rows keep the Details view, since they carry
    Pine. `show=False` closes it. The answer carries the rows the list holds (each with its family,
    its write-up as `reading`, and whether a preview exists) and the counts, so a drawer that opened
    empty cannot read as a filled one.
    """
    fields = {}
    if section.strip():
        fields["section"] = section.strip().lower()
    if q:
        fields["q"] = q
    if family.strip():
        fields["family"] = family.strip().lower()
    if star.strip():
        fields["star"] = star.strip()
    if unstar.strip():
        fields["unstar"] = unstar.strip()
    if mount.strip():
        fields["mount"] = mount.strip()
    if not show:
        fields["show"] = False
    return _command("indicators", **fields)


@mcp.tool(annotations=_ann("Full screen for the chart", read_only=False, destructive=False))
def chart_fullscreen(on: bool = True) -> str:
    """Give the chart the whole pane — and the whole screen, where the host allows it.

    Presses the same button the console's topbar and Vela's own toolbar row carry: the console's
    chrome, panels and statusbar step aside so the chart owns the page, and the page asks the browser
    for fullscreen so the console can take the display as well. `on=False` brings everything back
    (Esc does the same, as does the floating ✕). The answer reports both halves — `native` tells you
    whether the display was taken or only the page, and a host that refuses fullscreen (a pane iframe
    without `allowfullscreen`) still gets the chart the whole page. Worth using before `chart_shot`
    when the operator wants a big, uncluttered capture.
    """
    return _command("fullscreen", on=bool(on))


@mcp.tool(annotations=_ann("Replay the chart", read_only=False, destructive=False))
def chart_replay(op: str = "state", bars: int = 100, from_ms: int = 0, interval_ms: int = 0) -> str:
    """Drive Vela's own replay engine — the operator's replay button, from the agent's side.

    `op` is one of: start (rewind — `bars` back from the end of the loaded history, default 100, or
    an exact `from_ms` epoch-ms start), step (reveal the next bar), play (advance on its own;
    `interval_ms` per bar), pause, stop (leave replay; live resumes), state (read only).
    While replay is on, a paper fill uses the REPLAY cursor price instead of the live one — the
    strip in the chart keeps the server's price in step.
    """
    fields: dict = {"op": op}
    if from_ms:
        fields["from"] = int(from_ms)
    elif op == "start" and bars:
        fields["bars"] = int(bars)
    if interval_ms:
        fields["intervalMs"] = int(interval_ms)
    return _command("replay", **fields)


@mcp.tool(annotations=_ann("Draw on the chart with Vela's drawing tools", read_only=False, destructive=True))
def chart_drawing(op: str = "list", type: str = "", anchors: list[dict] | None = None, id: str = "",
                  ids: list[str] | None = None, style: dict | None = None, text: str = "",
                  props: dict | None = None, locked: bool | None = None, visible: bool | None = None,
                  all: bool = False) -> str:
    """Draw with Vela's own drawing tools — real objects the operator can drag and edit afterwards.

    `op`: add | list | update | remove | clear | types (types lists all 76 with their anchor counts).
    `type` (add): a Vela type — trendline, hline, vline, ray, parallelchannel, fibretracement, fibextension,
    gannfan, pitchfork, xabcd, elliottimpulse, headshoulders, box, text, position, datepricerange … — or a
    plain word (fib, support, channel, rectangle, measure). A wrong name answers with the nearest types.
    `anchors` (add / update): one dict per anchor, each `{"bars_ago": 0, "price": 84500}` (0 = the latest
    bar) or `{"time": <epoch ms | seconds | ISO>, "price": …}`. The count must match the type — a trend
    line takes exactly 2, a parallel channel 3, XABCD 5 — and a wrong count is refused BEFORE drawing,
    because Vela would otherwise accept it and paint nothing.
    `style` / `text` / `props` / `locked` / `visible` shape the drawing; `id` or `ids` pick one to
    update or remove. `clear` removes EVERY drawing, the operator's hand-drawn ones too, so it needs
    `all=true`; one undo brings them back.
    """
    fields: dict = {"op": op}
    if type:
        fields["type"] = type
    if anchors:
        fields["anchors"] = anchors
    if id:
        fields["drawing_id"] = id      # `id` is reserved by the command queue (it stamps its own number)
    if ids:
        fields["ids"] = ids
    if style:
        fields["style"] = style
    if text:
        fields["text"] = text
    if props:
        fields["props"] = props
    if locked is not None:
        fields["locked"] = bool(locked)
    if visible is not None:
        fields["visible"] = bool(visible)
    if all:
        fields["all"] = True
    return _command("drawing", **fields)


@mcp.tool(annotations=_ann("Chart view settings (type, scale, time zone, status line …)", read_only=False, destructive=False))
def chart_view(setting: str = "state", value: str = "") -> str:
    """Read or set one chart view setting — the things the operator would click in Vela's menus.

    `setting` with no `value` reads it; `state` (the default) reads them all. Settings:
    chart_type (candles | bars | line | area | baseline | heikinashi) · log, invert, auto_scale,
    countdown (on/off) · scale_mode (price | percent | indexed) · timezone (utc, exchange, kuala lumpur,
    new york, london, tokyo … or an IANA name) · session (regular | extended — only where the symbol
    has one; crypto does not) · watermark, indicator_titles, indicator_values (on/off) ·
    statusline_logo, statusline_name, statusline_market, statusline_ohlc, statusline_change (on/off) ·
    sync_symbol, sync_timeframe, sync_crosshair, sync_style (on/off — grid sync between chart cells) ·
    shortcuts (on/off — the ? help panel) · alerts (read | clear).
    Every write is read back from the chart: ✓ only when the chart reports the new value.
    `alerts` is the inbox of alerts an indicator raised with alertcondition(). Vela cannot create a price
    alert, so there is no way to add one from here — the answer says so.
    """
    fields: dict = {"setting": setting}
    if value != "":
        fields["value"] = value
    return _command("view", **fields)


@mcp.tool(annotations=_ann("Event marks on the chart's time axis", read_only=False, destructive=True))
def chart_marks(op: str = "list", time: str = "", bars_ago: int = -1, title: str = "", content: str = "",
                color: str = "", shape: str = "", letter: str = "", id: str = "") -> str:
    """Place small event marks on the chart's time axis (news, a trade idea, "I entered here").

    `op`: add | list | remove | clear. `add` needs a place — `bars_ago` (0 = the latest bar) or an exact
    `time` (epoch ms / seconds / ISO) — plus a `title`; `content` is the text shown when hovered,
    `color` a hex like #f5a623, `shape` circle | square | diamond | pin, `letter` up to 2 characters
    on the glyph (defaults to the title's first letter). All marks sit in one group named
    "Trader's Agent", so `clear` only removes the agent's own. Marks are data, not drawings: they
    clear when the symbol or timeframe changes.
    """
    fields: dict = {"op": op}
    if time:
        fields["time"] = time
    if bars_ago >= 0:
        fields["bars_ago"] = int(bars_ago)
    for name, val in (("title", title), ("content", content), ("color", color), ("shape", shape),
                      ("letter", letter), ("mark_id", id)):    # `id` is reserved by the command queue
        if val:
            fields[name] = val
    return _command("marks", **fields)


@mcp.tool(annotations=_ann("Console theme (light / dark)", read_only=False, destructive=False))
def chart_theme(theme: str = "") -> str:
    """Read or set the console's theme: 'light', 'dark', or '' to report what is worn now.

    Runs the same switch the operator's ◐ button runs, so the console palette, Vela's chrome and the
    chart's own colours all move together — a theme set from here cannot drift from one set by hand.
    The choice is stored and survives a reload.
    """
    fields = {}
    if str(theme or "").strip():
        fields["theme"] = str(theme).strip().lower()
    return _command("theme", **fields)


@mcp.tool(annotations=_ann("Reload every chart view", destructive=True))
def chart_reload() -> str:
    """Reload every attached console page so it picks up current frontend files.

    Marked once-per-view: a freshly reloaded page re-attaches first and would otherwise claim the
    follow-up reloads, leaving a stale frame stale. Use this after editing the console, not as a
    substitute for chart_remove_indicator / chart_clear.
    """
    return _command("reload", once_per_view=True)


@mcp.tool(annotations=_ann("Chart palette", destructive=False))
def chart_palette(try_apply: bool = False) -> str:
    """What colours the chart is actually wearing (background, candle up/down, console theme).

    A Vela theme *string* does not rewrite a renderer config that already holds explicit colours, so
    this reads the live config. `try_apply=True` also asserts the console's palette and reports what
    landed 300 ms later — read-only when False.
    """
    fields = {}
    if try_apply:
        fields["try"] = True
    return _command("palette", **fields)


@mcp.tool(annotations=_ann("Open the script catalogue in the drawer", destructive=False))
def chart_browse(family: str = "", show: bool = True) -> str:
    """Open the catalogue in the drawer — the one surface (the Library panel is deleted, 3 Oct).

    `family` narrows the catalogue to one family of the taxonomy ('trend', 'smc-ict', 'momentum', …);
    an empty `family` shows every row. The answer reports the rows the list actually holds, its
    family filter and whether the drawer is open; it never applies an indicator. Pass show=False to
    read without opening anything. To read one row's write-up, open its Details view with
    `trader-chart open <slug>` (CLI) — the write-up itself is in the row's `reading` field.
    """
    fields = {"show": bool(show)}
    # An explicit family narrows; an omitted one means "all families", not "leave the last filter".
    fields["family"] = family.strip()
    return _command("browse", **fields)


# ── LuxAlgo Library tools ───────────────────────────────────────────────────────────────────────
@mcp.tool(annotations=_ann("Search the LuxAlgo Library", read_only=True, open_world=True))
def library_search(query: str, kind: str = "", limit: int = 8) -> str:
    """Search the LuxAlgo Library (concepts and indicators). `kind` may be concept or indicator."""
    if not query.strip():
        return "✗ empty query"
    params = {"q": query.strip(), "limit": max(1, min(int(limit or 8), 25))}
    selected_kind = kind.strip().lower()
    if selected_kind:
        api_type = {"concept": "concepts", "concepts": "concepts",
                    "indicator": "indicators", "indicators": "indicators"}.get(selected_kind)
        if not api_type:
            return "✗ kind must be concept or indicator"
        params["type"] = api_type
    try:
        data = _call("/api/search?" + urllib.parse.urlencode(params), timeout=25.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    rows = data.get("results") or []
    if not rows:
        return f"no hits for {query!r}"
    out = [f"{len(rows)} hit(s) for {query!r}:"]
    for row in rows:
        label = row.get("title") or row.get("name") or row.get("slug")
        out.append(f"- [{row.get('type') or row.get('kind') or '?'}] {label} ({row.get('slug')})")
    return "\n".join(out)


@mcp.tool(annotations=_ann("Read one Library indicator", read_only=True, open_world=True))
def library_indicator(query: str, offset: int = 0) -> str:
    """One Library indicator by name or slug: what it is, its licence, and its Pine source.

    The source comes whole up to 60,000 characters. A longer one is cut AND SAID so (`… truncated: …`), with the `offset`
    to ask for next; never run or port a script that was reported truncated.
    """
    if not query.strip():
        return "✗ empty query"
    slug = query.strip()
    try:
        def search_first():
            found = _call("/api/search?" + urllib.parse.urlencode({"q": query.strip(), "type": "indicators", "limit": 1}),
                          timeout=25.0)
            rows = found.get("results") or []
            return rows[0].get("slug") if rows else None

        if " " in slug or slug.lower() != slug:  # a name, not a slug: resolve it first
            slug = search_first()
            if not slug:
                return f"✗ nothing in the Library matches {query!r}"
        try:
            meta = _call("/api/indicator?" + urllib.parse.urlencode({"slug": slug}), timeout=25.0)
        except RuntimeError:
            # A one-word lower-case name ("killzone") looks like a slug but may not be one: search before giving up.
            found_slug = search_first()
            if not found_slug or found_slug == slug:
                raise
            slug = found_slug
            meta = _call("/api/indicator?" + urllib.parse.urlencode({"slug": slug}), timeout=25.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    item = meta.get("indicator") or meta
    head = [f"# {item.get('title') or item.get('name') or slug} ({slug})"]
    if item.get("summary") or item.get("description"):
        head.append(str(item.get("summary") or item.get("description"))[:600])
    if item.get("license"):
        head.append(f"licence: {item['license']}")
    try:
        src = _call("/api/source?" + urllib.parse.urlencode({"slug": slug}), timeout=25.0)
        pine = src.get("source") or src.get("pine") or ""
        if pine:
            head.append("Pine source (LuxAlgo Library — CC BY-NC-SA 4.0, not redistributable):")
            head.append(_pine_slice(pine, offset))
        else:
            head.append("(no Pine source on this entry)")
    except RuntimeError as exc:
        head.append(f"(source unavailable: {exc})")
    return "\n\n".join(head)


@mcp.tool(annotations=_ann("Browse the LuxAlgo Library", read_only=True, open_world=True))
def library_list(family: str = "", text: str = "", concept: str = "", tier: str = "",
                 sort: str = "", direction: str = "", page: int = 0, page_size: int = 24) -> str:
    """Browse indicators with filters and paging, when a search box is not enough.

    `sort` is one of name/date/family, `direction` asc/desc, `page_size` up to 100. Answers with the
    same rows the console's own list shows, plus the family taxonomy so a caller can narrow down.
    """
    params: dict = {"page": max(0, int(page or 0)), "page_size": max(1, min(int(page_size or 24), 100))}
    for key, value in (("family", family), ("text", text), ("concept", concept),
                       ("tier", tier), ("sort", sort), ("direction", direction)):
        if str(value or "").strip():
            params[key] = str(value).strip()
    try:
        data = _call("/api/indicators?" + urllib.parse.urlencode(params), timeout=30.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    rows = data.get("indicators") or []
    if not rows:
        return f"no indicators match {params}"
    out = [f"{len(rows)} indicator(s) · page {data.get('page', params['page'])}"
           + (f" of {data.get('pages')}" if data.get("pages") else "")
           + (f" · family {data.get('family')}" if data.get("family") else "")]
    for row in rows:
        bits = [f"- {row.get('title') or row.get('name') or row.get('slug')} ({row.get('slug')})"]
        if row.get("family"):
            bits.append(f"  family: {row['family']}")
        if row.get("tier"):
            bits.append(f"  tier: {row['tier']}")
        out.append("\n".join(bits))
    if not data.get("family") and data.get("families"):
        out.append("families: " + ", ".join(map(str, data["families"])))
    return "\n".join(out)


@mcp.tool(annotations=_ann("Library families and concepts", read_only=True, open_world=True))
def library_taxonomy(what: str = "families") -> str:
    """The Library's own taxonomy: `families` (indicator families) or `concepts` (the concept graph).

    Read this before filtering with library_list, so a family name is the Library's, not a guess.
    """
    which = (what or "families").strip().lower()
    try:
        if which.startswith("concept"):
            data = _call("/api/concepts", timeout=30.0)
            rows = data.get("concepts") or []
            if not rows:
                return "no concepts returned"
            return "\n".join([f"{len(rows)} concept(s):"] +
                             [f"- {r.get('title') or r.get('name') or r.get('slug')} ({r.get('slug')})"
                              for r in rows])
        data = _call("/api/families", timeout=30.0)
        rows = data.get("families") or []
        if not rows:
            return "no families returned"
        out = [f"{len(rows)} family(ies):"]
        for row in rows:
            if isinstance(row, dict):
                out.append(f"- {row.get('name') or row.get('slug')} — {row.get('count') or '?'} indicator(s)")
            else:
                out.append(f"- {row}")
        return "\n".join(out)
    except RuntimeError as exc:
        return f"✗ {exc}"


@mcp.tool(annotations=_ann("One Library concept", read_only=True, open_world=True))
def library_concept(slug: str) -> str:
    """One Library concept by slug: what it means and which indicators implement it."""
    if not slug.strip():
        return "✗ empty slug"
    try:
        data = _call("/api/concept?" + urllib.parse.urlencode({"slug": slug.strip()}), timeout=30.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    item = data.get("concept") or data
    lines = [f"# {item.get('title') or item.get('name') or slug} ({slug.strip()})"]
    if item.get("summary") or item.get("description"):
        lines.append(str(item.get("summary") or item.get("description"))[:800])
    related = data.get("indicators") or item.get("indicators") or []
    if related:
        lines.append("indicators:")
        lines += [f"- {r.get('title') or r.get('slug')} ({r.get('slug')})" if isinstance(r, dict) else f"- {r}"
                  for r in related[:20]]
    if _more(20, len(related), "related indicator(s)"):
        lines.append(_more(20, len(related), "related indicator(s)"))
    return "\n".join(lines)


@mcp.tool(annotations=_ann("Library source by slug", read_only=True, open_world=True))
def library_source(slug: str, offset: int = 0) -> str:
    """The Pine source of one Library entry, by EXACT slug — no name resolution, no guessing.

    Same rule as library_indicator: LuxAlgo Library source is CC BY-NC-SA 4.0, fine to run locally,
    never to redistribute. A source over 60,000 characters is cut AND SAID so; pass `offset` for the rest.
    """
    if not slug.strip():
        return "✗ empty slug"
    try:
        data = _call("/api/source?" + urllib.parse.urlencode({"slug": slug.strip()}), timeout=30.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    pine = data.get("source") or data.get("pine") or ""
    if not pine:
        return f"✗ no source stored for {slug!r} — check the slug with library_search"
    return (f"# {slug.strip()} — {len(pine.splitlines())} line(s), {len(pine.strip())} characters\n"
            "Pine source (LuxAlgo Library — CC BY-NC-SA 4.0, not redistributable):\n" + _pine_slice(pine, offset))


@mcp.tool(annotations=_ann("LuxAlgo edge presets", read_only=True, open_world=True))
def edge_presets(category: str = "") -> str:
    """LuxAlgo's own measured edge presets, and the categories they come in."""
    params = {}
    if category.strip():
        params["category"] = category.strip()
    try:
        data = _call("/api/edge/presets" + ("?" + urllib.parse.urlencode(params) if params else ""),
                     timeout=40.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    rows = data.get("presets") or []
    out = [f"{data.get('count', len(rows))} preset(s)"
           + (f" in {data['category']}" if data.get("category") else "")]
    for row in rows[:30]:
        label = row.get("name") or row.get("id") or row
        out.append(f"- {label}")
    if _more(30, len(rows), "preset(s)"):
        out.append(_more(30, len(rows), "preset(s)"))
    if data.get("categories"):
        out.append("categories: " + ", ".join(map(str, data["categories"])))
    return "\n".join(out)


@mcp.tool(annotations=_ann("LuxAlgo edge report", read_only=True, open_world=True))
def edge_report(preset: str, symbol: str) -> str:
    """One preset's measured edge on one symbol — the numbers behind LuxAlgo's published stats."""
    if not preset.strip() or not symbol.strip():
        return "✗ both preset and symbol are required"
    try:
        data = _call("/api/edge/report?" + urllib.parse.urlencode(
            {"preset": preset.strip(), "symbol": symbol.strip().upper()}), timeout=60.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    report = data.get("report") or {}
    lines = [f"{preset} on {symbol.upper()}:"]
    for key, value in list(report.items())[:40]:
        if isinstance(value, (str, int, float, bool)) or value is None:
            lines.append(f"- {key}: {value}")
        elif isinstance(value, list):
            lines.append(f"- {key}: {len(value)} row(s)")
                # nested structures are summarised: the raw report can be large
    if _more(40, len(report), "field(s)"):
        lines.append(_more(40, len(report), "field(s)"))
    return "\n".join(lines) if len(lines) > 1 else f"no report fields came back for {preset} / {symbol}"


@mcp.tool(annotations=_ann("Edge report symbols", read_only=True, open_world=True))
def edge_symbols() -> str:
    """Which symbols the edge reports actually cover (ask before requesting one)."""
    try:
        data = _call("/api/edge/symbols", timeout=40.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    rows = data.get("symbols") or []
    head = f"{data.get('count', len(rows))} symbol(s)"
    if data.get("note"):
        head += f" · {data['note']}"
    more = _more(60, len(rows), "symbol(s)")
    return head + "\n" + ", ".join(map(str, rows[:60])) + (("\n" + more) if more else "")


# ── Edge Stats: LuxAlgo's open-source engine, run locally (console/backend/edgestats.py) ──────────────
# The hosted edge_* tools above read LuxAlgo's published BTC/ETH presets. These ask the ENGINE on this
# machine, over bars the operator downloaded — any question, any symbol they hold. Every answer carries
# its sample size and a 95% interval; below the engine's floors it gives counts and NO rate, and the
# tools repeat that rather than rounding it into a confident-sounding sentence.

def _edge(path: str, payload: dict | None = None, timeout: float = 60.0) -> dict:
    return _call("/api/edgestats" + path, payload, timeout=timeout)


@mcp.tool(annotations=_ann("Edge Stats status", read_only=True))
def edgestats_status() -> str:
    """Is the local Edge Stats engine installed, what data does it hold, and is a download running?

    Call this first. It never starts the engine or a download. When nothing is stored yet it says how
    to begin (`edgestats_setup`).
    """
    try:
        return edge_text.format_status(_edge("/status", timeout=15.0))
    except RuntimeError as exc:
        return f"✗ {exc}"


@mcp.tool(annotations=_ann("Edge Stats query language", read_only=True))
def edgestats_fields(kind: str = "", search: str = "", limit: int = 40) -> str:
    """The query language's vocabulary: every outcome, condition (predicate) and field, with definitions.

    A question is `OUTCOME [WHERE condition [AND condition ...]]`, e.g.
    `gapFill WHERE dayOfWeek = Tue AND gapPct BETWEEN 0.2% AND 0.6% AND NOT eventDay('FOMC')`.
    `kind` is outcome | predicate | field; `search` filters by name or definition. A name that is not
    here does not exist — the engine answers a typo with the nearest real name.
    """
    try:
        data = _edge("/registry", timeout=60.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    return edge_text.format_fields(data.get("entries") or [], kind, search, max(1, min(int(limit or 40), 100)))


@mcp.tool(annotations=_ann("Edge Stats reports", read_only=True))
def edgestats_presets(category: str = "") -> str:
    """The report catalogue (42 ready-made questions: gap fill, opening-range break, weekday effects, …).

    Each line is `id [category] title — params`. Run one with `edgestats_report`.
    """
    try:
        data = _edge("/presets", timeout=60.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    return edge_text.format_presets(data.get("presets") or [], category)


@mcp.tool(annotations=_ann("Ask Edge Stats a question", read_only=True))
def edgestats_query(query: str, symbol: str, since: str = "", until: str = "", group_by: str = "",
                    sessions: int = 8, session: str = "") -> str:
    """P(outcome | conditions) on the operator's own bars — with N and a 95% confidence interval.

    `query` is the engine's language: `gapFill WHERE dayOfWeek = Tue`, `orbBreak(15m, up) WHERE gapDir = up`,
    `closeGreen WHERE streak(red, 3)`. Use `edgestats_fields` for names. `symbol` must be one the store
    holds (see `edgestats_status`). `since`/`until` are ISO dates. `group_by` splits the answer by a
    categorical field (dayOfWeek, month, year, gapBucket, gapDir, a yes/no condition …). `session`
    overrides the session window (rth, utc, london, globex …).

    READ THE GUARDS before you quote a number: below 10 sessions the engine gives NO estimate; below 30
    it is a LOW SAMPLE; the first-half/second-half split says whether it held up over time. These are
    historical frequencies, not predictions — say so when you report them.
    """
    body: dict = {"dsl": query, "symbol": symbol, "sessionsLimit": max(0, min(int(sessions or 0), 50))}
    for key, value in (("since", since), ("until", until), ("groupBy", group_by), ("sessionKey", session)):
        if value:
            body[key] = value
    try:
        env = _edge("/query", body, timeout=90.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    return edge_text.format_result(env, sessions=body["sessionsLimit"], group_by=group_by)


@mcp.tool(annotations=_ann("Run an Edge Stats report", read_only=True))
def edgestats_report(preset: str, symbol: str, params: dict | None = None, since: str = "", until: str = "",
                     group_by: str = "", sessions: int = 8, session: str = "") -> str:
    """Run one catalogue report (see `edgestats_presets`) on one symbol.

    `params` fills the report's parameters, e.g. `{"window": 15, "dir": "up"}` for the opening-range
    report; omit a parameter to use its default. Same guards and same honesty as `edgestats_query`.
    """
    body: dict = {"presetId": preset, "symbol": symbol, "sessionsLimit": max(0, min(int(sessions or 0), 50))}
    if params:
        body["params"] = params
    for key, value in (("since", since), ("until", until), ("groupBy", group_by), ("sessionKey", session)):
        if value:
            body[key] = value
    try:
        env = _edge("/preset", body, timeout=90.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    meta = env.get("preset") or {}
    return edge_text.format_result(env, sessions=body["sessionsLimit"], group_by=group_by,
                                   title=f"{meta.get('title') or preset} (report)")


@mcp.tool(annotations=_ann("One Edge Stats session", read_only=True))
def edgestats_session(session_id: str) -> str:
    """One historical session behind a result: its OHLC, the prior session's levels, the gap, the
    opening ranges and when events happened. `session_id` is `SYMBOL|session|DATE`
    (e.g. `BTCUSDT|utc|2026-03-11`) — build it from the dates `edgestats_query` lists. To SEE the bars
    with the levels drawn on them, use `edgestats_show(op='session', session=...)`.
    """
    try:
        view = _edge("/session?id=" + urllib.parse.quote(session_id, safe="") + "&context=0", timeout=60.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    return edge_text.format_session(view)


@mcp.tool(annotations=_ann("Show Edge Stats in the pane", read_only=False, destructive=False))
def edgestats_show(op: str = "open", query: str = "", preset: str = "", session: str = "", symbol: str = "",
                   since: str = "", until: str = "", group_by: str = "", params: dict | None = None) -> str:
    """Put an answer on the operator's screen — the Edge Stats sheet over the chart.

    `op`: open | ask (needs `query`) | report (needs `preset`, optional `params`) | session (needs
    `session` = SYMBOL|session|DATE) | data (the download view) | close | state. This only SHOWS: ask the
    numbers with `edgestats_query` first, then show the same question so the operator sees what you saw.
    Nothing here changes the chart's studies or drawings.
    """
    fields: dict = {"op": op}
    for key, value in (("dsl", query if op == "ask" else ""), ("preset", preset), ("session", session), ("symbol", symbol),
                       ("since", since), ("until", until), ("group_by", group_by)):
        if value:
            fields[key] = value
    if params:
        fields["params"] = params
    return _command("edge", **fields)


@mcp.tool(annotations=_ann("Download data for Edge Stats", read_only=False, destructive=False, open_world=True))
def edgestats_setup(source: str = "", symbol: str = "", years: float = 0, archive_only: bool = False,
                    cancel: bool = False) -> str:
    """Load or download the bars Edge Stats measures. Runs in the background; poll `edgestats_status`.

    `source`: `demo` (synthetic DEMO_STK / DEMO_FUT, about 10 s — the quickest way to try everything),
    `binance` (free, keyless crypto 1-minute history; `symbol` like BTCUSDT) or `dukascopy` (free, keyless
    forex / metals / indices: EURUSD, XAUUSD, US500 …; slow the first time). `years` is how far back
    (default 3 for Binance, 1 for Dukascopy, max 15). With no `source`, every symbol already stored is
    brought up to date. `cancel=true` stops a running job. `archive_only` skips Binance's live API (for
    regions where it is blocked).

    Ask the operator before starting a REAL download: it uses their disk (hundreds of MB for years of
    1-minute bars), their bandwidth and several minutes. While a job runs, questions answer "busy".
    """
    try:
        if cancel:
            return edge_text.format_job(_edge("/cancel", {}, timeout=15.0))
        body: dict = {}
        if source:
            body["source"] = source
        if symbol:
            body["symbol"] = symbol
        if years:
            body["years"] = years
        if archive_only:
            body["archive_only"] = True
        return edge_text.format_job(_edge("/setup", body, timeout=30.0))
    except RuntimeError as exc:
        return f"✗ {exc}"


@mcp.tool(annotations=_ann("Prop-firm directory", read_only=True, open_world=True))
def propfirms(query: str = "") -> str:
    """Prop firms and their current offers, with an optional filter."""
    params = {"q": query.strip()} if query.strip() else {}
    try:
        data = _call("/api/propfirms" + ("?" + urllib.parse.urlencode(params) if params else ""),
                     timeout=40.0)
        firms = data.get("firms") or data.get("propfirms") or []
    except RuntimeError as exc:
        return f"✗ {exc}"
    out = [f"{len(firms)} firm(s)" + (f" matching {query!r}" if query.strip() else "")]
    for row in firms[:30]:
        if isinstance(row, dict):
            name = row.get("name") or row.get("slug")
            extra = [str(row[k]) for k in ("max_funding", "profit_split", "platform") if row.get(k)]
            out.append(f"- {name}" + (f" — {', '.join(extra)}" if extra else ""))
        else:
            out.append(f"- {row}")
    if _more(30, len(firms), "firm(s)"):
        out.append(_more(30, len(firms), "firm(s)"))
    return "\n".join(out)


@mcp.tool(annotations=_ann("Prop-firm offers", read_only=True, open_world=True))
def propfirm_offers(query: str = "") -> str:
    """Current prop-firm offers (discounts, price changes) from LuxAlgo's own tracker."""
    params = {"q": query.strip()} if query.strip() else {}
    try:
        data = _call("/api/offers" + ("?" + urllib.parse.urlencode(params) if params else ""),
                     timeout=40.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    rows = data.get("offers") or []
    out = [f"{len(rows)} offer(s)" + (f" matching {query!r}" if query.strip() else "")]
    for row in rows[:30]:
        if isinstance(row, dict):
            out.append("- " + " · ".join(str(v) for v in (
                row.get("firm") or row.get("name"), row.get("promo") or row.get("title"),
                row.get("discount") or row.get("price"), row.get("ends") or row.get("expires")) if v))
        else:
            out.append(f"- {row}")
    if _more(30, len(rows), "offer(s)"):
        out.append(_more(30, len(rows), "offer(s)"))
    return "\n".join(out)


# ── chart tools that own more than one round trip ────────────────────────────────────────────────
_SNAPSHOT: dict = {}          # the last state + natives we saw, for chart_undo


def _live_market(timeout_s: float = 6.0) -> dict:
    """Read the market from the CHART, not from the heartbeat.

    `/api/chart/state` is a heartbeat the page republishes every 4 s (STATE_EVERY in the console's
    chart-bridge.js). Reading it right after a command therefore returns the state from BEFORE that
    command, which is how chart_watch reported "SOLUSDT 1h" for a chart that a batch had just switched
    to ETHUSDT — a plausible, wrong answer, which is the worst kind.

    A bare `market` command (no symbol) is a no-op the page answers with its own present market in
    ~100 ms, so that is the live reading. Measured: `symbol ETHUSDT · timeframe 1h · last 2723.93`
    came back from a page whose heartbeat still said SOLUSDT. Returns {} when no view answered, and
    the caller falls back to the heartbeat.
    """
    answer = _command("market", wait=timeout_s)
    fields = {}
    for line in str(answer or "").splitlines():
        if "switched to " in line:
            piece = line.split("switched to ", 1)[1].strip()
            parts = piece.split(" · ")[0].split()
            if parts:
                fields["symbol"] = parts[0]
            if len(parts) > 1:
                fields["timeframe"] = parts[1]
    return fields


def _natives(live: bool = False) -> list:
    """The indicator list the CHART reports (never our own record of what we asked for).

    Read from the heartbeat, which is the only door that carries the indicator list: the live `market`
    probe answers with the market and price but reports `natives: null`, and `probe` answers with a
    dump of the page's method handles. Measuring that cost a cycle — an earlier version of this
    function parsed the `probe` dump looking for a natives line that was never there, silently fell
    through, and looked like it worked because the heartbeat agreed.

    `live=True` is kept for callers that have just issued a command and want the listing the command
    itself reported; it is not a substitute for a heartbeat read.
    """
    if live:
        answer = _command("market", wait=6.0)
        for line in str(answer or "").splitlines():
            if "natives" in line.lower():
                _, _, rest = line.partition(":")
                names = [n.strip() for n in rest.split(",") if n.strip() and n.strip() != "none"]
                if names or "none" in rest.lower():
                    return names
    try:
        state = _call("/api/chart/state", timeout=5.0)
    except RuntimeError:
        return []
    return [str(n) for n in (state.get("natives") or []) if str(n).strip()]


@mcp.tool(annotations=_ann("Run several chart commands", destructive=True))
def chart_batch(commands: str | list[dict[str, Any]], stop_on_error: bool = True) -> str:
    """Run several chart actions in ONE call, in order.

    `commands` is JSON: a list of objects, each `{"action": "market", "symbol": "BTCUSDT",
    "timeframe": "1h"}`. Allowed actions are the page's own (see chart_caps) — typically market,
    add, remove, clear, draw, apply, shot, reload. Every step's result is reported, and the run stops
    at the first failure unless stop_on_error=False. Use it for a sequence (switch market → add the
    study → capture) instead of one call per step.
    """
    try:
        steps = json.loads(commands) if isinstance(commands, str) else commands
    except ValueError as exc:
        return f"✗ commands is not valid JSON: {exc}"
    if isinstance(steps, dict):
        steps = [steps]
    if not isinstance(steps, list) or not steps:
        return "✗ give a JSON list of {action, ...} objects"
    lines = []
    for index, step in enumerate(steps, 1):
        if not isinstance(step, dict) or not step.get("action"):
            lines.append(f"{index}. ✗ every step needs an action")
            if stop_on_error:
                break
            continue
        action = str(step["action"]).strip()
        fields = {k: v for k, v in step.items() if k != "action"}
        answer = _command(action, **fields)
        lines.append(f"{index}. {action} → {answer}")
        if stop_on_error and answer.lstrip().startswith("✗"):
            lines.append(f"stopped at step {index} (stop_on_error)")
            break
        if stop_on_error and "\n✗ " in answer:
            lines.append(f"stopped at step {index} (stop_on_error)")
            break
    return "\n".join(lines)


@mcp.tool(annotations=_ann("Remember the chart's state", destructive=False))
def chart_snapshot() -> str:
    """Remember the chart's indicators plus its symbol/timeframe as a restore point for chart_undo.

    The market is read live rather than from the 4 s heartbeat, so a snapshot taken straight after a
    command records what that command produced. Reading the heartbeat here once stored the market from
    BEFORE a switch, and chart_undo then "restored" the chart to a market it was never on.
    """
    try:
        state = _call("/api/chart/state", timeout=5.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    if not state.get("open"):
        return f"✗ no chart open — {state.get('reason') or 'the console page is not mounted'}"
    live = _live_market()
    if live:
        state = dict(state)
        state.update({k: v for k, v in live.items() if v})
    _SNAPSHOT.clear()
    _SNAPSHOT.update({"symbol": state.get("symbol"), "timeframe": state.get("timeframe"),
                      "natives": [str(n) for n in (state.get("natives") or [])]})
    natives = ", ".join(_SNAPSHOT["natives"]) or "none"
    return (f"✓ remembered {_SNAPSHOT['symbol']} {_SNAPSHOT['timeframe']} with: {natives}\n"
            "  chart_undo puts the chart back to this.")


@mcp.tool(annotations=_ann("Restore the remembered chart", destructive=True))
def chart_undo() -> str:
    """Put the chart back to the last chart_snapshot: market first, then the indicator set.

    Reports the before → after lists from the chart itself, so a restore that did not land is visible.
    Drawings are not restored — use chart_clear, then re-draw.
    """
    if not _SNAPSHOT:
        return "✗ nothing remembered yet — call chart_snapshot first"
    before = _natives()
    lines = []
    try:
        state = _call("/api/chart/state", timeout=5.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    if str(state.get("symbol") or "").upper() != str(_SNAPSHOT.get("symbol") or "").upper() or \
            str(state.get("timeframe") or "") != str(_SNAPSHOT.get("timeframe") or ""):
        lines.append("market → " + _command("market", symbol=str(_SNAPSHOT["symbol"]),
                                            timeframe=str(_SNAPSHOT["timeframe"])))
    want = list(_SNAPSHOT.get("natives") or [])
    for native in [n for n in before if n not in want]:
        lines.append(f"remove {native} → " + _command("remove", native=native))
    for native in [n for n in want if n not in before]:
        lines.append(f"add {native} → " + _command("add", native=native))
    after = _natives()
    verb = "✓" if sorted(after) == sorted(want) else "⚠"
    return (f"{verb} undo: {before} → {after} (wanted {want})\n" + "\n".join(lines))


@mcp.tool(annotations=_ann("Wait for the chart to change", read_only=True))
def chart_watch(seconds: int = 15, timeout_s: int = 0) -> str:
    """Watch the chart for `seconds` and report what actually changed.

    Compares the chart's own fields (symbol, timeframe, last price, bars, indicators, drawings)
    between two reads, so the answer is a diff rather than a second snapshot. `seconds` defaults to
    15 and is capped at 120. Set timeout_s to wait no longer than that for the FIRST change.

    The market is read live (the page answers a bare `market` probe in ~100 ms) rather than from the
    4 s heartbeat, so the diff cannot describe the moment before a switch that just happened — that
    is how this tool once reported SOLUSDT for a chart a batch had already moved to ETHUSDT.
    """
    span = max(1, min(int(seconds or 15), 120))
    try:
        first = _call("/api/chart/state", timeout=5.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    if not first.get("open"):
        return f"✗ no chart open — {first.get('reason') or 'the console page is not mounted'}"

    live = _live_market()
    if live:
        first = dict(first)
        first.update({k: v for k, v in live.items() if v})

    def face(state):
        return {"symbol": state.get("symbol"), "timeframe": state.get("timeframe"),
                "last": state.get("last"), "bars": state.get("bars"),
                "natives": [str(n) for n in (state.get("natives") or [])],
                "drawings": state.get("drawings"), "series": state.get("series")}

    start = face(first)
    deadline = time.time() + span
    changed = None
    while time.time() < deadline:
        time.sleep(1.5)
        try:
            now = _call("/api/chart/state", timeout=5.0)
        except RuntimeError:
            continue
        live_now = _live_market()
        if live_now:
            now = dict(now)
            now.update({k: v for k, v in live_now.items() if v})
        diff = {k: (start[k], now.get(k)) for k in start if start[k] != now.get(k)}
        if diff:
            changed = (diff, now)
            if not timeout_s:
                break
    if not changed:
        return (f"no change in {span}s — still {start['symbol']} {start['timeframe']} · "
                f"last {start['last']} · indicators {', '.join(start['natives']) or 'none'}")
    diff, now = changed
    lines = [f"changed within {span}s:"]
    for key, (old, new) in diff.items():
        if isinstance(old, list):
            old, new = ", ".join(map(str, old)) or "none", ", ".join(map(str, new or [])) or "none"
        lines.append(f"- {key}: {old} → {new}")
    lines.append(f"now: {now.get('symbol')} {now.get('timeframe')} · last {now.get('last')}")
    return "\n".join(lines)


@mcp.tool(annotations=_ann("Watch the market and say when it moves", read_only=True))
def chart_alert(seconds: int = 30, move_pct: float = 0.0, timeout_s: int = 0) -> str:
    """Wait for the MARKET to move, and report the move — price, and how far it went.

    `chart_watch` answers "did the chart change" (a study was added, the symbol switched). This
    answers the question a trader actually asks: "tell me if price does something". It samples the
    last price and reports when it has moved at least `move_pct` percent from the first reading —
    0 means any change at all, which is useful on a quiet timeframe but noisy on a live one.

    `seconds` caps how long to listen (default 30, max 300) and `timeout_s` caps the wait for the
    FIRST qualifying move. Reuses the heartbeat's own `last` price, so the number reported is the
    same one `chart_state` shows rather than a second, possibly disagreeing source.
    """
    span = max(1, min(int(seconds or 30), 300))
    try:
        threshold = abs(float(move_pct or 0.0))
    except (TypeError, ValueError):
        return f"✗ move_pct must be a number, got {move_pct!r}"
    if threshold >= 100:
        return f"✗ move_pct is a percentage of price (e.g. 0.25 for a quarter of one percent), got {threshold}"

    try:
        first = _call("/api/chart/state", timeout=5.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    if not first.get("open"):
        return f"✗ no chart open — {first.get('reason') or 'the console page is not mounted'}"

    start_price = first.get("last")
    if not isinstance(start_price, (int, float)) or start_price <= 0:
        return (f"✗ the page reported no usable price (last={start_price!r}) — this chart's feed may "
                f"not have delivered a bar yet")

    symbol, timeframe = first.get("symbol"), first.get("timeframe")
    needed = abs(start_price) * threshold / 100.0
    best = 0.0
    deadline = time.time() + span
    while time.time() < deadline:
        time.sleep(1.5)
        try:
            now = _call("/api/chart/state", timeout=5.0)
        except RuntimeError:
            continue
        price = now.get("last")
        if not isinstance(price, (int, float)):
            continue
        delta = float(price) - float(start_price)
        if abs(delta) > abs(best):
            best = delta
        if abs(delta) >= needed and abs(delta) > 0:
            pct = delta / float(start_price) * 100.0
            direction = "up" if delta > 0 else "down"
            warn = _freshness(now.get("age_s"))
            stale = " (from a stale reading — see below)" if warn else ""
            return (f"{symbol} {timeframe} moved {direction} {abs(pct):.3f}%{stale}\n"
                    f"  {start_price} → {price} ({delta:+.6g})\n"
                    f"  watched {span}s, threshold {threshold}%" + warn +
                    (f"\n  note: the market also switched to {now.get('symbol')} "
                     f"{now.get('timeframe')} while watching" if now.get("symbol") != symbol else ""))

    pct = best / float(start_price) * 100.0 if start_price else 0.0
    return (f"no qualifying move in {span}s — {symbol} {timeframe} still near {start_price}\n"
            f"  largest excursion seen: {best:+.6g} ({pct:+.3f}%), needed {threshold}%")


if __name__ == "__main__":
    mcp.run()
