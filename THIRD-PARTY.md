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
- **How it is used:** loaded from jsDelivr at runtime (`@luxalgo/vela-pinets@0.2.12`, `pinets@0.9.33`),
  pinned by URL. **They are not redistributed in this repository** — that is deliberate: bundling
  them would put the combined work under the AGPL.
- `./install.sh --vendor` fetches a local copy for offline use straight from the CDN into
  `console/frontend/vendor/` (git-ignored). That copy is for the person who ran it, on their own
  machine, and it keeps the AGPL obligations the licence states.
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
