#!/usr/bin/env python3
"""Download Dukascopy tick files for the instruments this desk trades.

Uses Dukascopy's **v1 tick API** (`https://jetta.dukascopy.com/v1/ticks/<CODE>/<Y>/<M>/<D>/<H>`) rather
than the older `/datafeed/…bi5` paths: the v1 endpoint answers JSON, has been far more tolerant of a
bulk walk (the bi5 host kept resetting our connections), and its month field is **1-based** — note the
opposite convention from `/datafeed/`, which is 0-based. Instrument codes carry a dash and the class,
e.g. `GBP-USD`, `XAU-USD`, `USATECH.IDX-USD`.

Response shape (one instrument-hour):

    {"timestamp": <epoch ms at the hour>, "multiplier": 1e-5,
     "ask": <first ask>, "bid": <first bid>,
     "times": [delta ms…], "asks": [delta ticks…], "bids": [delta ticks…],
     "askVolumes": […], "bidVolumes": […]}

`times`, `asks` and `bids` are DELTAS — cumulative-sum them to recover the tick, then
`price = base + cumulative_delta * multiplier`. Getting this wrong yields plausible-looking prices
that drift, so the decoder here is a single function with a test.

Storage: one gzipped JSON per instrument-hour under
`~/.local/share/traders-agent/fx/ticks-v1/<SYMBOL>/<YYYY-MM-DD>/<HH>.json.gz`, plus a small `.empty`
marker for hours that answer 404 (market shut/holiday) so a resume does not re-ask. The raw payload is
kept, not a re-encoding: a decoder bug can always be re-run over the bytes. Each hour is written to a
`.part` file and renamed into place, so an interrupted walk never leaves a half hour that a resume would
call cached. The walk stops at the last COMPLETE hour, and a 404 younger than a day is not marked: the
feed may simply not have published it yet.

Usage:
    python3 tools/fx-fetch.py --years 2 --workers 4            # the full walk
    python3 tools/fx-fetch.py --days 3 --instruments GBPUSD    # a smoke run
    python3 tools/fx-fetch.py --report                          # what is on disk
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = "https://jetta.dukascopy.com/v1/ticks"
HOME = Path(os.environ.get("TRADERS_FX_TICKS") or Path.home() / ".local/share/traders-agent/fx/ticks-v1")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
INSTRUMENTS = {
    "GBPUSD": "GBP-USD",
    "EURUSD": "EUR-USD",
    "GBPJPY": "GBP-JPY",
    "XAUUSD": "XAU-USD",
    "XAGUSD": "XAG-USD",
    "NAS100": "USATECH.IDX-USD",       # "US 100 Tech Index"
    "SP500": "USA500.IDX-USD",
}
HOURS_PER_DAY = 24
SETTLE = dt.timedelta(hours=24)        # a 404 younger than this may be publishing lag, not a shut market

_print_lock = threading.Lock()


def hour_path(symbol: str, when: dt.datetime) -> Path:
    return HOME / symbol / when.strftime("%Y-%m-%d") / f"{when.hour:02d}.json.gz"


def marker_path(symbol: str, when: dt.datetime) -> Path:
    return HOME / symbol / when.strftime("%Y-%m-%d") / f"{when.hour:02d}.empty"


def last_complete_hour(now: dt.datetime) -> dt.datetime:
    """The newest hour that has ended — the current one is still being written by the feed."""
    return now.replace(minute=0, second=0, microsecond=0) - dt.timedelta(hours=1)


def decode_hour(doc: dict) -> list[tuple[int, float, float, float, float]]:
    """Ticks as `(epoch_ms, bid, ask, bid_volume, ask_volume)` from Dukascopy's delta encoding.

    `times` are milliseconds SINCE THE PREVIOUS TICK, `bids`/`asks` are ticks since the previous
    price; both need a running sum. Prices are `base + sum(delta) * multiplier`.
    """
    base_t = int(doc["timestamp"])
    mult = float(doc["multiplier"])
    bid0, ask0 = float(doc["bid"]), float(doc["ask"])
    t = bid = ask = 0
    out = []
    for dtm, db, da, bv, av in zip(doc.get("times", []), doc.get("bids", []), doc.get("asks", []),
                                   doc.get("bidVolumes", []), doc.get("askVolumes", [])):
        t += int(dtm)
        bid += int(db)
        ask += int(da)
        out.append((base_t + t, bid0 + bid * mult, ask0 + ask * mult, float(bv), float(av)))
    return out


def _fetch(code: str, when: dt.datetime, attempts: int = 4) -> tuple[str, bytes]:
    """One hour → (`ok`, payload) · (`empty`, b"") · (`fail`, b"")."""
    url = f"{API}/{code}/{when.year}/{when.month}/{when.day}/{when.hour}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*",
                                               "Referer": "https://www.dukascopy.com/"})
    last = ""
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=40) as res:
                return "ok", res.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (400, 404, 422):        # unknown hour: shut market / holiday / bad code
                return "empty", b""
            last = f"HTTP {exc.code}"
        except Exception as exc:                    # noqa: BLE001 - resets, timeouts, TLS
            last = str(exc)[:80]
        time.sleep(1.2 * (attempt + 1))
    return "fail:" + last, b""


def fetch_one(symbol: str, code: str, when: dt.datetime) -> tuple[str, str, int]:
    """Returns (status, symbol, bytes_written). Skips what is already on disk."""
    path = hour_path(symbol, when)
    if path.exists() and path.stat().st_size > 0:
        return "cached", symbol, 0
    if marker_path(symbol, when).exists():
        return "cached", symbol, 0
    status, payload = _fetch(code, when)
    path.parent.mkdir(parents=True, exist_ok=True)
    if status == "ok":
        if not payload:
            marker_path(symbol, when).write_bytes(b"")
            return "empty", symbol, 0
        part = path.with_name(path.name + ".part")
        try:
            with gzip.open(part, "wb", compresslevel=6) as fh:
                fh.write(payload)
            os.replace(part, path)
        finally:
            part.unlink(missing_ok=True)
        return "ok", symbol, len(payload)
    if status == "empty":
        if dt.datetime.now(dt.timezone.utc) - when >= SETTLE:
            marker_path(symbol, when).write_bytes(b"")
        return "empty", symbol, 0
    return status, symbol, 0


def walk(symbols: list[str], start: dt.datetime, end: dt.datetime, workers: int) -> None:
    jobs = [(s, INSTRUMENTS[s], h) for s in symbols for h in _hours(start, end)]
    total = len(jobs)
    done = {"n": 0, "ok": 0, "empty": 0, "cached": 0, "bytes": 0}
    failures: list[str] = []
    t0 = time.time()

    def run(job):
        status, symbol, size = fetch_one(*job)
        with _print_lock:
            done["n"] += 1
            done["bytes"] += size
            if status == "ok":
                done["ok"] += 1
            elif status == "empty":
                done["empty"] += 1
            elif status == "cached":
                done["cached"] += 1
            else:
                failures.append(f"{job[0]} {job[2]:%Y-%m-%d %H}h {status}")
            if done["n"] % 200 == 0 or done["n"] == total:
                el = time.time() - t0
                rate = done["n"] / el if el else 0
                left = (total - done["n"]) / rate / 60 if rate else -1
                print(f"  {done['n']:>6}/{total} · ok {done['ok']} · empty {done['empty']} · "
                      f"cached {done['cached']} · {done['bytes']/1e6:.1f} MB · {rate:.1f}/s · "
                      f"eta {left:.0f} min" + (f" · fails {len(failures)}" if failures else ""),
                      flush=True)

    n_hours = int((end - start).total_seconds() // 3600) + 1
    print(f"fetching {total:,} instrument-hours ({len(symbols)} symbols × "
          f"{n_hours:,} hours) → {HOME}", flush=True)
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        list(pool.map(run, jobs))
    print(f"done: ok {done['ok']} · empty {done['empty']} · cached {done['cached']} · "
          f"{done['bytes']/1e6:.1f} MB in {(time.time()-t0)/60:.1f} min", flush=True)
    if failures:
        print(f"{len(failures)} failures (re-run to retry them):", flush=True)
        for line in failures[:20]:
            print("   ", line, flush=True)


def _hours(start: dt.datetime, end: dt.datetime):
    cur = start.replace(minute=0, second=0, microsecond=0)
    while cur <= end:
        yield cur
        cur += dt.timedelta(hours=1)


def report() -> None:
    if not HOME.exists():
        print("nothing downloaded yet:", HOME)
        return
    grand_n = grand_b = 0
    print(f"{'symbol':8} {'hours':>7} {'empty':>6} {'MB':>8}  coverage")
    for d in sorted(HOME.iterdir()):
        if not d.is_dir():
            continue
        hours = list(d.rglob("*.json.gz"))
        empty = list(d.rglob("*.empty"))
        size = sum(f.stat().st_size for f in hours)
        first = min((f.parent.name for f in hours), default="—")
        last = max((f.parent.name for f in hours), default="—")
        grand_n += len(hours)
        grand_b += size
        print(f"{d.name:8} {len(hours):>7} {len(empty):>6} {size/1e6:>8.1f}  {first} → {last}")
    print(f"{'TOTAL':8} {grand_n:>7} {'':>6} {grand_b/1e6:>8.1f}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Dukascopy v1 tick downloader")
    ap.add_argument("--years", type=float, default=2.0, help="how far back (default 2)")
    ap.add_argument("--days", type=float, help="shortcut: N days back instead of --years")
    ap.add_argument("--instruments", default=",".join(INSTRUMENTS),
                    help="comma list, e.g. GBPUSD,XAUUSD")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args(argv)
    if a.report:
        report()
        return 0
    symbols = [s.strip().upper() for s in a.instruments.split(",") if s.strip()]
    bad = [s for s in symbols if s not in INSTRUMENTS]
    if bad:
        print("unknown instruments:", ", ".join(bad), "· known:", ", ".join(INSTRUMENTS))
        return 2
    end = last_complete_hour(dt.datetime.now(dt.timezone.utc))
    back = dt.timedelta(days=a.days) if a.days else dt.timedelta(days=365.25 * a.years)
    walk(symbols, end - back, end, a.workers)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
