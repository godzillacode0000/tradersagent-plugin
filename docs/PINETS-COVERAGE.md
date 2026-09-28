# PineTS coverage — every LuxAlgo Library indicator, run for real

All 797 indicators whose source the LuxAlgo MCP serves were executed through the engine this
chart ships (pinets 0.10.0, 500 synthetic bars, 12–20 s per script). Verdicts below come from a RUN;
a regex over the source cannot tell you whether a script works, and this file exists because one
did not: `pinets-runner.js` refused every source containing `while` or `for … in` for months while
the engine ran both, which hid 450 of these indicators behind a guard that had stopped being true.

## Totals

- **runs**: 594 (74%)
- **crashes**: 203 (25%)
- **timeouts**: 0

Of the 594 that run, **447 plot at least one series** and **147 run but
paint nothing** — the latter is an engine ANSWER (conditions never fired, or the script draws only
geometry), not a failure.

## Why the crashes crash, and what each class needs

| class | count | share of crashes | fix |
|---|---|---|---|
| missing syminfo | 146 | 71% | give the engine a provider or inject `syminfo` (tickerid/mintick/timezone/basecurrency) |
| other | 32 | 15% | case by case |
| engine: transpiler | 10 | 4% | engine bug — a helper the script calls was not emitted |
| engine: type lookup | 8 | 3% | engine bug — a namespace/property lookup returns undefined |
| engine: array bounds | 7 | 3% | engine bug — a ternary evaluates both branches, so a guarded array read throws |

**The syminfo class is one fix for 146 of 203 crashes.** With it, the catalogue's
run rate goes from 74% to about 92%.

## Timing (why a slow script looks like a dead console)

- median run: **781 ms**
- slowest run: **301 s**
- runs over 5 s: **86**

A single script can block the console's JS thread for minutes, which is why the page stops
answering queued commands and reads as dead. Isolating a run in a Worker with a deadline is the
fix for that class of hang.

## By family

| family | runs | crashes | total |
|---|---|---|---|
| ? | 352 | 62 | 414 |
| smc-ict | 36 | 24 | 60 |
| trend | 41 | 14 | 55 |
| volume-orderflow | 26 | 20 | 46 |
| market-structure | 23 | 15 | 38 |
| statistics | 23 | 8 | 31 |
| levels | 16 | 10 | 26 |
| time-seasonality | 9 | 15 | 24 |
| momentum | 19 | 5 | 24 |
| sentiment-breadth | 9 | 10 | 19 |
| patterns | 10 | 6 | 16 |
| meta-composition | 6 | 7 | 13 |
| machine-learning | 9 | 1 | 10 |
| volatility | 7 | 2 | 9 |
| risk-exits | 6 | 3 | 9 |
| elliott-harmonics | 2 | 1 | 3 |

## What this does NOT say

- The run used synthetic bars and no provider: a script that reads `syminfo` or requests a
  higher timeframe fails HERE for a reason that a wired-up console may not have.
- `runs` means the engine returned plots; it does not mean the numbers match TradingView.
- Scripts were classified at 500 bars. Some need more history before their conditions fire.

Regenerate with the sweep in `traders-agent-apply-indicator` (`battery-many.mjs`).
