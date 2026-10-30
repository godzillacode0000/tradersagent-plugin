"""FX bars from Dukascopy's free public feed — standard library only.

Why this exists: the desk's chart is a Binance crypto feed, so a strategy written for GBPUSD/EURUSD
had no data behind it. Dukascopy publishes its bank feed openly — one LZMA-compressed file per hour
per instrument (`…/GBPUSD/2026/09/15/10h_ticks.bi5`, ~20 KB), no key, no signup — and every tick in
it carries its own bid/ask. That is more than a bar feed and far less than a tick warehouse: this
module turns those hours into the OHLCV bars the Pine engine and vectorbt both understand.

The file format, since it is not documented next to the files themselves: LZMA alone-format, then
20-byte big-endian records — `>IIIff` = milliseconds into the hour, ask, bid, ask volume, bid volume,
with prices as integers scaled by 10^digits (10^5 for most pairs, 10^3 for JPY quotes) and volumes in
millions of units.

Cache: the raw hour files live under `~/.local/share/traders-agent/fx/<PAIR>/<YYYY-MM-DD>/<HH>.bi5`.
They are tiny, immutable and the network is the only slow part, so a repeat request for the same week
costs nothing. Bars are built in memory per call (a week decodes in well under a second once cached).
"""

from __future__ import annotations

import datetime as dt
import lzma
import os
import struct
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

FEED = "https://datafeed.dukascopy.com/datafeed"
CACHE = Path(os.environ.get("TRADERS_FX_HOME") or Path.home() / ".local/share/traders-agent/fx/v2")
DIGITS_JPY = 3          # EURUSD 1.12309 (5), USDJPY 147.123 (3)
RECORD = struct.Struct(">IIIff")
PER_HOUR = 3600 * 1000

# What the console is willing to serve. A pair must be six letters, and the quote side is what the
# prices are in; Dukascopy's own instrument names are exactly the six letters.
PAIRS = ("GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY")
TIMEFRAMES = {"1": 1, "5": 5, "15": 15, "30": 30, "60": 60, "120": 120, "240": 240, "D": 1440}

UA = {"User-Agent": "Mozilla/5.0 (traders-agent fx loader)"}


class FxError(Exception):
    """A request the loader refuses or cannot serve, with a sentence for the caller."""

    def __init__(self, message: str, code: str = "fx_error"):
        super().__init__(message)
        self.code = code


# Instruments that are not six-letter FX pairs but live in the same tick store, with their precision
# (measured: every one of them quotes to 3 decimals on this feed) and the kind `syminfo` should report.
NON_FX = {
    "XAUUSD": ("commodity", 3, "Gold vs US Dollar"),
    "XAGUSD": ("commodity", 3, "Silver vs US Dollar"),
    "NAS100": ("index", 3, "US 100 Tech Index"),
    "SP500": ("index", 3, "US 500 Index"),
}


def digits(pair: str) -> int:
    p = pair.upper()
    if p in NON_FX:
        return NON_FX[p][1]
    return DIGITS_JPY if p.endswith("JPY") else 5


def _clean_pair(pair: str) -> str:
    p = str(pair or "").upper().replace("/", "").replace("=X", "").strip()
    if p in NON_FX:
        return p
    if len(p) != 6 or not p.isalpha():
        raise FxError(f"{pair!r} is not a six-letter FX pair (GBPUSD, EURUSD, …) or one of "
                      f"{', '.join(NON_FX)}", "bad_pair")
    return p


def hour_path(pair: str, when: dt.datetime) -> Path:
    """Local cache path — OUR naming (1-based month, readable), not the feed's layout."""
    return CACHE / pair / when.strftime("%Y-%m-%d") / f"{when.hour:02d}h.bi5"


def _download(pair: str, when: dt.datetime) -> bytes:
    """One hour, from the cache or the feed. An empty body means no ticks (weekend, holiday)."""
    path = hour_path(pair, when)
    if path.exists():
        return path.read_bytes()
    # Dukascopy's tick path is 0-BASED IN MONTHS (January = 00, October = 09, December = 11) —
    # the single most expensive gotcha in this feed. Python's `month` is 1-based, so without the
    # `- 1` every request reads the FOLLOWING month and the decoder relabels its ticks with the
    # requested timestamps: a silent, plausible-looking wrong-month backtest. Measured 20 Oct:
    # /2026/09/24/ → 404 while /2026/08/24/ (September) → 27,285 bytes.
    url = (f"{FEED}/{pair}/{when.year}/{when.month - 1:02d}/{when.day:02d}/"
           f"{when.hour:02d}h_ticks.bi5")
    # The feed resets connections when a burst arrives (measured 20 Oct: 8 parallel workers → Errno 54
    # on the first request). Retry with a growing pause instead of failing the whole load; a 404 is a
    # real answer (no file that hour) and is not retried.
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as res:
                raw = res.read()
            break
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                # No file for that hour: the market was shut (weekend/holiday), the date is in the
                # future, or Dukascopy has not published it yet. Not an error — coverage says so.
                raw = b""
                break
            if exc.code == 429:
                # Rate limited. Back off harder and do NOT cache this as an empty hour.
                time.sleep(2.0 + attempt * 2.0)
                continue
            raise FxError(f"Dukascopy answered {exc.code} for {pair} {when:%Y-%m-%d %H}h", "feed_error")
        except (urllib.error.URLError, ConnectionResetError, TimeoutError, OSError):
            time.sleep(0.5 * (attempt + 1))
    else:
        raise FxError(f"the Dukascopy feed stayed unavailable for {pair} {when:%Y-%m-%d %H}h", "feed_unreachable")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(raw)
    tmp.replace(path)
    return raw


def decode_hour(raw: bytes, base_ms: int, pair: str) -> list[tuple[int, float, float, float]]:
    """One hour's ticks as `(epoch_ms, bid, ask, volume)`; a truncated tail record is dropped."""
    if not raw:
        return []
    try:
        data = lzma.decompress(raw)
    except lzma.LZMAError as exc:
        raise FxError(f"a Dukascopy hour file could not be decompressed ({exc})", "bad_file")
    scale = 10 ** digits(pair)
    out = []
    for i in range(0, len(data) - RECORD.size + 1, RECORD.size):
        ms, ask, bid, ask_vol, bid_vol = RECORD.unpack_from(data, i)
        out.append((base_ms + ms, bid / scale, ask / scale, float(bid_vol) + float(ask_vol)))
    return out


def hours(start: dt.datetime, end: dt.datetime):
    cur = start.replace(minute=0, second=0, microsecond=0)
    while cur < end:
        yield cur
        cur += dt.timedelta(hours=1)


def ticks(pair: str, start: dt.datetime, end: dt.datetime, workers: int = 3):
    """Every tick in [start, end), oldest first. Macro pairs only trade Sun 21:00 → Fri 21:00 UTC."""
    pair = _clean_pair(pair)
    slots = list(hours(start, end))
    if not slots:
        return []
    with ThreadPoolExecutor(max_workers=max(1, min(workers, 16))) as pool:
        raws = list(pool.map(lambda w: _download(pair, w), slots))
    out = []
    for when, raw in zip(slots, raws):
        base = int(when.replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
        out.extend(decode_hour(raw, base, pair))
    out.sort(key=lambda t: t[0])
    return out


def _minute_bars(pair: str, start: dt.datetime, end: dt.datetime) -> dict[int, dict]:
    """Ticks → M1 bars on the mid price (what a chart shows; the spread lives in the ticks)."""
    bars: dict[int, dict] = {}
    for ms, bid, ask, vol in ticks(pair, start, end):
        mid = (bid + ask) / 2.0
        key = ms // 60000 * 60000
        bar = bars.get(key)
        if bar is None:
            bars[key] = {"t": key, "o": mid, "h": mid, "l": mid, "c": mid, "v": vol}
        else:
            bar["h"] = max(bar["h"], mid)
            bar["l"] = min(bar["l"], mid)
            bar["c"] = mid
            bar["v"] += vol
    return bars


def _resample(m1: dict[int, dict], minutes: int) -> list[dict]:
    step = minutes * 60000
    out: dict[int, dict] = {}
    for t, bar in sorted(m1.items()):
        key = t // step * step
        agg = out.get(key)
        if agg is None:
            out[key] = {"openTime": key, "closeTime": key + step, "open": bar["o"], "high": bar["h"],
                        "low": bar["l"], "close": bar["c"], "volume": bar["v"]}
        else:
            agg["high"] = max(agg["high"], bar["h"])
            agg["low"] = min(agg["low"], bar["l"])
            agg["close"] = bar["c"]
            agg["volume"] += bar["v"]
    return [out[k] for k in sorted(out)]


def latest_available(pair: str, end: dt.datetime | None = None, max_days: int = 60) -> dt.datetime | None:
    """The newest hour the feed actually serves for `pair`.

    It exists for future `end` values, weekends, holidays and hours Dukascopy has not published yet —
    not for a publication delay, which an earlier version of this file wrongly assumed (the "lag" was
    the 0-based month bug reading the following month's folder). Coarse first — one probe per candidate
    day at midday — then refine that day, so a probe costs a handful of requests rather than one per
    hour.
    """
    pair = _clean_pair(pair)
    now = (end or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    day = now.replace(minute=0, second=0, microsecond=0)
    for back in (1, 2, 3, 5, 7, 10, 14, 18, 21, 25, 30, 40, 50, max_days):
        probe = (day - dt.timedelta(days=back)).replace(hour=12)
        if _download(pair, probe):
            newest = probe
            for h in range(12, 24):
                cur = probe.replace(hour=h)
                if cur <= now and _download(pair, cur):
                    newest = cur
            return newest
    return None


YAHOO_TF = {"1": ("1m", "7d"), "5": ("5m", "60d"), "15": ("15m", "60d"), "30": ("30m", "60d"),
            "60": ("60m", "730d"), "120": ("60m", "730d"), "240": ("60m", "730d"), "D": ("1d", "10y")}
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}=X"


def _yahoo(pair: str, timeframe: str = "30", limit: int = 500):
    """Fallback bars from Yahoo's public chart endpoint (no key), used when Dukascopy throttles.

    Same shape as `bars()`, same mid-price convention (Yahoo publishes one price series, so mid = it),
    but a different provenance — the caller must say which source produced the numbers. Yahoo caps
    intraday history (30m ≈ 60 days, 1h ≈ 2 years) and is an unofficial endpoint: fine for research,
    not something to build a product on.
    """
    import json as _json
    pair = _clean_pair(pair)
    tf = str(timeframe or "30").upper()
    if tf not in TIMEFRAMES:
        raise FxError(f"{timeframe!r} is not one of {', '.join(TIMEFRAMES)}", "bad_timeframe")
    interval, span = YAHOO_TF[tf]
    url = YAHOO.format(sym=pair) + f"?interval={interval}&range={span}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as res:
            doc = _json.loads(res.read().decode("utf-8"))
    except Exception as exc:                      # noqa: BLE001 - the fallback explains itself
        raise FxError(f"Yahoo FX is unreachable too ({exc})", "feed_unreachable") from None
    try:
        result = doc["chart"]["result"][0]
        ts, q = result["timestamp"], result["indicators"]["quote"][0]
    except (KeyError, IndexError, TypeError):
        raise FxError(f"Yahoo returned no bars for {pair}", "no_data") from None
    step = TIMEFRAMES[tf] * 60000
    rows = []
    for t, o, h, l, c, v in zip(ts, q["open"], q["high"], q["low"], q["close"], q["volume"]):
        if None in (o, h, l, c):
            continue
        rows.append({"openTime": int(t) * 1000, "closeTime": int(t) * 1000 + step,
                     "open": o, "high": h, "low": l, "close": c, "volume": v or 0})
    rows = rows[-max(1, min(int(limit), 20000)):]
    meta = {"pair": pair, "timeframe": tf, "count": len(rows), "source": "yahoo",
            "from": rows[0]["openTime"] if rows else None,
            "to": rows[-1]["openTime"] if rows else None}
    return rows, meta


def _from_ticks(pair: str, tf: str, want: int, wanted_end: dt.datetime):
    """Rows from the local Dukascopy tick store, or (None, None) when it cannot serve the window.

    The store is the preferred source: it is on disk, it carries bid/ask (so bars have a real spread)
    and a true tick count, and it is the data the operator asked to download. It is not a fallback —
    a short or missing store falls through to the network loader, which labels itself separately.
    """
    try:
        import fxticks
    except Exception:                                   # module not deployed (old live tree)
        return None, None
    try:
        if not fxticks.has(pair):
            return None, None
        rows, meta = fxticks.bars(pair, tf, want, wanted_end)
    except Exception:                                   # noqa: BLE001 - a store problem must not 500
        return None, None
    if len(rows) < min(want, 30):                       # too thin to be the answer
        return None, None
    return rows, meta


def _yahoo_allowed() -> bool:
    return os.environ.get("TRADERS_FX_ALLOW_YAHOO", "").strip() in ("1", "true", "yes")


def _fallback(pair: str, tf: str, want: int):
    """Yahoo is OFF unless TRADERS_FX_ALLOW_YAHOO=1: the operator ruled it out for backtests.

    Kept because it is a working read-only probe and some tests exercise its shaping, but it must never
    answer silently: unset, the call fails with the reason instead of substituting mid prices that have
    no volume and no spread (and which once got labelled "dukascopy").
    """
    if not _yahoo_allowed():
        raise FxError("no local ticks for this pair and the Dukascopy feed is unreachable; "
                      "Yahoo is disabled (set TRADERS_FX_ALLOW_YAHOO=1 to allow the labelled fallback)",
                      "no_local_ticks")
    return _yahoo(pair, tf, want)


def _bars(pair: str, timeframe: str = "30", limit: int = 500, end: dt.datetime | None = None):
    """The last `limit` bars of `pair` at `timeframe`, ending now (or at `end`).

    FX is closed at weekends, so a fixed lookback would silently return half a week of bars on a
    Monday: the loader walks back in day-sized steps until it has enough, and stops after 40 days.
    """
    pair = _clean_pair(pair)
    tf = str(timeframe or "30").upper()
    if tf not in TIMEFRAMES:
        raise FxError(f"{timeframe!r} is not one of {', '.join(TIMEFRAMES)}", "bad_timeframe")
    try:
        want = max(1, min(int(limit), 20000))
    except (TypeError, ValueError):
        raise FxError("limit must be a number", "bad_limit")
    wanted_end = (end or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc).replace(
        minute=0, second=0, microsecond=0)
    # 1. the tick store on disk (tools/fx-fetch.py): no network, real spread, real tick counts
    rows, meta = _from_ticks(pair, tf, want, wanted_end)
    if rows is not None:
        return rows, meta
    try:
        newest = latest_available(pair, wanted_end + dt.timedelta(hours=1))
    except FxError:
        newest = None                             # throttled or unreachable: fall back, and say so
    if newest is None:
        return _fallback(pair, tf, want)          # labelled, and only if explicitly allowed
    end = newest + dt.timedelta(hours=1)
    minutes = TIMEFRAMES[tf]
    need_minutes = want * minutes
    out: list[dict] = []
    span = dt.timedelta(days=1)
    for _ in range(40):
        start = end - span - dt.timedelta(minutes=need_minutes * 0.4)      # weekends cost ~40% of a week
        out = _resample(_minute_bars(pair, start, end), minutes)
        if len(out) >= want or end - start > dt.timedelta(days=60):
            break
        span += dt.timedelta(days=1)
    rows = out[-want:]
    meta = {"pair": pair, "timeframe": tf, "count": len(rows), "source": "dukascopy",
            "from": rows[0]["openTime"] if rows else None,
            "to": rows[-1]["openTime"] if rows else None,
            "requested_end": int(wanted_end.timestamp() * 1000),
            "feed_end": int(newest.timestamp() * 1000),
            "lag_hours": round((wanted_end - newest).total_seconds() / 3600.0, 1)}
    return rows, meta


def bars(pair: str, timeframe: str = "30", limit: int = 500, end: dt.datetime | None = None) -> list[dict]:
    """The last `limit` bars of `pair` at `timeframe` (this module's own CLI/test door)."""
    return _bars(pair, timeframe, limit, end)[0]


def bars_with_meta(pair: str, timeframe: str = "30", limit: int = 500,
                   end: dt.datetime | None = None) -> dict:
    """`{"bars": [...], "coverage": {...}}` for one call.

    The coverage dict travels WITH the rows. It used to live in a module global (`LAST`), and two
    concurrent requests — which `request.security` makes routine: the main symbol and the secondary
    pair at once — could each read the other's source/lag, labelling Yahoo bars "dukascopy" or
    attaching a span to the wrong series. A shared mutable global cannot describe two answers.
    """
    rows, meta = _bars(pair, timeframe, limit, end)
    return {"bars": rows, "coverage": meta}


def symbol_info(pair: str) -> dict:
    """What the Pine engine's `syminfo.*` reads. mintick follows the pair's own precision."""
    pair = _clean_pair(pair)
    mintick = 10 ** -digits(pair)
    kind, _d, described = NON_FX.get(pair, ("forex", 5, f"{pair[:3]} / {pair[3:]}"))
    return {
        "ticker": pair, "tickerid": f"{'IDX' if kind == 'index' else 'FX'}:{pair}",
        "prefix": "IDX" if kind == "index" else "FX", "root": pair,
        "description": described, "type": kind,
        "main_tickerid": f"{'IDX' if kind == 'index' else 'FX'}:{pair}",
        "current_contract": "", "isin": "", "basecurrency": pair[:3], "currency": pair[3:],
        "timezone": "Etc/UTC", "country": "", "mintick": mintick, "pricescale": 10 ** digits(pair),
        "minmove": 1, "pointvalue": 1, "mincontract": 0.01, "session": "24x5", "volumetype": "base",
        "expiration_date": 0, "employees": 0, "industry": "", "sector": "", "shareholders": 0,
        "shares_outstanding": 0, "source": "dukascopy",
    }


def status() -> dict:
    """How much is cached, so a caller can say 'first load takes a minute' honestly.

    One shape always, with or without a network cache: the empty-cache branch once returned early and
    dropped `ticks`, so an operator who had only run tools/fx-fetch.py saw an endless "Reading…" card.
    """
    pairs: dict[str, dict] = {}
    total_h = total_b = 0
    for d in (sorted(CACHE.iterdir()) if CACHE.exists() else ()):
        if not d.is_dir():
            continue
        n = b = 0
        for f in d.rglob("*.bi5"):
            n += 1
            b += f.stat().st_size
        pairs[d.name] = {"hours": n, "bytes": b}
        total_h += n
        total_b += b
    out = {"home": str(CACHE), "pairs": pairs, "hours": total_h, "bytes": total_b,
           "feed": FEED, "pairs_supported": list(PAIRS), "yahoo": _yahoo_allowed()}
    try:
        import fxticks
        out["ticks"] = fxticks.status()
    except Exception:                                   # noqa: BLE001 - status must always answer
        out["ticks"] = {"home": None, "symbols": {}, "hours": 0, "bytes": 0}
    return out


def _main(argv: list[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(description="FX bars from Dukascopy's free feed")
    ap.add_argument("pair")
    ap.add_argument("timeframe", nargs="?", default="30")
    ap.add_argument("limit", nargs="?", type=int, default=500)
    ap.add_argument("--csv", help="write the bars here")
    a = ap.parse_args(argv)
    rows = bars(a.pair, a.timeframe, a.limit)
    print(f"{a.pair} {a.timeframe} · {len(rows)} bars · "
          f"{dt.datetime.utcfromtimestamp(rows[0]['openTime'] / 1000):%Y-%m-%d %H:%M} → "
          f"{dt.datetime.utcfromtimestamp(rows[-1]['openTime'] / 1000):%Y-%m-%d %H:%M}" if rows else "no bars")
    if a.csv and rows:
        with open(a.csv, "w", encoding="utf-8") as fh:
            fh.write("timestamp,open,high,low,close,volume\n")
            for b in rows:
                t = dt.datetime.utcfromtimestamp(b["openTime"] / 1000).strftime("%Y-%m-%d %H:%M:%S")
                fh.write(f"{t},{b['open']},{b['high']},{b['low']},{b['close']},{b['volume']}\n")
        print("wrote", a.csv)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(__import__("sys").argv[1:]))
