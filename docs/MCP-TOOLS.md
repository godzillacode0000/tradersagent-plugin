# Trader's Agent — MCP tools (14)

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
| `chart_state` | — | Symbol, timeframe, last price, bars, indicators on the chart, plus `build`/`viewer` when the page publishes them (stale-frame check). |
| `chart_shot` | `name: str = ""` | One PNG of the chart. Returned as an image when the client takes images, plus the path on disk. |
| `chart_palette` | `try_apply: bool = false` | What colours the chart is actually wearing (background, candles, console theme). `try_apply=true` asserts the console's palette and reports what landed 300 ms later. |
| `library_search` | `query: str`, `kind: str = ""` (`concept`/`indicator`), `limit: int = 8` | Search the LuxAlgo Library (concepts + indicators). Leaves this machine. |
| `library_indicator` | `query: str` | One indicator by name or slug: summary, licence, and its full Pine source. Leaves this machine. |

## Mutating tools

| Tool | Arguments | What it does |
|---|---|---|
| `chart_set_market` | `symbol: str`, `timeframe: str` | Switch the chart. **The answer already carries last price and bar count** — do not follow up with `chart_state`. |
| `chart_add_indicator` | `native: str` | Add a Vela native (`ema`, `macd`, `supertrend`, `donchian-channels`, …). |
| `chart_remove_indicator` | `native: str = ""`, `all: bool = false` | Take studies **off** the chart — one by name, or every study with `all=true`. Reports `removed X · chart now carries: Y`. |
| `chart_apply_pine` | `pine: str` | Run Pine over the chart's live bars and paint a **matching Vela native**. PineTS subset: no `import`, no `while`, no `for …in`. |
| `chart_draw` | `pine: str` | Run Pine and paint the geometry it **builds** (boxes/lines/labels/tables) on the console's overlay. The route for level-type scripts (SMC/liquidity models, PDH/PDL). |
| `chart_clear` | — | Clear our overlay drawings and the natives our paint layer added, then report what is left. **Does not remove studies added with `chart_add_indicator`** — use `chart_remove_indicator`. |
| `chart_reload` | — | Reload every attached console page (picks up new frontend files). Once-per-view. |

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
| `NOT_RUNNABLE[while/for-in/import]` | PineTS cannot execute that construct — the script needs a full TradingView engine. |
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
