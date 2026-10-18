# Updating the vendored engine (Vela / vela-pinets)

`console/frontend/vendor/VENDORING.md` in the repo is the procedure of record (which tarballs,
which files, the post-upgrade preload regen). This file adds the checks that caught real traps.

## 0. Know what is actually vendored

- Byte-compare the dir against the npm tarball subset before assuming anything:
  `curl -sL https://registry.npmjs.org/@luxalgo/vela/-/vela-<v>.tgz | tar xz -C /tmp/x` then
  `diff -rq console/frontend/vendor/vela/dist /tmp/x/package/dist`.
  Zero differing files = the copy is unpatched and a re-swap is mechanical; a local patch is
  documented in `PROVENANCE.md` files and shows up here as diffs.
- The vendored set is a SUBSET of the tarball's dist: top-level `dist/*.js`, `dist/providers/*.js`,
  `LICENSE`, `NOTICE`. The tarball also ships `*.cjs`, `*.d.ts` and `vela.global.js` (the readable
  dev build) — copying the whole dist silently grows the vendored set; copy the pattern already in
  the tree (only `vela.global.min.js`, never `vela.global.js`).
- `vendor/pinets/` is THIS repo's patched fork (AGPL) and is NOT refreshed by a Vela bump. The
  paired-runtime check: after moving `vela-pinets`, read which PineTS range it inlines
  (`package.json`) — an unchanged range means the patch stays valid.

## 1. Read the release before swapping

- The changelog first: does anything hit OUR configuration? (A fix matters because
  `workspace.js` runs `live: true` with its own bars; a plot-colour fix matters because Pine runs
  paint candles.)
- Public-API removal check: extract export alias sets from old/new `.d.ts` and diff the SETS.

  ```python
  import re, pathlib
  def names(p):
      t = pathlib.Path(p).read_text('utf-8', 'replace')
      return set(re.findall(r'\bas ([A-Za-z_][\w$]*)', t))
  # names('old/workspace.d.ts') vs names('new/workspace.d.ts') -> added / removed
  ```

  Do NOT diff the raw `.d.ts` files: chunk names are content hashes, so every re-export line churns
  and the diff reads like removals when nothing was removed.
- Dependencies: diff the `dependencies` ranges for the vendored closure (`@zag-js/*`,
  `@floating-ui/*`) between the two tarballs. Unchanged = the vendored `zag/` closure stands. New
  bare specifiers in the dist would mean the page's import map needs an entry.
- If the engine's runtime package ships in lockstep with it (vela-pinets builds against each vela
  release), take it in the same step.

## 2. Verify in a scratch copy on a second port, before the live repo

```bash
T=~/.hermes/cache/scratch/vela-test; rm -rf "$T"; mkdir -p "$T"
cp -R ~/tradersagent-plugin/console "$T/console"; cp -R ~/tradersagent-plugin/tools "$T/tools"
# swap the vendor dirs in $T/console/frontend/vendor/, then:
cd "$T" && python3 tools/modulepreload.py --write
cd "$T/console/backend" && PORT=9002 LUXALGO_AGENTS_DIR="$T/agents-9002" \
    ~/tradersagent-plugin/.venv/bin/python server.py --port 9002 --frontend ../frontend   # background
```

Drive it with the study browser (the `reverse-engineering-web-apps` skill's Chrome/CDP recipe):
collect console errors, exercise the doors, do one write that reads back.

- `TaVela.objects({op:'list'})`, `TaVela.datawindow({op:'read'})` — must answer with live bars.
- `LUXALGO_CONSOLE=http://127.0.0.1:9002 <repo>/.venv/bin/python console/bin/trader-chart drawing add hline 30:80000`
  → `drawing list` shows `dw-1` → `drawing remove --id dw-1`.
- Expect **0 console errors** and the subsystems logging `[pinets-paint] ready`,
  `[pinets-runner] ready`, `[workspace] default Pine engine registered`.
- Documented boot checks: `/api/chart/state` → symbol, `bars: 500`, `layout: "workspace"`;
  `trader-chart state` → `series 0 · drawings None · bars 500`.

## 3. Land it in the repo

Swap the same vendor subset, then:

```bash
python3 tools/modulepreload.py --write && python3 tools/modulepreload.py --check
python3 tools/vendor-sums.py --write      && python3 tools/vendor-sums.py --check
./.venv/bin/python -m unittest discover -s console/backend/tests -t console/backend/tests
```

`SHA256SUMS` and the preload block in `index.html` are GENERATED — never hand-edit; run the tools
and let the suite's checks be the gate. The door test compares the drawing-type table against the
vendored bundle, so a release that changes drawing schemas fails loudly there.

Docs a bump must touch (grep the OLD version string repo-wide, e.g. `grep -rn "0\.8\.3\|0\.2\.15"
--include="*.md" --include="*.html" --include="*.js" .`; drift tests do not catch prose):

- `console/frontend/vendor/VENDORING.md` — the pinned-versions line AND the `curl` commands.
- `THIRD-PARTY.md` — several mentions, including the vela-pinets / inlined-PineTS sentence.
- `CHANGELOG.md` — `[Unreleased]` → `### Changed`, newest bullet first, in the established style:
  what moved and that the files are upstream's byte for byte, the regenerated preload/checksum
  numbers, what the release brings that touches this console, and the verification actually run.
- `console/frontend/index.html` — the comment above the two `<script>` tags names both versions.
- `docs/architecture-latest.html` — a header badge, the L4 card (prose + meta chip) and the two
  engine card headings, five spots in all.
- `docs/vela-chart-api-notes.md` and any other doc carrying a version number.

After the grep, the only remaining hits should be history, not claims: the CHANGELOG's older
bump bullets, a dated study (`docs/studies/*.md` records the version it measured — leave it), and
sentences saying when an earlier version *changed* something (the NOTICE-URL line in
`THIRD-PARTY.md`). Say which hits you deliberately left, or the next reader re-fixes them.

`docs/architecture-latest.html` also carries MEASURED counts (`39 MCP tools`, `293 backend tests`)
that go stale on their own — a version fix does not update them. Flag them separately and let the
operator decide; do not silently rewrite a number the page claims to have measured.

## 4. The live desk

`launchctl kickstart -k gui/$(id -u)/com.traders-agent.console` restarts the service. The pane
still frames the OLD build until reloaded (⌘K → "Reload chart pane") — a stale heartbeat right
after a restart is expected, not a failure. Then `LUXALGO_CONSOLE=http://127.0.0.1:8787 …
trader-chart state` must report the same shape as before and a `drawing add` must still write.
