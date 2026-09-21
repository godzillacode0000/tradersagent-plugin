#!/usr/bin/env bash
# Is the desktop half of Trader's Agent actually on?
#
# `install.sh --doctor` answers "are the files in place". This answers the question that actually
# cost an afternoon: the app keeps its own enable/disable decision, desktop plugins ship OFF by
# default, and an installed-but-disabled plugin looks identical to a broken one — no row, no pane,
# no message. This reads that decision and says it out loud.
#
#   ./bin/is-enabled.sh          report only
#   ./bin/is-enabled.sh --help
#
# Exit codes: 0 enabled · 1 disabled or not installed · 2 could not read
set -u

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$HERMES_HOME/desktop-plugins/traders-desk"
ID="traders-desk"

case "${1:-}" in
  -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

say() { printf '%s\n' "$*"; }

if [ ! -f "$PLUGIN_DIR/plugin.js" ]; then
  say "NOT INSTALLED — no $PLUGIN_DIR/plugin.js"
  say "Run ./install.sh first."
  exit 1
fi
say "files      ok    $PLUGIN_DIR/plugin.js"

# The app stores its decisions in the renderer's localStorage, which is a LevelDB (not a text file),
# so a plain grep cannot answer this. Look for the id next to its value, tolerating LevelDB's
# surrounding bytes.
STORE=""
for candidate in "$HOME/.config/Hermes/Default/Local Storage/leveldb" \
                 "$HOME/.config/hermes-desktop/Local Storage/leveldb" \
                 "$HOME/.config/Hermes/Local Storage/leveldb"; do
  [ -d "$candidate" ] && STORE="$candidate" && break
done

if [ -z "$STORE" ]; then
  say "decision   ?     no app storage found — is Hermes Desktop installed for this user?"
  exit 2
fi

# pluginDecisions.v2 holds {id: bool}. Find the newest table that mentions our id with a value.
HIT="$(grep -a -o "\"$ID\":[a-z]*" "$STORE"/*.ldb "$STORE"/*.log 2>/dev/null | tail -1 | sed 's/.*://')"

case "$HIT" in
  true)
    say "decision   on    the app has $ID enabled"
    say ""
    say "Open it: click the Trader's Agent row in the sidebar, or Ctrl+K -> Trader's Agent."
    exit 0
    ;;
  false)
    say "decision   OFF   the app has $ID disabled (this is the default for desktop plugins)"
    say ""
    say "Nothing will appear until you switch it on — that is why an installed plugin can look broken."
    say "Enable: Capabilities -> Plugins -> Trader's Agent, or Ctrl+K -> plugins."
    exit 1
    ;;
  *)
    say "decision   ?     $ID not found in the app's decision store"
    say ""
    say "The app has never seen this plugin. Enable it: Capabilities -> Plugins -> Trader's Agent."
    exit 1
    ;;
esac
