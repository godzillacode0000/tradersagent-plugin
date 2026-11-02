# "Why is it slow?" — the measured pass, then the known causes

The operator asks this class of question directly (chart slow to load, indicators slow to open). Answer
with numbers taken from the live desk, then a ranked list with the fix attached — never a theory of
performance. Everything below is copy-paste.

## The measurement pass

```bash
# 1. endpoint latency — local endpoints run ~1-2 ms, so the story is always in the MCP-backed ones
for ep in /api/health /api/chart/state "/api/indicators?limit=5" "/api/search?q=order%20block" \
          "/api/catalogue?limit=5" /api/propfirms /api/offers; do
  printf "%s  %s\n" "$(curl -s -o /dev/null -w '%{time_total}' "http://127.0.0.1:8787$ep")" "$ep"
done

# 2. what the browser fetches at boot, and whether it may KEEP it
curl -sI http://127.0.0.1:8787/app.js | grep -i "cache-control\|etag"
#    a revalidating reload must answer 304 with no body:
ET=$(curl -sI http://127.0.0.1:8787/app.js | grep -i etag | tr -d '\r' | cut -d' ' -f2)
curl -s -o /dev/null -w 'status %{http_code} bytes %{size_download}\n' -H "If-None-Match: $ET" http://127.0.0.1:8787/app.js

# 3. where the knobs live
sed -n "$(grep -n '^TTL = {' console/backend/server.py | cut -d: -f1),+20p" console/backend/server.py
grep -n "def static_cache_control\|def _etag_matches\|def warm_catalogue\|def _refresh_behind\|def mcp_call" console/backend/server.py
grep -n "class MCPBridge\|ThreadingHTTPServer\|MAX_CONNECTIONS" console/backend/server.py

# 4. log growth (an unrotated log is a slow-burn stability item)
ls -la ~/.local/state/traders-agent/*.log
```

## The causes, ranked

1. **FIXED — static caching (19 Oct).** Every static file used to ship `Cache-Control: no-store`, so each
   pane open refetched and REPARSED the whole vendored graph (`index.html` pulls ~180 local assets /
   ~7.2 MB: vela.global.min.js 1.0 MB + vela-pinets.global.min.js 1.5 MB as classic scripts, ~2.7 MB of
   Vela ES chunks, ~1 MB app JS, 159 modulepreloads). Now `static_cache_control()` in `server.py`:
   `index.html` stays `no-store` (a new build must always land); content-hashed names are `immutable`;
   everything else `no-cache` + `ETag` (a 304 costs ~0.7 ms and re-sends nothing — 10 files revalidated
   in ~2 ms / 0 bytes measured live). The hash rule is deliberately UPPERCASE-only (`-[A-Z0-9]{8,12}`),
   so `script-highlight.js`-style app files can never be frozen for a year. Guard: `test_latency_and_cache.py`.
2. **FIXED — Library reads (19 Oct).** The `TTL` dict (1.5-2 s for everything) meant any drawer/search/
   indicator read after a short pause paid a fresh WAN round trip to LuxAlgo's MCP (0.45-0.68 s measured;
   search seen at 3.4 s). TTLs are now REFRESH deadlines (search 30 s, indicators 600 s, source/families/
   concepts 3600 s, offers 300 s, propfirms 1800 s) with stale-while-revalidate: `CACHE.get_stale()` +
   `_refresh_behind()` serve the cached answer instantly and run ONE single-flight background refresh
   (`_REFRESHING` set); a failing refresh leaves the served copy intact. `_keep_for()` keeps an entry
   20x TTL, floored at 10 min and capped at 6 h (`STALE_KEEP_*`).
3. **FIXED — the catalogue's cold walk (19 Oct).** The walk is 9-11 serial MCP calls (~16.5 s cold;
   ~14 ms once disk-cached with a 12 h TTL) and used to be paid by whoever opened the drawer first.
   `warm_catalogue()` runs in a daemon thread beside the MCP connect at server start: it skips when
   `console/agents/catalogue.json` is fresh, waits up to 60 s for the session, and logs one line either
   way ("catalogue warm done in N s" / "skipped: no MCP session"). Residual: the walk still holds the
   single MCP queue while it runs — that head-of-line risk is real for OTHER long bridge calls, not for
   the drawer (which now reads disk).
4. **OPEN — log growth.** `console.err.log` grows unbounded (every request line, query params included;
   multi-MB within days). Rotate it or quiet the access log. Unchanged by the latency pass.
5. **OPEN (security, same area) — reads are open on loopback by design.** POSTs need token + Origin, but
   GETs (broker state, propfirms, library) answer any local caller and, under `ALLOW_LAN` / a tailnet
   serve, any peer on it. Fine for one user on one Mac; gate reads with the token if the console is ever
   served beyond loopback.
6. **Checked, not a problem — do not chase these:** `ThreadingHTTPServer` with a 128-connection cap, so
   static assets never queue behind a slow API call; the thumbnail cache is healthy
   (`~/.local/share/traders-agent/thumbs`, thousands of files, served `immutable`).

## Reporting shape

Bottom line first: the measurement, the cause, the cheapest lever — one or two lines each, ranked.
Offer the fix as the next action. When a fix lands, update the matching cause above to its new measured
state (and its guard test) rather than appending a second copy; re-measure before quoting any number.
