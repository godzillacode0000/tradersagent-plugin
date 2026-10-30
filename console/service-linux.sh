#!/usr/bin/env bash
# Linux service helper — the counterpart of service-macos.sh, so one command keeps the console running.
#
#   ./console/service-linux.sh install [--port N]   write the systemd user unit, enable it, wait until it answers
#   ./console/service-linux.sh uninstall            stop it and remove the unit (or stop the detached console)
#   ./console/service-linux.sh status               unit state, is the console answering, where are the logs
#   ./console/service-linux.sh print                print the unit file and change nothing
#
# Unit: ~/.config/systemd/user/traders-agent.service (the same name the README documents).
# Without a systemd user session (a container, WSL without systemd, an SSH-less box) it starts the
# console detached instead (nohup, pid file in the state dir) and says plainly that this does NOT
# survive a reboot. A console that is already answering and that this script did not start is left alone.
# Logs: ~/.local/state/traders-agent/console.log
#
# Bash 3.2 safe: no arrays, no mapfile.
set -euo pipefail

[[ "$(uname -s)" == "Linux" ]] || { echo "service-linux.sh: Linux only (macOS uses ./console/service-macos.sh)" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
UNIT_NAME="traders-agent.service"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/$UNIT_NAME"
STATE_DIR="$HOME/.local/state/traders-agent"
PIDFILE="$STATE_DIR/console.pid"
LOG="$STATE_DIR/console.log"
PORT="${PORT:-8787}"

# Environment baked into the unit: a systemd user service gets a minimal PATH, but the console shells
# out (`node` drives the Edge Stats sidecar, `hermes` starts the in-app study bridge).
NODE_DIR=""
if command -v node >/dev/null 2>&1; then NODE_DIR="$(cd "$(dirname "$(command -v node)")" && pwd)"; fi
SVC_PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
[[ -n "$NODE_DIR" ]] && SVC_PATH="$NODE_DIR:$SVC_PATH"

# systemd specifiers: a literal % in a path must be written %%. Quoted args keep spaces intact.
unit_escape() { printf '%s' "$1" | sed -e 's/%/%%/g' -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

has_mcp() { [[ -x "$1" ]] && env -u PYTHONPATH -u PYTHONHOME "$1" -c 'import mcp' >/dev/null 2>&1; }
resolve_py() {
  local cand p
  if [[ -n "${PY:-}" ]]; then echo "$PY"; return 0; fi
  if has_mcp "$ROOT/.venv/bin/python"; then echo "$ROOT/.venv/bin/python"; return 0; fi
  for cand in python3.14 python3.13 python3.12 python3.11 python3; do
    p="$(command -v "$cand" 2>/dev/null || true)"
    if [[ -n "$p" ]] && has_mcp "$p"; then echo "$p"; return 0; fi
  done
  return 1
}

health() { curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; }
wait_health() {
  local i
  for i in $(seq 1 40); do   # 40 x 0.5 s: the console needs a few seconds to open its MCP session
    if health; then return 0; fi
    sleep 0.5
  done
  return 1
}

have_user_systemd() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1
}

unit_text() {   # $1 = interpreter
  cat <<UNIT_EOF
[Unit]
Description=Trader's Agent console (LuxAlgo MCP proxy + Vela chart)
After=network-online.target

[Service]
Environment="PORT=$PORT"
Environment="PY=$(unit_escape "$1")"
Environment="PATH=$(unit_escape "$SVC_PATH")"
WorkingDirectory=$(unit_escape "$ROOT")
ExecStart=/bin/bash "$(unit_escape "$ROOT/console/start.sh")"
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT_EOF
}

stop_detached() {
  if [[ -f "$PIDFILE" ]]; then
    local pid; pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; echo "stopped the detached console (pid $pid)"; fi
    rm -f "$PIDFILE"
  fi
}

cmd_install() {
  local PYR
  if ! PYR="$(resolve_py)"; then
    echo "service-linux.sh: no python with the 'mcp' client found. Run ./bin/setup-python.sh first." >&2
    exit 1
  fi
  mkdir -p "$STATE_DIR"

  # A console somebody started themselves (a terminal, the developer's own unit): do not fight it for the port.
  if health && [[ ! -f "$UNIT" ]] && [[ ! -f "$PIDFILE" ]]; then
    echo "ok  a console is already answering on port $PORT (not started by this script) — leaving it alone"
    return 0
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet luxalgo-web.service 2>/dev/null; then
    echo "ok  luxalgo-web.service is already running the console — not installing a second unit"
    return 0
  fi

  if have_user_systemd; then
    stop_detached
    mkdir -p "$UNIT_DIR"
    unit_text "$PYR" > "$UNIT"
    systemctl --user daemon-reload
    systemctl --user enable --now "$UNIT_NAME" >/dev/null 2>&1 || { echo "service-linux.sh: could not enable $UNIT_NAME (journalctl --user -u $UNIT_NAME)" >&2; exit 1; }
    systemctl --user restart "$UNIT_NAME"
    if wait_health; then
      echo "ok  console running as $UNIT_NAME on port $PORT (starts at login; logs: journalctl --user -u $UNIT_NAME)"
    else
      echo "warning: $UNIT_NAME is enabled but the console is not answering after 20 s" >&2
      echo "         check: journalctl --user -u $UNIT_NAME -n 30" >&2
      exit 1
    fi
  else
    stop_detached
    echo "note: no systemd user session here — starting the console detached (it will NOT survive a reboot)"
    # exec inside the subshell: the recorded pid is the console itself (not a wrapper), and nothing keeps
    # the caller's stdout open (a lingering wrapper made `./install.sh --all | tee log` hang until the console died).
    ( cd "$ROOT" && exec env PORT="$PORT" PY="$PYR" PATH="$SVC_PATH:$PATH" nohup bash "$ROOT/console/start.sh" >>"$LOG" 2>&1 < /dev/null ) &
    echo $! > "$PIDFILE"
    if wait_health; then
      echo "ok  console running detached on port $PORT (pid $(cat "$PIDFILE"); logs: $LOG)"
      echo "    to keep it across reboots, run ./console/start.sh from your own session manager"
    else
      echo "warning: the detached console is not answering after 20 s — see $LOG" >&2
      exit 1
    fi
  fi
}

cmd_uninstall() {
  if have_user_systemd && [[ -f "$UNIT" ]]; then
    systemctl --user disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
    rm -f "$UNIT"
    systemctl --user daemon-reload
    echo "removed $UNIT"
  else
    echo "no $UNIT_NAME to remove"
  fi
  stop_detached
}

cmd_status() {
  if have_user_systemd && [[ -f "$UNIT" ]]; then
    echo "unit     $UNIT_NAME: $(systemctl --user is-active "$UNIT_NAME" 2>/dev/null || true), enabled: $(systemctl --user is-enabled "$UNIT_NAME" 2>/dev/null || true)"
  else
    echo "unit     none installed"
  fi
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then echo "detached running, pid $(cat "$PIDFILE")"; fi
  if health; then echo "console  answering on http://127.0.0.1:$PORT/"; else echo "console  NOT answering on port $PORT"; fi
  echo "logs     journalctl --user -u $UNIT_NAME   |   $LOG"
}

cmd="${1:-}"; [[ $# -gt 0 ]] && shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) [[ $# -ge 2 ]] || { echo "service-linux.sh: --port needs a number" >&2; exit 2; }; PORT="$2"; shift ;;
    *) echo "service-linux.sh: unknown option '$1'" >&2; exit 2 ;;
  esac
  shift
done
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] || { echo "service-linux.sh: PORT must be a number, got '$PORT'" >&2; exit 2; }

case "$cmd" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  status)    cmd_status ;;
  print)     PYR="$(resolve_py || echo python3)"; unit_text "$PYR" ;;
  -h|--help|"") sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; [[ -n "$cmd" ]] || exit 2 ;;
  *) echo "service-linux.sh: unknown command '$cmd' (install | uninstall | status | print)" >&2; exit 2 ;;
esac
