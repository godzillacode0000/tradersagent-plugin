# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added

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
