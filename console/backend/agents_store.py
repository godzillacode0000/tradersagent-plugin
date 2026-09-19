"""Study store — one folder per study, and it grows.

A study is not a fixed concept: it is a folder holding its brief, its Hermes session id, counters
and an append-only learnings ledger, plus the scripts it produced under studies/<id>/. Deleting
moves the folder to `.trash` (never unlink), so weeks of work stay recoverable by hand.
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import tempfile
import time

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,31}$")
INDEX = "index.json"
LEARNINGS = "learnings.md"

SEED = {
    "id": "desk",
    "name": "Desk",
    "blurb": "general trading-research study — grows with whatever you bring",
    "instruction": ("You are the operator's trading-research study, sitting beside his live Vela chart "
                    "(the Trader's Agent pane). Read the chart before you reason about it — "
                    "chart_state, then chart_shot when the picture matters — and act on it with the "
                    "chart tools: chart_add_indicator, chart_draw, chart_apply_pine, chart_set_market, "
                    "chart_clear. One indicator at a time on one chart, and report what the chart "
                    "actually shows afterwards. Always return Pine v6 source in a fenced ```pine "
                    "block plus one paragraph on how to read it, and say plainly when something "
                    "cannot run in PineTS."),
    "skills": ["trader-desk", "luxalgo-mcp"],
    "toolsets": [],
}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def validate(record: dict) -> dict:
    """Normalise a record or raise ValueError. Never trust the browser."""
    if not isinstance(record, dict):
        raise ValueError("study must be an object")
    sid = str(record.get("id", "")).strip()
    if not ID_RE.match(sid):
        raise ValueError("id must be a lowercase slug of 2-32 chars (a-z, 0-9, -)")
    name = str(record.get("name", "")).strip()
    if not name:
        raise ValueError("name must not be empty")
    instruction = str(record.get("instruction", "")).strip()
    if not instruction:
        raise ValueError("instruction must not be empty")
    skills = record.get("skills") or []
    toolsets = record.get("toolsets") or []
    if not isinstance(skills, list) or not isinstance(toolsets, list):
        raise ValueError("skills and toolsets must be lists of strings")
    counters = record.get("counters") or {}
    return {
        "id": sid,
        "name": name[:64],
        "blurb": str(record.get("blurb", ""))[:160],
        "instruction": instruction[:4000],
        "skills": [str(s)[:64] for s in skills][:8],
        "toolsets": [str(t)[:64] for t in toolsets][:8],
        "session_id": (str(record["session_id"]) if record.get("session_id") else None),
        "created_at": str(record.get("created_at") or _now()),
        "last_active": record.get("last_active"),
        "counters": {"runs": int(counters.get("runs", 0)),
                     "backtests": int(counters.get("backtests", 0))},
    }


def _dir(root: str, sid: str) -> str:
    if not ID_RE.match(sid or ""):
        raise ValueError("bad study id")
    return os.path.join(root, sid)


def _write_json(path: str, doc: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def ensure_seed(root: str) -> None:
    if not os.path.isdir(_dir(root, SEED["id"])):
        upsert(root, dict(SEED))


def list_studies(root: str) -> list[dict]:
    ensure_seed(root)
    out = []
    for name in sorted(os.listdir(root)):
        if name.startswith(".") or not os.path.isdir(os.path.join(root, name)):
            continue
        try:
            out.append(load(root, name))
        except (OSError, ValueError, json.JSONDecodeError):
            continue                      # a corrupt study must never break the list
    return out


def load(root: str, sid: str) -> dict:
    with open(os.path.join(_dir(root, sid), INDEX), encoding="utf-8") as fh:
        return validate(json.load(fh))


def upsert(root: str, record: dict) -> dict:
    """Public edit path (the browser): merge, so an edit never loses server-owned fields."""
    clean = validate(record)
    try:
        existing = load(root, clean["id"])
    except (OSError, ValueError, json.JSONDecodeError):
        existing = None
    if existing:
        clean["session_id"] = clean["session_id"] or existing["session_id"]
        clean["created_at"] = existing["created_at"]
        clean["last_active"] = existing["last_active"]
        clean["counters"] = existing["counters"]
    return _write(root, clean)


def _write(root: str, record: dict) -> dict:
    """Server-side mutation: written as given, with no merge.

    The merge above exists for *edits*; using it for `record_run` silently restored the counters
    read from disk and discarded the increment (caught by
    test_session_and_counters_survive_an_edit).
    """
    clean = validate(record)
    folder = _dir(root, clean["id"])
    os.makedirs(folder, exist_ok=True)
    _write_json(os.path.join(folder, INDEX), clean)
    ledger = os.path.join(folder, LEARNINGS)
    if not os.path.exists(ledger):
        with open(ledger, "w", encoding="utf-8") as fh:
            fh.write(f"# Learnings — {clean['name']}\n\nWritten after runs and backtests.\n")
    return clean


def delete(root: str, sid: str) -> bool:
    folder = _dir(root, sid)
    if not os.path.isdir(folder):
        return False
    trash = os.path.join(root, ".trash")
    os.makedirs(trash, exist_ok=True)
    shutil.move(folder, os.path.join(trash, f"{sid}-{int(time.time())}"))
    return True


def set_session(root: str, sid: str, session_id: str) -> dict:
    rec = load(root, sid)
    rec["session_id"] = session_id or None
    return _write(root, rec)


def record_run(root: str, sid: str, kind: str = "run") -> dict:
    rec = load(root, sid)
    rec["counters"]["runs"] = rec["counters"].get("runs", 0) + 1
    if kind == "backtest":
        rec["counters"]["backtests"] = rec["counters"].get("backtests", 0) + 1
    rec["last_active"] = _now()
    return _write(root, rec)


def append_learning(root: str, sid: str, title: str, body: str) -> str:
    """Append one structured block — the growth record that feeds the next prompt."""
    load(root, sid)                       # raises on an unknown study
    path = os.path.join(_dir(root, sid), LEARNINGS)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(f"\n## {_now()} · {str(title).strip()[:120]}\n\n{str(body).strip()[:4000]}\n")
    record_run(root, sid, "run")
    return path


def learnings_tail(root: str, sid: str, max_chars: int = 2000) -> str:
    """The tail of the ledger — prepended to every prompt so a study never starts cold."""
    try:
        with open(os.path.join(_dir(root, sid), LEARNINGS), encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return ""
    return text[-max_chars:] if len(text) > max_chars else text


def save_shot(root: str, sid: str, data_url: str) -> str:
    """Save a chart PNG the dock captured, so the agent can LOOK at the chart, not just read numbers.

    This is half of the bidirectional link: the chart's picture goes out with the prompt and the
    agent's vision tool can analyse it. Rejects anything that is not a bounded PNG data URL.
    """
    match = re.match(r"^data:image/png;base64,([A-Za-z0-9+/=]+)$", (data_url or "").strip())
    if not match:
        raise ValueError("expected a data:image/png;base64 URL")
    raw = base64.b64decode(match.group(1), validate=True)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("screenshot larger than 8 MB")
    load(root, sid)                       # raises on an unknown study
    folder = os.path.join(_dir(root, sid), "shots")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, time.strftime("%Y%m%d-%H%M%S") + ".png")
    with open(path, "wb") as fh:
        fh.write(raw)
    return path
