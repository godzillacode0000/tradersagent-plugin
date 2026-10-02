# Vendored engine: pinets

Where this file came from, so the AGPL obligations are answerable without guesswork.

| | |
|---|---|
| Engine | `pinets` (PineTS) |
| Version | **0.10.0** — the same version the import map used to serve from jsDelivr (`pinets@0.10.0`) |
| Licence | **AGPL-3.0-only** — full text in `LICENSE` beside this file |
| Source | <https://github.com/godzillacode0000/PineTS> — fork of <https://github.com/LuxAlgo/PineTS> |
| Built from | commit `ba5aa4c` (branch `fix/scope-collision`), 2026-10-01 |
| Modifications | **eight patches**, on top of upstream 0.10.0. (1) UDT field history reads (`b.c[N]`): the lookback index is scoped like any other index (it was emitted bare and died with `ReferenceError: name is not defined`), and a `var` instance reads the FIELD's history (the object is created once, so `$.get(b, N).field` returned today's value — silently wrong); tests `tests/transpiler/udt-field-history.test.ts`, 3 of 4 fail without it. (2) `<drawing>.all` is a Pine array again: a new `DrawingArray` (an Array subclass that also carries the Pine array surface and `array` = itself) plus `Series.from`/`Context.init` keeping the array whole instead of storing its last element; tests `tests/namespaces/drawing-array.test.ts`. (3) a comparison operand's member chain is scoped: `transformExpression`'s MemberExpression visitor now recurses into member/call objects, so `if pivot == get_v.get(1).y` no longer emits `get_v` bare (`ReferenceError`); tests `tests/transpiler/comparison-member-chain.test.ts`. (4) a UDT whose name a variable shares (`type fib` + `var fib fib = …`) no longer emits two declarations of one identifier: the TYPE moves to `fib_$T<n>` and only type references (annotations, `X.new(…)`) follow it; tests `tests/transpiler/udt-name-shadow.test.ts`. (5) a member chain's BASE is scoped in implicit returns: two walkers (a method's implicit return — where a `switch` lives and its arm tests are comparisons full of member chains — and a returned tuple like `[lastBar.buy, lastBar.sell]`) called `transformMemberExpression` and never recursed into the object, so a non-computed field read kept a bare base identifier (`ReferenceError: MSS is not defined`) while the call chains beside it were scoped; `tests/transpiler/implicit-return-member-base.test.ts` (4 cases). (6) two operands no walker descended into — the INDEX of a history read when it is itself a read (`high[nId[1]]`, `ReferenceError: bsNOTbodyUP is not defined` in ict-concepts) and the arguments of a call that is the OBJECT of a member chain (`array.first(timeCycles).firstBarIndex`, `ReferenceError: timeCycles is not defined` in ichimoku-theories); `transformIndexExpression` lowers a member/call index and the operand path transforms a CallExpression object; `tests/transpiler/index-and-call-operands.test.ts` (4 cases). (7) a declaration reached by a walker keeps its scope and store: the AnalysisPass splits a tuple destructuring (`[x, y] = f()`) into `let temp_N …; let x …; let y …` and wraps them in a block of its own, and a switch arm's statements are reached by a WALKER (the implicit return's, or the declaration-init's when the switch is a destructuring value) that visited identifiers and calls but never a VariableDeclaration — so the split declarations kept a plain JS `let` inside a block while their readers resolved through the context store (`ReferenceError: x is not defined` in volume-bubbles-liquidity-heatmap). Both walkers now route a declaration to `transformVariableDeclaration`; `tests/transpiler/tuple-in-switch-arm.test.ts` (4 cases, both walkers). (8) a split element is identified by the NODE the split built, not by its name: the program-wide `isArrayPatternElement` name set (plus a shape heuristic) also matched a user's own local that merely shared a name with a tuple element, and `close[1]` in a declaration IS a computed member expression — so `p = close[1]` in a switch arm came out as `$.get($.let.close, 0)[1]`, a tuple read of the wrong store, and threw `TypeError: Cannot read properties of undefined (reading '1')`. The split now marks its declarators (`_arrayPatternSplit`) and the walkers additionally route a declaration that REASSIGNS a name the context already knows (an arm's `p = 10` must land in the outer store) while a fresh IIFE local stays plain; `tests/transpiler/tuple-element-name-collision.test.ts` (4 cases, 2 fail without it). |
| File | `pinets.min.browser.es.js`, 658,900 bytes, sha256 `d2774eee2ef7fb8b3e83…` |
| Built with | `npm ci && npm run build:prod:browser-es` (rollup browser-ES bundle) |

Why it is here: the console's import map (`console/frontend/index.html`) serves `pinets` from this file
instead of a CDN URL, so the engine is pinned in the repository, works offline, and can carry fixes.
See `THIRD-PARTY.md` for what redistributing it means for the combined work.

Which class runs these patches: **`PineEngine`** (main thread) — the workspace registers it for the
cell, and its module does `import { PineTS } from 'pinets'`, which the page's import map resolves to
this file. vela-pinets' `PineWorkerEngine` is NOT covered: that class's worker carries an engine copy
inlined into vela-pinets' dist, which is why the console does not register it (the audit's #17). The
console reports the class it actually registered — the heartbeat's `diag.engine`.

To rebuild after changing the fork:

```bash
git clone git@github.com:godzillacode0000/PineTS.git
cd PineTS && npm ci && npm run build:prod:browser-es
cp dist/pinets.min.browser.es.js <this directory>/
```

The patches this file carries are PUBLISHED: every commit lives on the fork's branch
`fix/scope-collision` (<https://github.com/godzillacode0000/PineTS/tree/fix/scope-collision>) —
`30a75fd` (UDT field history), `493a8ea` (`<drawing>.all`), `94d13ec` (comparison operand),
`3c35b0f` (UDT name shadow), `222c278` (implicit returns), `922eb5b` (its regression guard),
`e9671d0` (index-and-call operands), `eb5162e` (a declaration reached by a walker) with its regression
guards `073fbaa` (only the tuple split takes the standard lowering) and `ba5aa4c` (a split element is
identified by node, not name), plus `b001bed` (the hand descent) — which is what the
AGPL asks for
(the changes visible to whoever receives this distribution). A future patch must be pushed BEFORE a
bundle carrying it ships, and noted in `THIRD-PARTY.md`.
