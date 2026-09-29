# Vendored engine: pinets

Where this file came from, so the AGPL obligations are answerable without guesswork.

| | |
|---|---|
| Engine | `pinets` (PineTS) |
| Version | **0.10.0** — the same version the import map used to serve from jsDelivr (`pinets@0.10.0`) |
| Licence | **AGPL-3.0-only** — full text in `LICENSE` beside this file |
| Source | <https://github.com/godzillacode0000/PineTS> — fork of <https://github.com/LuxAlgo/PineTS> |
| Built from | commit `94d13ec` (branch `fix/scope-collision`), 2026-09-29 |
| Modifications | **two patches**, on top of upstream 0.10.0. (1) UDT field history reads (`b.c[N]`): the lookback index is scoped like any other index (it was emitted bare and died with `ReferenceError: name is not defined`), and a `var` instance reads the FIELD's history (the object is created once, so `$.get(b, N).field` returned today's value — silently wrong); tests `tests/transpiler/udt-field-history.test.ts`, 3 of 4 fail without it. (2) `<drawing>.all` is a Pine array again: a new `DrawingArray` (an Array subclass that also carries the Pine array surface and `array` = itself) plus `Series.from`/`Context.init` keeping the array whole instead of storing its last element; tests `tests/namespaces/drawing-array.test.ts`. (3) a comparison operand's member chain is scoped: `transformExpression`'s MemberExpression visitor now recurses into member/call objects, so `if pivot == get_v.get(1).y` no longer emits `get_v` bare (`ReferenceError`); tests `tests/transpiler/comparison-member-chain.test.ts`. |
| File | `pinets.min.browser.es.js`, 654,921 bytes, sha256 `d27878776f822b46afa781a1f6c368ff8c51327d601b9b548594424c19ce267a…` |
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

The patches this file carries are PUBLISHED: both commits live on the fork's branch
`fix/scope-collision` (<https://github.com/godzillacode0000/PineTS/tree/fix/scope-collision>) —
`30a75fd` (UDT field history) and `493a8ea` (`<drawing>.all`) — which is what the AGPL asks for
(the changes visible to whoever receives this distribution). A future patch must be pushed BEFORE a
bundle carrying it ships, and noted in `THIRD-PARTY.md`.
