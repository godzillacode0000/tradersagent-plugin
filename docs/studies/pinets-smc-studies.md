# PineSMC studies — what actually runs on this chart

Two SMC/ICT scripts written for PineTS, and the engine limits found while writing them. Everything
here was measured through `bin/trader-chart apply`, which runs the chart's own engine over the
chart's own bars.

## The scripts

| Script | What it does | Signals found |
|---|---|---|
| `pine/fvg-mitigation.pine` | Fair value gaps (`low > high[2]`), kept until price trades back into them, drawn as boxes that read differently once mitigated | 26 trades on SOLUSDT 4h, 500 bars |
| `pine/liquidity-sweeps.pine` | Confirmed pivots remembered as levels, marked swept only when price breaks one **and** closes back inside; sessions shaded | 12 trades on the same window |

Neither is copied from the LuxAlgo Library. They were written against the primitives the 59 SMC/ICT
Library scripts actually use, then reduced to what this engine runs.

## How "it works" was tested

`ran in 250 ms` only proves the engine accepted the source. To test that a script *detects* the thing
it claims to detect, each was wrapped in a `strategy()` that trades only on its signal, and a control
script that always trades was run first:

```
control (always trades)  → 239 trades   ← proves the harness itself works
FVG (low > high[2])      →  26 trades
sweep (pivot + reclaim)  →  12 trades
```

A detector that finds nothing reports zero trades, which is the failure this catches. If the control
had reported nothing, the other two numbers would have meant nothing.

## Engine limits, measured

| Construct | Result |
|---|---|
| `while` | **REFUSED** — `` `while` loops are unimplemented in PineTS``. Use a counted `for`. |
| `import` | **REFUSED** — no library imports at all. Self-contained source only. |
| `array.get(a, array.size(a) - 1)` **inside `plot()`** | **CRASH** — `` Index -1 is out of bounds, array size is 0 ``. Plot arguments are evaluated before the first push, so the index is -1 while the array is empty. Track the value in its own `var float` instead. |
| `for i = 0 to <negative>` | **CRASH** — same `Index -1` error. Compute the count first and guard the loop with an `if`. |
| for-loop over an empty array | **CRASH** — guard with `if array.size(a) > 0`. |
| 3-bar indexing `high[2]`, `var`, UDTs, arrays, `ta.pivothigh`, `hour`/`minute`, `box.new`/`line.new`/`label.new`/`table.new`, `ta.atr`, `request.security`, `for … in`, `strategy()` | **RUN** (200–430 ms over 500 bars) |

An earlier probe of mine reported 1/18 constructs working. That was wrong, and the cause was the
probe itself: its Pine templates began with a newline, so the engine saw an empty line 1 and refused
with `Unexpected token (2:5)`. The lesson is in the harness, not the engine — measured 16/16 once the
templates stopped starting with a blank line.

## What the chart exposes from a run

`apply` reports `series` (a count), `strategy` metrics when the script uses `strategy()`, `ctor`
(which PineTS constructor ran), and the drawing types the script produced. **Individual plot values
are not exposed.** Anything that needs to be read back must be expressed as a strategy metric or
drawn — which is why the test above trades rather than plots a count.
