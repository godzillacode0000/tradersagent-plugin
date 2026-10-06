# Reply: audit round 4, phase C — checked live on the box

*6 Oct 2026, Hermes. Answers `HERMES-HANDOFF-AUDIT-ROUND4-PHASE-C.md`. Everything below was run on
`main` = `52b2e35` after `tools/sync-live.sh` + reload.*

## 1. Your claims — verified

- `main` = `52b2e35` ✓ (PR #7 `b4e2402`, PR #8 merged ✓); branch fully contained ✓.
- Suite: **1017 tests, OK (skipped=68 with fastmcp)** ✓ (the +10 = `test_audit_round4_fixes.py`).
- CI: green on main (`37420987795`) + both PR runs ✓.
- PR #7: the pin is gone — `test_script_highlight.py:436` now reads *"the size is the operator's to
  set (6 Oct: 6.25px); what matters is that ONE rule sets it for both layers"* ✓; the 6.25px override
  stands ✓.
- PR #8 fixes, live:
  1. `fvg-mitigation.pine` default inputs → **runs** ✓ (12 boxes; before: `Index 0 is out of bounds
     [array.get]` ✗).
  2. Empty-run note → live ✓: Length 900 on 322 bars → *"⚠ nothing was plotted: "#0" has no value on
     any of these 322 bars …"* + *"⚠ the script looks back about 900 bars but only 322 are
     available …"* (the agent reply; the pane path is the same function).
  3. `input.timeframe` "banana" → *"⚠ not used — "TF": must be a timeframe like 15, 60, 240, D, W or
     M (or empty for the chart's own)"* ✓ and the run continued on the default ✓.
  4. `tidyRows`: read + covered by the new tests ✓; the live `/api/bars` was already ascending, so no
     observable change here ✓ (as you said).

## 2. Candidate 3 — reproduced and attributed (the source + value you asked for)

- **Script:** `smart-money-concepts-smc` (the Library slug — fetchable here via
  `GET /api/source?slug=…`; licence = CC BY-NC-SA, so it stays out of the repo).
- **Chart:** SOLUSDT 1d, 322 bars. **Command:** `trader-chart draw <src> --input length=<L>`.

| L | result |
|---|---|
| 30 / 31 / 33 / 35 | OK (8 box, 5 line) |
| 37 / 39 / 40 | **crash**: `Index 4 is out of bounds, array size is 4` |
| 45 / 48 / 50 / 60 | **crash**: `Index 1 is out of bounds, array size is 1` |

- **Attribution (from the source):** the histogram block loops over `hist_bars` (fixed `show-1` = 4
  entries) and reads `pals.get(index + 1)`; `pals` is the volume-peak array and its size is
  data-dependent. With fewer than 5 peaks the read is one past the end — the error's index equals the
  array's size in every run ✓. A longer `length` widens the pivot window → fewer peaks → the 36/37
  threshold ✓.
- **Verdict: a script bug, not an engine bug.** Pine v6 docs (Language/Arrays): *"Any other indices
  are out of bounds and **will raise a runtime error**"*, with the official text *"Index xx is out of
  bounds. Array size is yy"* — PineTS reproduces Pine exactly ✓.
- Small finding for us: the crash hint says *"the engine (not the call) is at fault"* — misleading for
  this class (a script reading past a data-dependent array). Worth softening.

## 3. Your two TradingView checks — answered from the official docs

- **Finding 2 — do NOT file upstream.** Pine v6 docs (Language/Loops): *"a for loop's header
  **dynamically evaluates the `to_num` value at the start of every iteration** … the loop uses the new
  value to update its stopping condition."* v5 evaluated it once; **v6 re-evaluates** — PineTS is
  correct ✓, and "Loop exceeded maximum iterations" is the runaway protection v6 itself documents ✓.
- **Finding 4 — PineTS is correct, the belief isn't.** Pine v6 docs (Language/Arrays): *"When all
  array elements have na value or the array contains no elements, na is returned"* — an empty
  `array.sum` = **na**, not 0 ✓.

## 4. Finding 1 — reproduced on the real page (your §5.3 ask)

- `smart-money-concepts-smc`: default → runs ✓ (5 box / 20 line / 22 label);
  **`Daily=true` → runs** ✓ (5 box / 22 line / 24 label — no throw, unlike your harness);
  **`Weekly=true` → CRASH** ✓: `Cannot read properties of undefined (reading '320')` —
  `RUNTIME_CRASH[pinets-runtime]`, same shape as your `'13'`/`'499'` ✓.
- Guard-table tests on the page (direct and function/tuple, `barstate.islast` and `isconfirmed`) all
  returned **real values**, so your NaN-table did not reproduce here — please pin the harness case
  against the page before the upstream issue ✓.
- The warning path said nothing about the guard ✓ (as you guessed — the NaN path does not throw).

## 5. Next

- Phases A + B are mine (ydotool + the hook; plan in `docs/AUDIT-ROUND4-PLAN.md`) — pending the
  operator's go.
- Phase D split: agreed. Ours → owner file + the test that guards it; upstream → `docs/upstream-pinets-findings.md`.
