# Third-party notices and attribution

This project's own code is MIT (see `LICENSE`). It **uses** LuxAlgo's tooling and LuxAlgo's data at
runtime; those keep their own terms. Nothing below is redistributed in this repository except where
stated.

---

## Vela — the chart engine

- **Licence:** Apache-2.0 — <https://github.com/LuxAlgo/Vela>
- **How it is used:** **vendored** at `console/frontend/vendor/vela/dist/` (unmodified, `@luxalgo/vela@0.8.1`) and served from disk — the same files `index.html`'s import map and script tags load. `./install.sh --vendor` refreshes exactly those paths.
- **Attribution requirement (Vela `NOTICE`, Apache-2.0 §4(d)):** *"Any product, website, or
  application that displays charts rendered by this software must show a visible attribution to the
  Vela project on every page or screen where such a chart is displayed."* The library satisfies this
  by rendering its own mark on the chart, bottom-left, enabled by default. **That mark is part of the
  product and must not be removed, hidden or obscured** — you may restyle or reposition it, or
  disable it *only* if the page shows an equivalent visible "Vela" attribution with a link to the
  project page.
- If you redistribute the library itself, include its `NOTICE` and a copy of the Apache-2.0 licence.

## vela-pinets + pinets — the Pine (PineTS) runtimes

- **Licence:** `vela-pinets` is **AGPL-3.0-only**; **PineTS is dual-licensed — AGPL-3.0-only OR
  commercial** (`LICENSE-COMMERCIAL.md` upstream: the commercial option removes the copyleft
  obligations for closed-source and hosted use). This project takes the AGPL path deliberately (free
  distribution, no monetisation); the commercial option is recorded here so a later decision to
  close or charge has a known door. — <https://github.com/LuxAlgo/Vela-pinets> · <https://github.com/LuxAlgo/PineTS>
- **How it is used:** `@luxalgo/vela-pinets@0.2.15` is **vendored unmodified** at
  `console/frontend/vendor/vela-pinets/dist/` and served from there. Its `PineEngine` imports `pinets`
  as an external module, which the page's import map resolves to the patched build below — so
  "Add to chart" runs the fork's engine. Its `PineWorkerEngine` is the exception: that class's worker
  is an engine copy **inlined into vela-pinets' dist** (unpatched by this project). As of vela-pinets
  **0.2.15** that inlined copy is PineTS **0.11.0** (upstream's changelog: "Built against pinets
  0.11.0"), i.e. at or above the 0.10.0 floor this file reasons about below; the earlier vendored
  build (0.2.12, read from the v0.2.12 tag's lockfile, audited 2 Oct 2026) inlined 0.9.32, below the
  floor. Either way the worker path is "without this project's patches". The console does not register it
  by default; `?engine=worker` on the console URL (or localStorage `luxalgo-web:pine-engine` = `worker`)
  opts into it, trading the patches for an off-thread run. `workerUrl`/`createWorker` exist but the
  worker also carries the model builder, which is not
  exported for reuse.
  The **`pinets` engine is redistributed in this repository** at
  `console/frontend/vendor/pinets/pinets.min.browser.es.js` (690 KB / 690,220 bytes, browser-ES build) and is what the
  import map serves; the AGPL text travels with it as `vendor/pinets/LICENSE`.
  - Built from the fork **<https://github.com/godzillacode0000/PineTS>** at commit `f5ec571`
    (branch `fix/p1-p8-on-0.11`; = upstream `v0.11.0` plus THREE patches — UDT field history reads, a
    declaration reached by a walker keeping its scope and store, and a split element identified by the
    node the split built rather than by its name; the five other classes the previous build patched
    (`.all` arrays, comparison operand chains, UDT name shadows, implicit-return bases, operand
    lowering) were fixed by upstream 0.11.0 itself. The details, the
    test files and the sha256 are in `console/frontend/vendor/pinets/PROVENANCE.md`). Everything before
    those commits was upstream as-is.
  - Because this repository now redistributes AGPL code, the combined distribution is under the AGPL:
    anyone who receives it can ask for the complete corresponding source, and the fork above is that
    source for the engine. Bundling was a deliberate decision (free distribution, no monetisation) —
    the earlier policy was CDN-only, precisely to keep the combined work out of the AGPL.
  - The engine CARRIES three patches (2 Oct), all PUBLISHED on the fork's branch
    `fix/p1-p8-on-0.11` (<https://github.com/godzillacode0000/PineTS/tree/fix/p1-p8-on-0.11>):
    UDT field history reads (`56f6d3a`), a walker-reached declaration (`2b5ff18`), a split element
    identified by node rather than name (`e705e12`) — the same name-collision class the audit flagged
    as its #26; the earlier eight-patch build's other five classes went upstream as part of 0.11.0.
    The fixes with upstream interest were also submitted as PRs to LuxAlgo/PineTS (`#387`, `#386`,
    open on 2 Oct). The
    AGPL's "make the changes visible" condition is met by that public branch — push any future patch
    BEFORE shipping a bundle that carries it.
- **Why the `pinets` pin is a floor, not a preference (27 Sep):** `pinets@0.10.0` is the floor: 0.9.33 evaluates *both* sides of a
  ternary, so the standard guard `size >= 2 ? array.get(a, size - 2) : na` still runs the read and
  dies with `Index -2 is out of bounds, array size is 0` the moment the array is empty — the script
  aborts and the pane stays blank. 0.10.0 honours the guard. Verified against the Library's
  *Wyckoff Wave & Volume Studies* (crashes on 0.9.33, runs and draws four series on 0.10.0); do not
  pin back down.
- `./install.sh --vendor` refreshes Vela's pinned browser builds **in place** — they are committed under
  `console/frontend/vendor/{vela,vela-pinets}/dist/` and that is what `index.html` loads. The pinets
  engine ships with the repo and is not fetched.
- LuxAlgo's own note: vela-pinets is *"licensed separately from Vela's Apache-2.0 and this server's
  MIT. Vela itself ships no engine and carries no Pine code."*

## LuxAlgo MCP server (`@luxalgo/mcp`)

- **Licence:** MIT © LuxAlgo Global, LLC — <https://github.com/LuxAlgo/luxalgo-mcp-server>
- **How it is used:** this project is a **client** of the hosted endpoint `https://mcp.luxalgo.com/mcp`
  (free, keyless, read-only at the time of writing). The server's code is not copied here.
- Its `NOTICE` states the MIT licence *"applies to the code only — it does not grant any rights to
  LuxAlgo's APIs or the content they serve. Use of the LuxAlgo API through this server is subject to
  LuxAlgo's terms of service."*

## LuxAlgo Library content (concept pages, family hubs, write-ups)

- **Licence:** **LuxAlgo Library License v1.0** — free with attribution —
  <https://www.luxalgo.com/library/license/>
- **How it is used:** fetched from the MCP server at runtime and displayed with a link to its
  canonical page. Nothing from the Library is stored in this repository.
- **Attribution (the one condition):** *"Credit the LuxAlgo Library. Where the medium allows a link,
  link to the page you drew from… Where it doesn't, the words 'LuxAlgo Library' are enough."*
  Canonical line: `Source: LuxAlgo Library — luxalgo.com/library/…`
- **Not permitted:** republishing the Library wholesale as a competing catalogue, or selling access
  to the content as-is.

## Indicator / strategy Pine sources

- **Licence:** stated per script in its own header. LuxAlgo-published scripts are
  **CC BY-NC-SA 4.0**; curated imports keep their own licences and authors.
- **How it is used:** fetched on demand and shown with its licence badge. Never committed here.
- LuxAlgo's own clarification: *"using these indicators to trade your own account is not commercial
  use under this license — selling them, redistributing them for a fee, or building them into a paid
  product is."*

## Edge Stats — LuxAlgo's open-source statistics engine (optional, not bundled)

- **Licence:** code **MIT**, © LuxAlgo Global, LLC — <https://github.com/LuxAlgo/edge-stats>. The calendar
  and event date files under its `data/` are **CC BY 4.0** (`DATA_LICENSE`); the required attribution is:
  *"Calendar data from Edge Stats by LuxAlgo (github.com/LuxAlgo/edge-stats)"*. The pane's home and Data views carry it.
- **How it is used:** **not bundled and not vendored.** `./install.sh --with-edge` clones it at a **pinned
  commit** (`a482598…`, the same string `console/backend/edgestats.py` pins — a test fails if the two drift)
  into `~/.local/share/traders-agent/edge/engine` and runs `pnpm install --frozen-lockfile` there. The console
  starts it on demand as a local process on `127.0.0.1` and talks to it over HTTP; the console itself stays
  stdlib-only. Nothing from the engine is committed to this repository. Its dependencies are installed from its
  own lockfile; upstream gates them to permissive licences (MIT / Apache-2.0 / BSD / ISC / MPL-2.0).
- **What this project adds:** the supervisor (`console/backend/edgestats.py`), the `/api/edgestats/*` routes,
  the eight `edgestats_*` MCP tools, `trader-chart edge`, and the pane's Edge Stats sheet
  (`console/frontend/edge.js`, `edge.css`). **No statistic is computed here** — every number is the engine's.
- **Adapted code:** the session view's overlay logic (levels, gap band, opening-range box, outcome marker) is
  adapted from edge-stats' own dashboard (`packages/web/src/components/session-view.tsx`, MIT), rewritten in
  plain JavaScript onto the vendored Vela. The notice above covers it.
- **Data is not shipped.** The sheet can download free history through the engine's own adapters — **Binance**
  (public archive `data.binance.vision`) and **Dukascopy** (public tick archive) — keyless, on the user's
  machine, into the user's store. Each provider's terms apply to what is downloaded (personal analysis; do not
  redistribute it). The `demo` source is synthetic and deterministic, never market data. No downloaded bars,
  keys or store files may be committed here — the store lives in the user's home folder, outside this repository, by design.
- **Trademark:** "Edge Stats", "LuxAlgo" and the LuxAlgo logo are trademarks of LuxAlgo Global, LLC. This
  project is unofficial and uses the name only descriptively ("built on Edge Stats"), as the engine's
  `TRADEMARKS.md` permits for nominative use.
- **What it will not do (upstream's non-goals, kept):** order execution, broker connections, predictions or trade
  advice. Every result carries the engine's fixed disclaimer: *historical conditional frequencies with sample
  sizes — not predictions, not advice.*

## Trademarks

"LuxAlgo", the LuxAlgo logo and the "LuxAlgo MCP" project name are trademarks of LuxAlgo Global, LLC.
This project is **unofficial** and is **not affiliated with, endorsed by, or sponsored by LuxAlgo**.
It uses the LuxAlgo name only descriptively (nominative use: "compatible with LuxAlgo MCP", "charts
by Vela") and ships no LuxAlgo logo. See LuxAlgo's
[TRADEMARKS.md](https://github.com/LuxAlgo/luxalgo-mcp-server/blob/main/TRADEMARKS.md).

## Vela & LuxAlgo mark in this UI

The `▲` mark on the chart is Vela's required attribution (see above). The console also shows the
LuxAlgo Library source link on every item it displays. Keep both.

## vectorbt — the optional backtesting engine

`vectorbt` is **not bundled** with this plugin and is **not required**. If the operator runs
`./install.sh --with-backtest`, it is downloaded from PyPI into its own virtual environment
(`~/.local/share/traders-agent/bt/venv`) and stays there — no source is vendored into this
repository, exactly as with the PineTS runtimes above.

- **Licence:** Apache-2.0 **with Commons Clause**. The Commons Clause removes the right to
  *"Sell"* the software — defined as providing it to third parties *"for a fee or other
  consideration"*. This plugin is distributed free of charge, so shipping the installer flag is
  not a Sale; a paid tier, a donation gate, or a "support fee" that is really a licence fee would
  change that reading, and the clause would then need a commercial licence from the vectorbt
  author. Project: <https://github.com/polakowo/vectorbt>
- **What is installed:** the plain `vectorbt` distribution only.
  - **`vectorbtpro` is not installed and must not be** — it is a separate commercial product.
  - **The `[full]` extras are not installed** — they pull TA-Lib and other packages whose own
    licences are stricter than vectorbt's.
- **Where it runs:** a separate process (`console/backend/backtest_service.py`) in its own venv.
  The console itself stays stdlib-only, so the plugin works with or without the engine.
- **Data:** a backtest can run on the chart's own bars (they never leave the machine) or on public
  exchange endpoints. Any data the operator supplies for `local:` sources is theirs and is not
  redistributed with this plugin.

## Vendored in the browser bundle (`console/frontend/vendor/`)

The pane's chart surface is not fetched from a CDN — the page has to boot identically offline, and a
CDN failure used to look exactly like a broken chart. The vendor directory therefore carries the
third-party browser builds, each beside its licence:

- **`vela/` — `@luxalgo/vela` 0.8.1** (chart, workspace, plugin SDK, Binance provider).
  **Licence: Apache-2.0** — commercial use included, attribution kept (`vela/LICENSE`,
  `vela/NOTICE`; 0.8.1 moves the NOTICE's attribution URL `luxalgo.com/vela` → `velacharts.dev`); LuxAlgo's Vela page states the invitation in its own words ("Ship it in an
  afternoon"; "Free, open source" — luxalgo.com/vela, read 2 Oct 2026). *(A "Fork it, vendor it,
  ship it." quote this file used to carry could not be located on that page or in any of the four
  repos on 2 Oct, and was removed — per the upstream audit, an unattributable quote is worse than
  none.)*
- **`vela-pinets/` — `@luxalgo/vela-pinets` 0.2.15** (the chart's own Pine engine: `PineEngine` /
  `PineWorkerEngine`). **Licence: AGPL-3.0-only**, stock build — obligations met the same way as for
  `pinets` above (public fork for anything we change and ship).
- **`zag/`** — the module closure Vela's ES modules import by name: `@zag-js/*` 1.44.0,
  `@floating-ui/{core,dom}` 1.8.0, `@floating-ui/utils` 0.2.12, `proxy-compare` 3.0.1.
  **Licence: all MIT.** Not a free choice: a browser cannot resolve a bare specifier, so every
  specifier those modules use has an import-map entry pointing here.
- **`pinets/`** — our patch of LuxAlgo's PineTS; see `pinets/PROVENANCE.md`.

`console/frontend/vendor/VENDORING.md` records versions, the exact commands that produced the copies,
the two gotchas (`process.env.NODE_ENV`, `.mjs` MIME) and how to update them.

## Extra indicator scripts (`console/frontend/extra/`)

Community indicator scripts bundled with the console (offered beside the LuxAlgo catalogue). The
gate: **MIT / MPL-2.0 only** — never GPL, never an unlicensed source (`test_extra_scripts.py`
enforces it, and `tools/sync-live.sh` mirrors the directory).

- **`openSourceFractal.pine` — Open Source Fractal** (slug `open-source-fractal`).
  **Licence: MIT** — <https://github.com/cantolab/open-source-fractal>. Bundled with the MIT notice
  prepended (the source file carried none); the licence text travels as `LICENSE-cantolab-MIT.txt`.
- **`unicorn-model.pine` — Unicorn Model** (slug `unicorn-model`).
  **Licence: MPL-2.0** — <https://github.com/fxraptor-alpha/pinescript-indicators>. Its own MPL
  header is kept; the licence text travels as `LICENSE-fxraptor-MPL-2.0.txt`.

Both were run through the vendored engine before bundling: `openSourceFractal` 1029 ms / 4 box /
31 line / 14 label / 1 table; `unicorn-model` 2594 ms / 2 box / 1 line / 2 label / 1 table (with
its exotic 15d/45d/15w higher-timeframe fetches falling back to the chart's bars, as the run
reported). Scripts from the same four source repos that are GPL-3.0 or unlicensed (JustExecution's
HTF suite, ict2023trader's set, fxraptor's `fractal-model`) are **not** bundled — concepts only, and
any reimplementation is our own Pine (see `docs/PLAN-pinets-bump-and-indicator-pack.md`).

## Network: every host this software contacts

No account, no key and no telemetry. These are all the hosts, and what each sees.

| Host | Who contacts it | What it sees |
|---|---|---|
| `127.0.0.1:8787` (console), `:8788` (optional backtest tier), `:8789` (optional Edge Stats engine) | plugin, console, MCP server, CLIs | local only |
| `mcp.luxalgo.com` | the console's MCP client (keyless) | Library searches and source requests |
| `api.binance.com` (and `api.binance.us` as Vela's fallback, `fapi`/`dapi` for futures) | the console's `/api/bars` and paper-broker price; also Vela and PineTS **from the browser** | the symbols and intervals you view, from your IP |
| `stream.binance.com`, `fstream.binance.com`, `stream.binance.us` | Vela, from the browser (live candles) | the symbols you view |
| `crypto-icons.ledger.com` | Vela, from the browser (symbol logos; also pre-connected by `index.html`) | the ticker you view |
| `luxalgo-production.s3.amazonaws.com`, `luxalgo-images-production.s3.us-east-1.amazonaws.com` | the console's preview cache | catalogue picture URLs |
| `data.binance.vision`, Dukascopy | the optional Edge Stats engine, only when you start a download | the symbol and range you ask for |
| GitHub, npm, PyPI | `install.sh` flags (`--with-edge`, `--with-backtest`) at install time | an ordinary download |

The vendored bundles also contain code for Alpaca, Coinbase, Hyperliquid and Financial Modeling Prep providers. This console
registers none of them and none needs a key here, so they are never contacted. The console's page carries a
`Content-Security-Policy` whose `connect-src` lists exactly the hosts above that the browser itself contacts.

## Vendored Zag packages: licence texts

`console/frontend/vendor/zag/THIRD-PARTY-LICENSES.md` reproduces the MIT notice each package ships with.
