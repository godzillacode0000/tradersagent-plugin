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
import os
import re
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

STATE_FILE = "state.json"
COMMANDS_FILE = "commands.json"
RESULTS_FILE = "results.json"
NEXT_ID_FILE = "next_id.json"
# Every read-modify-write below runs under this lock: ThreadingHTTPServer gives each request its own thread, and
# two agent calls in parallel used to share one fixed temp name (HTTP 500s), read the same last id (duplicate
# ids, so the page dropped the second command) and overwrite each other's list (lost commands). Audit 8 Oct, BE-1.
_LOCK = threading.RLock()
MAX_SHOTS = 12          # keep the last handful of pictures; this box has a small disk
MAX_RESULTS = 60        # the agent only ever reads the newest results
STALE_AFTER = 30.0      # a state older than this means "no chart is open"
OWNER_WINDOW = 90.0     # how recently a view must have heartbeat to be a candidate to OWN the desk
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
    """Atomic: a temp file of its OWN name (never shared between two writers), then a rename."""
    fd, name = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(value, ensure_ascii=False))
        os.replace(name, path)
    except BaseException:
        try:
            os.unlink(name)
        except OSError:
            pass
        raise


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
    with _LOCK:
        return _save_state(root, payload)


def _save_state(root: str | Path, payload: dict) -> dict:
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
        # What the page has STORED for its next boot (frontend/chart-bridge.js): the one run the
        # overlay can bring back. `studies` above is what is live; this is what survives a pane
        # close. The two disagreeing used to be invisible until the operator reopened the pane and
        # found nothing (18 Oct), so the page publishes it and it rides the state like the rest.
        "store": payload.get("store"),
        # The page's own explanation of why it reads what it reads (workspace ready? cells? the error
        # that dropped it to the bare chart?). Passthrough, never interpreted here — a heartbeat that
        # says "—" with a healthy pane is exactly the case this exists to end.
        "diag": payload.get("diag"),
    }
    if payload.get("shot"):
        path = _decode_shot(root, f"hb-{int(state['at'])}", str(payload["shot"]))
        if path:
            state["shot"] = path
        else:
            state["note"] = "the picture with this heartbeat was unusable"
    if "shot" not in state and prev.get("shot"):
        state["shot"] = prev["shot"]          # a heartbeat without a usable picture keeps the last one
    # Per-view freshness (19 Oct): the desk's owner is decided from the last heartbeats (see
    # _owner_from_views), not from whoever claims a command first. Kept generously (10 min) so a view
    # throttled while its window was hidden can come back as itself; `owner` is what the claim door
    # and the page's banner read.
    views = {}
    for vid, entry in (prev.get("views") or {}).items():
        if not isinstance(entry, dict):
            continue
        try:
            if state["at"] - float(entry.get("at") or 0.0) <= 600.0:
                views[str(vid)] = entry
        except (TypeError, ValueError):
            continue
    if state["viewer"]:
        entry = {"at": state["at"], "hidden": bool(payload.get("hidden"))}
        try:
            if state.get("bars"):
                entry["bars"] = int(state["bars"])
        except (TypeError, ValueError):
            pass
        if (views.get(state["viewer"]) or {}).get("claimed"):
            entry["claimed"] = True           # the operator said "use this view" — it stays said
        views[state["viewer"]] = entry
    state["views"] = views
    state["owner"] = _owner_from_views(views, state["at"])
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
    state.setdefault("owner", _owner_from_views(_views_of(state), time.time()))
    if not state["open"]:
        state["reason"] = (f"the last chart heartbeat was {round(age)}s ago — is the chart open? "
                           f"(the desktop pane remounts itself after a minute of silence, or click "
                           f"the Trader's Agent row)")
    return state


def _owner_from_views(views: dict, now: float) -> str:
    """Which view owns the desk, decided from the heartbeats (19 Oct).

    The rule, in order: the NEWEST view that is visible and either reports bars or was explicitly
    claimed; else the newest with bars; else the newest. A hidden or bar-less view can therefore
    never take the desk from a working one — the failure this exists for was a second tab (or an
    occluded frame) consuming a command and answering "the chart did not answer … within 45s" while
    the operator's pane stood ready.
    """
    fresh = []
    for vid, entry in (views or {}).items():
        if not isinstance(entry, dict):
            continue
        try:
            at = float(entry.get("at") or 0.0)
        except (TypeError, ValueError):
            continue
        if now - at <= OWNER_WINDOW:
            fresh.append((at, str(vid), entry))
    if not fresh:
        return ""
    claimed = [row for row in fresh if row[2].get("claimed")]           # the operator said so
    visible = [row for row in fresh if not row[2].get("hidden") and row[2].get("bars")]
    with_bars = [row for row in fresh if row[2].get("bars")]
    pool = claimed or visible or with_bars or fresh
    return max(pool, key=lambda row: row[0])[1]


def _views_of(state: dict) -> dict:
    """The state's per-view map, whatever shape the file is actually in."""
    views = state.get("views") if isinstance(state, dict) else None
    return views if isinstance(views, dict) else {}


def owner_of(root: str | Path, now: float | None = None) -> str:
    """The id of the view that owns the desk right now, or '' when no view has reported recently."""
    state = _read(_chart_dir(root) / STATE_FILE, {}) or {}
    views = _views_of(state)
    if not views:
        return ""                                  # no per-view record: legacy single-view behaviour
    return _owner_from_views(views, now if now is not None else time.time())


def take_ownership(root: str | Path, viewer: str) -> str:
    """Make one view the owner deliberately (the passive banner's button). Returns the new owner."""
    who = str(viewer or "").strip()
    if not who:
        return ""
    with _LOCK:
        d = _chart_dir(root)
        state = _read(d / STATE_FILE, {}) or {}
        views = _views_of(state)
        entry = dict(views.get(who) or {})
        entry.update({"at": time.time(), "hidden": False, "claimed": True})
        views[who] = entry
        state["views"] = views
        state["owner"] = _owner_from_views(views, time.time())
        _write(d / STATE_FILE, state)
        return str(state["owner"])


def enqueue(root: str | Path, command: dict) -> dict:
    """Queue one action for the live chart. Returns the command with the id the page will report back."""
    with _LOCK:
        d = _chart_dir(root)
        cmds = _read(d / COMMANDS_FILE, []) or []
        cid = _next_id(d, cmds)
        entry = {"id": cid, "at": time.time(), **{k: v for k, v in command.items() if k != "id"}}
        cmds.append(entry)
        _write(d / COMMANDS_FILE, cmds[-MAX_RESULTS:])
        return entry


def _next_id(d: Path, cmds: list) -> int:
    """The next command id. It lives in its own file and only ever grows: derived from the (capped, and
    recreated-empty-on-a-parse-error) command list, ids restarted at 1 and an old result answered for a new
    command (BE-16)."""
    last = 0
    try:
        last = int((_read(d / NEXT_ID_FILE, {}) or {}).get("last") or 0)
    except (TypeError, ValueError):
        last = 0
    for c in cmds:
        try:
            last = max(last, int(c.get("id") or 0))
        except (TypeError, ValueError):
            continue
    cid = last + 1
    _write(d / NEXT_ID_FILE, {"last": cid})
    return cid


def commands_since(root: str | Path, since: int = 0) -> list[dict]:
    """Commands the page has not executed yet (it passes the last id it handled)."""
    cmds = _read(_chart_dir(root) / COMMANDS_FILE, []) or []
    return [c for c in cmds if int(c.get("id") or 0) > int(since or 0)]


def record_result(root: str | Path, payload: dict) -> dict:
    """The page's report for one command. A picture in the payload is decoded and replaced by its path."""
    try:
        rid = int(payload.get("id"))
    except (TypeError, ValueError, OverflowError):
        raise ValueError("a result needs the integer id of the command it answers") from None
    if rid <= 0:
        raise ValueError("a result needs the id of the command it answers (a positive integer)")
    with _LOCK:
        return _record_result(root, payload, rid)


def _record_result(root: str | Path, payload: dict, rid: int) -> dict:
    d = _chart_dir(root)
    result = {
        "id": rid,
        "at": time.time(),
        "ok": bool(payload.get("ok")),
        "detail": str(payload.get("detail") or ""),
        "series": payload.get("series"),
        "added": payload.get("added"),
        "ms": payload.get("ms"),
        # A run's own after-state, found missing by running one (round 5): `apply` reports `ran`,
        # the read-back breakdown in `painted`, and for a strategy()-only run `result: 'metrics'`.
        # The page set them; this whitelist dropped them; so the field the round-4 contract
        # introduced (`result`) never reached the agent. Same lesson as `onCanvas` above.
        "ran": payload.get("ran"),
        "painted": payload.get("painted"),
        "result": payload.get("result"),
        "strategy": payload.get("strategy"),
        "ctor": payload.get("ctor"),
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
        # The Indicators surface's after-state. It is carried whole (a nested dict), so a field the
        # page adds inside it — `family`, `families`, `groups`, `reading` (27 Sep) — travels with it;
        # that is why only the key is named here.
        "indicators": payload.get("indicators"),
        # Full screen for the chart (27 Sep): {fullscreen, native, page} — `native` says whether the
        # console also took the display, or only the page.
        "fullscreen": payload.get("fullscreen"),
        # The pane's own "what is on the chart" list (`studies` door): every reader, labelled.
        "studies": payload.get("studies"),
        "doors": payload.get("doors"),
        # Edge Stats (`edge` door): what the sheet actually shows after the call — view, symbol and the
        # answer's N / estimate. Named here because the store whitelists: without it the agent is told
        # "ok" and never what is on screen.
        "edge": payload.get("edge"),
        # `inputs` on apply / draw / script (and `mode: inputs`): what was applied, what was refused and
        # why, and the settings the script does declare. Named here because the store whitelists — without
        # it the agent is told "ok" and never that a label it sent was ignored.
        "inputs": payload.get("inputs"),
        # Reported by the page, dropped by this whitelist until the 8 Oct audit (BE-15): `trades` is the whole
        # point of the `signals` op (the trades the backtester prices), the rest are the after-state of their doors.
        "count": payload.get("count"),
        "trades": payload.get("trades"),
        "theme": payload.get("theme"),
        "replay": payload.get("replay"),
        "reloading": payload.get("reloading"),
        "rect": payload.get("rect"),
        "palette": payload.get("palette"),
        "overlay": payload.get("overlay"),
        "opened": payload.get("opened"),
        "lines": payload.get("lines"),
        "drawer": payload.get("drawer"),
        "alreadyPresent": payload.get("alreadyPresent"),
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
