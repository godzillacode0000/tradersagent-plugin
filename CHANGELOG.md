# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

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
