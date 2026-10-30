# Pine strategy backtests: spec → script → numbers

How to turn a trader's verbal rules into a `strategy()` the emulator can backtest, and how to prove the
numbers are the engine's. Vela/PineTS specifics below were measured against the vendored bundle
(`console/frontend/vendor/pinets/pinets.min.browser.es.js`); the workflow outlives the version.

## Order of work

1. **Probe the capabilities before writing the strategy.** A five-rule spec usually contains one thing
   the engine cannot do and one it does silently wrong. Three tiny scripts answer both in a minute:
   session filter, cross-symbol read, resting limit + brackets (below).
2. **Write the skeleton** with the rules as named inputs (`input.session`, `input.bool` for each gate),
   so a rule can be switched off and its contribution measured.
3. **Instrument before tuning.** `var int nSetup/nArm/nFill`, `+= 1` at each gate, plotted — then read
   the last values. "0 trades" is always one gate closing, never the engine.
4. **Widen the sample.** The pane's 500 bars is ~10 days on 30m: 3 setups, meaningless. Use the provider
   engine with `limit 5000` (~104 days on 30m) before saying anything about edge.
5. **Quote the ledger, with N.** Net, trades, win rate + N, PF, max DD; and compare with the filter ON
   vs OFF when the operator asked for a filter — that comparison is the answer to "is my rule useful".

## Capability probes (run each as its own throwaway `strategy()`)

| Probe | Source | What it proves |
|---|---|---|
| session | `inSession = not na(time(timeframe.period, "0900-1200", "America/New_York"))` | session windows + IANA timezone work |
| cross-symbol | `a = request.security("ETHUSDT", timeframe.period, close)` plotted beside `close` | whether ETH is real or the chart's own series |
| orders | `strategy.entry(..., limit=close-3)` then `strategy.exit(stop=…, limit=…)` | resting limits + intrabar brackets fill and close |
| news list | `time >= input.time(timestamp("…")) ± minutes` | blackout windows from explicit timestamps |

**Cross-symbol is the one that lies quietly.** On a custom-bars/worker engine `request.security` returns the
chart's own series (BTC 68778 vs "ETH" 68778, identical array). On `new PineTS(Provider.Binance, …)` it
returns real ETH (2412 vs 82092). Any SMT / pair / relative-strength rule therefore needs a provider engine;
the pane's default worker path cannot run it honestly.

## Harness (no pane, no operator)

```js
const { PineTS, Provider } = await import('<repo>/console/frontend/vendor/pinets/pinets.min.browser.es.js');
const engine = new PineTS(Provider.Binance, 'BTCUSDT', '30', 5000);   // provider = real cross-symbol + history
let out; try { out = await engine.run(src); }
catch (e) { console.log('ENGINE ERROR:', String(e.message || e).split('\n')[0]); process.exit(2); }
// ledger: out.strategy.{netprofit, closedtrades[], wintrades, losstrades, grossprofit, grossloss,
//                    max_drawdown, max_drawdown_percent_value, opentrades[], config{commission…}}
// counters: read any plot series (`out.plots['dbg setups']`) for the last non-null value
```

- **Wrap `engine.run` in try/catch.** An uncaught rejection prints the WHOLE minified bundle as the error
  frame and buries the one useful line.
- Synthetic bars need `bars.getSymbolInfo = async () => ({ tickerid: 'BINANCE:BTCUSDT', mintick: 0.01,
  timezone: 'UTC', currency: 'USDT', basecurrency: 'BTC', session: '24x7', type: 'crypto' })` — it must
  return a Promise, and without it `syminfo` reads crash.
- Provider runs hit the network: keep the token count small and expect a few seconds.

## Engine contract worth knowing

- `grossloss` is a **positive magnitude**; ledger sums are signed. Profit factor =
  `grossprofit / |grossloss|`, `∞` only when the loss is zero. Pinned by
  `console/backend/tests/test_tester_strip.py` and fixed in both readers (`tester.js`, mcp `_ledger_line`).
- Per-trade rows carry `entry_time/exit_time/entry_price/exit_price/size/profit/commission/max_drawdown/max_runup`
  — enough for a ledger table without recomputing anything.
- `config` (from the declaration) carries `initial_capital, currency, commission_type/value, slippage,
  margin_long/short, pyramiding, process_orders_on_close`. The worker's smaller summary may DROP `config`
  and the gross/loss totals: recover the title from the source (`strategy("…")`) and derive gross/loss from
  the closed trades, then say which source the ratio came from.
- `max_drawdown_percent_value` is the % figure; `max_drawdown` is money.

## Pine rules that cost a debugging session otherwise

1. **`ta.*` must run on every bar.** Calling `ta.atr(14)` inside `if ready` makes the series sparse: the
   entry fills, the stop/target are garbage or `na`, and the run closes zero trades. Hoist every `ta.*` to
   top level and only branch on its value.
2. **Brackets do not survive a later fill.** Place `strategy.exit(...)` every bar while
   `strategy.position_size > 0`, keyed to the entry id — issuing it once beside a resting limit entry is
   not enough.
3. **Cancel stale limits** with `strategy.cancel(id)` after N bars, or a pullback order from a week ago
   fills on an unrelated move.
4. **Invalidate on a CLOSE through the level**, not a wick — a re-test of the sweep is normal.
5. Session strings are `HHMM-HHMM[:days]`; build the tradable window as its own input instead of doing
   arithmetic on session strings (`"0830-" + str.tostring(...)` produces `"0830-860"` and throws).
6. `str.split`/date parsing is painful in Pine — express a news blackout as `input.time(timestamp("…"))`
   pairs ± N minutes, not as a comma-separated string of dates.
7. **`//@version=5` on line 1, always.** Without it the transpiler defaults to an older dialect and fails as a
   JS-level `Unexpected token (line:col)` — the numbers point into generated code, so the reported line is not the
   Pine line. Prepend the header and re-run before rewriting anything.
8. **A risk-sized qty can be silently rejected by the margin gate.** `strategy.equity*risk%/(entry-stop)` is many
   times the account's notional; with `margin_long=100` the emulator places the orders and fills none of them
   (85 placed, 0 filled, no error). `margin_long=0, margin_short=0` for risk sizing, and confirm with a counter
   that orders actually filled rather than re-tweaking the logic.

## Verbal spec → Pine mapping (the recurring shapes)

| Rule as spoken | Pine construct | Caveat |
|---|---|---|
| "NY AM only" | `time(timeframe.period, input.session("0900-1200"), "America/New_York")` | skip the release minute by starting after it |
| "spot SMT" | `request.security("ETHUSDT", timeframe.period, low)` + rolling-low comparison | provider engine only (see probe) |
| "no high-impact news" | `input.time(timestamp(...))` ± minutes, or a calendar feed into the host | Pine has no economic calendar |
| "liquidity sweep" | `low < ta.lowest(low, 20)[1] and close > ta.lowest(low, 20)[1]` | wick beyond + close back inside |
| "50% fib pullback entry" | leg = highest high over next ≤10 bars; `strategy.entry(limit=(sweepLow+legHigh)/2)` | needs a state machine: `var float sweepLow/legHigh`, `var int armedAt` |
| "stop under the sweep" | `stop = sweepLow - atr*0.1`; target `2R` or the opposing liquidity | state which target was used |

## Calibration from a real run

BTCUSDT 30m, 5,000 bars (~104 days), spot long-only, 25% equity, 0.04% commission, 2 slippage, 2R target,
NY AM after the release, sweep of a 20-bar low + 50% fib limit:

- SMT gate ON: 24 setups → 13 armed → 11 closed, net +81.46 on 10k, win 45.5% (n=11), PF 2.30, max DD 0.56%
- SMT gate OFF: 49 setups → 21 armed → 16 closed, net +40.37, win 37.5%, PF 1.36, max DD 0.67%

Read as: the filter doubled the net on a sample too small to be evidence. Say that, and offer the wider
sample instead of a verdict.

## Calibration from a forex run (the same skeleton, a different market)

GBPUSD 1h, 17,258 bars (~2 years, Yahoo FX), 1.5% risk per trade, `margin_long=0`, NY-AM window, SMT vs
EURUSD. The rules' own target shape is the problem:

| Variant | Trades | Net | Win% | PF |
|---|---|---|---|---|
| 2R + SMT (as spoken) | 68 | −867.75 | 34% | 0.88 |
| 1.5R + SMT | 67 | −312.44 | 39% | 0.95 |
| 1R + SMT | 68 | +40.53 | 46% | 1.01 |
| 2R, SMT off | 123 | −451.27 | 34% | 0.96 |

A 50%-retrace entry with a tight stop and a 2R target asks for a runner these sweeps do not produce; the SMT
gate still halves the loss, so the filter is doing work even when the whole is unprofitable. Report that as
the finding — with the sample, the pair and the timeframe — and propose the next experiment (stricter sweep
displacement, HTF bias, 1R) instead of presenting any variant as an edge. FX data plumbing and the
`//@fx` routing: `references/fx-data-and-providers.md`.
