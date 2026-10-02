# Vendored engine: pinets

Where this file came from, so the AGPL obligations are answerable without guesswork.

| | |
|---|---|
| Engine | `pinets` (PineTS) |
| Version | **0.11.0** — the fork build: upstream `v0.11.0` (`c5e6b0e`) plus three patches; the previous build was of 0.10.0, the version the import map used to serve from jsDelivr |
| Licence | **AGPL-3.0-only** — full text in `LICENSE` beside this file |
| Source | <https://github.com/godzillacode0000/PineTS> — fork of <https://github.com/LuxAlgo/PineTS> |
| Built from | commit `f5ec571` (branch `fix/p1-p8-on-0.11`), 2026-10-02 |
| Modifications | **three patches**, on top of upstream v0.11.0. (1) UDT field history reads (`b.c[N]`): the lookback index is scoped like any other index (it was emitted bare and died with `ReferenceError: name is not defined`), and a `var` instance reads the FIELD's history (the object is created once, so `$.get(b, N).field` returned today's value — silently wrong); tests `tests/transpiler/udt-field-history.test.ts`, 3 of 4 fail without it. (2) a declaration reached by a walker keeps its scope and store: the AnalysisPass splits a tuple destructuring (`[x, y] = f()`) into per-element declarations and wraps them in a block of its own, and a switch arm's statements are reached by a WALKER (the implicit return's, or the declaration-init's when the switch is a destructuring value) that visited identifiers and calls but never a VariableDeclaration — the split declarations kept a plain JS `let` inside the block while their readers resolved through the context store (`ReferenceError: x is not defined` in volume-bubbles-liquidity-heatmap); both walkers now route such a declaration to `transformVariableDeclaration`; `tests/transpiler/tuple-in-switch-arm.test.ts` (4 cases, both walkers). (3) a split element is identified by the NODE the split built, not by its name: the program-wide `isArrayPatternElement` name set (plus a shape heuristic) also matched a user's own local that merely shared a name with a tuple element, and `close[1]` in a declaration IS a computed member expression — so `p = close[1]` in a switch arm came out as `$.get($.let.close, 0)[1]`, a tuple read of the wrong store, and threw `TypeError: Cannot read properties of undefined (reading '1')`. The split now marks its declarators (`_arrayPatternSplit`) and the walkers additionally route a declaration that REASSIGNS a name the context already knows (an arm's `p = 10` must land in the outer store) while a fresh IIFE local stays plain; `tests/transpiler/tuple-element-name-collision.test.ts` (4 cases, 2 fail without it). The five other classes the previous build patched (`.all` arrays, comparison operand chains, UDT name shadows, implicit-return member bases, index-and-call operands) are fixed in upstream v0.11.0 itself — the earlier revision of this file in the repo's history carries their texts. |
| File | `pinets.min.browser.es.js`, 690,220 bytes, sha256 `eb1df2646ea42fb7c3…` |
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
worker carries an engine copy inlined into vela-pinets' dist (PineTS 0.11.0 as of vela-pinets 0.2.15 —
unpatched, but on the current line), which is why it is not the default (the audit's #17). The console reports the class it actually registered — the heartbeat's `diag.engine`.

To rebuild after changing the fork:

```bash
git clone git@github.com:godzillacode0000/PineTS.git
cd PineTS && npm ci && npm run build:prod:browser-es
cp dist/pinets.min.browser.es.js <this directory>/
```

The patches this file carries are PUBLISHED: every commit lives on the fork's branch
`fix/p1-p8-on-0.11` (<https://github.com/godzillacode0000/PineTS/tree/fix/p1-p8-on-0.11>) —
`56f6d3a` (UDT field history), `2b5ff18` (a walker-reached declaration), `e705e12` (a split element
identified by node, not name), `f5ec571` (the docs). The fixes with upstream interest were also
submitted as PRs to LuxAlgo/PineTS: `#387` (UDT field history) and `#386` (split element / walker
declarations), open on 2 Oct. The older `fix/scope-collision` branch remains as history — which is
what the AGPL asks for
(the changes visible to whoever receives this distribution). A future patch must be pushed BEFORE a
bundle carrying it ships, and noted in `THIRD-PARTY.md`.
