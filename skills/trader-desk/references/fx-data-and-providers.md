# FX data for backtests (and the `//@fx` routing)

How a forex strategy gets real bars in this console, and where the potholes are. The chart feed is
Binance crypto; nothing about GBPUSD/EURUSD exists in it.

## Why the chart's own bars cannot serve an FX strategy

Two independent failures, both silent:

1. No FX market in the chart — `chart_set_market` takes Binance symbols only.
2. `request.security("EURUSD", …)` on the custom-bars/worker engine returns the CHART'S OWN series. An SMT
   pair then compares a market with itself and every "divergence" is noise. Only a provider-backed engine
   fetches a different symbol (proved: provider path returned EURUSD 1.12 against GBPUSD 1.33).

So an FX strategy needs (a) bars for its own symbol and (b) the SAME provider serving the secondary one.

## The loader: `console/backend/fxdata.py` (stdlib only)

Dukascopy publishes its bank feed openly, one LZMA file per instrument-hour, no key:

```
https://datafeed.dukascopy.com/datafeed/<PAIR>/<YYYY>/<MM>/<DD>/<HH>h_ticks.bi5      (~20 KB/hour)
```

- **Format:** LZMA alone-format, then 20-byte big-endian records: `>IIIff` = ms into the hour, ask, bid,
  ask volume, bid volume. Prices are integers scaled by 10^digits — **5 decimals for most pairs, 3 for
  JPY quotes**. Volumes are millions of units. A truncated tail record is dropped, never guessed.
- **There is no M1 endpoint** (`…/HHh_1min.bi5` = 404). Build M1 from ticks on the mid `(bid+ask)/2`, then
  resample to 1/5/15/30/60/120/240/D; a bar's `closeTime` is `openTime + step`.
- **Cache the hour files** (`~/.local/share/traders-agent/fx/<PAIR>/<date>/<HH>.bi5`). They are immutable and
  the network is the only slow part; a week of 30m bars decodes in well under a second once cached.
- **The feed rate-limits bursts.** 8 parallel workers produce `Errno 54` resets and 429s; 3–4 workers with a
  backoff retry works. A 429 must NOT be cached as an empty hour, and a 404 IS an answer (market shut, or the
  date is past the feed's window).
- **THE MONTH IN THE URL IS 0-BASED.** `…/2026/09/24/` is **October**; September is `/08/`, January is
  `/00/`, December `/11/`. Python's `datetime.month` is 1-based, so the URL needs `(month - 1):02d`.
  Measured 20 Oct 2026: `09/24` → 404 while `08/24` → 27,285 bytes. A 1-based URL does not fail — it reads
  the NEXT month, and the decoder stamps those prices with the *requested* timestamps: a plausible,
  silently wrong backtest. This is the feed's most expensive gotcha.
- **There is no publication lag.** Hours that answer 404 are weekends, holidays, future dates, or hours not
  yet published — not a two-week delay. An earlier version of this file claimed a "free window lags ~two
  weeks"; that was this month bug asking for a month that does not exist yet. Probe COARSE anyway for a
  future `end` (one request per candidate day at midday, walking back), then refine that day.

## The fallback, and the honesty rule that goes with it

When Dukascopy throttles or has no data, fall back to Yahoo's public chart endpoint (no key):

```
https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=30m&range=60d
```

- Coverage: 1m ≈ 7d, 5/15/30m ≈ 60d, 60m ≈ 730d, 1d ≈ 10y. Unofficial — fine for research, not a product.
- **The response must say which source produced the numbers.** Hard-coding `"source": "dukascopy"` in the
  endpoint while the loader had fallen back to Yahoo is exactly the kind of quiet lie this repo's readers
  exist to prevent (it happened on the first live call). Coverage must travel WITH the call:
  `bars_with_meta()` returns `{"bars", "coverage"}` (pair, timeframe, count, from, to, source,
  requested_end, feed_end, lag_hours) and the endpoint reads that dict — never a module global. Two
  concurrent requests are routine (`request.security` fetches the secondary pair alongside the main one),
  and with a shared global each answer can wear the other's source/lag.

## Doors and the browser provider

| Piece | What it does |
|---|---|
| `GET /api/fx/bars?pair=GBPUSD&timeframe=30&limit=500` | rows in PineTS shape (`openTime/closeTime/open/high/low/close/volume`) + `symbol` + `source` + `coverage` |
| `GET /api/fx/status` | cache home, hours/bytes per pair, pairs supported, never fetches |
| `console/frontend/fx-provider.js` | `window.TraderFXProvider` — `getMarketData` → the endpoint (cached per URL), `getSymbolInfo` with the pair's own `mintick` (1e-5, or 1e-3 for JPY) |
| `//@fx GBPUSD` + `//@tf 60` | `pinets-runner.js` routes the run to `new PineTS(TraderFXProvider, pair, tf, …)`, `ctor: 'fx-provider'` |

The same provider object serves the main symbol AND `request.security`'s secondary symbol, which is the
whole point. A run with the directive must be proved by its `ctor` field: `worker` means the directive was
not seen and the cross-symbol data is the chart's own.

## Testing a network loader without a network

A loader that talks to a feed is still testable, and the suite must not depend on the feed being up:

- **Synthesise the wire format.** Build the payload the vendor publishes (`struct.pack` the records,
  `lzma.compress(..., format=lzma.FORMAT_ALONE)`) and assert the decode: scale, timestamps, volumes, and
  a truncated tail record dropped rather than guessed. This is the only way to pin the format.
- **Fake `urllib.request.urlopen`** with a small class exposing `read` and the context manager, and
  count calls: the second `_download` for the same hour must not fetch again.
- **Pin the failure semantics separately:** 404 → empty bytes and cached; 429 → retried, then a
  `feed_unreachable` error, and the hour NOT written to disk; `ConnectionResetError` → retried once and
  succeeds. Those three cases are where a loader silently corrupts its cache.
- Coverage is a RETURN VALUE (`bars_with_meta`), not a global: pin that with a concurrency test (two
  calls, different sources, each keeps its own) and assert the module has no `LAST`.

## Sizing an FX strategy

- `qty = strategy.equity * riskPct/100 / (entry - stop)` — a 1.5% risk with a 30-pip stop on a 10k account
  is ~50k units, i.e. ~55× the notional. With `margin_long=100` the emulator rejects every order and reports
  nothing; set `margin_long=0, margin_short=0` and size by risk.
- Commission is usually quoted as a spread, not a percent: `slippage` in ticks (2 ticks = 0.2 pips per fill)
  models it more honestly than a `commission_value`.
- Spot = long only; `pyramiding=0`.

## Measured behaviour of the NY-AM/SMT/sweep skeleton on GBPUSD

GBPUSD 1h, 17,258 bars (~2 years, Yahoo), 1.5% risk, `margin_long=0`:

| Variant | Trades | Net | Win% | PF |
|---|---|---|---|---|
| 2R + SMT (the spec as spoken) | 68 | −867.75 | 34% | 0.88 |
| 1.5R + SMT | 67 | −312.44 | 39% | 0.95 |
| 1R + SMT | 68 | +40.53 | 46% | 1.01 |
| 2R, SMT off | 123 | −451.27 | 34% | 0.96 |

What to say: the mechanics run (68 real round trips, real ledger), the edge is not in those rules on that
pair, SMT halves the 2R loss, and a fixed 2R target is the wrong shape for a 50%-retrace entry. A short
30m sample (60 days) was worse still (−1,297.92, 13% wins, PF 0.39) — never quote a 60-day FX result as
evidence, only as a smoke test.
