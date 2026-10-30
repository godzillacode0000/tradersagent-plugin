# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Fixed

- **Long tick-store windows came back short and slow** (30 Oct): `fxticks.bars` grew its window a day
  per pass from a 0.4x guess, re-reading every hour on every pass and giving up after 60. On a two-year
  store 500 x 4h returned 404 bars in 12 s and 500 x D returned 186 in 67 s, with no sign anything was
  missing. The window is now sized once from the timeframe (1.5x the trading time plus a long weekend,
  one wider pass for holidays, never before the store's first day): 500 and 500, in 0.8 s and 4.9 s.
  Same bars as before wherever the old walk did reach. Weekends cost one stat instead of 24.
- **The hour cache held raw ticks**: 4,096 decoded hours of a busy pair ran to gigabytes. Each hour is
  now packed as at most 60 minute bars (~4 KB), so 20,000 hours stay under ~80 MB. The docstring's
  promise of an on-disk `fx/bars-v1` cache, which never existed, is gone, along with the unused
  `TRADERS_FX_BARS`.
- **One truncated hour sank the whole request**: a download cut off mid-write left a half gzip that
  raised inside `bars()`, so the provider dropped the store and went to the network. Unreadable hours
  are now skipped and counted (`unreadable_hours` in the meta). `tools/fx-fetch.py` writes each hour to a
  `.part` file and renames it, so it no longer leaves them.
- **`tools/fx-fetch.py` cached hours that were not final**: the walk ended at the current hour (cached
  half-full for good), and a 404 the feed had simply not published yet became a permanent `.empty` hole.
  It now stops at the last complete hour and marks a 404 empty only once it is a day old.
- **The Data tab could read "Reading the tick store…" forever**: `fxdata.status()` returned early when
  the network cache folder did not exist and dropped the `ticks` block, which is exactly the case for an
  operator who has only run `fx-fetch.py`. One shape always now, plus a `yahoo` flag. The card's Yahoo
  line follows the server instead of a constant, and it re-reads the store on every visit.
- **CI was red on `main`**: an unused `import json` in `tools/fx-fetch.py` failed the ruff gate.

### Added

- **A Data tab in the desk sheet** (21 Oct), so the source is visible instead of inferred: it reads
  `/api/fx/status` and lists every instrument in the tick store with hours, coverage and size, under
  one line that says what the bars are (mid-price, real volume, median spread) and that **Yahoo is
  off**. Pinned by four tests in `test_desk_sheet.py`.

- **Metals and index CFDs are first-class symbols now** (21 Oct): `NAS100`, `SP500`, `XAUUSD` and
  `XAGUSD` live in the same tick store as the FX pairs, but `_clean_pair` only accepted six letters, so
  the provider refused them with "not a six-letter FX pair". The four now carry their own precision
  (3 dp, measured on the feed), `syminfo` type (`index` for NAS100/SP500, `commodity` for metals — so
  `tickerid` is `IDX:NAS100`, not `FX:`), and descriptions. Verified live: all seven answer
  `source: "dukascopy-ticks"` with real volume.

- **The market-data provider now prefers the tick store** (21 Oct): `console/backend/fxticks.py` builds
  bars from the downloaded Dukascopy ticks (`tools/fx-fetch.py`), and `fxdata._bars` asks it first — no
  network, real **volume** (tick count per bar) and a real **spread** (median bid/ask per minute, so one
  bad print cannot widen a 30-minute bar). `/api/fx/bars` reports `source: "dukascopy-ticks"` and a
  `store` block with the coverage behind it; `/api/fx/status` counts the store per symbol. Yahoo is now
  **off** unless `TRADERS_FX_ALLOW_YAHOO=1`, per the operator's ruling — without local ticks and with the
  feed unreachable the call fails with the reason instead of substituting mid prices that have neither
  volume nor spread. Bars are mid-price OHLC. Pinned by `test_fxticks.py` (8 tests).

- **A tick downloader for the seven instruments** (21 Oct): `tools/fx-fetch.py` walks Dukascopy's
  **v1 tick API** (`/v1/ticks/<CODE>/<Y>/<M>/<D>/<H>`) — the modern JSON endpoint, far more tolerant of
  a bulk walk than the `/datafeed/` host that kept resetting us. Codes carry a dash and a class
  (`GBP-USD`, `XAU-USD`, `USATECH.IDX-USD`, `USA500.IDX-USD`); the v1 month is **1-based**, the
  opposite of `/datafeed/`'s 0-based paths. Two facts that would silently corrupt a download are pinned
  by `test_fx_ticks.py`: `times`/`bids`/`asks` are **cumulative deltas** (a running sum, not absolute
  values), and the hour's `timestamp` is the base every offset counts from. Storage is one gzipped JSON
  per instrument-hour plus `.empty` markers for shut hours, so the walk resumes; measured 12 hours/s
  with 5 workers, ~33 KB per hour on disk. Fetched data is TODAY's: 4,547 ticks for 08:00 with a 0.4-pip
  spread, monotonic over exactly 60 minutes — further proof the "lag" reported on 20 Oct was the
  0-based month bug, not the feed.

- **Audit fixes (21 Oct)** — four bugs from an external read of `630e3ef`, plus version and install
  hygiene. **The Dukascopy month was off by one:** the tick path is 0-based in months (September =
  `/08/`), so a 1-based URL read the *following* month and stamped those prices with the requested
  timestamps — a plausible, silently wrong backtest. Measured: `/2026/09/24/` 404 vs `/2026/08/24/`
  27,285 bytes; the "two-week publication lag" recorded on 20 Oct was this bug, not a lag. The cache
  root moved to `fx/`**v2**` so wrong-month empty markers cannot shadow real hours. **XSS in the tester
  strip:** the `strategy()` title was interpolated raw into `innerHTML`, so a crafted title executed in
  the console's origin (where the paper-broker approve door lives) — every engine string now goes
  through `esc()`, with a pin. **Coverage no longer lives in a module global:** `bars_with_meta()` returns
  `{"bars", "coverage"}` per call, so two concurrent requests (`request.security` fetches the secondary
  pair alongside the main) can no longer swap their source/lag. **CI's lint is green again** (four unused
  imports), `status()` has one shape with or without a cache, and that test is hermetic. The prop-firm
  engine is pinned (`@luxalgo/prop-firm-sim-cli@1.2.0`, `--save-exact`) like the Edge Stats block, and
  **one `VERSION` file** now drives the console, `plugin.yaml` and the catalog entry (they disagreed:
  1.0.0 / 1.2.0 / 1.3.0) — `test_versions.py` keeps them in step. `TRADERS_AGENT_ALLOWED_HOSTS` is
  documented, and the `ALLOW_LAN` row no longer claims LAN peers are read-only when the token lets them
  drive the console. Suite **1,259 tests OK** (1 skipped, 77 files).

- **Forex data for backtests, and a strategy that names its own market** (20 Oct): the pane charts a
  Binance crypto feed, so a GBPUSD/EURUSD strategy had nothing to run on — and worse,
  `request.security("EURUSD", …)` on custom bars silently returns the chart's own series (measured:
  BTC 68778 for an "ETH" request), which would make an SMT pair compare a market with itself.
  `console/backend/fxdata.py` builds FX bars from **Dukascopy's free tick files** (LZMA `>IIIff`
  records, ~20 KB per instrument-hour, no key): tick decode verified at 4,457 ticks/hour, hour-file
  cache under `~/.local/share/traders-agent/fx/`, M1 → any timeframe, and a **Yahoo FX fallback** that
  labels its own output when Dukascopy throttles (measured 429s and a ~2-week publication lag). Two
  doors (`/api/fx/bars`, `/api/fx/status`) and a browser provider (`fx-provider.js`) make that the
  engine's data source for both the main symbol and `request.security`'s secondary one. A script opts
  in with `//@fx GBPUSD` + `//@tf 60` (`pinets-runner.js`), which routes the run to the FX provider
  (`ctor: 'fx-provider'`) instead of the chart, and a strategy sizes itself in R (1–2% of equity per
  trade) without any plugin change. Measured while wiring it: with `margin_long=100` every risk-sized
  FX order is rejected (85 placed, zero fills) — the emulator needs `0` to size by risk, not notional.
  15 new tests (`test_fxdata.py`). Suite **1,252 tests OK** (1 skipped, 77 files).

- **Strategy backtests on the new intrabar broker emulator** (20 Oct): LuxAlgo's 19 Oct update — Vela
  **0.8.5**, vela-pinets **0.2.17**, PineTS **0.12.0** — is vendored, and our PineTS fork's three
  patches are rebased onto 0.12.0 (upstream moved the declaration-init walker into
  `walkInitExpression`, so patch 2's visitor lives there now; branch `fix/p1-p8-on-0.12`). A
  `strategy()` script's fills and exits are now resolved *inside* the bar with commission, slippage,
  margin and trailing stops, and TradingView's tick-grid snapping (`setFillsOnTickGrid`), instead of
  at the signal bar's close — measured on the same 400 synthetic bars, the old engine filled zero
  trades where 0.12 fills four with per-trade commission and excursions.
  **The tester strip** (`console/frontend/tester.js` + `tester.css`) reads the engine's ledger: net
  profit, trades, win rate with its N, max drawdown (money and %), profit factor, a closed-trade P&L
  curve and, on demand, the round trips (side, qty, entry/exit fills, commission, P&L, per-trade
  excursion). Missing data looks missing (`—` for no sample, `∞` for no losing trade); when the
  worker's summary omits the account totals the ratio is computed from the ledger and the footer says
  so; commission the worker dropped is reported as what the fills paid, never "none". Every run
  publishes to the strip on both engine paths, and the declaration's title is recovered from the
  source. **The agent reads the same ledger**: `chart_apply_pine`'s answer gains a `ledger:` line
  (`console/mcp/server.py::_ledger_line`). 18 new tests (`test_tester_strip.py`). Suite **1,236
  tests OK** (1 skipped, 75 files).

- **The prop-firm simulator is wired in** (19 Oct): LuxAlgo's `@luxalgo/prop-firm-sim-cli` (MIT) runs
  locally and the desk sheet's Prop-firms view grows a **Simulate** button on every challenge. The
  card is the engine's own answer, verbatim: pass probability per attempt with its Wilson 95% CI,
  per-step rates with min-days and the failing rule counts, funded-within-N, attempts, expected cost,
  days to funded, payout probability, blow-up risk and the EV block — plus the engine's disclaimer,
  simplification flags and its **engine version, paths and seed** (same inputs, same numbers). The
  form (win rate, avg win/loss in R, risk per trade, trades per day) feeds the CLI's parametric model;
  the engine's own rules come from LuxAlgo's public directory, keyless, at run time. New
  `console/backend/propfirmsim.py` (the Edge Stats bridge pattern: subprocess, JSON, cached by
  identical question), `/api/propfirmsim/status` and `/api/propfirmsim/simulate`, and
  `./install.sh --with-prop` installs the engine (Node 20+, ~10 MB) with the same prove-it-starts
  rule the Edge Stats block uses. A machine without it gets the install command, not an error.
  Suite 1,218 tests OK (1 skipped, 74 files).

- **The desk has one owner, and commands are routed to it** (19 Oct). Several console views can be
  alive at once (the Hermes pane, a second tab, a standalone window) and the old rule was "first claim
  wins" — so a background tab with no bars could consume a command and answer "the chart did not
  answer … within 45s" while the operator's pane stood ready. The owner is now decided from the
  heartbeats: **the newest visible view with bars**; a hidden or bar-less view can never take the desk
  from a working one. A view that is not the owner executes nothing and shows a passive banner —
  "Another desk view is driving the chart — **use this view**" — whose button takes the desk back
  deliberately. `chart_commands` names the owner, the claim door refuses non-owners with a reason, and
  a pane with no view record keeps the old single-view behaviour. The plugin's frame watchdog also
  stops prompting a remount when no pane is mounted (a closed pane is not a dead frame).
  Suite 1,207 tests OK (1 skipped, 73 files).
- **The desk sheet — the paper account, its journal and the prop-firm directory in one surface** (16 Oct). ⋯ →
  "Trader's desk" opens three views: **Paper** (equity, cash, realised, open P&L, positions with marks, recent
  fills, Reset), **Journal** (net P&L, win rate, profit factor, avg win/loss, the realised-equity curve on a
  canvas, the closed trades) and **Prop firms** (LuxAlgo's own directory + the live offers, through
  `/api/propfirms` and `/api/offers` — rendered as text and a promo code, never a link: the plugin still has no
  door out of Hermes). It replaces the small account popover, which could show a balance but had nowhere to say
  what the account DID. The sheet is a reader: the only thing it can post is Reset (and it asks first), so the
  approve/reject brake stays on the order card where it was.
- **A journal under the paper broker.** A sale now records its own `pnl` — (exit − average entry) × qty − exit fee
  − the entry fee's share for that qty, with the entry fee carried on the position until a sale attributes it — so
  **sum(sell pnl) == realized + the open positions' entry fees**, asserted in the tests. `broker_state` reports the
  closed-trade line; a rate with no sample prints —, a profit factor with no losing trade prints ∞, and no rate
  ships without its N. 1,187 backend tests green (1 skipped, 72 files).

### Fixed

- **`TRADERS_AGENT_ALLOWED_HOSTS` was an undocumented change to who can write.** Measured, not inferred: with a
  name on the list, a request carrying it from loopback is handed the POST token and `POST /api/broker` answers
  **200**. That is the intended trade (`tailscale serve` terminates here, so your phone arrives as 127.0.0.1),
  but it means every device on that tailnet can approve paper orders, drive the chart and run Pine **with
  `ALLOW_LAN` unset** — and the variable appeared in no document at all, while the README's `ALLOW_LAN` row
  still promised "LAN peers get a read-only console", which stopped describing this path. The README now carries
  the variable, says plainly that each name is a full-trust door, and corrects the `ALLOW_LAN` row; three live-socket
  tests pin the token, the write and the still-refused unknown name (removing the name from the allowlist fails two
  of them). No behaviour changed — only what the repository admits to.
- **The package README documented an install that is no longer the short one** (`./console/start.sh` + `./install.sh`,
  with no mention of `--all`); it now leads with `./install.sh --all`.

- **The README still claimed Linux-only.** macOS support shipped on 13 Oct (`docs/MACOS.md`, the repo venv,
  `console/service-macos.sh` behind launchd), so the OS row, the service section and the platform bullet now
  say Linux + macOS, name the launchd counterpart of the systemd unit, and link the Mac setup. Windows stays
  out of scope, and `docs/HANDOFF.md`'s operator line now names both machines.
- **`./install.sh --all`, the one-command install**, plus the two pieces it is made of. `bin/setup-python.sh` gives the console and the
  agent a python with the `mcp` client: `uv` when it is on PATH (5.6 s against 286 s for pip in the same slow sandbox), else
  `python3.11+ -m venv` + pip; a python you already have that imports `mcp` is left alone. It asks for Python 3.12, then 3.13, then
  3.11, never "the newest": a bare `>=3.11` once made uv choose a 3.14 release candidate whose pydantic could not import (found by
  running it, held by a test). `console/service-linux.sh` is the systemd counterpart of `service-macos.sh` (user unit
  `traders-agent.service`; a detached console where there is no systemd user session, said plainly; an already-running console, or the
  developer's `luxalgo-web.service`, is left alone). `--setup-python` and `--service` run each step alone. Nothing about what the
  plugin does changes; a plain `./install.sh` behaves as before. Tests: `test_fast_install`.
- **DeepSeek Harness adapter** (`adapters/dsh/install-dsh.sh`): installs the desk skill and registers the `traders-chart` MCP server for
  dsh. `--mcp-file` merges the entry into a JSON file you name (other servers kept, backup made, invalid JSON refused), `--doctor`
  runs a real MCP handshake (56 tools) and checks the console, `--uninstall` undoes it. The Hermes pane stays Hermes-only. Not yet
  tried against a real dsh install.

### Changed

- **The latency pass** (19 Oct): three measured causes of "the chart loads slowly", each fixed where it lived.
  *Static files said `Cache-Control: no-store`* — so every pane open re-downloaded the whole vendored graph
  (180 assets, 7.2 MB measured) and V8's code cache could never help. Now: `index.html` stays `no-store`
  (a new build must always land), content-hashed chunks (`chunk-UNUVPQFW.js`) are `immutable`, everything else
  revalidates with an `ETag` — a 304 costs 0.7 ms and re-sends nothing (verified live). *Library reads re-asked
  upstream every 1.5–2 s* (0.45–0.68 s per WAN round trip measured) — the TTLs are now when an answer is due a
  REFRESH, and past it the answer is served instantly while one background refresh runs (stale-while-revalidate,
  single-flight, and a failing refresh never takes the stale read with it). *The catalogue's cold walk (16.5 s,
  nine-plus serial MCP calls) belonged to whoever opened the drawer first* — the server now warms it in the
  background at start-up when the disk copy is missing or past its 12 h TTL. `test_latency_and_cache.py` holds
  all three, plus their edges: app files must keep revalidating (`script-highlight.js` may not be frozen for a
  year by a sloppy hash rule) and the warm must never walk when the copy is fresh.
- **Vela 0.8.3 → 0.8.4** (`@luxalgo/vela`, published 13 Oct; vela-pinets moved with it, 0.2.15 → 0.2.16, the release built
  against it — it still inlines PineTS 0.11.0, so the patched PineTS fork below is untouched). The vendored copy of 0.8.3 was
  an exact tarball subset, byte for byte, and so is this one: the ES modules, the Binance / Coinbase / Hyperliquid providers
  and the global build (`chunk-*.js` names changed again; the preload list — 157 links — and SHA256SUMS were regenerated and
  both check clean, 333 sums). What arrives: drawings remember their last settings (`toolDefaults` / `setToolDefaults`,
  `drawing:defaults`), a full settings panel and named styles for every drawing, drawings limited to chosen timeframes
  (`showOn`), Fib level sets and a Price Action section (fair value gap / order block / liquidity), and two fixes that meet
  this console head-on — **`live: true` no longer nudges bars passed as `data`** (the chart's own bars were moved up to
  0.15 %/s and made-up candles appended; exactly the shape `workspace.js` runs) and **per-bar `plotcandle`/`plotbar` colours
  now repaint on every recalculation** instead of sticking to the first paint. Public API is additive only — nothing removed
  (`DrawingToolsState` added; dependencies unchanged, so the vendored Zag closure stands; NOTICE unchanged). Held to the same
  bar as the last bump: a scratch copy of this console with only the two vendors swapped boots with 0 console errors, the
  Object tree and Data window doors read live BTCUSDT bars (500, `layout: workspace`), a hline writes and reads back, and
  `trader-chart state` reports the same shape as before.

- **Vela 0.8.1 → 0.8.3** (`@luxalgo/vela`, published 5 and 7 Oct; vela-pinets 0.2.15 already accepts it and is unchanged). The
  files are LuxAlgo's, byte for byte (nothing in `vendor/vela/` is patched); only the vendored set moved: the ES modules, the
  Binance / Coinbase / Hyperliquid providers and the global build (`chunk-*.js` names changed; the preload list, the vendor
  checksums and the docs follow). What 0.8.2/0.8.3 bring arrives with it: the maximise / restore control on Vela's panels, the
  price-axis tick hook and price-style change events in the renderer API, surface open / close events, a "Reverse" action, touch-only
  pan inertia (a mouse release now stops dead). **Nothing of ours was touched to take it**, and it was held to that: the same 56
  agent actions (add / remove studies, layouts, 10 drawing types, marks, view settings, themes, replay, fullscreen, a Pine run
  with inputs, the drawer, a screenshot) answer identically on both versions; the keyboard focus ring, the ⋯ menu band, the 200 % zoom
  layout, the drawer and Edge sheet focus handling all pass unchanged; the CSP blocks nothing; first canvas is 1,544 ms against
  1,549 ms (median of six, alternating runs) for +58 KB. `test_vela_doors` now finds Vela's drawings chunk by content, because its
  hashed file name changes with every release.

- **The repo's own numbers match what ships.** Four places still named the version the vendors had
  left behind: the vendoring comment in `index.html` and `THIRD-PARTY.md`'s Vela paragraph said
  0.8.3 / vela-pinets 0.2.15 (0.8.1 in one line, three releases stale), and `docs/architecture-latest.html`
  said 0.8.3 in a badge and four card texts. Two counts had drifted too: that page's badges promised
  39 MCP tools and 293 backend tests (with a matching stat card further down), and `README.md` /
  `docs/HANDOFF.md` said "about 1,050 / ~1,090 tests". Measured, not assumed: **Vela 0.8.4 +
  vela-pinets 0.2.16** (npm `latest`, and the bytes the console serves — `vela.global.min.js` is
  1,043,818 by both), **56 MCP tools** (56 `@.tool` registrations, 56 rows in `docs/MCP-TOOLS.md`,
  8 of them `edgestats_*`), **1,133 backend tests, 1 skipped, 70 files, 114 s**. CI's two vendor gates
  (`tools/vendor-sums.py --check`, `tools/modulepreload.py --check`) and the suite stay green; nothing
  in `vendor/` moved.

### Added

- **The row opens the desk's own chat — when the seat is empty, and never otherwise (16 Oct).** The
  sidebar row reveals the chart pane as before; what is new is `openDeskChatWhenEmpty()` in
  `traders-desk/desktop/plugin.js`: when **no chat of the operator's own is focused**
  (`host.state.focusedStoredSessionId` falsy — a cold boot, a full page, a first click) it puts
  Trader's Agent's own session in front, and when a chat IS focused it does exactly what it did before
  (leave it alone; the chart docks beside it). That guard is the whole point: the pre-22-Sep row jumped
  into a desk chat on *every* click and pulled the operator out of the conversation he was having.
  The session is **minted, not resolved** — one `host.request('session.create', {title, source,
  idempotency_key})` whose `stored_session_id` is remembered in `ctx.storage`, so it persists with its
  transcript, a retry cannot twin it, and no id or title is ever hardcoded or searched for. Policy 3:
  the palette command **Trading: toggle the desk chat on row click** turns the whole behaviour off
  (stored preference, ON by default), and the docked card states which way it is set. Both session
  doors are probed (`typeof host.request`/`host.openSession`) so an older app degrades to reveal-only
  instead of throwing. Verified: the harness gained the two real SDK doors as stubs and
  `plugin.expect.json` pins `Desk chat: on`; the sidebar-row guard tests were rewritten from "never
  switches" to "opens only when the seat is empty, with the off switch", and the docs-drift prose
  pins now forbid the *unconditional* claims while requiring the condition. 1,139 tests green.

### Fixed (the 8 Oct 2026 full audit: seven read-only lanes over `3c2ad34`, handed to Hermes as a report)

- **The chart bridge no longer loses or duplicates commands.** Its three files were read-modify-written with no lock and one
  shared temp name: 60 parallel command POSTs gave 11 to 23 HTTP 500s and duplicate ids (the page drops a duplicate id, so a
  command silently never ran). One lock, a temp file of its own per write, and command ids from a counter that only grows.
  A result must name the command it answers (400 otherwise) and now keeps the fields the page reports (`trades`, `overlay`…).
- **Replay prices only the symbol being replayed.** An ETH order used to fill at the BTC cursor price. The page sends the
  symbol with the push; another symbol is priced live.
- **Paper broker:** the entry fee is in `realized` (it now reconciles with equity); an approve that cannot be saved leaves the
  account exactly as it was; a read error on `paper.json` no longer resets the account to 10,000; large quantities sell
  without a ghost position; prices are read outside the lock; order ids continue across a reset.
- **`once_per_view` now reaches the stream** (`reload` runs in every view). **A month is a month:** `1M` was mapped to one minute.
  Intervals Binance does not serve are refused with the list. A partial catalogue is no longer cached for 12 h.
- **The console listens at once** (it waited up to 60 s for the LuxAlgo MCP first); SIGTERM now stops it cleanly; a busy port
  is one line, not a traceback; bad numbers are a 400, not a 500.
- **Trust boundaries.** `GET /api/session` goes to the console's own page and to local tools, not to other pages or LAN
  peers (`--host 0.0.0.0` no longer hands out the token; `TRADERS_AGENT_ALLOW_LAN=1` opts in). The Origin check compares the
  port, so another localhost app cannot post. Cross-site `/api` GETs are refused (`Sec-Fetch-Site`). The page carries a
  Content-Security-Policy; every answer is `nosniff`. Idle sockets time out (30 s), connections are capped, SSE queues are
  bounded. `run_id` and the backtest service's `local:` names cannot leave their folder; the backtest service answers the
  console only; thumbnails come from exact hosts, are content-sniffed, follow no redirect and are written atomically. Agent
  definitions are validated (a toolset such as `--yolo` is refused); the chat route's workdir and timeout are the operator's.
  Loopback calls from the MCP server and CLIs bypass `http_proxy`.
- **The agent is no longer told things that are not true.** `library_source` / `library_indicator` cut long scripts silently
  at 6,000 / 8,000 characters while claiming the full source: they now return up to 60,000 and say `truncated … offset=N`
  (as do the edge, prop-firm and related lists). The tool and skill no longer say `while` / `for…in` cannot run (only
  `import` is refused). `bt_*` answer instead of raising; `chart_shot` uses the same view gate as every tool; `chart_batch`
  takes a list; all 54 tools state `destructiveHint`; an empty chart is called empty; `chart_add_indicator` refuses an unknown
  name before Vela is asked (no ghost study row) and suggests the lower-case spelling.
- **Docs match the code.** The skill is 139 lines (the history moved to `docs/desk-engineering-notes.md`) and covers the paper
  broker and replay; README corrects "no order placement", "nothing written outside the repo", "synthetic bars", the removed
  buttons, ports and `LUXALGO_CONSOLE`; `docs/MCP-TOOLS.md` groups tools by their real annotations.
- **Installer:** flags are parsed (an unknown flag or `--help` no longer installs), `--uninstall`, `PORT=` is baked into the
  installed plugin, `--doctor` no longer `eval`s paths and checks the Python version and the MCP registration.
- **UI and accessibility:** the Vela top bar has a keyboard focus ring; the ⋯ menu is no longer covered by the pane at 1020-1069 px;
  the run status stays on screen at 200 % zoom; the highlight layer is no longer a Tab stop; the drawer and Edge sheet are
  dialogs that make the rest inert and return focus to what opened them; Esc from ⋯ returns focus; filled buttons are 4.9:1
  in the dark theme; inputs keep a forced-colours focus outline; `<title>` is "Trader's Agent".
- **Frontend races:** a market switch during a re-run no longer leaves another symbol's labels; the newest run wins; a failed
  first `/api/session` is retried; the poll loop cannot stall on a hung request; the stream no longer moves the poll's
  high-water mark; the library detail pane shows the last row opened; the script draft is saved when the page goes away;
  catalogue links must be `https:`; two untitled inline inputs no longer share one override.
- **Plugin:** the reveal-on-launch default is off, as documented, and waits for the stored choice.

### Removed

- `docs/studies/luxalgo-reference/smart-money-concepts-smc.pine`: LuxAlgo's CC BY-NC-SA 4.0 script was committed in this (public)
  repository. It remains in git history; rewriting history is the maintainer's call.
- `./install.sh --vendor` (it rewrote committed files without checking them). See `console/frontend/vendor/VENDORING.md`.

### Added (from the same audit)

- `NOTICE` (the AGPL status of the distribution and the source offer for the patched engine), the MIT texts of the vendored Zag
  packages, `console/frontend/vendor/SHA256SUMS` with `tools/vendor-sums.py --check`, a "Network" section in `THIRD-PARTY.md`.
- CI: `permissions: contents: read`, one run per PR, a lint job (`ruff F,E9`, `node --check`, `bash -n`, vendor sums, preload list),
  the whole suite once with fastmcp and node REQUIRED and a skip ceiling, both `mcp` majors, pinned test dependencies
  (`console/requirements*.txt`), and a boot check that fails when the server never answers.
- About 130 new tests that drive the real code: threads against the bridge, a live socket for the gates, a fastmcp stub console.

### Added

- **Syntax colouring in the script editor.** Comments, `//@directives`, strings, numbers and `#RRGGBB`
  colours, keywords and types, and Pine's built-ins (`ta.sma`, `close`, `size.small` …) are coloured as you
  type — in five inks (the accent's own soft tones, one violet, one green, one amber; comments are the
  faint ink), AA on the canvas and under the caret-line wash in both themes. No library, no CDN, offline:
  the editor is still a plain `<textarea>` (so the gutter, the row marks, Ctrl/Cmd+Enter, Escape, undo,
  selection and input methods work exactly as before) and its text is made transparent while a coloured
  copy of the same text is drawn under it — the same font, line height and scroll offsets, a scroller
  shaped like the textarea so the browser snaps both to the same pixels (measured to the pixel at 1×,
  1.25×, 1.5× and 2×, with the editor starting on a fraction of a pixel and scrolled to fractional
  positions). Pine has no multi-line strings or comments, so a line is coloured on its own and only the
  lines on screen (plus a margin) are ever coloured: scrolling costs about 3 ms a frame whatever the
  script's length, and an edit in a 150 000-character script about 30 ms, most of it the browser laying the
  text out. The copy switches itself off — the plain text shows again — for a script over 300 000 characters, while an input
  method is composing, in forced-colours mode, and if anything in it throws; a name followed by `=` is a
  variable or a named argument, never a keyword (`timeframe = "D"`, `plot(x, color = red)`).

- **Saved scripts: Save, Open, Rename, Delete.** A list button in the script pane's action bar (a view in the
  editor's place, like Settings — no new pane, nothing pushes the chart) keeps scripts on this machine
  (localStorage): the name, the code **and the settings values you chose**, so "Hull Butterfly, tight" and
  "…, loose" can be switched without re-pasting. Rows are hairlines with the length, how many settings are
  set, and the day. Save is `Ctrl/Cmd+S` (`Ctrl/Cmd+Shift+S` saves a copy). The rules: Save overwrites the
  script that is open **only while the name is still its name** — any other name is a new script and a taken
  one becomes "Name (2)", so nothing is replaced by accident (a script loaded from elsewhere, like the
  Library's "Edit a copy" or the agent's `show`, is attached to nothing); opening or starting another script
  never throws work away — when the editor has changes saved nowhere the list asks first, in the list
  (Save and open / Discard and open / Cancel); a delete asks first and names the script; a rename that
  would reuse a name is refused. A dot on the button says the open script has unsaved changes. A write the
  browser refuses (storage full or blocked) is reverted and said — never a list that looks saved and is not.
  Up to 50 scripts, 400 000 characters each; another console view that saves is picked up. The pane gained
  public hands for this (`working` / `settled` / `load` / `setName` / `setView`), and the Library's "Edit a
  copy" and the agent's `show` now go through `load` instead of writing into the textarea.

- **The agent can set a script's own settings.** `chart_apply_pine` and `chart_draw` take `inputs`, e.g.
  `{"Length": 50, "Show upper band": false}`, and a new read-only tool `chart_pine_inputs` lists what a
  script declares (label, type, default, range or options, group) without running it, opening the pane or
  touching the chart (MCP tools 53 → 54). The same on the CLI: `trader-chart draw FILE --input Length=50`,
  `trader-chart script inputs --pine FILE`, and `inputs` on the raw `apply` / `draw` / `script` actions.
  Labels are matched exactly, then ignoring case and spacing, then by variable name, then by engine id; a
  value goes through the same checks as the Settings panel (a number is limited to the input's own range, a
  choice must be one of its options, a boolean is `true` / `false` — not "yes"). Nothing is guessed: the
  reply says what was used (with a note when a number was limited or rounded), what was refused and why — a
  mistyped label gets a *did you mean* — and which inputs the script does have. The run happens either way.
  `null` puts an input back to its default; an explicit `{}` means all defaults. When the script pane holds
  this very script, its Settings show the agent's values and a change there re-runs it; an agent run never
  overwrites the operator's draft and stays out of the pane's run list. `mode: show` with `inputs` loads the
  editor with the values and waits for Run. The values are saved with the last run, so a reload or a market
  change keeps them.

### Fixed

- **Chart loading and background traffic** (measured 6 Oct, one tab, the exchange mocked, headless Chromium; the
  numbers are for localhost and grow with request latency).
  - **The module graph is fetched in parallel.** Vela's workspace, vela-pinets, PineTS and ~140 small Zag /
    floating-ui files were discovered one import level at a time — 17 sequential waves, about 1.3 s of a 1.8 s
    boot. `index.html` now lists all 157 as `<link rel="modulepreload">`, generated by
    `tools/modulepreload.py` (`--write` after a vendor upgrade; the test suite runs `--check`, so a stale list
    fails there). First canvas 1,798 → 1,586 ms (median of 5); with 80 ms added per request 3,372 → 2,844 ms.
    The block must come after the import map: a module fetch that starts first freezes the map and the workspace
    silently falls back to the bare chart (a first version did exactly that and looked 300 ms faster — it was
    measured by checking that the workspace really loaded; a test pins the order).
  - **The exchange connections are warmed early** (`preconnect` for api.binance.com, fapi.binance.com and the
    icon host), so the TLS handshakes happen while the module graph arrives instead of after it. Not measurable
    offline; it removes a round trip the first bars wait on.
  - **The heartbeat read the chart's bars twice every 4 s**, and when the chart hands none over (the normal case
    on this Vela) each read was a live fetch to the venue through `/api/bars`: 16 in 30 idle seconds. It reads
    once; `chartBars()` shares one fetch between callers within 3 s (and between callers arriving while one is in
    flight); the server keeps a clean answer for 1.5 s. 16 → 8 in 30 s, and the overlay, the agent and a Pine run
    no longer each pay their own round trip. An empty, failed or partial answer is never kept; every caller gets
    its own array.
  - Held by `test_boot_speed.py` (17 tests, each fix mutation-checked).

- **Audit round 4, phase C: the four findings that were ours** (about 900 engine runs under Node; the engine-side
  findings are in the audit report, not here).
  - `docs/studies/pine/fvg-mitigation.pine` failed at its default inputs on any data without a gap yet
    (`Index 0 is out of bounds [array.get]`): a Pine `for` whose upper bound is below its start counts down, so
    `for i = 0 to shown - 1` with `shown == 0` still ran. The draw block is now guarded by
    `array.size(gaps) > 0`; its comment that PineTS refuses `while` is gone (`while` runs).
  - A run whose every plot line is empty — a lookback longer than the history set through an input, or a
    condition that never held — and which drew nothing else read as a normal "Ran · 0 series". It now says
    "nothing was plotted: “s” has no value on any of these N bars …" (a ⚠ note on the status line, the run list
    and the agent's reply).
  - An `input.timeframe` override of "banana" was accepted. Pine's spellings ("", "15", "240", "D", "1D", "4H",
    "W", "3M", "30S") are; anything else is refused with a sentence, in the pane and for the agent.
  - Higher-timeframe rows are used oldest-first, one per bar time: a source that sent them newest-first made
    `request.security` return NaN on every bar. `/api/bars` was already ascending, so for it nothing changes.
  - Held by `test_audit_round4_fixes.py` (study scripts run on flat, trending and sine data; the unguarded script
    is the control that fails; each fix mutation-checked).

- **With the drawer open, one Escape closed the script pane and left the drawer open** — the reverse of
  the intended order (found by Hermes in Desktop, 5 Oct; the bug dates from the drawer, 3 Oct). The drawer
  check lived in a second Escape handler bound after `escapeKeydown`, which had already closed the pane and
  prevented the event. There is one handler now and it closes one layer per press, topmost first: the
  library drawer, then the script pane's Settings view, then the pane. The real handler is run under Node
  against stand-ins for the three layers (`test_escape_layers.py`), and it fails against the old one. A first
  attempt that also skipped already-`defaultPrevented` presses stopped Escape closing the pane after a click on
  the chart (Vela marks it handled); an A/B run against the committed build caught it, and the guard is
  pinned out.
- **The lost-line-breaks warning missed short scripts and could break a valid one.** It only looked at
  sources over 80 characters (a 69-character collapsed script was never flagged) and at any backslash-n,
  even inside a string literal — so a valid one-line script with `"…\n"` in a title was flagged and
  "Restore line breaks" would have rewritten its string. `ScriptTools.diagnoseBreaks` flags escaped breaks
  at any length, ignores the ones inside strings, ends a `//` comment at its break (a quote mark in a header
  cannot swallow the rest), and the restore keeps string contents as written. A restored script with a
  `"a\nb"` label runs.

### Added

- **Script inputs become a Settings view (5 Oct).** The engine reads a script's `input.*()` declarations
  without running it (`PineTSRunner.scanInputs`, in a worker). A script that has any gets an inputs button
  in the action bar (a dot says some are changed); it opens a view in the editor's place — grouped by the
  script's own `group`, one control per input (number with its min / max / step, switch, choice, source,
  colour, text), a per-row reset and "Reset all". A change applies at once to the script on the chart (the
  Run re-runs with the new value, and the run list says "N inputs changed"); there is no Save. Only changed
  values are sent, as `new Indicator(source, { in_N: value })`, so an untouched script runs exactly as
  before. Values are kept against the script's declared title (a different script with an input called
  "Length" does not inherit them), survive a reload and a market change, and are clamped to the input's own
  range before the engine sees them. Esc closes Settings before it closes the pane.
- **Errors are marked on their line.** A syntax error is its own code, `SYNTAX_ERROR`, with `line` and
  `col` from the engine's `at 3:7` (the agent gets them too). The line is tinted and its number turns red in
  the gutter, the status line and the run entry name it, and "Go to line N" selects it. A runtime error
  that names only a variable or a Pine function (`nope is not defined`, `array.get`) points at the first
  line that uses it, labelled "likely line N" — never presented as exact. Editing clears the mark.
- **Ctrl/Cmd+Enter runs** from anywhere in the pane (editor, name, a Settings control). The caret's line is
  tinted in the editor.

### Changed

- **The script pane, rebuilt around the editor (5 Oct).** One action bar — name, ▶ Run, ✕. The editor no
  longer wraps, so the line numbers stay on their lines (a wrapped license line pushed line 2 down to row
  6); long lines scroll sideways, and the gutter keeps room for a desktop scrollbar. The Logs chip, the
  static "Pine v6" pill and the three-line hint are gone: one status line says what the last Run did
  ("Ran · 2 series · 1 box · 500 bars · 101 ms", "Failed · …") and opens a run list — newest first, time,
  script, what it drew, its ⚠ notes, and the engine's full line behind a fold. The engine has no `log.*`
  output, so this is a run history, not a Pine console. Stacked under the chart (under 760 px) the list
  starts folded. A script that arrives as one line is flagged — its first `//` would hide everything after
  it — with "Restore line breaks" when the breaks are only escaped `\n`. Run's colours come from tokens.
- **The script pane at 760–1099 px is full height and clear of the fallback buttons** (`5879933`): docked
  beside the chart it had inherited the stacked layout's 40dvh cap, and the bare-chart Scripts / Script /
  Full screen buttons covered its name field, ▶ Run and ✕.

### Fixed

- **LuxAlgo-library scripts always ran on 1-minute bars, whatever the chart showed.** The chart's market
  was read by scanning the page for text that looks like a timeframe, and Vela keeps its *closed*
  timeframe dropdown in the DOM with "1m" first — so 4h, 15m and 1h all read `1m` (measured 4 Oct).
  Every Pine run, study number and the heartbeat's timeframe came from the last 500 **minutes** of
  bars, and the drawings were mapped by time onto a chart showing days. The active workspace cell is
  asked first now (`marketFromWorkspace`, with `intervalOf` translating Vela's `60` / `240` / `D` /
  `1h` spellings), and the DOM fallback skips menus. Built-ins were never affected: Vela computes them.
- **Every library script drew at most 7 boxes, 7 lines and 7 labels — the oldest ones.** The worker's
  projection did `value.map(jsonSafe)`; `Array.map` passes the index as the second argument, which
  `jsonSafe` reads as its depth, so every object after the 7th became `null` and was filtered out. A script
  creating 250 lines showed 7; the volume-profile style 7 of 24; the SMC reference 5 lines / 7 labels
  instead of 9 / 12. The SMC / ICT, levels and patterns families (the drawing-heavy ones) were the
  hardest hit. `docs/PINETS-COVERAGE.md` counts *runs*, not drawings, so its numbers stand.
- **Drawings did not follow a symbol or timeframe change.** A built-in recomputes; the overlay is a picture
  of one run, so after 1h → 4h the 1h boxes floated over the 4h candles at prices that meant nothing.
  The last script is re-run against the new market (once the new bars have settled, with a second pass for
  quick scripts), and taken off with a toast if it cannot run there.
- **"legend shows 7 studies · the console knows 4 — reload" appeared when you added a plain RSI.** The
  banner compared Vela's *series* count with the *indicator* count, and RSI draws six series. It now
  fires only when the chart draws series and the console can name no study at all (the AMD POC case it
  was written for); clicking it reloaded the page.
- **The script legend listed every script run since the page loaded**, over a canvas that holds one: it
  names the one that is there. The overlay also removes any canvas left over from an earlier host
  instead of letting old pixels ghost under new ones (seen once; not reproducible on demand).

- **The ⋯ menu had no door at the plugin's default 620 px width.** In Vela's compact mode the desktop
  row is 0-width; the menu was anchored to its hidden ⋯ button and opened at `left: -168`, off-screen,
  so Alerts, Paper account, Data window, Object tree, the screenshot and Edge Stats could not be
  reached by tapping *More* in the bottom sheet. A hidden anchor now counts as no anchor and the menu
  opens top-right. With that door working, the Edge Stats fallback button shows only when the row is
  missing entirely.
- **Floating buttons printed on top of the chart at 620 px and below.** The bare-chart fallback strip
  used transparent ghost buttons, so *Scripts / <> Script / Full screen* overlapped the symbol header
  and the price axis, and wrapped their labels at 360 px. They are opaque now and never wrap.
- **`trader-chart` died on every command under Python 3.14.** A bare `95%` in the `edge` help text is a
  `%i` conversion to argparse, which 3.14 rejects when the parser is built (3.11–3.13 only on
  `--help`, so the 3.11-only CI never saw it). Escaped by hand (4 Oct); now a static test scans every
  `help=` in the repo, and CI runs the unit suite on 3.11 **and 3.14**.
- **`/api/agents`, `/api/agents/delete` and `/api/agents/learning` answered bad input with a 500.** The
  study store's validation errors are the caller's mistake; they are a 400 `bad_request` now.
- **Five CSS variables that nothing defined** (`--lx-text-1`, `--lx-text-2`, `--lx-border-2`,
  `--lx-radius-2`, `--lx-radius-3`) made the Script pane's hint colour and key-cap border and the
  chart-tip tooltip's border silently do nothing. They point at the real tokens, and a test fails on
  any `var(--lx-…)` that nothing defines. The Edge Stats category row also fades at its right edge so a
  cut-off chip reads as scrollable.

- **A Library script that mounted and drew nothing.** The operator's recording showed *Wyckoff Wave &
  Volume Studies* opening an empty pane with `PineTS: Index -2 is out of bounds, array size is 0`.
  Cause, measured: the Pine engine (`pinets@0.9.33`, pinned in the page's import map) evaluates **both
  sides of a ternary**, so the guard every LuxAlgo script uses for a rolling array —
  `size >= 2 ? array.get(a, size - 2) : na` — still runs the read while the array is empty and throws.
  Proven minimal: `1 == 2 ? array.get(arr, -5) : 7` crashes although the guarded branch cannot be
  reached. `pinets@0.10.0` honours the guard; the same script then runs (4 series + its dashboard)
  instead of aborting on its first wave. The pin is a floor now, with a test that stops it sliding
  back.
- **Drawings and dashboards were painted, in the pane, opaque — and invisible.** The overlay canvas
  and the tables layer sat at z-index 6 and 7, beneath the chart's own layers: a loud probe box drew
  nothing at 6 and appeared at once at 5000. They now live in a named band between the chart and the
  console's own surfaces (25/26, under `--lx-z-overlay` 30), and the tables layer covers the **price
  pane** instead of the whole chart element — a `table.new(position.top_left)` dashboard used to land
  on the toolbar strip. The apply report also says *where* a table landed (`16 cell(s) at 502,85 … in
  the pane`), because "1 table on screen" read as "you can see it" while it was not.

### Added

- **Edge Stats sheet redesigned for reading, not just correctness.** One hero per view: the rate at 56px (the
  largest type in the sheet, plain proportional sans), its sample and 95% range on the next line, and two
  verdict chips — *Stable over time* / *Matches recent sessions* (icon + words, never colour alone) — that
  replace three full-width cards and their explanatory paragraphs. **Summary** (default) is the hero, the
  breakdown when the question was split, and the days behind it; **Detailed** adds the halves, recent vs
  all, year by year, timing and "what this measures". A chip jumps to its evidence; the choice is remembered.
  Home gets a **Start here** row of six plain questions and a catalogue grouped under category headings
  (the repeated tag column and the "outcome WHERE condition" explainer are gone); the data view shows one
  source at a time behind a switch, with the sandbox-only archive option under *Advanced*. A real type scale
  (56 / 20 / 14 / 12.5 / 11.5), flat hairline-separated sections instead of a box around everything, and a
  **theme switch in the sheet's header** that presses the app's own theme button, so chart, chrome and sheet
  change together (the toggle itself already existed in the Library drawer). The session chart no longer
  draws a level far outside the day's candles — it stretched the price scale until the candles were a sliver
  at the bottom — and lists it in the legend as off chart; the badge says what the number is ("filled in
  15 min"). Cut as noise: the query-language explainer, the long per-card notes, and the engine's raw
  bookkeeping chips ("session utc", "1m bars", now a caption under the chart). Honesty rules are unchanged
  and pinned by 17 new tests: no percentage without its N, a refused answer shows none, the disclaimer and
  the CC BY 4.0 attribution stay.

- **`request.security` returns real higher-timeframe and other-symbol data.** PineTS builds a second engine
  for each `request.security` on the *same data source it was given*; the worker gave it a bare array of
  chart bars, which has one timeframe, so a "daily" close came back identical to the chart's close. The
  worker (`pinets-worker.js`, `makeSource`) now gives the engine a source object: the chart's own
  market is answered from the bars already in hand, and every other (symbol, timeframe) is fetched from
  the console's `/api/bars`, sized to the range the engine asks for, shared across calls, and normalised
  across Pine's spellings (`D`, `60`, `1W`, `BINANCE:ETHUSDT`). Measured: on a 1h chart the daily high
  went from 500 values identical to the chart's to 22 real daily values. If a fetch fails (an unknown
  symbol, no network) the script is given the chart's own bars and the run result says exactly which
  request fell back; what *was* fetched is listed (`multi-timeframe: BTCUSDT 1d (54 bars)`). Only Binance
  symbols can be fetched, and the main-thread fallback engine (used only if the worker cannot start) still
  has the old limit and keeps the ⚠ note. Tested in Node through the real vendored engine, with a fake
  `fetch`; a start time of `0` being read as "missing" was caught by that test.

- **Deeper history for Pine runs, and an honest note about multi-timeframe.** Every run was handed the
  last 500 bars whatever the script asked for, and a lookback longer than that does not give a slightly
  wrong number — it gives *nothing* (on a 4h chart `ta.highest(high, 2184)`, a 52-week high, was na on all
  500 bars; a 500-bar lookback produced one point). The run now reads the longest lookback the script
  states (length arguments, `x[N]`, input defaults), fetches that plus a warm-up — up to 5000 bars, with
  500 as the floor so a heavy script is not slowed — and scales its deadline with the bars. `/api/bars`
  pages back through Binance's 1000-per-request ceiling (partial results come back marked `partial`),
  and the overlay maps drawing indices through the bars the script ran on instead of a fresh 500 (a
  1000-bar run's boxes were measured sitting on the right pivots). Separately, `request.security`
  *runs* in this engine but ignores the timeframe — `request.security(…, "D", close)` returned the chart's
  own close (measured 4 Oct) — so a multi-timeframe indicator drew the chart's own levels in silence. The
  run result and the on-chart legend now carry a `⚠` note whenever a script asks for a timeframe other than
  the chart's, and two docs that called it a clean `RUN` are corrected (real
  multi-timeframe data followed — see the entry above).

- **Edge Stats — how often did it actually happen?** LuxAlgo's open-source
  [Edge Stats](https://github.com/LuxAlgo/edge-stats) engine (MIT, pinned to a commit) runs beside the
  console as a lazily started sidecar, and the chart's `⋯` menu opens a sheet for it: ask in the
  engine's query language (`gapFill WHERE gapDirection = up`, with autocomplete from the engine's own
  registry), run any of the 42 catalogue reports, group by weekday / month / year, and open a
  historical session on a Vela chart with its prior high / low / close, open and gap drawn as levels.
  The rule the whole feature is built on: **no percentage without its N** — every rate carries its
  sample size and a 95 % Wilson interval, the two-halves and recent-vs-all checks, and a result with
  fewer than 10 matching sessions prints counts only, no rate. The engine does all the arithmetic; the
  plugin never computes or rounds one. Data: one-click synthetic demo, or free Binance / Dukascopy
  history downloaded as a background job (the sidecar steps aside while a download holds the
  single-writer store; it is adopted again after a console restart). Installed with
  `./install.sh --with-edge` (Node 20+, ~300 MB; nothing changes without the flag). The agent gets
  eight tools — `edgestats_status` / `fields` / `presets` / `query` / `report` / `session` (read-only),
  `edgestats_show` (puts the answer on the operator's screen through the chart bridge) and
  `edgestats_setup` (asks the operator before real downloads) — plus `trader-chart edge …` and a
  section in the desk skill (MCP tools 45 → 53). Attribution for the engine (MIT) and its calendar
  data (CC BY 4.0) is in the sheet's footer and in `THIRD-PARTY.md`. Also: the MCP layer and
  `trader-chart` now pass an engine's 4xx message and hint through instead of a generic failure, and
  `sync-live.sh` carries `edgestats.py` and `edge_text.py` to the live tree. Verified against the real
  engine (demo job, seeded queries, session bars, adoption after restart); **real Binance / Dukascopy
  downloads were not exercised** — the build machine's network blocks both.

- **Full screen for the chart.** The operator, looking at the pane: *"sy nak ada button capability
  untuk boleh kasi fullscreen ni chart,,, sekarang mcm takde"*. There is one now — `⛶ Full screen`,
  in the console's topbar and docked onto Vela's own toolbar row beside `<> Script` and
  `☰ catalogue`. It does two things, because they answer two questions: the console's chrome, panels
  and statusbar step aside so the **chart owns the page** (pure CSS — nothing can refuse it), and the
  page asks the browser for fullscreen so the console takes the **whole display** (that half needs
  the plugin pane's iframe to carry `allowfullscreen`; it does). `Esc`, the same button, or a floating
  `✕` comes back. Measured live: press → the app window goes fullscreen and the chart fills the
  display; `Esc` → back in the pane, chrome restored. The door is `chart_fullscreen` /
  `trader-chart fullscreen [--off]`, and its answer says which half landed (`native` = the display).

### Fixed

- **The chart pane could push the page sideways — that was the "tak adaptive".** With a legend chip
  carrying an indicator's name ("Directional Matrix · overview") plus the two status pills, the
  topbar's min-content measured **921 px inside an 870 px pane** and made the whole document wider, so
  a horizontal scrollbar appeared under the chart. Reproduced in a headless browser before touching
  anything, re-measured after: the shell is `overflow: hidden`, the topbar may wrap, legend chips
  shrink (`flex: 0 1 auto; max-width: 34%`), and below 1180 px the docked buttons go icon-only
  (`.btn__label` hidden). Everything that scrolls in this console is a pane, never the page.
- **Esc inside native fullscreen left the console full-bleed with no way back.** The
  `fullscreenchange` listener asked `isChartFullscreen()`, which reads the `chart-focus` class itself,
  so it could never decide to take the class off; the browser's own state is tracked separately now
  (`nativeFullscreenWasOn`), and Esc in either mode brings both halves back.

### Added

- **The catalogue is grouped, and every card carries its own reading.** The LIBRARY was one flat
  806-row list. It now arrives as families — SMC / ICT 60, Trend 55, Volume & Flow 46, Structure 40,
  … — each with a header that says how many it holds and folds away, and a rail in the nav
  ("Everything" plus one line per family) to jump between them. Pick a family and the grid groups by
  that family's *clusters* instead, the catalogue's own finer reading ("Moving-average lineage",
  "Candlestick catalog", "Market profile / auction theory"). Under every card there is now a
  **Reading** button: it unfolds in place and shows what the indicator is and how it is read, from the
  catalogue's own description — 806 of 806 rows have one. `trader-chart indicators --family trend
  --reading mlma` drives both from the door.

  Two details worth knowing. Half the catalogue carries no family of its own — those are the older
  single-name indicators (`percent-b`, `1-2-3-reversal`, `52-week-high-low`) and LuxAlgo files them as
  *concepts* instead, which know a family **and** a cluster; the console walks those 853 concepts too
  (nine more pages, once) and 390 of the 414 unfiled rows land in a real group, the rest honestly
  staying "Unfiled". And the paged loader is gone: `/api/catalogue` walks the whole thing in one call
  (nine pages, `sort=family`, **13.5 s cold, 42 ms warm**, kept on disk for 12 h), so the page filters
  in memory — which is also why the search can no longer race a section change (26 Sep's `0 row(s)`
  over a 2-row answer is structurally impossible now, not merely fixed).

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
