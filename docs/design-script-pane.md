# Script pane — visual direction & tokens

Source material for the pane's visual layer and the upcoming Settings panel. Pulled with the **inspo MCP**
(832 real sites, their DESIGN.md systems) + the **ObsidianUI registry**, then adapted to this console's
hard constraints: **vanilla DOM/CSS, no build step, `--lx-*` tokens, light + dark, light motion only.**

Adapt, don't copy — keep our token names; take the *ratio* and the restraint.

## The brief

A Pine-script editor docked beside a trading chart: one action bar (name · ▶ Run · ✕), an editor with a
gutter, one status line, a compact run list. Operator's constraints (decided, do not re-litigate):

- Simple, not complicated. No announcement/explainer text. Chart-first — nothing that pushes the chart.
- The pane is a **tool**, not a page.

## Direction — evidence from the corpus

- **Genre gravity** (24 technical sites, inspo `recommend` packet): near-monochrome surfaces (mid 54% /
  dark 46%), display class grotesk-sans 83%, Inter among the most common faces. → We are already
  on-language: Inter + one accent + hairlines. Do not add another voice.
- **Closest real exemplar: `e2b-dev--docs`** (full DESIGN.md via `get_design_system`) — "stark, technical,
  utilitarian, code-first". What we take:
  - **Mono as identity.** Their meta/display voice is IBM Plex Mono. Ours: `ui-monospace` for **all meta** —
    status numbers, run-list times/counts, gutter, kbd hints. Inter stays for names and labels.
  - **4-tier text ramp** (light `#000/#333/#666/#999`, dark `#fff/#fff9/#777/#666`) → map to our tokens:
    name = primary, labels = secondary, meta = tertiary, gutter/hints = quaternary.
  - **Hairlines, not boxes.** Stroke `#d6d6d6` light / `#292929` dark between rows and sections. Small
    radius on code surfaces; pills only for controls (Run, toggles).
  - **4px base spacing** — use only 4/8/12/16/20/24 in the pane.
- Other anchors (reference only): `sourcegraph-com` (dark, intensely technical), `tabnine-com`
  (Inter + Roboto Mono), `codepen-io` (SFMono), `builder-io` (Geist), `github-blog` (Mona Sans).

## Component references (ObsidianUI registry — pattern only, not code)

The console has no build step, so ObsidianUI's React/Tailwind components are **design references**, adapted
by hand into our CSS. Relevant items from `obsidianui.dev/r/registry.json` (73 items):

| Console surface | ObsidianUI items to study |
|---|---|
| Settings panel (next) | `field` · `label` · `input` · `select` · `switch` · `slider` · `radio-group` · `separator` |
| Run list rows | `item` (quiet row: leading mark, name, trailing mono meta) · `collapsible` (the folded Engine detail) |
| Action bar | `button` (inverted primary — shipped) · `tooltip` (✕ "Close (Esc)" — shipped) · `kbd` (Ctrl+Enter hint) |
| Editor | `scroll-area` (thin, quiet scrollbar) · `separator` (gutter edge, optional) |

## Concrete spec for this pane

1. **Status line** — one line, word first (`Ran` / `Failed` / `Running "…"…`). Numbers in mono; text color
   tertiary; the dot is the only colored element; a `⚠ n` count is amber *text*, never a badge.
2. **Run list rows** — 8px vertical padding, `border-top` hairline, no cards. Row = `[✓/✗] name · mono meta
   (time · series/boxes · ms)`. Meta = 12px mono, tertiary. ⚠ notes on their own line, amber, never red.
   (Newest first, ≤20, textContent-only — all shipped; this is the styling layer on top.)
3. **Editor** — gutter quaternary; current line = a 1px left marker + 4% row tint (not a full highlight
   bar); padding 8px; small radius. Keep `wrap="off"` + sideways scroll (shipped — the gutter cannot drift).
4. **Action bar** — name input borderless, hairline only on focus; Run = inverted primary (shipped); ✕ ghost.
5. **Settings panel** — two-column rows (label left, control right), mono section headers in quaternary
   caps, 8/12px rhythm, hairline separators, values in mono. No Save button: apply on change + a one-line
   "Saved" note in the status line.
6. **Motion** — 120–160ms, ease-out, `transform`/`opacity` only. The fold = 140ms height/opacity. No hover
   scale, no extra shadows.
7. **Type** — Inter for names/labels (12.5px), mono 12.5px for code + meta, 11.5px meta floor. **No new
   fonts** (offline rule; no downloads). *Operator override (6 Oct): the script editor + gutter run at
   **6.25px** (half) — meta stays 12.5px.*

## Do-not (operator's taste — decided)

- No announcement/explainer paragraphs (removed 5 Oct — do not reintroduce).
- No extra chips/badges/pills beyond Run and toggles.
- No permanent panes; nothing that pushes the chart.
- No new colors beyond: one accent + warn (amber) + fail (red) states.
- No animation heavier than transform/opacity; nothing longer than 160ms.

## References

- inspo `recommend` packet for this brief; `get_design_system("e2b-dev--docs")` — full DESIGN.md, both
  light and dark token sets.
- ObsidianUI: `https://www.obsidianui.dev/r/registry.json` — 73 items, pattern reference only.
- This document is a direction, not a checklist: implement what fits, flag what conflicts.
