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

Each hour is decoded once and kept in memory as at most 60 packed minute bars (~3 KB), keyed by path and
mtime, so a repeat request is a resample, not a re-read. There is no on-disk bar cache: the first daily or
4h request over a long window still decodes every hour in it once.
"""

from __future__ import annotations

import array
import datetime as dt
import gzip
import json
import os
import statistics
import zlib
from functools import lru_cache
from pathlib import Path

TICKS = Path(os.environ.get("TRADERS_FX_TICKS")
             or Path.home() / ".local/share/traders-agent/fx/ticks-v1")

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


_FIELDS = 7          # epoch minute, open, high, low, close, ticks, median spread


@lru_cache(maxsize=20000)            # ~2 years of one symbol's hours at ~3 KB each
def _hour(path_str: str, mtime_ns: int):
    """One instrument-hour as packed minute bars, cached by (path, mtime) so a re-run sees fresh bytes.

    Minute bars, not ticks: a busy hour is thousands of ticks, and holding thousands of hours of tick
    tuples ran to gigabytes. None when the file cannot be read (a download cut off mid-write).
    """
    try:
        with gzip.open(path_str, "rb") as fh:
            ticks = _decode(json.loads(fh.read()))
    except (OSError, EOFError, ValueError, KeyError, TypeError, zlib.error):
        return None
    minutes: dict[int, list] = {}
    for ms, bid, ask, _bv, _av in ticks:
        mid = (bid + ask) / 2.0
        minute = ms // 60000                      # epoch MINUTES
        bar = minutes.get(minute)
        if bar is None:
            minutes[minute] = [mid, mid, mid, mid, 1, [ask - bid]]
        else:
            bar[1] = max(bar[1], mid)
            bar[2] = min(bar[2], mid)
            bar[3] = mid
            bar[4] += 1
            bar[5].append(ask - bid)
    packed = array.array("d")
    for minute in sorted(minutes):
        o, h, low, c, v, spreads = minutes[minute]
        # Each minute keeps its MEDIAN spread, so one bad print cannot widen a 30m bar.
        packed.extend((minute, o, h, low, c, v, statistics.median(spreads)))
    return packed


def _hour_path(symbol: str, when: dt.datetime) -> Path:
    return TICKS / symbol / when.strftime("%Y-%m-%d") / f"{when.hour:02d}.json.gz"


def _packed(symbol: str, when: dt.datetime):
    """The hour's packed minutes; empty when the hour is not on disk, None when it is unreadable."""
    path = _hour_path(symbol, when)
    try:
        st = path.stat()
    except OSError:
        return array.array("d")
    if st.st_size == 0:
        return array.array("d")
    return _hour(str(path), st.st_mtime_ns)


def hour_minutes(symbol: str, when: dt.datetime) -> list[tuple]:
    """`(epoch_minute, open, high, low, close, ticks, median_spread)` per minute of one hour."""
    packed = _packed(clean_pair(symbol), when) or ()
    return [tuple(packed[i:i + _FIELDS]) for i in range(0, len(packed), _FIELDS)]


def _minute_bars(symbol: str, start: dt.datetime, end: dt.datetime) -> tuple[dict[int, tuple], int]:
    """(M1 bars keyed by epoch-minute, hours that could not be read) between two hours, inclusive."""
    out: dict[int, tuple] = {}
    unreadable = 0
    cur = start.replace(minute=0, second=0, microsecond=0)
    while cur <= end:
        if not (TICKS / symbol / cur.strftime("%Y-%m-%d")).is_dir():   # a weekend: one stat, not 24
            cur = cur.replace(hour=0) + dt.timedelta(days=1)
            continue
        packed = _packed(symbol, cur)
        if packed is None:
            unreadable += 1
        else:
            for i in range(0, len(packed), _FIELDS):
                out[int(packed[i])] = tuple(packed[i + 1:i + _FIELDS])
        cur += dt.timedelta(hours=1)
    return out, unreadable


def _resample(m1: dict[int, tuple], minutes: int) -> list[dict]:
    buckets: dict[int, dict] = {}
    for key in sorted(m1):
        o, h, low, c, v, minute_spread = m1[key]
        slot = key // minutes * minutes           # epoch minutes, bucketed
        agg = buckets.get(slot)
        if agg is None:
            buckets[slot] = {"openTime": slot * 60000, "open": o, "high": h, "low": low, "close": c,
                             "volume": int(v), "spread": minute_spread, "_n": 1}
        else:
            agg["high"] = max(agg["high"], h)
            agg["low"] = min(agg["low"], low)
            agg["close"] = c
            agg["volume"] += int(v)
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
    minutes = TIMEFRAMES[tf]
    wanted_end = (end or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    wanted_end = wanted_end.replace(minute=0, second=0, microsecond=0)
    cov = coverage(symbol)
    if not cov:
        raise TickError(f"no local ticks for {symbol}")
    first_day = dt.datetime.strptime(cov["from"], "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)

    want = max(1, min(int(limit), 20000))
    # Size the window from the timeframe once: markets trade about 5 days in 7, so read 1.5x the trading
    # time plus a long weekend. A holiday or a gap in the store gets one wider pass. Never read before
    # the store's first day — there is nothing there, and a short store answers with what it holds.
    span = dt.timedelta(minutes=want * minutes) * 1.5 + dt.timedelta(days=4)
    rows: list[dict] = []
    unreadable = 0
    for _ in range(2):
        start = max(first_day, wanted_end - span)
        m1, unreadable = _minute_bars(symbol, start, wanted_end)
        rows = _resample(m1, minutes)
        if len(rows) >= want or start == first_day:
            break
        span *= 3
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
            "unreadable_hours": unreadable,
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
