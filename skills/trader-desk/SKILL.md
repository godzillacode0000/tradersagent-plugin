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

- `chart_set_market` (symbol + timeframe). The answer already has last price and bars — do not follow
  with `chart_state` just to confirm.
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
| split the chart / 2 panes / 4 charts / "multipane" | `chart_set_layout` — no argument **reads** the grid |
| which indicators can this chart take | `chart_natives` — Vela's built-ins for this market, read from the frame |
| what is ON the chart right now | `chart_studies` — every reader, labelled; ask this before calling a chart clean |
| open the Indicators panel / star one / search the catalogue | `chart_indicators` — section `favorites`/`builtins`/`library`, `q`, `family` (one group of the catalogue; `all` clears), `reading SLUG`, `fold FAMILY[:on]`, `star`/`unstar KIND:ID`, `mount` |
| add EMA / MACD / supertrend | `chart_add_indicator` |
| remove indicators / clear studies | `chart_remove_indicator(all=True)` |
| draw PDH/PDL / lines / boxes | `chart_draw` (overlay). Not `chart_apply_pine` for a plain price level. |
| screenshot | `chart_shot` |
| chart looks stale / old JS | `chart_reload` |
| chart is light/dark | `chart_palette` |

## The grid (multi-pane)

Vela's workspace is a real chart grid. `chart_set_layout(layout)` takes `1` (single), `2h` (2 side by
side), `2v` (2 stacked), `4`, `8`, or a custom `g<cols>x<rows>` (1–4 each); **no argument reads the
grid** (a read never writes). The answer carries the layout id and every cell's own symbol/timeframe —
quote those, not the id asked for.

- A console built with `layout: false` sets `monoLayout`, and `setLayout()` is then a **permanent
  no-op**: the tool answers truthfully that the page must boot with a preset. Do not call it "broken".
- A grid already in the page's state **wins over the boot preset**, so a change made from chat
  survives a reload.
- Cells inherit the active cell's symbol — a wider grid is the same market on other timeframes until
  something else is asked.
- `chart_shot` composites only the **visible** cells (`shotCells()` skips hidden hosts), so a capture
  taken while a cell still fetches bars shows fewer panes than the grid has. Size is the tell: ~75 KB
  one pane, ~167 KB two.
- The topbar's own **Layout** and **Sync** controls are the same `setLayout` call — never claim the
  agent did something the operator's own picker cannot do.

## What is actually on the chart

`chart_state`'s `natives` list is **Vela's names only** — a script mounted from the Library (Run
PineTS / Add to chart) is not one of them, and it lives on the console's overlay/paint layer. A
natives-only report called a chart clean while CRT boxes and "Manipulation" labels sat on it (26 Sep).
Use `chart_studies`: one row per study, each labelled with the reader that saw it — `study` (the
console's own chip), `cell`, `overlay` (a Library run), `paint`, `native`.

- `chart_remove_indicator(all=true)` (`trader-chart remove --all`) now reaches all of them: studies
  through the chart's ledger, then the overlay/paint layer for script runs, and its answer names what
  came off — `overlay cleared: 69/123/17 + 1 run(s)`. Verify with `chart_studies`, then `chart_shot`.
- Removing a **script by name** cannot be surgical: `ChartOverlay` is all-or-nothing. The door says so
  instead of a bare "nothing removed"; the way out is `all` (or `clear`, which also wipes drawings).
- `chart_clear` removes our overlay + paint layer only, and reports what still remains.

## The Indicators surface

One modal in the chart's top bar (`⌗ Indicators`) holds both halves of "which indicator?":☆
**Favourites**, **BUILT-INS** (Vela's natives for this market, read live from the frame — 76 on this
build) and **LIBRARY** (the 806-row LuxAlgo catalogue). `chart_indicators` is
the door: `section`, `q`, `family`, `reading`, `fold`, `star`/`unstar "native:supertrend"`/
`"library:order-blocks"`, `mount "native:ema"`, `show=False` to close. Its answer carries the rows the
grid **painted**, the family groups it drew (name + count + folded) and the reading it left open —
quote those.

### The catalogue is grouped, and every card has a reading (27 Sep)

- `/api/catalogue` walks all nine pages (`sort=family`, **13.5 s cold, 42 ms warm**) plus the 853
  concepts, keeps the answer in `console/agents/catalogue.json` for 12 h, and hands the page ONE
  payload. The paged loader is gone: a page of sixty cannot count a family it has not paged to, and
  it could race a section change. Filtering now happens in memory, so `q` cannot race `section`.
- **Half the catalogue has no family of its own.** Those rows are the older single-name indicators
  (`percent-b`, `1-2-3-reversal`); LuxAlgo files them as *concepts*, which carry a **family** AND a
  **cluster**. Without the concept walk the rail opens with a 414-row "Unfiled"; with it, 390 of those
  414 land in real groups (Trend 108, Volume & Flow 96, Momentum 89, SMC / ICT 74, …, Unfiled 24).
  Never present "Unfiled" as the catalogue's own opinion of those rows — it is ours.
- Picking a family re-groups the grid by that family's **clusters** ("Moving-average lineage",
  "Candlestick catalog"); a cluster named "Other" is a remainder and is painted last.
- `reading: "mlma"` unfolds that card's own write-up (`row.description`, 806/806 rows have one) and
  paints the card even if its group was beyond the slice; `fold: "trend"` folds a group away
  (`fold: "trend/Other"`, `foldOn: false`), `fold: "trend", foldOn: true` opens it again.
- `bin/trader-chart indicators --family trend --reading mlma --fold trend:on` is the CLI spelling.
  An omitted `--family` **clears** the filter (same rule as `--q`) — a filter left over from an earlier
  call must not silently narrow the next one.
- A `<button class="btn">` carries an author `display`, which beats the UA sheet's `[hidden]`: the
  page-wide "Load more" kept painting under a grid with its own per-group doors until the stylesheet
  got `[hidden] { display: none !important; }`. Hiding a control is not done until it is gone from a
  screenshot.

- Clicking a built-in mounts it; a **Library row does not mount** — it opens the Details pane, because
  its Pine has to go through PineTS. `mount "library:…"` is refused for that reason; use
  `chart_apply_pine`.
- The favourites ★ list is one localStorage list shared by both halves, so starring from chat shows
  up on the operator's screen (and vice versa).
- Backend changes need a **console restart** (`systemctl --user restart luxalgo-web.service`), not just
  `chart_reload`: the result store **whitelists** fields, so a new key arrives empty and reads as "no
  answer". Frontend-only changes are the ones `chart_reload` covers.

## Catalogue previews are cached HERE, not fetched from LuxAlgo

The cards' pictures come from `luxalgo-production.s3.amazonaws.com` (plus a second bucket for older
rows, keys with spaces). Fetching them in the browser is why the grid filled in slowly: 0.8 s to first
byte per picture, six connections per host, sixty cards. The console fetches each one ONCE, shrinks it
with `vips` (fallback ImageMagick/`ffmpeg`) into `~/.local/share/traders-agent/thumbs/`, and serves it
from `/api/library/thumb?slug=&u=&w=` (3.6 ms warm vs ~2 s from S3). `/api/library/thumbs` reports
what the cache holds; the server warms **every** page of the catalogue at start-up (`TRADERS_AGENT_THUMB_WARM=0`
switches it off, `TRADERS_AGENT_THUMB_WARM_PAGES=n` bounds it).
The modal takes the pane (`width: min(1720px, 100%)`, full height) and cards are 16:10 pictures —
cards are asked for at 480 px, the Details pane at 960. Warm the width the card paints (`WARM_WIDTH`),
not a width nobody sees.

- A **new backend module must be added to `tools/sync-live.sh`**: its copy list is explicit, and a
  module left out makes the live server die on `ModuleNotFoundError` while systemd restarts it forever
  (`test_preview_cache.py` now fails if the list drifts).
- The warmer walks **every page** by default (806 rows, ~5 MB, ~2 min once per machine, progress in
  `/api/library/thumbs`). A job retries twice on failure — four rows of the first full warm came back
  empty purely from S3 throttling under a sixteen-way burst. The cache key carries a tag of the source
  URL, so replaced artwork is never served stale from disk.
- Previews are the catalogue's SAMPLE chart, not the operator's own chart — say so; never present a
  thumbnail as "your chart with this on it".

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
