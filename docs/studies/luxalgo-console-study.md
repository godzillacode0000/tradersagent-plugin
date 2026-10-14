# The hosted LuxAlgo console — what it is, and what of it this plugin already carries

A measured read of `vela.luxalgo.com/chart/<id>` (the hosted LuxAlgo terminal), taken to decide what
the Trader's Agent plugin should grow next. The headline: **the chart itself is Vela — the same
engine this repo already vendors — and most of what the hosted console adds on top is LuxAlgo's own
shell, not the chart.** Two of its right-rail panels are Vela's, though, and those were reachable on
our chart by hand and not by the agent. They are doors now (`chart_objects`, `chart_data_window`).

## How this was measured

| Tool | What it gave |
|---|---|
| `rea-agents` 6.4.0 (REA), `list-browser-targets` / `inspect-web-page` / `analyze-web-bundle` over CDP | the page's scripts, routes, endpoints, storage keys, DOM, and the module graph — with the capture's own `completeness`/`limitations` attached |
| a small CDP client (`Runtime.evaluate`) against the same target | the live control inventory: every button, its `aria-label`, its box; the settings dialog walked tab by tab |
| the repo itself (vendored Vela 0.8.3 + `console/frontend/*`) | what the plugin already does, so a "gap" is a real gap |

The target loaded as `BTCUSDT · Vela` at 1920×1080, headless, in a browser profile of its own — never
in the operator's session (a second view can take commands the pane never sees).

## What the hosted console is

- A **Next.js (turbopack) shell** — ~68 chunks under `/_next/static/chunks/` — that hosts the chart.
- The chart is **Vela by LuxAlgo**, the same widget family this repo vendors (`console/frontend/vendor/vela`).
  The proof is in the page's own code: the settings dialog, the Object tree and the Data window are
  Vela classes (`ObjectTree extends SidePanel`, `DataWindow extends SidePanel`,
  `dock.addBuiltIn({id: "objects" | "dataWindow", …})`), and the same `drawings.*` / `renderer.*` calls
  this repo's doors already make.
- LuxAlgo's own services sit around it. Observed in the bundle:
  `GET /api/quant/prod-library/api/library/indicators/query?pageIndex=0&pageQuantity=12` (the Library
  the plugin reaches through LuxAlgo's MCP server instead), `POST /api/markets/public-get-market-status`,
  a WebSocket channel (`ready` / `ask` / `close` / `personal-request`) behind the chat pane, and
  `navigator.locks.request("luxalgo:browser-trading")`.
- Its "Library" is also shipped **as data**: `draft-indicator-library/library-data.js` is 1.3 MB of
  catalogue, hydrated client-side (`library.js`, `discovery.js`).
- Browser-side state is small and named: `luxalgo.assistant.configs`, `quant.symbol-search.recent-symbol`,
  a PostHog key, a PWA install flag, and one cache (`luxalgo-static-v1`).

## The surface, measured

Top bar: `Show chart` (QuantChart), `Feedback`, `Journal`, `Panels`, `Sign in`/`Sign up`, then the chart
bar — symbol picker, `Timeframe`, `Chart style`, `Layout`, `Indicators`, `Favorite indicators`,
`Indicator Templates`, `Replay`, undo/redo, `Workspaces`. Left rail: cursor, Lines, Fibonacci,
Patterns, Measurements, Shapes, Text, Icons, **Capture area for Quant**, Measure, Eraser, snap, stay in
drawing mode, sync drawings, collapse. Right rail: `Screenshot`, `Watchlist`, `Journal`, `Pine editor`,
`Object tree`, `Data window`, `Tables`, `Chart settings`. Bottom: range buttons `1D…ALL` and a
`Time zone` button.

The settings dialog has **Symbol / Status line / Scales and lines / Canvas / Advanced** (the operator's
own screenshot shows an extra **Events** tab — that tab is where Vela lists event-mark *groups*, so it
appears once a group exists; this plugin's `chart_marks` defines one named "Trader's Agent").
Measured on the Symbol tab: chart style, candles (body/borders/wick/spacing), animation (5 toggles),
time zone + two watermarks, appearance preview. Status line: name/market/OHLC/change + indicator
titles/values. Scales and lines: invert, last-price line/label, countdown, axis labels, margins.
Canvas: background/text colour, text size, pane separator, grid, margins, theme, session. Advanced:
bars to fetch (5000).

## Feature by feature, against this plugin

| Hosted feature | Where it lives | This plugin |
|---|---|---|
| Chart settings dialog (5 tabs) | Vela | same widget — vendored Vela renders it; `chart_view` drives the agent-relevant subset |
| Drawing tools, 76 types | Vela | `chart_drawing` (same 76, anchor-checked) |
| **Object tree** | **Vela** | **`chart_objects` — added (Phase 8); the panel existed, the agent had no door** |
| **Data window** | **Vela** | **`chart_data_window` — added (Phase 8)** |
| Replay | Vela | `chart_replay` |
| Layout / multi-chart | Vela | `chart_set_layout` |
| Watchlist, Journal, Pine editor, Indicator Templates, Workspaces | LuxAlgo shell | **not present** — new product surfaces, not doors (see below) |
| Capture area for Quant | LuxAlgo shell | nearest is `chart_shot`; an area capture is a candidate |
| Library catalogue | LuxAlgo service | `library_*` tools over LuxAlgo's MCP server |
| Chat pane that drives the chart | LuxAlgo shell | this is what Hermes *is* here — the plugin's whole point |

## What the two new doors are

`TaVela.objects` is the Object tree as a door: `list` (every drawing back-to-front — id, type, text,
hidden/locked, z — then the indicators, then whether the price series is shown), then `select`, `show`,
`hide`, `lock`, `unlock`, `front`, `back`, `duplicate`, `delete`, `settings` (one drawing's own popup),
`price` (hide the candles themselves). Targets are `ids` (a comma list), or a whole `type`, or
everything (`all=true` on delete). Every op **reads the stack back** and names what did *not* take —
Vela answers several of these calls with a clean return that removes nothing, which is exactly why
guessing is not good enough. An id that is not on the chart is refused rather than ignored.

`TaVela.datawindow` is the Data window as a door: `renderer.dataWindowReadout()` — Vela's own numbers
for the bar under the cursor (or the latest bar when the cursor is off the plot), printed as Time,
Price (O/H/L/C + volume) and one section per indicator. Nothing is recomputed, and the answer says
which bar it describes.

## What was verified, and what was not

- `python3 -m unittest discover -s console/backend/tests -t console/backend/tests` → **1130 tests, OK**
  (81 skipped) in the repo's venv, including 9 new tests pinning the two doors, the bridge hand-over,
  the MCP tools, the CLI subcommands, and the reserved-`id` rule.
- The door logic was exercised against a stubbed Vela whose drawings/renderer API mirrors the bundle:
  **26/26 checks** (list, filter by type, hide/show, lock, front, duplicate-reporting, refusal of a
  missing id, delete, delete-all, the empty-stack answer, the price switch, the readout, and the
  "drawings off" / "no readout" refusals).
- The backend allow-list was read back from the **running** console after a service restart:
  `objects` and `datawindow` are accepted; `probe` on the live page is the missing piece.
- **Not yet proven end to end:** the two doors against a live Vela chart. That needs a view attached
  (the pane open) — the last mile is `chart_objects op=list` and `chart_data_window` on the real chart.

## If this is continued

Ranked by what an agent would actually use, with the honest split:

1. **Indicator Templates** — "remember these studies as `scalp`, put them back" — pure Vela plus a
   store; the plugin's `chart_snapshot`/`chart_undo` is one in-memory slot, not a named library.
2. **Watchlist** — a symbol list with categories and a "show on chart" action; the plugin has the
   market switch already, so this is a list plus `chart_set_market`.
3. **Capture area for Quant** — drag a region, hand it to the agent: closest thing in the hosted
   console to what Hermes is for. `chart_shot` plus a rect crop gets most of it.
4. **Workspaces / Journal / Pine editor** — LuxAlgo shell features with no Vela equivalent. These are
   product decisions, not door work: each needs its own store, UI and tool surface.
