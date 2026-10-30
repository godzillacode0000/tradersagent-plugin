#!/usr/bin/env bash
# macOS (launchd) service helper — the counterpart of the README's systemd user unit.
#
#   ./console/service-macos.sh install [--port N]   write the LaunchAgent and load it
#   ./console/service-macos.sh uninstall            unload it and remove the plist
#   ./console/service-macos.sh status               loaded? console answering? where are the logs?
#
# The agent runs ./console/start.sh at login and restarts it if it exits
# (launchd KeepAlive ≈ systemd Restart=always). Label: com.traders-agent.console
# Plist: ~/Library/LaunchAgents/com.traders-agent.console.plist
# Logs:  ~/.local/state/traders-agent/console.out.log / console.err.log
#
# TRADERS_AGENT_INSTANCE=NAME (backend/instance.py) runs a separate desk beside the default one: label
# com.traders-agent.console.NAME, its own plist and logs under ~/.local/state/traders-agent/instances/NAME/.
set -euo pipefail

[[ "$(uname -s)" == "Darwin" ]] || { echo "service-macos.sh: macOS only (Linux uses the systemd unit in the README)" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
LABEL="com.traders-agent.console"
STATE_DIR="$HOME/.local/state/traders-agent"
PORT="${PORT:-8787}"
INSTANCE="${TRADERS_AGENT_INSTANCE:-}"
[[ "$INSTANCE" == "default" ]] && INSTANCE=""
if [[ -n "$INSTANCE" ]]; then
  [[ "$INSTANCE" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]] || { echo "service-macos.sh: TRADERS_AGENT_INSTANCE must be 1-32 lowercase letters, digits or dashes, got '$INSTANCE'" >&2; exit 2; }
  LABEL="$LABEL.$INSTANCE"
  STATE_DIR="$STATE_DIR/instances/$INSTANCE"
fi
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# launchd services get a minimal PATH, but the console shells out: `node` drives the Edge Stats
# sidecar, and `hermes` is what the in-app study bridge starts. Bake the node directory (and the
# user bin dir) found at install time into the plist's PATH.
NODE_DIR=""
if command -v node >/dev/null 2>&1; then NODE_DIR="$(cd "$(dirname "$(command -v node)")" && pwd)"; fi
SVC_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin"
[[ -n "$NODE_DIR" ]] && SVC_PATH="$NODE_DIR:$SVC_PATH"

# The preview resizer (backend/library_thumbs.py) is a CLI, and a service PATH can miss it: bake the
# absolute path found at install time into the plist, or every catalogue thumbnail is served at full
# size (1600×1000, ~93 KB, ~2.6 s each) and never cached — measured 17 Oct 2026, the live service
# had no converter on its PATH. A re-install keeps the value written before; the environment wins.
RESIZER="${TRADERS_AGENT_RESIZER:-}"
if [[ -z "$RESIZER" && -f "$PLIST" ]]; then
  RESIZER="$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:TRADERS_AGENT_RESIZER' "$PLIST" 2>/dev/null || true)"
fi
if [[ -z "$RESIZER" ]]; then
  for cand in vips magick convert ffmpeg; do
    if command -v "$cand" >/dev/null 2>&1; then RESIZER="$(command -v "$cand")"; break; fi
  done
fi

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

resolve_py() {
  # Probes scrub PYTHONPATH/PYTHONHOME: an agent session can export a PYTHONPATH pointing at a
  # DIFFERENT interpreter's site-packages, which shadows the venv's own and makes a healthy
  # interpreter read as broken (seen on macOS with python3.14 packages against a py3.12 venv).
  if [[ -n "${PY:-}" ]]; then echo "$PY"; return 0; fi
  if [[ -x "$ROOT/.venv/bin/python" ]] && env -u PYTHONPATH -u PYTHONHOME "$ROOT/.venv/bin/python" -c 'import mcp' >/dev/null 2>&1; then
    echo "$ROOT/.venv/bin/python"; return 0
  fi
  local cand
  for cand in python3.14 python3.13 python3.12 python3.11 python3; do
    if command -v "$cand" >/dev/null 2>&1 && env -u PYTHONPATH -u PYTHONHOME "$cand" -c 'import mcp' >/dev/null 2>&1; then
      command -v "$cand"; return 0
    fi
  done
  return 1
}

wait_health() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

cmd_install() {
  local PY_RESOLVED
  if ! PY_RESOLVED="$(resolve_py)"; then
    echo "service-macos.sh: no python3.11+ with the 'mcp' client found." >&2
    echo "  Create the repo venv first (docs/MACOS.md):" >&2
    echo "    python3.12 -m venv \"$ROOT/.venv\" && \"$ROOT/.venv/bin/pip\" install 'mcp>=1,<3'" >&2
    exit 1
  fi
  # Preserve a previously installed extra-hosts value when the shell does not supply one: a
  # re-install must not silently drop the tailnet name that phone access relies on.
  local PREV_ALLOWED="" ALLOWED_HOSTS=""
  if [[ -f "$PLIST" ]]; then
    PREV_ALLOWED="$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:TRADERS_AGENT_ALLOWED_HOSTS' "$PLIST" 2>/dev/null || true)"
  fi
  ALLOWED_HOSTS="${TRADERS_AGENT_ALLOWED_HOSTS:-$PREV_ALLOWED}"
  mkdir -p "$HOME/Library/LaunchAgents" "$STATE_DIR"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$ROOT/console/start.sh")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>$PORT</string>
    <key>TRADERS_AGENT_INSTANCE</key>
    <string>$(xml_escape "$INSTANCE")</string>
    <key>PY</key>
    <string>$(xml_escape "$PY_RESOLVED")</string>
    <key>TRADERS_AGENT_ALLOWED_HOSTS</key>
    <string>$(xml_escape "$ALLOWED_HOSTS")</string>
    <key>TRADERS_AGENT_RESIZER</key>
    <string>$(xml_escape "$RESIZER")</string>
    <key>PATH</key>
    <string>$(xml_escape "$SVC_PATH")</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$ROOT")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$STATE_DIR/console.out.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$STATE_DIR/console.err.log")</string>
</dict>
</plist>
PLIST_EOF
  # Replace any previous load, then bootstrap (fall back to the legacy `load -w` on old macOS).
  # A bootout can need a beat before the same label re-bootstraps (macOS answers EIO 5 otherwise);
  # retry once before falling back.
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  sleep 1
  if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1; then
    sleep 2
    if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1; then
      launchctl load -w "$PLIST"
    fi
  fi
  echo "service installed -> $PLIST"
  echo "  python: $PY_RESOLVED · port: $PORT"
  if [[ -n "$NODE_DIR" ]]; then
    echo "  PATH:   $NODE_DIR (node present — Edge Stats can run)"
  else
    echo "  PATH:   no node found — Edge Stats will stay off until Node.js 20+ is on PATH"
  fi
  if wait_health; then
    echo "console answered  -> http://127.0.0.1:$PORT/api/health"
  else
    echo "warning: the console is not answering yet — check $STATE_DIR/console.err.log"
  fi
}

cmd_uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload -w "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  echo "service removed   -> $PLIST"
  echo "(the console process stops with it; logs stay in $STATE_DIR)"
}

cmd_status() {
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    echo "launchd   loaded  $LABEL"
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state =|pid =|last exit" | head -5 || true
  else
    echo "launchd   not loaded"
  fi
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "console   ok      http://127.0.0.1:$PORT/api/health"
  else
    echo "console   down    (try ./console/start.sh, or check $STATE_DIR/console.err.log)"
  fi
}

case "${1:-}" in
  install)
    shift || true
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --port) PORT="${2:?--port needs a value}"; shift 2 ;;
        *) echo "service-macos.sh: unknown option '$1'" >&2; exit 2 ;;
      esac
    done
    cmd_install
    ;;
  uninstall) cmd_uninstall ;;
  status|"") cmd_status ;;
  -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "service-macos.sh: unknown command '$1' (install | uninstall | status)" >&2; exit 2 ;;
esac
