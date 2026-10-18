# macOS setup (Mac mini)

The console and the plugin run on macOS. This file covers the two things the
Linux README assumes differently: the interpreter and the service.

## One-time setup

The console needs Python 3.11+ with the `mcp` client. macOS's `/usr/bin/python3`
is 3.9, so give the repo its own venv:

```bash
cd <repo>
python3.12 -m venv .venv                 # any 3.11+ interpreter works (Homebrew, python.org)
.venv/bin/pip install 'mcp>=1,<3'
```

`console/start.sh`, `install.sh` and `console/service-macos.sh` find
`.venv/bin/python` automatically (an explicit `PY=/path/to/python` still wins).

## Run it

```bash
./console/start.sh                        # foreground · http://127.0.0.1:8787/
./console/service-macos.sh install        # or: login service via launchd (the macOS
                                          # counterpart of the README's systemd unit)
./console/service-macos.sh status
./console/service-macos.sh uninstall
```

Service logs: `~/.local/state/traders-agent/console.out.log` and `console.err.log`.

Deploy the plugin + desk skill the usual way:

```bash
HERMES_HOME="$HOME/.hermes" ./install.sh
```

Desktop plugins are **app-level** in current Hermes Desktop builds, so they
belong to the default home even when the chat profile is a named one; the desk
skill installs into that same home.

## What was adapted for macOS (local patches)

- `console/start.sh` — auto-detects the repo `.venv`; an actionable message when
  `mcp` is missing.
- `install.sh` — portable `sed -i` (BSD/GNU), interpreter resolution for
  `--doctor` (PY → `.venv` → first python3.11+), `systemctl` probes guarded so
  they never run on macOS, macOS notes in the closing messages, the
  backtest venv uses the resolved interpreter, and the **plugin always deploys
  to the app-level root** even when `HERMES_HOME` points at a profile
  (`…/profiles/<name>` — an agent session exports exactly that; the plugin
  would otherwise land somewhere the app never loads).
- `bin/is-enabled.sh` — also reads the app's decision store from the macOS path
  (`~/Library/Application Support/Hermes/Local Storage/leveldb`), and knows that
  current builds default standalone plugins to ON.
- `console/backend/edgestats.py` — process liveness and engine ownership no longer read `/proc`
  only: on macOS a killed-but-unreaped zombie read as "alive" and the ownership probe always
  failed, so a restarted console could not adopt its still-running Edge Stats engine. Zombie
  state and the engine's command line now come from `ps` when `/proc` is absent.
- `console/service-macos.sh` — new; launchd install / uninstall / status.
- `docs/MACOS.md` — this file.

These are local commits in this checkout; `git log --oneline` lists them so they
can be rebased over upstream updates.

## Notes

- Current Hermes Desktop builds load standalone desktop plugins **enabled by
  default** — there is nothing to toggle unless you turn it off.
- Port 8787 must be free. `PORT=9000 ./console/start.sh` (+ `PORT=9000 ./install.sh`)
  moves everything; set `LUXALGO_CONSOLE=http://127.0.0.1:9000` for the CLIs.
- Catalogue previews want an image converter — the console ships none, it drives a CLI
  (`vips`, `magick`, `convert` or `ffmpeg`). `service-macos.sh` resolves one at install time and
  writes its absolute path into the plist as `TRADERS_AGENT_RESIZER`; with none found, thumbnails
  are served at full size: correct pictures, just slow (~2.6 s each). Ask a login shell what it
  has (`command -v magick ffmpeg`), then re-run the service installer — or install one
  (`brew install imagemagick`).

## Troubleshooting

- **`start.sh: '...' has no 'mcp' client`** — the venv is missing or was skipped:
  re-run the one-time setup above; `start.sh` then picks `.venv/bin/python` itself.
- **A venv that works in Terminal says "no `mcp` client" inside an agent session** — agent
  sessions can export a `PYTHONPATH` pointing at a different interpreter's packages, which
  shadows the venv's own. The scripts scrub `PYTHONPATH`/`PYTHONHOME` for their probes and for
  the console process itself.
- **`launchctl` answers `Input/output error` while reinstalling the service** — a bootout can
  need a beat before the same label re-bootstraps; the helper retries, and `status` shows what
  actually happened.
- **Blank pane** — the console process is not running:
  `./console/service-macos.sh status` (or `./console/start.sh`).
- **Pane shows a "not on screen" note** — the app kept the pane's zone
  minimized; press *Ask again* in the note, or re-add the pane from the layout
  controls.
