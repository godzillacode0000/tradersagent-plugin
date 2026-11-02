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

## Data-source policy: Dukascopy, and only Dukascopy

The operator ruled Yahoo out. `TRADERS_FX_ALLOW_YAHOO=1` is the only way it answers, and unset (the
normal state) a call with no local ticks and an unreachable feed **fails with the reason**
(`no_local_ticks`) instead of substituting a series. Do not re-offer Yahoo as "just a fallback": the
measured limits are why it cannot serve a backtest.

| Yahoo limit | Measured (GBPUSD=X, Oct 2026) | Consequence |
|---|---|---|
| Coverage | 1m 7d · 5/15/30m **83 days** · 60m 1,021d · 1d 10y | a 2-year 30m study is impossible; 30m + `range=2y` is HTTP **422** |
| Volume | **0 on every FX bar** | no VWAP, no volume filter, no volume profile |
| Bid/ask | absent (mid only) | cannot model spread or fills from the data |
| Symbols | `GBPUSD=X` fine; **`XAUUSD=X` / `XAGUSD=X` are 404** | metals only as futures (`GC=F`, `SI=F`) with basis and roll gaps |
| Contract | unofficial, no SLA | 422/429 under load, no redistribution rights |

Two Yahoo habits that are correct when it IS enabled: no Saturday bars, and UTC epoch seconds. The last
bar is live/incomplete (one off-grid minute) — drop it.

## Two Dukascopy doors, two month conventions

| Door | URL | Month | Format |
|---|---|---|---|
| legacy `/datafeed/` | `…/datafeed/<PAIR>/<Y>/<M>/<D>/<HH>h_ticks.bi5` | **0-based** (Sept = `/08/`) | LZMA alone, `>IIIff` records, ~20 KB/h |
| modern v1 | `https://jetta.dukascopy.com/v1/ticks/<CODE>/<Y>/<M>/<D>/<H>` | **1-based** (Sept = `/9/`) | JSON with delta-encoded ticks, 50–210 KB/h |

**The two conventions are opposite.** Wiring the 0-based rule into the v1 URL (or the reverse) shifts
the whole series by a month and still returns data. Determine which door you are on before writing a URL.

### The v1 tick API

- **Instrument codes carry a dash and a class:** `GBP-USD`, `EUR-USD`, `GBP-JPY`, `XAU-USD`, `XAG-USD`,
  `USA500.IDX-USD` (S&P 500), and **`USATECH.IDX-USD` for Nasdaq-100** — `USA100.IDX-USD` answers
  `400 {"error":"Unknown instrument"}`. FX pairs are plain; indices/metals are not.
- **Send a browser UA and a `Referer: https://www.dukascopy.com/`.** Without them the CDN answers `202`
  with a 0-byte body (a challenge, not data). With them, bad shapes are honest: `400` unknown instrument,
  `422` malformed path.
- **The payload is delta-encoded**, not a price list:

```json
{"timestamp": 1787565600000, "multiplier": 0.00001, "ask": 1.36345, "bid": 1.36338,
 "times": [104, 156, …], "asks": [0, -2, …], "bids": [0, 1, …],
 "askVolumes": [...], "bidVolumes": [...]}
```

  `times` are **ms since the previous tick**; `asks`/`bids` are **tick-count deltas** since the previous
  price. Recover with a running sum, then `price = base + cumsum(delta) * multiplier`. Treating them as
  absolute values yields plausible-looking prices that drift — the worst failure mode here, because
  nothing downstream looks wrong.
- **Hours the market was shut can answer 200 with `"bid": null, "ask": null`.** Guard the decoder: a
  null base means zero ticks, not a crash.
- **It holds today's data** — no publication lag (verified: 4,547 GBPUSD ticks for an hour 90 minutes
  old, monotonic over exactly 60.0 minutes, 0.4-pip spread).

## Bulk download: `tools/fx-fetch.py`

Walks instrument-hours, resumable, one gzipped JSON per hour:

```
~/.local/share/traders-agent/fx/ticks-v1/<SYMBOL>/<YYYY-MM-DD>/<HH>.json.gz   (~15 KB/h)
~/.local/share/traders-agent/fx/ticks-v1/<SYMBOL>/<YYYY-MM-DD>/<HH>.empty     (shut hour: never re-asked)
```

```bash
python3 tools/fx-fetch.py --years 2 --workers 6
python3 tools/fx-fetch.py --days 3 --instruments GBPUSD,XAUUSD
python3 tools/fx-fetch.py --report          # hours, empty hours, MB, coverage per symbol
```

- **Throughput, measured end to end:** 122,720 instrument-hours in **199 min** at 5–6 workers
  (≈10.3/s sustained, brief 15–18/s bursts), **2.3 GB** on disk; 9 shut hours, zero failures. Sizes are
  not uniform — 2 years of 30m-ish ticks ran 179 MB (SP500) to 650 MB (NAS100) and 500 MB (XAUUSD), so a
  "~1.8 GB" estimate derived from FX alone under-counts the metals and indices by ~25%.
- **A multi-hour download is a PERSISTED background job** (`persist_on_release=true`), not a session
  child: closing the pane or the chat must not kill it. Start it, verify one `--report` reading, and
  report progress on request — do not babysit it per 200 files.
- **Order is instrument-major**, so an early `--report` showing one symbol at 100% and another at 2% is
  normal, not a stall.
- A job killed and restarted resumes from disk (cached hours skip in milliseconds) — so replacing the
  process is cheap; do it rather than tolerate a session-bound one.

## Bars from the store: `console/backend/fxticks.py`

`fxdata._bars` asks the store FIRST, then the network, then (only if allowed) Yahoo. A chart request is
then a disk read instead of ~250 HTTP calls.

What a tick bar carries that a vendor OHLC bar cannot:

- price is the **mid** `(bid+ask)/2` at each tick — what a chart draws;
- `volume` is the **tick count** in the bar (a real activity measure, not a placeholder);
- `spread` is the **median** bid/ask of each minute inside the bar. A MEAN lets one bad print widen the
  whole bar (measured: 4.4 pips averaged vs 0.45 median on the same 30m bar).

Pitfalls that produce bars rather than errors:

- **Minutes vs milliseconds.** Bucket on epoch MINUTES (`ms // 60000`) and multiply by 60,000 only when
  writing `openTime`. An extra `* 60` still yields bars, at quarter-hour-ish offsets; only an exact-OHLC
  test catches it.
- **Shut hours** come back with null quotes (see above) — return `[]`, do not divide by a null base.
- `coverage()`/`has()` are the cheap gates; the decoder is cached per `(path, mtime_ns)` so a resumed
  download is read fresh while repeat requests are instant.
- Label the answer: `source: "dukascopy-ticks"` plus a `store` block (from/to/hours). `/api/fx/status`
  reports the store per symbol; `/api/fx/bars` carries the coverage it actually used.

### Metals and index CFDs are symbols, not pairs

The store holds `XAUUSD`, `XAGUSD`, `NAS100`, `SP500` beside the FX pairs, but `fxdata._clean_pair` was
written when only six-letter FX pairs existed: it answers `bad_pair` ("not a six-letter FX pair") for
`NAS100`, so a **fully downloaded** instrument still looked missing from the API while `fxticks.bars`
served it fine. Keep a `NON_FX` table beside `PAIRS`:

| Symbol | kind | digits | syminfo |
|---|---|---|---|
| `XAUUSD`, `XAGUSD` | commodity | 3 (measured) | `type: commodity`, `FX:` prefix |
| `NAS100`, `SP500` | index | 3 (measured) | `type: index`, **`IDX:` prefix** (`IDX:NAS100`) |

- Widen the cleaner by ALLOWLIST (`p in NON_FX` before the six-letter rule), never by relaxing the regex
  to "anything alphanumeric" — the door is public and the tick store's directory name is the symbol.
- Precision comes from the feed, not from a default: every one of the four quotes to 3 decimals.
- Do not print a spread as `spread * 1e4` and call it pips everywhere: that is right for a 5-digit pair,
  but a GBPJPY spread of 0.0168 renders as "168 pips" and gold/index spreads are in points. Convert by
  the instrument's own precision (`10 ** (digits - 1)`) or quote price units.

## The legacy network loader (`fxdata.py`, `/datafeed`)

Still the second source when the store is thin, and still the only way to backfill an hour the walk has
not reached.

- **Format:** LZMA alone-format, then 20-byte big-endian records `>IIIff` (ms into hour, ask, bid, ask
  vol, bid vol); prices are integers scaled by 10^digits — 5 decimals for most pairs, 3 for JPY quotes.
  A truncated tail record is dropped, never guessed. There is no M1 endpoint; build M1 from ticks on the
  mid, then resample.
- **THE MONTH IN THE URL IS 0-BASED** — see the table above. Measured: `/2026/09/24/` 404 while
  `/2026/08/24/` 27,285 bytes. A 1-based URL reads the NEXT month and stamps it with the requested
  timestamps: a plausible, silently wrong backtest.
- **Cache the hour files** (`…/fx/v2/<PAIR>/<date>/<HH>.bi5`) and **version the cache root whenever the
  ADDRESSING changes**: markers written under the old scheme still shadow the real hours. Delete the old
  root; a schema-versioned marker is the alternative.
- **Rate limits:** 8 workers → `Errno 54`; bursts → 429. Use 3–4 workers with backoff. A 429 must never be
  cached as an empty hour; a 404 IS an answer.
- **No publication lag exists.** 404s are weekends/holidays/future dates. Probe coarse (one request per
  candidate day at midday) when `end` is near the present.

## Doors and the browser provider

| Piece | What it does |
|---|---|
| `GET /api/fx/bars?pair=GBPUSD&timeframe=30&limit=500` | rows in PineTS shape + `symbol` + `source` + `coverage` (+ `spread_mean`, `store`) |
| `GET /api/fx/status` | cache home, hours/bytes per pair, **tick store per symbol**, never fetches |
| `console/frontend/fx-provider.js` | `window.TraderFXProvider` — `getMarketData` → the endpoint (cached per URL), `getSymbolInfo` with the instrument's own `mintick` (1e-5 FX, 1e-3 JPY, metals and indices) |
| `//@fx GBPUSD` + `//@tf 60` | `pinets-runner.js` routes the run to `new PineTS(TraderFXProvider, pair, tf, …)`, `ctor: 'fx-provider'` |

The same provider object serves the main symbol AND `request.security`'s secondary symbol, which is the
whole point. A run with the directive must be proved by its `ctor` field: `worker` means the directive was
not seen and the cross-symbol data is the chart's own.

**Metadata ABOUT a response travels in that response.** Never a module-level "last result": two
concurrent requests are routine (`request.security` fetches the secondary symbol beside the main one) and
a shared global lets each answer wear the other's source/lag. `bars_with_meta()` returns
`{"bars", "coverage"}`; a test with two sources keeps them apart.

## Testing a loader without a network

- **Synthesise the wire format you decode.** For bi5: `struct.pack` the records + `lzma.compress(...)`.
  For v1: build the delta JSON (base price + `times`/`bids`/`asks` deltas) and assert exact OHLC, tick
  count, median spread and that two adjacent hours do not bleed into each other.
- **Fake `urllib.request.urlopen`** with a class exposing `read` + context manager; count calls: a second
  request for the same hour must not fetch again.
- **Pin the failure semantics separately:** 404 → empty marker cached; 429 → retried, then
  `feed_unreachable`, nothing cached; `ConnectionResetError` → retried once and succeeds.
- **Prove the preference, not just the path:** patch `latest_available`/`_download` to `self.fail(...)`
  and assert a tick-store call still answers `source: "dukascopy-ticks"`. That is the test that keeps a
  future refactor from quietly going back to the network.
- Override the store with module attributes (`fxticks.TICKS = tmpdir`), not env vars read at import, and
  clear the `lru_cache` between tests — otherwise one test's hours leak into the next.

## Sizing an FX strategy

- `qty = strategy.equity * riskPct/100 / (entry - stop)` — a 1.5% risk with a 30-pip stop on a 10k account
  is ~50k units, i.e. ~55× the notional. With `margin_long=100` the emulator rejects every order and reports
  nothing; set `margin_long=0, margin_short=0` and size by risk.
- Commission is usually quoted as a spread, not a percent: `slippage` in ticks (2 ticks = 0.2 pips per fill)
  models it more honestly than a `commission_value`.
- Spot = long only; `pyramiding=0`.

## Measured behaviour of the NY-AM/SMT/sweep skeleton on GBPUSD

GBPUSD 1h, 17,258 bars, 1.5% risk, `margin_long=0` — **these numbers were produced on Yahoo bars**, i.e.
the source the operator has since ruled out. Keep them as a historical baseline, never as a current
result: rerun on tick bars (above) before quoting any of it.

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
