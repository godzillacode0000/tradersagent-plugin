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

## MCP stack — auto-use (the operator never names a tool)

On this desk use **`traders-chart` + `luxalgo`**; **never `tradingview-mcp`** (nor the disabled
hosted `tradingview` entry) — ruled out by the operator (30 Sep).

- **`traders-chart`** — first reach for anything on or about the chart: `chart_*` (incl. `chart_batch`,
  `chart_watch`, `chart_alert`), the Library proxy (`library_*`), edge/prop-firm reads, and the
  backtest tier (`bt_*`). Step 0 stays `chart_views`.
- **Backtest tier** — engine is the user service `traders-agent-bt.service` (venv
  `~/.local/share/traders-agent/bt/venv`, port 8788, results under `~/Projects/luxalgo-web/_chart/backtest/`).
  `bt_run` = MA-cross only; `bt_optimize` = full pair sweep; `bt_status` reads back a run. If a bt tool
  answers `backtest_down`, check `systemctl --user status traders-agent-bt` — never hand-start the engine.
  Custom vectorbt experiments: `~/.local/share/traders-agent/bt/smc_sweep_bos.py` (liquidity-sweep + BOS demo).
- **Edge Stats** (`edgestats_*`, LuxAlgo's open-source engine running **on this machine**) — "how often did
  this setup actually work?" on bars the operator downloaded. It is a different thing from the hosted
  `edge_*` reads below (LuxAlgo's published BTC/ETH presets): the local engine answers ANY question over ANY
  symbol the store holds. See the Edge Stats section.
- **`luxalgo`** (hosted, keyless) — catalogue truth + wider datasets: `library_search`,
  `library_get_source_code`, `library_list_*`, `library_taxonomy`, `propfirms_*`, `edge_*`, `trackers_*`.
  Every call needs its 15–25-word third-person `context`. The hosted `edge_*` reads cover BTCUSDT + ETHUSDT only.
  There are **no SMC/ICT strategies** in the Library (60 smc-ict *indicators*; the whole catalogue has
  one `strategy()` script — moon-phases).
- **OAuth-gated**: `luxalgo_account`, `journal_*` error until `hermes mcp login luxalgo` runs in a
  browser — never promise account/journal features.
- Session truth: `curl -s http://127.0.0.1:8787/api/health` → `mcp.connected`; `chart_views` for a live
  pane. New MCP tools arrive only with a new session or `/reload-mcp`.

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
| set / change a script's setting ("length 50", "hide the signals", "make the band wider") | `chart_pine_inputs` for the labels, then `chart_apply_pine` / `chart_draw` with `inputs={"Length": 50}` — do **not** edit the Pine source to change a default |
| screenshot | `chart_shot` |
| give the chart the whole screen / come back | `chart_fullscreen` (`on=False` to return) — the console's chrome steps aside and the page asks the browser for fullscreen |
| chart looks stale / old JS | `chart_reload` |
| chart is light/dark | `chart_palette` |
| how often does X happen / did that gap fill / weekday effect / opening-range break | `edgestats_query` (ask) or `edgestats_report` (a catalogue report) — then **read the guards before quoting a number** |
| what can I ask / which reports exist | `edgestats_presets`, `edgestats_fields` |
| show me / put it on screen / which sessions were those | `edgestats_show` (`ask` / `report` / `session`) |
| no data / "it says not installed" / load something to try | `edgestats_status` → `edgestats_setup` |

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
- **Read the run result's `⚠` notes aloud.** `request.security` returns real higher-timeframe (and
  other-symbol) data — the run result lists what it fetched (`multi-timeframe: BTCUSDT 1d (54 bars)`).
  If a `⚠` says the fetch failed, those values are the chart's OWN bars, not the daily/weekly ones: say so
  rather than presenting them as such. Only Binance symbols can be fetched. A script with a long lookback
  is given up to 5000 bars; if the note says it still does not have enough, its longest-lookback values
  are empty.
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

## Full screen, and a pane that cannot push the page sideways

`chart_fullscreen` / `trader-chart fullscreen [--off]` presses the `⛶` the console's topbar and
Vela's toolbar row carry. Two halves, and only the first is guaranteed:

- **the page half** — `body.chart-focus` hides our chrome (topbar, statusbar, both panels) so the
  chart owns the page. Pure CSS, works everywhere.
- **the display half** — `requestFullscreen()` on the page root. It needs (a) the plugin pane's
  iframe to carry `allowfullscreen` (plugin/plugin.js does) and (b) **a real user gesture**: a click
  on the button is granted, the door/agent is not (Chromium refuses a script-initiated request), so a
  door call honestly answers `native: false, page: true`. Never report that as a failure — quote it.
- `Esc` in native fullscreen is consumed by the browser and never reaches the page's keydown; the
  `fullscreenchange` listener takes both halves down instead. Keep the browser's state in its own
  variable (`nativeFullscreenWasOn`) — asking `isChartFullscreen()`, which reads the class, meant the
  listener could never turn the class off and the console stayed full-bleed (measured live 27 Sep).
- **"The chart pane is not adaptive"** meant a horizontal scrollbar: the topbar's min-content was
  921 px inside an 870 px pane once a legend chip showed an indicator's name. Reproduce it in a
  headless browser at the pane's width (Emulation.setDeviceMetricsOverride + legend chips visible),
  then measure `documentElement.scrollWidth` before and after the fix.

## When a script fails

| code | meaning | what to do |
|---|---|---|
| `NOT_RUNNABLE[while/for-in/import]` | PineTS cannot execute that construct | Stop. Do not port Library scripts unless asked. For levels, compute from data and `chart_draw`. |
| `SYNTAX_ERROR` | Pine could not parse the script | The error has `line` and `col`: fix that line in the source and send it again. An unclosed bracket is often reported at the end of the file, not where it was opened. |
| `RUNTIME_CRASH[…]` | engine threw mid-run | Report the code + line. `Index -2 is out of bounds, array size is 0` is the guarded-ternary class below — check the engine pin before blaming the script. |
| `TOO_FEW_BARS` | not enough history | Widen range, retry once. |
| `ENGINE_UNAVAILABLE` | PineTS module not fetched | Network; retry when online. |
| `TIMEOUT` | run exceeded budget | Retry once; then a lighter script. |

## The engine is pinned, and the overlay must out-stack the chart (27 Sep)

- **`pinets` is a floor, not a preference.** 0.9.33 evaluates **both sides of a ternary**, so the guard
  every LuxAlgo Library script uses for a rolling array — `size >= 2 ? array.get(a, size - 2) : na` —
  still runs the read on an empty array and throws `Index -2 is out of bounds, array size is 0`; the
  script aborts on its first wave and the pane stays blank (the operator's recording of *Wyckoff Wave &
  Volume Studies*, 27 Sep). Proven minimal in Node: `1 == 2 ? array.get(arr, -5) : 7` crashes although
  the guarded branch cannot be reached. The page's import map pins `pinets@0.10.0`, and
  `test_pinets_floor.py` fails if anything pins below it. Bumping vela-pinets does NOT fix it (0.2.13
  still crashes).
- **To test a Library script without touching the live pane**, fetch it (`/api/source?slug=…`) and run it
  in Node against two engine builds — `import { PineTS }`, `new PineTS(bars, 'BTCUSDT', '1h', 500)`,
  `await engine.run(src)` — over 500 synthetic bars. A 15-script battery took seconds and showed exactly
  which the bump fixes (Wyckoff: crash → 4 series) and which are still engine limits (`Identifier 'fib'
  has already been declared` = a transpiler bug; a few need a full TradingView context).
- **A paint can be in the DOM, in the pane, opaque — and invisible.** The overlay canvas and the tables
  layer sat at z-index 6/7, beneath the chart's own layers. They live in a named band (`CANVAS_Z` 25,
  `TABLES_Z` 26) between the chart and the console's own surfaces (`--lx-z-overlay` 30, Vela dialog 40,
  toast 60, modal 70) — two bounds, so both a too-low and a too-high value are bugs. The tables host
  covers the **price pane**, not the whole chart element: a `table.new(position.top_left)` dashboard used
  to land on the toolbar strip, and `bottom_right` in the date axis.
- **Diagnose the live page from the door, not from CDP** (the packaged app exposes no port): make the
  code report the facts you need in its own answer — rects, `getComputedStyle` values,
  `childElementCount` — then read them in `trader-chart apply`'s one-line report. `state()` carries
  `tablesInPane`, `tablesRect`, `tablesCells`, `paneRect` and the page size. A `1 table on screen` that
  only counted DOM children was read as "you can see it" while it was not.
- **A script's name decides which Vela native it becomes — and a dashboard becomes none.** The old
  rule scanned the source for `ta.atr(` and friends, so the Wyckoff dashboard (which *uses* ATR as its
  reversal threshold) was painted as stacked Average True Range panes. The title (`indicator("…")`,
  `shorttitle=`) is consulted first (`NAMES` in `pinets-layer.js`); a script that builds tables/boxes/
  lines, or plots more than two series, is refused a native *with a reason* instead. A native of that
  type already on the chart is never re-added — re-running a script, or running it after a reload when
  the old handle is gone, used to stack another pane (five `ATR 2.17` panes, 27 Sep). The report says
  which rule fired (`drawn with … "the script names it"` / `not drawn as a Vela native: this script
  paints its own dashboard …`).
- **"Not drawn as a Vela native" is not "not drawn".** Every plot series is stroked as a path on our
  overlay (`seriesPaths()` in `unified.js` → `ChartOverlay`), so a script that wins no native still
  paints; only one series at most ever becomes a native. Never relay the clause to the operator as
  data missing — quote the `N series path(s)` count beside it.
- **A drawing's x may be a TIMESTAMP, not a bar index.** `xloc = xloc.bar_time` rows — the LuxAlgo SMC
  order blocks are built exactly this way (`box.new(na,na,na,na, xloc = xloc.bar_time, extend =
  extend.right)` then `box.set_lefttop`/`set_rightbottom`) — carry ms, and the overlay paints in
  bar-index space. The old `flatten()` dropped them outright, so *Smart Money Concepts* drew 35 lines
  and 35 labels and **0 boxes** while the original shows shaded zones; the tell in the report is
  `engine stored N raw row(s) but none survived the filters`. Translate with the bars' own time
  (`barAt`/`toBarIndex` in `unified.js`) for box `left`/`right`, line `x1`/`x2`, label `x`, and drop
  only what cannot be placed. Trust what the overlay *drew*, never what the engine stored.
- **Never open the console in your own browser while the operator's pane is live**: a second view
  attaches to the backend and commands can be routed to the tab that has no bars (`the chart did not
  answer command … within 45s`). Confirm with `trader-chart state` afterwards.

## Edge Stats — how often did it actually happen (4 Oct)

LuxAlgo's open-source engine (github.com/LuxAlgo/edge-stats, MIT) runs locally and answers
`P(outcome | conditions)` over the operator's own 1-minute bars. **Every number comes from the engine; never
compute or estimate one yourself.** The pane has an Edge Stats sheet (⋯ menu → Edge Stats) and you have the
`edgestats_*` tools.

**Order of work**
1. `edgestats_status` — installed? what symbols and to what date? a download running? It never starts anything.
   Not installed → tell the operator the one command (`./install.sh --with-edge`); do not try to install it.
   No data → `edgestats_setup(source="demo")` (10 s, synthetic — say it is synthetic) or a real download.
2. Compose the question in the engine's language: `OUTCOME [WHERE condition [AND condition …]]`, e.g.
   `gapFill WHERE dayOfWeek = Tue AND gapPct BETWEEN 0.2% AND 0.6%`. Unsure of a name → `edgestats_fields`
   (filter with `search`); a catalogue report fits → `edgestats_presets`. The engine answers a typo with the
   nearest real name — use it, don't guess again.
3. `edgestats_query` / `edgestats_report` — then, if the operator would like to see it,
   `edgestats_show(op="ask"|"report"|"session", …)` with **the same question**, so the sheet shows what you read.
4. A single session behind a result: `edgestats_session`, or `edgestats_show(op="session")` for its bars with the
   levels drawn on a chart. Session ids are `SYMBOL|session|DATE`.

**Quoting rules (these are the engine's, and they are not optional)**
- **Never state a rate without its N.** "79.4% of 102 sessions, 95% CI 70.6–86.1%" — never "79%".
- **`NO ESTIMATE`** (fewer than 10 sessions): report the counts and say there is not enough history. Do not
  say "roughly", do not infer a direction, do not round a count into a probability.
- **`LOW SAMPLE`** (fewer than 30): say it is a hint, and that the interval is wide.
- **Check the stability line.** "The halves DISAGREE" or "recent sessions DIVERGE" means the pattern may have
  changed — say so before any conclusion.
- These are **historical frequencies, not predictions and not advice.** Never turn one into "it will", "buy"
  or "sell". Do not size a trade from it. Context the engine does not have (news, regime, liquidity) is yours to
  mention as a caveat, not to fill in.
- Say which data it is: `DEMO_*` symbols are synthetic; Dukascopy volume is tick count; index/metal prices are
  Dukascopy's own CFD quotes.

**Downloads (`edgestats_setup`) — ask first.** A real download uses the operator's disk (hundreds of MB for
years of 1-minute bars), bandwidth and minutes. Say what you will fetch, from where, how far back, then wait for a
yes. Free keyless sources only: `binance` (crypto, e.g. BTCUSDT) and `dukascopy` (EURUSD, XAUUSD, US500 …). While
a job runs every question answers `busy` — poll `edgestats_status`, do not retry in a loop. `cancel=true` stops it.

**Errors you will see:** `edge_not_installed` / `edge_no_data` / `edge_busy` / `edge_start_failed` carry their own
hint — relay it. `bad_query` carries the engine's suggestion and the character position.

## Hard stops

- **`chart_shot` includes our overlay now (fixed 1 Oct).** The page's `screenshot()` in `workspace.js`
  composites Vela's own chart PNG with `#chart-overlay` at its measured offset and scale, so a Library
  run's boxes/lines DO appear in the picture — verified on the live pane (4 boxes + 4 lines drawn, and
  the same run's PNG showed them). What still does not appear: **dashboard tables** (`#chart-tables` is
  a DOM host, not a canvas) and anything drawn outside the visible window. So: a shot is now evidence
  for geometry, but read the counts from the run report for tables, and keep taking a `grim` desktop
  capture when the question is "what does the pane look like to the operator" (the shot has no chrome).
- **Our overlay draws labels as plain text at (x, y).** `overlay.js` ignores Pine's label `style` and
  anchor and calls `ctx.fillText` — so a label placed at the last bar runs off the right edge and is
  invisible. For a diagnostic label, anchor it mid-pane (`bar_index - 150`), never at `bar_index`.

- One indicator per chart. Replace, never stack.
- Edge Stats numbers: N with every rate; no estimate below 10 sessions; never a prediction. Real downloads need a yes.
- No claim without a screenshot.
- Do not invent LuxAlgo lookalikes unless the operator asked for a data-drawn level (PDH/PDL pattern).
- A frozen/occluded pane executes nothing — `chart_views` / heartbeat `build`, then `chart_reload`.
- Layout 3-zone is the operator's saved preset (`user-trader-s-agent-plugin`). A plugin cannot apply
  it; the agent can (`apply_layout`) on desktop sessions only.

## Frontend reload

Changed console JS needs `chart_reload` / `bin/trader-chart reload`, not an app restart.
MCP **new tools** need a **new session** (or `/reload-mcp`).
