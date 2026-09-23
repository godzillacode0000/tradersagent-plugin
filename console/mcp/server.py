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

# The staleness guard lives in its own module so the stdlib-only suite can test it — this file cannot
# be imported without fastmcp, and a guard that only runs when a dependency is present is not a guard.
try:
    from freshness import DEAD_AFTER_S, STALE_AFTER_S, _freshness
except ImportError:  # pragma: no cover - running as a path, not a package
    import sys as _sys

    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from freshness import DEAD_AFTER_S, STALE_AFTER_S, _freshness

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
    lines = [
        f"{state.get('symbol')} · {state.get('timeframe')} · last {state.get('last')}",
        f"bars {state.get('bars')} · series {state.get('series')} · drawings {state.get('drawings')}",
        f"indicators on the chart: {', '.join(state.get('natives') or []) or 'none'}",
        f"heartbeat {state.get('age_s')}s ago" + (f" · picture: {state['shot']}" if state.get("shot") else ""),
    ]
    if state.get("build") or state.get("viewer"):
        lines.append(f"build {state.get('build') or '—'} · viewer {state.get('viewer') or '—'}")
    # A stale chart is the one failure an agent cannot see for itself: the values below look perfectly
    # plausible whether they were measured a second ago or an hour ago. Say so in words.
    warning = _freshness(state.get("age_s"))
    if warning:
        lines.append(warning.lstrip("\n"))
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
    """Run Pine source over the chart's live bars (LuxAlgo PineTS) and paint what it makes.

    One landasan for every door (chat, script pane, Library): geometry (boxes/lines/labels/tables)
    lands on the console's overlay and is read back after drawing; plot series lands as a matching
    Vela native — only when the script actually plots. PineTS implements a subset: `import`, `while`
    and `for…in` are not available — the answer says so rather than pretending. Sizes it can do:
    studies with plot/hline/fill/bgcolor and simple ta.* calls.
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
    """Switch the chart to another symbol/timeframe (e.g. BTCUSDT, 1h).

    The answer includes last price and bar count from the chart after the switch — do not follow up
    with chart_state just to confirm.
    """
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
    return "\n".join(lines)


@mcp.tool(annotations=_ann("Library source by slug", read_only=True, open_world=True))
def library_source(slug: str) -> str:
    """The Pine source of one Library entry, by EXACT slug — no name resolution, no guessing.

    Same rule as library_indicator: LuxAlgo Library source is CC BY-NC-SA 4.0, fine to run locally,
    never to redistribute.
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
    return (f"# {slug.strip()} — {len(pine.splitlines())} line(s)\n"
            "Pine source (LuxAlgo Library — CC BY-NC-SA 4.0, not redistributable):\n"
            "```pine\n" + pine.strip()[:8000] + "\n```")


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
    for key, value in list(report.items())[:20]:
        if isinstance(value, (str, int, float, bool)) or value is None:
            lines.append(f"- {key}: {value}")
        elif isinstance(value, list):
            lines.append(f"- {key}: {len(value)} row(s)")
                # nested structures are summarised: the raw report can be large
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
    return head + "\n" + ", ".join(map(str, rows[:60]))


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
def chart_batch(commands: str, stop_on_error: bool = True) -> str:
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


@mcp.tool(annotations=_ann("Remember the chart's state"))
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
