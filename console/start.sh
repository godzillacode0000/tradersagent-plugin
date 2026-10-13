#!/usr/bin/env bash
# Start the Trader's Agent console.
#
# One process does both jobs: it proxies the LuxAlgo MCP server over plain JSON HTTP endpoints, and
# it serves the static frontend from the same origin.
#
#   ./start.sh                       -> richer backend (server.py): search, indicators, concepts,
#                                       edge stats, prop firms, offers
#   ./start.sh --mvp                 -> minimal fallback backend (mvp_server.py)
#   PORT=9000 ./start.sh             -> different port
#   PY=/path/to/python ./start.sh    -> the python that has the `mcp` client
#   ./start.sh --no-mcp              -> boot without the MCP session (UI + chart only)
#
# The only non-stdlib dependency is the `mcp` client package (`pip install mcp`).
# Then open http://127.0.0.1:8787/
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
cd "$HERE/backend"

# Prefer the repo-local .venv when PY is not set (the macOS one-time setup creates it; docs/MACOS.md).
# PYTHONPATH/PYTHONHOME are scrubbed for every probe and for the exec: an agent session can export a
# PYTHONPATH pointing at a DIFFERENT interpreter's site-packages, which shadows the venv's own and
# makes a healthy interpreter read as broken.
if [[ -z "${PY:-}" && -x "$REPO_ROOT/.venv/bin/python" ]] \
   && env -u PYTHONPATH -u PYTHONHOME "$REPO_ROOT/.venv/bin/python" -c 'import mcp' >/dev/null 2>&1; then
  PY="$REPO_ROOT/.venv/bin/python"
fi
PY="${PY:-python3}"
PORT="${PORT:-8787}"

if [[ " ${*:-} " != *" --no-mcp "* ]]; then
  if ! env -u PYTHONPATH -u PYTHONHOME "$PY" -c 'import mcp' >/dev/null 2>&1; then
    echo "start.sh: '$PY' has no 'mcp' client." >&2
    echo "          pip install mcp   (or set PY=/path/to/a/python/that/has/it)" >&2
    echo "          macOS: create the repo venv once ->" >&2
    echo "            python3.12 -m venv \"$REPO_ROOT/.venv\" && \"$REPO_ROOT/.venv/bin/pip\" install 'mcp>=1,<3'" >&2
    exit 1
  fi
fi

if [[ "${1:-}" == "--mvp" ]]; then
  shift
  exec env -u PYTHONPATH -u PYTHONHOME "$PY" mvp_server.py --port "$PORT" --frontend ../frontend "$@"
fi

exec env -u PYTHONPATH -u PYTHONHOME "$PY" server.py --port "$PORT" --frontend ../frontend "$@"
