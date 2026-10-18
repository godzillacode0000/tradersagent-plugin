# The pane's state, and the drawer's picture cache

Depth for two questions that look unrelated and share one rule: what a cache key contains decides whether
anything is ever a hit — and what a storage layer contains decides whether anything comes back.

## 1. What persists, and what only reports

Two layers, and only one restores the chart:

| Layer | Where | Holds | Restores on boot? |
|---|---|---|---|
| Browser state | `localStorage['vela-workspace']` (Vela `persist: true`, `workspace.js`) | symbol, timeframe, price style, grid layout, timezone, **drawings**, indicators, panel toggles | **Yes** — Vela reads it while building the workspace |
| Server report | `console/agents/_chart/state.json` (page POSTs `/api/chart/state` every ~4 s) | the same shape, for the agent: `trader-chart state`, `chart_state`, the `apply` action | **As a fallback** — `workspace.js` applies its symbol/timeframe at boot when the page has no local state |

Consequences before answering a "why did it reset?" question:

- With local storage present, the pane comes back as left, drawings included. The iframe in `plugin.js` has
  no `sandbox` attribute, so the console origin owns real storage; the Hermes app persists that origin's
  keys in `.../Hermes/Local Storage/leveldb` (entries prefixed `_http://127.0.0.1:8787`).
- With it wiped, the chart restores the console's last desk (symbol + timeframe) from `state.json` — a
  boot hook in `workspace.js` after the ready wait. Local state still wins when present; the hook only
  covers the no-local-state case. Two races made the naive version silently do nothing — keep them in
  mind for any similar boot-restore: (1) the "had local state" flag must be read BEFORE the workspace is
  constructed, because Vela writes its own default state the moment it boots, so a read taken later
  always answers "yes"; (2) the `/api/chart/state` fetch must be issued BEFORE this page starts
  reporting, or the page's own `—` "still starting" placeholder is what comes back — and a placeholder
  symbol must be refused. The apply is raced against a ~6 s deadline: `setMarket` never settles for a
  symbol the workspace's provider cannot serve (the bridge guards the same call the same way).
- Transient UI never persists: drawer search/family/scroll, replay cursor, drawer open state.
- **Not every renderer option rides that document.** When the view door gained `grid`, gridlines came back ON
  after a reload — Vela's saved `rendererConfig` did not carry it. A new view setting therefore needs its own
  preference (`luxalgo-web:<name>`, written by the door's setter, re-applied in the boot hook beside the theme),
  and its test is a RELOAD round-trip: read → set → read back → reload → read again.

**Prove it by mutating and reloading, never by finding a key:**

1. `trader-chart drawing add hline <bars_ago>:<price> --text probe` (any mutation the bridge accepts).
2. `Page.reload` over CDP — the same cycle as closing and reopening the pane.
3. `TaVela.objects({op:'list'})` must list the drawing again, and the `symbol`/`timeframe` inside the
   `vela-workspace` value must match what was set.

LevelDB values are Snappy-compressed: `strings` finds key fragments, a raw regex over the `.ldb`/`.log`
will not find `vela-workspace` values. Use the store only to prove the ORIGIN is persisted; use the browser
for the round-trip.

### When the operator says the pane resets, take a tape — do not re-run the tab test

A tab proves the console; the pane is its own environment (its iframe, its storage partition, its remount
cycle), so measure THEIR pane from outside — the console's own endpoints carry everything. Run
`scripts/pane_state_tape.py` (read-only; polls `/api/chart/state` and `/api/chart/stream/status` every
~2 s, logs transitions) and ask for one close → wait → reopen. How to read a tape:

- `views` 1 → 2 → 1 with TWO new viewer ids = the pane loads the page twice per reopen (it remounts
  while docking). One of the two dies — do not double-count its reports.
- A fresh viewer reporting `symbol "—"` / a bare timeframe / `build "pending"` for several seconds is a
  page still starting: that blank phase is what reads as "everything gone" to the operator, and it
  settles. Say so, with the settled value.
- The settled viewer naming the operator's own symbol/timeframe = the restore worked; the complaint is
  then about something else. One concrete question beats re-explaining the mechanism.
- `natives: []` / `studies: []` / `drawings: null` at the moment of the complaint means there was
  nothing of that kind in the saved state — check `console/agents/_chart/commands.json` for an agent
  `clear` / `remove all` before blaming persistence.

### Why an indicator vanished on reopen: the run store, and what may delete it

The Library/agent **run** does not live in `vela-workspace`: `TraderRun` (`unified.js`) keeps the one run the
overlay painted under `localStorage['luxalgo-web:last-run']` ({pine, name, opts, at, fails}) and re-runs it once
at boot, after bars arrive. Two deletion paths used to make an indicator vanish PERMANENTLY on a pane toggle
(measured 18 Oct 2026 — the operator's "gone after I reclick the pane", and nothing left for any later boot):

- `restore()` deleted the store on the FIRST failed boot. A pane boot fails that one attempt for reasons that
  are not the script: an engine worker still waking, bars not yet on the chart, or the pane's own second page
  load outrunning the first. Now `saved.fails` counts CONSECUTIVE failed boots, the run is dropped only at 3,
  a `superseded` run (a newer run won the race) earns no strike, and a landing restore resets `fails` to 0.
- The drawer's Run cleared the STORE before the new script landed, so a click on a script that failed to run
  cost the previous indicator. `TraderRun.reset({keep:true})` (only the drawer passes it) clears the canvas
  and keeps the store; only an explicit clear (`chart_clear`, the chip ✕, bare `reset()`) forgets.

The heartbeat now carries `store: {run, at, fails}` beside `studies` (the live reader) — `/api/chart/state`
answers "will my indicator come back if I close the pane now" BEFORE closing it, and a failed restore says why
on the activity line and in `store.lastFail.reason`. Prove the rules end to end from a browser page's own JS
(NOT the command queue): plant a broken pine under the key, reload three times and watch `fails` climb to 2
then the key vanish; plant a good run and watch it restore with `fails` back to 0; run the drawer's pre-run
sequence (`ChartOverlay.clear()` → `PineTSPaint.clear()` → `reset({keep:true})` → `run(bad pine)`) and confirm
the store still names the previous run.

Browser note (this Mac): Chrome-for-Testing wedges — CDP `Runtime.evaluate` never returns, the renderer parked
— when the monitor is off and the page starts a render loop; `about:blank` still answers, which makes it look
like the page's fault. Brave in GUI mode (`--remote-debugging-port=9224 --user-data-dir=<scratch>/brave-luna`,
its own profile, then kill the instance when done) renders that same page and answers CDP normally.

## 2. The drawer's thumbnails: one pipeline, three ways to be cold

Pipeline (`console/backend/library_thumbs.py`, the boot warmer in `server.py`, `drawer.js`):
`<img src="/api/library/thumb?slug=…&w=…&u=…">` → key `slug-tag(url)-width.jpg` → serve from disk if
present, else fetch the vendor's S3 PNG, **shrink to `w`** (vips → magick → convert → ffmpeg), atomic
`os.replace`, serve. Success goes out `Cache-Control: immutable, max-age=1y`; a 404 (`no_store`) means "no
picture", and a refused host produces that same 404.

**The shrink is also the WRITE step.** Anything that stops the shrink stops the cache — that is the whole
reason a "slow drawer" can look like a network problem while it is a configuration one.

### 1. The key carries the width, so producer and consumer must agree

`WARM_WIDTH` (server) is what the boot warmer fetches; the drawer's rows are 52×34 tiles and ask `w=160`.
When they disagreed (480 — the retired full-screen modal's card width), 749 warmed files served nothing
anyone requested and every open paid S3 for 60 rows: ~1.4 s each, ~2.7 s before the first screen filled.
`test_preview_cache.py` now reads the width literal out of `drawer.js` and asserts `WARM_WIDTH` equals it.
Pin two-file numbers with a test that reads the consumer — never two literals maintained by hand.

Generalization: any cache key that embeds a parameter (width, DPR, locale, format) will be permanently
cold the day either side changes it, and nothing errors. The symptom is "every open is slow" while the
cache dir looks full — check the KEY of what is on disk, not just the file count.

### 2. An allowlist rejection and a missing asset are the same 404

`_allowed()` accepts exact vendor bucket hosts over https. One of the three forms the catalogue really
uses — `luxalgo-images-production.s3.amazonaws.com`, the global form of the images-production bucket — was
refused, so `thumb()` returned `None` and those rows drew no picture at all: 104 of 853 rows, invisible in
the UI because a 404 is a legitimate "no preview" there.

Detect by counting, not by looking: image hosts across the `/api/catalogue` rows vs files in the cache dir;
a shortfall equal to one host's row count IS a refused host. When widening the list, keep behaviour tests
for the refusal side too (lookalike host, `http://`, a path that merely contains an allowed host).

### 3. A service's PATH is not your shell's

launchd/systemd units start with a minimal `PATH`. On this Mac there is no `vips`/`magick`/`convert`
anywhere and the only `ffmpeg` is the Hermes-bundled one, which the unit's PATH did not include — so
`_converter()` returned `None`, every thumb was the raw 1600×1000 PNG (~93 KB, ~2.6 s) and **nothing was
cached**, because the shrink never ran. That reads exactly like a slow network and a cold cache at once.

Read it from the process, not your shell:

```bash
ps eww -p <pid> | tr ' ' '\n' | grep '^PATH='      # the unit's real environment
which vips magick convert ffmpeg                    # what a login shell sees, for contrast
```

Fix in THREE places: `_converter()` honours `TRADERS_AGENT_RESIZER` (absolute path or command name, wins over
PATH) and probes `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`; the unit names the converter
explicitly in `EnvironmentVariables`; and `console/service-macos.sh` resolves one at INSTALL time
(vips → magick → convert → ffmpeg), preserves the value a previous install wrote, and lets the environment
win — a hand-edited plist here reaches nobody else. A unit edit needs `bootout` + `bootstrap` — `kickstart -k` restarts
with the cached plist and makes the edit look ignored.

## 3. Measuring it (the numbers that decide)

Never accept "slow" as a diagnosis; read the page's own resource timings.

1. CDP: `Network.setCacheDisabled(true)` (a fresh user has no HTTP cache), navigate, wait for
   `window.libDrawer`.
2. `performance.clearResourceTimings(); window.libDrawer.open(true)`.
3. Poll until every visible `#drawer-list img.drow__shot` is `complete && naturalWidth > 0` — that is
   "the screen is filled".
4. `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/library/thumb'))` → count,
   avg/max `duration`, `transferSize`. ~93 KB per entry = the raw PNG (shrink never ran); ~2 KB = a 160 px
   JPEG.
5. Server side: `/api/library/thumbs` returns `{files, queued, resizer, warmer:{state, pages, rows, done}}`.
   `resizer: null` is the missing-converter fault; `done:true` with `rows:853` and `files ≈ rows` is warm.
6. Let the boot warmer finish before judging a fix — it walks every catalogue page at `WARM_WIDTH`
   (~64 s for 853 rows here). Poll until `done`, then measure.

A pair to beat (same machine, same desk): before — avg 1,447 ms, max 2,685 ms per thumb, 2.74 s to fill the
visible rows, zero cache files at the painted width; after — avg 6.8 ms, max 11.5 ms, 0.05 s to fill,
1,892-byte 160×100 JPEGs, one cache file per row.

The drawer paints `SLICE = 60` rows at a time with `loading="lazy"` images and a "Show 60 more" button —
each reveal is another 60 requests, which is why the WARM width (not the browser cache) is what makes the
whole list feel instant.

## 4. Where the code is

- `console/backend/library_thumbs.py` — cache key, allowlist, converter chain, shrink, warm pool.
- `console/backend/server.py` — `/api/library/thumb`, `/api/library/thumbs`, `/api/library/warm`,
  `WARM_WIDTH`, the boot warmer thread.
- `console/frontend/drawer.js` — rows, `thumbUrl(…, 160)`, `SLICE`, Run.
- `console/frontend/app.js` — `thumbUrl()` (default `CARD_SHOT_W = 480`), `DETAIL_SHOT_W = 960`.
- `console/backend/tests/test_preview_cache.py` — the drift tests: width agreement, allowlist forms,
  honest fallback, warmer contract.
