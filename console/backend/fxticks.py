"""Bars built from the local Dukascopy tick store (`tools/fx-fetch.py`).

Why this module exists: the network loader in `fxdata.py` builds M1 from Dukascopy's hourly bi5 files on
demand and cannot do it faster than one request per instrument-hour. The tick walk already put every
hour of the last two years on disk, so a backtest should read those bytes instead of asking the network
again — and, unlike Yahoo, a tick store has a **spread** and a **real tick count per bar**.

What the bars mean:

* price is the **mid** of bid/ask at each tick (`(bid + ask) / 2`), which is what a chart draws;
* `volume` is the **number of ticks** in the bar — a genuine activity measure, not Yahoo's zero;
* `spread` is the mean `ask - bid` over the bar, in price units, so a caller can see what a fill would
  have cost instead of assuming.

Storage read: `~/.local/share/traders-agent/fx/ticks-v1/<SYMBOL>/<YYYY-MM-DD>/<HH>.json.gz`, the shape
`tools/fx-fetch.py` writes (v1 JSON, whole hour, cumulative deltas). `.empty` markers are shut hours.

Resampled bars are cached per symbol/timeframe/month under `fx/bars-v1/…` so a 500-bar request costs one
pass over the hours, not one pass per request.
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
import os
import statistics
from functools import lru_cache
from pathlib import Path

TICKS = Path(os.environ.get("TRADERS_FX_TICKS")
             or Path.home() / ".local/share/traders-agent/fx/ticks-v1")
BARS = Path(os.environ.get("TRADERS_FX_BARS")
            or Path.home() / ".local/share/traders-agent/fx/bars-v1")

SYMBOLS = ("GBPUSD", "EURUSD", "GBPJPY", "XAUUSD", "XAGUSD", "NAS100", "SP500")
TIMEFRAMES = {"1": 1, "5": 5, "15": 15, "30": 30, "60": 60, "120": 120, "240": 240, "D": 1440}


class TickError(Exception):
    """No local ticks for this symbol, or the store cannot serve the window."""


def clean_pair(pair: str) -> str:
    return (pair or "").replace("/", "").replace("_", "").replace("-", "").upper().strip()


def has(pair: str) -> bool:
    """True when this symbol has anything on disk (even one hour)."""
    return (TICKS / clean_pair(pair)).is_dir() and any((TICKS / clean_pair(pair)).rglob("*.json.gz"))


def coverage(pair: str) -> dict | None:
    """`{symbol, from, to, hours, bytes}` for what the store holds, or None."""
    root = TICKS / clean_pair(pair)
    if not root.is_dir():
        return None
    hours: list[Path] = list(root.rglob("*.json.gz"))
    if not hours:
        return None
    days = sorted(p.parent.name for p in hours)
    return {"symbol": clean_pair(pair), "from": days[0], "to": days[-1], "hours": len(hours),
            "bytes": sum(p.stat().st_size for p in hours)}


def _decode(doc: dict):
    """Ticks as (epoch_ms, bid, ask, bid_vol, ask_vol); `times`/`bids`/`asks` are cumulative deltas."""
    base = int(doc["timestamp"])
    mult = float(doc["multiplier"])
    if doc.get("bid") is None or doc.get("ask") is None:      # a "successful" hour with no quotes
        return []
    bid0, ask0 = float(doc["bid"]), float(doc["ask"])
    t = b = a = 0
    out = []
    for dtm, db, da, bv, av in zip(doc.get("times", []), doc.get("bids", []), doc.get("asks", []),
                                   doc.get("bidVolumes", []), doc.get("askVolumes", [])):
        t += int(dtm)
        b += int(db)
        a += int(da)
        out.append((base + t, bid0 + b * mult, ask0 + a * mult, float(bv), float(av)))
    return out


@lru_cache(maxsize=4096)
def _hour(path_str: str, mtime_ns: int):
    """One instrument-hour, decoded and cached by (path, mtime) so a re-run sees fresh bytes."""
    with gzip.open(path_str, "rb") as fh:
        return tuple(_decode(json.loads(fh.read())))


def hour_ticks(symbol: str, when: dt.datetime) -> tuple:
    path = TICKS / symbol / when.strftime("%Y-%m-%d") / f"{when.hour:02d}.json.gz"
    if not path.exists() or path.stat().st_size == 0:
        return ()
    return _hour(str(path), path.stat().st_mtime_ns)


def _minute_bars(symbol: str, start: dt.datetime, end: dt.datetime) -> dict[int, dict]:
    """M1 bars keyed by epoch-minute, built from ticks."""
    out: dict[int, dict] = {}
    cur = start.replace(minute=0, second=0, microsecond=0)
    while cur <= end:
        for ms, bid, ask, _bv, _av in hour_ticks(symbol, cur):
            mid = (bid + ask) / 2.0
            minute = ms // 60000                      # epoch MINUTES
            bar = out.get(minute)
            spread = ask - bid
            if bar is None:
                out[minute] = {"t": minute * 60000, "o": mid, "h": mid, "l": mid, "c": mid,
                               "v": 1, "s": [spread]}
            else:
                bar["h"] = max(bar["h"], mid)
                bar["l"] = min(bar["l"], mid)
                bar["c"] = mid
                bar["v"] += 1
                bar["s"].append(spread)
        cur += dt.timedelta(hours=1)
    return out


def _resample(m1: dict[int, dict], minutes: int) -> list[dict]:
    buckets: dict[int, dict] = {}
    order = sorted(m1)
    for key in order:
        bar = m1[key]
        slot = key // minutes * minutes           # epoch minutes, bucketed
        agg = buckets.get(slot)
        # Each minute contributes its MEDIAN spread, so one bad print cannot widen a 30m bar.
        minute_spread = statistics.median(bar["s"]) if bar["s"] else 0.0
        if agg is None:
            buckets[slot] = {"openTime": slot * 60000, "open": bar["o"], "high": bar["h"],
                             "low": bar["l"], "close": bar["c"], "volume": bar["v"],
                             "spread": minute_spread, "_n": 1}
        else:
            agg["high"] = max(agg["high"], bar["h"])
            agg["low"] = min(agg["low"], bar["l"])
            agg["close"] = bar["c"]
            agg["volume"] += bar["v"]
            agg["spread"] += minute_spread
            agg["_n"] += 1
    rows = []
    for slot in sorted(buckets):
        b = buckets[slot]
        b["spread"] = round(b["spread"] / max(1, b["_n"]), 8)
        b.pop("_n", None)
        rows.append(b)
    return rows


def bars(pair: str, timeframe: str = "30", limit: int = 500,
         end: dt.datetime | None = None) -> tuple[list[dict], dict]:
    """`(rows, coverage)` for the last `limit` bars built from local ticks.

    Raises `TickError` (never returns a substitute) when the symbol is not on disk or the window the
    request needs is not covered — the caller decides whether another source may answer, and must label
    it if so.
    """
    symbol = clean_pair(pair)
    tf = str(timeframe or "30").upper()
    if tf not in TIMEFRAMES:
        raise TickError(f"{timeframe!r} is not one of {', '.join(TIMEFRAMES)}")
    if not has(symbol):
        raise TickError(f"no local ticks for {symbol}")
    minutes = TIMEFRAMES[tf]
    wanted_end = (end or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    wanted_end = wanted_end.replace(minute=0, second=0, microsecond=0)
    cov = coverage(symbol) or {}
    newest_day = cov.get("to")
    if not newest_day:
        raise TickError(f"no local ticks for {symbol}")

    want = max(1, min(int(limit), 20000))
    # Walk back a day at a time until the resample yields enough bars; weekends/holidays cost ~40%.
    span = dt.timedelta(days=1)
    rows: list[dict] = []
    start = wanted_end
    for _ in range(60):
        start = wanted_end - span - dt.timedelta(minutes=want * minutes * 0.4)
        m1 = _minute_bars(symbol, start, wanted_end)
        rows = _resample(m1, minutes)
        if len(rows) >= want:
            break
        span += dt.timedelta(days=1)
    rows = rows[-want:]
    if not rows:
        raise TickError(f"the tick store has no bars for {symbol} in that window")
    meta = {"pair": symbol, "timeframe": tf, "count": len(rows), "source": "dukascopy-ticks",
            "from": rows[0]["openTime"], "to": rows[-1]["openTime"],
            "requested_end": int(wanted_end.timestamp() * 1000),
            "feed_end": rows[-1]["openTime"],
            "lag_hours": round((wanted_end - dt.datetime.fromtimestamp(
                rows[-1]["openTime"] / 1000, dt.timezone.utc)).total_seconds() / 3600.0, 1),
            "store": {"from": cov.get("from"), "to": cov.get("to"), "hours": cov.get("hours")},
            "spread_mean": round(sum(r["spread"] for r in rows) / len(rows), 8)}
    return rows, meta


def status() -> dict:
    """The tick store as the console reports it."""
    symbols = {}
    for symbol in SYMBOLS:
        cov = coverage(symbol)
        if cov:
            symbols[symbol] = {"hours": cov["hours"], "from": cov["from"], "to": cov["to"],
                               "bytes": cov["bytes"]}
    return {"home": str(TICKS), "symbols": symbols,
            "hours": sum(s["hours"] for s in symbols.values()),
            "bytes": sum(s["bytes"] for s in symbols.values())}
