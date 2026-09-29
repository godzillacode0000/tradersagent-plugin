# Third-party notices and attribution

This project's own code is MIT (see `LICENSE`). It **uses** LuxAlgo's tooling and LuxAlgo's data at
runtime; those keep their own terms. Nothing below is redistributed in this repository except where
stated.

---

## Vela — the chart engine

- **Licence:** Apache-2.0 — <https://github.com/LuxAlgo/Vela>
- **How it is used:** loaded from jsDelivr at runtime (`@luxalgo/vela@0.7.3`), pinned by URL.
- **Attribution requirement (Vela `NOTICE`, Apache-2.0 §4(d)):** *"Any product, website, or
  application that displays charts rendered by this software must show a visible attribution to the
  Vela project on every page or screen where such a chart is displayed."* The library satisfies this
  by rendering its own mark on the chart, bottom-left, enabled by default. **That mark is part of the
  product and must not be removed, hidden or obscured** — you may restyle or reposition it, or
  disable it *only* if the page shows an equivalent visible "Vela" attribution with a link to the
  project page.
- If you redistribute the library itself, include its `NOTICE` and a copy of the Apache-2.0 licence.

## vela-pinets + pinets — the Pine (PineTS) runtimes

- **Licence:** **AGPL-3.0-only** — <https://github.com/LuxAlgo/Vela-pinets> · <https://github.com/LuxAlgo/PineTS>
- **How it is used:** `@luxalgo/vela-pinets@0.2.12` is loaded from jsDelivr at runtime, pinned by URL.
  The **`pinets` engine is redistributed in this repository** at
  `console/frontend/vendor/pinets/pinets.min.browser.es.js` (653 KB, browser-ES build) and is what the
  import map serves; the AGPL text travels with it as `vendor/pinets/LICENSE`.
  - Built from the fork **<https://github.com/godzillacode0000/PineTS>** at commit `493a8ea`
    (= upstream `0.10.0` plus TWO patches — UDT field history reads, and `<drawing>.all` as a Pine
    array; the details, the test files and the sha256 are in
    `console/frontend/vendor/pinets/PROVENANCE.md`). Everything before those commits was upstream as-is.
  - Because this repository now redistributes AGPL code, the combined distribution is under the AGPL:
    anyone who receives it can ask for the complete corresponding source, and the fork above is that
    source for the engine. Bundling was a deliberate decision (free distribution, no monetisation) —
    the earlier policy was CDN-only, precisely to keep the combined work out of the AGPL.
  - The engine now CARRIES four patches (29 Sep), all PUBLISHED on the fork's branch
    `fix/scope-collision` (<https://github.com/godzillacode0000/PineTS/tree/fix/scope-collision>):
    UDT field history reads (`30a75fd`), `<drawing>.all` as a Pine array (`493a8ea`), a scoped
    comparison operand chain (`94d13ec`) and a UDT whose name a variable shares (`3c35b0f`). The AGPL's
    "make the changes visible" condition is met by that public branch — push any future patch BEFORE
    shipping a bundle that carries it.
- **Why the `pinets` pin is a floor, not a preference (27 Sep):** `pinets@0.10.0` is the floor: 0.9.33 evaluates *both* sides of a
  ternary, so the standard guard `size >= 2 ? array.get(a, size - 2) : na` still runs the read and
  dies with `Index -2 is out of bounds, array size is 0` the moment the array is empty — the script
  aborts and the pane stays blank. 0.10.0 honours the guard. Verified against the Library's
  *Wyckoff Wave & Volume Studies* (crashes on 0.9.33, runs and draws four series on 0.10.0); do not
  pin back down.
- `./install.sh --vendor` still fetches Vela's pinned browser builds into `console/frontend/vendor/`
  for offline use (git-ignored). The pinets engine no longer needs fetching — it ships with the repo.
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
