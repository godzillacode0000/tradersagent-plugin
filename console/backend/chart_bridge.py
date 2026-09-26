"""The bridge between the Hermes agent and the live Vela chart.

The chart lives in a browser tab; the agent lives in a process. Neither can call the other, so both
talk to this module through the console's HTTP API:

    page   --POST /api/chart/state-->    state.json     what the chart is showing right now
    agent  --POST /api/chart/command-->  commands.json  what the agent wants done on the chart
    page   --GET  /api/chart/commands--> commands.json  picked up, then executed on the live chart
    page   --POST /api/chart/result-->   results.json   what actually happened (series, errors)

Everything is a plain JSON file under <root>/_chart/, so a restart loses nothing, the queue is
readable by a human, and the agent can prove what it asked for versus what the page did.
A chart picture arrives as a data URL in a result and is decoded to <root>/_chart/shots/<id>.png.
"""

from __future__ import annotations

import base64
import json
import re
import time
from pathlib import Path
from typing import Any

STATE_FILE = "state.json"
COMMANDS_FILE = "commands.json"
RESULTS_FILE = "results.json"
MAX_SHOTS = 12          # keep the last handful of pictures; this box has a small disk
MAX_RESULTS = 60        # the agent only ever reads the newest results
STALE_AFTER = 30.0      # a state older than this means "no chart is open"
MIN_SHOT_BYTES = 256    # a real chart capture is tens of KB; anything this small is a placeholder
DEFAULT_CANVAS_W = 300  # the browser's default canvas size — the shape a non-painting capture has
DEFAULT_CANVAS_H = 150

DATA_URL = re.compile(r"^data:image/(png|jpeg|jpg|webp);base64,(?P<body>[A-Za-z0-9+/=\s]+)$", re.S)


def _chart_dir(root: str | Path) -> Path:
    d = Path(root) / "_chart"
    d.mkdir(parents=True, exist_ok=True)
    (d / "shots").mkdir(exist_ok=True)
    return d


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def _write(path: Path, value: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False), "utf-8")
    tmp.replace(path)


def _decode_shot(root: str | Path, name: str, data_url: str) -> str | None:
    """Write a data-URL picture to shots/<name>.png and return its path (None if it is not a chart)."""
    m = DATA_URL.match((data_url or "").strip())
    if not m:
        return None
    try:
        raw = base64.b64decode(m.group("body"))
    except (ValueError, TypeError):
        return None
    if len(raw) < MIN_SHOT_BYTES:   # a 1x1 placeholder is not a chart
        return None
    if _is_default_canvas(raw):
        # A renderer that is not painting answers a capture with an untitled 300x150 canvas. It is
        # 1.6 KB of blank PNG — big enough to pass a byte check, and a picture of nothing handed to
        # the agent reads as "the chart is empty". Refuse it instead: no picture is the honest answer.
        return None
    out = _chart_dir(root) / "shots" / f"{name}.png"
    out.write_bytes(raw)
    # Prune by AGE, never by filename: as strings "shot-126" sorts BEFORE "shot-55", so a name sort
    # deleted the picture that had just been written and kept week-old ones — the CLI then reported
    # "captured 10 KB" and handed the caller a path that did not exist.
    shots = sorted((_chart_dir(root) / "shots").glob("*.png"), key=_shot_mtime)
    for old in shots[:-MAX_SHOTS]:
        old.unlink(missing_ok=True)
    return str(out)


def _is_default_canvas(raw: bytes) -> bool:
    """True for the blank 300x150 canvas an unattached/occluded renderer returns to `toDataURL()`."""
    if len(raw) < 24 or raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR":
        return False
    width = int.from_bytes(raw[16:20], "big")
    height = int.from_bytes(raw[20:24], "big")
    return width == DEFAULT_CANVAS_W and height == DEFAULT_CANVAS_H


def _shot_mtime(path: Path) -> float:
    """Sort key for the shot sweep; a file that vanished mid-glob must not raise."""
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def save_state(root: str | Path, payload: dict) -> dict:
    """The page's heartbeat: what the chart is showing. Never raises on odd input."""
    d = _chart_dir(root)
    prev = _read(d / STATE_FILE, {}) or {}
    state = {
        "at": time.time(),
        "symbol": str(payload.get("symbol") or "—"),
        "timeframe": str(payload.get("timeframe") or "—"),
        "last": payload.get("last"),
        "visible": payload.get("visible") or {},
        "natives": payload.get("natives") or [],
        # What is actually ON the chart, with the reader that saw each row (study/cell/overlay/paint/
        # native). `natives` is Vela's own names only, and a script mounted from the Library is not
        # one — the pane counted 1 indicator while the state said `natives: []` (26 Sep).
        "studies": payload.get("studies") or [],
        "drawings": payload.get("drawings"),
        "series": payload.get("series"),
        "bars": payload.get("bars"),
        "layout": payload.get("layout"),
        # Which console instance wrote this heartbeat, and which build of the frontend it loaded. The
        # server's own stamp is /api/build; when the two disagree that view is a stale frame — the
        # condition that once turned "it should have refreshed by now" into guesswork.
        "build": str(payload.get("build") or ""),
        "viewer": str(payload.get("viewer") or ""),
        # The page publishes what IT can execute (frontend/chart-bridge.js). The server validates
        # commands against this list, because a whitelist living only in the backend drifted from the
        # page once already: an action passed validation, reached a page with no such case, and the
        # command came back "unknown action" with nothing done. Sanitised here — it decides what may
        # be executed later, and it arrives from a page.
        "actions": ([str(a).strip().lower() for a in payload.get("actions")
                     if isinstance(a, (str, bytes)) and str(a).strip()]
                    if isinstance(payload.get("actions"), (list, tuple)) else []),
        "timeframe_reported": payload.get("timeframe_reported"),
    }
    if payload.get("shot"):
        path = _decode_shot(root, f"hb-{int(state['at'])}", str(payload["shot"]))
        if path:
            state["shot"] = path
        else:
            state["note"] = "the picture with this heartbeat was unusable"
    if "shot" not in state and prev.get("shot"):
        state["shot"] = prev["shot"]          # a heartbeat without a usable picture keeps the last one
    _write(d / STATE_FILE, state)
    return state


def load_state(root: str | Path, max_age: float = STALE_AFTER) -> dict:
    """What the chart is showing, or {open: False} when no page has reported in recently."""
    state = _read(_chart_dir(root) / STATE_FILE, None)
    if not state:
        return {"open": False, "reason": "no page has reported yet"}
    age = time.time() - float(state.get("at") or 0)
    state["age_s"] = round(age, 1)
    state["open"] = age <= max_age
    if not state["open"]:
        state["reason"] = f"the last chart heartbeat was {round(age)}s ago — is the chart open?"
    return state


def enqueue(root: str | Path, command: dict) -> dict:
    """Queue one action for the live chart. Returns the command with the id the page will report back."""
    d = _chart_dir(root)
    cmds = _read(d / COMMANDS_FILE, []) or []
    cid = int(cmds[-1]["id"]) + 1 if cmds else 1
    entry = {"id": cid, "at": time.time(), **{k: v for k, v in command.items() if k != "id"}}
    cmds.append(entry)
    _write(d / COMMANDS_FILE, cmds[-MAX_RESULTS:])
    return entry


def commands_since(root: str | Path, since: int = 0) -> list[dict]:
    """Commands the page has not executed yet (it passes the last id it handled)."""
    cmds = _read(_chart_dir(root) / COMMANDS_FILE, []) or []
    return [c for c in cmds if int(c.get("id") or 0) > int(since or 0)]


def record_result(root: str | Path, payload: dict) -> dict:
    """The page's report for one command. A picture in the payload is decoded and replaced by its path."""
    d = _chart_dir(root)
    rid = int(payload.get("id") or 0)
    result = {
        "id": rid,
        "at": time.time(),
        "ok": bool(payload.get("ok")),
        "detail": str(payload.get("detail") or ""),
        "series": payload.get("series"),
        "added": payload.get("added"),
        "ms": payload.get("ms"),
        # The page's evidence for a mutation: the stable failure code + hint (pinets-runner.js) and
        # what the surface looked like AFTER the call. Dropping these here is invisible in the page
        # and reads as "the tool reported nothing" to the agent, so they are carried through as-is.
        "error": payload.get("error"),
        "onCanvas": payload.get("onCanvas"),
        "natives": payload.get("natives"),
        "last": payload.get("last"),
        "bars": payload.get("bars"),
        "symbol": payload.get("symbol"),
        "timeframe": payload.get("timeframe"),
        # A surface's own after-state. Same lesson as `onCanvas`: the store whitelists, so a new
        # field the page correctly reports arrives empty and reads as "no answer".
        "browse": payload.get("browse"),
        # The grid (`layout` door): the id it resolved to and the cells it built.
        "layout": payload.get("layout"),
        "cells": payload.get("cells"),
        # The built-in catalogue (`natives` door) and the Indicators surface's after-state
        # (`indicators` door): rows the grid actually painted, so a panel that opened empty cannot
        # read as a filled one.
        "catalog": payload.get("catalog"),
        "indicators": payload.get("indicators"),
        # The pane's own "what is on the chart" list (`studies` door): every reader, labelled.
        "studies": payload.get("studies"),
        "doors": payload.get("doors"),
    }
    if payload.get("shot"):
        path = _decode_shot(root, f"shot-{rid}", str(payload["shot"]))
        if path:
            result["shot"] = path
        else:
            result["detail"] = (result["detail"] + " · the picture came back unusable").strip(" ·")
    results = _read(d / RESULTS_FILE, []) or []
    results = [r for r in results if int(r.get("id") or 0) != rid] + [result]
    _write(d / RESULTS_FILE, results[-MAX_RESULTS:])
    return result


def get_result(root: str | Path, rid: int) -> dict | None:
    for r in _read(_chart_dir(root) / RESULTS_FILE, []) or []:
        if int(r.get("id") or 0) == int(rid):
            return r
    return None
