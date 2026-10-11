#!/usr/bin/env bash
# Install the Trader's Agent desk into the DeepSeek Harness (dsh): the skill and the MCP server.
#
#   ./adapters/dsh/install-dsh.sh                       copy the desk skill, build/choose the MCP launcher, print the MCP entry
#   ./adapters/dsh/install-dsh.sh --mcp-file PATH       also merge the entry into that JSON file ({"mcpServers": {...}}); a backup is kept
#   ./adapters/dsh/install-dsh.sh --skills-dir DIR      skill folder (default $DSH_SKILLS_DIR, else ~/.agents/skills)
#   ./adapters/dsh/install-dsh.sh --venv                always use a private venv with fastmcp (default: PY, .venv or a python with `mcp`, else uvx)
#   ./adapters/dsh/install-dsh.sh --doctor              check skill, launcher, a real MCP handshake and the console
#   ./adapters/dsh/install-dsh.sh --uninstall           remove the skill (and the entry from --mcp-file)
#   ./adapters/dsh/install-dsh.sh --help                this text
#   PORT=9000 ./adapters/dsh/install-dsh.sh             the console is not on 8787 (written into the MCP entry as LUXALGO_CONSOLE)
#
# What dsh gets: the `trader-desk` skill and the 56-tool `traders-chart` MCP server. What it does not
# get: the Hermes sidebar pane (plugin/plugin.js is Hermes Desktop only). In dsh, open the console in a
# browser tab at http://127.0.0.1:$PORT/ and the agent drives that same chart through the tools.
# The console itself must be running: ./console/start.sh
#
# dsh's config locations are not read from dsh itself, so nothing is written outside --skills-dir and
# --mcp-file. If your dsh keeps MCP servers elsewhere, use the printed entry as-is.
# Written for bash 3.2 (macOS /bin/bash): no mapfile, no associative arrays.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SERVER="$REPO/console/mcp/server.py"
SKILL_SRC="$REPO/skills/trader-desk/SKILL.md"
SKILLS_DIR="${DSH_SKILLS_DIR:-$HOME/.agents/skills}"
PORT="${PORT:-8787}"
CONSOLE_URL="${LUXALGO_CONSOLE:-http://127.0.0.1:$PORT}"
VENV="${TRADERS_MCP_VENV:-$HOME/.local/share/traders-agent/mcp-venv}"
NAME="traders-chart"

usage() { awk 'NR>1 && /^set -euo/{exit} NR>1{sub(/^# ?/,""); print}' "$0"; }

DOCTOR=0 UNINSTALL=0 USE_VENV=0 MCP_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)    usage; exit 0 ;;
    --doctor)     DOCTOR=1 ;;
    --uninstall)  UNINSTALL=1 ;;
    --venv)       USE_VENV=1 ;;
    --skills-dir) [[ $# -ge 2 ]] || { echo "install-dsh: --skills-dir needs a folder" >&2; exit 2; }; SKILLS_DIR="$2"; shift ;;
    --mcp-file)   [[ $# -ge 2 ]] || { echo "install-dsh: --mcp-file needs a path" >&2; exit 2; }; MCP_FILE="$2"; shift ;;
    *)            echo "install-dsh: unknown option '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] || { echo "install-dsh: PORT must be a number, got '$PORT'" >&2; exit 2; }
SKILL_DST="$SKILLS_DIR/trader-desk"

# PYTHONPATH/PYTHONHOME are scrubbed for the probe: an agent session can export one that shadows the probe's own packages.
has_mcp() { env -u PYTHONPATH -u PYTHONHOME "$1" -c 'import mcp' >/dev/null 2>&1; }

# The interpreter dsh will run, in the order bin/register-mcp.sh and start.sh use: PY (an explicit
# choice), the repo's .venv, a python3.11+ on PATH that has the `mcp` client. server.py runs on the
# plain `mcp` SDK (it falls back to mcp.server.fastmcp), so no extra package is needed for these.
find_python() {
  local cand
  if [[ -n "${PY:-}" && -x "${PY:-/nonexistent}" ]] && has_mcp "$PY"; then echo "$PY"; return 0; fi
  if [[ -x "$REPO/.venv/bin/python" ]] && has_mcp "$REPO/.venv/bin/python"; then echo "$REPO/.venv/bin/python"; return 0; fi
  for cand in python3.13 python3.12 python3.11 python3; do
    if command -v "$cand" >/dev/null 2>&1 && has_mcp "$(command -v "$cand")"; then command -v "$cand"; return 0; fi
  done
  return 1
}

# The command dsh will run, one element per line, command first. Order: an interpreter that already has
# the mcp client; else uvx (fetches fastmcp on first use); else a private venv holding fastmcp.
# --venv skips straight to the private venv.
launcher() {
  local py
  if [[ $USE_VENV -eq 0 ]] && py="$(find_python)"; then
    printf '%s\n' "$py" "$SERVER"
  elif [[ $USE_VENV -eq 0 ]] && command -v uvx >/dev/null 2>&1; then
    printf '%s\n' "$(command -v uvx)" fastmcp run "$SERVER"
  else
    printf '%s\n' "$VENV/bin/python" "$SERVER"
  fi
}

ensure_venv() {
  if [[ $USE_VENV -eq 0 ]] && { find_python >/dev/null || command -v uvx >/dev/null 2>&1; }; then return 0; fi
  if [[ -x "$VENV/bin/python" ]] && "$VENV/bin/python" -c 'import fastmcp' >/dev/null 2>&1; then return 0; fi
  command -v python3 >/dev/null 2>&1 || { echo "install-dsh: python3 is needed to build the MCP environment" >&2; exit 1; }
  echo "building the MCP environment (fastmcp) in $VENV — needs the network once"
  rm -rf "$VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet fastmcp
}

# Writes/prints {"mcpServers": {NAME: {...}}} for the chosen launcher. $1 = "print" or a file to merge into.
entry_json() {
  local target="$1"; local L=() line
  while IFS= read -r line; do L+=("$line"); done < <(launcher)
  python3 - "$target" "$NAME" "$CONSOLE_URL" "${L[@]}" <<'PY'
import json, os, shutil, sys
target, name, console, cmd, *args = sys.argv[1:]
entry = {"type": "stdio", "command": cmd, "args": args, "env": {"LUXALGO_CONSOLE": console}}
if target == "print":
    print(json.dumps({"mcpServers": {name: entry}}, indent=2)); sys.exit(0)
doc = {}
if os.path.exists(target):
    try:
        doc = json.load(open(target))
    except ValueError as e:
        sys.exit(f"install-dsh: {target} is not valid JSON ({e}); fix or move it, nothing was changed")
    if not isinstance(doc, dict):
        sys.exit(f"install-dsh: {target} is not a JSON object; nothing was changed")
    shutil.copy2(target, target + ".bak-traders")
servers = doc.setdefault("mcpServers", {})
if not isinstance(servers, dict):
    sys.exit(f"install-dsh: 'mcpServers' in {target} is not an object; nothing was changed")
servers[name] = entry
os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
tmp = target + ".tmp"
with open(tmp, "w") as f:
    json.dump(doc, f, indent=2); f.write("\n")
os.replace(tmp, target)
PY
}

remove_entry() {
  python3 - "$1" "$NAME" <<'PY'
import json, os, shutil, sys
target, name = sys.argv[1:]
if not os.path.exists(target): print(f"no {target}; nothing to remove"); sys.exit(0)
doc = json.load(open(target)); s = doc.get("mcpServers", {})
if name in s:
    shutil.copy2(target, target + ".bak-traders"); del s[name]
    json.dump(doc, open(target, "w"), indent=2); print(f"removed '{name}' from {target}")
else: print(f"'{name}' not in {target}")
PY
}

if [[ $UNINSTALL -eq 1 ]]; then
  rm -rf "$SKILL_DST"; echo "removed $SKILL_DST"
  if [[ -n "$MCP_FILE" ]]; then remove_entry "$MCP_FILE"; fi
  echo "still yours: the MCP entry if you added it by hand, $VENV, ~/.local/state/traders-agent/"
  exit 0
fi

if [[ $DOCTOR -eq 1 ]]; then
  fail=0
  ok()   { echo "  ok  $1"; }
  bad()  { echo "  FAIL $1"; fail=1; }
  echo "Trader's Agent — dsh doctor"
  if command -v dsh >/dev/null 2>&1; then ok "dsh on PATH ($(command -v dsh))"; else echo "  --  dsh not on PATH (not required for this check)"; fi
  [[ -f "$SKILL_DST/SKILL.md" ]] && ok "skill at $SKILL_DST" || bad "skill missing at $SKILL_DST (run without --doctor)"
  [[ -f "$SERVER" ]] && ok "MCP server in repo" || bad "MCP server missing: $SERVER"
  L=(); while IFS= read -r line; do L+=("$line"); done < <(launcher)
  if [[ "${L[0]}" == */uvx ]]; then ok "launcher: uvx fastmcp run"
  elif [[ -x "${L[0]}" ]] && has_mcp "${L[0]}"; then ok "launcher: ${L[0]} (has the mcp client)"
  else bad "no interpreter with the mcp client (pip install mcp, or run without --doctor to build a venv, or install uv)"; fi
  # A real handshake: start the server the way dsh will and count its tools.
  n="$(python3 - "$CONSOLE_URL" "${L[@]}" <<'PY' 2>/dev/null || true
import asyncio, sys
console, cmd, *args = sys.argv[1:]
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except Exception:
    print("noclient"); sys.exit(0)
async def go():
    p = StdioServerParameters(command=cmd, args=args, env={"LUXALGO_CONSOLE": console, "PATH": __import__("os").environ.get("PATH", "")})
    async with stdio_client(p) as (r, w):
        async with ClientSession(r, w) as s:
            await asyncio.wait_for(s.initialize(), 60)
            print(len((await s.list_tools()).tools))
asyncio.run(go())
PY
)"
  case "$n" in
    ''|*[!0-9]*) if [[ "$n" == "noclient" ]]; then echo "  --  python 'mcp' client not installed here; handshake skipped"; else bad "MCP handshake failed: run the launcher by hand to see the error"; fi ;;
    *) ok "MCP handshake: $n tools" ;;
  esac
  if curl -fsS --max-time 3 "$CONSOLE_URL/api/health" >/dev/null 2>&1; then ok "console answering on $CONSOLE_URL"; else bad "console not answering on $CONSOLE_URL (./console/start.sh)"; fi
  [[ $fail -eq 0 ]] && { echo "all checks passed"; exit 0; } || { echo "one or more checks failed"; exit 1; }
fi

[[ -f "$SKILL_SRC" ]] || { echo "install-dsh: $SKILL_SRC not found" >&2; exit 1; }
mkdir -p "$SKILL_DST"
cp "$SKILL_SRC" "$SKILL_DST/SKILL.md"
echo "desk skill      -> $SKILL_DST"
ensure_venv
if [[ -n "$MCP_FILE" ]]; then
  entry_json "$MCP_FILE"
  echo "MCP entry       -> $MCP_FILE (previous copy: $MCP_FILE.bak-traders, if it existed)"
else
  echo; echo "Add this to your dsh MCP servers (or re-run with --mcp-file PATH):"; entry_json print
fi
cat <<EOT

Next:
  1. start the console      ./console/start.sh          (http://127.0.0.1:$PORT/)
  2. open that URL in a browser tab: the agent drives that chart through the tools
  3. restart dsh / reload its MCP servers and skills, then ask: "what is on my chart?"
  4. check it                ./adapters/dsh/install-dsh.sh --doctor
EOT
