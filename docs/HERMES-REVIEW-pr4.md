# Hermes review — PR #4 (inputs, error marks, Ctrl+Enter)

Verified live in Hermes Desktop at a 1478 px console width (2560×1440 monitor), against the operator's real
LuxAlgo script (Hull Butterfly Oscillator (copy), 124 lines, 11 inputs). Suite locally: **850 tests, all
green** (one transient failure was the live-tree drift test while a probe hook was installed; it passes
after `tools/sync-live.sh`).

## Verified ✓

- **Settings**: the gear appears for the real script (scan ≈ 800 ms); 11 rows with the right control kinds
  (number / select / color / switch), grouped; the alpha hex is kept (`#2157F380`); ↺ only on a changed row;
  "Reset all"; the count reads "11 inputs · 1 changed". Change → auto re-run ("… · 1 input changed");
  bool off → the guarded plot disappears (1 series → 0); ↺ / Reset all → defaults + re-run; reload → the
  value and the count persist.
- **Errors**: syntax → "Failed · line 4, col 23 · Unexpected character '@'" + red gutter number + tinted
  line + "Go to line 4" (focuses and selects) + editing clears the mark; name error → "Failed · likely
  line 5 · nope is not defined". (The doc's example says col 24; the same line reports col 23 — the
  engine's column of the first `@`. Worth a look if the doc quote matters.)
- **Ctrl+Enter** runs from the editor and from the name field.

## Bug — the drawer layer of the Escape chain

**Symptom (measured):** with the drawer open (no Settings open), ONE Escape closes the **pane** and leaves
the **drawer open** — the reverse of the intended "drawer, then Settings, then the pane".

**Root cause:** two `document` keydown handlers:

- `escapeKeydown` (`app.js:1176`), bound at **line 1218** — closes the Settings layer, then falls through to
  `el.main.dataset.detail === 'on'` → `setPanel('detail', false)` + `preventDefault()`. It never asks
  `closeDrawerIfOpen`.
- the pane's handler (`app.js:1613`) — **has** the drawer-first check, but it is bound *after*
  `escapeKeydown`, so with the drawer open it is skipped: `escapeKeydown` has already preventDefault-ed
  while closing the pane.

**Fix (one line):** give `escapeKeydown` the same drawer-first check the pane handler has, before its
detail branch:

```js
if (typeof window.closeDrawerIfOpen === 'function' && window.closeDrawerIfOpen()) {
  e.preventDefault();
  return;
}
```

**Proof recipe:** pane open → `window.libDrawer.open(true)` → read `.lib-drawer[aria-hidden]` ("false" =
open) → dispatch `new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true})` → expect the
drawer closed (aria "true") and the pane still open. Dispatch **cancelable: true** — a non-cancelable
synthetic event makes `preventDefault()` a no-op and the bug then looks like "one Esc closes both layers"
(a probe artifact, not the real behaviour).

## Notes / answers to open questions

- **Agent runs stay OUT of the pane's run list** — the operator's decision (he does not want extra visual
  complexity; chat + the app's activity note already cover it).
- The colour input's native picker was not opened (webview); the hex path was exercised programmatically.
- The 439-line Library script's scan time was not measured (the 124-line real script scanned in ~800 ms).
- The agent `script` / MCP `inputs` parameter was not tested (documented as not supported yet).
- PR #3 doc nit, still open: the lost-line-breaks example in that handoff (69 chars) is under the `> 80`
  gate, so the warning does not fire for the documented string — use a longer example or note the gate.
