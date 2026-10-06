# Plan: PineTS 0.11.0 bump + the indicator pack (A/B/D)

*6 Oct 2026 · Hermes (for Kevin) · Status: **PLAN** — executes on "go" with plan mode lifted.*

## Why the bump first

Issue `LuxAlgo/PineTS#343` (filed from this project's account, 28 Sep; blairwheadon's "+1" on
30 Sep) is fixed in **0.11.0** (released 1 Oct) for its first half: `<drawing>.all` is a real Pine
array there — `array.size(polyline.all)` / `.all.size()` work, `line.all` / `label.all` / `box.all`
behave the same. Our page vendors **0.10.0** and therefore still has the blocker. The second half
(UDT field history read, `$.get(var, 0)`) is **not** in 0.11.0 — PR #387 is still open — so
`money-flow-profile`-class crashes stay until that lands.

## Part 1 — CORRECTED: verify, do NOT swap

**The bump is already done.** `THIRD-PARTY.md` + `vendor/pinets/PROVENANCE.md`: the vendored engine
(690,220 bytes, built 2 Oct) is **upstream v0.11.0 + THREE patches** from the fork
`github.com/godzillacode0000/PineTS` @ `f5ec571` (branch `fix/p1-p8-on-0.11`) — UDT field history
reads (the PR #387 class), a walker-scope declaration fix, and a split-element identity fix.
`vela-pinets@0.2.15`'s inlined worker copy is PineTS 0.11.0 too. The old "pins 0.10.0" note is stale.

**Do not replace the vendored file with plain `pinets@0.11.0` — that would delete the three patches.**
What remains is verification, on the live page:

1. The minimal `<drawing>.all` repro (own script): must run (0.10.0 threw `i.size is not a function`).
2. The `money-flow-profile`-class UDT history read (`b.i[rpLN]`): patched here → check it runs; if it
   still crashes, check the fork for newer commits than `f5ec571` and rebuild from the fork.
3. The suite (1017) + the floor test — unchanged expectations; the live regression battery
   (Liquidity Levels, SMC `Weekly=true` = the known open crash, fvg-mitigation, Breakout Detector,
   real-MTF, saved scripts + colouring).
4. The 13-script fit-test numbers (8/13) already reflect this engine — keep them as the baseline.

Fix the stale note in the `trader-desk` skill ("the page's import map pins pinets@0.10.0") while here.

## Part 2 — the indicator pack (A + B + D)

Fit-test (done): **8/13 ran** on 0.10.0. Re-run after the bump; expect the all.* fix to move some.

**A — bundle (licences that allow it):** `openSourceFractal.pine` (MIT, ran) and
`unicorn-model.pine` (MPL-2.0, ran). `fractal-model.pine` is MPL but uses `import` → port or skip.
Every bundled file keeps its licence header; `THIRD-PARTY.md` gets a row per file.

**B — reimplement (GPL / no-licence / import-blocked):** concepts only, our own Pine for PineTS,
named `ta-<concept>.pine`: HTF levels suite (from HTF_SUITE), liquidity suite (liqSuite), fractal
model (FractalModel/FM-base), the SMT/HTF-FVG concepts. Each must pass the same fit-test.

**D — the picker:** a new group in the Indicators surface (drawer/modal) — working name
**"Extra"** — listing the bundled + reimplemented scripts, selectable like the existing rows
(`▶ Run` → PineTS via the console's own path). Design constraints from the operator: chart-first,
simple, nothing that pushes the chart; entries appear only when the file is present.

- Asset shape: `console/frontend/extra/` (scripts) + a small manifest (`extra-scripts.json`:
  slug, name, family, licence, source) served by the console; the drawer renders it like the
  favourites list.
- Tests: the manifest ↔ files match, each script parses in the engine (the battery), licence rows
  exist in THIRD-PARTY.md.

**Ownership:** I build the assets + tests + the bump. The picker UI can be mine or Claude's PR —
operator picks.

## Order of work

1. Part 1 (the bump) — then re-run the 13-script fit-test.
2. A (bundle 2) → B (reimplement, concept by concept) → D (the picker + manifest + tests).
3. Report per step with numbers; the earlier audit Phase B stays paused until then.
