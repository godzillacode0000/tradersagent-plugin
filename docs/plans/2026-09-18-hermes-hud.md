# Plan — Hermes HUD mode on the Vela chart

*Status: proposed, 18 Sep 2026. Base: `tradersagent-plugin` @ the commit that removed the docked pane
(`8d55b38`). Nothing here is built yet.*

## What he asked for

> "Add Hermes Own HUD mode on the Vela chart — a floating mode that can read and understand what it
> sees on the chart… like **really read**."

So: a floating panel over the chart, in Hermes's own voice, whose readings come from the chart's real
data — not a decoration that prints a price. "Really read" is the whole requirement; everything below
is in service of that phrase.

## What "read" honestly means — four tiers

| Tier | Source | Gives | Cost | Status |
|---|---|---|---|---|
| **0 — exact state** | `window.chartBars()`, `getVisibleRange()`, `presentNativeIndicators()`, `info.totals` | symbol, tf, last, bar count, visible window, mounted indicators, drawing count | ~0 | **exists** (bridge heartbeat + `chart_state`) |
| **1 — computed facts from bars** | the real OHLCV the page already holds | swing structure, range, ATR, EMA stack, RSI/MACD, volume z, distance-to-level, regime, squeeze/expansion | ~5-30 ms, deterministic | **new** — `eye.py` |
| **2 — what else is on the chart** | Vela's drawing/series objects if exposed; else the shot | the lines/zones/boxes he drew, the studies mounted | ~0 if exposed | **new**, fallback = Tier 3 |
| **3 — vision** | `chart_shot` → PNG → a model that sees it | holistic pattern/structure reading, things our math did not anticipate, his own drawings | seconds + tokens | **new** — on demand only |
| **4 — the agent that talks** | `/api/chat` (study `desk`, resumable session) | the HUD's commentary and answers, with the chart state (and optionally the image) in context; can answer with `CHART:` directives | seconds, hard timeout already in place | **exists** (`chat.py`) |

The HUD is the *mouth and hands*; tiers 0-3 are its *eyes*. Design rule: **the panel states facts it
can prove from bars, and attributes anything else to the vision pass.** No invented levels.

## Architecture

```
Vela chart (page) ──► window.chartBars()  ─┐
                    getVisibleRange()      │  bars + view (already in the page)
                    presentNativeIndicators┘
                            │
                POST /api/eye/read  {bars, view, indicators}      ← reader runs where the tests are
                            │
                     backend/eye.py        → facts + sentences (Tier 1)
                            │
        ┌───────────────────┼───────────────────────┐
        │                   │                       │
  frontend/hud.js     overlay.js              /api/chat (study)
  floating panel      draw the read back      Hermes commentary
  (Tier 0 + 1 + 3)    (levels, box, labels)   (Tier 4, resumable)
        │                                           │
        └──────── MCP tools: chart_read · chart_look · chart_annotate · hud_set ────────┘
```

**Why the reader lives in the backend** (`console/backend/eye.py`): the page has the bars for free and
posts them; the maths runs in Python where `console/backend/tests/` already lives, so every reading is
a unit test with fixture bars instead of a thing we eyeball.

**Why the annotation layer is `overlay.js`**: it already maps price↔pixels against the price pane's
own rect and verifies its top/bottom against the chart's last-price line. Drawing the read back is a
few calls, not a new subsystem.

## The HUD itself (P1 surface)

- Floating glass panel, default **right-of-chart, below the top bar** — never over the price scale or
  the last-price badge. Draggable, collapsible to an amber pill, position persisted per symbol.
- Header: `Hermes HUD` · mode chip (`Facts · Read · Ask`) · freshness stamp · collapse.
- Body: a dense mono **metric strip** (like the existing status pills), then the **reading** block
  (2-4 plain sentences), then an **ask** box wired to the study.
- Footer: `read 3 s ago · 500 bars · 1h · desk` + a `Look` button (Tier 3) + `Draw it` (P4).
- Perf, deliberately: **no `backdrop-filter`** (GPU cost on this i5/8GB), no per-frame recompute —
  the read refreshes on bar close, on demand, or when an agent asks.
- Design references: `inspo` returned a thin corpus for in-app HUDs (it is a website archive), so the
  named anchor is the dark warm fintech stat block (turnoev.com) plus our own tokens
  (`--lx-accent` amber, mono numerals). A short component study happens in P1, not now.

## Phases — each shippable and verifiable on its own

| # | Ships | How I verify | Est. |
|---|---|---|---|
| **P1** | HUD shell: floating panel, toggle (top-bar button + palette + status-bar chip), drag/collapse/persist, showing Tier-0 state only | DOM + screenshots in the browser harness at the plugin pane's width; reload → position persists; one-view rule intact | 1 session |
| **P2** | The reader: `eye.py` + `POST /api/eye/read` + `/api/eye/readings`; HUD Facts strip + Read block | unit tests on fixture bars (determinism: same bars → same read; known cases: ATR, swing, range, trend); measured read < 30 ms | 1-2 sessions |
| **P3** | Hermes voice: ask box → `/api/chat` (study `desk`) with the read as context; answers land in the reading block; `hud_set` MCP tool | real prompts against the live study; timeout + failure copy tested; latency measured (CLI call) | 1 session |
| **P4** | Draw-back: annotations via `overlay.js` (range box, swing labels, levels, the read as a small table); `chart_annotate` tool | visual check at 3 zoom levels; the existing price↔pixel verification must still pass | 1-2 sessions |
| **P5** | Vision `Look`: `chart_shot` → vision → paragraph with an explicit "what I might be wrong about"; `chart_look` tool | one real look on a live chart, latency + token cost measured and reported | 1 session |
| **P6** | Packaging: `chart_read` tool naming, README/CHANGELOG, tests in CI, tag **v1.2.0** | harness + CI green; tag pushed | 1 session |

## Honestly, the limits

- **Vision is not free.** A look is a model call: seconds and tokens. It stays a button, never an
  automatic refresh — otherwise this box spends the day looking at candles.
- **Vela's API is unofficial and pinned** (vela 0.7.3, vela-pinets 0.2.12). Drawing objects may simply
  not be exposed (we know `drawings` as a *count* today). Then Tier 2 degrades to vision, and the plan
  says so instead of pretending.
- **PineTS subset still applies** to anything the HUD *runs*: no `import`, `while`, `for…in`.
- **One view.** The HUD lives inside the same console page — it does not open a second frame, so chart
  commands never double-execute.
- **Reads are observations, not signals.** The panel must never phrase a reading as a trade call
  (this is the desk's own rule: charts are not financial advice).

## Decisions I need from him

1. **Default visibility** — hidden until asked (a small `HUD` toggle / amber pill), or always on?
   (Recommendation: hidden until asked; auto-opens when a read lands.)
2. **Auto-refresh** — read on every bar close, or only when he presses/asks? (Recommendation: on
   demand + on bar close only while the HUD is open.)
3. **First slice** — start with P1+P2 (panel + facts, no model calls), or jump to P3 so it *talks*
   immediately on top of Tier-0 state?
