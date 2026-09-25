# Trader's Agent — non-chart UI polish (components + collapsible surfaces)

> **Plan file:** `.hermes/plans/2026-09-25_081303-traders-agent-ui-polish.md`
> **Repo (source of truth):** `/home/godzillaton/Projects/tradersagent-plugin`
> **Live tree (what the pane serves):** `/home/godzillaton/Projects/luxalgo-web` → `http://127.0.0.1:8787/`
> **Audience:** an implementer with **zero context** and **no design judgement**. Every colour, size,
> duration and easing you need is written out below. Where a value is not given, do not invent one —
> reuse an existing `--lx-*` token.
>
> **Scope (operator, 25 Sep — "I am talking part only"):** the confirmed target is **the Library
> part of the pane**: the search block, the filter row, the suggestion chips, the "Browse all" bar,
> the family bubble row and the concept popover it opens. **Phases 2 and 3 deliver exactly that.**
> Phases 4–5 (detail pane, global toast/button layer) sit outside the requested part and are marked
> **optional** — implement only if the operator asks for them.

---

## TL;DR for the implementer

1. This plan upgrades the **non-chart** UI of the Trader's Agent console. The operator's confirmed
   target is the **Library part**: search block, filters, chips, "Browse all" bar, family bubbles
   and the concept popover they open (**Phases 2–3**). Phases 4–5 (detail pane, feedback layer) are
   optional adjacent polish. The Vela chart is **out of scope** — do not touch it, its tokens, or
   its DOM.
2. The frontend is **vanilla HTML/CSS/JS with no build step** (deliberate: it runs inside a Hermes
   desktop pane on a 2016 laptop). The referenced component libraries (Spectrum UI, shadcn,
   ObsidianUI) are React/Tailwind — we **port their look and interaction language**, we do not add
   React, Tailwind, npm or a bundler. That decision is final for this plan.
3. Work **task by task**. Each task: write the failing test (a source-shape pin in
   `console/backend/tests/test_ui_polish.py`), run it and watch it fail, implement, run it and watch
   it pass, commit. The suite is stdlib `unittest` — no extra dependencies.
4. Keep every DOM contract the chart bridge reads: ids `browse-body`, `browse-list`,
   `browse-concepts`, `browse-concepts-list`, `browse-concepts-more`, class `.browse__fam` with
   `dataset.family`, the `.row` class on every concept/indicator row, and the global
   `familyConceptState` object with `.open` / `.family` / `.loading` / `.queued`. The bridge counts
   `.row` elements to report what is on screen — **never make a non-row element a `.row`**.
5. Verify visually **inside Hermes only** (screenshot the pane), never by opening an external
   browser. The operator's rule, 24 Sep.

---

## 1. Goal

Make the Trader's Agent console's non-chart surfaces (Library panel, family disclosure popover,
detail pane, toasts/buttons/skeletons) look and behave like a modern, expensive component library —
the look of the X posts' references — while keeping the current vanilla stack, the existing token
system, and every behavioural contract the tests and chart bridge depend on.

---

## 2. Current context / assumptions

### 2.1 The two trees

| Tree | Path | Role |
|---|---|---|
| Repo | `/home/godzillaton/Projects/tradersagent-plugin` | Source of truth. All edits happen here. |
| Live | `/home/godzillaton/Projects/luxalgo-web` | Served at `127.0.0.1:8787` by the user unit `luxalgo-web`. The Hermes pane iframes this. |

`./tools/sync-live.sh` copies `console/frontend/*`, `console/backend/{server,chart_bridge,chart_stream,agents_store,chat}.py` and `console/bin/trader-chart` into the live tree.
After syncing, reload the console page with `./bin/trader-chart reload --json` (from the live tree).

### 2.2 The stack (why there is no build step)

- `console/frontend/index.html` loads **classic scripts** plus one **import map** for Vela's ES
  modules. There is deliberately no bundler, no npm dependency, no webfont fetch ("system-first so
  first paint never waits on a font request").
- One stylesheet: `console/frontend/styles.css` — 5 layers: `:root` tokens (dark), light theme
  overrides, Vela token mapping on `.chart` (**do not touch**), a base sheet, and components.
- Palette rules that must hold: **one accent** (`--lx-accent: #1197e2` dark / `#0b7cbd` light), one
  font stack, one radius scale, one motion scale. Never invent a second blue or grey.
- Hardware is a 2016 HP Pavilion (i5-7200U, 8 GB): every animation must be **transform/opacity
  only**, every blur **≤ 12px**, and only on small surfaces.

### 2.3 Hard contracts (do not break)

1. Bridge contracts listed in the TL;DR (ids, classes, `familyConceptState`).
2. `console/backend/tests/test_catalogue_browse.py` and `test_pane_audit.py` grep the source text —
   read them before renaming anything. E.g. `test_catalogue_browse` pins
   `kind: conceptMode ? 'concepts' : 'indicators'` inside `chart-bridge.js`, the comment
   `Vela's own "Indicators" menu lists only ITS` in `index.html`, and that `pickFamily` calls
   `loadFamilyConcepts` but **not** `loadBrowse`.
3. `openResult()` in `app.js` is the **one door** for opening a detail (search hits, browse rows and
   concept rows all call it). Do not add a second detail renderer.
4. One indicator per chart; the polish must not apply, mount or run anything by itself.

### 2.4 In scope / out of scope

| In scope | Out of scope |
|---|---|
| Library panel: search block, filter row, suggestion chips, family chip row, browse list, "Browse all" bar | The Vela chart, its toolbar, its tokens (`.chart` block), `workspace.js` |
| Family disclosure popover (`#browse-concepts`) — surface, grouping, keyboard, close paths | `unified.js` run behaviour, PineTS execution, the script editor's logic |
| Detail pane (`#detail`): head, badges, actions, concept write-up, code block | Backend endpoints, MCP tools, CLI behaviour |
| Feedback: toasts, button states, skeletons, focus rings | Adding React/Tailwind/Motion/npm/bundler; panel open/close animation (see Risks) |

---

## 3. Design direction (the references, judged)

### 3.1 What the operator sent

**Post 1** (`x.com/arihantCodes/status/2098039152659120272`) — "the best modern UI component
libraries on the internet right now", listing: Spectrum UI, 21st.dev, shadcnblocks, ReactBits,
8bitcn, EvilCharts, coss.com/ui, RareUI, beui.
**Post 2** (`x.com/arihantCodes/status/2100933288563278121`) — Spectrum UI's own launch: 250+
animated React + Tailwind components, shadcn-CLI installable, free/open source.

### 3.2 Verdict table

| Reference | What it is | Fit here | Verdict |
|---|---|---|---|
| **Spectrum UI** | Animated React/Tailwind components, shadcn-compatible | Its *interaction language* — animated disclosure, hover lift, elevated popovers, command-style lists — is exactly the "expensive" look asked for. Components are React; we port the language. | ✅ **Primary visual reference** |
| **shadcn/ui** | Canonical component anatomy + token system | Anatomy to copy: Popover, Command, Collapsible, Badge, Skeleton, Tooltip. The console already notes a "Collapsible pattern" in `styles.css`. | ✅ **Structural reference** |
| **ObsidianUI** (operator's standing component source) | React + Tailwind + Motion registry | Same React constraint; used as the second anatomy reference for popover/disclosure/scroll areas. | ✅ secondary |
| 21st.dev · shadcnblocks · coss.com/ui | Community blocks | Block-level, React; nothing usable in a vanilla page | ⛔ skip |
| ReactBits · beui · RareUI | Animated effect components | Effects are overkill and a perf risk on this laptop | ⛔ skip |
| 8bitcn | Retro pixel | Wrong vibe for a trading console | ⛔ skip |
| EvilCharts | Animated SVG charts | Charts are Vela's; the operator excluded them | ⛔ out of scope |

### 3.3 The decision

**Port the design language into the existing vanilla stack.** New tokens for motion, glass and
elevation; rebuilt component CSS for the four groups; small vanilla-DOM changes where markup was
never dressed (`.row__top`, `.row__desc` exist in `app.js` but have **no CSS rules** — that is the
main reason the list reads flat today).

### 3.4 The visual spec (taste, written down — use these numbers everywhere)

| Property | Value |
|---|---|
| Popover surface | `--lx-surface-glass` (dark `rgba(19,19,23,.88)` / light `rgba(252,252,251,.92)`) + `backdrop-filter: blur(12px) saturate(1.1)` |
| Popover border / radius / shadow | `1px solid var(--lx-border-strong)` · `12px` · `--lx-shadow-pop` |
| Entry motion | `180ms` · `cubic-bezier(.22, 1.2, .36, 1)` · from `opacity:0; translateY(-6px) scale(.985)` |
| Micro-transitions (hover/press) | `120ms` · `var(--lx-ease)` |
| Row anatomy | column: line 1 = name + kind badge (space-between); line 2 = description (max 2 lines, clamp); line 3 = meta (`11px`, muted) |
| Row hover / active | hover `--lx-bg-hover`; press `translateY(1px)`; active = `--lx-accent-soft` fill + 2px left accent bar (non-colour cue — keep) |
| Group headers | `10px`, uppercase, `letter-spacing: .08em`, `--lx-fg-faint` |
| Focus | keep the existing `--lx-focus-ring` + `--lx-focus-halo`; never remove `:focus-visible` |
| Reduced motion | the global `@media (prefers-reduced-motion: reduce)` guard already kills all animation — do not add JS animations that bypass it |

---

## 4. Architecture / proposed approach

Extend `:root` (and its light mirror) with a handful of new tokens, then rebuild four component
groups as CSS + minimal vanilla-DOM changes, keeping every id/class the bridge and tests rely on.
Component anatomy follows shadcn/ObsidianUI (popover, command list, collapsible, badge, skeleton);
micro-interactions follow Spectrum UI (animated disclosure, hover lift, entry transitions), all
expressed in the existing `--lx-*` tokens. No new dependencies, no build step, no chart changes.

---

## 5. Task list (order, commit messages)

| # | Task | Commit message |
|---|---|---|
| T0.1 | Commit the in-flight session work; sync + reload; confirm a clean tree | `feat(library,mcp,pinets): concept disclosure + search normalisation + bars context` |
| T1.1 | Tokens: motion, glass, popover elevation | `style(console): add motion, glass and popover tokens` |
| T1.2 | Row anatomy (`.row` column + `.row__top/.row__desc/.row__kind--concept`) | `style(console): give catalogue rows their two-line anatomy` |
| T2.1 | Family chip row: horizontal scroll + edge fade + caret | `style(library): family chips scroll as one row with a disclosure caret` |
| T2.2 | Honest counts (all-chip, topbar label, boot toast, comments) | `fix(library): counts come from the API, not a baked 805` |
| T2.3 | Browse list skeletons + Load-more polish | `style(library): skeleton rows while the catalogue loads` |
| T2.4 | Search field polish (icon, clear button, focus) | `style(library): dress the search field` |
| T3.1 | Popover surface + entry animation + close button + footer hint | `style(library): the concept popover looks like a popover` |
| T3.2 | Cluster grouping with `.browse__group` headers | `feat(library): group concepts by cluster` |
| T3.3 | Keyboard nav + click-away + Escape | `feat(library): the popover closes the way people expect` |
| T3.4 | Scroll affordance shadows | `style(library): scroll affordance on the concept list` |
| T4.1 *(optional)* | Detail sticky head + action states | `style(detail): sticky head and button states` |
| T4.2 *(optional)* | Markdown renderer for concept write-ups | `feat(detail): render the concept write-up as markdown` |
| T4.3 *(optional)* | Code block chrome + single copy button | `style(detail): dress the Pine code block` |
| T5.1 *(optional)* | Floating toast | `style(console): the toast floats instead of taking a row` |
| T5.2 *(optional)* | Button press/sheen/spinner | `style(console): buttons answer back` |
| T6.1 | CHANGELOG + README row + stale comments | `docs: record the UI polish pass` |
| T6.2 | Full verification sweep (suite, sync, reload, screenshots, bridge reads) | (no commit — verification only) |

---

## 6. Tasks

### Phase 0 — prep

#### T0.1 — Commit the in-flight work; sync; reload

**Files:** none (git only).

**Do:**

```bash
cd /home/godzillaton/Projects/tradersagent-plugin
python3 -m unittest discover -s console/backend/tests -t console/backend/tests -q   # must print OK
git status --short          # expect ~12 modified files from the 24 Sep session
git add -A
git commit -m "feat(library,mcp,pinets): concept disclosure + search normalisation + bars context

- family bubbles disclose Library concepts (browse popover) instead of filtering indicator scripts
- MCP library_search accepts singular types and mixed-case slugs
- PineTS fallback carries symbol/timeframe context and openTime-keyed bars"
./tools/sync-live.sh
```

**Verify:**

```bash
cd /home/godzillaton/Projects/luxalgo-web && ./bin/trader-chart reload --json
```

Expected: JSON with `"ok": true` and a detail mentioning the reload; exit 0. The pane shows the
console again a second later. If the reload fails, open the Trader's Agent pane first (the reload
rides the page's bridge).

Then:

```bash
cd /home/godzillaton/Projects/tradersagent-plugin && git status --short
```

Expected: **empty** output (clean tree) — all later tasks start from a clean tree.

**Push (only if the operator confirms):** `git push origin main`.

---

### Phase 1 — foundation

#### T1.1 — Tokens: motion, glass, popover elevation

**Files:** `console/frontend/styles.css`; new test file `console/backend/tests/test_ui_polish.py`.

**Test first — create `console/backend/tests/test_ui_polish.py` with exactly this content:**

```python
"""Pins for the 25 Sep UI polish pass on the console's non-chart surfaces.

Same convention as test_pane_audit.py: this repo has no JS test runner, so each behaviour that
would otherwise only be visible by eye is pinned as a shape in the source. The defects these guard
are the quiet ones — a class rendered with no CSS rules behind it, a count that went stale
upstream, a popover that cannot be closed from the keyboard.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")
APP = os.path.join(ROOT, "console", "frontend", "app.js")
HTML = os.path.join(ROOT, "console", "frontend", "index.html")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def rule(css: str, selector: str) -> str:
    """Declaration block of the FIRST rule for `selector` (pass the selector without its brace)."""
    match = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return match.group(1) if match else ""


class TokensCarryThePolish(unittest.TestCase):
    def test_motion_and_elevation_tokens_exist(self):
        css = read(CSS)
        for token in ("--lx-ease-spring", "--lx-dur-pop", "--lx-shadow-pop",
                      "--lx-surface-glass", "--lx-radius-pop", "--lx-blur-pop"):
            self.assertIn(token, css, f"{token} is part of the polish pass")

    def test_light_theme_mirrors_them(self):
        light = read(CSS).split('[data-theme="light"]', 1)[1]
        for token in ("--lx-surface-glass", "--lx-shadow-pop"):
            self.assertIn(token, light, f"light theme must carry {token}")
```

**Run it and watch it fail:**

```bash
cd /home/godzillaton/Projects/tradersagent-plugin
python3 -m unittest discover -s console/backend/tests -t console/backend/tests -p 'test_ui_polish.py' -v
```

Expected: `FAILED (failures=1)` with `AssertionError: --lx-ease-spring is part of the polish pass`.

**Implement — in `styles.css`, inside the dark `:root` block, immediately after the
`--lx-shadow-sheen` declaration:**

```css
  /* Polish pass (25 Sep): motion + elevation for popovers, rows and toasts. Deliberately small
     values — this app runs on a 2016 Pavilion, so every animation is transform/opacity only and
     every blur stays at 12px or less. */
  --lx-surface-glass:   rgba(19, 19, 23, .88);   /* surface-2 at 88%, for the concept popover */
  --lx-blur-pop:        12px;
  --lx-radius-pop:      12px;
  --lx-shadow-pop:      0 16px 48px rgba(0, 0, 0, .55),
                        0 2px 8px rgba(0, 0, 0, .35),
                        inset 0 1px 0 rgba(255, 255, 255, .05);
  --lx-ease-spring:     cubic-bezier(.22, 1.2, .36, 1);   /* gentle overshoot for entry */
  --lx-dur-pop:         180ms;
  --lx-dur-fast:        120ms;
```

…and inside the light block `:root[data-theme="light"]`, immediately after its `--lx-shadow-sheen`
declaration:

```css
  --lx-surface-glass:   rgba(252, 252, 251, .92);
  --lx-blur-pop:        12px;
  --lx-radius-pop:      12px;
  --lx-shadow-pop:      0 16px 44px rgba(0, 0, 0, .14),
                        0 2px 8px rgba(0, 0, 0, .06),
                        inset 0 1px 0 rgba(255, 255, 255, .80);
  --lx-ease-spring:     cubic-bezier(.22, 1.2, .36, 1);
  --lx-dur-pop:         180ms;
  --lx-dur-fast:        120ms;
```

**Verify:** run the same test command → `OK`. Then `node --check console/frontend/app.js` → no output, exit 0 (nothing JS changed, this is a guard habit).

**Commit:** `git add -A && git commit -m "style(console): add motion, glass and popover tokens"`

---

#### T1.2 — Row anatomy: `.row` becomes a column, and its parts get rules

**Why:** `app.js` renders `.row__top`, `.row__desc`, `.row__kind--concept` and `.row__meta` inside
every row, but `styles.css` only defines `.row__name`, `.row__meta`, `.row__kind` — and `.row`
itself is a **flex row**, so those lines currently sit side by side instead of stacked. This task is
the single biggest visual fix in the plan.

**Files:** `console/frontend/styles.css`; append to `test_ui_polish.py`.

**Test first — append this class to `test_ui_polish.py`:**

```python
class TheRowsHaveTheirAnatomy(unittest.TestCase):
    def test_row_is_a_column_with_styled_parts(self):
        css = read(CSS)
        row = rule(css, ".row")
        self.assertIn("flex-direction: column", row, "the row carries a name line and a meta line")
        for selector in (".row__top", ".row__desc", ".row__kind--concept"):
            self.assertIn(selector, css, f"{selector} is rendered by app.js and must be dressed")
```

Run: `python3 -m unittest discover -s console/backend/tests -t console/backend/tests -p 'test_ui_polish.py' -v`
Expected: `FAILED` — `AssertionError: the row carries a name line and a meta line`.

**Implement — in `styles.css`, replace the existing `.row { … }`, `.row:hover { … }` and
`.row--active { … }` rules (the block that starts `display: flex; align-items: center; gap:
var(--lx-space-2);`) with:**

```css
.row {
  display: flex; flex-direction: column; align-items: stretch; justify-content: center;
  gap: 3px;
  width: 100%; min-height: var(--lx-row-h); padding: var(--lx-space-2) var(--lx-space-25);
  text-align: left; font: inherit; cursor: pointer;
  color: var(--lx-fg); background: transparent;
  border: 0; border-left: 2px solid transparent; border-radius: var(--lx-radius-lg);
  transition: background var(--lx-dur-fast) var(--lx-ease),
              transform var(--lx-dur-fast) var(--lx-ease);
}
.row:hover { background: var(--lx-bg-hover); }
.row:active { transform: translateY(1px); }
/* selection = accent tint + 2px bar, a NON-colour cue, not Vela's filled chip */
.row--active { background: var(--lx-accent-soft); border-left-color: var(--lx-accent-line); }
/* The two-line anatomy every row in this app renders: name + kind on line 1, description and meta
   below. app.js has emitted these classes since the catalogue shipped; they had no rules, so the
   rows read as flat text. */
.row__top {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--lx-space-2); min-width: 0;
}
.row__desc {
  font-size: var(--lx-fs-sm); color: var(--lx-fg-muted); line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.row__kind--concept { color: var(--lx-warn); border-color: rgba(224, 180, 0, .40); }
```

**Verify:** same test command → `OK`; then the full suite:
`python3 -m unittest discover -s console/backend/tests -t console/backend/tests -q` → `OK (skipped=38)`.

**Commit:** `git add -A && git commit -m "style(console): give catalogue rows their two-line anatomy"`

---

### Phase 2 — the Library panel

#### T2.1 — Family chip row: one scrolling row, edge fade, disclosure caret

**Files:** `console/frontend/styles.css`, `console/frontend/app.js`; append to `test_ui_polish.py`.

**Test first:**

```python
class TheFamilyRowScrolls(unittest.TestCase):
    def test_the_chip_row_scrolls_sideways_with_a_fade(self):
        fams = rule(read(CSS), ".browse__families")
        self.assertIn("nowrap", fams)
        self.assertIn("mask-image", fams, "the fade is what tells the eye the row scrolls")

    def test_chips_carry_a_caret_that_turns(self):
        app = read(APP)
        self.assertIn("browse__fam-caret", app)
        self.assertIn('browse__fam[aria-expanded="true"] .browse__fam-caret', read(CSS))
```

Run the focused command → expect `FAILED`.

**Implement — in `styles.css`, replace the `.browse__families` and `.browse__fam` rules with:**

```css
.browse__families {
  display: flex; flex-wrap: nowrap; gap: var(--lx-space-1);
  padding: var(--lx-space-2) var(--lx-space-3);
  overflow-x: auto; overscroll-behavior-x: contain;
  border-bottom: 1px solid var(--lx-border);
  /* The row scrolls; the fade says so without a scrollbar taking a lane. */
  mask-image: linear-gradient(90deg, transparent 0, #000 10px, #000 calc(100% - 10px), transparent 100%);
  scrollbar-width: none;
}
.browse__families::-webkit-scrollbar { display: none; }
.browse__fam {
  display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;
  font-size: var(--lx-fs-xs); padding: 3px var(--lx-space-2);
  border: 1px solid var(--lx-border-soft); border-radius: 999px;
  background: transparent; color: var(--lx-fg-muted); cursor: pointer;
  transition: color var(--lx-dur-fast) var(--lx-ease),
              border-color var(--lx-dur-fast) var(--lx-ease),
              background var(--lx-dur-fast) var(--lx-ease);
}
.browse__fam:hover { color: var(--lx-fg-bright); border-color: var(--lx-border-strong); background: var(--lx-bg-hover); }
.browse__fam.is-on { color: var(--lx-fg-bright); border-color: var(--lx-accent-line); background: var(--lx-accent-soft); }
.browse__fam-caret { font-size: 9px; opacity: .65; transition: transform var(--lx-dur-fast) var(--lx-ease); }
.browse__fam[aria-expanded="true"] .browse__fam-caret { transform: rotate(180deg); opacity: 1; }
.browse__fam-count { color: var(--lx-fg-faint); }
```

**…and in `app.js`, inside `loadFamilies()`, give each chip three spans instead of one text node.**
Replace `all.textContent = 'all 805';` and the per-family `b.textContent = …` lines with:

```js
    all.innerHTML = `<span class="browse__fam-label">All concepts</span>`
      + `<span class="browse__fam-caret" aria-hidden="true">▾</span>`;
```

```js
      b.innerHTML = `<span class="browse__fam-label">${esc(f.name)}</span>`
        + (f.concept_count ? `<span class="browse__fam-count">${esc(String(f.concept_count))}</span>` : '')
        + `<span class="browse__fam-caret" aria-hidden="true">▾</span>`;
```

(The `dataset.label` / `dataset.family` lines and the `aria-controls`/`aria-expanded` lines stay
exactly as they are — the bridge and `setFamilyDisclosure` depend on them. T2.2 replaces the
`all 805` label with the live total.)

**Verify:** focused test → `OK`; `node --check console/frontend/app.js` → exit 0.

**Commit:** `git add -A && git commit -m "style(library): family chips scroll as one row with a disclosure caret"`

---

#### T2.2 — Counts come from the API (kill the baked "805")

**Why:** upstream moved on: `/api/indicators` now totals **806** and `/api/concepts` **853**, while
the chip says "all 805" and the boot toast says "805 indicators". A count that drifts is a lie the
operator cannot see. Make all three user-visible numbers dynamic, and purge the stale number from
comments/docs.

**Files:** `console/frontend/app.js`, `console/frontend/index.html`; append to `test_ui_polish.py`.

**Test first:**

```python
class TheCountsAreHonest(unittest.TestCase):
    def test_the_all_chip_uses_the_live_concept_total(self):
        app = read(APP)
        self.assertNotIn("'all 805'", app, "the baked 805 went stale upstream (853 concepts now)")
        self.assertIn("api('/api/concepts', { page_size: 1 })", app)

    def test_no_stale_number_is_baked_into_the_chrome(self):
        self.assertNotIn("805", read(HTML), "the topbar label must not bake a count that drifts")
        self.assertNotIn("805 indicators", read(APP))
```

Run → expect `FAILED`.

**Implement — `app.js`, `loadFamilies()`:** after `const data = await api('/api/families', {});` add:

```js
    // The family counts are concepts; the ALL chip needs the catalogue's own total, which no
    // family carries. One 1-row read answers it exactly (and never drifts like a baked number).
    let conceptTotal = 0;
    try { conceptTotal = Number((await api('/api/concepts', { page_size: 1 })).total || 0); }
    catch { /* the chip falls back to a bare label — never a wrong number */ }
```

and set the all-chip label:

```js
    all.innerHTML = `<span class="browse__fam-label">All concepts</span>`
      + (conceptTotal ? `<span class="browse__fam-count">${esc(String(conceptTotal))}</span>` : '')
      + `<span class="browse__fam-caret" aria-hidden="true">▾</span>`;
```

**`app.js`, `loadBrowse()`:** after `const total = data.total ?? browseState.rows.length;` add:

```js
    // The topbar door carried a baked count ("805"); it is 806 now. Read it once, from the API.
    if (el.libOpen && !el.libOpen.dataset.counted && data.total) {
      const label = el.libOpen.querySelector('.btn__label');
      if (label) label.textContent = ` ${data.total}`;
      el.libOpen.dataset.counted = '1';
    }
```

**`app.js`, `main()`:** replace `toast('LuxAlgo Library — 805 indicators');` with
`toast('LuxAlgo Library ready');`

**`index.html`:** change the `#lib-open` button to
`title="Browse the LuxAlgo Library indicator catalogue">☰<span class="btn__label"> catalogue</span>`
and reword the two comments that say "805" to say "the catalogue" (lines ~33 and ~88). The pinned
comment `Vela's own "Indicators" menu lists only ITS` must stay.

**Verify:** focused test → `OK`; then `grep -rn "805" console/frontend/` → no matches.

**Commit:** `git add -A && git commit -m "fix(library): counts come from the API, not a baked 805"`

---

#### T2.3 — Browse list: skeleton rows while loading, tidy Load-more

**Files:** `console/frontend/app.js`, `console/frontend/styles.css`; append to `test_ui_polish.py`.

**Test first:**

```python
class TheListShowsItsShapeWhileLoading(unittest.TestCase):
    def test_browse_loading_uses_skeleton_rows(self):
        app = read(APP)
        self.assertIn("function skeletonRows", app)
        load = app.split("async function loadBrowse", 1)[1].split("browseState.loading = true", 1)[1]
        self.assertIn("skeletonRows", load[:800], "the reset branch paints row-shaped placeholders")

    def test_skeleton_rows_are_dressed(self):
        self.assertIn(".skeleton--row", read(CSS))
```

Run → expect `FAILED`.

**Implement — `app.js`:** next to `function skeletons(n = 4)` add:

```js
/* Row-shaped placeholders for any list that is about to be replaced. The old text note ("Loading
   the catalogue…") told the eye nothing about what was coming; a skeleton of the same height keeps
   the list from jumping when the rows land. */
function skeletonRows(n = 5) {
  return Array.from({ length: n }, () => '<div class="skeleton skeleton--row"></div>').join('');
}
```

In `loadBrowse()`, replace
`el.browseList.innerHTML = '<div class="browse__note">Loading the catalogue…</div>';`
with
`el.browseList.innerHTML = skeletonRows(5);`

In `loadFamilyConcepts()`, replace
`el.browseConceptsList.innerHTML = '<div class="browse__note">Loading concepts…</div>';`
with
`el.browseConceptsList.innerHTML = skeletonRows(4);`

**`styles.css`, after the existing `.skeleton` rule:**

```css
.skeleton--row { height: 52px; border-radius: var(--lx-radius-lg); }
```

**Verify:** focused test → `OK`; full suite → `OK`.

**Commit:** `git add -A && git commit -m "style(library): skeleton rows while the catalogue loads"`

---

#### T2.4 — Search field polish

**Files:** `console/frontend/styles.css`; append to `test_ui_polish.py`.

**Test first:**

```python
class TheSearchFieldIsDressed(unittest.TestCase):
    def test_search_input_carries_its_icon_and_hides_the_native_cancel(self):
        css = read(CSS)
        search = rule(css, 'input[type="search"]')
        self.assertIn("data:image/svg+xml", search, "a magnifier makes the field read as search")
        self.assertIn("-webkit-search-cancel-button", css, "the native black ✕ is wrong on dark")
```

Run → expect `FAILED`.

**Implement — `styles.css`:** inside the existing `input[type="search"], select { … }` rule add
`padding-left: 30px;` and `background-image`/`background-repeat`/`background-position`/
`background-size` for the icon; then add below that rule:

```css
/* The magnifier is inline SVG (no request, no icon font) at the palette's neutral grey so it
   reads on both themes. */
input[type="search"] {
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%238b8b95' stroke-width='1.5' stroke-linecap='round'><circle cx='7' cy='7' r='4.5'/><path d='M10.5 10.5 14 14'/></svg>");
  background-repeat: no-repeat; background-position: 9px center; background-size: 13px;
}
input[type="search"]::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
```

**Verify:** focused test → `OK`; screenshot check later in T6.2.

**Commit:** `git add -A && git commit -m "style(library): dress the search field"`

---

### Phase 3 — the disclosure popover (the "pop up details")

#### T3.1 — Popover surface, entry animation, close button, footer hint

**Files:** `console/frontend/styles.css`, `console/frontend/index.html`, `console/frontend/app.js`;
append to `test_ui_polish.py`.

**Test first:**

```python
class ThePopoverLooksLikeAPopover(unittest.TestCase):
    def test_surface_glass_and_entry_animation(self):
        css = read(CSS)
        pop = rule(css, ".browse__concepts")
        for needle in ("--lx-surface-glass", "backdrop-filter", "animation: pop-in", "--lx-shadow-pop"):
            self.assertIn(needle, pop, needle)
        self.assertIn("@keyframes pop-in", css)

    def test_it_has_a_close_button_and_a_hint(self):
        html = read(HTML)
        self.assertIn('id="browse-concepts-close"', html)
        self.assertIn("browse__concepts-hint", html)
        self.assertIn("browseConceptsClose", read(APP))
```

Run → expect `FAILED`.

**Implement — `styles.css`:** replace the existing `.browse__concepts { … }` rule with:

```css
.browse__concepts {
  position: absolute; inset-inline: var(--lx-space-3); top: calc(100% + 4px); z-index: var(--lx-z-overlay);
  display: flex; flex-direction: column; min-width: 0; max-height: min(52vh, 460px);
  overflow: hidden; color: var(--lx-fg);
  background: var(--lx-surface-glass);
  -webkit-backdrop-filter: blur(var(--lx-blur-pop)) saturate(1.1);
  backdrop-filter: blur(var(--lx-blur-pop)) saturate(1.1);
  border: 1px solid var(--lx-border-strong); border-radius: var(--lx-radius-pop);
  box-shadow: var(--lx-shadow-pop);
  /* Entry only: the close path stays instant (display:none cannot transition). Reduced-motion
     users get no animation at all — the global guard already kills it. */
  animation: pop-in var(--lx-dur-pop) var(--lx-ease-spring);
}
@keyframes pop-in {
  from { opacity: 0; transform: translateY(-6px) scale(.985); }
  to   { opacity: 1; transform: none; }
}
```

and extend the head/foot rules:

```css
.browse__concepts-head { position: sticky; top: 0; z-index: 1; background: var(--lx-surface-glass); }
.browse__concepts-close {
  margin-left: auto; width: 24px; height: 24px; padding: 0; border: 0;
  color: var(--lx-fg-muted); font-size: var(--lx-fs-sm);
}
.browse__concepts-close:hover { color: var(--lx-fg-bright); background: var(--lx-bg-hover); }
.browse__concepts-more { display: flex; align-items: center; justify-content: space-between; gap: var(--lx-space-2); }
.browse__concepts-hint { font-size: var(--lx-fs-2xs); color: var(--lx-fg-faint); }
```

**`index.html`:** replace the `#browse-concepts` section's head and foot with:

```html
              <div class="browse__concepts-head">
                <strong id="browse-concepts-title">Library concepts</strong>
                <span class="browse__count muted" id="browse-concepts-count"></span>
                <button type="button" class="btn btn--ghost browse__concepts-close" id="browse-concepts-close"
                        aria-label="Close the concept list" title="Close (Esc)">✕</button>
              </div>
              <div class="browse__concepts-list" id="browse-concepts-list" aria-live="polite"></div>
              <div class="browse__concepts-more">
                <span class="browse__concepts-hint">↑↓ move · Enter open · Esc close</span>
                <button type="button" class="btn btn--ghost" id="browse-concepts-more">Load more concepts</button>
              </div>
```

**`app.js`:** add to the `el` map: `browseConceptsClose: $('#browse-concepts-close'),` and in
`main()` next to the other browse wiring:

```js
  el.browseConceptsClose?.addEventListener('click', closeFamilyConcepts);
```

**Verify:** focused test → `OK`; `node --check console/frontend/app.js` → exit 0.

**Commit:** `git add -A && git commit -m "style(library): the concept popover looks like a popover"`

---

#### T3.2 — Group concepts by cluster

**Why:** every concept row already carries `cluster` ("Analytics", "Laws", "Distribution schematic"),
and the popover currently prints it as grey meta text. Grouping it is what turns a wall of rows into
a scannable list — the single most "modern component library" move in this phase.

**Files:** `console/frontend/app.js`, `console/frontend/styles.css`; append to `test_ui_polish.py`.

**Test first:**

```python
class ConceptsAreGroupedNotJustListed(unittest.TestCase):
    def test_group_headers_exist_and_are_not_rows(self):
        app = read(APP)
        self.assertIn("function appendConceptRows", app)
        self.assertIn(".browse__group", read(CSS))
        fn = app.split("function appendConceptRows", 1)[1].split("\n}", 1)[0]
        self.assertIn("browseConceptRow", fn)
        self.assertNotIn("className = 'row'", fn, "a header must never be counted as a concept row")

    def test_the_state_remembers_which_groups_were_painted(self):
        self.assertIn("clusters", read(APP))
```

Run → expect `FAILED`.

**Implement — `app.js`:**

1. Extend the state object (near `let familyConceptState = { … }`) with
   `clusters: new Set(),` and add `state.clusters.clear();` in `loadFamilyConcepts`'s resetting
   branch (next to `state.rows = [];`).
2. Add the renderer next to `browseConceptRow`:

```js
/* Concepts arrive with a `cluster` (Analytics / Laws / Distribution schematic …). Sorting a page
   by cluster and printing one small-caps header per cluster turns the popover from a wall of rows
   into a scannable list. Headers are NOT `.row` elements: the chart bridge counts `.row` children
   to report what is on screen, and a header is not a concept. */
function appendConceptRows(rows, state) {
  const list = el.browseConceptsList;
  rows.slice()
    .sort((a, b) => String(a.cluster || '').localeCompare(String(b.cluster || '')))
    .forEach((row) => {
      const cluster = String(row.cluster || '').trim();
      if (cluster && !state.clusters.has(cluster)) {
        state.clusters.add(cluster);
        const head = document.createElement('div');
        head.className = 'browse__group';
        head.textContent = cluster;
        list.appendChild(head);
      }
      list.appendChild(browseConceptRow(row));
    });
}
```

3. In `loadFamilyConcepts`, replace
   `rows.forEach((row) => el.browseConceptsList.appendChild(browseConceptRow(row)));`
   with
   `appendConceptRows(rows, state);`

**`styles.css`, after the `.browse__concepts-list` rule:**

```css
.browse__group {
  padding: var(--lx-space-2) var(--lx-space-2) 2px;
  font-size: var(--lx-fs-2xs); text-transform: uppercase; letter-spacing: var(--lx-ls-wide);
  color: var(--lx-fg-faint);
}
```

**Verify:** focused test → `OK`; then read the live count back after a sync/reload:
`cd /home/godzillaton/Projects/luxalgo-web && ./bin/trader-chart --json browse --family wyckoff --show`
→ `"browse": {"kind": "concepts", "rows": 17, "family": "wyckoff", "open": true}` (headers must not
change `rows`).

**Commit:** `git add -A && git commit -m "feat(library): group concepts by cluster"`

---

#### T3.3 — Keyboard navigation, Escape, click-away

**Files:** `console/frontend/app.js`; append to `test_ui_polish.py`.

**Test first:**

```python
class ThePopoverClosesTheWayPeopleExpect(unittest.TestCase):
    def test_escape_and_arrows_are_wired(self):
        app = read(APP)
        self.assertIn("function conceptsKeydown", app)
        for key in ("ArrowDown", "ArrowUp", "Escape", "Home", "End"):
            self.assertIn(key, app)

    def test_a_click_away_closes_it(self):
        app = read(APP)
        self.assertIn("onDocumentPointerDown", app)
        self.assertIn("pointerdown", app)
```

Run → expect `FAILED`.

**Implement — `app.js`, next to `closeFamilyConcepts()`:**

```js
/* Roving focus inside the concept list: ↑/↓ walk the rows, Home/End jump, Enter opens the focused
   row through its own click handler, and Escape closes the popover — returning focus to the chip
   that owns it, so the keyboard never falls back to the top of the page. */
function conceptsKeydown(event) {
  const rows = Array.from(el.browseConceptsList.querySelectorAll('.row'));
  if (!rows.length) return;
  const current = rows.indexOf(document.activeElement);
  const focusAt = (index) => {
    rows[(index + rows.length) % rows.length].focus();
    event.preventDefault();
  };
  if (event.key === 'ArrowDown') focusAt(current < 0 ? 0 : current + 1);
  else if (event.key === 'ArrowUp') focusAt(current < 0 ? rows.length - 1 : current - 1);
  else if (event.key === 'Home') focusAt(0);
  else if (event.key === 'End') focusAt(rows.length - 1);
  else if (event.key === 'Escape') {
    event.preventDefault();
    const chip = document.querySelector('.browse__fam.is-on');
    closeFamilyConcepts();
    chip?.focus();
  }
}

/* Click-away: the popover is a disclosure, so a pointer press anywhere outside it — and outside
   the chip row that owns it — closes it. Capture phase, so it still fires when the press lands on
   another button that will repaint the panel. */
function onDocumentPointerDown(event) {
  if (!familyConceptState.open) return;
  if (event.target.closest('#browse-concepts') || event.target.closest('#browse-families')) return;
  closeFamilyConcepts();
}
```

Wire both in `main()` (next to the other browse wiring):

```js
  el.browseConceptsList?.addEventListener('keydown', conceptsKeydown);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
```

**Verify:** focused test → `OK`; full suite → `OK`. Live check (T6.2) confirms Escape works.

**Commit:** `git add -A && git commit -m "feat(library): the popover closes the way people expect"`

---

#### T3.4 — Scroll affordance on the concept list

**Files:** `console/frontend/styles.css`; append to `test_ui_polish.py`.

**Test first:**

```python
class TheConceptListShowsItsEdges(unittest.TestCase):
    def test_the_list_has_local_scroll_shadows(self):
        css = read(CSS)
        lst = rule(css, ".browse__concepts-list")
        self.assertIn("background-attachment: local", lst,
                      "the local/scroll gradient pair is the classic 'more above/below' cue")
```

Run → expect `FAILED`.

**Implement — `styles.css`:** add to the `.browse__concepts-list` rule:

```css
  /* Two gradients: one pinned to the scrollport, one scrolling with the content. Where they stop
     overlapping, the eye sees a shadow — i.e. "there is more above/below". No JS, no scroll
     listener, no repaint cost. */
  background:
    linear-gradient(var(--lx-surface-2) 30%, rgba(19, 19, 23, 0)) top / 100% 18px no-repeat local,
    linear-gradient(rgba(19, 19, 23, 0), var(--lx-surface-2) 70%) bottom / 100% 18px no-repeat local,
    radial-gradient(farthest-side at 50% 0, rgba(0, 0, 0, .28), rgba(0, 0, 0, 0)) top / 100% 8px no-repeat scroll,
    radial-gradient(farthest-side at 50% 100%, rgba(0, 0, 0, .28), rgba(0, 0, 0, 0)) bottom / 100% 8px no-repeat scroll;
```

**Verify:** focused test → `OK`; then screenshot the popover in T6.2 and confirm the shadow reads.

**Commit:** `git add -A && git commit -m "style(library): scroll affordance on the concept list"`

---

### Phase 4 — the detail pane *(optional — outside the operator's requested part)*

#### T4.1 — Sticky head, action states, busy buttons

**Files:** `console/frontend/app.js`, `console/frontend/styles.css`; append to `test_ui_polish.py`.

**Test first:**

```python
class TheDetailPaneHoldsItsPlace(unittest.TestCase):
    def test_sticky_head_and_action_states(self):
        css = read(CSS)
        self.assertIn("position: sticky", rule(css, ".detail__head"))
        self.assertIn(".btn.is-busy", css)
        self.assertIn("function setActionState", read(APP))

    def test_the_head_wraps_title_meta_and_actions(self):
        self.assertIn('class="detail__head"', read(APP))
```

Run → expect `FAILED`.

**Implement — `app.js`:** add next to `licenseLine()`:

```js
/* One place that puts a button into a running state: the label stays, a spinner is added and the
   button is disabled, so a second click can never double-run a script. */
function setActionState(button, state, label) {
  if (!button) return;
  button.classList.toggle('is-busy', state === 'busy');
  button.disabled = state === 'busy';
  if (label) button.textContent = label;
}
```

In `openResult()`'s indicator branch, replace the head/actions block with:

```js
      el.detail.innerHTML = `
        <div class="detail__head">
          <h2 class="detail__title">${esc(data.name || row.slug)}</h2>
          <div class="detail__meta">
            <span class="badge badge--ok">source: public</span>
            <span class="badge">${source.length.toLocaleString()} chars</span>
            ${lic ? `<span class="badge badge--lic">${esc(lic)}</span>` : '<span class="badge badge--lic">no licence header</span>'}
            <a class="badge" href="${esc(row.url || '#')}" target="_blank" rel="noreferrer">Library page ↗</a>
          </div>
          <div class="detail__actions">
            <button class="btn btn--primary" id="run-pinets">▶ Run PineTS</button>
            <button class="btn btn--ghost" id="mount">＋ Add to chart</button>
          </div>
        </div>
        <div class="muted detail__note" id="pine-headline">PineTS executes the script over this chart's bars and
        paints what it makes: plot series as natives, boxes/lines/labels/tables on the overlay.
        “Add to chart” additionally asks Vela's own Pine engine,
        which stays silent on many scripts in this build.</div>
```

and wrap the handlers' bodies so the button state follows the work — e.g. for Run PineTS:

```js
      $('#run-pinets').addEventListener('click', async () => {
        const label = data.name || row.slug;
        const button = $('#run-pinets');
        const headline = $('#pine-headline');
        setActionState(button, 'busy');
        headline.textContent = `Running “${label}” through PineTS… (loading the runtime on first use)`;
        try {
          await chartReady;
          const r = await window.TraderRun.run(source, label);
          if (!r.ok) {
            headline.textContent = r.reason;
            toast('PineTS: ' + r.reason, true);
            return;
          }
          headline.textContent = window.TraderRun.summarize(r);
          log(`PineTS ran “${label}” in ${r.ms} ms — ` + (r.drew
            ? `overlay drew ${r.drew.boxes}/${r.drew.lines}/${r.drew.labels} box/line/label`
            : (r.paint && r.paint.added)
              ? `Vela native “${r.paint.added.title}” on the chart`
              : 'nothing drawn'));
          refreshIndicatorCount();
          toast(`PineTS: “${label}” ran in ${r.ms} ms`);
        } catch (err) {
          headline.textContent = 'PineTS failed: ' + err.message;
          toast('PineTS failed: ' + err.message, true);
        } finally {
          setActionState(button, 'idle');
        }
      });
```

Same pattern for `#mount` (`setActionState(button, 'busy')` … `finally { setActionState(button, 'idle'); }`).

**`styles.css`, after the `.detail__actions` rule:**

```css
/* The head sticks so the title, the licence badges and the two actions stay reachable while a
   12,000-character Pine preview scrolls under them. Negative margins bleed it to the panel edge. */
.detail__head {
  position: sticky; top: 0; z-index: var(--lx-z-sticky);
  display: flex; flex-direction: column; gap: var(--lx-space-2);
  margin: calc(var(--lx-space-3) * -1) calc(var(--lx-space-3) * -1) 0;
  padding: var(--lx-space-3);
  background: var(--lx-surface-1); border-bottom: 1px solid var(--lx-border);
}
.detail__note { font-size: var(--lx-fs-sm); }
```

**Verify:** focused test → `OK`; `node --check console/frontend/app.js` → exit 0.

**Commit:** `git add -A && git commit -m "style(detail): sticky head and button states"`

---

#### T4.2 — Render the concept write-up as markdown

**Why:** the concept body arrives as `body_markdown` and is currently printed through `esc()` —
raw `#`/`*`/`[]()` characters in a wall of text. A ~45-line safe subset (escape first, format
second) is smaller than any library's loader, and this page ships with no bundler.

**Files:** `console/frontend/app.js`, `console/frontend/styles.css`; append to `test_ui_polish.py`.

**Test first:**

```python
class TheConceptWriteUpIsRendered(unittest.TestCase):
    def test_markdown_renderer_exists_and_is_used(self):
        app = read(APP)
        self.assertIn("function renderMarkdown", app)
        branch = app.split("const data = await api('/api/concept'", 1)[1]
        self.assertIn("renderMarkdown(", branch[:900])
        self.assertNotIn("esc(body.slice(0, 14000))", app)

    def test_renderer_escapes_before_it_formats(self):
        fn = read(APP).split("function renderMarkdown", 1)[1].split("\n}", 1)[0]
        self.assertIn("esc(", fn, "upstream text is data — escape first, then format")

    def test_detail_text_styles_exist(self):
        self.assertIn(".detail__text h3", read(CSS))
```

Run → expect `FAILED`.

**Implement — `app.js`, next to `esc()`:**

```js
/* A tiny, safe markdown subset for Library concept write-ups: headings, bold/italic, inline code,
   fenced code, links, lists, blockquotes and rules. Escapes FIRST, then formats — the write-up is
   upstream data and nothing in it may execute. No dependency: the whole renderer is smaller than
   any library's loader and this page ships without a bundler. */
function renderMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let list = null;
  const inline = (text) => esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (/^```/.test(line)) {
      closeList();
      out.push(inCode ? '</code></pre>' : '<pre class="md-code"><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(esc(raw) + '\n'); continue; }
    if (!line.trim()) { closeList(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      closeList();
      out.push(`<h${Math.min(m[1].length + 2, 6)}>${inline(m[2])}</h${Math.min(m[1].length + 2, 6)}>`);
      continue;
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if (/^>\s?/.test(line)) { closeList(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (/^(---|\*\*\*)\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
```

In `openResult()`'s concept branch, replace
`<div class="detail__text">${esc(body.slice(0, 14000))}</div>`
with
`<div class="detail__text">${renderMarkdown(body.slice(0, 14000))}</div>`

**`styles.css`, after the `.detail__text`-adjacent rules (add all of these):**

```css
.detail__text { font-size: var(--lx-fs-md); line-height: 1.6; }
.detail__text h3, .detail__text h4 { margin: var(--lx-space-4) 0 var(--lx-space-1); font-size: var(--lx-fs-lg); font-weight: var(--lx-fw-semibold); letter-spacing: var(--lx-ls-tight); }
.detail__text h5, .detail__text h6 { margin: var(--lx-space-3) 0 var(--lx-space-1); font-size: var(--lx-fs-md); font-weight: var(--lx-fw-semibold); }
.detail__text p { margin: 0 0 var(--lx-space-2); }
.detail__text ul, .detail__text ol { margin: 0 0 var(--lx-space-2); padding-left: 18px; }
.detail__text li { margin: 3px 0; }
.detail__text code { padding: 1px 5px; border-radius: var(--lx-radius-sm); background: var(--lx-surface-3); font: var(--lx-fs-xs)/1.4 var(--lx-font-mono); }
.detail__text a { color: var(--lx-accent-ink); text-decoration: none; }
.detail__text a:hover { text-decoration: underline; }
.detail__text blockquote { margin: 0 0 var(--lx-space-2); padding-left: var(--lx-space-25); border-left: 2px solid var(--lx-accent-soft); color: var(--lx-fg-muted); }
.detail__text hr { border: 0; border-top: 1px solid var(--lx-border-soft); margin: var(--lx-space-4) 0; }
.detail__text .md-code { margin: 0 0 var(--lx-space-2); }
```

**Verify:** focused test → `OK`; then a live read of one concept (T6.2) shows headings and lists.

**Commit:** `git add -A && git commit -m "feat(detail): render the concept write-up as markdown"`

---

#### T4.3 — Code block chrome, one copy button

**Files:** `console/frontend/app.js`, `console/frontend/styles.css`; append to `test_ui_polish.py`.

**Test first:**

```python
class TheCodeBlockIsDressed(unittest.TestCase):
    def test_code_bar_with_label_and_copy(self):
        app = read(APP)
        self.assertIn('class="code__bar"', app)
        self.assertIn('class="code__label"', app)
        css = read(CSS)
        self.assertIn(".code__bar", css)
        self.assertIn(".code__label", css)

    def test_one_copy_button_only(self):
        app = read(APP)
        self.assertEqual(app.count('id="copy"'), 1, "copy lives on the code bar — not twice")
```

Run → expect `FAILED`.

**Implement — `app.js`, indicator branch:** replace the trailing `<pre>…</pre>` with

```js
        <div class="code">
          <div class="code__bar">
            <span class="code__label">Pine</span>
            <span class="code__meta muted">${source.length.toLocaleString()} chars${source.length > 12000 ? ' · preview truncated' : ''}</span>
            <button type="button" class="btn btn--ghost code__copy" id="copy">⧉ Copy</button>
          </div>
          <pre>${esc(source.slice(0, 12000))}${source.length > 12000 ? '\n… truncated in preview …' : ''}</pre>
        </div>`
```

Remove the old `#copy` button from the actions row (it moved here) — keep exactly one `id="copy"`.
Update its handler to confirm in place:

```js
      $('#copy').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(source);
          setActionState(button, 'idle', '✓ Copied');
          setTimeout(() => setActionState(button, 'idle', '⧉ Copy'), 1400);
          toast('Pine source copied');
        } catch { toast('Clipboard blocked by the browser', true); }
      });
```

**`styles.css`, after the `pre` rule:**

```css
.code { display: flex; flex-direction: column; min-height: 0; }
.code__bar {
  display: flex; align-items: center; gap: var(--lx-space-2);
  padding: var(--lx-space-1) var(--lx-space-2) var(--lx-space-1) var(--lx-space-3);
  border: 1px solid var(--lx-border-soft); border-bottom: 0;
  border-radius: var(--lx-radius-md) var(--lx-radius-md) 0 0;
  background: var(--lx-surface-3);
}
.code__label { font-size: var(--lx-fs-2xs); text-transform: uppercase; letter-spacing: var(--lx-ls-wide); color: var(--lx-fg-muted); }
.code__meta { font-size: var(--lx-fs-2xs); margin-left: auto; }
.code__copy { height: 24px; padding: 0 var(--lx-space-2); font-size: var(--lx-fs-xs); }
.code pre { border-radius: 0 0 var(--lx-radius-md) var(--lx-radius-md); }
```

**Verify:** focused test → `OK`; `node --check console/frontend/app.js` → exit 0.

**Commit:** `git add -A && git commit -m "style(detail): dress the Pine code block"`

---

### Phase 5 — the feedback layer *(optional — global, not part of the Library section)*

#### T5.1 — The toast floats

**Files:** `console/frontend/styles.css`; append to `test_ui_polish.py`.

**Test first:**

```python
class TheToastFloats(unittest.TestCase):
    def test_the_toast_is_a_floating_pill(self):
        css = read(CSS)
        bar = rule(css, ".statusbar.is-live")
        self.assertIn("position: fixed", bar, "the slip floats; it must not take a layout row")
        toast = rule(css, ".toast")
        self.assertIn("--lx-surface-glass", toast)
        self.assertIn("@keyframes toast-in", css)
```

Run → expect `FAILED`.

**Implement — `styles.css`:** replace the existing `.statusbar { … }`, `.statusbar a`, `.toast`,
`.toast--bad` rules with:

```css
/* The footer is a message slip, not a strip (16 Sep) — and since the polish pass it FLOATS: a pill
   above the bottom edge, read where the eye already is, instead of a 20px strip that steals layout
   height from the chart. The element stays #toast inside .statusbar, so every existing toast()
   call keeps working. */
.statusbar { display: none; }
.statusbar.is-live {
  display: flex; align-items: center; justify-content: center;
  position: fixed; inset-inline: 0; bottom: 14px; z-index: var(--lx-z-toast);
  padding: 0; border: 0; background: transparent; pointer-events: none;
}
.statusbar a { color: var(--lx-accent-ink); text-decoration: none; }
.statusbar a:hover { text-decoration: underline; }
.toast {
  pointer-events: auto; max-width: min(560px, 90vw);
  padding: 7px 14px;
  font-size: var(--lx-fs-sm); color: var(--lx-fg);
  background: var(--lx-surface-glass);
  -webkit-backdrop-filter: blur(var(--lx-blur-pop));
  backdrop-filter: blur(var(--lx-blur-pop));
  border: 1px solid var(--lx-border-strong); border-radius: var(--lx-radius-pill);
  box-shadow: var(--lx-shadow-pop);
  animation: toast-in var(--lx-dur-pop) var(--lx-ease-spring);
}
.toast--bad { color: var(--lx-loss); border-color: rgba(208, 59, 59, .55); }
@keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
```

Then **delete** the now-duplicate pair later in the file:

```css
.statusbar { display: none; }
.statusbar.is-live { display: flex; }
```

(they sit under the `.chart-foot` rules; keep the `.chart-foot` lines).

**Verify:** focused test → `OK`; full suite → `OK`; screenshot in T6.2 shows the pill over the chart.

**Commit:** `git add -A && git commit -m "style(console): the toast floats instead of taking a row"`

---

#### T5.2 — Buttons answer back (press, sheen, spinner)

**Files:** `console/frontend/styles.css`; append to `test_ui_polish.py`.

**Test first:**

```python
class ButtonsAnswerBack(unittest.TestCase):
    def test_press_state_and_spinner(self):
        css = read(CSS)
        self.assertIn(".btn:active", css)
        self.assertIn(".btn.is-busy", css)
        self.assertIn("@keyframes spin", css)
```

Run → expect `FAILED`.

**Implement — `styles.css`, after the `.btn--ghost` rule:**

```css
.btn:active { transform: translateY(1px); }
.btn--primary { background-image: linear-gradient(180deg, rgba(255, 255, 255, .10), rgba(255, 255, 255, 0)); }
.btn.is-busy { pointer-events: none; opacity: .85; }
.btn.is-busy::before {
  content: ''; width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid currentColor; border-top-color: transparent;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

**Verify:** focused test → `OK`; full suite → `OK`. Reduced-motion users see the disabled state
without the spin — acceptable, do not special-case it.

**Commit:** `git add -A && git commit -m "style(console): buttons answer back"`

---

### Phase 6 — docs + verification

#### T6.1 — Docs: CHANGELOG, README row, stale comments

**Files:** `CHANGELOG.md`, `README.md`; append to `test_ui_polish.py`.

**Test first:**

```python
class TheDocsMatchThePolish(unittest.TestCase):
    def test_readme_does_not_bake_the_count(self):
        readme = read(os.path.join(ROOT, "README.md"))
        self.assertNotIn("805-indicator", readme)

    def test_changelog_records_the_pass(self):
        changelog = read(os.path.join(ROOT, "CHANGELOG.md")).lower()
        self.assertIn("polish", changelog)
```

Run → expect `FAILED`.

**Implement:**

- `README.md` line ~160: change the `chart_browse` row's wording from
  "open the 805-indicator LuxAlgo catalogue as a list in the pane (optional `family`)" to
  "open the LuxAlgo catalogue as a list in the pane (optional `family`; family bubbles disclose
  Library concepts)". Do not change the tool name or the table shape — `test_docs_drift.py` reads it.
- `CHANGELOG.md`, under `## [Unreleased]` → `### Changed`, add one entry:

```markdown
- **The console's non-chart surfaces got the polish pass.** Library panel, family disclosure
  popover, detail pane and the toast/button/skeleton layer now follow one visual spec: glass
  popover with an entry animation, cluster-grouped concept rows with keyboard navigation
  (↑↓/Home/End/Enter/Esc), two-line catalogue rows, a sticky detail head with busy-state buttons,
  a markdown-rendered concept write-up, a dressed Pine code block and a floating toast. Counts that
  were baked into the chrome ("805") now come from the API. No build step, no new dependency; every
  animation is transform/opacity only and stays behind the existing reduced-motion guard.
```

**Verify:** focused test → `OK`; full suite → `OK`.

**Commit:** `git add -A && git commit -m "docs: record the UI polish pass"`

---

#### T6.2 — The verification sweep (no commit)

Run every step; paste the outputs into the handover. Do not claim a step you did not run.

```bash
cd /home/godzillaton/Projects/tradersagent-plugin
python3 -m unittest discover -s console/backend/tests -t console/backend/tests -q      # OK (skipped=38)
node --check console/frontend/app.js && node --check console/frontend/chart-bridge.js  # exit 0
python3 -m compileall -q console/backend console/mcp                                    # exit 0
bash -n install.sh && git diff --check                                                  # exit 0
./tools/sync-live.sh                                                                    # "synced repo → …"
cd /home/godzillaton/Projects/luxalgo-web
./bin/trader-chart reload --json                                                        # ok: true
```

Then, **inside Hermes** (pane open — never an external browser):

```bash
grim /home/godzillaton/.hermes/cache/scratch/polish-01-library.png     # 1920x1080 PNG
./bin/trader-chart --json browse --family wyckoff --show               # rows: 17, kind: concepts, open: true
./bin/trader-chart state                                               # ETHUSDT · 1h · indicators: none
```

Look at the screenshot with `vision_analyze` and confirm, one by one:

- [ ] the search field shows its magnifier; the suggestion chips and filter row are legible
- [ ] the family chip row is one scrolling row with a fade at both edges; the open chip shows its caret turned
- [ ] the popover is glassy with a border and shadow, its head has the count and a ✕, rows are grouped under small-caps cluster headers
- [ ] `↑ ↓` move, `Enter` opens a concept, `Esc` closes and focus returns to the chip
- [ ] a catalogue row shows name + badge on line 1, description (≤2 lines) on line 2, meta on line 3
- [ ] the detail pane's head stays pinned while the code scrolls; Run PineTS shows a spinner while running
- [ ] a concept write-up renders headings/lists/links instead of raw markdown
- [ ] the toast appears as a floating pill above the bottom edge
- [ ] the chart is still `ETHUSDT · 1h` with **no indicator added** and the pane was never navigated away

Also capture one light-theme shot (click the `◐` toggle in the pane's topbar with `ydotool` if
available, or ask the operator) — if you cannot, say so; do not claim light mode verified.

**Operator handover line:** the source of truth is the repo, the live tree is synced, the suite is
green, the pane is reloaded, and the screenshots above are the evidence.

---

## 7. Risks, tradeoffs, open questions

| Risk / tradeoff | Mitigation |
|---|---|
| **No React/Tailwind/Motion** — the referenced libraries cannot be installed verbatim; this is a ported look, not their components. | Stated up front. If the operator later wants the real libraries, that is a separate build-step project (Vite + Tailwind + shadcn CLI), not a patch to this plan. |
| **`backdrop-filter` cost** on the 2016 Pavilion | Only on two small surfaces (popover, toast), ≤12px blur, no blur on the chart or panels. If it stutters, drop `backdrop-filter` and keep the solid `--lx-surface-glass` fallback — the colour still reads. |
| **Source-shape tests can be gamed** — they pin text, not pixels | Visual verification is the Hermes screenshot sweep (T6.2); keep it in the handover. |
| **Panel open/close stays instant** (grid column swap) | Deliberate: animating the grid would thrash Vela's resize observer on a weak CPU. Do not add it. |
| **`.row` layout change touches search results too** | Intended — all three renderers use the same anatomy. If a row ever needs the old horizontal layout, give it its own class instead of reverting `.row`. |
| **Popover closes instantly (no exit animation)** | `display:none` cannot transition; a JS-driven exit adds a timer and a race with the bridge's settle loop. Entry-only is the deliberate trade. |
| **Cluster grouping across pages** | Rows are sorted per page and a header repeats only if a cluster continues past page 1. Acceptable; do not build cross-page re-sorting. |
| **Open questions for the operator** | (1) Should the popover anchor under the clicked chip instead of the full panel width? (2) Light theme parity is implemented but only screenshot-verified if the toggle is reachable — confirm you want it checked. (3) Push the commits to `origin/main`? |

---

## 8. Appendix — file map

| Path | What lives there |
|---|---|
| `console/frontend/index.html` | The whole page markup: topbar toggles, library panel, browse block, detail pane, statusbar. |
| `console/frontend/styles.css` | Every rule in the app: tokens (dark + light), Vela token mapping (`.chart` — do not touch), base sheet, components. |
| `console/frontend/app.js` | All behaviour: panels, browse + concept lists, search, `openResult` detail rendering, toast/log, wiring in `main()`. |
| `console/frontend/chart-bridge.js` | The command surface the agent drives (`browse`, `reload`, `shot`, …). Reads DOM ids/counts — **contract, do not rename**. |
| `console/backend/tests/test_ui_polish.py` | **New.** The pins for this pass. |
| `console/backend/tests/test_catalogue_browse.py`, `test_pane_audit.py` | Existing pins that grep the same files — read before renaming. |
| `tools/sync-live.sh` | Repo → live tree copy. |
| `.hermes/plans/` | This plan (and future ones). |
