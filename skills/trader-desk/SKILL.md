---
name: trader-desk
description: Use when driving the Trader's Agent chart (Vela/LuxAlgo) from chat — read, switch, add/remove natives, draw overlay levels, screenshot. Covers tool order, one-indicator-at-a-time, and what the engine cannot do.
---

# Trader's Agent — prompt to chart

The chart is a live LuxAlgo **Vela** console (`http://127.0.0.1:8787`) in the Trader's Agent pane.
There is no headless mode. Drive it with the **`traders-chart` MCP tools** (preferred) or
`bin/trader-chart` — both hit the same HTTP API.

Do **not** port or run LuxAlgo Library Pine unless the operator names a script. Prompt-to-chart is
natives + overlay drawings + market/state/shot.

## Step 0 — is anything listening?

- `chart_views` first. 0 views → tell the operator to open the Trader's Agent row. Do not queue work
  and report it as done.
- Stale frame: `chart_state` reports `build` + `viewer`. Compare with the console (`/api/build`).
  If they disagree, `chart_reload` (once-per-view) then re-read.

## Step 1 — read before you write

- `chart_state` → symbol, timeframe, last, bars, **indicators on the chart**, build/viewer.
- `chart_caps` → actions **this page** can execute.
- `chart_palette` → colours the chart is wearing (do not guess from a screenshot).

## Step 2 — put the chart where the analysis needs it

- `chart_set_market` (symbol + timeframe), then re-read `chart_state`.
- Prefer the timeframe the operator asked for.

## Step 3 — one study at a time

1. Take extras off: `chart_remove_indicator(all=True)` for Vela natives the operator or agent added.
   `chart_clear` only removes **our overlay + paint layer**, not studies added with `add`.
2. One native: `chart_add_indicator("ema")` **or** one overlay script: `chart_draw` (levels/lines)
   **or** `chart_apply_pine` (plots that map to a Vela native).
3. `chart_shot` — say what the picture shows.
4. Only then the next study.

Never stack "to save time".

## Step 4 — prove it

A tool answer is not a picture. `chart_shot` after every mutation. If `ok: false`, the chart did not
change — report that, never "done".

## Prompt mapping (what to call)

| Operator says | Tool |
|---|---|
| what symbol / what's on the chart | `chart_state` then maybe `chart_shot` |
| open / switch SOLUSDT 1h | `chart_set_market` |
| add EMA / MACD / supertrend | `chart_add_indicator` |
| remove indicators / clear studies | `chart_remove_indicator(all=True)` |
| draw PDH/PDL / lines / boxes | `chart_draw` (overlay). Not `chart_apply_pine` for a plain price level. |
| screenshot | `chart_shot` |
| chart looks stale / old JS | `chart_reload` |
| chart is light/dark | `chart_palette` |

## When a script fails

| code | meaning | what to do |
|---|---|---|
| `NOT_RUNNABLE[while/for-in/import]` | PineTS cannot execute that construct | Stop. Do not port Library scripts unless asked. For levels, compute from data and `chart_draw`. |
| `RUNTIME_CRASH[…]` | engine threw mid-run | Report the code + line. |
| `TOO_FEW_BARS` | not enough history | Widen range, retry once. |
| `ENGINE_UNAVAILABLE` | PineTS module not fetched | Network; retry when online. |
| `TIMEOUT` | run exceeded budget | Retry once; then a lighter script. |

## Hard stops

- One indicator per chart. Replace, never stack.
- No claim without a screenshot.
- Do not invent LuxAlgo lookalikes unless the operator asked for a data-drawn level (PDH/PDL pattern).
- A frozen/occluded pane executes nothing — `chart_views` / heartbeat `build`, then `chart_reload`.
- Layout 3-zone is the operator's saved preset (`user-trader-s-agent-plugin`). A plugin cannot apply
  it; the agent can (`apply_layout`) on desktop sessions only.

## Frontend reload

Changed console JS needs `chart_reload` / `bin/trader-chart reload`, not an app restart.
MCP **new tools** need a **new session** (or `/reload-mcp`).
