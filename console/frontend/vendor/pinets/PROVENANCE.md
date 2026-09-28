# Vendored engine: pinets

Where this file came from, so the AGPL obligations are answerable without guesswork.

| | |
|---|---|
| Engine | `pinets` (PineTS) |
| Version | **0.10.0** — the same version the import map used to serve from jsDelivr (`pinets@0.10.0`) |
| Licence | **AGPL-3.0-only** — full text in `LICENSE` beside this file |
| Source | <https://github.com/godzillacode0000/PineTS> — fork of <https://github.com/LuxAlgo/PineTS> |
| Built from | commit `1f65fa2dc1d46a9b254163599030f4bc27580922` (`1f65fa2`), 2026-09-25 |
| Modifications | **none** — the fork is upstream 0.10.0 as-is at that commit |
| File | `pinets.min.browser.es.js`, 653,095 bytes, sha256 `80f3a8d80d413a966b492b067ef39bb6…` |
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
