---
name: trading-desk
description: Use when driving the Trader's Agent chart (Vela/LuxAlgo) — analyse a chart, run a LuxAlgo Library indicator on it, or check what the live chart is showing. Covers the tool order, the one-indicator-at-a-time rule, and what the engine cannot do.
---

# Trader's Agent chart workflow

The chart is a live LuxAlgo **Vela** console (`http://127.0.0.1:8787`) embedded in the Trader's Agent
pane. There is no headless mode: nothing works while no view is attached. You drive it with the
`trader-chart` CLI or the `trader-chart` MCP tools — both hit the same console and speak the same JSON.

## Step 0 — is anything listening?

- `chart_views` (MCP) or `bin/trader-chart state`
- No view attached → say so and ask the operator to open the Trader's Agent row. Do **not** queue work
  and report it as done.

## Step 1 — read before you write

- `chart_state` → symbol, timeframe, last price, bars, indicators already on the chart.
- `bin/trader-chart caps` → the actions **this page** can execute (it publishes its own list; an action
  missing here will be refused, not silently ignored).

## Step 2 — put the chart where the analysis needs it

- `chart_set_market` / `bin/trader-chart market BTCUSDT 15m`, then re-read `chart_state` to confirm.
- Prefer the timeframe the operator asked for; the engine fetches its own bars and the visible series
  is what it reads, so a mismatch shows up as levels drawn at the wrong prices.

## Step 3 — one indicator at a time, always

1. Clear first: `chart_clear` (removes the overlay drawings *and* the natives our paint layer added).
2. Pick **one** script:
   - draws levels/boxes/lines → `chart_draw` (paint on the overlay), or
   - plots a line → `chart_apply_pine` (paint a matching Vela native).
   `chart_draw` also renders a **dashboard `table`** — a backtester's whole output is one table, and it
   is drawn as an HTML layer positioned where the script asked.
3. Screenshot it: `chart_shot`.
4. Only then move to the next script.

Never apply a second indicator "to save time": the chart is a shared surface with the operator, and a
stacked mess cannot be told apart from a working one.

## Step 4 — prove it painted

`chart_shot` after every change, and say what the picture shows. A tool answer is not a picture:

- `chart_draw` reports what is **verified on canvas** (`onCanvas`), not what the script asked for.
- `chart_apply_pine` / `chart_add` report the natives the chart carries **after** the call.
- If a mutation reports `ok: false`, the chart did not change — report that, never "done".

## When a script is refused, one marked edit can make it run

`NOT_RUNNABLE[for-in]` is the cheapest refusal to repair, and the repair does not change what the
indicator computes: PineTS refuses `for … in`, but it runs an indexed loop over the same array.

1. Keep the library's source **verbatim** and mark the edit — the caller must be able to see that this is
   the Library's script with one compatibility edit, not a hand-written lookalike. Record the slug, the
   source's sha256, and the line you touched, above the source.
2. `for p in arr` + `arr` element inside the body becomes `for _i = 0 to array.size(arr) - 1` with
   `array.get(arr, _i)` in the body. Nothing else.
3. Re-run it. Measured on `universal-signal-backtester`: refused verbatim → after that single edit it runs
   in ~1.1 s over 500 bars (16 series, 161 lines, 184 labels, 1 table).
4. Report the edit and the before/after run times; never present the ported file as untouched Library code.

## When a script fails

The runner returns a stable code beside the prose. React to the code, not the sentence:

| code | meaning | what to do |
|---|---|---|
| `NOT_RUNNABLE[while/for-in/import]` | PineTS cannot execute that construct | Stop. Pick another Library script; never retry the same one. |
| `RUNTIME_CRASH[pinets-get_v / pinets-ticker / pinets-runtime]` | the engine threw mid-run | Report the code + line. It is an engine bug, not the operator's call. |
| `TOO_FEW_BARS` | not enough history loaded | Widen the range / scroll back, then retry once. |
| `ENGINE_UNAVAILABLE` | the PineTS module could not be fetched | Check network; retry when online. |
| `TIMEOUT` | the run exceeded its budget | Retry once; if it repeats, use a lighter script. |

## Hard stops

- **One indicator per chart.** Replace, never stack (`chart_clear` between runs).
- **No claim without a screenshot.** "It runs" and "you can see it" are different claims.
- **Do not invent indicators.** Everything comes from the LuxAlgo Library
  (`library_search` → `library_indicator` → run that source). Hand-written lookalikes are the wrong
  deliverable even when they work.
- **Do not promise coverage.** The engine's own limits are below; if a script hits one, say so.

## What the engine cannot do (measured, not guessed)

- No `import`, no `while`, no `for … in` — those scripts are refused up front, with the construct named.
- No drawing surface of its own: box/line/label scripts run and their geometry is painted by the
  console's **overlay** (`chart_draw`). A script whose output is only plots gets a native approximation
  instead, and the answer says when only part of it could be drawn.
- Market context (`syminfo`, `tickerid`) comes from the provider form of the engine; a script that reads
  it works, and the run reports which constructor ran (`ctor: provider`).
- `while` and `for … in` are the only hard refusals worth porting; UDTs, `method` calls and helper
  functions fail later, at run time — run a candidate before recommending it.
- Replay is not available in this build.
- A **changed frontend file** (overlay/bridge) needs `bin/trader-chart reload`, not an app restart: the
  page reloads itself and picks the new JS up. `bin/trader-chart caps` confirms the action list.
