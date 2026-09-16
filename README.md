# Trader's Agent — a plugin for Hermes Desktop

A sidebar entry in [Hermes Desktop](https://hermes-agent.nousresearch.com/docs) that opens a full
trading console in the main zone: **Vela**-rendered candlesticks and the **LuxAlgo Library**
(800+ concepts and indicators, served by LuxAlgo's own MCP server) in one local web app.

![chart-first console](docs/screenshot.png)

- **Chart-first by design.** Vela gets the whole pane. The Library and the item detail panel are two
  small toggles in the top bar, never permanent columns.
- **Everything local.** One Python process on `127.0.0.1:8787` proxies LuxAlgo's MCP server and
  serves the frontend. No account, no key, no telemetry. Nothing from LuxAlgo is copied into this
  repo — the chart engine and the Pine runtime load from their published jsDelivr builds.
- **The agent can drive the chart.** `console/bin/trader-chart` reads what the chart is showing and
  puts indicator scripts on it through a small file bridge, so you prompt your agent instead of
  clicking around. `console/bin/library-indicator` pulls an indicator's Pine source by name.

> **Unofficial.** This project is not affiliated with, endorsed by, or sponsored by LuxAlgo. It uses
> the LuxAlgo name descriptively ("compatible with LuxAlgo MCP") and ships no LuxAlgo logo. See
> [`THIRD-PARTY.md`](THIRD-PARTY.md) for the licences and the attribution each piece requires.

## Requirements

| | |
|---|---|
| **Hermes Desktop** | v0.21.3 or newer (the plugin uses the `sidebar.nav` + `routes` contribution areas) |
| **Python** | 3.11+ with the `mcp` client: `pip install mcp` (a venv is fine — point `PY=` at it) |
| **Network** | for LuxAlgo's MCP endpoint and the jsDelivr builds; the chart falls back to synthetic bars when the data provider is unreachable |
| **OS** | any (it is a plain local HTTP server plus an Electron-side plugin; developed on Arch/Hyprland) |

## Install

```bash
git clone https://github.com/<you>/tradersagent-plugin
cd tradersagent-plugin

./console/start.sh        # terminal 1 — the console on http://127.0.0.1:8787/
./install.sh              # copies the plugin into ~/.hermes/desktop-plugins/traders-desk/
```

Then in Hermes Desktop:

1. `Ctrl+K` → **Reload desktop plugins**
2. **Capabilities → Plugins** → enable **Trading Desk**
3. Click **Trader's Agent** in the left sidebar — the console opens in the main zone

`./install.sh --vendor` additionally fetches LuxAlgo's pinned browser builds into
`console/frontend/vendor/` for offline use (see the licence note in `THIRD-PARTY.md`).

### Run the console as a service (optional)

```ini
# ~/.config/systemd/user/traders-agent.service
[Unit]
Description=Trader's Agent console (LuxAlgo MCP proxy + Vela chart)
After=network-online.target

[Service]
ExecStart=%h/tradersagent-plugin/console/start.sh
Restart=always
WorkingDirectory=%h/tradersagent-plugin

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now traders-agent.service
```

## Using it

| Where | What it does |
|---|---|
| Left sidebar → **Trader's Agent** | opens the console (the row *is* the navigation — one click) |
| Status bar → **Trader's Agent** chip | same, from anywhere in the app |
| `Ctrl+K` → **Trading: open Trader's Agent** | same, from the palette |
| `Ctrl+K` → **Trading: toggle chart reveal on launch** | stop the console opening by itself at app start |
| Top bar → `☰ Library` | the Library panel: search 800+ concepts and indicators |
| Top bar → `▤ Details` | the selected item: write-up, **full Pine source**, licence badge, **Run PineTS** |
| The chart's own bottom bar | Vela's range buttons, timezone clock and settings (not ours) |

**Run PineTS** executes the script over the chart's live bars with LuxAlgo's PineTS runtime and paints
it as a native series; it says plainly when a script uses something PineTS has not implemented
(`import`, `while`, `for…in`). **Add to chart** hands the script to Vela's own Pine engine, which is
experimental — the app reports what actually happened rather than pretending.

### Letting your agent drive the chart

The console exposes a tiny file bridge. The agent (Hermes, or anything that can run a command) uses:

```bash
console/bin/trader-chart state                      # symbol, timeframe, price, bars, indicators on
console/bin/trader-chart shot --out /tmp/chart.png   # capture the chart for vision
console/bin/trader-chart apply script.pine           # run Pine over the chart's bars and paint it
console/bin/library-indicator "killzone"             # fetch an indicator's Pine source
```

The chart page polls the bridge, so a command lands within a couple of seconds — and only when the
console page is actually mounted (the bridge is not a headless renderer).

## Repository layout

```
plugin/            the Hermes Desktop plugin: plugin.js + its harness expectations
console/frontend/  the web app: Vela chart, Library panel, detail panel, PineTS paint layer
console/backend/   one stdlib HTTP server proxying LuxAlgo's MCP + the chart bridge + study store
console/bin/       agent-side CLIs (trader-chart, library-indicator)
tools/             verify-plugin.mjs — runs a plugin in Node against SDK stubs (used by CI)
install.sh         installs the plugin into $HERMES_HOME/desktop-plugins/
```

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `PY` | `python3` | the interpreter for `console/start.sh` (must have `mcp`) |
| `PORT` | `8787` | console port — the plugin's frame points at `http://127.0.0.1:8787/` |
| `LUXALGO_AGENTS_DIR` | `console/agents` | runtime state: chart bridge files, study threads, shots |
| `HERMES_CLI` | `hermes` on `PATH` | CLI the in-app study bridge shells out to |
| `--mcp-url` | `https://mcp.luxalgo.com/mcp` | point at a different (or local) MCP server |

## Troubleshooting

- **The sidebar row does nothing / the pane shows an old layout.** The frame keeps the copy it
  loaded. Switch to another session and back, or restart the app.
- **`start.sh: 'python3' has no 'mcp' client`.** `pip install mcp`, or `PY=/path/to/venv/bin/python ./console/start.sh`.
- **The plugin never appears in Capabilities → Plugins.** `Ctrl+K` → *Reload desktop plugins*; if it
  still does not show up, the folder was dropped after a failed load — rename
  `~/.hermes/desktop-plugins/traders-desk` and set `id:` inside `plugin.js` to the same new name.
- **The chart is empty and the log says `provider: synthetic`.** Binance's data provider was
  unreachable; the chart still renders deterministic bars so the page never comes up blank.
- **Port 8787 busy.** `PORT=9000 ./console/start.sh`, then point the plugin's `CONSOLE_ORIGIN` at it.

## Licence & credits

This project's code is **MIT** — see [`LICENSE`](LICENSE). It builds on LuxAlgo's work: **Vela**
(Apache-2.0, with its own attribution requirement — the `▲` mark on the chart stays), **vela-pinets**
and **pinets** (AGPL-3.0, loaded from the CDN, not redistributed), the **LuxAlgo MCP server** (MIT,
`@luxalgo/mcp`) and the **LuxAlgo Library** (free with attribution — `Source: LuxAlgo Library —
luxalgo.com/library/…`). Full details, quotes and links: [`THIRD-PARTY.md`](THIRD-PARTY.md).

Charts are not financial advice; the Library is an encyclopedia, not a signal service.
