# Trader's Agent — MCP tools (54)

The `traders-chart` MCP server exposes the live LuxAlgo **Vela** chart as native tools.
Every tool talks to the local console (`http://127.0.0.1:8787`) over its push channel (SSE), so a
command answers in the same round trip — measured: add indicator ~15 ms, screenshot ~35–100 ms,
symbol switch ~735 ms (the chart engine fetches 500 bars).

Server file: `console/mcp/server.py` · registered in Hermes as `traders-chart`
Add it: `hermes mcp add traders-chart --command "$HOME/.hermes/bin/uvx" --args fastmcp run "$PWD/console/mcp/server.py"`
Verify: `hermes mcp test traders-chart` · **new tools need a new session** (or `/reload-mcp`)

---

## Read-only tools

| Tool | Arguments | What it does |
|---|---|---|
| `chart_views` | — | Is a chart view attached right now? Every command tool needs one (the chart is not headless). |
| `chart_caps` | — | What the attached page will actually execute. Read this before drawing: an action this build does not have fails at the page, not here. |
| `chart_natives` | — | What Vela can put on **this** chart from its own side: the built-ins for the current market (`catalog`, count, which are already on the chart). The console's Indicators panel shows the same list, and `chart_add_indicator` takes these `type` values. |
| `chart_studies` | — | Everything **on** the chart right now, each row labelled with the reader that saw it: `study` (what the console's own chip counts), `cell` (the workspace cell's on-chart rows), `overlay` (a script run through the console's landasan), `paint` (the PineTS paint layer), `native` (Vela's own names). Ask it before calling a chart clean: `chart_state`'s `natives` list is Vela's names only, and a script mounted from the Library is not one of them. |
| `chart_state` | — | Symbol, timeframe, last price, bars, indicators on the chart, plus `build`/`viewer` when the page publishes them (stale-frame check). |
| `chart_shot` | `name: str = ""` | One PNG of the chart. Returned as an image when the client takes images, plus the path on disk. |
| `chart_palette` | `try_apply: bool = false` | What colours the chart is actually wearing (background, candles, console theme). `try_apply=true` asserts the console's palette and reports what landed 300 ms later. |
| `chart_browse` | `family: str = ""`, `show: bool = true` | Open the Library's concept-family list in the pane, optionally narrowed to one family slug. Family bubbles expose Library **concepts** (not indicator scripts); the empty family opens all concepts. Answers with the rows actually painted. The catalogue itself is `library_list`; this one is the *surface*. |
| `broker_state` | — | The **paper** (simulated Binance spot) account: cash, equity, positions with live P&L, and the orders waiting for the operator. Read-only. |
| `broker_propose` | `symbol: str`, `side: str` (`buy`/`sell`), `qty: float`, `note: str = ""` | Propose a paper order. It does **not** trade: it puts an Approve/Reject card on the chart and waits. There is deliberately **no approve tool** — only the operator, on the card. Fills at the live price at approval — or the replay cursor price while replay is on (see `chart_replay`). |
| `library_search` | `query: str`, `kind: str = ""` (`concept`/`indicator`), `limit: int = 8` | Search the LuxAlgo Library (concepts + indicators). See the Library section below for the other nine. |
| `library_indicator` | `query: str` | One indicator by name or slug: summary, licence, and its full Pine source. |

## Mutating tools

| Tool | Arguments | What it does |
|---|---|---|
| `chart_set_market` | `symbol: str`, `timeframe: str` | Switch the chart. **The answer already carries last price and bar count** — do not follow up with `chart_state`. |
| `chart_set_layout` | `layout: str = ""` | Read or set the workspace **grid** (multi-pane): `1`, `2h` (side by side), `2v` (stacked), `4`, `8`, or a custom `g<cols>x<rows>` with 1–4 each. No argument = **read** (a read never writes). The answer carries the layout id and every cell's **own** symbol/timeframe. The console boots at `2h`; `layout: false` at boot means `monoLayout`, where `setLayout()` is a no-op — the page must boot with a preset. |
| `chart_indicators` | `section: str = ""`, `q: str = ""`, `family: str = ""`, `star: str = ""`, `unstar: str = ""`, `mount: str = ""`, `show: bool = True` | The console's **Indicators** surface — the **drawer** (the ⌗ modal was deleted on the operator's call, 3 Oct). `section` is `favorites`/`builtins`/`library`; `family` narrows the catalogue to one family (`trend`, `smc-ict`, `wyckoff`, …; `all` clears it); `star`/`unstar` take `KIND:ID` (`library:order-blocks`) and write the same favourites the operator's ☆ does; `mount` mounts a built-in through the surface (`supertrend`, or `native:supertrend`); `show=False` closes it. The answer carries the rows the list **holds** (each with its family, its write-up as `reading`, and whether a preview exists), the counts, and whether the drawer is open — a drawer that opened empty cannot read as a filled one. |
| `chart_fullscreen` | `on: bool = True` | Give the chart the whole pane — and the whole screen, where the host allows it. The console's chrome, panels and statusbar step aside so the chart owns the page, and the page asks for fullscreen so it can take the display. `on=False` (or Esc, or the floating ✕) brings everything back. The answer carries `{fullscreen, native, page}` — `native` says whether the display was taken or only the page. |
| `chart_theme` | `theme: str = ""` | Read or set the console theme: `light`, `dark`, or empty to report what is worn now. The same switch the operator's ◐ button runs, so the console palette, Vela's chrome and the chart's own colours move together; the choice is stored and survives a reload. |
| `chart_replay` | `op: str = "state"`, `bars: int = 100`, `from_ms: int = 0`, `interval_ms: int = 0` | Drive Vela's own **replay**: `start` rewinds (`bars` back from the end of the loaded history, or an exact `from_ms`), `step` reveals the next bar, `play`/`pause` advance automatically (`interval_ms` between bars), `stop` leaves replay and live resumes, `state` reads. While replay is on, a **paper fill uses the replay cursor price**, not the live one — the control strip in the chart keeps the server's price in step. |
| `chart_drawing` | `op: str = "list"`, `type: str = ""`, `anchors: list[dict]`, `id`, `ids`, `style`, `text`, `props`, `locked`, `visible`, `all: bool = false` | Draw with Vela's own **drawing tools** (76 types — trend line, channel, fib, Gann, Elliott, XABCD, pitchfork, box, text …) as real objects the operator can drag afterwards. `op` = `add` / `list` / `update` / `remove` / `clear` / `types`. Each anchor is `{bars_ago, price}` (0 = latest bar) or `{time, price}`; the anchor count must match the type, and a wrong count is refused *before* drawing (Vela would accept it and paint nothing). `clear` removes every drawing, hand-drawn too, so it needs `all=true` (one undo restores). |
| `chart_view` | `setting: str = "state"`, `value: str = ""` | Read or set one view setting: `chart_type` (candles/bars/line/area/baseline/heikinashi), `log`, `invert`, `auto_scale`, `scale_mode`, `countdown`, `timezone` (Kuala Lumpur maps to Vela's Asia/Singapore, same UTC+8), `session`, `watermark`, `indicator_titles`, `indicator_values`, `statusline_*`, `sync_*` (grid sync), `shortcuts` (the `?` panel), `alerts`. Every write is read back from the chart. **Vela cannot create a price alert** — `alerts` reads and clears the inbox an indicator fills with `alertcondition()`. |
| `chart_marks` | `op: str = "list"`, `time`, `bars_ago`, `title`, `content`, `color`, `shape`, `letter`, `id` | Event marks on the time axis (news, "I entered here"), all in one group named "Trader's Agent" so `clear` only removes the agent's own. Marks are data: they clear when the symbol or timeframe changes. |
| `chart_add_indicator` | `native: str` | Add a Vela native (`ema`, `macd`, `supertrend`, `donchian-channels`, …). |
| `chart_remove_indicator` | `native: str = ""`, `all: bool = false` | Take studies **off** the chart — one by name, or every study with `all=true`. Reports `removed X · chart now carries: Y`. |
| `chart_apply_pine` | `pine: str`, `inputs: dict = {}` | Run Pine over the chart's live bars and paint what it makes: geometry (boxes/lines/labels/tables) on the console's overlay, plot series as a **matching Vela native** — the same landasan as `chart_draw`, the script pane and the Library. PineTS is a measured subset: `import` is refused outright, while `while`, `for … in`, `request.security`, tuple returns, `box/line/label/table` and `strategy()` all run. `inputs` sets the script's own settings (its `input.*()` values) **by label** — `{"Length": 50, "Show upper band": false}`; the label is matched ignoring case and spacing, and the variable name or `in_0` id work too. What you leave out keeps its default, `null` resets one, a number outside the input's range is limited to it, and the answer says what was used, what was refused and why (with a *did you mean* for a near miss), and which inputs the script does have. When the script pane holds this very script, its Settings show the values. |
| `chart_draw` | `pine: str`, `inputs: dict = {}` | Run Pine and paint the geometry it **builds** (boxes/lines/labels/tables) on the console's overlay; any plot series lands as a native — one landasan with `chart_apply_pine`. The explicit route for level-type scripts (SMC/liquidity models, PDH/PDL). |
| `chart_pine_inputs` | `pine: str` | **Read-only.** List the settings a script declares — label, type, default, range or options, group — without running it, opening the pane or touching the chart. Call it before `chart_apply_pine` / `chart_draw` with `inputs` when you do not know the labels. |
| `chart_clear` | — | Clear our overlay drawings and the natives our paint layer added, then report what is left. **Does not remove studies added with `chart_add_indicator`** — use `chart_remove_indicator`. |
| `chart_reload` | — | Reload every attached console page (picks up new frontend files). Once-per-view. |
| `chart_batch` | `commands: str` (JSON array) | Several actions in one call, in order. Each step is `{"action": "...", ...fields}`; stops at the first failure unless `stop_on_error=false`. One round trip instead of five. |
| `chart_snapshot` | — | Remember the market + indicator set as a restore point for `chart_undo`. |
| `chart_undo` | — | Put the chart back to the last snapshot: market first, then the indicator set, reporting the chart's own before → after lists. **Drawings are not restored** — `chart_clear`, then re-draw. |
| `chart_watch` | `seconds: int = 15`, `timeout_s` | Watch for a spell and answer with a **diff** (what changed) rather than a second snapshot. |
| `chart_alert` | `seconds: int = 30, move_pct: float = 0.0` | Wait for the **market** to move. Reuses the heartbeat's own `last`, reports the move (from → to, percent and absolute) as soon as price travels `move_pct` percent from the first reading — `0` means any change. Where `chart_watch` answers "did the chart change", this answers "did price do something", and reports the largest excursion it saw when the threshold is never met. |

## Library / research tools

Read-only, and every one leaves this machine (they reach LuxAlgo's hosted MCP).

| Tool | Arguments | What it does |
|---|---|---|
| `library_search` | `query: str`, `kind: str = ""` (`concept`/`indicator`), `limit: int = 8` | Search the Library (concepts + indicators). |
| `library_indicator` | `query: str` | One indicator by name or slug: summary, licence, full Pine source. |
| `library_list` | `family`, `text`, `concept`, `tier`, `sort`, `direction`, `page`, `page_size` | Browse with the same filters and paging the console's own list uses. |
| `library_taxonomy` | `what: str = "families"` | The Library's own families (17 measured) or its concept graph — so a filter value is the Library's, not a guess. |
| `library_concept` | `slug: str` | One concept by slug, with the indicators that implement it. |
| `library_source` | `slug: str` | Pine source by **exact** slug — no name resolution to get wrong. |
| `edge_presets` | `category: str = ""` | LuxAlgo's measured edge presets (42 measured). |
| `edge_report` | `preset: str`, `symbol: str` | One preset's measured performance on one symbol. |
| `edge_symbols` | — | The symbols the edge dataset covers. |
| `edgestats_status` | — | Is the local Edge Stats engine installed, which symbols it holds (to which date), and is a data job running. Never starts anything. |
| `edgestats_fields` | `kind: str = ""`, `search: str = ""`, `limit: int = 40` | The query language: every outcome / condition / field with its definition and an example. |
| `edgestats_presets` | `category: str = ""` | The 42 ready-made reports with their parameters. |
| `edgestats_query` | `query: str`, `symbol: str`, `since`, `until`, `group_by`, `sessions: int = 8`, `session` | `P(outcome \| conditions)` with N, a Wilson 95% interval, a first-half/second-half stability split, recency, per-year counts and the value distribution. **Below 10 sessions: counts only, no rate.** |
| `edgestats_report` | `preset: str`, `symbol: str`, `params: dict`, `since`, `until`, `group_by`, `sessions`, `session` | One catalogue report, same envelope and same guards. |
| `edgestats_session` | `session_id: str` (`SYMBOL\|session\|DATE`) | One session: OHLC, prior high/low/close, the gap, opening ranges, event times. |
| `edgestats_show` | `op: str = "open"` (`ask`/`report`/`session`/`data`/`close`/`state`), `query`, `preset`, `session`, `symbol`, `since`, `until`, `group_by`, `params` | Show an answer in the Edge Stats sheet over the chart. Changes no study or drawing. |
| `edgestats_setup` | `source: str = ""` (`demo`/`binance`/`dukascopy`), `symbol`, `years: float`, `archive_only: bool`, `cancel: bool` | Load the demo data or download free history in the background; questions answer "busy" while it runs. |
| `propfirms` | `query: str` | Prop-firm challenges (25 measured). |
| `propfirm_offers` | `query: str` | Offers for those challenges. |

---

## Tool order (the short version)

1. `chart_views` → 0 views means nothing can be driven; open the Trader's Agent row first.
2. `chart_state` → what the chart shows now.
3. `chart_caps` → what this build can execute.
4. Change one thing: `chart_set_market` / `chart_add_indicator` / `chart_draw` / `chart_apply_pine`.
5. `chart_shot` → prove it painted. A tool answer is not a picture.
6. Replace, never stack: one study at a time.

## Failure codes these tools return

| Code | Meaning |
|---|---|
| `SYMBOL_NOT_SERVED[XAUUSD]` | This console's workspace provider is Binance only, and it never answered for that symbol. The chart is unchanged — use a crypto pair (the op has a 6 s deadline so it refuses instead of hanging). |
| `NOT_RUNNABLE[import/for-in]` | PineTS cannot execute that construct — the script needs a full TradingView engine. Measured: `import` is the real one; `for … in` actually runs. |
| `SYNTAX_ERROR` | Pine could not parse the script. The error carries `line` and `col` (1-based) — fix that line; an unclosed bracket is often reported at the end of the file. |
| `RUNTIME_CRASH[…]` | The engine threw mid-run (engine bug, not the caller's). |
| `TOO_FEW_BARS` | Not enough history loaded — widen the range, retry once. |
| `ENGINE_UNAVAILABLE` | The PineTS module could not be fetched (network). |
| `TIMEOUT` | The run exceeded its budget. |

When no view is attached the command tools answer `✗ no chart view is attached …` instead of hanging.

## CLI equivalents (`console/bin/trader-chart`)

`state` · `shot` · `apply` · `add` · `remove` · `market` · `draw` · `clear` · `script` · `browse` ·
`open` · `mode` · `reload` · `caps` · `layout` · `studies` · `natives` · `indicators` ·
`fullscreen` · `theme` · `replay` · `wait`

## Notes

- Annotations are declared per tool (`readOnlyHint`, `destructiveHint`, `openWorldHint`), so a client's
  consent UI can tell a read from a mutation.
- Mutating tools answer with the chart's state **after** the call — a request echoed back is not a
  painted pane.
- `docs/vela-chart-api-notes.md` records which Vela calls actually work and which return cleanly while
  doing nothing (the trap that made indicator removal slow).

## Backtesting tools (the vectorbt tier)

The engine is a separate process in its own venv (`console/backend/backtest_service.py`,
`127.0.0.1:8788`); the console proxies it, and these are thin HTTP clients like every other tool.
Results are saved under `_chart/backtest/<run_id>.json` — their own namespace, never the live
chart's `state.json`. Start it with
`~/.local/share/traders-agent/bt/venv/bin/python console/backend/backtest_service.py --port 8788`
(it warms the numba JIT at start-up: measured 6.5 s once, then ~30 ms a run).

| Tool | Arguments | What it does |
|---|---|---|
| `bt_run` | `source: str = "binance:BTCUSDT:30m"`, `fast: int = 20`, `slow: int = 50`, `fee: float = 0.001`, `bars: int = 1000` | One MA-cross backtest: return, max drawdown, Sharpe, Sortino, trade count, win rate, profit factor, expectancy. `source` is `binance:SYMBOL:TF` (public klines) or `local:NAME` (a CSV/Parquet in the operator's data dir). |
| `bt_optimize` | `source: str`, `lo: int = 5`, `hi: int = 60`, `fee: float`, `bars: int`, `top: int = 10` | Sweep **every** MA pair in `[lo, hi]` at once and rank by return. Reports the median and worst combo too — a top result far above the median is usually overfitting, not edge. |
| `bt_status` | `run_id: str = ""` | Read a saved backtest: the newest, or the run you name. |
| `bt_data_list` | — | The operator's own OHLC files and the schema the engine expects: a DatetimeIndex (UTC) plus open/high/low/close/volume. |
