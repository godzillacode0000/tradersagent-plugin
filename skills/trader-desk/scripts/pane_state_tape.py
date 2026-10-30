#!/usr/bin/env python3
"""Watch the live console read-only and log what its pages report, transition by transition.

Use when the operator says the pane "resets" / "comes back to default" on close and reopen: this is the
outside-in measurement of THEIR pane. `/api/chart/state` is the last page's own report (viewer, symbol,
timeframe, natives, studies, drawings); `/api/chart/stream/status` is attached views (`views`). Poll both,
ask the operator for one close -> wait a few seconds -> reopen, then read the tape.

    ./.venv/bin/python scripts/pane_state_tape.py --seconds 300 --out /tmp/pane-tape.jsonl

Reading the tape (the shapes and what they mean) is section 1's "take a tape" note in
references/pane-state-and-caches.md. In short:
  * views 1 -> 2 -> 1 with two new viewer ids: the pane loads the page twice per reopen; one dies.
  * a fresh viewer at symbol "-" / build "pending" for ~10 s is the page starting, not a reset.
  * a settled viewer naming the operator's symbol/timeframe = the restore worked.
  * empty natives/studies/drawings at that moment = there was nothing of that kind to lose.

Read-only: GET /api/chart/state needs no token on this console; nothing here writes.
"""
import argparse
import json
import time
import urllib.request


def get(url: str) -> dict:
    return json.load(urllib.request.urlopen(url, timeout=5))


def main() -> None:
    ap = argparse.ArgumentParser(description="Log the console's chart-state transitions for N seconds.")
    ap.add_argument("--base", default="http://127.0.0.1:8787", help="console origin")
    ap.add_argument("--seconds", type=int, default=300, help="how long to watch")
    ap.add_argument("--out", default="/tmp/pane-tape.jsonl", help="tape file (JSON lines)")
    a = ap.parse_args()

    out = open(a.out, "w")
    started = time.time()
    last = None
    tick = 0
    while time.time() - started < a.seconds:
        tick += 1
        row = {"t": time.strftime("%H:%M:%S")}
        try:
            st = get(a.base + "/api/chart/state")["data"]
            row.update({k: st.get(k) for k in
                        ("viewer", "symbol", "timeframe", "natives", "studies", "drawings", "bars", "build")})
        except Exception as exc:                      # a restart looks like this
            row["state_error"] = str(exc)[:100]
        try:
            row["views"] = get(a.base + "/api/chart/stream/status")["data"].get("views")
        except Exception as exc:
            row["stream_error"] = str(exc)[:100]
        key = (row.get("viewer"), row.get("symbol"), row.get("timeframe"), row.get("views"),
               str(row.get("natives")), str(row.get("studies")), str(row.get("drawings")))
        if key != last or tick % 5 == 0:              # transitions, plus a heartbeat
            out.write(json.dumps(row) + "\n")
            out.flush()
            last = key
        time.sleep(2)
    out.write(json.dumps({"t": time.strftime("%H:%M:%S"), "done": True}) + "\n")
    out.close()
    print("tape written to", a.out)


if __name__ == "__main__":
    main()
