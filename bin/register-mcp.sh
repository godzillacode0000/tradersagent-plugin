#!/usr/bin/env bash
# bin/register-mcp.sh — give the agent the chart's tools (once, idempotent).
#
#   ./bin/register-mcp.sh            register `traders-chart` if it is not registered yet
#   ./bin/register-mcp.sh --print    print the exact command line and change nothing
#   ./bin/register-mcp.sh --force    rewrite an existing registration
#
# Why this is a script and not a README line: the line it replaces carried machine-specific paths,
# and that is where a new install most often stalled — `$HOME/.hermes/bin/uvx` may not exist (macOS
# without uv), and `fastmcp run` needs a client that only the repo's venv is guaranteed to have.
# This resolves the interpreter the same way start.sh/install.sh do, points it at
# console/mcp/server.py, and leaves an EXISTING registration alone by default: it may be the
# operator's own choice of python, and overwriting it silently would be the wrong kind of helpful.
#
# HERMES_HOME is exported to `hermes mcp add` when set, so a profile-scoped session registers the
# server in the profile it is running as.
#
# Written for bash 3.2 (macOS /bin/bash): no arrays, so nothing expands `"${arr[@]}"` under set -u.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PY="$HERE/console/mcp/server.py"
PORT="${PORT:-8787}"
CONSOLE_URL="${LUXALGO_CONSOLE:-http://127.0.0.1:$PORT}"
PRINT=0 FORCE=0

for arg in "$@"; do
  case "$arg" in
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --print)   PRINT=1 ;;
    --force)   FORCE=1 ;;
    *) echo "register-mcp.sh: unknown option '$arg'" >&2; exit 2 ;;
  esac
done

has_mcp_client() { "$1" -c 'import mcp' >/dev/null 2>&1; }

# The same order start.sh uses: PY wins (an explicit choice), then the repo's own venv, then a
# python3.11+ on PATH with the client, then uvx — which carries fastmcp itself. `$PY` is not
# trusted blindly: it may point at an interpreter without the client.
CMD="" LAUNCHER="python" KIND=""
if [[ -n "${PY:-}" && -x "${PY:-/nonexistent}" ]] && has_mcp_client "$PY"; then
  CMD="$PY" ; KIND="PY (the interpreter you named)"
elif [[ -x "$HERE/.venv/bin/python" ]] && has_mcp_client "$HERE/.venv/bin/python"; then
  CMD="$HERE/.venv/bin/python" ; KIND="the repo's .venv"
else
  for cand in python3.13 python3.12 python3.11 python3; do
    if command -v "$cand" >/dev/null 2>&1 && has_mcp_client "$(command -v "$cand")"; then
      CMD="$(command -v "$cand")" ; KIND="$cand with the mcp client" ; break
    fi
  done
fi
if [[ -z "$CMD" ]] && command -v uvx >/dev/null 2>&1; then
  CMD="$(command -v uvx)" ; LAUNCHER="uvx" ; KIND="uvx + fastmcp (fetched on first use)"
fi

if [[ -z "$CMD" ]]; then
  cat >&2 <<EOF
register-mcp.sh: no interpreter with the mcp client found.
  The console's own setup fixes this: the one-time step in docs/MACOS.md (macOS), or
  'pip install mcp' for the python you run ./console/start.sh with.
EOF
  exit 1
fi

ENV_PAIR=""
[[ "$PORT" == "8787" ]] || ENV_PAIR="LUXALGO_CONSOLE=$CONSOLE_URL"

# `hermes mcp add` wants `--args` LAST (its parser stops there), so --env goes before it.
print_line() {
  printf 'hermes mcp add traders-chart --command %q' "$CMD"
  [[ -n "$ENV_PAIR" ]] && printf ' --env %q' "$ENV_PAIR"
  if [[ "$LAUNCHER" == "uvx" ]]; then
    printf ' --args fastmcp run %q\n' "$SERVER_PY"
  else
    printf ' --args %q\n' "$SERVER_PY"
  fi
}

if [[ $PRINT -eq 1 ]]; then
  echo "# interpreter: $KIND"
  print_line
  exit 0
fi

if ! command -v hermes >/dev/null 2>&1; then
  echo "register-mcp.sh: no 'hermes' on PATH — run this once in a terminal where it is:"
  echo "  $(print_line)"
  exit 0
fi

if [[ $FORCE -eq 0 ]] && hermes mcp list 2>/dev/null | grep -q 'traders-chart'; then
  echo "ok  traders-chart is already registered — the agent has the chart tools."
  echo "    (to point it at a different interpreter: hermes mcp remove traders-chart, then re-run)"
  exit 0
fi

# Export only when it is really set: `HERMES_HOME="" hermes …` would resolve to an empty home.
[[ -n "${HERMES_HOME:-}" ]] && export HERMES_HOME
if [[ "$LAUNCHER" == "uvx" ]]; then
  if [[ -n "$ENV_PAIR" ]]; then hermes mcp add traders-chart --command "$CMD" --env "$ENV_PAIR" --args fastmcp run "$SERVER_PY"
  else hermes mcp add traders-chart --command "$CMD" --args fastmcp run "$SERVER_PY"; fi
else
  if [[ -n "$ENV_PAIR" ]]; then hermes mcp add traders-chart --command "$CMD" --env "$ENV_PAIR" --args "$SERVER_PY"
  else hermes mcp add traders-chart --command "$CMD" --args "$SERVER_PY"; fi
fi
echo "ok  registered traders-chart with $KIND"
echo "    (tools appear in a new agent session or after /reload-mcp; ./install.sh --doctor checks it)"
