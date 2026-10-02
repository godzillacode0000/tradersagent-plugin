# PineTS coverage — every LuxAlgo Library indicator, run for real

All 797 indicators whose source the LuxAlgo MCP serves were executed through the engine this
chart ships (pinets 0.10.0 when these runs were taken; the vendored engine is now the 0.11.0
fork — 500 synthetic bars, 12–20 s per script). Verdicts come from a RUN; a
regex over the source cannot tell you whether a script works, and this file exists because one did
not: `pinets-runner.js` refused every source containing `while` or `for … in` for months while the
engine ran both, which hid 450 indicators behind a guard that had stopped being true.

## Totals

- **797 indicators measured**
- **runs: 721 (90%)** — was 594 (74%) before the syminfo fix
- **crashes: 76 (10%)**
- of the ones that run: **530 plot at least one series**, 191 run and paint
  nothing (an engine ANSWER — conditions never fired, or the script draws only geometry — not a
  failure)

## The fix that mattered: syminfo

A bars-only engine has no `syminfo`: PineTS fills `_syminfo` only for a source exposing
`getSymbolInfo`. The console feeds the chart's own bars, so 146 of the 203 crashes (71%) were
scripts reading `syminfo` — tickerid 77, mintick 52, ticker 11, timezone 3, basecurrency 3.

The bars array now carries that method (no provider, no network), and `mintick` is derived from the
bars' own precision instead of assumed. Re-running those 146:

- **127 now run** (86%)
- 19 still crash, and none of them for syminfo reasons any more

## What still crashes, and why

| class | count | share of crashes | fix |
|---|---|---|---|
| script-specific / other | 46 | 60% | case by case (wrong ticker, a needed lower timeframe, …) |
| engine: transpiler | 13 | 17% | engine bug — a helper the script calls was never emitted |
| engine: array bounds | 9 | 11% | engine bug — a ternary evaluates both branches, so a guarded read throws |
| engine: type lookup | 8 | 10% | engine bug — a namespace/property lookup returns undefined |

## Timing, and why a slow script used to look like a dead console

- median run: **588 ms** · slowest: **301 s** · runs over 5 s: **86**

A run holds the page's only JS thread: a 20-second run ticked a 250 ms interval ZERO times, so no
timer fires, `withTimeout` cannot rescue it, and every queued command waits behind it. Runs now go
to a worker whose deadline TERMINATES them, so the pane answers while a script is still thinking.

## By family

| family | runs | crashes | total |
|---|---|---|---|
| ? | 402 | 12 | 414 |
| smc-ict | 47 | 13 | 60 |
| trend | 46 | 9 | 55 |
| volume-orderflow | 40 | 6 | 46 |
| market-structure | 33 | 5 | 38 |
| statistics | 26 | 5 | 31 |
| levels | 22 | 4 | 26 |
| time-seasonality | 17 | 7 | 24 |
| momentum | 23 | 1 | 24 |
| sentiment-breadth | 12 | 7 | 19 |
| patterns | 14 | 2 | 16 |
| meta-composition | 10 | 3 | 13 |
| machine-learning | 10 | 0 | 10 |
| volatility | 9 | 0 | 9 |
| risk-exits | 7 | 2 | 9 |
| elliott-harmonics | 3 | 0 | 3 |

## What this does NOT say

- The run used synthetic bars: a script that requests a higher timeframe may behave differently
  on a wired-up chart, and one asked about a specific ticker (BTCUSD) refuses to run at all.
- `runs` means the engine returned plots; it does not mean the numbers match TradingView.
- Scripts were classified at 500 bars. Some need more history before their conditions fire.

Regenerate with the sweep in the fork — `godzillacode0000/PineTS`, branch `fix/scope-collision`,
`tools/repro/` — or run one script headlessly with the Hermes skill `pinets-offline-run`
(`scripts/run-pine.mjs`). The battery script is not in this repo.
