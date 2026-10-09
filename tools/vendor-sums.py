#!/usr/bin/env python3
"""Keep console/frontend/vendor/SHA256SUMS exact.

The vendored browser builds (Vela, Vela-PineTS, the patched PineTS, the Zag closure) are committed files that run in the
console's origin. Their provenance used to be prose; this makes a hand edit or a half-applied upgrade a test failure:

  tools/vendor-sums.py            print the sums
  tools/vendor-sums.py --write    rewrite SHA256SUMS
  tools/vendor-sums.py --check    exit 1 when a vendored file differs from SHA256SUMS, or is missing, or is unlisted
"""
import hashlib
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parent.parent / "console" / "frontend" / "vendor"
SUMS = VENDOR / "SHA256SUMS"
# Our own notes about the vendored files are not vendored files: editing them must not need a re-sum.
OURS = {"SHA256SUMS", "VENDORING.md", "PROVENANCE.md", "THIRD-PARTY-LICENSES.md"}


def current() -> dict:
    out = {}
    for f in sorted(VENDOR.rglob("*")):
        if f.is_file() and f.name not in OURS and "__pycache__" not in f.parts:
            out[f.relative_to(VENDOR).as_posix()] = hashlib.sha256(f.read_bytes()).hexdigest()
    return out


def recorded() -> dict:
    out = {}
    if SUMS.exists():
        for line in SUMS.read_text().splitlines():
            if line.strip():
                digest, _, name = line.partition("  ")
                out[name] = digest
    return out


def main(argv) -> int:
    now = current()
    if "--write" in argv:
        SUMS.write_text("".join(f"{d}  {n}\n" for n, d in now.items()))
        print(f"wrote {len(now)} sums")
        return 0
    if "--check" in argv:
        have = recorded()
        problems = [f"changed: {n}" for n in now if n in have and have[n] != now[n]]
        problems += [f"unlisted: {n}" for n in now if n not in have]
        problems += [f"missing: {n}" for n in have if n not in now]
        for p in problems[:20]:
            print(p, file=sys.stderr)
        if problems:
            print("vendor/ differs from SHA256SUMS: if the change is deliberate (an upgrade, see VENDORING.md) run "
                  "tools/vendor-sums.py --write", file=sys.stderr)
            return 1
        return 0
    for n, d in now.items():
        print(f"{d}  {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
