#!/usr/bin/env python3
"""MVP backend for the LuxAlgo + Vela web app.

Needs a Python with the `mcp` client installed (`pip install mcp`):

    python3 mvp_server.py --port 8787

One process, no third-party deps beyond `mcp`. It opens a single long-lived MCP
session to https://mcp.luxalgo.com/mcp inside a background asyncio loop, exposes
it as plain JSON endpoints, and serves the static frontend.

    GET /api/health
    GET /api/search?q=&type=all|concepts|indicators&family=&limit=
    GET /api/indicators?family=&text=&page_size=
    GET /api/source?slug=
    GET /api/concept?slug=

Every LuxAlgo tool requires a generic `context` parameter (no personal data), so
the bridge injects one.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MCP_URL = "https://mcp.luxalgo.com/mcp"
CONTEXT = ("Retrieving LuxAlgo library data to populate a local charting web "
           "application for a developer reviewing indicators.")
CACHE_TTL = 120.0  # seconds; keeps repeated UI actions off the remote server


class MCPBridge:
    """Owns the asyncio loop + MCP session; exposes a blocking call()."""

    def __init__(self, url: str = MCP_URL) -> None:
        self.url = url
        self._loop: asyncio.AbstractEventLoop | None = None
        self._session = None
        self._ready = threading.Event()
        self.error: str | None = None
        self.tools: list[str] = []

    def start(self, timeout: float = 30.0) -> None:
        threading.Thread(target=self._run, daemon=True, name="mcp-loop").start()
        if not self._ready.wait(timeout):
            self.error = self.error or f"session not ready after {timeout:.0f}s"

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._serve())
        except Exception as exc:  # noqa: BLE001 - surfaced through /api/health
            self.error = f"{type(exc).__name__}: {exc}"
            self._ready.set()

    async def _serve(self) -> None:
        try:
            from mcp import ClientSession
            try:
                from mcp.client.streamable_http import streamable_http_client as http_client
            except ImportError:  # older mcp releases
                from mcp.client.streamable_http import streamablehttp_client as http_client
        except Exception as exc:  # noqa: BLE001
            self.error = f"mcp package unavailable: {exc}"
            self._ready.set()
            return

        async with http_client(self.url) as streams:
            read, write = streams[0], streams[1]
            async with ClientSession(read, write) as session:
                await session.initialize()
                listed = await session.list_tools()
                self.tools = [t.name for t in listed.tools]
                self._session = session
                self._ready.set()
                await asyncio.Event().wait()  # hold the session open for the process

    def call(self, tool: str, args: dict, timeout: float = 90.0):
        if self._session is None:
            raise RuntimeError(self.error or "MCP session not ready")
        future = asyncio.run_coroutine_threadsafe(self._call(tool, args), self._loop)
        return future.result(timeout=timeout)

    async def _call(self, tool: str, args: dict):
        payload = dict(args)
        payload.setdefault("context", CONTEXT)
        result = await self._session.call_tool(tool, payload)
        text = "".join(getattr(part, "text", "") for part in result.content)
        if getattr(result, "isError", False):
            raise RuntimeError(text[:400] or f"{tool} failed")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"raw": text}


BRIDGE = MCPBridge()
CACHE: dict[str, tuple[float, object]] = {}
CACHE_LOCK = threading.Lock()


def cached(key: str, producer):
    now = time.time()
    with CACHE_LOCK:
        hit = CACHE.get(key)
        if hit and now - hit[0] < CACHE_TTL:
            return hit[1]
    value = producer()
    with CACHE_LOCK:
        CACHE[key] = (now, value)
    return value


def _as_list(payload, *keys):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def build_router(frontend: Path):
    """Return a handler class bound to the given frontend directory."""

    class Handler(BaseHTTPRequestHandler):
        server_version = "luxalgo-mvp/0.1"
        protocol_version = "HTTP/1.1"

        # ---------- helpers ----------
        def _send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def json_ok(self, data) -> None:
            self._send(200, json.dumps({"ok": True, "data": data}, default=str).encode(),
                       "application/json; charset=utf-8")

        def json_err(self, message: str, status: int = 500) -> None:
            self._send(status, json.dumps({"ok": False, "error": message}).encode(),
                       "application/json; charset=utf-8")

        def log_message(self, fmt, *args):  # quieter console
            if "/api/" in (self.path or ""):
                print(f"[api] {self.path} -> {args[1] if len(args) > 1 else ''}")

        # ---------- routing ----------
        def do_GET(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            query = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}

            if path.startswith("/api/"):
                try:
                    self.route_api(path, query)
                except Exception as exc:  # noqa: BLE001
                    traceback.print_exc()
                    self.json_err(f"{type(exc).__name__}: {exc}")
                return
            self.serve_static(path)

        do_HEAD = do_GET

        def route_api(self, path: str, q: dict) -> None:
            if path == "/api/health":
                self.json_ok({
                    "mcp_url": MCP_URL,
                    "mcp_ready": BRIDGE._session is not None,
                    "mcp_error": BRIDGE.error,
                    "tools": len(BRIDGE.tools),
                    "cached_keys": len(CACHE),
                })
                return

            if path == "/api/search":
                term = q.get("q", "").strip()
                if not term:
                    self.json_err("q is required", 400)
                    return
                args = {"query": term, "limit": int(q.get("limit", 12))}
                if q.get("type") in {"all", "concepts", "indicators"}:
                    args["type"] = q["type"]
                if q.get("family"):
                    args["family"] = q["family"]
                key = f"search:{json.dumps(args, sort_keys=True)}"
                self.json_ok(cached(key, lambda: BRIDGE.call("library_search", args)))
                return

            if path == "/api/indicators":
                args = {"page_size": min(int(q.get("page_size", 24)), 100)}
                if q.get("family"):
                    args["family"] = q["family"]
                if q.get("text"):
                    args["text"] = q["text"]
                if q.get("sort") in {"name", "date", "family"}:
                    args["sort"] = q["sort"]
                if q.get("direction") in {"asc", "desc"}:
                    args["direction"] = q["direction"]
                key = f"indicators:{json.dumps(args, sort_keys=True)}"
                self.json_ok(cached(key, lambda: BRIDGE.call("library_list_indicators", args)))
                return

            if path == "/api/source":
                slug = q.get("slug", "").strip()
                if not slug:
                    self.json_err("slug is required", 400)
                    return
                key = f"source:{slug}"
                self.json_ok(cached(key, lambda: BRIDGE.call(
                    "library_get_source_code", {"slug": slug})))
                return

            if path == "/api/concept":
                slug = q.get("slug", "").strip()
                if not slug:
                    self.json_err("slug is required", 400)
                    return
                key = f"concept:{slug}"
                self.json_ok(cached(key, lambda: BRIDGE.call(
                    "library_get_concept", {"slug": slug})))
                return

            self.json_err(f"unknown endpoint {path}", 404)

        # ---------- static ----------
        def serve_static(self, path: str) -> None:
            rel = path.lstrip("/") or "index.html"
            target = (frontend / rel).resolve()
            if frontend.resolve() not in target.parents and target != frontend.resolve():
                self.json_err("forbidden", 403)
                return
            if target.is_dir():
                target = target / "index.html"
            if not target.is_file():
                self.json_err("not found", 404)
                return
            ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in {"application/javascript", "application/json"}:
                ctype += "; charset=utf-8"
            self._send(200, target.read_bytes(), ctype)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--frontend", default="../frontend")
    args = parser.parse_args()

    frontend = Path(args.frontend)
    if not frontend.is_absolute():
        frontend = (Path(__file__).parent / args.frontend).resolve()
    if not frontend.is_dir():
        raise SystemExit(f"frontend dir not found: {frontend}")

    print(f"[boot] connecting to {MCP_URL} ...")
    BRIDGE.start()
    if BRIDGE.error:
        print(f"[boot] MCP problem: {BRIDGE.error} (UI will show a banner)")
    else:
        print(f"[boot] MCP ready with {len(BRIDGE.tools)} tools")

    httpd = ThreadingHTTPServer((args.host, args.port), build_router(frontend))
    print(f"[boot] serving {frontend} on http://{args.host}:{args.port}/")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[boot] stopped")


if __name__ == "__main__":
    main()
