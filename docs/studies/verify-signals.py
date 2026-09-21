#!/usr/bin/env python3
"""Do the SMC scripts detect anything, or do they merely not crash?

"ran in 250 ms" only proves the engine accepted the source. This runs each script through
`bin/trader-chart apply`, which prints the `strategy()` metrics the chart computed — the one place
those numbers are visible.

The trick that makes this a real test: each script is wrapped so that it only trades on a signal the
SMC logic produced, and a CONTROL that always trades is run first. If the control reports no trades,
the harness is broken and the other results mean nothing. A detector that finds nothing produces
zero trades, which is the failure worth catching — "the engine ran my Pine" is not the same claim as
"my Pine found what it says it finds".
"""
import re
import subprocess

CHART = "/home/godzillaton/Projects/luxalgo-web/bin/trader-chart"

FVG_SIGNAL = """//@version=6
strategy("fvg signal", overlay=true)
bullGap = low > high[2]
if bullGap
    strategy.entry("long", strategy.long)
if close < low[2]
    strategy.close("long")"""

SWEEP_SIGNAL = """//@version=6
strategy("sweep signal", overlay=true)
float pl = ta.pivotlow(low, 5, 5)
var float lastLow = na
if not na(pl)
    lastLow := pl
bool sweptLow = not na(lastLow) and low < lastLow and close > lastLow
if sweptLow
    strategy.entry("long", strategy.long)
    lastLow := na
if close < low[5]
    strategy.close("long")"""

CONTROL = """//@version=6
strategy("control", overlay=true)
if bar_index > 10
    strategy.entry("long", strategy.long)
if bar_index > 20
    strategy.close("long")"""


def run(name, pine):
    p = subprocess.run([CHART, "apply", "-"], input=pine, capture_output=True, text=True, timeout=180)
    out = (p.stdout or "") + (p.stderr or "")
    m = re.search(r"strategy: net (\S+) over (\d+) closed trades \((\d+)W/(\d+)L\)", out)
    trades = int(m.group(2)) if m else None
    print(f"\n=== {name} ===")
    print(f"  {'trades: ' + str(trades) if trades is not None else 'no strategy metrics'}")
    if m:
        print(f"  net   : {m.group(1)}  ({m.group(3)}W/{m.group(4)}L)")
    for line in out.splitlines():
        if "not runnable" in line or "RUNTIME_CRASH" in line or "PineTS error" in line:
            print(f"  FAIL  : {line.strip()[:160]}")
    return trades


def main():
    print("Each script trades only on a signal its SMC logic produced.")
    ctl = run("control (must trade — proves the harness works)", CONTROL)
    if not ctl:
        print("\nHARNESS BROKEN: the control did not trade, so nothing below is evidence.")
        return 1
    results = {"FVG (3-bar gap)": run("FVG (low > high[2])", FVG_SIGNAL),
               "sweep (pivot taken and reclaimed)": run("sweep (pivot low swept + reclaimed)", SWEEP_SIGNAL)}
    print("\n--- verdict ---")
    for name, trades in results.items():
        if trades:
            print(f"  {name:44} DETECTS  ({trades} signals)")
        else:
            print(f"  {name:44} RUNS BUT NEVER FIRES on this market")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
