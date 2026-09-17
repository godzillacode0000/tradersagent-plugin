#!/usr/bin/env python3
"""How many library scripts read the market context our constructor bug left undefined?

Counts `syminfo`, `tickerid`/`ticker`, `timeframe.` usage across every fetchable library script.
Writes docs/luxalgo-context-dependency.json
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

CONSOLE = "http://127.0.0.1:8787"
DOCS = Path('/home/godzillaton/Projects/luxalgo-web/docs')
OUT = DOCS / 'luxalgo-context-dependency.jsonl'

PATTERNS = {
    "syminfo": r"\bsyminfo\s*\.",
    "tickerid": r"\btickerid\b|\bsyminfo\.ticker\b|\bticker\s*\.",
    "timeframe": r"\btimeframe\s*\.(period|multiplier|isdaily|isintraday|in_seconds)",
    "barstate_or_time": r"\btime\b|\btimenow\b",
}


def main() -> int:
    recs = json.loads((DOCS / 'luxalgo-indicators.json').read_text())
    done = {}
    if OUT.exists():
        for line in OUT.read_text().splitlines():
            if line.strip():
                try:
                    r = json.loads(line)
                    done[r['slug']] = r
                except Exception:
                    pass
    todo = [r for r in recs if r['slug'] not in done]
    print(f"context-dependency: {len(todo)} to do", flush=True)

    with OUT.open('a') as fh:
        for i, r in enumerate(todo, 1):
            slug = r['slug']
            try:
                url = CONSOLE + "/api/source?" + urllib.parse.urlencode({"slug": slug})
                src = json.load(urllib.request.urlopen(url, timeout=90)).get("data", {}).get("source") or ""
                code = re.sub(r"//[^\n]*", " ", src)
                flags = [name for name, pat in PATTERNS.items() if re.search(pat, code)]
                rec = {"slug": slug, "name": (r.get('name') or '').strip(), "flags": flags,
                       "needs_context": any(f in flags for f in ("syminfo", "tickerid", "timeframe"))}
                fh.write(json.dumps(rec) + "\n")
                fh.flush()
                done[slug] = rec
            except Exception as e:
                print(f"  fail {slug}: {str(e)[:50]}", flush=True)
            if i % 100 == 0:
                print(f"  {i}/{len(todo)}", flush=True)
            time.sleep(0.02)

    rows = list(done.values())
    needs = [r for r in rows if r.get("needs_context")]
    (DOCS / 'luxalgo-context-dependency.json').write_text(json.dumps(rows, indent=1), encoding='utf-8')
    print(f"TOTAL {len(rows)} | read market context (syminfo/tickerid/timeframe): {len(needs)} "
          f"({len(needs)/max(1,len(rows)):.0%})", flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
