#!/usr/bin/env bash
# Install the Trader's Agent plugin into Hermes Desktop.
#
#   ./install.sh                    copy plugin/ -> $HERMES_HOME/desktop-plugins/traders-desk/ and the desk skill
#   ./install.sh --doctor           check interpreter, console port, service, plugin folder
#   ./install.sh --uninstall        remove the installed plugin and the desk skill (prints what is left to undo)
#   ./install.sh --with-backtest    also install the optional vectorbt backtesting engine
#                                   into ~/.local/share/traders-agent/bt/venv (~840 MB, once)
#   ./install.sh --with-edge        also install LuxAlgo's open-source Edge Stats engine (MIT, pinned
#                                   commit) into ~/.local/share/traders-agent/edge/engine (~300 MB,
#                                   needs Node 20+ and git; the pane's Edge Stats view uses it)
#   ./install.sh --help             this text
#   HERMES_HOME=/path ./install.sh  install into another Hermes home
#   PORT=9000 ./install.sh          point the installed plugin at a console on another port
#
# Flags may be combined in any order. An unknown flag is an error: it never installs by accident.
# To refresh the vendored Vela / PineTS builds see console/frontend/vendor/VENDORING.md.
#
# This script does not start the console: the plugin only frames it, so the console must be
# listening on http://127.0.0.1:$PORT (see console/start.sh and the README's service section).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DST="$HERMES_HOME/desktop-plugins/traders-desk"
SKILL_DST="$HERMES_HOME/skills/trading/trader-desk"
PORT="${PORT:-8787}"
CONSOLE_URL="${LUXALGO_CONSOLE:-http://127.0.0.1:$PORT}"

usage() { sed -n '2,/^# listening on/p' "$0" | sed 's/^# \{0,1\}//'; }

DOCTOR=0 UNINSTALL=0 WITH_BT=0 WITH_EDGE=0
for arg in "$@"; do
  case "$arg" in
    -h|--help)       usage; exit 0 ;;
    --doctor)        DOCTOR=1 ;;
    --uninstall)     UNINSTALL=1 ;;
    --with-backtest) WITH_BT=1 ;;
    --with-edge)     WITH_EDGE=1 ;;
    --vendor)        echo "install.sh: --vendor was removed (it rewrote committed files without checking them); see console/frontend/vendor/VENDORING.md" >&2; exit 2 ;;
    *)               echo "install.sh: unknown option '$arg'" >&2; usage >&2; exit 2 ;;
  esac
done
if ! [[ "$PORT" =~ ^[0-9]{1,5}$ ]]; then echo "install.sh: PORT must be a number, got '$PORT'" >&2; exit 2; fi

if [[ $UNINSTALL -eq 1 ]]; then
  rm -rf "$DST" "$SKILL_DST"
  echo "removed $DST"
  echo "removed $SKILL_DST"
  echo "still yours to undo, if you want a clean machine:"
  echo "  hermes mcp remove traders-chart            (the MCP registration)"
  echo "  systemctl --user disable --now traders-agent.service   (if you installed the unit)"
  echo "  ~/.local/state/traders-agent/ (token, paper account)   ~/.local/share/traders-agent/ (caches, Edge Stats, backtest venv)"
  exit 0
fi

if [[ $DOCTOR -eq 1 ]]; then
  fail=0
  check() { # $1 label, then the command and its arguments (run directly: no eval, so a path with $ or quotes is just a path)
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then echo "  ok  $label"; else echo "  FAIL $label"; fail=1; fi
  }
  echo "Trader's Agent — install doctor"
  check "python3 on PATH" command -v python3
  check "python3 is 3.11 or newer" python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'
  check "python3 has the mcp client (pip install mcp)" python3 -c 'import mcp'
  check "plugin.js in repo" test -f "$HERE/plugin/plugin.js"
  check "MCP server in repo" test -f "$HERE/console/mcp/server.py"
  check "console answering on $CONSOLE_URL" curl -fsS --max-time 3 "$CONSOLE_URL/api/health"
  # Only this development machine carries luxalgo-web.service; a fresh install follows the README and
  # runs traders-agent.service instead. Checking the machine-specific unit unconditionally made
  # `--doctor` FAIL on every other install, which is exactly the first thing a new user runs.
  if systemctl --user list-unit-files luxalgo-web.service >/dev/null 2>&1; then
    check "luxalgo-web.service active (this machine)" systemctl --user is-active luxalgo-web.service
  elif systemctl --user list-unit-files traders-agent.service >/dev/null 2>&1; then
    check "traders-agent.service active" systemctl --user is-active traders-agent.service
  else
    check "console reachable (no user unit installed)" curl -fsS --max-time 3 "$CONSOLE_URL/api/health"
  fi
  check "plugin deployed" test -f "$DST/plugin.js"
  check "desk skill deployed" test -f "$SKILL_DST/SKILL.md"
  if command -v hermes >/dev/null 2>&1; then
    if hermes mcp list 2>/dev/null | grep -q "traders-chart"; then echo "  ok  MCP server registered (traders-chart)"
    else echo "  FAIL MCP server not registered: see the 'Next' step of ./install.sh"; fail=1; fi
  else
    echo "  --  hermes CLI not on PATH, MCP registration not checked"
  fi
  # Optional pieces are reported, never failed: a machine without them is a normal install.
  EDGE_HOME="${TRADERS_EDGE_HOME:-$HOME/.local/share/traders-agent/edge}"
  if [[ -x "$EDGE_HOME/engine/node_modules/.bin/tsx" ]]; then
    echo "  ok  Edge Stats engine installed (optional)"
  else
    echo "  --  Edge Stats engine not installed (optional: ./install.sh --with-edge)"
  fi
  if [[ $fail -ne 0 ]]; then
    echo "one or more checks failed — start the console (./console/start.sh or the user unit) and ./install.sh"
    exit 1
  fi
  echo "all checks passed"
  exit 0
fi

mkdir -p "$DST"
cp "$HERE/plugin/plugin.js" "$HERE/plugin/plugin.expect.json" "$DST/"
if [[ "$PORT" != "8787" ]]; then
  # The frame points at one hard-coded origin; a console on another port needs the installed copy (not the repo) changed.
  sed -i "s#const CONSOLE_ORIGIN = 'http://127.0.0.1:8787/'#const CONSOLE_ORIGIN = 'http://127.0.0.1:$PORT/'#" "$DST/plugin.js"
  grep -q "127.0.0.1:$PORT/" "$DST/plugin.js" || { echo "install.sh: could not point the plugin at port $PORT" >&2; exit 1; }
  echo "plugin installed -> $DST (console port $PORT)"
else
  echo "plugin installed -> $DST"
fi

# The desk skill: the tool order, the one-indicator-at-a-time rule, and how to read the engine's
# failure codes. The desk study loads it by name (console/backend/agents_store.py).
mkdir -p "$SKILL_DST"
cp "$HERE/skills/trader-desk/SKILL.md" "$SKILL_DST/SKILL.md"
echo "desk skill       -> $SKILL_DST"

if [[ $WITH_BT -eq 1 ]]; then
  # Optional, and never a default: vectorbt pulls pandas + numba (~840 MB) and needs the network
  # once. It lives in its own venv so the console stays stdlib-only, and it is plain `vectorbt`
  # — not vectorbtpro (commercial) and not the [full] extras (TA-Lib and friends carry their own,
  # stricter licences). See THIRD-PARTY.md.
  BT="$HOME/.local/share/traders-agent/bt"
  if [[ -x "$BT/venv/bin/python" ]] && "$BT/venv/bin/python" -c 'import vectorbt' >/dev/null 2>&1; then
    echo "backtest engine already installed at $BT/venv (skipping)"
  else
    echo "installing the backtest engine (vectorbt) into $BT/venv — this downloads ~840 MB once"
    mkdir -p "$BT"
    rm -rf "$BT/venv"   # a half-made venv from a failed earlier run is rebuilt, not trusted
    python3 -m venv "$BT/venv"
    "$BT/venv/bin/pip" install --quiet --upgrade pip
    "$BT/venv/bin/pip" install --quiet vectorbt
    echo "done. start it with:"
    echo "  ~/.local/share/traders-agent/bt/venv/bin/python console/backend/backtest_service.py --port 8788"
  fi
fi

if [[ $WITH_EDGE -eq 1 ]]; then
  # Optional, and never a default — the same shape as --with-backtest: NOT bundled, fetched once into
  # its own folder, so the console stays stdlib-only and the plugin works with or without it. This is
  # LuxAlgo/edge-stats (MIT): P(outcome | conditions) with the sample size and a Wilson 95% interval on
  # every number, computed over bars you download yourself. The commit is PINNED (the console pins the
  # same one — a test fails if the two drift), so an upstream change never reaches a user unreviewed.
  # See THIRD-PARTY.md.
  EDGE_COMMIT="a48259887962d0f67a27d2b0815e2df9a52efca5"
  EDGE_HOME="${TRADERS_EDGE_HOME:-$HOME/.local/share/traders-agent/edge}"
  EDGE_DIR="${EDGESTATS_ENGINE:-$EDGE_HOME/engine}"

  if ! command -v node >/dev/null 2>&1; then
    echo "Edge Stats needs Node.js 20 or newer (https://nodejs.org) — install it, then run this again" >&2
    exit 1
  fi
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$NODE_MAJOR" -lt 20 ]]; then
    echo "Edge Stats needs Node.js 20 or newer; found $(node --version) — upgrade it, then run this again" >&2
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    echo "Edge Stats needs git to fetch the pinned commit" >&2
    exit 1
  fi
  # pnpm: use it if present, else corepack (ships with Node), else npx. The repo pins pnpm 11.
  if command -v pnpm >/dev/null 2>&1; then PNPM=(pnpm)
  elif command -v corepack >/dev/null 2>&1; then PNPM=(corepack pnpm)
  else PNPM=(npx --yes pnpm@11.0.8); fi

  if [[ -x "$EDGE_DIR/node_modules/.bin/tsx" ]] && \
     [[ "$(git -C "$EDGE_DIR" rev-parse HEAD 2>/dev/null || true)" == "$EDGE_COMMIT" ]]; then
    echo "Edge Stats engine already installed at $EDGE_DIR (pinned ${EDGE_COMMIT:0:7}) — skipping"
  else
    echo "installing the Edge Stats engine (LuxAlgo/edge-stats @ ${EDGE_COMMIT:0:7}) into $EDGE_DIR — needs the network once"
    mkdir -p "$(dirname "$EDGE_DIR")"
    if [[ ! -d "$EDGE_DIR/.git" ]]; then
      git clone --quiet https://github.com/LuxAlgo/edge-stats "$EDGE_DIR"
    else
      git -C "$EDGE_DIR" fetch --quiet origin
    fi
    git -C "$EDGE_DIR" checkout --quiet --detach "$EDGE_COMMIT"
    (cd "$EDGE_DIR" && "${PNPM[@]}" install --frozen-lockfile --silent)
    # Prove it starts before saying it is installed: a half-installed engine would otherwise first
    # fail inside the pane, where the cause is invisible.
    if ! (cd "$EDGE_DIR" && node_modules/.bin/tsx packages/cli/src/index.ts --help >/dev/null 2>&1); then
      echo "the engine installed but does not start — try: cd $EDGE_DIR && node_modules/.bin/tsx packages/cli/src/index.ts --help" >&2
      exit 1
    fi
    echo "Edge Stats engine installed -> $EDGE_DIR"
  fi
  echo "next: open the pane, ⋯ -> Edge Stats, and load the demo data (or download BTCUSDT)"
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
    if curl -fsS --max-time 2 "$CONSOLE_URL/api/health" >/dev/null 2>&1; then ready=1; break; fi
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
  5. give the agent its tools (once):
       hermes mcp add traders-chart --command "$HOME/.hermes/bin/uvx" --args fastmcp run "<this folder>/console/mcp/server.py"
     (add --env LUXALGO_CONSOLE=http://127.0.0.1:<port> if the console is not on 8787; ./install.sh --doctor checks it)

The chart docks on the right, beside whatever chat you are already in — the row does not switch your
session. If the pane cannot be shown, the page renders the console itself rather than an empty page.
If the page looks stale after editing the console's files,
switch to another session and back (or restart the app) so the frame reloads.
EOF
