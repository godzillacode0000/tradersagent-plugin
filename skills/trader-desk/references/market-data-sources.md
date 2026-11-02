# Market data for backtests: free, honest, and bars vs ticks

Which feed to pull for a backtest, and what "free" costs you. Verified against live endpoints; the
verdict rule matters more than the table because vendors change.

## Sources worth using

| Source | Market | Granularity | Free? | Key | Notes |
|---|---|---|---|---|---|
| **Dukascopy** (`datafeed.dukascopy.com` legacy, `jetta.dukascopy.com/v1` modern) | FX majors, spot metals, index CFDs | ticks (→ any bar) | yes, personal | no | bank feed, ~20 KB (bi5) or 50–210 KB (v1 JSON) per instrument-hour; the legacy month folder is **0-based**, the v1 month is **1-based**; v1 codes carry a dash (`GBP-USD`, `USATECH.IDX-USD`). Format + loader + downloader: `fx-data-and-providers.md` |
| **Binance Vision** (`data.binance.vision`) | crypto spot/futures | 1m klines, trades, aggTrades (bulk ZIP) | yes | no | `…/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-YYYY-MM.zip` ≈ 2 MB per symbol-month; daily trades ≈ 28 MB per day |
| **HistData.com** | FX | M1 bars per month | yes, personal | no | form download, back to ~2000; good cross-check for Dukascopy |
| **Stooq** (`stooq.com/q/d/l/?s=…&i=d`) | FX, indices, US equities/ETFs | daily OHLC CSV | yes | no | instant CSV, no history depth guarantees |
| ~~Yahoo chart API~~ | FX, equities, crypto | 1m 7d · 5/15/30m **83d** · 60m 1,021d · 1d 10y | yes | no | **RULED OUT by the operator.** Zero volume on every FX bar, no bid/ask, 30m + `range=2y` = HTTP 422, `XAUUSD=X`/`XAGUSD=X` = 404 (metals only as `GC=F`/`SI=F` futures). Disabled unless `TRADERS_FX_ALLOW_YAHOO=1` |
| **Databento** | CME, Nasdaq, equities | tick, L1/L2/MBO | no (trial credit) | yes | the only serious option for futures order-book work; commercial licence |

Do not recommend TrueFX-style aggregators without re-testing their URL: several "free FX tick" pages
rot to 404 (verified). A dead download page is worse than no suggestion.

**Vendor vs market — pick by instrument, not by reputation.** Databento sells CME futures, US equities
and order-book data; it does **not** sell spot FX, so for GBPUSD/EURUSD it is the wrong vendor at any
price. Spot FX ticks → Dukascopy (free) or HistData (M1); CME FX futures (6E/6B) → Databento.

## Bars or ticks: the decision rule

- **A strategy whose edge lives on 30m or slower uses BARS.** 1-minute OHLC resampled to the trading
timeframe gives 30 sub-bars per 30m candle — enough to see a sweep, a retest and where a limit filled.
- **Ticks buy three things only:** (a) verifying that fills/slippage assumptions are honest on a handful
  of sessions, (b) spread and microstructure modelling, (c) sub-minute execution work. Nothing else needs
  them.
- **Size the choice before making it:** GBPUSD ticks ≈ 150–200 MB per year, the same year as bars ≈ 4 MB;
  BTCUSDT trades ≈ 28 MB per DAY. Tick data also makes vectorbt slow enough to change how you iterate.
  Stored gzipped per instrument-hour (this console's tick store) the same ticks are ~15–20 KB/hour ⇒
  measured **2.3 GB for 2 years × 7 instruments (122,720 hours)**, and a resumable walk took **199 min** at
  5–6 workers (~10/s sustained). Metals and indices are the heavy end (XAUUSD 500 MB, NAS100 650 MB per
  2 years); an FX-only estimate under-counts them.

## vectorbt wiring (the shape that works)

```python
import pandas as pd, vectorbt as vbt
df = pd.read_csv("GBPUSD_M1.csv", parse_dates=["timestamp"], index_col="timestamp")
m30 = df.resample("30min").agg({"open": "first", "high": "max", "low": "min",
                                "close": "last", "volume": "sum"}).dropna()
pf = vbt.Portfolio.from_signals(m30.close, entries, exits, freq="30min",
                                fees=0.00004, slippage=0.00002)
print(pf.stats())
```

`freq` must match the resample or every annualised stat is wrong. `from_signals` fills at the NEXT bar's
open by default — say which convention a result used before comparing it with the Pine emulator, which
fills intrabar.

## Honesty rules that apply to every source

- **Carry the provenance in the answer.** The same series can come from two feeds on different days; a
  response (or a stored frame) that says `source: dukascopy` after a Yahoo fallback is a lie the reader
  cannot detect. Record `{source, from, to, count, lag}` beside the bars.
- **Free is personal-use.** Dukascopy and HistData permit personal research and forbid redistribution;
  Binance and Stooq are open; Yahoo is unofficial. Never bundle a downloaded feed into a shipped repo.
- **Name the sample when quoting a result.** 60 days of FX is a smoke test, not evidence; two years is
  the minimum before "the edge is / is not there".
- **Before answering "did we download data?", count NON-EMPTY files.** A loader that caches a 404 as an
  empty hour leaves real filenames at 0 bytes, so `find … | wc -l` reports a healthy cache that holds no
  ticks. Check `-size +0`, the total bytes, and one decoded first tick's price before saying a series exists.
