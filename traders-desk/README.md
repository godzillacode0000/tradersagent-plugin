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
git clone --depth 1 https://github.com/godzillacode0000/tradersagent-plugin
cd tradersagent-plugin
./install.sh --all          # the console's python + the service + the plugin + the skill + the MCP registration
```

`--all` is the whole install: it makes a python with the `mcp` client (`uv` when it is on PATH,
else a venv + pip), installs the console as a service (systemd user unit, launchd agent, or a
detached process where neither exists), registers the `traders-chart` MCP server and waits until
the console answers. The steps still exist on their own if you would rather drive them:

```shell
./bin/setup-python.sh       # just the interpreter
./console/start.sh          # the console in the foreground (macOS notes: docs/MACOS.md)
./install.sh                # just the plugin + the desk skill + the MCP registration
./install.sh --doctor       # check all of it
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
