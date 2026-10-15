# traders-desk — the Hermes Desktop plugin package

This directory is the plugin package the Hermes **plugin catalog** installs: one manifest
(`plugin.yaml`) and one entrypoint (`desktop/plugin.js`), which the Desktop app loads into its
renderer as **Trader's Agent** — a sidebar row that docks a live Vela chart beside your
conversation.

```
plugin.yaml            name / version / kind / requires_hermes / platforms (no tools: this half
                       registers UI, not tools)
desktop/plugin.js      the whole plugin: the console pane, a sidebar row, a status-bar chip and
                       palette commands, on the plugin SDK only
desktop/plugin.expect.json   what tools/verify-plugin.mjs checks the registrations against (CI)
```

**The console it frames is not in this package.** The pane renders `http://127.0.0.1:8787/`, a
local Python service that lives in the same repository (`console/`) and is started by the
operator:

```shell
git clone https://github.com/godzillacode0000/tradersagent-plugin
cd tradersagent-plugin
./console/start.sh          # terminal 1 — the console (macOS: see docs/MACOS.md)
./install.sh                # the plugin + the desk skill + the MCP registration
```

Without the console the pane says so, in one line, instead of showing a blank page. The agent's
56 chart tools are **not** part of this package either: they come from the repository's
`traders-chart` MCP server, which `./install.sh` (or `./bin/register-mcp.sh`) registers with
Hermes.

Everything is local: no account, no API key, no telemetry. The console fetches market bars from
Binance's public klines and Library scripts from LuxAlgo's hosted MCP — both over the network by
design, and the console says which provider answered each call.

This plugin stays inside the Desktop plugin SDK (no prototype patching, no `eval`, no reaching
into the app's internals); `hermes plugins validate .` passes every admission check, including
the security scan and the desktop-surface check. Licence: MIT for this repository's own code —
see the repository root for third-party notices.
