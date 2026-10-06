#!/usr/bin/env bash
# Copy the repo's console (source of truth) onto the live luxalgo-web tree this machine serves.
#
#   ./tools/sync-live.sh            copy frontend/backend/bin, then say what to reload
#   LIVE=/other/path ./tools/sync-live.sh
#
# Never copies start.sh / mvp_server.py — those are live-machine launchers.
#
# The backend list below is explicit, so a NEW module must be added here or the live server dies on
# `ModuleNotFoundError` at start-up and systemd restarts it forever (measured 26 Sep 2026, the night
# the preview cache shipped). test_sync_live_covers_every_module.py keeps that list honest.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="${LIVE:-$HOME/Projects/luxalgo-web}"

if [[ ! -d "$LIVE/frontend" || ! -d "$LIVE/backend" ]]; then
  echo "live tree not found at $LIVE (set LIVE=)" >&2
  exit 1
fi

cp "$HERE"/console/frontend/*.js "$HERE"/console/frontend/*.css "$HERE"/console/frontend/index.html \
  "$LIVE/frontend/"
# The vendored browser families travel with the repo (see THIRD-PARTY.md / vendor/VENDORING.md, and
# vendor/pinets/PROVENANCE.md): the import map and the script tags serve them from ./vendor/, so a
# sync that skips one 404s it and the page dies at boot ("Failed to fetch dynamically imported
# module"). Mirrored (rm -rf + cp -r), not merged: releases rename their content-hashed chunk-*.js
# files — the vela 0.7.3 -> 0.8.1 move renamed six — and a stale chunk left behind is exactly the
# kind of half-upgraded tree this tree used to suffer. The *.js glob above does not descend, hence
# this line.
for fam in pinets vela vela-pinets zag; do
  rm -rf "$LIVE/frontend/vendor/$fam"
  mkdir -p "$LIVE/frontend/vendor/$fam"
  cp -r "$HERE/console/frontend/vendor/$fam/." "$LIVE/frontend/vendor/$fam/"
done
# The bundled extra indicator scripts (licence-gated: MIT/MPL-2.0 only — see THIRD-PARTY.md and
# test_extra_scripts.py) live in their own directory for the same reason the vendor families do:
# the *.js glob above does not descend. Mirrored, not merged, so a removed script cannot linger.
rm -rf "$LIVE/frontend/extra"
mkdir -p "$LIVE/frontend/extra"
cp -r "$HERE/console/frontend/extra/." "$LIVE/frontend/extra/"
cp "$HERE"/console/backend/{server.py,chart_bridge.py,chart_stream.py,agents_store.py,chat.py,backtest_service.py,library_thumbs.py,broker.py,edgestats.py} \
  "$LIVE/backend/"
cp "$HERE"/console/bin/trader-chart "$LIVE/bin/trader-chart"
# `trader-chart edge …` prints through the same renderer the MCP tools use. The live tree has no mcp/
# folder (the MCP server runs from the repo checkout), so the module travels beside the CLI — which
# looks next to itself first (see _edge_text in trader-chart).
cp "$HERE"/console/mcp/edge_text.py "$LIVE/bin/edge_text.py"
chmod +x "$LIVE/bin/trader-chart"

echo "synced repo → $LIVE"
echo "reload the console:  $LIVE/bin/trader-chart reload"
echo "plugin.js:           ./install.sh  then Ctrl+K → Reload desktop plugins"
echo "MCP tools:           new Hermes session (or /reload-mcp)"
