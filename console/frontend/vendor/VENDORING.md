# Vendored browser bundles — why they are files, not URLs

The chart pane the agent drives used to load LuxAlgo's browser builds from jsDelivr at every page
load. That made the pane's control surface depend on a CDN being reachable: if jsDelivr failed,
`window.Vela` never appeared, the workspace module died, the page fell back to a bare chart and
every agent command answered "no bars" while the pane still looked alive. The bundles now live here,
so the page boots the same way offline as online.

## What is here

| Path | What it is | Licence |
|---|---|---|
| `vela/dist/vela.global.min.js` | Vela browser build (script tag → `window.Vela`) | Apache-2.0 (`vela/LICENSE`, `vela/NOTICE`) |
| `vela/dist/{index,plugin,workspace,ui,widget}.js`, `vela/dist/providers/*.js`, `vela/dist/chunk-*.js` | the same Vela as ES modules — what the import map resolves `@luxalgo/vela*` to | Apache-2.0 |
| `vela-pinets/dist/vela-pinets.global.min.js` | Vela-PineTS browser build (script tag → `window.VelaPinets`, i.e. `PineEngine` / `PineWorkerEngine`) | AGPL-3.0-only (`vela-pinets/LICENSE`) |
| `vela-pinets/dist/index.js` | Vela-PineTS as ES modules (`@luxalgo/vela-pinets`) | AGPL-3.0-only |
| `zag/` | the module closure Vela's ES modules import: `@zag-js/*` 1.44.0 (18 packages), `@floating-ui/{core,dom}` 1.8.0, `@floating-ui/utils` 0.2.12, `proxy-compare` 3.0.1 | all MIT |
| `pinets/pinets.min.browser.es.js` | **our patch of LuxAlgo's PineTS** (Library path) — not a stock build; see `pinets/PROVENANCE.md` and `THIRD-PARTY.md` | AGPL-3.0-only |

Versions are pinned: **vela 0.8.1, vela-pinets 0.2.15** (whose inlined worker engine is PineTS
**0.11.0**; see `THIRD-PARTY.md`). The `zag/` closure is not optional — the
browser cannot resolve a bare specifier on its own and Vela's ES modules import these by name; the
import map in `index.html` carries one entry per specifier (`@floating-ui/utils/dom` is a subpath
entry, not a typo).

## How this was produced

```bash
# the two LuxAlgo packages: registry tarballs, dist/ + licences only
curl -sL https://registry.npmjs.org/@luxalgo/vela/-/vela-0.8.1.tgz        | tar xz -C vela
curl -sL https://registry.npmjs.org/@luxalgo/vela-pinets/-/vela-pinets-0.2.15.tgz | tar xz -C vela-pinets
# the module closure: install the four entry packages, then vendor every package npm pulled in
npm install --no-audit --no-fund @zag-js/vanilla @zag-js/dialog @zag-js/menu @zag-js/tooltip
```

Two gotchas, both learned the hard way:

1. **`process.env.NODE_ENV` must exist.** These builds are published for bundlers, and bundlers
   define it (jsDelivr's `+esm` bundles do it invisibly). `index.html` therefore sets
   `window.process = { env: { NODE_ENV: 'production' } }` *before* any module loads. Without it the
   workspace dies with `process is not defined` and silently falls back to the bare chart.
2. **`.mjs` needs the right MIME type.** The console's static handler maps extensions to content
   types; `.mjs` is served as `text/javascript` (and was already mapped — a missing mapping here
   looks exactly like a broken file: Chrome reports a MIME mismatch as "Failed to fetch dynamically
   imported module").

## Updating to a new upstream version

1. Re-run the two `curl`s with the new versions; replace `vela/` and `vela-pinets/`. (The
   `chunk-*.js` names are content hashes and change between releases — replace the whole `dist/`
   file set, not single files.)
2. `npm install @zag-js/... @zag-js/...` again (same four entry packages) and re-vendor `zag/`.
3. Update the import map in `index.html` if any specifier or path changed, and this table.
4. Reload the pane and confirm: `/api/chart/state` reports a symbol + 500 bars, and
   `trader-chart state` says `layout: workspace` — a fallback to the bare chart shows up as
   `symbol: "—"` with the reason in the heartbeat's `diag` field.

The pane answers that question itself now: the heartbeat carries
`diag: {wsReady, wsError, cells, activeChart, consoleChart}` (`frontend/chart-bridge.js` →
`backend/chart_bridge.py`), which is exactly how the missing `@zag-js/vanilla` specifier was found.
