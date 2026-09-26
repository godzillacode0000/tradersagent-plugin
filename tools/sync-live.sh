#!/usr/bin/env bash
# Copy the repo's console (source of truth) onto the live luxalgo-web tree this machine serves.
#
#   ./tools/sync-live.sh            copy frontend/backend/bin, then say what to reload
#   LIVE=/other/path ./tools/sync-live.sh
#
# Never copies start.sh / mvp_server.py — those are live-machine launchers.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="${LIVE:-$HOME/Projects/luxalgo-web}"

if [[ ! -d "$LIVE/frontend" || ! -d "$LIVE/backend" ]]; then
  echo "live tree not found at $LIVE (set LIVE=)" >&2
  exit 1
fi

cp "$HERE"/console/frontend/*.js "$HERE"/console/frontend/*.css "$HERE"/console/frontend/index.html \
  "$LIVE/frontend/"
cp "$HERE"/console/backend/{server.py,chart_bridge.py,chart_stream.py,agents_store.py,chat.py,backtest_service.py} \
  "$LIVE/backend/"
cp "$HERE"/console/bin/trader-chart "$LIVE/bin/trader-chart"
chmod +x "$LIVE/bin/trader-chart"

echo "synced repo → $LIVE"
echo "reload the console:  $LIVE/bin/trader-chart reload"
echo "plugin.js:           ./install.sh  then Ctrl+K → Reload desktop plugins"
echo "MCP tools:           new Hermes session (or /reload-mcp)"
