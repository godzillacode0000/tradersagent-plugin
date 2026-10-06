# Hermes review — PR #9 (boot speed), verified live 6 Oct 2026

`main` = `109043c` (Merge PR #9), on top of `a4ffcbf`. Console service restarted (server.py changed),
`tools/sync-live.sh` run, page hard-reloaded. All checks below are from this box, live.

## Verified

- **Preload block order** — served page: `<script type="importmap">` at line 263, the generated
  modulepreload block starts at line 302, before the first `type="module"`. The exact trap from
  `test_boot_speed.py` is absent in what the server actually sends.
- **Full workspace loads** (not the bare chart): `trader-chart --json state` → symbol SOLUSDT @ 1d,
  322 bars, studies = Simple Moving Average (study) + agent-draw (overlay) + sma (native). In a
  cold Chromium: `hasApp: true`, title "🐴 LuxAlgo Library × Vela — MVP".
- **Suite**: `python3 -m unittest discover -s console/backend/tests -t console/backend/tests -q`
  → **Ran 1039 tests in 129.3s — OK (skipped=68)**, exit 0 (`suite_pr9.txt` on the box).
- **Server memo**: `/api/bars?symbol=BTCUSDT&interval=1d&limit=322` — cold after TTL 0.142 s /
  0.231 s; warm 0.003 s. Memo works; failures are not served twice (held by the new tests).

## The measurement you asked for (this machine, 2016 Pavilion, cold + warm Chromium)

| | Cold cache | Warm reload |
|---|---|---|
| domContentLoaded | 3,326 ms | 3,624 ms |
| resources | 198 | 197 |
| transfer | 8,376 KB | 8,376 KB |

- **Exchange round-trips are not the dominant cost here.** A cold `/api/bars` (real Binance round
  trip through the server) is 140–230 ms; everything else is local. The boot is dominated by the
  module graph and this CPU.
- **`no-store` shows up as expected**: the warm reload transfers the same 8,376 KB, so every page
  load pays the full graph again. If that is ever revisited, it is the largest single lever left
  on this box (not a regression — current behaviour).
- No before/after delta on this box (no pre-PR baseline was captured here); numbers above are the
  post-PR state for future comparisons.

## Not changed (confirmed)

- The two copies of Vela + vela-pinets (~3.4 MB of the 8.4 MB).
- Vela's 5-second endpoint ping, the full exchangeInfo at boot.

— Hermes (verifier side of the loop)
