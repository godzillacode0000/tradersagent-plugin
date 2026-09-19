"""Push channel for the chart bridge — Server-Sent Events, stdlib only.

Why this exists: the file bridge works by the chart page *asking* "any command for me?" every couple
of seconds, so every agent command waited on that tick (1-2s of pure overhead, measured). Here the
page instead holds one long-lived request open, and the backend pushes the command the moment it is
queued; the page executes it and posts the result back — which the caller (CLI, MCP tool, curl) can
pick up in the same round trip.

Nothing about the file bridge changes: commands and results are still written to disk, so a view that
is not streaming still works, it just answers on the old schedule. SSE is chosen over WebSockets on
purpose — it is a plain HTTP response, needs no library on either side, and survives this box's
8GB / one-core-budget reality.
"""

from __future__ import annotations

import json
import queue
import threading
import time

KEEPALIVE_S = 8.0     # comment line on an idle stream: keeps the socket warm, and reaps a dead view
RESULT_TTL_S = 60.0   # keep an answered result this long, in case a caller arrives late
WAIT_SLICE_S = 0.02   # how often a waiting caller re-checks


class ChartStream:
    """One instance per server process. Thread-safe: the SSE handler and the API handlers race."""

    def __init__(self, keepalive: float = KEEPALIVE_S, result_ttl: float = RESULT_TTL_S):
        self._lock = threading.Lock()
        self._clients: dict[int, queue.Queue] = {}
        self._next = 1
        self._results: dict[int, tuple[float, dict]] = {}
        self._pushed_at: dict[int, float] = {}
        self._claims: dict[int, set[str]] = {}
        self._once_ids: set[int] = set()      # commands meant for every view (a reload), not one
        self._keepalive = keepalive
        self._result_ttl = result_ttl
        self.pushes = 0
        self.dropped = 0
        self.claims_granted = 0
        self.claims_refused = 0
        self.last_push_ms: float | None = None

    # ── page side ────────────────────────────────────────────────────────────
    def attach(self) -> tuple[int, queue.Queue]:
        """A chart view starts streaming. Returns its id (to detach on disconnect) and its inbox."""
        with self._lock:
            cid = self._next
            self._next += 1
            inbox: queue.Queue = queue.Queue()
            self._clients[cid] = inbox
            return cid, inbox

    def detach(self, client_id: int) -> None:
        with self._lock:
            self._clients.pop(client_id, None)

    def client_count(self) -> int:
        with self._lock:
            return len(self._clients)

    def keepalive(self) -> float:
        return self._keepalive

    # ── who executes a command ──────────────────────────────────────────────
    def claim(self, command_id: int, viewer: str, once: bool = False) -> bool:
        """Exactly one console executes a command — unless the command is meant for *every* console.

        More than one console view can be alive at once (the Hermes pane, the HUD's pane, a browser
        tab). Each receives the same push, so without this every `add ema` ran once per view. The
        first claim wins; later claimants skip and report nothing (the answer is already on its way
        from the winner).

        `once=True` inverts that for the commands that *are* per-view — a `reload` must land in every
        console, or a stale frame stays stale because the freshly reloaded view keeps claiming the
        follow-up reloads first. Each view may run such a command once, and a repeat from the same
        view is its own retry.

        Claiming is in-memory on purpose: it exists to break a same-instant race between live views,
        and the bridge's result file is what tells a view the work is already done after a reload.
        """
        try:
            cid = int(command_id)
        except (TypeError, ValueError):
            return True
        who = str(viewer or "unknown")
        with self._lock:
            owners = self._claims.get(cid)
            if owners is None:
                owners = self._claims[cid] = set()
                if len(self._claims) > 500:
                    for key in sorted(self._claims)[:-250]:
                        self._claims.pop(key, None)
            if who in owners:
                return True                      # its own retry, or its own `once` command again
            if not once and owners:
                self.claims_refused += 1
                return False
            owners.add(who)
            self.claims_granted += 1
            return True

    def is_once(self, command_id: int | None) -> bool:
        """Was this command published for every view (a reload), rather than for one executor?"""
        try:
            cid = int(command_id)
        except (TypeError, ValueError):
            return False
        with self._lock:
            return cid in self._once_ids

    @staticmethod
    def next_event(inbox: queue.Queue, timeout: float) -> str | None:
        """One queued event, or None when the timeout passes (the handler then sends a keepalive)."""
        try:
            return inbox.get(timeout=max(0.05, timeout))
        except queue.Empty:
            return None

    def publish(self, payload: dict, command_id: int | None = None) -> int:
        """Hand one event to every attached view. Returns how many views received it."""
        blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            targets = list(self._clients.values())
            if command_id is not None and payload.get("once_per_view"):
                self._once_ids.add(int(command_id))
                if len(self._once_ids) > 200:
                    self._once_ids = set(sorted(self._once_ids)[-100:])
        sent = 0
        for inbox in targets:
            try:
                inbox.put_nowait(blob)
                sent += 1
            except Exception:  # noqa: BLE001 — a dead client must never break the caller
                self.dropped += 1
        if sent:
            now_ms = time.time() * 1000.0
            self.pushes += 1
            self.last_push_ms = now_ms
            if command_id is not None:
                with self._lock:
                    self._pushed_at[int(command_id)] = now_ms
                    # keep the map from growing without bound
                    if len(self._pushed_at) > 200:
                        for key in sorted(self._pushed_at)[:-100]:
                            self._pushed_at.pop(key, None)
        return sent

    # ── caller side ──────────────────────────────────────────────────────────
    def deliver_result(self, payload: dict) -> dict:
        """A view reported what happened. Stash it, and stamp the push → result latency."""
        out = dict(payload)
        raw_id = out.get("id")
        if raw_id is None:
            return out
        try:
            rid = int(raw_id)
        except (TypeError, ValueError):
            return out
        now_ms = time.time() * 1000.0
        with self._lock:
            pushed_ms = self._pushed_at.pop(rid, None)
            if pushed_ms:
                out["stream_ms"] = round(now_ms - pushed_ms, 1)
            self._results[rid] = (time.time(), out)
            cutoff = time.time() - self._result_ttl
            for key, (ts, _value) in list(self._results.items()):
                if ts < cutoff:
                    self._results.pop(key, None)
        return out

    def result_for(self, command_id: int) -> dict | None:
        with self._lock:
            hit = self._results.get(int(command_id))
        return hit[1] if hit else None

    def wait_for_result(self, command_id: int, timeout: float) -> dict | None:
        """Block until that command's result lands (the fast path) or the timeout runs out."""
        deadline = time.time() + max(0.0, timeout)
        while True:
            found = self.result_for(command_id)
            if found is not None:
                return found
            if time.time() >= deadline:
                return None
            time.sleep(WAIT_SLICE_S)

    def stats(self) -> dict:
        with self._lock:
            views = len(self._clients)
            tracking = len(self._pushed_at)
        return {
            "views": views,
            "pushes": self.pushes,
            "dropped": self.dropped,
            "tracking": tracking,          # in-flight commands still awaiting a result
            "claims_granted": self.claims_granted,
            "claims_refused": self.claims_refused,
            "last_push_ms": self.last_push_ms,
            "keepalive_s": self._keepalive,
        }
