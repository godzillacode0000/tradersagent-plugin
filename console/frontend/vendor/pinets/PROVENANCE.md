# Vendored engine: pinets

Where this file came from, so the AGPL obligations are answerable without guesswork.

| | |
|---|---|
| Engine | `pinets` (PineTS) |
| Version | **0.10.0** — the same version the import map used to serve from jsDelivr (`pinets@0.10.0`) |
| Licence | **AGPL-3.0-only** — full text in `LICENSE` beside this file |
| Source | <https://github.com/godzillacode0000/PineTS> — fork of <https://github.com/LuxAlgo/PineTS> |
| Built from | commit `493a8ea` (branch `fix/scope-collision`), 2026-09-29 |
| Modifications | **two patches**, on top of upstream 0.10.0. (1) UDT field history reads (`b.c[N]`): the lookback index is scoped like any other index (it was emitted bare and died with `ReferenceError: name is not defined`), and a `var` instance reads the FIELD's history (the object is created once, so `$.get(b, N).field` returned today's value — silently wrong); tests `tests/transpiler/udt-field-history.test.ts`, 3 of 4 fail without it. (2) `<drawing>.all` is a Pine array again: a new `DrawingArray` (an Array subclass that also carries the Pine array surface and `array` = itself) plus `Series.from`/`Context.init` keeping the array whole instead of storing its last element; tests `tests/namespaces/drawing-array.test.ts`. |
| File | `pinets.min.browser.es.js`, 654,805 bytes, sha256 `42db98456aea506e484b2d4eb89065f9abd2e48f3ac26f40a9b7fb859028eeab…` |
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

If a patch is ever carried here, publish it in the fork and note it in `THIRD-PARTY.md` — the AGPL
requires the changes to be visible to whoever receives this distribution.
