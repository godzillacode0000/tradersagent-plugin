#!/usr/bin/env bash
# bin/setup-python.sh — give the console and the agent a python with the `mcp` client, fast.
#
#   ./bin/setup-python.sh            make <repo>/.venv with `mcp` (skips if you already have a python that does)
#   ./bin/setup-python.sh --print    show what it would do and change nothing
#   ./bin/setup-python.sh --force    delete and rebuild the repo .venv even if `mcp` is already importable
#
# Why: `pip install mcp` is the slow step of a fresh install (measured 286 s against 5.6 s for
# `uv pip install mcp` in the same sandbox, 72 MB of packages either way). So: uv when it is on PATH
# (it can also fetch a python itself), else python3.11+ -m venv + pip. The python is 3.12, 3.13 or 3.11, in that
# order: the versions CI covers and that have final releases of every dependency. Plain `>=3.11` made uv pick a
# 3.14 release candidate once, whose pydantic could not import, so the newest is not chosen on purpose. Nothing else about the
# console changes: it stays stdlib-only apart from this one package, and start.sh / register-mcp.sh /
# service helpers all already prefer <repo>/.venv when it can import mcp.
#
# An interpreter you chose with PY=... that can import mcp is left alone, and so is a python3.11+ on
# PATH that already has it (nothing to install). Bash 3.2 safe (macOS /bin/bash): no arrays, no mapfile.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$HERE/.venv"
REQ='mcp>=1,<3'          # the same range console/requirements.txt pins
PRINT=0 FORCE=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    --print)   PRINT=1 ;;
    --force)   FORCE=1 ;;
    *) echo "setup-python.sh: unknown option '$arg'" >&2; exit 2 ;;
  esac
done

# PYTHONPATH/PYTHONHOME are scrubbed for every probe: an agent session can export a PYTHONPATH that
# shadows the probe's own packages and makes a healthy interpreter read as broken.
has_mcp() { [ -x "$1" ] && env -u PYTHONPATH -u PYTHONHOME "$1" -c 'import mcp' >/dev/null 2>&1; }
is_311() { env -u PYTHONPATH -u PYTHONHOME "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; }

find_ready_python() {   # a python 3.11+ that can already import mcp, in start.sh's order
  local cand p
  if [ -n "${PY:-}" ] && has_mcp "$PY"; then echo "$PY"; return 0; fi
  if has_mcp "$VENV/bin/python"; then echo "$VENV/bin/python"; return 0; fi
  for cand in python3.14 python3.13 python3.12 python3.11 python3; do
    p="$(command -v "$cand" 2>/dev/null || true)"
    if [ -n "$p" ] && is_311 "$p" && has_mcp "$p"; then echo "$p"; return 0; fi
  done
  return 1
}

find_python311() {      # a python 3.11+ (no mcp needed): the base for a pip-built venv, preferred order above
  local cand p
  for cand in python3.12 python3.13 python3.11 python3.14 python3; do
    p="$(command -v "$cand" 2>/dev/null || true)"
    if [ -n "$p" ] && is_311 "$p"; then echo "$p"; return 0; fi
  done
  return 1
}

if [ $FORCE -eq 0 ] && READY="$(find_ready_python)"; then
  echo "ok  a python with the mcp client is already available: $READY (nothing to install)"
  exit 0
fi

UVPY=""
if command -v uv >/dev/null 2>&1; then
  TOOL="uv"
  for v in 3.12 3.13 3.11; do          # an already-installed one first: no download
    if uv python find "$v" >/dev/null 2>&1; then UVPY="$v"; break; fi
  done
  [ -n "$UVPY" ] || UVPY="3.12"        # none installed: uv fetches a standalone 3.12
elif BASE="$(find_python311)"; then
  TOOL="pip"
else
  echo "setup-python.sh: no uv and no python 3.11+ on PATH." >&2
  echo "  Install uv (https://docs.astral.sh/uv/) — it can fetch python itself — or python 3.11+, then run this again." >&2
  exit 1
fi

if [ $PRINT -eq 1 ]; then
  echo "# tool: $TOOL   target: $VENV"
  if [ "$TOOL" = "uv" ]; then
    if [ $FORCE -eq 1 ] || [ ! -x "$VENV/bin/python" ]; then echo "uv venv --python $UVPY $VENV"; fi
    echo "uv pip install --python $VENV/bin/python '$REQ'"
  else
    if [ $FORCE -eq 1 ] || [ ! -x "$VENV/bin/python" ]; then echo "$BASE -m venv $VENV"; fi
    echo "$VENV/bin/python -m pip install '$REQ'"
  fi
  exit 0
fi

START="$(date +%s)"
if [ $FORCE -eq 1 ] && [ -d "$VENV" ]; then rm -rf "$VENV"; fi
if [ "$TOOL" = "uv" ]; then
  if [ ! -x "$VENV/bin/python" ]; then
    echo "creating $VENV with uv (python $UVPY)"
    uv venv --quiet --python "$UVPY" "$VENV"
  fi
  echo "installing $REQ with uv"
  uv pip install --quiet --python "$VENV/bin/python" "$REQ"
else
  if [ ! -x "$VENV/bin/python" ]; then
    echo "creating $VENV with $BASE (no uv found: this is the slower path)"
    "$BASE" -m venv "$VENV"
  fi
  echo "installing $REQ with pip"
  "$VENV/bin/python" -m pip install --quiet --disable-pip-version-check "$REQ"
fi

if ! has_mcp "$VENV/bin/python"; then
  echo "setup-python.sh: installed, but $VENV/bin/python still cannot import mcp" >&2
  exit 1
fi
echo "ok  $VENV is ready (mcp client importable) in $(( $(date +%s) - START ))s"
