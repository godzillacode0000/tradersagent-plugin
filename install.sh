#!/usr/bin/env bash
# Install the Trader's Agent plugin into Hermes Desktop.
#
#   ./install.sh                    copy plugin/ -> $HERMES_HOME/desktop-plugins/traders-desk/
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

mkdir -p "$DST"
cp "$HERE/plugin/plugin.js" "$HERE/plugin/plugin.expect.json" "$DST/"
echo "plugin installed -> $DST"

if [[ "${1:-}" == "--vendor" ]]; then
  V="$HERE/console/frontend/vendor"
  mkdir -p "$V"
  curl -fsSL -o "$V/vela.global.min.js" \
    https://cdn.jsdelivr.net/npm/@luxalgo/vela@0.7.3/dist/vela.global.min.js
  curl -fsSL -o "$V/vela-pinets.global.min.js" \
    https://cdn.jsdelivr.net/npm/@luxalgo/vela-pinets@0.2.12/dist/vela-pinets.global.min.js
  echo "fetched LuxAlgo's pinned builds into console/frontend/vendor/ (local offline copy, git-ignored)"
fi

cat <<'EOF'

Next:
  1. start the console      ./console/start.sh          (needs python3 with `pip install mcp`)
  2. reload the plugins     in Hermes Desktop: Ctrl+K -> "Reload desktop plugins"
  3. enable it              Capabilities -> Plugins -> "Trading Desk" -> on
  4. click the row          left sidebar -> "Trader's Agent"

The console opens in the main zone. If the page looks stale after editing the console's files,
switch to another session and back (or restart the app) so the frame reloads.
EOF
