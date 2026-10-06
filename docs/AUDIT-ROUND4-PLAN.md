# AUDIT ROUND 4 — plan: PineTS engine + Vela chart integration

*6 Oct 2026 · Hermes (for Kevin) · Status: **PLAN** — execution starts on "go" with plan mode lifted.*

## 0. The CUA question — answered, measured (6 Oct, cua-driver 0.28.2)

CUA **cannot drive this audit's input**: `ax_capability` fails (*"X11 is not reachable; UI inspection
and event injection will fail"*), `experimental_pip: false` (the Hyprland input plugin is off; a
hand-built one is unsafe unattended), the MCP env lacks `WAYLAND_DISPLAY`, and the CLI (0.21.0) no
longer speaks to the daemon (0.28.2): `list_windows` → *"contract version 0.8.0 does not match SDK
0.7.0"*. CUA's browser subset (DevTools) exists but is redundant with `browser_exec`.

**Verdict:** CUA = capture/discovery only here; the audit runs on the stack that has been proven all
week: **ydotool real input + wtype + tmpeval DOM probes + grim/vision + the CLI/MCP tools + the suite.**

## 1. Scope

- **IN:** the console (Trader's Agent plugin) as run in the Hermes desktop app — Vela's chart and its
  top row, drawers/sheets, replay strip, Edge Stats, the PineTS script path (editor, apply/draw,
  inputs), the console's own chrome (statusbar, toasts, banners).
- **OUT:** watchlist + agent log (operator skipped), real-money broker, the DSH fork, Vela internals
  beyond integration defects.

## 2. Defect candidates already on record (each to reproduce or clear)

| # | candidate | evidence so far |
|---|---|---|
| 1 | **Click-eater class**: a top-row rebuild between mousedown and mouseup fires NO click ("bukan 1 click, kena click 2 kali"). The replay path was guarded; other refresh paths are unknown. | `references/vela-topbar-row.md` (measured: 46 rebuilds / 460 swaps in 6 s of playback; one-click drawer 4/6 during playback vs 6/6 quiet) |
| 2 | **Edge-Stats header buttons (✕/Back/Data) + topbar Indicators vs REAL mouse** — earlier suspicion (hitbox/z-index); a 4 Oct real-click sweep said functional. | earlier session notes; never diagnosed |
| 3 | **Engine OOB**: Liquidity Levels + `length=50` → *"Index out of bounds"* — valid script, valid input. | PR #6 verification, reproducible |
| 4 | **Overflow = unclickable**: Vela's row is `overflow: visible`, so a button past its right edge cannot be hit (`elementFromPoint` misses). | `references/vela-topbar-row.md` |
| 5 | **Silent JS errors**: never captured systematically. | dogfood skill: the highest-value class |

## 3. Untested surface inventory (the audit's core)

- **Top row:** symbol search · every timeframe button · style · layout · indicators (done) · actions ·
  undo/redo · alerts · panels · screenshot · `⋯` menu (done) · replay (done).
- **Chart:** left drawing rail (cursor / trend / brush / text / flag / ruler / trash) · right-click
  context menu · magnet + crosshair toggles · drawing edit/delete flow · fullscreen · settings gear ·
  range buttons (1D…ALL) · axis/price interactions.
- **Drawers & sheets:** Library (list + apply) · concept popover · detail pane · Edge Stats (re-test) ·
  Script pane (heavily done) · data window / objects dock.
- **Engine matrix (fast, via CLI/MCP):** input bounds (min/max/step, mistyped, did-you-mean) ·
  lookback > bars · MTF (D / 240 / …) · type edges (color/bool/options/source/time) · plot vs geometry ·
  label/table counts · 439-line script (256 ms, done) · >300k fallback (done).
- **Console:** statusbar / toast / activity line (done 6 Oct) · stale-legend banner · JS console.

## 4. Method & tooling

- **Real input:** `ydotool click -D <ms> 0xC0` (screen = input × 2) + `wtype`; real-click probes
  (`__lastMove`/`__lastClick`) and the calibration rule live in the `trader-desk` skill — recalibrate
  per window position; verdicts on geometry only from full-res crops, never downscaled vision.
- **DOM/state:** the durable tmpeval hook (`traders-agent-console-ui` → `scripts/hook_on.py` install;
  `tools/sync-live.sh` removes it) + `scripts/ev2.py` probes; a probe whose awaits outrun `wait` →
  poll `GET /api/chart/result?id=<id>`.
- **Error capture:** with the hook installed, register `window.addEventListener('error' /
  'unhandledrejection')` into `window.__errs` at the start of each phase; read + clear per phase;
  every finding carries its stack.
- **Engine:** `trader-chart` CLI + the `traders-chart` MCP tools; the 1007-test suite = the
  regression baseline (any fix must keep it green).
- **Report shape:** the `dogfood` skill's taxonomy (severity: critical/high/medium/low; category:
  functional/visual/a11y/console/UX) + its template, adapted (no browser toolset; `browser_exec`
  optional for a clean-room view of 127.0.0.1:8787).

## 5. Phases (each ends with evidence and a stop point)

- **A — errors + hitbox (cheap).** Hook in + collector on; one normal-use pass over everything
  (open/close each surface once) → list every JS error; re-test the header buttons with real clicks,
  quiet **and** during replay (candidate 1/2); measure the top row's overflow (candidate 4).
- **B — real-input sweep.** Every §3 control with ydotool; per control: expected vs actual + a grim;
  dead/overlapping controls documented.
- **C — engine edge-matrix.** §3's engine list via CLI/MCP; one results row per case (pass/fail +
  repro + the engine's own error text); minimize candidate 3.
- **D — report + fixes.** `docs/AUDIT-ROUND4-REPORT.md`: per-issue severity/category/repro/evidence
  (+ MEDIA stills), split into **(a) ours to fix** and **(b) engine/upstream (PineTS/Vela)** with a
  proposed fix or an honest "not ours".

## 6. Exit criteria

- Every §3 control exercised at least once with real input, or explicitly marked untestable + why.
- Every §2 candidate reproduced or cleared, with evidence.
- The report exists with severity counts; zero unverified claims (a number or a still per finding).

## 7. Risks & limits

- The app must stay usable for the operator — short batches; no destructive clears without asking.
- ydotool calibration drifts when the window moves → recalibrate before each click batch.
- Vela is minified; some defects will classify "upstream, not ours" (licence rule: test-only, never
  copy AGPL; Vela vendored as-is).
- Timebox: A+B ≈ 1–2 sessions, C ≈ 1, D = the report.
