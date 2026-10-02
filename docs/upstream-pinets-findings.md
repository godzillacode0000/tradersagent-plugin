# Findings from running all 797 LuxAlgo Library indicators through PineTS 0.10.0

Draft for upstream. Everything here was measured by executing the indicator sources the LuxAlgo MCP
serves, on this chart's engine (`pinets@0.10.0`, 500 synthetic bars, 15–20 s per script):
**721/797 run (90%), 76 crash** (10%).

Two of my own hypotheses failed their tests and are recorded as NOT bugs, so this does not waste
your time: `array.get` throwing on an out-of-range index matches TradingView, and a user variable
named `get` is not what breaks the scripts that report `get is not defined` (five minimal cases
passed).

---

## 1. `while` and `for … in` run — worth saying so in the docs

`WhileStatement` is in the parser and the codegen, and `whl<n>_` scope prefixes are documented in
AGENTS.md. Measured on **0.10.0 and 0.9.33**: a `while` probe and a `for … in` probe each return OK,
and a real Library script carrying a `while` (`eqh-eql-fvg-breakouts`, 17,917 chars) runs and returns
2 series.

Why it matters: consumers keep adding a pre-flight guard over the source, and a stale guard silently
hides working scripts. Mine refused every source containing `while` or `for … in` for months — 450 of
806 indicators — because it was written when the engine could not run them. A line in the README
("these constructs ARE supported as of X") retires that whole failure mode.

## 2. A bars-only engine has no `syminfo`, and the failure is confusing

The console feeds the chart's own bars (`new PineTS(candles, symbol, timeframe, limit)`). PineTS fills
`_syminfo` only when the source it was handed exposes `getSymbolInfo`, so with an array every
`syminfo.*` read is `undefined`. **146 of 203 crashes (71%)** were exactly that:
`tickerid` 77, `mintick` 52, `ticker` 11, `timezone` 3, `basecurrency` 3, `type` 10.

What we found, and what may be worth documenting: **an array that carries `getSymbolInfo` takes the
same branch.** `Array.isArray` stays true, so `loadMarketData` still returns the caller's bars, and the
engine fills `_syminfo` from the method. Proven both directions: a probe script reading
`syminfo.tickerid`/`mintick`/`timezone` PASSES with the method attached and FAILS with the identical
bars when it is not.

Two suggestions:

- Document that form. The alternative is what we did first — invent a provider, or retry with
  `Provider.Binance`, which needs network access a local chart may not have.
- Consider failing loudly. A script whose first line reads `syminfo.tickerid` currently dies with
  `Cannot read properties of undefined (reading 'tickerid')`, which reads like a broken script rather
  than "this engine has no market context".

## 3. Crashes whose cause is inside the engine (no minimal repro yet)

These are the shapes that remain after the syminfo class is fixed. Each is reported with the
indicator it came from and the stack frame, because a message alone is not a cause.

| indicator | message | frame |
|---|---|---|
| `money-flow-profile`, `delta-flow-profile` | `Cannot read properties of undefined (reading 'size')` | an internal getter (`Oc.size`) |
| `delta-zigzag` | `$.get(...)?.size is not a function` | generated code |
| `correlation-clusters` | `Cannot read properties of undefined (reading '449')` | `request.security` |
| `breakout-detector-previous-mtf-high-low-levels` | `"fail".box is not a function` | generated code |
| `breakouts-with-tests-retests` | `"bear".label is not a function` | generated code |

The last two look like a colour/namespace value reaching a drawing call, and the two `.size` cases look
like one root cause. We can supply the full sources and stacks on request; we cannot yet reduce them to
a snippet, which is why this section is a pointer and not a bug report.

Possibly related, already open: #276, #278, #256 (all `request.security` in user functions).

## 4. Run time: one indicator took 301 seconds

Of the runs that completed, the median was **781 ms** and 86 took over 5 s; the slowest was **301 s**
(`gaussian-mixture-models`). A consumer that runs scripts in-process must survive that: a 20-second run
ticked a 250 ms interval ZERO times here, so no timer fires while a run is in flight, and every queued
command waits behind it. We now run each script in a worker and terminate on a deadline.

If a documented time budget exists for indicator scripts, saying so would help consumers pick one.

## 5. Explicitly NOT bugs

- `array.get(empty_array, -1)` → `Index -1 is out of bounds, array size is 0.` TradingView throws on
  out-of-range array access; matching that is correct. 8 of the remaining crashes are scripts hitting
  this on synthetic data.
- Scripts that refuse to run on the wrong symbol: `bitcoin-power-law` and `bitcoin-power-law-clock`
  require BTCUSD / INDEX:BTCUSD, `bitcoin-expectile-model` needs daily or higher, `single-prints` and
  `tpo-profile` need a lower timeframe than the chart. These are the scripts doing their job.
- The 191 runs that plot nothing: an engine ANSWER (conditions never fired on synthetic bars, or the
  script draws only geometry), not a failure.

---

Environment: `pinets@0.10.0` (also spot-checked `0.9.33`), Node on Linux, bars handed in as an array
with `getSymbolInfo` attached, 500 bars of synthetic OHLCV, `symbol=BTCUSDT`, `timeframe=30`.

Reproduction for anything here: the sweep script and the probes live in the fork
(`godzillacode0000/PineTS`, branch `fix/scope-collision`, `tools/repro/`) and in the Hermes skill
`pinets-offline-run`; the raw per-indicator verdicts are in `docs/PINETS-COVERAGE.md`.
