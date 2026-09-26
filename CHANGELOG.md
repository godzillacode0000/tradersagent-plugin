# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Changed

- **The Indicators catalogue takes the surface.** It was `min(920px, 72vh)` with 96 px banners — a
  list of names with a hint of chart. The panel is now the window minus its padding
  (`min(1720px, 100%)`, full height), the grid fits two big cards across in the app's own pane and four
  or five on a wide screen, and each preview is a 16:10 picture the card's own width instead of a
  strip. Lists without pictures (BUILT-INS, a favourites row with no shots) keep the old dense grid —
  the page says which kind of list it just painted. Previews are cached at the 480 px a card actually
  paints, and the Details pane's copy went from 260 px to 380 px tall.

### Fixed

- **The catalogue previews load now.** They always worked and were always slow: sixty cards pulled
  sixty full-size PNGs straight from LuxAlgo's S3 over the internet, ~1–2 s each (measured: 0.8 s just
  to first byte) across the browser's six-connections-per-host limit, so the Indicators grid filled in
  while the operator watched. The pictures were never the problem — a 1600×1000 card is only ~29 KB;
  the LATENCY and the COUNT were. The console now fetches each one once, shrinks it to the 320 px it is
  actually painted at (`vips`, else ImageMagick, else `ffmpeg` — no new Python dependency), keeps it in
  `~/.local/share/traders-agent/thumbs/`, and serves it from localhost: **3.6 ms warm against ~2 s from
  S3**. Sixteen at a time, and the server warms **the whole catalogue** in the background at start-up —
  806 rows, ~5 MB, a few minutes once per machine (`TRADERS_AGENT_THUMB_WARM=0` switches it off,
  `TRADERS_AGENT_THUMB_WARM_PAGES=n` bounds it) — so the first open is already on disk. The Details
  pane asks for the same picture at 960 px, and the cache key carries a tag of the source URL so
  replaced artwork is never served stale.
- **Four catalogue rows had no preview at all.** Their pictures live in a second LuxAlgo bucket whose
  keys contain spaces (`luxalgo-images-production.s3.us-east-1.amazonaws.com/Screenshot 2026-06-04 at
  3.13.58 PM.png`). The fetch allow-list now covers it — LuxAlgo buckets only, https only, foreign
  hosts still refused — and quotes the key instead of dropping it. That is why the grid used to have
  holes where "Session Sweep & iFVG RR" and the raw-recording rows should have shown a chart.
- **A new backend module must be named in `tools/sync-live.sh`.** Its copy list is explicit, so
  `library_thumbs.py` never reached the live tree and the server died on `ModuleNotFoundError` at
  start-up while systemd restarted it in a loop. The list is updated and
  `test_preview_cache.py::test_sync_live_names_every_backend_module` now fails if a future module is
  left out.

- **The chart-bars fallback ran with no market context and the wrong bar keys.** The editor's run
  line ended in `chart-bars retry failed: PineTS error: Cannot read properties of undefined
  (reading 'slice')`, and the fallback could not have worked even without the crash. PineTS's
  `timeframe` helper slices `context.timeframe`, and `new PineTS(bars)` passes none, so the first
  `timeframe.period` / `timeframe.in_seconds()` in a script threw — the AMD POC setup script hits
  it on its line 13. Separately, the bars handed over carry `time` while PineTS's candles are keyed
  `openTime`, so every `time(...)`/session call read `undefined` and answered na (measured on the
  same 500 candles: 0/500 bars in session vs 185/500). `pinets-runner.js` now normalises the bars to
  `openTime`/`closeTime` and builds the fallback as
  `new PineTS(bars, symbol, timeframe, limit)` — the provider form's own context, the chart's own
  bars. Verified live: the retry no longer crashes and returns the same geometry as the provider run.
- **"engine stored 6 raw row(s) but none survived the filters" described a script that drew
  nothing, not lost data.** Those rows are the drawing containers' own empty placeholder rows
  (`value: []`) — what a script whose conditions never fired leaves behind. `unified.js` counts the
  placeholders and says so: `the script drew nothing: every one of its 6 drawing container(s) still
  holds an empty placeholder row — its own conditions never fired on these bars`.

### Fixed

- **"Clear all indicators" told half the truth, and `remove --all` could not reach the other half.**
  The console's own idea of "what is on the chart" was `presentNativeIndicators()` — Vela's names.
  A script mounted from the Library (Run PineTS / Add to chart) is not one of those, so while the
  pane showed CRT range boxes and "Manipulation" labels the state said `natives: []`, and the
  operator was told the chart was clean while he could see it was not (measured live, 26 Sep). There
  is now one reader that asks every place a study can be — `inspect().indicators` (what the console's
  own chip counts), the active cell's `onChartRows()`, `TraderRun.list()` (the overlay runs),
  `PineTSPaint.added` and `presentNativeIndicators()` — and it reports each row with the reader that
  saw it (`EMA (study/native/cell)`, one row per name). It rides the heartbeat as `studies`, answers
  as `chart_studies` / `trader-chart studies`, and both `remove --all` and `clear` report from it.
  `remove --all` now also clears the overlay/paint layer (a Library run lives there, and the layer is
  all-or-nothing — `ChartOverlay` has no per-item removal), saying so in its answer: `removed CRT
  Sweep & Setup Highlighter (overlay) · overlay cleared: 69/123/17 + 1 run(s)`. Asking for one such
  name no longer reads as a bare "nothing removed": it says the name rides the overlay layer and that
  `all`/`clear` is the door. Verified end to end on the operator's own case: CRT script + EMA, then
  one `remove --all` — `chart now carries: nothing`, and the screenshot shows bare candles.

### Added

- **Every LIBRARY card now shows the catalogue's own chart preview.** The rows always carried
  `image_url` (a 1600×1000 chart shot on LuxAlgo's S3) and the modal simply was not using it, so
  "how does this look applied?" needed a run to answer. Cards render it as a banner above the name
  (lazy, off-thread decode: 60 cards is 60 pictures on an 8 GB box), the Details pane shows it full
  size next to the Run PineTS / Add to chart buttons, and a ☆ remembers the URL (`indicator-shots`)
  so a favourite keeps its thumbnail even before its catalogue page is loaded again. The `indicators`
  door reports `shot` per row, read off the rendered card — 60/60 on the live catalogue.

- **One surface for both halves of "which indicator?" — Favourites, BUILT-INS and the LIBRARY
  catalogue.** Vela's menu lists its natives, the Library panel lists 806 catalogue rows, and
  neither remembered what the operator reaches for; the original LuxAlgo app puts both behind one
  modal with **Favourites** on top, and this is that surface (`⌗ Indicators` in the chart top bar,
  door: `chart_indicators` / `trader-chart indicators`). BUILT-INS is read **live from the frame**
  (`availableNativeIndicators()` → 76 on this build), so it cannot drift from what the chart can
  actually mount; LIBRARY is searched server-side through `/api/indicators` (measured: `q=supertrend`
  → `total 10`); ★ writes one localStorage list that both halves read. Clicking a built-in mounts it
  (`addNativeIndicator()`, then a read-back that the chart carries it) — a Library row keeps the
  Details pane, because its Pine has to go through PineTS. Two things had to be fixed to make the
  door honest: the store **whitelists** result fields, so new keys (`layout`, `cells`, `catalog`,
  `indicators`) arrived empty and read as "no answer"; and a section change plus a search text in the
  same breath raced — the first load (old query) swallowed the second, reporting `0 row(s)` while the
  API answered `total 10`, so a request that arrives while one is in flight is now **queued and
  drained**, exactly as `browse` does.

- **The workspace grid is on, and it has a door.** Vela's workspace is a real multi-pane grid, but
  this console used to boot with `layout: false` — which is not merely "one chart": it sets
  `monoLayout`, and `setLayout()` then returns immediately for the life of the page. It now boots at
  **`2h`** (two side by side), and `chart_set_layout` (MCP) / `trader-chart layout [PRESET]` (CLI) / a
  `layout` bridge action change it afterwards: `1`, `2h`, `2v`, `4`, `8`, or a custom
  `g<cols>x<rows>` (1–4 each). No argument **reads** the grid. The answer carries the layout id and
  every cell's **own** symbol/timeframe, because the id asked for is not the evidence — the cells are.
  Measured live: `layout` read 1 cell, `layout 2h` → `2 cell(s): SOLUSDT 4h · SOLUSDT 1D`, `layout 4`
  → 4 cells, `layout 9` refused without touching the chart.
- **`bin/is-enabled.sh` — ask whether the app has actually enabled the plugin.** `install.sh --doctor`
  answers "are the files in place"; it cannot answer "is it on", because that decision lives in the
  app's own store (a LevelDB under `~/.config/Hermes/…`). This reads it and says `on` / `OFF` / `?`
  with the next step. Exit 0 enabled · 1 disabled or not installed · 2 unreadable.
- **`docs/INSTALL-ENABLE.md` — the two ways a correct install looks broken**, side by side: the
  plugin is disabled (the default state), versus enabled but its layout zone is `minimized: true`.
  Different causes, different fixes, and the second one no plugin can clear for itself.
- **Indicators can come OFF the chart, and the answer is evidence.** `chart_remove_indicator` (MCP),
  `trader-chart remove NAME|--all` (CLI) and a `remove` bridge action. The measured door in this Vela
  build is the ledger entry's own `remove()`
  (`chart.indicators()` → entries carrying `nativeType`); the cell doors `removeNative` /
  `removeInstance` / `removeFromChart` **accept ids and names and remove nothing**, so the bridge
  re-reads the chart after each pass and reports `removed X · chart now carries: Y`.
  Verified live: `add ema` → `remove --all` → `chart now carries: nothing`.
- **`docs/vela-chart-api-notes.md`** — the measured map of this Vela build: which calls remove a study
  and which are silent no-ops, why `apply` cannot show a price level while `draw` can, the per-bar trap
  that turned one `line.new` into 50, and the PDH/PDL recipe that actually painted (2 lines, 2 labels).
- **PDH/PDL on demand.** The catalogue does carry *Previous Highs & Lows* (`previous-highs-lows`), but
  its Pine cannot run here — `for … in` is unimplemented in PineTS — so the levels come from the data
  (Binance daily klines → previous UTC day's high/low) and are drawn on the overlay.

- **`chart_set_market` returns last price and bars** in the same result (`switched to BTCUSDT 1h · last
  80458.96 · bars 500`), so a follow-up `chart_state` is not needed. Measured live after the page reload.
- **`chart_reload` and `chart_palette` MCP tools** so prompt-to-chart does not shell out for a
  remount or a colour check. Reload is once-per-view. `chart_state` now prints `build`/`viewer`
  when the heartbeat carries them (stale-frame check).
- **`./tools/sync-live.sh`** copies the repo console onto `~/Projects/luxalgo-web` (the unit that
  actually serves). **`./install.sh --doctor`** checks python, port 8787, the user unit, and the
  deployed plugin/skill.

- **The page says why the chart is not beside the chat.** When the app keeps the pane's layout zone
  minimized, `revealPane()` can report success and still leave the chart hidden, so the row landed on
  a console rendered in the main zone with no explanation. The page now asks for adoption and reveal,
  asks again 700 ms later (the app may still be rebuilding the tree when a page mounts), and when the
  pane is still not visible it shows a short note with the two ways out — *Ask again* and *Open in a
  browser* — instead of a silent fallback. The note only renders when the pane API exists and reports
  the pane hidden, so a build without panes gets the plain console. Documented in the README with the
  measured store evidence (`hermes.desktop.layoutTree.v2`, `"minimized": true`).

- **`chart_caps` in the MCP surface.** The CLI had it and the skill tells an agent to read it before
  drawing, but the MCP server never exposed it — an agent working only through MCP drew blind against
  whatever action list the build happened to have. It now reports the page's own heartbeat list
  (measured: `page can execute: add, apply, clear, draw, market, mode, palette, probe, reload, script,
  shot`).
- **The docs cannot silently drift from the tools.** `console/backend/tests/test_docs_drift.py` reads
  the README's tool table, the MCP decorators and the catalog entry, and fails when the three
  disagree: a tool that exists but is undocumented (nobody calls it) or a row for a tool that was
  renamed away (a stranger calls a tool that does not exist).
- **Capability handshake: the page publishes what it can execute.** Every heartbeat now carries the
  page's real action list (`frontend/chart-bridge.js`), the backend validates commands against *that*
  (`backend/server.py` → `chart_actions()`, falling back to a constant only when no page has ever
  checked in), and `bin/trader-chart caps` prints it. This closes a measured silent failure: `overlay`
  sat in the backend whitelist while the page had no case for it, so the command passed validation, the
  console answered HTTP 200 and the page replied "unknown action" — nothing done, no error.
- **Every mutation reports what actually changed.** `add` re-reads the chart's native indicators and
  reports the list it finds (not the request), `draw` reports what is *verified on canvas* plus the
  live overlay counts, and `clear` says what the chart still carries afterwards. Request-echoed `ok`
  is gone: a handle that accepts a call without painting no longer reads as success.
- **Structured failure codes.** The runner returns `error: {code, message, line?, hint, retryable}`
  beside the prose: `NOT_RUNNABLE[while|for-in|import]`, `RUNTIME_CRASH[pinets-get_v|pinets-ticker|
  pinets-runtime]`, `TOO_FEW_BARS`, `ENGINE_UNAVAILABLE`, `TIMEOUT`. The CLI and the MCP tools print
  them, so a caller branches on a code instead of matching a sentence.
- **MCP tool annotations** on all ten tools (title, `readOnlyHint`, `destructiveHint`,
  `openWorldHint`), plus `chart_draw` and `chart_clear` so the MCP surface mirrors the CLI. New tests
  pin the contract: every tool declares a title and an explicit read-only flag, the mutating ones say
  so, and the Library tools are marked as leaving the machine.
- **A skill for the agent** (`skills/trading-desk/SKILL.md`): the tool order, the one-indicator-at-a-
  time rule, how to react to each failure code, and what the engine cannot do — so a fresh agent does
  not have to rediscover it.
- Tests for the above: `console/backend/tests/test_chart_caps.py` (validation follows the page, the
  fallback never lists an unimplemented action, garbage payloads cannot smuggle actions past the state
  boundary) and `test_mcp_tool_annotations.py`.
- **Dashboards are drawn, not dropped.** A backtester's entire output is one Pine `table`, and the
  overlay had no surface for it: `frontend/overlay.js` now renders tables as a DOM layer positioned
  like Pine's (`top_right`, `middle_center`, …), with spans derived from `_merge_parent` and per-cell
  colour/size/alignment, and `draw` forwards `__tables__` beside boxes/lines/labels. The read-back
  reports all four counts (`0 box / 161 line / 184 label / 1 table on screen`).
- **`reload`: changed frontend files without restarting the app.** A new page action plus
  `bin/trader-chart reload`: the page reports the command, then reloads itself, and the console serves
  its static assets `Cache-Control: no-store` so a document reload really does fetch the new JS. Before
  this, a frontend fix needed a fresh iframe stamp, i.e. a full app restart (and a crash toast).
- Measured live: **Universal Signal Backtester** (LuxAlgo `universal-signal-backtester`) over BTCUSDT —
  verbatim source is refused (`for … in`); replacing that single loop with an indexed `for` makes it run
  in ~1.1 s over 500 bars, yielding 16 series, 161 trade lines, 184 labels and the dashboard table on
  the chart.

### Fixed

- **The install instructions no longer carry this machine's paths.** The README and the MCP server's
  own docstring pointed at `/home/godzillaton/...`; they now use `"$HOME/.hermes/bin/uvx"` and
  `"$PWD/console/mcp/server.py"`, so copy-paste installs work on someone else's machine.
- **The pane no longer says only "starting" forever.** A plugin cannot probe a cross-origin server, so
  after six seconds the overlay adds the one command that fixes a dead frame (`./console/start.sh`)
  instead of leaving it unexplained.
- **Scope is now stated instead of hedged.** The README's "untested outside Linux" becomes "Linux
  only, on purpose" (Omarchy/Arch + Hermes Desktop), and the catalog entry declares `platforms:
  [linux]`. The operator runs this on the machine it was built for; a macOS/Windows ops story is not
  on the roadmap.
- **The README's verification line was wrong** — it promised `5 contributions` while the harness
  registers 8 — and the desk session id is documented as a per-install shortcut rather than a
  requirement (any other install fails that lookup harmlessly and lands on the title search).
- `docs/plugin-catalog-entry.yaml` lists the real `provides_tools` (11) instead of an empty stub,
  which is what a catalog reviewer reads before enabling the plugin.
- **`save_state` and `record_result` dropped fields.** Both whitelist what they persist, and both were
  silently discarding the new evidence (`actions` in the state; `error`, `onCanvas`, `natives` in a
  result) — the page reported correctly and the agent saw nothing. Field lists updated, with the
  boundaries sanitised (a non-list `actions` is refused, not iterated character by character).
- **A refusal was reported twice, and with the wrong code.** `GAPS` carried its own `not runnable:`
  prefix while the callers prefixed it again (`not runnable: not runnable: …`), and `refusedFeature()`
  matched `for ..` / `in` but not Pine's ellipsis — so a `for … in` refusal was classified
  `RUNTIME_CRASH` instead of `NOT_RUNNABLE[for-in]`. Both fixed; the message and the code now agree.
- **`chart_add_indicator` claimed success on a request echo** and `chart_clear` claimed the chart was
  empty without looking — both now read the chart back.

- **Tests, and a CI job that runs them.** `console/backend/tests/` — 63 tests, stdlib-only apart from
  the MCP layer: the study store, the chat bridge, the chart bridge, the push channel (what counts as
  a push, matching a result back to its command, and the honest case where no view is attached), and
  the MCP tool layer against a stub console (no hanging, no claiming a view answered, a dead console
  becoming a sentence). New `tests` job in CI; its MCP step installs `fastmcp` and sets
  `TRADER_CHART_REQUIRE_MCP=1`, so those tests cannot silently skip.
- **Push channel (SSE).** The chart page now holds one long-lived `/api/chart/stream` connection, so
  commands land the moment they are queued instead of waiting for the 2-second poll: measured 37-156 ms
  on the wire for `add` / `market` / `apply` and ~65-80 ms for a capture, versus ~1.0 s before.
  Polling stays on as a safety net (15 s healthy / 2 s if the stream drops), the file bridge is
  untouched, and a command with no view attached fails fast with "no chart view attached".
  New: `GET /api/chart/stream` (SSE) and `GET /api/chart/stream/status`.
- **`trader-chart-mcp`** (`console/mcp/server.py`) — the chart as MCP tools for Hermes: `chart_views`,
  `chart_state`, `chart_shot` (returns the image), `chart_apply_pine`, `chart_add_indicator`,
  `chart_set_market`, `library_search`, `library_indicator`.

### Changed

- **The chart pane opens when asked for, not with the app.** The pane contribution is
  `defaultCollapsed: true` and the launch auto-reveal is off by default: clicking **Trader's Agent** in
  the sidebar is what puts the chart on screen, which is the behaviour the operator asked for. The
  palette command still toggles the auto-reveal for anyone who wants the old "always up" desk.
- **The desk chat is wired to the chart.** The study seeds `skills: [trader-desk, luxalgo-mcp]` (the
  repo's skill now installs to `~/.hermes/skills/trading/trader-desk/` and is no longer shipped but
  never installed) and its instruction names the chart tools, so a fresh desk chat reads the chart
  before it reasons and drives it afterwards. `chat.py` already injects the live chart state into
  every prompt, so there is one seam: the chat's own composer, talking to the console.

- **One bar above the chart.** The plugin's own title row (and its "Open in browser" button) is gone:
  the page is the console frame alone, so the console's top row is the only chrome and the chart
  gains that full row. Opening the console in a browser moved to the palette
  (**Trading: open console in browser ↗**), and the console's top row slimmed from 40px to 34px.

## [1.0.0] — 2026-09-16

First tagged release: the plugin and its console are feature-complete for daily use.

### Added

- **Hermes Desktop plugin** (`plugin/`) — one sidebar row, one `routes` page, one status-bar chip and
  one palette command. The page *is* the console frame, so clicking the row lands on the chart
  immediately (no placeholder, no second copy of the console).
- **Local console** (`console/frontend/`, `console/backend/`) — a stdlib-only Python server on
  `127.0.0.1:8787` that proxies LuxAlgo's MCP server and serves the web app.
- **Chart-first layout** — Vela owns the pane; the Library (`☰`) and detail (`▤`) panels are opt-in
  toggles whose state sticks between sessions.
- **LuxAlgo Library integration** — search across 800+ concepts and indicators; each item shows its
  write-up, licence badge and full Pine source, with **Run PineTS** (LuxAlgo's PineTS runtime over the
  chart's live bars) and **Add to chart** (Vela's experimental Pine engine).
- **Agent-side bridge** — `console/bin/trader-chart` (`state`, `shot`, `apply`, `set`) and
  `console/bin/library-indicator`, so an agent can read the chart and paint indicator scripts without
  touching the UI.
- **Plugin harness** — `tools/verify-plugin.mjs` runs `plugin.js` in Node against SDK stubs (5
  contributions expected), plus a CI workflow that also compiles and boots the backend.
- **Docs** — README with screenshots, update/uninstall, limits and development notes;
  `THIRD-PARTY.md` with the licences and attribution LuxAlgo's terms require.

### Notes

- This project's code is MIT. LuxAlgo's pieces keep their own licences and are **not** redistributed
  here: Vela (Apache-2.0) and vela-pinets/pinets (AGPL-3.0) load from jsDelivr; the Library's content
  is CC BY-NC-SA 4.0 and is fetched at runtime only.
- Unofficial and not affiliated with LuxAlgo.
