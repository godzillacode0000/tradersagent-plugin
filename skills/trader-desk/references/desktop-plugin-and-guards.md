# The desktop plugin: session doors, deploy loop, and the guard tests

Companion to the SKILL.md section on the plugin's own surface. Everything here was read out of the
installed app's SDK (`$HERMES_HOME/hermes-agent/apps/desktop/src/sdk/index.ts`) and the gateway
contract (`tui_gateway/contracts/sessions.py`), then exercised in this repo.

## The doors the plugin may use

| Door | Contract |
|---|---|
| `host.state.focusedStoredSessionId` | the DURABLE id of the chat in front; falsy when nothing of the user's is focused (cold boot, a full page). Read reactively (`useValue`) — sessions restore asynchronously |
| `host.request('session.create', params)` | mint a session. Params: `source`, `cwd`, `title`, `messages[]`, `hidden`, `idempotency_key`, `profile`, … Reply: **`{ session_id, stored_session_id, … }`** — runtime vs durable |
| `host.openSession(storedId, opts)` | open a stored session as core surfaces do; `intent` = `in-place` / `main` / `stack` / `tab` / `window` |
| `host.navigate('/' + storedId)` | route to a session (routes parse STORED ids only) |
| `host.revealPane` / `host.undismissPane` | adopt + reveal a contributed pane (adoption first, then reveal) |
| `ctx.storage.get/set` | per-plugin persistence — the only thing that survives a plugin reload |

Guard every one with `typeof host.X === 'function'` and fail to a no-op: older Desktop builds lack
these doors and the CI stub harness has no gateway at all, so an unguarded call throws inside a
renderer nobody can see.

## The shape that shipped for the row (policy 1 + 3)

- **Guard first, in the callee:** `async function openDeskChatWhenEmpty(focused) { if (focused || !deskChatOn) return false … }`. A chat in front short-circuits before any RPC.
- **Preferences are read before deciding:** the stored toggle is awaited (`deskChatReady.then(…)`), because a mount that decides on the first render guesses. The effect deps are `[paneUp, sid]` so it re-fires when the focused id finally arrives.
- **Mint once, remember, never resolve:** `session.create` with a fixed `idempotency_key`, keep `stored_session_id` in `ctx.storage`, and never look a session up by title or a hardcoded id — the guard tests forbid that shape returning.
- **Every behaviour switch gets a palette command AND a visible state line** (the docked card prints `Desk chat: on/off`). Both are asserted by tests.
- **The pane half is untouched:** the row still does `mountPane()` → `revealChart()` (adopt + reveal, twice) and the pane keeps `dock: { pane: 'workspace', pos: 'right', enforce: true }`.

## Deploy + reload

```sh
# repo → app (install.sh's own two lines, minus the rest of the installer)
cp traders-desk/desktop/plugin.js traders-desk/desktop/plugin.expect.json \
   "$HERMES_HOME/desktop-plugins/traders-desk/"
# confirm the reload from the beacon — console.error is the ONLY channel that reaches this log
grep 'traders-desk' ~/.hermes/logs/desktop.log | tail -3
```

`console.log` never reaches `desktop.log`; `console.error` does — so a beacon is the plugin's only way
to be heard. The app hot-reloads within seconds of the file landing; ⌘K → **Reload desktop plugins**
is the fallback, and an app restart is never the answer.

A silent log is ambiguous — "nothing logged" and "the plugin never ran" look identical from here.
Compare the log's mtime across the change; when it stays quiet, fall back to the storage-key check
below instead of concluding the plugin (or the beacon channel) is broken.

## What CI can prove, and what only the live click can

- **Harness:** `node tools/verify-plugin.mjs traders-desk/desktop/plugin.js`. Its stub SDK must export
every door the plugin calls — add to `tools/verify-plugin.mjs` when you start using a new one.
Symptom of a missing stub: `does not provide an export named X`; symptom of a *guarded* door the stub
lacks: the new branch silently takes the fallback and the harness still says OK. Effects do not fire
in the harness (its `useEffect` is a no-op), so it renders state, it does not exercise the click path.
- **`plugin.expect.json`** pins rendered strings (ours: `Chart docked on the right`, `Desk chat: on`).
A new visible state deserves a needle there, or a rename fails nothing until a human runs the harness.
- **Live proof of the click path:** the operator clicks the row with no chat in front, then
  `grep 'desk:' ~/.hermes/logs/desktop.log` shows `desk: minted <id>` / `desk: opened <id>`; a focused
  chat logs nothing, which is equally a pass. Cross-check the mint from the plugin's OWN storage, not
  from `state.db`: a `ctx.storage` key is readable in the app's Local Storage leveldb —
  `strings "$HOME/Library/Application Support/Hermes/Local Storage/leveldb"/*.log | grep traders-desk`
  (only `traders-desk.paneOpen` present ⇒ the session code never reached its write). A `session.create`
  row appears in `state.db` only at that session's FIRST PROMPT, so a missing row there is NOT proof
  the open failed.
- **Don't assume a page switch clears the focused id.** Clicking a sidebar page (Settings, Scheduled
  jobs) while the workspace tab still holds a chat can leave `focusedStoredSessionId` set, so the guard
  correctly takes the "leave my chat alone" branch and mints nothing — verify the state before blaming
  the plugin. To exercise the positive path, relaunch the app and click the row as the first action;
  and if the click is driven by `computer_use` rather than a human, its approval cannot be answered
  from a phone, so that route needs the operator at the machine or an explicit re-ask.
- **Selftest battery:** `node tools/verify-plugin-selftest.mjs` — on this Mac (Node 26) 4 evasion cases
  report wrong while `HEAD`'s harness behaves identically, i.e. pre-existing and environment-dependent
  (CI runs Node 20). Do not "fix" them inside an unrelated change; verify against `HEAD` before
  believing a red selftest is yours.

## Pitfalls

- **A row that switches sessions unconditionally steals the user out of their chat** — that is why the
  guard exists, and why the guard tests name the old call shape. Reintroducing it without the guard is
  the failure mode they are written for.
- **Reading the focused id once at mount** decides on a value that has not loaded yet; subscribe, or
  re-run the effect on its change.
- **Never route on a runtime session id:** routes and `openSession` take the durable/stored id; a
  runtime id lands on a route no parser accepts.
- **Speak to the operator's own words when he disagrees with a design:** the row's behaviour has now
  been pinned, un-pinned and re-pinned with conditions — read the guard tests before "simplifying" a
  condition away.
