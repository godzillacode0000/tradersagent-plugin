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
import os
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request

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
def _call(path: str, payload: dict | None = None, timeout: float = 20.0) -> dict:
    """One console request. Returns the unwrapped `data`, or raises RuntimeError with the console's
    own message — the tools below turn that into a sentence rather than a traceback."""
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"content-type": "application/json"} if payload is not None else {},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"the console is not answering at {BASE} ({exc.reason}) — is the console running? "
            f"(console/start.sh, or the traders-agent systemd unit)"
        ) from exc
    except ValueError as exc:
        raise RuntimeError(f"the console sent something unreadable: {exc}") from exc
    if not body.get("ok", False):
        raise RuntimeError(f"console refused: {body.get('error') or body}")
    return body.get("data") or {}


def _command(action: str, timeout: float = INLINE_WAIT + 8.0, **fields) -> str:
    """Queue one chart command and wait for the page's answer (push channel → same round trip)."""
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
    mark = "✓" if result.get("ok") else "✗"
    line = f"{mark} {result.get('detail') or 'no detail'}{ms}"
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


# ── chart tools ─────────────────────────────────────────────────────────────────────────────────
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
            f"  reported {state.get('age_s')}s ago · {state.get('symbol')} {state.get('timeframe')}")


@mcp.tool(annotations=_ann("Chart state", read_only=True))
def chart_state() -> str:
    """What the live chart is showing: symbol, timeframe, last price, bars and the indicators on it."""
    try:
        state = _call("/api/chart/state", timeout=5.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
    if not state.get("open"):
        return f"✗ no chart open — {state.get('reason') or 'the console page is not mounted'}"
    lines = [
        f"{state.get('symbol')} · {state.get('timeframe')} · last {state.get('last')}",
        f"bars {state.get('bars')} · series {state.get('series')} · drawings {state.get('drawings')}",
        f"indicators on the chart: {', '.join(state.get('natives') or []) or 'none'}",
        f"heartbeat {state.get('age_s')}s ago" + (f" · picture: {state['shot']}" if state.get("shot") else ""),
    ]
    if state.get("build") or state.get("viewer"):
        lines.append(f"build {state.get('build') or '—'} · viewer {state.get('viewer') or '—'}")
    return "\n".join(lines)


@mcp.tool(annotations=_ann("Capture the chart", read_only=True))
def chart_shot(name: str = ""):
    """Capture the chart as a PNG. Returns the image (when the client takes images) and its path."""
    try:
        queued = _call("/api/chart/command", {"action": "shot", "wait": INLINE_WAIT + 10.0},
                       timeout=INLINE_WAIT + 14.0)
    except RuntimeError as exc:
        return f"✗ {exc}"
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
    if MCPImage is None:
        return text
    return [text, MCPImage(path=path)]


@mcp.tool(annotations=_ann("Run Pine on the chart", destructive=True))
def chart_apply_pine(pine: str) -> str:
    """Run Pine source over the chart's live bars (LuxAlgo PineTS) and paint a matching native.

    PineTS implements a subset: `import`, `while` and `for…in` are not available — the answer says so
    rather than pretending. Sizes it can do: studies with plot/hline/fill/bgcolor and simple ta.* calls.
    """
    if not pine.strip():
        return "✗ no Pine source given"
    return _command("apply", pine=pine)


@mcp.tool(annotations=_ann("Draw a script's levels", destructive=True))
def chart_draw(pine: str) -> str:
    """Run Pine source and paint the geometry it BUILDS — boxes, lines and labels — on the chart.

    Use this for the scripts that compute levels instead of plotting a line (most Smart-Money /
    liquidity models): the console runs them and paints their objects on its own overlay, because
    the charting engine has no drawing surface of its own.
    """
    return _command("draw", pine=pine)


@mcp.tool(annotations=_ann("Clear drawings and painted indicators", destructive=True))
def chart_clear() -> str:
    """Clear the overlay drawings and remove the Vela indicators our paint layer added.

    Reports what is left on the chart afterwards, so a silent no-op is visible.
    """
    return _command("clear")


@mcp.tool(annotations=_ann("Add a Vela indicator", destructive=True))
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
    """Switch the chart to another symbol/timeframe (e.g. BTCUSDT, 1h)."""
    if not symbol.strip() or not timeframe.strip():
        return "✗ both symbol and timeframe are required"
    return _command("market", symbol=symbol.strip().upper(), timeframe=timeframe.strip())


@mcp.tool(annotations=_ann("Reload every chart view", destructive=True))
def chart_reload() -> str:
    """Reload every attached console page so it picks up current frontend files.

    Marked once-per-view: a freshly reloaded page re-attaches first and would otherwise claim the
    follow-up reloads, leaving a stale frame stale. Use this after editing the console, not as a
    substitute for chart_remove_indicator / chart_clear.
    """
    return _command("reload", once_per_view=True)


@mcp.tool(annotations=_ann("Chart palette"))
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


# ── LuxAlgo Library tools ───────────────────────────────────────────────────────────────────────
@mcp.tool(annotations=_ann("Search the LuxAlgo Library", read_only=True, open_world=True))
def library_search(query: str, kind: str = "", limit: int = 8) -> str:
    """Search the LuxAlgo Library (concepts and indicators). `kind` may be concept or indicator."""
    if not query.strip():
        return "✗ empty query"
    params = {"q": query.strip(), "limit": max(1, min(int(limit or 8), 25))}
    if kind.strip():
        params["type"] = kind.strip()
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
def library_indicator(query: str) -> str:
    """One Library indicator by name or slug: what it is, its licence, and its full Pine source."""
    if not query.strip():
        return "✗ empty query"
    slug = query.strip()
    try:
        if " " in slug or slug.lower() != slug.lower():  # a name, not a slug: resolve it first
            found = _call("/api/search?" + urllib.parse.urlencode({"q": slug, "type": "indicator", "limit": 1}),
                          timeout=25.0)
            rows = found.get("results") or []
            if not rows:
                return f"✗ nothing in the Library matches {query!r}"
            slug = rows[0].get("slug") or slug
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
            head.append("```pine\n" + pine.strip()[:6000] + "\n```")
        else:
            head.append("(no Pine source on this entry)")
    except RuntimeError as exc:
        head.append(f"(source unavailable: {exc})")
    return "\n\n".join(head)


if __name__ == "__main__":
    mcp.run()
