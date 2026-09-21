#!/usr/bin/env python3
"""
LuxAlgo Web — single-file backend.

A zero-dependency *application* HTTP server (Python 3.11 stdlib only for HTTP,
static serving, caching and JSON) that holds ONE reusable MCP session against
the LuxAlgo hosted MCP server and marshals HTTP requests into it.

It also serves the static frontend directory, so the browser can load ES
modules from the same origin as the API.

Run:
    python3 server.py --port 8787 --frontend ../frontend

The only non-stdlib import is the `mcp` client package. It is normally found through the Hermes venv;
set HERMES_PYTHON to point elsewhere.

Design notes
------------
* One asyncio event loop lives in a daemon background thread and owns the MCP
  session for the whole process lifetime. HTTP handler threads never touch
  asyncio directly: they enqueue (tool, args) onto an asyncio.Queue owned by the
  loop task and wait on a concurrent.futures.Future. That keeps a single owner
  task for the session (no cross-task anyio task-group weirdness) and
  serialises upstream calls, which is also polite to the remote server.
* If a call raises (transport error, closed stream, timeout) the session is
  treated as poisoned: pending callers get the error and the loop reconnects
  with a 2s backoff. Tool-level errors (e.g. "Unknown concept slug") come back
  as normal content, not exceptions, so they do NOT trigger a reconnect.
* Every endpoint is wrapped in a small in-process TTL cache (500ms-2s) keyed on
  the fully-resolved upstream arguments, so repeated UI polling does not hammer
  the remote MCP server. Errors are never cached.
"""

from __future__ import annotations

import argparse
import asyncio
import concurrent.futures
import json
import os
import re
import socketserver
import sys
import threading
import time
import traceback
from collections import OrderedDict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

SERVER_VERSION = "1.0.0"
DEFAULT_MCP_URL = "https://mcp.luxalgo.com/mcp"

# --------------------------------------------------------------------------
# Study agents — the Trader's Agent dock's brain (see agents_store.py, chat.py)
# --------------------------------------------------------------------------
from agents_store import (list_studies, load as load_study, upsert as upsert_study,
                          delete as delete_study, set_session, record_run,
                          append_learning, learnings_tail, save_shot)
from chat import run_agent
from chart_bridge import (save_state as save_chart_state, load_state as load_chart_state,
                          enqueue as enqueue_chart_command,
                          commands_since as chart_commands_since,
                          record_result as record_chart_result, get_result as get_chart_result)
from chart_stream import ChartStream

# The push channel: chart views attach to /api/chart/stream and commands are pushed down it, so an
# agent command no longer waits for the page's 2s poll (see chart_stream.py).
STREAM = ChartStream()
CHART_INLINE_WAIT_MAX = 30.0

AGENTS_ROOT = os.path.abspath(os.environ.get(
    "LUXALGO_AGENTS_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "agents")))
CHAT_CLI = os.environ.get("HERMES_CLI") or os.path.expanduser(
    "~/.hermes/hermes-agent/venv/bin/hermes")
DEFAULT_PORT = 8787
DEFAULT_HOST = "127.0.0.1"
DEFAULT_FRONTEND = "../frontend"

MCP_CALL_TIMEOUT = 90.0      # seconds, per upstream tool call
MCP_CONNECT_WAIT = 60.0      # seconds to wait for the first session at startup
CACHE_MAX_ENTRIES = 256

FAMILIES = [
    "trend", "momentum", "volatility", "volume-orderflow", "market-structure",
    "smc-ict", "wyckoff", "elliott-harmonics", "patterns", "levels",
    "statistics", "machine-learning", "time-seasonality", "sentiment-breadth",
    "risk-exits", "meta-composition", "validation",
]

# Every LuxAlgo tool requires a `context` string: 15-25 words, third person,
# describing ONLY the abstract purpose, with no user data ever interpolated in.
CONTEXT = {
    "search": "Searching a trading knowledge library to find concepts and indicator implementations matching a browsing user query.",
    "indicators": "Listing indicator entries from a trading knowledge library to display a browsable catalog for a user.",
    "indicator": "Retrieving indicator metadata and explanatory notes from a trading library to display details for a user.",
    "source": "Retrieving an indicator's published source code from a trading library to display it for a studying user.",
    "concept": "Retrieving a trading concept explanation from a knowledge library to display reference material for a user.",
    "families": "Listing the top level concept families of a trading knowledge library to build a navigation menu.",
    "concepts": "Listing trading concepts from a knowledge library to populate a browsable category listing for a user.",
    "edge_presets": "Listing available session statistics presets from a market data service to populate a selection menu.",
    "edge_report": "Retrieving a precomputed session statistics report to display historical conditional frequency results for a user.",
    "edge_symbols": "Listing the symbols covered by a hosted session statistics store to populate a selection menu.",
    "propfirms": "Listing simulatable proprietary trading firms and challenges to display a comparison directory for a browsing user.",
    "offers": "Listing current promotional offers from proprietary trading firms to display available discounts for a browsing user.",
}

# --------------------------------------------------------------------------
# MCP client import (defensive across mcp versions)
# --------------------------------------------------------------------------

MCP_IMPORT_ERROR: str | None = None
try:
    from mcp import ClientSession as _ClientSession

    try:  # mcp >= 1.24
        from mcp.client.streamable_http import (
            streamable_http_client as _streamable_http_client,
        )
    except ImportError:  # older alias
        from mcp.client.streamable_http import (
            streamablehttp_client as _streamable_http_client,
        )
except Exception as _exc:  # pragma: no cover - environment problem
    _ClientSession = None
    _streamable_http_client = None
    MCP_IMPORT_ERROR = f"{type(_exc).__name__}: {_exc}"


def log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    sys.stderr.write(f"[luxalgo-web {ts}] {msg}\n")
    sys.stderr.flush()


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------


class ApiError(Exception):
    """An error that maps to a specific HTTP status."""

    def __init__(self, message: str, status: int = 500, code: str = "internal_error", detail=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.detail = detail


class MCPUnavailable(ApiError):
    def __init__(self, message: str, detail=None):
        super().__init__(
            message or "MCP session is unavailable",
            status=HTTPStatus.SERVICE_UNAVAILABLE,
            code="mcp_unavailable",
            detail=detail,
        )


# --------------------------------------------------------------------------
# In-process TTL cache
# --------------------------------------------------------------------------


class TTLCache:
    """Tiny thread-safe LRU-ish TTL cache. Errors are never stored here."""

    def __init__(self, max_entries: int = CACHE_MAX_ENTRIES):
        self._data: OrderedDict = OrderedDict()
        self._lock = threading.Lock()
        self._max = max_entries
        self.hits = 0
        self.misses = 0

    def get(self, key):
        now = time.monotonic()
        with self._lock:
            item = self._data.get(key)
            if item is None:
                self.misses += 1
                return None
            expires, value = item
            if expires < now:
                del self._data[key]
                self.misses += 1
                return None
            self._data.move_to_end(key)
            self.hits += 1
            return value

    def set(self, key, value, ttl: float):
        if ttl <= 0:
            return
        with self._lock:
            self._data[key] = (time.monotonic() + ttl, value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def clear(self):
        with self._lock:
            self._data.clear()

    def stats(self) -> dict:
        with self._lock:
            return {"entries": len(self._data), "hits": self.hits, "misses": self.misses}


CACHE = TTLCache()

# Per-endpoint TTLs (seconds). 500ms-2s as required.
TTL = {
    "search": 1.5,
    "indicators": 2.0,
    "indicator": 2.0,
    "source": 2.0,
    "concept": 2.0,
    "families": 2.0,
    "concepts": 2.0,
    "edge_presets": 2.0,
    "edge_report": 1.0,
    "edge_symbols": 2.0,
    "propfirms": 2.0,
    "offers": 2.0,
}


# --------------------------------------------------------------------------
# MCP bridge: one long-lived session, owned by one asyncio task
# --------------------------------------------------------------------------


def _tool_text(result) -> str:
    """Join the text parts of an MCP CallToolResult."""
    parts = []
    for chunk in getattr(result, "content", None) or []:
        text = getattr(chunk, "text", None)
        if text is None and isinstance(chunk, dict):
            text = chunk.get("text")
        if text:
            parts.append(text)
    return "\n".join(parts)


def _tool_is_error(result) -> bool:
    return bool(getattr(result, "isError", False) or getattr(result, "is_error", False))


def parse_tool_payload(result):
    """Return (payload, raw_text). JSON-decoded when possible.

    LuxAlgo reports tool-level failures two ways: a normal JSON body like
    {"error": "..."} with isError=False (most library lookups), and a real
    isError=True result whose text is that same JSON. Both are mapped onto a
    404 so the HTTP layer reports "not found" rather than "upstream broken".
    """
    raw = _tool_text(result)
    if _tool_is_error(result):
        message = raw
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and isinstance(parsed.get("error"), str):
                message = parsed["error"]
        except Exception:
            pass
        lowered = message.lower()
        if "unknown" in lowered or "not found" in lowered or "no such" in lowered:
            raise ApiError(message, HTTPStatus.NOT_FOUND, "not_found")
        raise ApiError(message or "MCP tool reported an error", 502, "mcp_tool_error")
    try:
        return json.loads(raw), raw
    except Exception:
        return raw, raw


def payload_error(payload) -> str | None:
    """LuxAlgo returns {'error': '...'} for unknown slugs etc. (not isError)."""
    if isinstance(payload, dict) and "error" in payload and len(payload) <= 2:
        err = payload.get("error")
        if isinstance(err, str) and err.strip():
            return err.strip()
    return None


class MCPBridge:
    """Owns one reusable MCP session on a private asyncio loop in a thread."""

    def __init__(self, url: str, call_timeout: float = MCP_CALL_TIMEOUT):
        self.url = url
        self.call_timeout = call_timeout
        self.loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._queue: asyncio.Queue | None = None
        self._ready = threading.Event()
        self._shutdown = threading.Event()
        self._session = None
        self.last_error: str | None = None
        self.started_at: float | None = None
        self._calls = 0
        self._errors = 0
        self._reconnects = 0
        self._lock = threading.Lock()

    # -- lifecycle -------------------------------------------------------

    def start(self, wait: float = MCP_CONNECT_WAIT) -> bool:
        if _ClientSession is None:
            self.last_error = f"mcp package unavailable ({MCP_IMPORT_ERROR})"
            return False
        self._thread = threading.Thread(target=self._thread_main, name="mcp-loop", daemon=True)
        self._thread.start()
        ok = self._ready.wait(timeout=wait)
        return ok

    def stop(self, timeout: float = 5.0) -> None:
        self._shutdown.set()
        if self.loop is not None and self.loop.is_running():
            try:
                self.loop.call_soon_threadsafe(self._queue.put_nowait, None)
            except Exception:
                pass
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def _thread_main(self) -> None:
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.started_at = time.time()
        try:
            self.loop.run_until_complete(self._run_forever())
        except Exception:
            pass
        finally:
            try:
                self.loop.close()
            except Exception:
                pass

    async def _run_forever(self) -> None:
        self._queue = asyncio.Queue()
        backoff = 2.0
        while not self._shutdown.is_set():
            try:
                async with _streamable_http_client(self.url) as streams:
                    read, write = streams[0], streams[1]
                    async with _ClientSession(read, write) as session:
                        await session.initialize()
                        self._session = session
                        self.last_error = None
                        self._ready.set()
                        log(f"MCP session ready at {self.url}")
                        try:
                            await self._pump(session)
                        finally:
                            self._ready.clear()
                            self._session = None
            except BaseException as exc:  # noqa: BLE001 - teardown noise included
                if not self._shutdown.is_set():
                    self.last_error = f"{type(exc).__name__}: {exc}"
            self._ready.clear()
            self._session = None
            self._fail_pending(self.last_error or "MCP session closed")
            if self._shutdown.is_set():
                break
            self._reconnects += 1
            log(f"MCP reconnect #{self._reconnects} after: {self.last_error}")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)

    async def _pump(self, session) -> None:
        """Serialise queued calls onto the session until it dies or we stop."""
        assert self._queue is not None
        while True:
            item = await self._queue.get()
            if item is None:  # shutdown sentinel
                return
            name, args, fut, timeout = item
            if fut.cancelled():
                continue
            try:
                result = await asyncio.wait_for(session.call_tool(name, args), timeout=timeout)
            except BaseException as exc:  # noqa: BLE001
                with self._lock:
                    self._errors += 1
                if not fut.done():
                    fut.set_exception(exc)
                self.last_error = f"{type(exc).__name__}: {exc}"
                raise  # poison the session -> reconnect
            with self._lock:
                self._calls += 1
            if not fut.done():
                try:
                    fut.set_result(result)
                except Exception:
                    pass

    async def _fail_pending(self, message: str) -> None:
        if self._queue is None:
            return
        while True:
            try:
                item = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            if item is None:
                continue
            _, _, fut, _ = item
            if not fut.done():
                fut.set_exception(MCPUnavailable(message))

    # -- sync API used by HTTP threads -----------------------------------

    @property
    def connected(self) -> bool:
        return self._ready.is_set()

    def stats(self) -> dict:
        with self._lock:
            return {
                "connected": self._ready.is_set(),
                "url": self.url,
                "calls": self._calls,
                "errors": self._errors,
                "reconnects": self._reconnects,
                "last_error": self.last_error,
                "uptime_s": round(time.time() - self.started_at, 1) if self.started_at else 0,
            }

    def call(self, tool: str, args: dict, timeout: float | None = None) -> tuple:
        """Blocking tool call. Returns (payload, raw_text). Raises ApiError."""
        if self.loop is None or not self.connected:
            raise MCPUnavailable(
                "No live MCP session", detail=self.last_error or "session not established"
            )
        timeout = timeout or self.call_timeout
        fut: concurrent.futures.Future = concurrent.futures.Future()
        try:
            self.loop.call_soon_threadsafe(
                self._queue.put_nowait, (tool, args, fut, timeout)
            )
        except RuntimeError as exc:
            raise MCPUnavailable("MCP loop is not running", detail=str(exc)) from exc
        try:
            result = fut.result(timeout=timeout + 15.0)
        except concurrent.futures.TimeoutError as exc:
            fut.cancel()
            raise MCPUnavailable(
                f"Timed out waiting for MCP tool '{tool}'", detail=f"{timeout}s"
            ) from exc
        except MCPUnavailable:
            raise
        except BaseException as exc:  # noqa: BLE001
            raise MCPUnavailable(
                f"MCP tool '{tool}' failed", detail=f"{type(exc).__name__}: {exc}"
            ) from exc
        return parse_tool_payload(result)


BRIDGE: MCPBridge = MCPBridge(DEFAULT_MCP_URL)


def mcp_call(tool: str, args: dict, ctx_key: str, cache_key, ttl: float) -> tuple:
    """Cached bridge call. Returns (payload, raw_text, cached_bool)."""
    if cache_key is not None:
        hit = CACHE.get(cache_key)
        if hit is not None:
            return hit[0], hit[1], True
    args = dict(args)
    args["context"] = CONTEXT[ctx_key]
    payload, raw = BRIDGE.call(tool, args)
    if cache_key is not None:
        CACHE.set(cache_key, (payload, raw), ttl)
    return payload, raw, False


# --------------------------------------------------------------------------
# Endpoint implementations
# --------------------------------------------------------------------------


def _limit(raw, default=10, lo=1, hi=50) -> int:
    if isinstance(raw, (list, tuple)):
        raw = raw[0] if raw else None
    if raw is None or raw == "":
        return default
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        raise ApiError(f"Invalid numeric value: {raw!r}", 400, "bad_request")
    return max(lo, min(hi, value))


def _one(params: dict, name: str, required: bool = False) -> str | None:
    values = params.get(name)
    if not values:
        if required:
            raise ApiError(f"Missing required query parameter '{name}'", 400, "bad_request")
        return None
    value = (values[0] or "").strip()
    if not value:
        if required:
            raise ApiError(f"Empty required query parameter '{name}'", 400, "bad_request")
        return None
    return value


def ep_health(params: dict) -> dict:
    data = {
        "status": "ok" if BRIDGE.connected else "degraded",
        "version": SERVER_VERSION,
        "mcp": BRIDGE.stats(),
        "cache": CACHE.stats(),
        "endpoints": sorted(ROUTES.keys()),
    }
    # Optional live round-trip against the remote server (`?probe=1`).
    if _one(params, "probe") in ("1", "true", "yes"):
        payload, _, cached = mcp_call(
            "library_list_families", {}, "families", ("health-probe",), TTL["families"]
        )
        fams = payload.get("families") if isinstance(payload, dict) else None
        data["probe"] = {
            "ok": True,
            "tool": "library_list_families",
            "cached": cached,
            "family_count": len(fams) if isinstance(fams, list) else None,
        }
    return data


def ep_search(params: dict) -> dict:
    query = _one(params, "q", required=True)
    kind = (_one(params, "type") or "all").lower()
    if kind not in ("all", "concepts", "indicators"):
        raise ApiError("type must be one of: all, concepts, indicators", 400, "bad_request")
    family = _one(params, "family")
    if family and family not in FAMILIES:
        raise ApiError(
            f"Unknown family '{family}'", 400, "bad_request", detail={"allowed": FAMILIES}
        )
    limit = _limit(params.get("limit"), 10, 1, 50)

    args = {"query": query, "type": kind, "limit": limit}
    if family:
        args["family"] = family
    key = ("search", query, kind, family, limit)
    payload, raw, cached = mcp_call("library_search", args, "search", key, TTL["search"])
    if not isinstance(payload, dict):
        return {"query": query, "type": kind, "family": family, "limit": limit,
                "count": 0, "results": [], "raw": raw, "cached": cached}
    results = payload.get("results") or []
    return {
        "query": query, "type": kind, "family": family, "limit": limit,
        "count": len(results), "results": results, "cached": cached,
    }


def ep_indicators(params: dict) -> dict:
    family = _one(params, "family")
    if family and family not in FAMILIES:
        raise ApiError(
            f"Unknown family '{family}'", 400, "bad_request", detail={"allowed": FAMILIES}
        )
    text = _one(params, "text")
    concept = _one(params, "concept")
    tier = _one(params, "tier")
    sort = _one(params, "sort")
    direction = _one(params, "direction")
    page = _limit(params.get("page"), 0, 0, 10**9)
    page_size = _limit(params.get("page_size") or params.get("pageSize"), 24, 1, 100)

    if sort and sort not in ("name", "date", "family"):
        raise ApiError("sort must be one of: name, date, family", 400, "bad_request")
    if direction and direction not in ("asc", "desc"):
        raise ApiError("direction must be asc or desc", 400, "bad_request")

    args = {"page": page, "page_size": page_size}
    for k, v in (("family", family), ("text", text), ("concept", concept),
                 ("tier", tier), ("sort", sort), ("direction", direction)):
        if v:
            args[k] = v
    key = ("indicators", tuple(sorted(args.items())))
    payload, raw, cached = mcp_call(
        "library_list_indicators", args, "indicators", key, TTL["indicators"]
    )
    if not isinstance(payload, dict):
        payload = {}
    indicators = payload.get("indicators") or []
    return {
        "family": family, "text": text, "concept": concept,
        "page": payload.get("page", page),
        "page_size": payload.get("page_size", page_size),
        "total": payload.get("total", len(indicators)),
        "count": len(indicators),
        "indicators": indicators,
        "cached": cached,
    }


def ep_indicator(params: dict) -> dict:
    slug = _one(params, "slug", required=True)
    key = ("indicator", slug)
    payload, raw, cached = mcp_call(
        "library_get_indicator", {"slug": slug}, "indicator", key, TTL["indicator"]
    )
    err = payload_error(payload)
    if err:
        raise ApiError(err, 404, "not_found")
    if not isinstance(payload, dict):
        return {"slug": slug, "raw": raw, "cached": cached}
    payload = dict(payload)
    payload["cached"] = cached
    return payload


def ep_source(params: dict) -> dict:
    slug = _one(params, "slug", required=True)
    key = ("source", slug)
    payload, raw, cached = mcp_call(
        "library_get_source_code", {"slug": slug}, "source", key, TTL["source"]
    )
    err = payload_error(payload)
    if err:
        raise ApiError(err, 404, "not_found")
    if not isinstance(payload, dict):
        return {"slug": slug, "available": True, "source": raw, "cached": cached}
    source = payload.get("source") or ""
    if payload.get("available") is False and not source:
        raise ApiError(
            f"No source code published for '{slug}'", 404, "not_found", detail=payload
        )
    return {
        "slug": payload.get("slug", slug),
        "name": payload.get("name"),
        "available": payload.get("available", bool(source)),
        "source": source,
        "lines": source.count("\n") + 1 if source else 0,
        "bytes": len(source),
        "cached": cached,
    }


def ep_concept(params: dict) -> dict:
    slug = _one(params, "slug", required=True)
    key = ("concept", slug)
    payload, raw, cached = mcp_call(
        "library_get_concept", {"slug": slug}, "concept", key, TTL["concept"]
    )
    err = payload_error(payload)
    if err:
        raise ApiError(err, 404, "not_found")
    if not isinstance(payload, dict):
        return {"slug": slug, "content_markdown": raw, "cached": cached}
    payload = dict(payload)
    payload["cached"] = cached
    return payload


def ep_families(params: dict) -> dict:
    payload, raw, cached = mcp_call(
        "library_list_families", {}, "families", ("families",), TTL["families"]
    )
    if isinstance(payload, dict):
        out = dict(payload)
        out["cached"] = cached
        return out
    return {"raw": raw, "cached": cached}


def ep_concepts(params: dict) -> dict:
    family = _one(params, "family")
    if family and family not in FAMILIES:
        raise ApiError(
            f"Unknown family '{family}'", 400, "bad_request", detail={"allowed": FAMILIES}
        )
    page = _limit(params.get("page"), 0, 0, 10**9)
    page_size = _limit(params.get("page_size"), 50, 1, 200)
    args = {"page": page, "page_size": page_size}
    if family:
        args["family"] = family
    key = ("concepts", family, page, page_size)
    payload, raw, cached = mcp_call(
        "library_list_concepts", args, "concepts", key, TTL["concepts"]
    )
    if not isinstance(payload, dict):
        return {"concepts": [], "total": 0, "cached": cached}
    concepts = payload.get("concepts") or []
    return {
        "family": family,
        "page": payload.get("page", page),
        "page_size": payload.get("page_size", page_size),
        "total": payload.get("total", len(concepts)),
        "count": len(concepts),
        "concepts": concepts,
        "cached": cached,
    }


def ep_edge_presets(params: dict) -> dict:
    category = _one(params, "category")
    args = {"category": category} if category else {}
    key = ("edge_presets", category)
    payload, raw, cached = mcp_call(
        "edge_presets", args, "edge_presets", key, TTL["edge_presets"]
    )
    if not isinstance(payload, dict):
        return {"categories": [], "presets": [], "raw": raw, "cached": cached}
    presets = payload.get("presets") or []
    categories = payload.get("categories") or []
    if category and category not in categories:
        raise ApiError(
            f"Unknown category '{category}'", 400, "bad_request", detail={"allowed": categories}
        )
    return {
        "category": category,
        "categories": categories,
        "count": len(presets),
        "presets": presets,
        "cached": cached,
    }


def ep_edge_report(params: dict) -> dict:
    preset = _one(params, "preset", required=True)
    symbol = _one(params, "symbol", required=True)
    key = ("edge_report", preset, symbol.upper())
    payload, raw, cached = mcp_call(
        "edge_report",
        {"preset": preset, "symbol": symbol.upper()},
        "edge_report",
        key,
        TTL["edge_report"],
    )
    err = payload_error(payload)
    if err:
        raise ApiError(err, 404, "not_found")
    if not isinstance(payload, dict):
        return {"preset": preset, "symbol": symbol.upper(), "raw": raw, "cached": cached}
    return {"preset": preset, "symbol": symbol.upper(), "report": payload, "cached": cached}


def ep_edge_symbols(params: dict) -> dict:
    payload, raw, cached = mcp_call(
        "edge_symbols", {}, "edge_symbols", ("edge_symbols",), TTL["edge_symbols"]
    )
    if isinstance(payload, dict):
        symbols = payload.get("symbols") or []
        return {
            "count": len(symbols),
            "symbols": symbols,
            "note": payload.get("note"),
            "builtAt": payload.get("builtAt"),
            "cached": cached,
        }
    return {"raw": raw, "cached": cached}


# ---- prop-firm directory -------------------------------------------------
#
# propfirms_list_simulatable returns a MARKDOWN TABLE OF TEXT, not JSON:
#
#   27 firm(s) in the live LuxAlgo directory (alphabetical - data, not
#   endorsement or ranking):
#   alpha-capital-group - Alpha Capital
#     - alpha-capital-alpha-pro-2-step-10k: Alpha Capital - Alpha Pro - 2-Step 10K - $10,000 cfd, $97 [directory+inferred]
#   ...
#   Provenance 'directory+inferred' means ...
#
# So it is parsed into {slug, name, challenges:[{id,name,size,price,productType}]}.

_FIRM_RE = re.compile(r"^(?P<slug>[A-Za-z0-9][A-Za-z0-9._-]*)\s+-\s+(?P<name>.+?)\s*$")
_CHALLENGE_RE = re.compile(
    r"^\s+-\s+(?P<id>[^:]+):\s*(?P<rest>.+?)\s*$"
)
_MONEY_RE = re.compile(
    r"^(?P<name>.*?)\s*-\s*(?P<sym>[$€£¥])?(?P<size>[\d,]+(?:\.\d+)?)"
    r"(?:\s*(?P<productType>[a-z]+))?"
    r"\s*,\s*(?P<psym>[$€£¥])?(?P<price>[\d,]+(?:\.\d+)?)"
    r"\s*(?P<provenance>\[[^\]]*\])?"
    r"\s*$",
    re.S,
)
_CURRENCY = {"$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY"}
_STOP_RE = re.compile(r"^(Provenance|Simulation,)\b")


def _money(value: str) -> float:
    return float(value.replace(",", ""))


def parse_propfirms(text: str, product_type: str | None = None):
    firms: list[dict] = []
    current: dict | None = None
    challenge_count = 0
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue
        if _STOP_RE.match(line.strip()):
            break
        if line.lstrip().startswith("-"):
            match = _CHALLENGE_RE.match(line)
            if not match or current is None:
                continue
            challenge_id = match.group("id").strip()
            rest = match.group("rest").strip()
            if challenge_id.lower().startswith("not simulatable"):
                # e.g. "not simulatable (ambiguous rule text; ...): id-a, id-b, ..."
                current["notSimulatable"] = [
                    part.strip() for part in rest.split(",") if part.strip()
                ]
                continue
            money = _MONEY_RE.match(rest)
            if money:
                ptype = money.group("productType")
                sym = money.group("psym") or money.group("sym") or "$"
                challenge = {
                    "id": challenge_id,
                    "name": money.group("name").strip(),
                    "size": _money(money.group("size")),
                    "sizeLabel": sym + money.group("size"),
                    "price": _money(money.group("price")),
                    "currency": _CURRENCY.get(sym, "USD"),
                    "productType": ptype,
                    "provenance": (money.group("provenance") or "").strip("[]") or None,
                }
            else:
                challenge = {
                    "id": challenge_id,
                    "name": rest,
                    "size": None,
                    "sizeLabel": None,
                    "price": None,
                    "currency": None,
                    "productType": None,
                    "provenance": None,
                }
            if product_type and challenge["productType"] != product_type:
                continue
            current["challenges"].append(challenge)
            challenge_count += 1
            continue
        match = _FIRM_RE.match(line)
        if match and "firm(s) in the live LuxAlgo directory" not in line:
            current = {
                "slug": match.group("slug"),
                "name": match.group("name"),
                "challenges": [],
            }
            firms.append(current)
    if product_type:
        firms = [f for f in firms if f["challenges"]]
    keep = []
    for firm in firms:
        if not firm["challenges"]:
            continue
        firm["challengeCount"] = len(firm["challenges"])
        firm.setdefault("notSimulatable", [])
        keep.append(firm)
    return keep, challenge_count


def ep_propfirms(params: dict) -> dict:
    product_type = _one(params, "productType") or _one(params, "product_type")
    if product_type and product_type not in ("futures", "cfd"):
        raise ApiError("productType must be futures or cfd", 400, "bad_request")
    args = {"productType": product_type} if product_type else {}
    key = ("propfirms", product_type)
    payload, raw, cached = mcp_call(
        "propfirms_list_simulatable", args, "propfirms", key, TTL["propfirms"]
    )
    text = raw if isinstance(raw, str) else json.dumps(payload)
    firms, challenges = parse_propfirms(text, product_type)
    return {
        "productType": product_type,
        "firmCount": len(firms),
        "challengeCount": sum(f["challengeCount"] for f in firms),
        "firms": firms,
        "cached": cached,
        "note": "Directory data, not endorsement or ranking. Challenge rules may be inferred from free text ('directory+inferred'); the firm's own page is authoritative.",
    }


_OFFER_FIELDS = (
    "offerId", "propfirmId", "propfirmName", "promoCode", "discountIsPercent",
    "discountValue", "shortDescription", "affiliateLink", "isFeatured",
    "isActive", "hasEndDate", "scope",
)

OFFER_CONTEXT = CONTEXT["offers"]


def ep_offers(params: dict) -> dict:
    text = _one(params, "text")
    firm = _one(params, "firm")
    limit = _limit(params.get("limit"), 50, 1, 100)
    include_expired = _one(params, "includeExpired") in ("1", "true", "yes")

    args = {"pageQuantity": limit}
    if text:
        args["text"] = text
    if firm:
        args["propfirmId"] = [firm]
    if include_expired:
        args["includeExpired"] = True
    key = ("offers", text, firm, limit, include_expired)
    payload, raw, cached = mcp_call(
        "propfirms_search_offers", args, "offers", key, TTL["offers"]
    )
    if not isinstance(payload, dict):
        return {"count": 0, "offers": [], "raw": raw, "cached": cached}
    offers = []
    for offer in payload.get("offers") or []:
        if not isinstance(offer, dict):
            continue
        offers.append({k: offer.get(k) for k in _OFFER_FIELDS if k in offer})
    return {
        "count": len(offers),
        "total": payload.get("count"),
        "offers": offers,
        "cached": cached,
    }


def ep_agents(params: dict) -> dict:
    """The study list the dock renders: id, name, brief, session id, counters."""
    studies = list_studies(AGENTS_ROOT)
    sid = (params.get("id") or [""])[0]
    if sid:
        one = next((s for s in studies if s["id"] == sid), None)
        if one is None:
            raise ApiError(f"unknown study '{sid}'", HTTPStatus.NOT_FOUND, "unknown_agent",
                           {"available": [s["id"] for s in studies]})
        return {"agent": one, "learnings": learnings_tail(AGENTS_ROOT, sid, max_chars=6000)}
    return {"agents": studies}


# Fallback ONLY. The live page publishes its real action list in every heartbeat (`actions`), and a
# command is validated against THAT while a page is attached. This constant drifted from the page once
# already — "overlay" sat here with no matching case in frontend/chart-bridge.js, so the command
# passed this check, got an HTTP 200, and the page replied "unknown action" with nothing done.
CHART_ACTIONS_FALLBACK = {"apply", "add", "market", "shot", "draw", "clear", "probe", "reload",
                         "mode", "script"}


def chart_actions() -> set:
    """The actions the attached page can actually execute.

    The page is the authority (it ships the code that runs them); the constant above is only used when
    no page has ever checked in. Read from the same state the heartbeat writes.
    """
    try:
        state = load_chart_state(AGENTS_ROOT) or {}
    except Exception:  # noqa: BLE001 — a missing/!dict state must not break command validation
        state = {}
    published = state.get("actions") if isinstance(state, dict) else None
    if isinstance(published, list) and published:
        return {str(a).strip().lower() for a in published if str(a).strip()}
    return set(CHART_ACTIONS_FALLBACK)


def ep_chart_state(params: dict) -> dict:
    """What the live chart is showing. The page heartbeats this; the agent reads it."""
    return load_chart_state(AGENTS_ROOT)


def ep_chart_commands(params: dict) -> dict:
    """Commands the chart page has not executed yet (it passes the last id it handled)."""
    since = int((params.get("since") or ["0"])[0] or 0)
    return {"commands": chart_commands_since(AGENTS_ROOT, since)}


def ep_chart_result(params: dict) -> dict:
    """The outcome of one command: ok, a plain-language detail, and what it painted."""
    rid = int((params.get("id") or ["0"])[0] or 0)
    found = get_chart_result(AGENTS_ROOT, rid)
    if found is None:
        return {"id": rid, "pending": True}
    out = {**found, "pending": False}
    # The file copy cannot know about the push channel; the in-memory one stamped the latency.
    live = STREAM.result_for(rid)
    if live and live.get("stream_ms") is not None and out.get("stream_ms") is None:
        out["stream_ms"] = live["stream_ms"]
    return out


def ep_chart_stream_status(params: dict) -> dict:
    """How many chart views are attached to the push channel. 0 = nothing to push to."""
    return STREAM.stats()


def frontend_build() -> str:
    """A stamp for the frontend files being served right now.

    The page reports it in every heartbeat, which is how a *stale frame* becomes visible instead of
    mysterious: a renderer keeps its last painted frame while occluded, so a pane can sit on code
    from hours ago and no amount of reloading from the page side reaches it. With the stamp in the
    heartbeat, "this view is running build X while the server serves Y" is a fact, not a guess.
    """
    frontend = Path(DEFAULT_FRONTEND)
    try:
        js_files = list(frontend.glob("*.js"))
        newest = max((f.stat().st_mtime for f in js_files), default=0.0)
        html = frontend / "index.html"
        if html.exists():
            newest = max(newest, html.stat().st_mtime)
        return f"{int(newest)}"
    except OSError:
        return "unknown"


def ep_build(params: dict) -> dict:
    """What the server is serving — the page stamps this into its heartbeat."""
    return {"build": frontend_build(), "server_version": SERVER_VERSION}


ROUTES = {
    "/api/health": (ep_health, 0.0),
    "/api/build": (ep_build, 0.0),
    "/api/agents": (ep_agents, 0.0),
    "/api/chart/state": (ep_chart_state, 0.0),
    "/api/chart/commands": (ep_chart_commands, 0.0),
    "/api/chart/result": (ep_chart_result, 0.0),
    "/api/chart/stream/status": (ep_chart_stream_status, 0.0),
    "/api/search": (ep_search, TTL["search"]),
    "/api/indicators": (ep_indicators, TTL["indicators"]),
    "/api/indicator": (ep_indicator, TTL["indicator"]),
    "/api/source": (ep_source, TTL["source"]),
    "/api/concept": (ep_concept, TTL["concept"]),
    "/api/families": (ep_families, TTL["families"]),
    "/api/concepts": (ep_concepts, TTL["concepts"]),
    "/api/edge/presets": (ep_edge_presets, TTL["edge_presets"]),
    "/api/edge/report": (ep_edge_report, TTL["edge_report"]),
    "/api/edge/symbols": (ep_edge_symbols, TTL["edge_symbols"]),
    "/api/propfirms": (ep_propfirms, TTL["propfirms"]),
    "/api/offers": (ep_offers, TTL["offers"]),
}

API_INDEX = {
    "name": "luxalgo-web backend",
    "version": SERVER_VERSION,
    "mcp": DEFAULT_MCP_URL,
    "endpoints": [
        {"path": "/api/health", "params": ["probe?"], "upstream": None},
        {"path": "/api/search", "params": ["q", "type?", "family?", "limit?"], "upstream": "library_search"},
        {"path": "/api/indicators", "params": ["family?", "text?", "concept?", "tier?", "sort?", "direction?", "page?", "page_size?"], "upstream": "library_list_indicators"},
        {"path": "/api/indicator", "params": ["slug"], "upstream": "library_get_indicator"},
        {"path": "/api/source", "params": ["slug"], "upstream": "library_get_source_code"},
        {"path": "/api/concept", "params": ["slug"], "upstream": "library_get_concept"},
        {"path": "/api/families", "params": [], "upstream": "library_list_families"},
        {"path": "/api/concepts", "params": ["family?", "page?", "page_size?"], "upstream": "library_list_concepts"},
        {"path": "/api/edge/presets", "params": ["category?"], "upstream": "edge_presets"},
        {"path": "/api/edge/report", "params": ["preset", "symbol"], "upstream": "edge_report"},
        {"path": "/api/edge/symbols", "params": [], "upstream": "edge_symbols"},
        {"path": "/api/propfirms", "params": ["productType?"], "upstream": "propfirms_list_simulatable"},
        {"path": "/api/offers", "params": ["text?", "firm?", "limit?", "includeExpired?"], "upstream": "propfirms_search_offers"},
    ],
}


# --------------------------------------------------------------------------
# Static file serving
# --------------------------------------------------------------------------

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".cjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".xml": "application/xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".wasm": "application/wasm",
    ".pdf": "application/pdf",
    ".license": "text/plain; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".sh": "text/plain; charset=utf-8",
    ".py": "text/plain; charset=utf-8",
    ".yml": "text/yaml; charset=utf-8",
    ".yaml": "text/yaml; charset=utf-8",
}

MISSING_FRONTEND_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>luxalgo-web backend</title>
<style>body{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:3rem;background:#0e0e11;color:#e6e6ea}
code{color:#7dd3fc}a{color:#a5b4fc}h1{font-size:1.1rem}</style></head>
<body>
<h1>luxalgo-web backend is running</h1>
<p>No <code>index.html</code> found in the frontend directory, so this placeholder is shown.</p>
<p>The API is live &mdash; start at <a href="/api">/api</a> or <a href="/api/health">/api/health</a>.</p>
</body></html>
"""


class StaticFiles:
    def __init__(self, root: str):
        self.root = os.path.abspath(root)

    def exists(self) -> bool:
        return os.path.isdir(self.root)

    def resolve(self, url_path: str) -> str | None:
        """Map a URL path to a file inside root, or None. Blocks traversal."""
        rel = unquote(url_path).lstrip("/")
        if "\x00" in rel:
            return None
        candidate = os.path.abspath(os.path.join(self.root, rel))
        if candidate != self.root and not candidate.startswith(self.root + os.sep):
            return None
        if os.path.isfile(candidate):
            return candidate
        if os.path.isdir(candidate):
            index = os.path.join(candidate, "index.html")
            if os.path.isfile(index):
                return index
        if not os.path.splitext(rel)[1]:
            as_html = candidate + ".html"
            if os.path.isfile(as_html):
                return as_html
            index = os.path.join(self.root, "index.html")
            if os.path.isfile(index):
                return index  # SPA fallback
        return None


# --------------------------------------------------------------------------
# HTTP handler
# --------------------------------------------------------------------------

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", ""}


def cors_origin(origin: str | None, host: str | None) -> str | None:
    """Reflect loopback/self origins; the API is meant for local use only."""
    if not origin:
        return None
    try:
        parsed = urlparse(origin)
    except Exception:
        return None
    if parsed.hostname in ("localhost", "127.0.0.1", "::1"):
        return origin
    if host and parsed.netloc == host:
        return origin
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = f"luxalgo-web/{SERVER_VERSION}"
    protocol_version = "HTTP/1.1"
    static: StaticFiles = StaticFiles(DEFAULT_FRONTEND)

    # -- helpers ---------------------------------------------------------

    def log_message(self, fmt, *args):  # noqa: A003
        log(f"{self.address_string()} {fmt % args}")

    def _cors_headers(self) -> dict:
        origin = cors_origin(self.headers.get("Origin"), self.headers.get("Host"))
        headers = {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept",
            "Access-Control-Max-Age": "600",
        }
        if origin:
            headers["Access-Control-Allow-Origin"] = origin
            headers["Vary"] = "Origin"
        return headers

    def _send(self, status: int, body: bytes, content_type: str, extra: dict | None = None,
              head_only: bool = False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in self._cors_headers().items():
            self.send_header(key, value)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if not head_only and body:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _send_json(self, status: int, payload: dict, head_only: bool = False):
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8",
                   {"Cache-Control": "no-store"}, head_only)

    def _ok(self, data, cached: bool | None = None, head_only: bool = False):
        payload = {"ok": True, "data": data}
        if cached is not None:
            payload["cached"] = cached
        self._send_json(200, payload, head_only)

    def _fail(self, message: str, status: int = 500, code: str = "internal_error",
              detail=None, head_only: bool = False):
        payload = {"ok": False, "error": message, "code": code}
        if detail is not None:
            payload["detail"] = detail
        self._send_json(status, payload, head_only)

    # -- verbs -----------------------------------------------------------

    def do_OPTIONS(self):  # noqa: N802
        self._send(HTTPStatus.NO_CONTENT, b"", "text/plain")

    def do_HEAD(self):  # noqa: N802
        self._handle(head_only=True)

    # -- POST: the dock's write path -------------------------------------

    def do_POST(self):  # noqa: N802
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                self._fail(f"bad JSON body: {exc}", HTTPStatus.BAD_REQUEST, "bad_json")
                return
            if not isinstance(payload, dict):
                self._fail("body must be a JSON object", HTTPStatus.BAD_REQUEST, "bad_body")
                return
            path = urlparse(self.path).path.rstrip("/") or "/"
            if path == "/api/agents":
                self._ok({"agent": upsert_study(AGENTS_ROOT, payload)})
                return
            if path == "/api/agents/delete":
                self._ok({"removed": delete_study(AGENTS_ROOT, str(payload.get("id", ""))),
                          "agents": list_studies(AGENTS_ROOT)})
                return
            if path == "/api/agents/learning":
                sid = str(payload.get("agent_id", ""))
                written = append_learning(AGENTS_ROOT, sid,
                                          title=str(payload.get("title", "note")),
                                          body=str(payload.get("body", "")))
                self._ok({"written": written, "agent": load_study(AGENTS_ROOT, sid)})
                return
            if path == "/api/chat":
                self._chat(payload)
                return
            if path == "/api/chart/state":
                self._ok({"state": save_chart_state(AGENTS_ROOT, payload)})
                return
            if path == "/api/chart/command":
                action = str(payload.get("action", "")).strip().lower()
                supported = chart_actions()
                if action not in supported:
                    self._fail(f"unknown chart action '{action}'", HTTPStatus.BAD_REQUEST,
                               "unknown_action",
                               {"supported": sorted(supported),
                                "source": "page heartbeat" if supported != CHART_ACTIONS_FALLBACK else "built-in fallback"})
                    return
                command = enqueue_chart_command(AGENTS_ROOT, payload)
                pushed = STREAM.publish({"type": "command", "command": command},
                                        command_id=command.get("id") if isinstance(command, dict) else None)
                inline = self._await_chart_result(command, payload) if pushed else None
                self._ok({"command": command, "views": STREAM.client_count(),
                          "pushed": pushed, "result": inline})
                return
            if path == "/api/chart/result":
                recorded = record_chart_result(AGENTS_ROOT, payload)
                if isinstance(recorded, dict):
                    # resolves whoever is waiting on this command (the push path's fast answer)
                    recorded = STREAM.deliver_result(recorded)
                self._ok({"result": recorded})
                return
            if path == "/api/chart/claim":
                # Several consoles can be alive at once (the Hermes pane, the HUD's pane, a browser
                # tab). They all get the same push, so one of them must win the right to execute it.
                rid = payload.get("id")
                viewer = str(payload.get("viewer") or "")
                self._ok({"id": rid, "claimed": STREAM.claim(rid, viewer, once=STREAM.is_once(rid)), "viewer": viewer})
                return
            self._fail(f"Unknown endpoint '{path}'", HTTPStatus.NOT_FOUND, "unknown_endpoint")
        except ApiError as exc:
            self._fail(exc.message, exc.status, exc.code, exc.detail)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # noqa: BLE001
            log("unhandled POST error:\n" + traceback.format_exc())
            self._fail(f"{type(exc).__name__}: {exc}", HTTPStatus.INTERNAL_SERVER_ERROR,
                       "internal_error")

    def _chat(self, payload: dict):
        """One prompt for one study. Bidirectional: the chart state (and optionally its picture)
        goes in; the reply's Pine block and CHART: directives come back for the dock to act on."""
        message = str(payload.get("message", "")).strip()
        if not message:
            self._fail("message must not be empty", HTTPStatus.BAD_REQUEST, "empty_message")
            return
        ids = [s["id"] for s in list_studies(AGENTS_ROOT)]
        agent_id = str(payload.get("agent_id", "")).strip()
        if agent_id not in ids:
            self._fail(f"unknown study '{agent_id}'", HTTPStatus.BAD_REQUEST, "unknown_agent",
                       detail={"available": ids})
            return
        agent = load_study(AGENTS_ROOT, agent_id)

        # `fresh` starts the study over: the CLI is called WITHOUT --resume, and the new session id
        # replaces the stored one (the reply path below already persists a changed session).
        fresh = bool(payload.get("fresh"))
        context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
        shot_note = None
        shot = payload.get("screenshot")
        if isinstance(shot, str) and shot.startswith("data:image/png;base64,"):
            try:
                path = save_shot(AGENTS_ROOT, agent_id, shot)
                context["chart_screenshot"] = path
                shot_note = ("The attached picture is the live chart: analyse it with your vision "
                             "tool before answering.")
            except ValueError as exc:
                self._fail(f"screenshot rejected: {exc}", HTTPStatus.BAD_REQUEST, "bad_screenshot")
                return

        result = run_agent(
            cli=CHAT_CLI,
            agent=agent,
            message=message,
            context=context,
            timeout=int(payload.get("timeout") or 180),
            workdir=str(payload.get("workdir") or os.path.expanduser("~/Projects/luxalgo-web")),
            resume=None if fresh else agent.get("session_id"),
            learnings=learnings_tail(AGENTS_ROOT, agent_id),
            extra_args=[],
        )
        if shot_note:
            result["screenshot_note"] = shot_note
        if not result.get("ok"):
            self._fail(result.get("reason", "agent failed"), HTTPStatus.BAD_GATEWAY, "agent_failed",
                       detail={"elapsed_ms": result.get("elapsed_ms")})
            return
        if result.get("session_id") and result["session_id"] != agent.get("session_id"):
            set_session(AGENTS_ROOT, agent_id, result["session_id"])
        record_run(AGENTS_ROOT, agent_id, "run")
        self._ok({"agent": agent_id, "resumed": bool(agent.get("session_id")), **result})

    def _chart_stream(self):
        """Hold one response open and push queued commands down it (SSE).

        The chart page attaches here on load; every command the agent queues is written as a `data:`
        line the instant it exists, instead of waiting for the page's next poll. A comment line every
        keepalive interval keeps the socket warm (and tells us the client is still there).
        """
        cid, inbox = STREAM.attach()
        log(f"chart stream: view {cid} attached ({STREAM.client_count()} attached)")
        try:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            hello = json.dumps({"type": "hello", "views": STREAM.client_count()},
                               separators=(",", ":"))
            self.wfile.write(f"data: {hello}\n\n".encode("utf-8"))
            self.wfile.flush()
            while True:
                blob = STREAM.next_event(inbox, STREAM.keepalive())
                if blob is None:
                    self.wfile.write(b": keepalive\n\n")
                else:
                    self.wfile.write(f"data: {blob}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the view went away mid-stream; that is normal, not an error
        except OSError as exc:
            log(f"chart stream: view {cid} dropped ({exc})")
        finally:
            STREAM.detach(cid)
            log(f"chart stream: view {cid} detached ({STREAM.client_count()} attached)")

    def _await_chart_result(self, command: dict, payload: dict) -> dict | None:
        """Keep the caller's request open briefly so the push path can answer it in one round trip.

        The caller opts in with `wait` (seconds). Without it, behaviour is exactly what it was: the
        command is queued and the caller reads the result when it feels like it.
        """
        try:
            wait_s = float(payload.get("wait") or 0)
        except (TypeError, ValueError):
            wait_s = 0.0
        rid = command.get("id")
        if wait_s <= 0 or rid is None:
            return None
        return STREAM.wait_for_result(int(rid), min(wait_s, CHART_INLINE_WAIT_MAX))

    def do_GET(self):  # noqa: N802
        self._handle(head_only=False)

    def _handle(self, head_only: bool):
        try:
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            params = parse_qs(parsed.query, keep_blank_values=False)

            if path == "/api":
                self._ok(API_INDEX, head_only=head_only)
                return

            if path == "/api/chart/stream":
                # The push channel: a long-lived response the chart page keeps open. HEAD cannot
                # stream, so it gets the address back instead of an endless body.
                if head_only:
                    self._ok({"stream": "/api/chart/stream", "views": STREAM.client_count()})
                    return
                self._chart_stream()
                return

            route = ROUTES.get(path)
            if route is not None:
                handler, _ttl = route
                data = handler(params)
                cached = data.pop("cached", None) if isinstance(data, dict) else None
                self._ok(data, cached=cached, head_only=head_only)
                return

            if path.startswith("/api/"):
                self._fail(
                    f"Unknown endpoint '{path}'",
                    HTTPStatus.NOT_FOUND,
                    "unknown_endpoint",
                    detail={"available": sorted(ROUTES.keys()) + ["/api"]},
                    head_only=head_only,
                )
                return

            self._serve_static(parsed.path, head_only)
        except ApiError as exc:
            self._fail(exc.message, exc.status, exc.code, exc.detail, head_only)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # noqa: BLE001
            log("unhandled error:\n" + traceback.format_exc())
            self._fail(
                f"{type(exc).__name__}: {exc}",
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "internal_error",
                head_only=head_only,
            )

    def _serve_static(self, url_path: str, head_only: bool):
        static = self.static
        if not static.exists():
            if url_path.rstrip("/") in ("", "/"):
                body = MISSING_FRONTEND_HTML.encode("utf-8")
                self._send(200, body, "text/html; charset=utf-8",
                           {"Cache-Control": "no-store"}, head_only)
                return
            self._fail(
                f"Frontend directory not found: {static.root}",
                HTTPStatus.NOT_FOUND, "no_frontend", head_only=head_only,
            )
            return

        target = static.resolve(url_path)
        if target is None:
            if url_path.rstrip("/") in ("", "/"):
                body = MISSING_FRONTEND_HTML.encode("utf-8")
                self._send(200, body, "text/html; charset=utf-8",
                           {"Cache-Control": "no-store"}, head_only)
                return
            self._fail(
                f"Not found: {url_path}", HTTPStatus.NOT_FOUND, "not_found", head_only=head_only
            )
            return

        ext = os.path.splitext(target)[1].lower()
        ctype = CONTENT_TYPES.get(ext) or "application/octet-stream"
        try:
            with open(target, "rb") as handle:
                body = handle.read()
        except OSError as exc:
            self._fail(f"Could not read {target}: {exc}", 500, "io_error", head_only=head_only)
            return
        self._send(200, body, ctype, {"Cache-Control": "no-store"}, head_only)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return
        log(f"connection error from {client_address}: {type(exc).__name__}: {exc}")


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Serve the LuxAlgo web app: static frontend + cached MCP proxy."
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"port to listen on (default {DEFAULT_PORT})")
    parser.add_argument("--host", default=DEFAULT_HOST,
                        help=f"interface to bind (default {DEFAULT_HOST})")
    parser.add_argument("--frontend", default=DEFAULT_FRONTEND,
                        help=f"frontend directory to serve (default {DEFAULT_FRONTEND})")
    parser.add_argument("--mcp-url", default=DEFAULT_MCP_URL,
                        help=f"LuxAlgo MCP endpoint (default {DEFAULT_MCP_URL})")
    parser.add_argument("--call-timeout", type=float, default=MCP_CALL_TIMEOUT,
                        help="per-tool-call timeout in seconds")
    parser.add_argument("--no-mcp", action="store_true",
                        help="start without connecting to MCP (static + /api/health only)")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    frontend_root = os.path.abspath(
        args.frontend if os.path.isabs(args.frontend) else os.path.join(os.getcwd(), args.frontend)
    )
    Handler.static = StaticFiles(frontend_root)

    global BRIDGE
    BRIDGE = MCPBridge(args.mcp_url, call_timeout=args.call_timeout)

    if MCP_IMPORT_ERROR:
        log(f"WARNING: mcp package not importable ({MCP_IMPORT_ERROR})")

    if args.no_mcp:
        log("starting WITHOUT an MCP session (--no-mcp)")
    else:
        log(f"connecting to MCP at {args.mcp_url} ...")
        started = time.time()
        ready = BRIDGE.start()
        if ready:
            log(f"MCP session established in {time.time() - started:.1f}s")
        else:
            log(f"WARNING: MCP session not ready after {MCP_CONNECT_WAIT:.0f}s "
                f"({BRIDGE.last_error}); the server will keep retrying in the background")

    log(f"frontend dir: {frontend_root} "
        f"({'ok' if Handler.static.exists() else 'MISSING'})")

    httpd = Server((args.host, args.port), Handler)
    log(f"listening on http://{args.host}:{args.port}  (Ctrl-C to stop)")
    try:
        httpd.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        try:
            httpd.shutdown()
        except Exception:
            pass
        httpd.server_close()
        BRIDGE.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
