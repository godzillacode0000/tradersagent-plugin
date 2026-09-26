# Trader's Agent — MCP tools (36)

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
| `chart_state` | — | Symbol, timeframe, last price, bars, indicators on the chart, plus `build`/`viewer` when the page publishes them (stale-frame check). |
| `chart_shot` | `name: str = ""` | One PNG of the chart. Returned as an image when the client takes images, plus the path on disk. |
| `chart_palette` | `try_apply: bool = false` | What colours the chart is actually wearing (background, candles, console theme). `try_apply=true` asserts the console's palette and reports what landed 300 ms later. |
| `chart_browse` | `family: str = ""`, `show: bool = true` | Open the Library's concept-family list in the pane, optionally narrowed to one family slug. Family bubbles expose Library **concepts** (not indicator scripts); the empty family opens all concepts. Answers with the rows actually painted. The catalogue itself is `chart_library_list`; this one is the *surface*. |
| `library_search` | `query: str`, `kind: str = ""` (`concept`/`indicator`), `limit: int = 8` | Search the LuxAlgo Library (concepts + indicators). See the Library section below for the other nine. |
| `library_indicator` | `query: str` | One indicator by name or slug: summary, licence, and its full Pine source. |

## Mutating tools

| Tool | Arguments | What it does |
|---|---|---|
| `chart_set_market` | `symbol: str`, `timeframe: str` | Switch the chart. **The answer already carries last price and bar count** — do not follow up with `chart_state`. |
| `chart_set_layout` | `layout: str = ""` | Read or set the workspace **grid** (multi-pane): `1`, `2h` (side by side), `2v` (stacked), `4`, `8`, or a custom `g<cols>x<rows>` with 1–4 each. No argument = **read** (a read never writes). The answer carries the layout id and every cell's **own** symbol/timeframe. The console boots at `2h`; `layout: false` at boot means `monoLayout`, where `setLayout()` is a no-op — the page must boot with a preset. |
| `chart_indicators` | `section: str = ""`, `q: str = ""`, `star: str = ""`, `unstar: str = ""`, `mount: str = ""`, `show: bool = True` | The console's **Indicators** surface: BUILT-INS + LIBRARY + favourites behind one search. `section` is `favorites`/`builtins`/`library`; `star`/`unstar` take `KIND:ID` (`native:supertrend`, `library:order-blocks`) and write the same favourites the operator's ☆ does; `mount` mounts a built-in through the surface (`supertrend`, or `native:supertrend`); `show=False` closes it. The answer carries the rows the grid **painted**. |
| `chart_add_indicator` | `native: str` | Add a Vela native (`ema`, `macd`, `supertrend`, `donchian-channels`, …). |
| `chart_remove_indicator` | `native: str = ""`, `all: bool = false` | Take studies **off** the chart — one by name, or every study with `all=true`. Reports `removed X · chart now carries: Y`. |
| `chart_apply_pine` | `pine: str` | Run Pine over the chart's live bars and paint what it makes: geometry (boxes/lines/labels/tables) on the console's overlay, plot series as a **matching Vela native** — the same landasan as `chart_draw`, the script pane and the Library. PineTS is a measured subset: `import` is refused outright, while `while`, `for … in`, `request.security`, tuple returns, `box/line/label/table` and `strategy()` all run. |
| `chart_draw` | `pine: str` | Run Pine and paint the geometry it **builds** (boxes/lines/labels/tables) on the console's overlay; any plot series lands as a native — one landasan with `chart_apply_pine`. The explicit route for level-type scripts (SMC/liquidity models, PDH/PDL). |
| `chart_clear` | — | Clear our overlay drawings and the natives our paint layer added, then report what is left. **Does not remove studies added with `chart_add_indicator`** — use `chart_remove_indicator`. |
| `chart_reload` | — | Reload every attached console page (picks up new frontend files). Once-per-view. |
| `chart_batch` | `steps: str` (JSON array) | Several actions in one call, in order. Each step is `{"action": "...", ...fields}`; stops at the first failure unless `stop_on_error=false`. One round trip instead of five. |
| `chart_snapshot` | — | Remember the market + indicator set as a restore point for `chart_undo`. |
| `chart_undo` | — | Put the chart back to the last snapshot: market first, then the indicator set, reporting the chart's own before → after lists. **Drawings are not restored** — `chart_clear`, then re-draw. |
| `chart_watch` | `seconds: int = 10` | Watch for a spell and answer with a **diff** (what changed) rather than a second snapshot. |
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
| `edge_presets` | — | LuxAlgo's measured edge presets (42 measured). |
| `edge_report` | `preset: str`, `symbol: str` | One preset's measured performance on one symbol. |
| `edge_symbols` | — | The symbols the edge dataset covers. |
| `propfirms` | — | Prop-firm challenges (25 measured). |
| `propfirm_offers` | — | Offers for those challenges. |

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
| `RUNTIME_CRASH[…]` | The engine threw mid-run (engine bug, not the caller's). |
| `TOO_FEW_BARS` | Not enough history loaded — widen the range, retry once. |
| `ENGINE_UNAVAILABLE` | The PineTS module could not be fetched (network). |
| `TIMEOUT` | The run exceeded its budget. |

When no view is attached the command tools answer `✗ no chart view is attached …` instead of hanging.

## CLI equivalents (`console/bin/trader-chart`)

`state` · `shot` · `apply` · `add` · `remove` · `market` · `draw` · `clear` · `reload` · `caps` ·
`script` · `mode` · `wait`

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
