# Vendored engine: pinets

Where this file came from, so the AGPL obligations are answerable without guesswork.

| | |
|---|---|
| Engine | `pinets` (PineTS) |
| Version | **0.12.0** — the fork build: upstream `v0.12.0` (`3dde7eb`) plus three patches; the previous build was of 0.11.0 (and before that 0.10.0, the version the import map used to serve from jsDelivr). 0.12.0 is LuxAlgo's rebuilt **intrabar broker emulator**: fills/exits resolved inside the bar, commission + slippage + margin, trailing stops, and `setFillsOnTickGrid()` for TradingView's tick-snapped broker prices |
| Licence | **AGPL-3.0-only** — full text in `LICENSE` beside this file |
| Source | <https://github.com/godzillacode0000/PineTS> — fork of <https://github.com/LuxAlgo/PineTS> |
| Built from | commit `ea8562a` (branch `fix/p1-p8-on-0.12`), 2026-10-20 — upstream `v0.12.0` plus `38aef6b` (UDT field history), `d801007` (walker-reached declaration), `ea8562a` (split element by node) |
| Modifications | **three patches**, on top of upstream v0.12.0 (rebased 20 Oct: upstream extracted the declaration-init walker into `walkInitExpression`, so patch 2's visitor now lives there — the old inline block patch 2 edited no longer exists; `tests/transpiler/{udt-field-history,tuple-element-name-collision,implicit-return-member-base,index-and-call-operands,comparison-member-chain}.test.ts` pass on the rebase, and the suite's 16 pre-existing failures are identical on stock `v0.12.0`). (1) UDT field history reads (`b.c[N]`): the lookback index is scoped like any other index (it was emitted bare and died with `ReferenceError: name is not defined`), and a `var` instance reads the FIELD's history (the object is created once, so `$.get(b, N).field` returned today's value — silently wrong); tests `tests/transpiler/udt-field-history.test.ts`, 3 of 4 fail without it. (2) a declaration reached by a walker keeps its scope and store: the AnalysisPass splits a tuple destructuring (`[x, y] = f()`) into per-element declarations and wraps them in a block of its own, and a switch arm's statements are reached by a WALKER (the implicit return's, or the declaration-init's when the switch is a destructuring value) that visited identifiers and calls but never a VariableDeclaration — the split declarations kept a plain JS `let` inside the block while their readers resolved through the context store (`ReferenceError: x is not defined` in volume-bubbles-liquidity-heatmap); both walkers now route such a declaration to `transformVariableDeclaration`; `tests/transpiler/tuple-in-switch-arm.test.ts` (4 cases, both walkers). (3) a split element is identified by the NODE the split built, not by its name: the program-wide `isArrayPatternElement` name set (plus a shape heuristic) also matched a user's own local that merely shared a name with a tuple element, and `close[1]` in a declaration IS a computed member expression — so `p = close[1]` in a switch arm came out as `$.get($.let.close, 0)[1]`, a tuple read of the wrong store, and threw `TypeError: Cannot read properties of undefined (reading '1')`. The split now marks its declarators (`_arrayPatternSplit`) and the walkers additionally route a declaration that REASSIGNS a name the context already knows (an arm's `p = 10` must land in the outer store) while a fresh IIFE local stays plain; `tests/transpiler/tuple-element-name-collision.test.ts` (4 cases, 2 fail without it). The five other classes the previous build patched (`.all` arrays, comparison operand chains, UDT name shadows, implicit-return member bases, index-and-call operands) are fixed in upstream v0.11.0 itself — the earlier revision of this file in the repo's history carries their texts. |
| File | `pinets.min.browser.es.js`, 770,661 bytes, sha256 `50c8ca8eb7a44610cd0b6ba7…` |
| Built with | `npm ci && npm run build:prod:browser-es` (rollup browser-ES bundle) |

Why it is here: the console's import map (`console/frontend/index.html`) serves `pinets` from this file
instead of a CDN URL, so the engine is pinned in the repository, works offline, and can carry fixes.
See `THIRD-PARTY.md` for what redistributing it means for the combined work.

Which class runs these patches: **`PineEngine`** (main thread) — the workspace registers it for the
cell, and its module does `import { PineTS } from 'pinets'`, which the page's import map resolves to
this file. That class runs on the page's main thread: a heavy script blocks the heartbeat and the
command bridge for its whole run, and nothing can interrupt it (the coverage doc measured a 20 s run
that ticked a 250 ms timer zero times, and a 301 s worst case). So the engine is a choice —
`?engine=worker` on the console URL, or localStorage `luxalgo-web:pine-engine` = `worker`, switches to
vela-pinets' `PineWorkerEngine` for an off-thread run. That class is NOT covered by these patches: its
worker carries an engine copy inlined into vela-pinets' dist (PineTS 0.12.0 as of vela-pinets 0.2.17 —
unpatched, but on the current line), which is why it is not the default (the audit's #17). The console reports the class it actually registered — the heartbeat's `diag.engine`.

To rebuild after changing the fork:

```bash
git clone git@github.com:godzillacode0000/PineTS.git
cd PineTS && npm ci && npm run build:prod:browser-es
cp dist/pinets.min.browser.es.js <this directory>/
```

The patches this file carries are PUBLISHED: every commit lives on the fork's branch
`fix/p1-p8-on-0.12` (<https://github.com/godzillacode0000/PineTS/tree/fix/p1-p8-on-0.12>) —
`38aef6b` (UDT field history), `d801007` (a walker-reached declaration), `ea8562a` (a split element
identified by node, not name). The 0.11-line branch `fix/p1-p8-on-0.11` remains as history. The fixes with upstream interest were also
submitted as PRs to LuxAlgo/PineTS: `#387` (UDT field history) and `#386` (split element / walker
declarations), open on 2 Oct. The older `fix/scope-collision` branch remains as history — which is
what the AGPL asks for
(the changes visible to whoever receives this distribution). A future patch must be pushed BEFORE a
bundle carrying it ships, and noted in `THIRD-PARTY.md`.
