# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added

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
