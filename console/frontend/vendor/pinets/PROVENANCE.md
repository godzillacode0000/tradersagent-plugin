# Vendored engine: pinets

Where this file came from, so the AGPL obligations are answerable without guesswork.

| | |
|---|---|
| Engine | `pinets` (PineTS) |
| Version | **0.10.0** — the same version the import map used to serve from jsDelivr (`pinets@0.10.0`) |
| Licence | **AGPL-3.0-only** — full text in `LICENSE` beside this file |
| Source | <https://github.com/godzillacode0000/PineTS> — fork of <https://github.com/LuxAlgo/PineTS> |
| Built from | commit `922eb5b` (branch `fix/scope-collision`), 2026-10-01 |
| Modifications | **five patches**, on top of upstream 0.10.0. (1) UDT field history reads (`b.c[N]`): the lookback index is scoped like any other index (it was emitted bare and died with `ReferenceError: name is not defined`), and a `var` instance reads the FIELD's history (the object is created once, so `$.get(b, N).field` returned today's value — silently wrong); tests `tests/transpiler/udt-field-history.test.ts`, 3 of 4 fail without it. (2) `<drawing>.all` is a Pine array again: a new `DrawingArray` (an Array subclass that also carries the Pine array surface and `array` = itself) plus `Series.from`/`Context.init` keeping the array whole instead of storing its last element; tests `tests/namespaces/drawing-array.test.ts`. (3) a comparison operand's member chain is scoped: `transformExpression`'s MemberExpression visitor now recurses into member/call objects, so `if pivot == get_v.get(1).y` no longer emits `get_v` bare (`ReferenceError`); tests `tests/transpiler/comparison-member-chain.test.ts`. (4) a UDT whose name a variable shares (`type fib` + `var fib fib = …`) no longer emits two declarations of one identifier: the TYPE moves to `fib_$T<n>` and only type references (annotations, `X.new(…)`) follow it; tests `tests/transpiler/udt-name-shadow.test.ts`. (5) a member chain's BASE is scoped in implicit returns: two walkers (a method's implicit return — where a `switch` lives and its arm tests are comparisons full of member chains — and a returned tuple like `[lastBar.buy, lastBar.sell]`) called `transformMemberExpression` and never recursed into the object, so a non-computed field read kept a bare base identifier (`ReferenceError: MSS is not defined`) while the call chains beside it were scoped; `tests/transpiler/implicit-return-member-base.test.ts` (4 cases). |
| File | `pinets.min.browser.es.js`, 657,103 bytes, sha256 `4c05e6fec1e2d7e1…` |
| Built with | `npm ci && npm run build:prod:browser-es` (rollup browser-ES bundle) |

Why it is here: the console's import map (`console/frontend/index.html`) serves `pinets` from this file
instead of a CDN URL, so the engine is pinned in the repository, works offline, and can carry fixes.
See `THIRD-PARTY.md` for what redistributing it means for the combined work.

To rebuild after changing the fork:

```bash
git clone git@github.com:godzillacode0000/PineTS.git
cd PineTS && npm ci && npm run build:prod:browser-es
cp dist/pinets.min.browser.es.js <this directory>/
```

The patches this file carries are PUBLISHED: every commit lives on the fork's branch
`fix/scope-collision` (<https://github.com/godzillacode0000/PineTS/tree/fix/scope-collision>) —
`30a75fd` (UDT field history), `493a8ea` (`<drawing>.all`), `94d13ec` (comparison operand),
`3c35b0f` (UDT name shadow), `222c278` (implicit returns), `922eb5b` (its regression guard) — which is
what the AGPL asks for
(the changes visible to whoever receives this distribution). A future patch must be pushed BEFORE a
bundle carrying it ships, and noted in `THIRD-PARTY.md`.
