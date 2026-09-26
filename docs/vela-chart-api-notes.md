# Driving Vela from the agent — measured notes

Everything here was read off the **running** app (the console page) rather than from documentation,
and each line cost at least one failed attempt. Dates: 19–20 Sep 2026, Vela as loaded from CDN by
`frontend/workspace.js`, console at `127.0.0.1:8787`.

## Why this file exists

Removing two indicators took far longer than it should have, and the reason is worth writing down:
**the capability did not exist end to end.** There was no MCP tool, no CLI subcommand and no bridge
action for it — and once a bridge action existed, *which* Vela call removes a study turned out to be
something no amount of reading the page could settle, because the wrong calls fail **silently**:

| Call | Result |
| --- | --- |
| `chart.indicators()` | the ledger: array of study entries (`nativeType`, `id`, `controller`, …) |
| `chart.indicators` (no call) | a **function**, not a control — inspecting it shows only `Function.prototype` keys |
| `cell.removeNative('macd')` | throws inside Vela: `e.remove is not a function` (it calls `.remove()` on its argument) |
| `cell.removeInstance('native-1')` | **returns cleanly, removes nothing** |
| `cell.removeFromChart('native-1')` | **returns cleanly, removes nothing** |
| workspace state `charts[0].indicators.natives` | `[]` while the chart carried two studies — the state is not the ledger |
| **`ledgerEntry.remove()`** | ✅ removes the study; the only door that worked |

So the rule for anything new here: **read the artefact back after the call** (`presentNativeIndicators()`,
`ChartOverlay.state()`, the heartbeat) and report before → after. A call that returns without an error
is not evidence that anything happened — three of the doors above are silent no-ops.

## The working recipe

**Remove indicators** — `trader-chart remove MACD` or `trader-chart remove --all`
(MCP: `chart_remove_indicator`). The bridge takes the ledger, calls each entry's own `remove()`, and
re-reads the list; because the ledger shifts as studies come off, `all` passes repeatedly (max 6) until
the chart is empty or a pass changes nothing.

**Add an indicator** — `trader-chart add ema` (MCP: `chart_add_indicator`). Verified: `add ema` →
`chart now carries: ema`; then `remove --all` → `chart now carries: nothing`.

**Draw price levels (PDH/PDL and friends)** — the two bridges differ, and knowing which is which saves
a cycle:

* `apply <file.pine>` runs Pine and paints what it makes: geometry (boxes/lines/labels/tables) on our
  overlay, plot series as a **Vela native** matching the script. When a plain price level has **no**
  matching native, the answer still says so:
  *"2 series · not drawn: no Vela native in this build expresses what this script computes"*.
* `draw <file.pine>` runs Pine and paints the **geometry the script builds** (lines/labels/boxes/tables)
  on our overlay layer. This is the one that shows a level.

Measured example, `SOLUSDT 1h`, previous UTC day 2026-09-19 (Binance daily klines):

```
PDH 114.09 · PDL 110.08
draw → ran in 273 ms · overlay drew 0 box(es), 2 line(s), 2 label(s) · verified: 0/2/2 on screen
```

**The per-bar trap.** The Pine runtime executes the script **once per bar**. An unguarded `line.new`
inside a 500-bar run produced **50 lines and 50 labels** (the window showed only part of them). A level
does not depend on the current bar at all, so draw it once:

```pine
//@version=6
indicator("PDH/PDL SOLUSDT")
var bool drawn = false
if not drawn
    drawn := true
    line.new(0, 114.09, 499, 114.09, xloc=xloc.bar_index, color=color.orange, width=2)
    label.new(2, 114.09, "PDH 114.0900", xloc=xloc.bar_index, style=label.style_label_left, color=color.new(color.orange, 20), textcolor=color.black)
```

Absolute bar coordinates (`0` → `bars-1`) also make the line span the whole loaded window instead of
trailing the last bar.

## The Library is a catalogue, not a runtime

`library_search previous-highs-lows` → **"Previous Highs & Lows"** (`previous-highs-lows`), which plots
each completed period's high/low (hourly → yearly) — the closest thing to PDH/PDL in the catalogue, and
it is real. Its Pine, however, **cannot run here**:

```
draw previous-highs-lows.pine
→ not runnable: `for … in` is unimplemented in PineTS
  NOT_RUNNABLE[for-in]: needs a full TradingView engine
```

That is the documented subset wall: no `import`, no `while`, no `for … in`. Vela's own Pine engine is a
paid feature and is not used. When a Library script hits the wall, compute the value from the data and
draw it — the levels get on the chart either way, and the answer says which route was taken.

## Fast answers for the operator

* MCP tools hit the console API directly (`chart_state`, `chart_shot`, `chart_add_indicator`,
  `chart_remove_indicator`, `chart_apply_pine`, `chart_set_market`, …): symbol switch measured
  **686–698 ms** end to end, screenshot **35 ms**, `clear` **7 ms**.
* The latency is the chart engine (fetch bars + re-render), not the transport: the SSE push is
  single-digit ms.
* A **frozen or occluded frame** executes nothing — no reload, no command. If a console looks stale,
  check the heartbeat's `build`/`viewer` against `/api/build` before debugging anything else.
* `trader-chart reload` reaches **every** view (once-per-view command); a single reload only touched the
  view that claimed it first.

## The workspace grid (multi-pane) — measured

`@luxalgo/vela@0.7.3` ships a real chart grid; this console had it switched off. Everything below was
measured from the running page, not read off the docs.

| Where | Result |
| --- | --- |
| Presets (`ws.setLayout(id)`) | `"1"` Single · `"2h"` 2 side by side · `"2v"` 2 stacked · `"4"` 4 grid · `"8"` 8 grid |
| Custom grid | `g<cols>x<rows>` with **1–4 each** (`g2x3` = 6 cells). `setLayout` resolves it through the same registry the presets use |
| Layout omitted at construction | Vela's own default is **`"4"`** — a four-chart grid |
| `layout: false` | sets `monoLayout`, and `setLayout()` **returns immediately** — pinned for the life of the page, not just at boot |
| A layout already in page state | **wins over the constructor value** (`resolveLayout(s?.layout ?? fallback)`), so a grid set from chat survives a reload — measured: set `2h`, reloaded, still `2h` |
| `ws.layout` | the current def: `.id`, `.label` (`"2 side by side"`), `.cells` |
| `ws.cells()` | the evidence: each cell carries `.id`, `.chart`, and its **own** `.symbol` / `.timeframe` |
| `ws.monoLayout` | `true` only when the page was built with `layout: false` |
| `ws.screenshot()` | **composite** when more than one cell is visible (`compositeLayoutShot`): the same capture grew 75 KB → 167 KB at 2 cells. `shotCells()` filters `host.style.visibility === "hidden"`, so a cell still fetching its bars is simply **absent** from the picture — 83 KB meant one cell, not a broken grid |
| Topbar | a **Layout** button + picker appears with the grid (plus `Sync` for symbol/timeframe/interval/crosshair/style), which is the same `setLayout` call this door makes |

Live proof, in order:

```
trader-chart layout          → layout 1 (Single) · 1 cell(s): SOLUSDT 240
trader-chart layout 2h       → layout 1 → 2h (2 side by side) · 2 cell(s): SOLUSDT 240 · SOLUSDT D
trader-chart layout 4        → layout 2h → 4 (4 grid) · 4 cell(s): SOLUSDT 240 · SOLUSDT D · SOLUSDT 30 · SOLUSDT 240
trader-chart layout 9        → unknown layout "9" — use 1, 2h, 2v, 4, 8, or a custom grid g<cols>x<rows> (1–4 each)  (exit 1, chart untouched)
trader-chart shot --out …    → two panes: SOLUSDT 4h (left) and SOLUSDT 1D (right)
```

Cells inherit the active cell's symbol when the grid grows — a new pane is the same market on another
timeframe until something else is asked for.
