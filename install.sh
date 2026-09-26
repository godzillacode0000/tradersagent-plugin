#!/usr/bin/env bash
# Install the Trader's Agent plugin into Hermes Desktop.
#
#   ./install.sh                    copy plugin/ -> $HERMES_HOME/desktop-plugins/traders-desk/
#   ./install.sh --doctor           check interpreter, console port, service, plugin folder
#   ./install.sh --with-backtest    also install the optional vectorbt backtesting engine
#                                   into ~/.local/share/traders-agent/bt/venv (~840 MB, once)
#   ./install.sh --vendor           also fetch LuxAlgo's pinned browser builds into
#                                   console/frontend/vendor/ for offline use (not tracked by git)
#   HERMES_HOME=/path ./install.sh  install into another Hermes home
#
# This script does not start the console: the plugin only frames it, so the console must be
# listening on http://127.0.0.1:8787 (see console/start.sh and the README's service section).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DST="$HERMES_HOME/desktop-plugins/traders-desk"

if [[ "${1:-}" == "--doctor" ]]; then
  fail=0
  check() { # $1 label, $2 command
    if eval "$2" >/dev/null 2>&1; then echo "  ok  $1"; else echo "  FAIL $1"; fail=1; fi
  }
  echo "Trader's Agent — install doctor"
  check "python3 on PATH" "command -v python3"
  check "plugin.js in repo" "test -f \"$HERE/plugin/plugin.js\""
  check "MCP server in repo" "test -f \"$HERE/console/mcp/server.py\""
  check "console answering on 127.0.0.1:8787" "curl -fsS --max-time 3 http://127.0.0.1:8787/api/health"
  # Only this development machine carries luxalgo-web.service; a fresh install follows the README and
  # runs traders-agent.service instead. Checking the machine-specific unit unconditionally made
  # `--doctor` FAIL on every other install, which is exactly the first thing a new user runs.
  if systemctl --user list-unit-files luxalgo-web.service >/dev/null 2>&1; then
    check "luxalgo-web.service active (this machine)" "systemctl --user is-active luxalgo-web.service"
  elif systemctl --user list-unit-files traders-agent.service >/dev/null 2>&1; then
    check "traders-agent.service active" "systemctl --user is-active traders-agent.service"
  else
    check "console reachable (no user unit installed)" "curl -fsS --max-time 3 http://127.0.0.1:8787/api/health"
  fi
  check "plugin deployed" "test -f \"$DST/plugin.js\""
  check "desk skill deployed" "test -f \"$HERMES_HOME/skills/trading/trader-desk/SKILL.md\""
  if [[ $fail -ne 0 ]]; then
    echo "one or more checks failed — start the console (./console/start.sh or the user unit) and ./install.sh"
    exit 1
  fi
  echo "all checks passed"
  exit 0
fi

mkdir -p "$DST"
cp "$HERE/plugin/plugin.js" "$HERE/plugin/plugin.expect.json" "$DST/"
echo "plugin installed -> $DST"

# The desk skill: the tool order, the one-indicator-at-a-time rule, and how to read the engine's
# failure codes. The desk study loads it by name (console/backend/agents_store.py).
SKILL_DST="$HERMES_HOME/skills/trading/trader-desk"
mkdir -p "$SKILL_DST"
cp "$HERE/skills/trader-desk/SKILL.md" "$SKILL_DST/SKILL.md"
echo "desk skill       -> $SKILL_DST"

if [[ " $* " == *" --with-backtest "* ]]; then
  # Optional, and never a default: vectorbt pulls pandas + numba (~840 MB) and needs the network
  # once. It lives in its own venv so the console stays stdlib-only, and it is plain `vectorbt`
  # — not vectorbtpro (commercial) and not the [full] extras (TA-Lib and friends carry their own,
  # stricter licences). See THIRD-PARTY.md.
  BT="$HOME/.local/share/traders-agent/bt"
  if [[ -x "$BT/venv/bin/python" ]]; then
    echo "backtest engine already installed at $BT/venv (skipping)"
  else
    echo "installing the backtest engine (vectorbt) into $BT/venv — this downloads ~840 MB once"
    mkdir -p "$BT"
    python3 -m venv "$BT/venv"
    "$BT/venv/bin/pip" install --quiet --upgrade pip
    "$BT/venv/bin/pip" install --quiet vectorbt
    echo "done. start it with:"
    echo "  ~/.local/share/traders-agent/bt/venv/bin/python console/backend/backtest_service.py --port 8788"
  fi
fi

if [[ "${1:-}" == "--vendor" ]]; then
  V="$HERE/console/frontend/vendor"
  mkdir -p "$V"
  curl -fsSL -o "$V/vela.global.min.js" \
    https://cdn.jsdelivr.net/npm/@luxalgo/vela@0.7.3/dist/vela.global.min.js
  curl -fsSL -o "$V/vela-pinets.global.min.js" \
    https://cdn.jsdelivr.net/npm/@luxalgo/vela-pinets@0.2.12/dist/vela-pinets.global.min.js
  echo "fetched LuxAlgo's pinned builds into console/frontend/vendor/ (local offline copy, git-ignored)"
fi

# Restart the console if a user unit is running it.
#
# A running console keeps its Python in memory: editing chart_bridge.py (or any backend module) and
# reloading the browser frame changes NOTHING, because the process is still serving the old code.
# That failure is silent and specific — new command fields arrive empty, new endpoints 404 — and it
# reads as "the plugin is broken" rather than "the process is stale". Cost an hour of debugging here
# (a catalogue panel that returned nothing until the unit was restarted), so the installer closes it
# instead of documenting it.
UNIT=""
if systemctl --user list-unit-files luxalgo-web.service >/dev/null 2>&1; then
  UNIT="luxalgo-web.service"
elif systemctl --user list-unit-files traders-agent.service >/dev/null 2>&1; then
  UNIT="traders-agent.service"
fi

if [[ -n "$UNIT" ]] && systemctl --user is-active --quiet "$UNIT"; then
  systemctl --user restart "$UNIT"
  # Wait for it to actually answer before judging it. Measured on this machine: the console needs
  # ~7s to come up (it opens an MCP session with a remote server, then binds the port). An earlier
  # 5s budget made this block print a FALSE warning on a healthy restart — the same "output that
  # lies" defect this block exists to prevent, so the budget now exceeds the real boot time.
  ready=0
  for _ in $(seq 1 30); do   # 30 x 0.5s = 15s
    if curl -fsS --max-time 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then ready=1; break; fi
    sleep 0.5
  done
  if [[ $ready -eq 1 ]]; then
    echo "console restarted  -> $UNIT (backend changes are now live)"
  else
    echo "warning: $UNIT restarted but the console is still not answering after 15s"
    echo "         check: journalctl --user -u $UNIT -n 30"
  fi
elif [[ -n "$UNIT" ]]; then
  echo "console not running -> $UNIT (start it before using the pane)"
else
  echo "no user unit found — start the console yourself with ./console/start.sh"
fi

cat <<'EOF'

Next:
  1. start the console      ./console/start.sh          (needs python3 with `pip install mcp`)
  2. reload the plugins     in Hermes Desktop: Ctrl+K -> "Reload desktop plugins"
  3. enable it              Capabilities -> Plugins -> "Trader's Agent" -> on
  4. click the row          left sidebar -> "Trader's Agent"

The chart docks on the right, beside whatever chat you are already in — the row does not switch your
session. If the pane cannot be shown, the page renders the console itself rather than an empty page.
If the page looks stale after editing the console's files,
switch to another session and back (or restart the app) so the frame reloads.
EOF
