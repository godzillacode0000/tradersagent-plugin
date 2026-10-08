import { parseSymbol, priceStyleIds, BUILTIN_PRICE_STYLES, SecondClock, isGroupRow, defaultMemberOf, groupKeyOf, groupMembers, LEGEND_AT_TOP_ATTR, normalizeSession, Vela, TypedEventBus, timeframeToMs, MultiProviderFeed, registerBuiltinChartTypes, resolveTheme, buildToolbar, createCustomMark, createAttributionMark, DrawingToolbar, applyAttributionMarkTheme, sharedBarStore, CANDLE_OVERRIDE_KEYS } from './chunk-HMHA733L.js';
import { chartType, resolveTopbarComposition, topbarActionOverride, TOPBAR_BUILTIN_IDS, widgetActions, tzButtonLabel, resolveTimezone, timezoneMenuRows, SidePanel, sidePanels, DEFAULT_PANEL_ORDER, symbolRanking, paneScaleAt, composeMenu, priceAxisItems, scaleChoiceOf, timeAxisItems, bodyItems, scaleWrites, invertWrite, settingsSectionOf, resolveEngines, legendActionsProviderFor, legendCalloutsProviderFor, normalizeTimezone, isExchangeTimezone, statePersistenceHandlers, topbarHas, rendererDefaults, mobilePlacement, widgetAttachments, getDrawingType, inputDeltas } from './chunk-KWI3YDBW.js';
import { Tooltip, KeymapManager, isEditableTarget, Drawer } from './chunk-TO3GIK7Z.js';
import { Menu, Dialog, CalloutBubble, applyPlotOverlayTokens, ensureUIHost } from './chunk-G7B7ZCBF.js';
import { registerIcon, svg16, injectStyles, iconEl, iconMarkup, iconAt, SESSION_OFF, SESSION_POST, SESSION_PRE, announceSurface, holdForExit, icon, categoricalColor } from './chunk-VHGACEHO.js';
import { baseOf } from './chunk-W4EJWLEO.js';

// src/widget/timeframe.ts
var UNIT_MS = {
  S: 1e3,
  MIN: 6e4,
  H: 36e5,
  D: 864e5,
  W: 6048e5,
  M: 2592e6,
  Y: 31536e6
};
var UNIT_NAME = {
  S: "second",
  MIN: "minute",
  H: "hour",
  D: "day",
  W: "week",
  M: "month",
  Y: "year"
};
var UNIT_SHORT = { S: "s", MIN: "m", H: "h", D: "D", W: "W", M: "M", Y: "Y" };
function unitKey(letter) {
  if (letter === "") return "MIN";
  return letter === "S" || letter === "H" || letter === "D" || letter === "W" || letter === "M" || letter === "Y" ? letter : null;
}
var UNIT_MINUTES = {
  MIN: 1,
  H: 60,
  D: 1440,
  W: 10080,
  M: 43200,
  Y: 525600
};
function canonicalFor(key, count) {
  if (key === "S") return `${count}S`;
  return `${count * UNIT_MINUTES[key]}`;
}
function parseTimeframe(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { valid: false };
  const m = /^(\d*)\s*([a-zA-Z]?)$/.exec(raw);
  if (!m) return { valid: false };
  const numStr = m[1] ?? "";
  const key = unitKey((m[2] ?? "").toUpperCase());
  if (key === null) return { valid: false };
  if (numStr === "" && key === "MIN") return { valid: false };
  const count = numStr === "" ? 1 : parseInt(numStr, 10);
  if (!Number.isFinite(count) || count < 1) return { valid: false };
  const ms = count * UNIT_MS[key];
  const name = UNIT_NAME[key];
  return {
    valid: true,
    count,
    unit: key,
    ms,
    canonical: canonicalFor(key, count),
    label: `${count} ${name}${count === 1 ? "" : "s"}`,
    short: `${count}${UNIT_SHORT[key]}`
  };
}
function timeframeMs(value) {
  const v = String(value ?? "").trim();
  if (!v) return NaN;
  const m = /^(\d*)\s*([a-zA-Z]?)$/.exec(v);
  if (!m) return NaN;
  const key = unitKey((m[2] ?? "").toUpperCase());
  if (key === null) return NaN;
  if ((m[1] ?? "") === "" && key === "MIN") return NaN;
  const count = (m[1] ?? "") === "" ? 1 : parseInt(m[1], 10);
  if (!Number.isFinite(count) || count < 1) return NaN;
  return count * UNIT_MS[key];
}
function favoriteTimeframeChips(favorites) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const tf of favorites) {
    if (seen.has(tf)) continue;
    seen.add(tf);
    out.push(tf);
  }
  return out.sort((a, b) => {
    const ma = timeframeMs(a);
    const mb = timeframeMs(b);
    const aOk = Number.isFinite(ma);
    const bOk = Number.isFinite(mb);
    if (aOk && bOk && ma !== mb) return ma - mb;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return 0;
  });
}
function timeframeLabel(value) {
  const parsed = parseTimeframe(value);
  if (!parsed.valid) return value;
  const ms = parsed.ms;
  const order = ["Y", "M", "W", "D", "H", "MIN", "S"];
  for (const key of order) {
    if (ms % UNIT_MS[key] === 0 && ms / UNIT_MS[key] >= 1) {
      return `${ms / UNIT_MS[key]}${UNIT_SHORT[key]}`;
    }
  }
  return parsed.short;
}

// src/widget/layout-picker.ts
var STYLE_ID = "vela-widget-layout-picker-v15";
var CSS = `
.vela-lp-layer { position: absolute; z-index: var(--vela-z-menu); }
.vela-lp {
    background: var(--vela-surface);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-radius: 8px;
    box-shadow: var(--vela-shadow);
    padding: 10px 12px 10px;
    font-size: 13px;
    user-select: none;
    transform-origin: top;
    animation: vela-lp-in var(--vela-dur-fast) var(--vela-ease);
}
@keyframes vela-lp-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
.vela-lp-cols { display: flex; align-items: stretch; gap: 14px; }
.vela-lp-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--vela-fg-faint);
    margin-bottom: 10px;
}
/* "?" help badge: hover it for the canvas explainer. */
.vela-lp-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--vela-border-strong);
    color: var(--vela-fg-muted);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0;
    cursor: default;
    transition: color var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-badge:hover { color: var(--vela-fg-bright); border-color: var(--vela-fg-muted); }
.vela-lp-tip { display: flex; flex-direction: column; gap: 4px; max-width: 230px; white-space: normal; }
.vela-lp-vsep { width: 1px; flex: none; align-self: stretch; background: var(--vela-border-faint); }
.vela-lp-layout { width: 132px; display: flex; flex-direction: column; align-items: center; }
.vela-lp-layout > .vela-lp-heading,
.vela-lp-layout > .vela-lp-presets { align-self: stretch; }
.vela-lp-grid { display: grid; grid-template-columns: repeat(4, 24px); grid-auto-rows: 24px; gap: 4px; }
.vela-lp-sq {
    all: unset;
    box-sizing: border-box;
    border-radius: 4px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-faint);
    cursor: pointer;
    transition: background var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-sq:hover { background: var(--vela-hover-strong); border-color: var(--vela-border-strong); }
/* Selected/previewed squares \u2014 the shared monochrome selection chip. */
.vela-lp-sq[data-on='1'] {
    background: var(--vela-selected-bg);
    border-color: var(--vela-selected-bg);
}
.vela-lp-presets { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
.vela-lp-preset { all: unset; padding: 5px 8px; border-radius: 4px; cursor: pointer; color: var(--vela-fg-muted); font-size: 12px; white-space: nowrap; transition: transform 120ms var(--vela-ease); }
.vela-lp-preset:hover { background: var(--vela-hover); }
.vela-lp-preset:active { transform: scale(0.98); }
.vela-lp-preset[data-checked='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-lp-sync { display: flex; flex-direction: column; gap: 4px; min-width: 118px; }
.vela-lp-sync-row { all: unset; display: flex; align-items: center; gap: 14px; padding: 6px 8px; border-radius: 5px; cursor: pointer; }
.vela-lp-sync-row:hover { background: var(--vela-hover); }
.vela-lp-sync-row .vela-lp-label { flex: 1 1 auto; }
/* Toggle pill \u2014 same control language as the menu's switch rows, monochrome ON state. */
.vela-lp-switch {
    position: relative;
    flex: none;
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-soft);
    transition: background 0.16s ease, border-color 0.16s ease;
}
.vela-lp-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--vela-fg-muted);
    transition: transform 0.16s ease, background 0.16s ease;
}
.vela-lp-switch.on { background: var(--vela-selected-bg); border-color: var(--vela-selected-bg); }
.vela-lp-switch.on::after { transform: translateX(16px); background: var(--vela-selected-fg); }
`;
var GRID = 4;
function layoutGridCanvas(doc) {
  injectStyles(STYLE_ID, CSS, doc);
  const el = doc.createElement("div");
  el.className = "vela-lp-grid";
  const squares = [];
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      const sq = doc.createElement("button");
      sq.className = "vela-lp-sq";
      sq.dataset.r = String(r);
      sq.dataset.c = String(c);
      sq.setAttribute("aria-label", `${c + 1} \xD7 ${r + 1}`);
      squares.push(sq);
      el.appendChild(sq);
    }
  }
  return { el, squares };
}
function paintLayoutGrid(squares, shape) {
  for (const sq of squares) {
    const on = shape !== null && Number(sq.dataset.r) < shape.rows && Number(sq.dataset.c) < shape.cols;
    if (on) sq.dataset.on = "1";
    else delete sq.dataset.on;
  }
}
var LayoutPicker = class {
  constructor(opts) {
    this.squares = [];
    this.isOpen = false;
    /** The card's exit animation after a close; a reopen cancels it. */
    this.exit = null;
    /** Hover preview (1-based rows/cols), null = show current shape. */
    this.hover = null;
    this.onDocPointerDown = (e) => {
      const t = e.target;
      if (t && (this.layer.contains(t) || this.opts.trigger.contains(t))) return;
      this.close();
    };
    this.onDocKeydown = (e) => {
      if (e.key === "Escape") this.close();
    };
    this.opts = opts;
    this.doc = opts.host.ownerDocument;
    injectStyles(STYLE_ID, CSS, this.doc);
    const doc = this.doc;
    this.layer = doc.createElement("div");
    this.layer.className = "vela-ui-layer vela-lp-layer";
    this.layer.style.display = "none";
    const panel = doc.createElement("div");
    panel.className = "vela-lp";
    this.layer.appendChild(panel);
    this.panel = panel;
    const cols = doc.createElement("div");
    cols.className = "vela-lp-cols";
    panel.appendChild(cols);
    const layoutCol = doc.createElement("div");
    layoutCol.className = "vela-lp-layout";
    const layoutHeading = doc.createElement("div");
    layoutHeading.className = "vela-lp-heading";
    const headingText = doc.createElement("span");
    headingText.textContent = "Layout";
    const badge = doc.createElement("span");
    badge.className = "vela-lp-badge";
    badge.textContent = "?";
    layoutHeading.append(headingText, badge);
    layoutCol.appendChild(layoutHeading);
    this.infoTip = new Tooltip(badge, {
      host: opts.host,
      placement: "bottom",
      content: () => this.tipNode()
    });
    const { el: grid, squares } = layoutGridCanvas(doc);
    this.squares.push(...squares);
    layoutCol.appendChild(grid);
    this.presetsEl = doc.createElement("div");
    this.presetsEl.className = "vela-lp-presets";
    layoutCol.appendChild(this.presetsEl);
    cols.appendChild(layoutCol);
    const vsep = doc.createElement("div");
    vsep.className = "vela-lp-vsep";
    cols.appendChild(vsep);
    const syncCol = doc.createElement("div");
    const syncHeading = doc.createElement("div");
    syncHeading.className = "vela-lp-heading";
    syncHeading.textContent = "Sync";
    syncCol.appendChild(syncHeading);
    this.syncEl = doc.createElement("div");
    this.syncEl.className = "vela-lp-sync";
    syncCol.appendChild(this.syncEl);
    cols.appendChild(syncCol);
    grid.addEventListener("pointerdown", (e) => {
      const sq = this.squareAt(e);
      if (!sq) return;
      e.preventDefault();
      const { r, c } = this.squarePos(sq);
      this.close();
      this.opts.onSelectGrid(r + 1, c + 1);
    });
    grid.addEventListener("pointermove", (e) => {
      const sq = this.squareAt(e);
      if (!sq) return;
      const { r, c } = this.squarePos(sq);
      if (this.hover?.rows !== r + 1 || this.hover?.cols !== c + 1) {
        this.hover = { rows: r + 1, cols: c + 1 };
        this.render();
      }
    });
    grid.addEventListener("pointerleave", () => {
      if (this.hover) {
        this.hover = null;
        this.render();
      }
    });
    opts.trigger.addEventListener("click", () => this.toggle());
    opts.trigger.setAttribute("aria-haspopup", "true");
    opts.trigger.setAttribute("aria-expanded", "false");
    opts.host.appendChild(this.layer);
  }
  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.exit?.cancel();
    this.exit = null;
    this.hover = null;
    this.refresh();
    this.layer.style.display = "";
    this.position();
    this.opts.trigger.setAttribute("aria-expanded", "true");
    this.doc.addEventListener("pointerdown", this.onDocPointerDown, true);
    this.doc.addEventListener("keydown", this.onDocKeydown, true);
    this.opts.onOpenChange?.(true);
    if (this.isOpen) announceSurface(this.panel, true, "popover", this.opts.trigger);
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    announceSurface(this.panel, false, "popover", this.opts.trigger);
    this.exit = holdForExit(this.panel, () => {
      this.exit = null;
      if (!this.isOpen) this.layer.style.display = "none";
    });
    this.opts.trigger.setAttribute("aria-expanded", "false");
    this.doc.removeEventListener("pointerdown", this.onDocPointerDown, true);
    this.doc.removeEventListener("keydown", this.onDocKeydown, true);
    this.opts.onOpenChange?.(false);
  }
  /** Re-read shape/presets/syncs and re-render (no-op while closed — `open` re-reads). */
  refresh() {
    if (!this.isOpen) return;
    this.renderPresets();
    this.renderSyncs();
    this.render();
  }
  destroy() {
    this.close();
    this.exit?.finish();
    this.infoTip.destroy();
    this.layer.remove();
  }
  // ── internals ──
  squareAt(e) {
    const sq = e.target?.closest?.(".vela-lp-sq");
    return sq instanceof HTMLButtonElement ? sq : null;
  }
  squarePos(sq) {
    return { r: Number(sq.dataset.r), c: Number(sq.dataset.c) };
  }
  /** Help copy for the LAYOUT "?" badge. */
  tipNode() {
    const tip = this.doc.createElement("div");
    tip.className = "vela-lp-tip";
    tip.textContent = "Click a square to apply that columns \xD7 rows layout.";
    return tip;
  }
  /** Project the interaction state onto the DOM (the hover/current rectangle). */
  render() {
    paintLayoutGrid(this.squares, this.hover ?? this.opts.shape());
  }
  renderPresets() {
    const doc = this.doc;
    this.presetsEl.replaceChildren();
    const presets = this.opts.presets();
    this.presetsEl.style.display = presets.length > 0 ? "" : "none";
    for (const p of presets) {
      const b = doc.createElement("button");
      b.className = "vela-lp-preset";
      b.textContent = p.label;
      if (p.checked) b.dataset.checked = "1";
      b.addEventListener("click", () => {
        this.close();
        this.opts.onSelectPreset(p.id);
      });
      this.presetsEl.appendChild(b);
    }
  }
  renderSyncs() {
    const doc = this.doc;
    this.syncEl.replaceChildren();
    for (const s of this.opts.syncs()) {
      const row = doc.createElement("button");
      row.className = "vela-lp-sync-row";
      const label = doc.createElement("span");
      label.className = "vela-lp-label";
      label.textContent = s.label;
      const pill = doc.createElement("span");
      pill.className = "vela-lp-switch" + (s.checked ? " on" : "");
      pill.setAttribute("aria-hidden", "true");
      row.setAttribute("role", "switch");
      row.setAttribute("aria-checked", String(s.checked));
      row.append(label, pill);
      row.addEventListener("click", () => {
        this.opts.onToggleSync(s.id);
        this.renderSyncs();
      });
      this.syncEl.appendChild(row);
    }
  }
  /** Anchor under the trigger, clamped to the host's right edge. */
  position() {
    const hostRect = this.opts.host.getBoundingClientRect();
    const trigRect = this.opts.trigger.getBoundingClientRect();
    let left = trigRect.left - hostRect.left;
    const top = trigRect.bottom - hostRect.top + 8;
    const width = this.layer.offsetWidth;
    if (left + width > hostRect.width - 8) left = Math.max(8, hostRect.width - 8 - width);
    this.layer.style.left = `${left}px`;
    this.layer.style.top = `${top}px`;
  }
};

// src/widget/topbar.ts
var STYLE_ID2 = "vela-topbar";
var CSS2 = `
.vela-widget-topbar {
    display: flex;
    align-items: center;
    gap: var(--vela-space-1);
    padding: var(--vela-space-1) var(--vela-space-2);
    border-bottom: 1px solid var(--vela-border-soft);
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md);
    flex: none;
}
.vela-widget-symbol, .vela-widget-tf, .vela-widget-style, .vela-widget-indicators, .vela-widget-action-left {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 9px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 13px;
    font-weight: 550;
    white-space: nowrap;
}
.vela-widget-symbol {
    color: var(--vela-fg-bright);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.3px;
    padding: 0 10px;
    gap: 7px;
}
.vela-widget-tf, .vela-widget-style, .vela-widget-indicators, .vela-widget-action-left {
    color: var(--vela-fg-bright);
}
.vela-widget-symbol:hover, .vela-widget-tf:hover, .vela-widget-style:hover, .vela-widget-indicators:hover, .vela-widget-action-left:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
/* Timeframe cluster: duration-sorted favorite chips, highlight in place, caret
   opening the full dropdown. With no favorites the caret is the merged trigger
   (label + chevron). An unstarred current value sits as an extra chip by the caret. */
.vela-widget-tf-group { display: inline-flex; align-items: center; gap: 2px; }
.vela-widget-tf-chips { display: inline-flex; align-items: center; gap: 2px; }
.vela-widget-tf-chips:empty { display: none; }
.vela-widget-tf[data-current='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-widget-tf-caret {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 30px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
}
.vela-widget-tf-caret:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
/* The merged trigger is a plain button (hover feedback only) \u2014 the highlight
   background marks the CURRENT chip among favorites, and a lone trigger with a
   permanent highlight would read as stuck-pressed. */
.vela-widget-tf-caret[data-solo='1'] {
    width: auto;
    padding: 0 6px 0 9px;
    gap: 4px;
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-weight: 550;
    white-space: nowrap;
}
.vela-widget-topbar .vela-widget-tf-caret .vela-icon { font-size: 14px; width: 14px; height: 14px; }
.vela-widget-topbar .vela-icon { color: inherit; font-size: 16px; width: 16px; height: 16px; }
/* Width is set in syncHairlines() to exactly one device pixel \u2014 a CSS 1px at
   fractional DPR (1.25, 1.5\u2026) straddles two physical pixels and siblings end
   up looking like different thicknesses depending on subpixel placement. */
.vela-sep { height: 22px; margin: 0 2px; flex: none; background: var(--vela-border-strong); }
.vela-alerts-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--vela-accent);
    color: var(--vela-fg-on-fill);
    font-size: 9px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
/* The right side of the bar \u2014 whatever the composition puts there rides this one
   auto-margin push (the flow-actions host used to carry it; composition can omit it). */
.vela-topbar-right { margin-left: auto; display: inline-flex; align-items: center; gap: var(--vela-space-1); }
.vela-widget-actions { display: inline-flex; gap: var(--vela-space-1); }
/* Left-aligned contributed actions \u2014 the primary-chrome cluster after the dropdowns. */
.vela-widget-actions-left { display: inline-flex; align-items: center; gap: var(--vela-space-1); }
/* One PINNED contributed action's slot (a composition entry naming the action's id). */
.vela-widget-action-pin { display: inline-flex; align-items: center; }
/* The side-panel toggles, one per docked panel \u2014 a group so the dock can rebuild them
   without disturbing the tools around it. */
.vela-widget-panels { display: inline-flex; align-items: center; gap: var(--vela-space-1); }
.vela-widget-tool {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 30px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 14px;
}
.vela-widget-tool:hover:not(:disabled) { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-widget-tool:disabled { opacity: 0.35; cursor: default; }
.vela-widget-tool[data-active='1'] { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-widget-action {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: var(--vela-radius-sm);
    cursor: pointer;
    color: var(--vela-fg);
}
.vela-widget-action:hover { background: var(--vela-hover); }
`;
var BUILTIN_STYLE_LABELS = {
  candles: "Candles",
  bars: "Bars",
  line: "Line",
  area: "Area",
  baseline: "Baseline"
};
function priceStyleLabel(id) {
  return chartType(id)?.label ?? BUILTIN_STYLE_LABELS[id] ?? id;
}
function priceStyleIcon(id) {
  const iconId = `style-${id}`;
  if (iconMarkup(iconId)) return iconId;
  const svg = chartType(id)?.icon;
  if (svg) {
    registerIcon(iconId, svg);
    return iconId;
  }
  return void 0;
}
var Topbar = class {
  constructor(host, opts) {
    this.layoutButton = null;
    this.layoutPicker = null;
    this.layoutId = null;
    this.tooltips = [];
    this.panelBtns = /* @__PURE__ */ new Map();
    this.panelTooltips = [];
    /** Pinned contributed-action slots, by action id (composition entries that name one,
     *  plus built-in slots taken over by an override). */
    this.pinned = /* @__PURE__ */ new Map();
    /** Overrides that LEFT their native slot (default side + a declared `order`) — they
     *  render through the flow cluster like ordinary actions. */
    this.flowingOverrides = /* @__PURE__ */ new Set();
    /** Tooltips of the CURRENT icon-only action buttons — rebuilt with every
     *  renderActions pass (contributed buttons are replaceChildren'd away). */
    this.actionTooltips = [];
    /** `iconOnly` misuse warned once per action id (renderActions re-runs freely). */
    this.warnedIconless = /* @__PURE__ */ new Set();
    this.onHairlineSync = () => {
      if (this.hairlineRaf) return;
      const win = this.el.ownerDocument.defaultView;
      this.hairlineRaf = win?.requestAnimationFrame(() => {
        this.hairlineRaf = 0;
        this.syncHairlines();
      }) ?? 0;
    };
    this.hairlineRo = null;
    this.hairlineRaf = 0;
    this.opts = opts;
    this.host = host;
    this.timeframe = opts.timeframe;
    this.priceStyle = opts.priceStyle;
    this.comp = resolveTopbarComposition(opts.composition);
    const vis = (id) => topbarHas(this.comp, id);
    const doc = host.ownerDocument;
    injectStyles(STYLE_ID2, CSS2, doc);
    this.el = doc.createElement("div");
    this.el.className = "vela-widget-topbar";
    this.symbolEl = doc.createElement("button");
    this.symbolEl.className = "vela-widget-symbol";
    this.symbolEl.textContent = parseSymbol(opts.symbol).ticker;
    if (opts.onSymbolClick) this.symbolEl.addEventListener("click", opts.onSymbolClick);
    this.tfFavs = [...opts.timeframeFavorites ?? []];
    this.tfChipsHost = doc.createElement("span");
    this.tfChipsHost.className = "vela-widget-tf-chips";
    this.tfCaret = doc.createElement("button");
    this.tfCaret.className = "vela-widget-tf-caret";
    this.tfCaret.appendChild(iconEl("chevron-down", doc));
    this.tfCaret.setAttribute("aria-label", "Timeframes");
    const tfGroup = doc.createElement("span");
    tfGroup.className = "vela-widget-tf-group";
    tfGroup.append(this.tfChipsHost, this.tfCaret);
    this.styleButton = doc.createElement("button");
    this.styleButton.className = "vela-widget-style";
    this.renderStyleButton(doc);
    let indicatorsBtn = null;
    if (opts.onIndicatorsClick && !topbarActionOverride("indicators")) {
      indicatorsBtn = doc.createElement("button");
      indicatorsBtn.className = "vela-widget-indicators";
      indicatorsBtn.append(iconEl("indicators", doc), doc.createTextNode("Indicators"));
      indicatorsBtn.addEventListener("click", opts.onIndicatorsClick);
    }
    this.actionsHost = doc.createElement("span");
    this.actionsHost.className = "vela-widget-actions";
    this.leftActionsHost = doc.createElement("span");
    this.leftActionsHost.className = "vela-widget-actions-left";
    this.panelsHost = doc.createElement("span");
    this.panelsHost.className = "vela-widget-panels";
    const tool = (cls, icon2, tip, onClick) => this.toolButton(cls, icon2, tip, onClick, this.tooltips);
    if (vis("undo-redo")) {
      this.undoBtn = tool("vela-widget-undo", "undo", "Undo", opts.onUndoClick);
      this.redoBtn = tool("vela-widget-redo", "redo", "Redo", opts.onRedoClick);
    } else {
      this.undoBtn = doc.createElement("button");
      this.redoBtn = doc.createElement("button");
    }
    this.setHistoryState(false, false);
    const screenshotBtn = vis("screenshot") && !topbarActionOverride("screenshot") ? tool("vela-widget-screenshot", "camera", "Download screenshot", opts.onScreenshotClick) : null;
    this.alertsBtn = vis("alerts") ? tool("vela-widget-alerts", "bell", "Alerts") : doc.createElement("button");
    this.alertsBtn.style.position = "relative";
    if (opts.onAlertsClick) this.alertsBtn.addEventListener("click", () => opts.onAlertsClick(this.alertsBtn));
    this.alertsBadge = doc.createElement("span");
    this.alertsBadge.className = "vela-alerts-badge";
    this.alertsBadge.style.display = "none";
    this.alertsBtn.appendChild(this.alertsBadge);
    if (opts.layout && vis("layout")) {
      this.layoutId = opts.layout.current;
      this.layoutButton = doc.createElement("button");
      this.layoutButton.className = "vela-widget-style";
      this.renderLayoutButton(doc);
    }
    const sep = () => {
      const d = doc.createElement("span");
      d.className = "vela-sep";
      return d;
    };
    this.leftActionsSep = sep();
    this.leftActionsSep.hidden = true;
    const primaries = /* @__PURE__ */ new Set(["symbol", "timeframes", "style", "layout", "indicators"]);
    const pinSlot = (id, left) => {
      const slot = doc.createElement("span");
      slot.className = "vela-widget-action-pin";
      this.pinned.set(id, { host: slot, left });
      return [slot];
    };
    const overridden = (id, left) => {
      const ov = topbarActionOverride(id);
      if (!ov) return null;
      const sideDeclared = left ? opts.composition?.left != null : opts.composition?.right != null;
      if (!sideDeclared && ov.order !== void 0) {
        this.flowingOverrides.add(id);
        return [];
      }
      return pinSlot(id, left);
    };
    const elementsFor = (id, left) => {
      switch (id) {
        case "symbol":
          return [this.symbolEl];
        case "timeframes":
          return [tfGroup];
        case "style":
          return [this.styleButton];
        case "layout":
          return this.layoutButton ? [this.layoutButton] : [];
        case "indicators":
          return overridden(id, left) ?? (indicatorsBtn ? [indicatorsBtn] : []);
        case "actions":
          return left ? [this.leftActionsHost, this.leftActionsSep] : [this.actionsHost];
        case "undo-redo":
          return [this.undoBtn, this.redoBtn];
        case "alerts":
          return [this.alertsBtn];
        case "panels":
          return [this.panelsHost];
        case "screenshot":
          return overridden(id, left) ?? (screenshotBtn ? [screenshotBtn] : []);
        default:
          return pinSlot(id, left);
      }
    };
    const sideEls = (list, left) => {
      const out = [];
      for (const [i, id] of list.entries()) {
        const els = elementsFor(id, left);
        if (els.length === 0) continue;
        out.push(...els);
        if (primaries.has(id) && i < list.length - 1) out.push(sep());
      }
      return out;
    };
    const right = doc.createElement("span");
    right.className = "vela-topbar-right";
    right.append(...sideEls(this.comp.right, false));
    this.el.append(...sideEls(this.comp.left, true), right);
    host.appendChild(this.el);
    this.renderTfChips();
    this.onHairlineSync();
    this.hairlineRo = new ResizeObserver(this.onHairlineSync);
    this.hairlineRo.observe(this.el);
    doc.defaultView?.addEventListener("resize", this.onHairlineSync);
    this.renderActions();
    this.tooltips.push(new Tooltip(this.tfCaret, { content: "Timeframe", triggerId: "vela-topbar-tf", host }));
    this.tooltips.push(new Tooltip(this.styleButton, { content: "Chart style", triggerId: "vela-topbar-style", host }));
    if (this.layoutButton && opts.layout) {
      this.tooltips.push(new Tooltip(this.layoutButton, { content: "Layout", triggerId: "vela-topbar-layout", host }));
      const layout = opts.layout;
      this.layoutPicker = new LayoutPicker({
        trigger: this.layoutButton,
        host,
        shape: () => layout.shape(),
        presets: () => layout.presets().map((p) => ({ ...p, checked: p.id === this.layoutId })),
        onSelectGrid: (rows, cols) => layout.onSelectGrid(rows, cols),
        onSelectPreset: (id) => layout.onSelectPreset(id),
        syncs: () => layout.syncs(),
        onToggleSync: (id) => layout.onToggleSync(id)
      });
    }
    this.tfMenu = new Menu({
      trigger: this.tfCaret,
      triggerId: "vela-topbar-tf",
      host,
      items: this.tfItems(),
      onSelect: (id) => opts.onTimeframe(id),
      onFavorite: (id, on) => opts.onTimeframeFavorite?.(id, on),
      // Timeframe labels are two-or-three characters ("1m", "4h", "1D") — the
      // stylesheet's default min-width would leave the list mostly empty.
      minWidth: "84px"
    });
    this.styleMenu = new Menu({
      trigger: this.styleButton,
      triggerId: "vela-topbar-style",
      host,
      items: this.styleItems(),
      onSelect: (id) => opts.onPriceStyle(id),
      iconBadges: true
    });
  }
  setSymbol(symbol) {
    this.symbolEl.textContent = parseSymbol(symbol).ticker;
  }
  setTimeframe(tf) {
    this.timeframe = tf;
    this.tfMenu.setItems(this.tfItems());
    this.renderTfChips();
  }
  /** Reflect the favorite-timeframe set — the quick-switch chips and the dropdown stars. */
  setTimeframeFavorites(favs) {
    this.tfFavs = [...favs];
    this.renderTfChips();
    this.tfMenu.setItems(this.tfItems());
  }
  /** Rebuild the quick-switch chips (current value changed, or the favorite set did). */
  renderTfChips() {
    const doc = this.el.ownerDocument;
    this.tfChipsHost.replaceChildren();
    const stars = this.opts.onTimeframeFavorite !== void 0;
    const chips = stars ? favoriteTimeframeChips(this.tfFavs) : [];
    const currentIsFav = chips.includes(this.timeframe);
    const shown = currentIsFav || chips.length === 0 ? chips : [...chips, this.timeframe];
    for (const tf of shown) {
      const b = doc.createElement("button");
      b.className = "vela-widget-tf";
      const label = timeframeLabel(tf);
      b.textContent = label;
      if (tf === this.timeframe) {
        b.dataset.current = "1";
        b.setAttribute("aria-current", "true");
      } else {
        b.setAttribute("aria-label", `Switch timeframe to ${label}`);
        b.addEventListener("click", () => this.opts.onTimeframe(tf));
      }
      this.tfChipsHost.appendChild(b);
    }
    this.tfCaret.replaceChildren();
    if (chips.length === 0) {
      this.tfCaret.dataset.solo = "1";
      this.tfCaret.append(doc.createTextNode(timeframeLabel(this.timeframe)), iconEl("chevron-down", doc));
      this.tfCaret.setAttribute("aria-label", `Timeframe \u2014 ${timeframeLabel(this.timeframe)}`);
    } else {
      delete this.tfCaret.dataset.solo;
      this.tfCaret.appendChild(iconEl("chevron-down", doc));
      this.tfCaret.setAttribute("aria-label", "Timeframes");
    }
    this.onHairlineSync();
  }
  setPriceStyle(style) {
    this.priceStyle = style;
    this.renderStyleButton(this.styleButton.ownerDocument);
    this.styleMenu.setItems(this.styleItems());
  }
  /** Reflect the current workspace layout (no-op without the layout dropdown). */
  setLayout(id) {
    if (!this.layoutButton) return;
    this.layoutId = id;
    this.renderLayoutButton(this.layoutButton.ownerDocument);
    this.layoutPicker?.refresh();
  }
  renderLayoutButton(doc) {
    if (!this.layoutButton) return;
    this.layoutButton.replaceChildren();
    const glyph = this.opts.layout?.glyph?.();
    if (glyph || iconMarkup("layout")) {
      const icon2 = iconEl("layout", doc);
      if (glyph) icon2.innerHTML = glyph;
      this.layoutButton.appendChild(icon2);
    } else {
      this.layoutButton.appendChild(doc.createTextNode(this.layoutId ?? ""));
    }
    this.layoutButton.setAttribute("aria-label", `Layout \u2014 ${this.layoutId ?? ""}`);
  }
  renderStyleButton(doc) {
    this.styleButton.replaceChildren();
    const icon2 = priceStyleIcon(this.priceStyle);
    if (icon2) this.styleButton.appendChild(iconEl(icon2, doc));
    else this.styleButton.appendChild(doc.createTextNode(priceStyleLabel(this.priceStyle)));
    this.styleButton.setAttribute("aria-label", `Chart style \u2014 ${priceStyleLabel(this.priceStyle)}`);
  }
  /** Re-project the contributed topbar actions (call after registrations change).
   *  An action PINNED by the composition renders into its named slot (list position
   *  wins over `align`/`order`); the rest flow into the side's `actions` slot — or
   *  not at all when an explicit list omits it (the list is the side's contract). */
  renderActions() {
    const ctx = this.opts.getContext?.();
    this.actionsHost.replaceChildren();
    this.leftActionsHost.replaceChildren();
    for (const pin of this.pinned.values()) pin.host.replaceChildren();
    for (const t of this.actionTooltips) t.destroy();
    this.actionTooltips = [];
    const doc = this.actionsHost.ownerDocument;
    const flowLeft = this.comp.left.includes("actions");
    const flowRight = this.comp.right.includes("actions");
    const builtin = new Set(TOPBAR_BUILTIN_IDS);
    for (const action of widgetActions("topbar", ctx)) {
      const pin = this.pinned.get(action.id);
      if (!pin && builtin.has(action.id) && !this.flowingOverrides.has(action.id)) continue;
      const left = pin ? pin.left : action.align === "left";
      if (!pin && !(left ? flowLeft : flowRight)) continue;
      const iconOnly = action.iconOnly === true && !!action.icon;
      if (action.iconOnly === true && !action.icon && !this.warnedIconless.has(action.id)) {
        this.warnedIconless.add(action.id);
        console.warn(`[vela] widget action "${action.id}": iconOnly needs an \`icon\` \u2014 rendering the label instead.`);
      }
      const b = doc.createElement("button");
      b.className = left ? "vela-widget-action-left" : iconOnly ? "vela-widget-tool" : "vela-widget-action";
      if (action.icon) b.appendChild(iconEl(action.icon, doc));
      if (iconOnly) {
        b.setAttribute("aria-label", action.label);
        this.actionTooltips.push(new Tooltip(b, { content: action.label, triggerId: `vela-action-${action.id}`, host: this.host }));
      } else {
        b.appendChild(doc.createTextNode(action.label));
      }
      b.addEventListener("click", () => {
        const c = this.opts.getContext?.();
        if (c) action.run(c);
      });
      (pin ? pin.host : left ? this.leftActionsHost : this.actionsHost).appendChild(b);
    }
    this.leftActionsSep.hidden = this.leftActionsHost.childElementCount === 0;
    this.onHairlineSync();
  }
  setIndicatorCount(_n) {
  }
  /** Enable/disable the undo and redo tools from the host's unified history. */
  setHistoryState(canUndo, canRedo) {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }
  setAlertCount(n) {
    this.alertsBadge.textContent = n > 9 ? "9+" : String(n);
    this.alertsBadge.style.display = n > 0 ? "" : "none";
  }
  /**
   * Replace the side-panel toggle group — one icon button per docked panel, in the dock's own
   * order. The dock calls this whenever its panel set changes (built-ins at construction,
   * contributed panels on every `refreshActions()`), then pushes each pressed state.
   */
  setPanelButtons(buttons, onClick) {
    for (const t of this.panelTooltips) t.destroy();
    this.panelTooltips = [];
    this.panelBtns.clear();
    this.panelsHost.replaceChildren();
    for (const b of buttons) {
      const el = this.toolButton(`vela-widget-panel-${b.id}`, b.icon, b.title, () => onClick(b.id), this.panelTooltips);
      this.panelBtns.set(b.id, el);
      this.panelsHost.appendChild(el);
    }
  }
  /** Reflect a docked side panel's open state on its button — the panels toggle each other,
   *  so the dock pushes the state rather than the button assuming it. */
  setPanelActive(id, open) {
    const btn = this.panelBtns.get(id);
    if (btn) btn.dataset.active = open ? "1" : "";
  }
  destroy() {
    this.hairlineRo?.disconnect();
    const win = this.el.ownerDocument.defaultView;
    win?.removeEventListener("resize", this.onHairlineSync);
    if (this.hairlineRaf) win?.cancelAnimationFrame(this.hairlineRaf);
    this.tfMenu.destroy();
    this.styleMenu.destroy();
    this.layoutPicker?.destroy();
    for (const t of [...this.tooltips, ...this.panelTooltips, ...this.actionTooltips]) t.destroy();
    this.el.remove();
  }
  /** One icon-only tool button with its kit tooltip, parked in `sink` for disposal. */
  toolButton(cls, icon2, tip, onClick, sink) {
    const doc = this.el.ownerDocument;
    const b = doc.createElement("button");
    b.className = `vela-widget-tool ${cls}`;
    b.appendChild(iconEl(icon2, doc));
    b.setAttribute("aria-label", tip);
    sink.push(new Tooltip(b, { content: tip, triggerId: `vela-tool-${cls}`, host: this.host }));
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  /** Paint each `.vela-sep` as exactly one device pixel, snapped to the pixel grid. */
  syncHairlines() {
    const win = this.el.ownerDocument.defaultView;
    if (!win) return;
    const dpr = win.devicePixelRatio || 1;
    for (const el of this.el.querySelectorAll(".vela-sep")) {
      el.style.width = `${1 / dpr}px`;
      el.style.transform = "";
      const left = el.getBoundingClientRect().left;
      const dx = Math.round(left * dpr) / dpr - left;
      if (dx) el.style.transform = `translateX(${dx}px)`;
    }
  }
  tfItems() {
    const stars = this.opts.onTimeframeFavorite !== void 0;
    return this.opts.timeframes.map((tf) => ({
      id: tf,
      label: timeframeLabel(tf),
      checked: tf === this.timeframe,
      ...stars ? { favorite: this.tfFavs.includes(tf) } : {}
    }));
  }
  styleItems() {
    return priceStyleIds().map((id, i) => ({
      id,
      label: priceStyleLabel(id),
      icon: priceStyleIcon(id),
      checked: id === this.priceStyle,
      separatorBefore: i === BUILTIN_PRICE_STYLES.length
    }));
  }
};

// src/widget/bottombar.ts
var RANGE_PRESETS = [
  { id: "1D", tf: "1", preset: "1D", bars: 1500 },
  //   1 day  @ 1m  = 1440 bars
  { id: "7D", tf: "5", preset: "1W", bars: 2100 },
  //   7 days @ 5m  = 2016
  { id: "1M", tf: "30", preset: "1M", bars: 1500 },
  //  30 days @ 30m = 1440
  { id: "3M", tf: "60", preset: "3M", bars: 2200 },
  //  90 days @ 1h  = 2160
  { id: "6M", tf: "240", preset: "6M", bars: 1150 },
  // 180 days @ 4h  = 1080
  { id: "YTD", tf: "D", preset: "YTD", bars: 400 },
  //  ≤366 days @ 1D
  { id: "1Y", tf: "D", preset: "1Y", bars: 400 },
  //    365 days @ 1D
  { id: "5Y", tf: "W", preset: "5Y", bars: 300 },
  //    5 years  @ 1W = 261
  { id: "ALL", tf: "W", preset: "ALL", bars: 5e3 }
  // everything the provider serves
];
var STYLE_ID3 = "vela-widget-bottombar";
var CSS3 = `
.vela-widget-bottombar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding: 0 8px;
    border-top: 1px solid var(--vela-border);
    color: var(--vela-fg-muted);
    font-size: 12px;
    flex: none;
}
.vela-bb-range {
    all: unset;
    height: 24px;
    display: inline-flex;
    align-items: center;
    padding: 0 9px;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
}
.vela-bb-range:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-bb-range[data-active='1'] { color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-bb-spacer { flex: 1 1 auto; }
.vela-bb-clock { font-variant-numeric: tabular-nums; color: var(--vela-fg-bright); font-weight: 600; }
.vela-bb-tz {
    all: unset;
    height: 26px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border-radius: 4px;
    font-weight: 600;
    color: var(--vela-fg-bright);
    cursor: pointer;
}
.vela-bb-tz:hover { background: var(--vela-hover); }
.vela-bb-session { display: inline-flex; border: 1px solid var(--vela-border-strong); border-radius: 4px; overflow: hidden; margin-left: 6px; }
.vela-bb-session-btn {
    all: unset;
    height: 24px;
    display: inline-flex;
    align-items: center;
    padding: 0 8px;
    color: var(--vela-fg-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
}
.vela-bb-session-btn:disabled { cursor: not-allowed; opacity: 0.55; }
.vela-bb-session-btn:not(:disabled):hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-bb-session-btn.is-active { color: var(--vela-fg); background: var(--vela-surface-elev); }
.vela-bb-session-btn.is-active:disabled { opacity: 0.8; }
.vela-bb-settings {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    margin-left: 6px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 14px;
}
.vela-bb-settings:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
`;
var Bottombar = class {
  constructor(host, opts) {
    this.settingsTip = null;
    this.rangeButtons = /* @__PURE__ */ new Map();
    this.sessionButtons = /* @__PURE__ */ new Map();
    this.sessionEl = null;
    this.timezone = opts.timezone;
    this.exchangeTimezone = opts.exchangeTimezone;
    const doc = host.ownerDocument;
    injectStyles(STYLE_ID3, CSS3, doc);
    this.el = doc.createElement("div");
    this.el.className = "vela-widget-bottombar";
    for (const preset of RANGE_PRESETS) {
      const b = doc.createElement("button");
      b.className = "vela-bb-range";
      b.textContent = preset.id;
      b.addEventListener("click", () => {
        this.setActiveRange(preset.id);
        opts.onRange(preset);
      });
      this.rangeButtons.set(preset.id, b);
      this.el.appendChild(b);
    }
    const spacer = doc.createElement("span");
    spacer.className = "vela-bb-spacer";
    this.tzButton = doc.createElement("button");
    this.tzButton.className = "vela-bb-tz";
    this.tzButton.setAttribute("aria-label", "Time zone");
    this.clockEl = doc.createElement("span");
    this.clockEl.className = "vela-bb-clock";
    this.tzLabelEl = doc.createElement("span");
    this.tzLabelEl.textContent = tzButtonLabel(this.displayZone);
    this.tzButton.append(this.clockEl, this.tzLabelEl);
    const session = doc.createElement("span");
    session.className = "vela-bb-session";
    this.sessionEl = session;
    session.style.display = "none";
    session.title = "Session \u2014 regular (RTH) vs extended (ETH) hours";
    for (const [key, label] of [["regular", "RTH"], ["extended", "ETH"]]) {
      const b = doc.createElement("button");
      b.className = "vela-bb-session-btn" + (key === "regular" ? " is-active" : "");
      b.textContent = label;
      b.disabled = true;
      b.addEventListener("click", () => {
        if (b.disabled) return;
        this.setSession({ session: key, enabled: true });
        opts.onSession?.(key);
      });
      this.sessionButtons.set(key, b);
      session.appendChild(b);
    }
    const settingsBtn = doc.createElement("button");
    settingsBtn.className = "vela-bb-settings";
    settingsBtn.appendChild(iconEl("gear", doc));
    settingsBtn.setAttribute("aria-label", "Chart settings");
    if (opts.onSettingsClick) settingsBtn.addEventListener("click", opts.onSettingsClick);
    this.settingsTip = new Tooltip(settingsBtn, { content: "Chart settings", triggerId: "vela-bb-settings", host });
    this.el.append(spacer, this.tzButton, session, settingsBtn);
    host.appendChild(this.el);
    this.tzMenu = new Menu({
      trigger: this.tzButton,
      triggerId: "vela-bb-tz",
      host,
      placement: "top-end",
      items: this.tzItems(),
      onSelect: (zone) => {
        this.setTimezone(zone, this.exchangeTimezone);
        opts.onTimezone(zone);
      }
    });
    this.tick();
    this.unsubClock = (opts.clock ?? new SecondClock()).onTick(() => this.tick());
  }
  /**
   * Reflect the stored choice AND the active chart's market zone. The clock and the
   * offset label read the RESOLVED zone, so a workspace on the exchange rule re-labels
   * when the active cell (or its symbol) changes market — the host re-projects on
   * both. Idempotent: unchanged inputs leave the menu alone.
   */
  setTimezone(zone, exchangeTimezone) {
    if (zone === this.timezone && exchangeTimezone === this.exchangeTimezone) return;
    const choiceChanged = zone !== this.timezone;
    this.timezone = zone;
    this.exchangeTimezone = exchangeTimezone;
    this.tzLabelEl.textContent = tzButtonLabel(this.displayZone);
    if (choiceChanged) this.tzMenu.setItems(this.tzItems());
    this.tick();
  }
  /** The zone the bar's clock and label render in. */
  get displayZone() {
    return resolveTimezone(this.timezone, this.exchangeTimezone);
  }
  /** Highlight (or clear with null) the active range chip — cleared on manual tf changes. */
  setActiveRange(id) {
    for (const [key, b] of this.rangeButtons) {
      if (id !== null && key === id) b.dataset.active = "1";
      else delete b.dataset.active;
    }
  }
  /**
   * Reflect the ACTIVE chart's session posture. `enabled: false` (a continuous
   * market, or metadata not landed yet) HIDES the toggle entirely — RTH/ETH is
   * meaningless there. Enabled, the chips appear and the active one tracks the
   * chart's current session.
   */
  setSession(state) {
    if (this.sessionEl) this.sessionEl.style.display = state.enabled ? "" : "none";
    for (const [key, b] of this.sessionButtons) {
      b.disabled = !state.enabled;
      b.classList.toggle("is-active", key === (state.enabled ? state.session : "regular"));
    }
  }
  destroy() {
    this.unsubClock();
    this.tzMenu.destroy();
    this.settingsTip?.destroy();
    this.el.remove();
  }
  tzItems() {
    return timezoneMenuRows(this.timezone).map((r) => ({ id: r.value, label: r.label, checked: r.checked }));
  }
  tick() {
    try {
      this.clockEl.textContent = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: this.displayZone
      }).format(/* @__PURE__ */ new Date());
    } catch {
      this.clockEl.textContent = "";
    }
  }
};

// src/widget/symbol-icon.ts
var iconFailed = /* @__PURE__ */ new Set();
function initialsOf(name) {
  return (name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
}
function tickerIconEl(doc, base, name, className, iconUrl) {
  const wrap = doc.createElement("span");
  wrap.className = className;
  const fallback = () => {
    wrap.replaceChildren();
    wrap.style.background = categoricalColor(name);
    wrap.textContent = initialsOf(base || name);
  };
  if (!iconUrl || iconFailed.has(iconUrl)) {
    fallback();
    return wrap;
  }
  const img = doc.createElement("img");
  img.alt = "";
  img.crossOrigin = "anonymous";
  img.src = iconUrl;
  img.style.cssText = "width:100%;height:100%;border-radius:50%;display:block;object-fit:cover;";
  img.addEventListener(
    "error",
    () => {
      iconFailed.add(iconUrl);
      fallback();
    },
    { once: true }
  );
  wrap.appendChild(img);
  return wrap;
}

// src/widget/object-tree-model.ts
var PRICE_PANE_ID = "price";
var PRICE_PANE_LABEL = "Main chart";
function drawingMeta(type) {
  const meta = getDrawingType(type);
  if (meta) return { label: meta.label, icon: meta.icon };
  return { label: String(type || "drawing").replace(/(^|\s)\S/g, (c) => c.toUpperCase()), icon: null };
}
function drawingLabel(d) {
  const { label } = drawingMeta(d.type);
  const text = d.text?.value?.trim();
  return text ? `${label} \u2014 ${text}` : label;
}
function paneLabel(pane, fallbackTitle) {
  if (pane.kind === "price") return PRICE_PANE_LABEL;
  const master = pane.indicators.find((i) => !i.ownScale) ?? pane.indicators[0];
  if (master) return indicatorLabel(master, fallbackTitle);
  return `Pane ${pane.order + 1}`;
}
function indicatorLabel(i, fallbackTitle) {
  return i.title || fallbackTitle(i.id) || i.id;
}
function indicatorRowLabel(i, fallbackTitle) {
  return i.shorttitle || indicatorLabel(i, fallbackTitle);
}
function paneRows(pane) {
  return pane.items.flatMap((it) => it.kind === "row" ? [it.row] : []);
}
function sameToken(a, b) {
  if (a.kind === "price" || b.kind === "price") return a.kind === b.kind;
  return a.kind === b.kind && a.id === b.id;
}
function unitTokens(u) {
  if (u.kind === "draw") return [{ kind: "drawing", id: u.drawing.id }];
  return u.members.map((m) => ({ kind: "drawing", id: m.id }));
}
function itemTokens(item) {
  if (item.kind === "unit") return unitTokens(item.unit);
  return [item.row.kind === "price" ? { kind: "price" } : { kind: "indicator", id: item.row.id }];
}
function paneTokens(pane) {
  return pane.items.flatMap(itemTokens);
}
function tokenIndexOfSlot(pane, slot) {
  let at = 0;
  for (let i = 0; i < Math.min(slot, pane.items.length); i += 1) at += itemTokens(pane.items[i]).length;
  return at;
}
function groupTokenIndex(pane, groupId, memberSlot) {
  let at = 0;
  for (const item of pane.items) {
    if (item.kind === "unit" && item.unit.kind === "group" && item.unit.group.id === groupId) {
      return at + Math.min(memberSlot, item.unit.members.length);
    }
    at += itemTokens(item).length;
  }
  return at;
}
function placeTokens(tokens, dragged, at) {
  const isDragged = (t) => dragged.some((d) => sameToken(d, t));
  let adjusted = at;
  tokens.forEach((t, i) => {
    if (i < at && isDragged(t)) adjusted -= 1;
  });
  const rest = tokens.filter((t) => !isDragged(t));
  rest.splice(Math.max(0, Math.min(adjusted, rest.length)), 0, ...dragged);
  return rest;
}
function tokensEqual(a, b) {
  return a.length === b.length && a.every((t, i) => sameToken(t, b[i]));
}
function stackWrites(tokens) {
  const n = tokens.length;
  let candleZ = null;
  const series = [];
  const drawings = [];
  tokens.forEach((t, i) => {
    const z = n - i;
    if (t.kind === "price") candleZ = z;
    else if (t.kind === "indicator") series.push({ id: t.id, z });
    else drawings.push({ id: t.id, z });
  });
  return { candleZ, series, drawings };
}
function zStackBounds(zOrder, candleZ, extra = []) {
  const zs = [...zOrder.map((e) => e.z), ...extra];
  return { top: Math.max(candleZ, 0, ...zs), bottom: Math.min(candleZ, 0, ...zs) };
}
function paneDrawings(drawings, paneId, paneIds) {
  const mine = drawings.filter((d) => paneId === PRICE_PANE_ID ? d.paneId === PRICE_PANE_ID || !paneIds.has(d.paneId) : d.paneId === paneId);
  return mine.slice().reverse();
}
function groupOf(groups, drawingId) {
  return groups.find((g) => g.ids.includes(drawingId)) ?? null;
}
function groupState(members) {
  return {
    allHidden: members.length > 0 && members.every((d) => d.visible === false),
    allLocked: members.length > 0 && members.every((d) => d.locked === true)
  };
}
function canGroup(ids, groups) {
  return ids.length > 0 && ids.every((id) => groupOf(groups, id) === null);
}
function nextGroupName(groups) {
  const taken = new Set(groups.map((g) => g.name));
  for (let n = 1; n <= groups.length; n += 1) {
    const name = `Group ${n}`;
    if (!taken.has(name)) return name;
  }
  return `Group ${groups.length + 1}`;
}
function withMembers(groups, keep) {
  return groups.map((g) => ({ ...g, ids: g.ids.filter(keep) })).filter((g) => g.ids.length > 0);
}
function pruneGroups(groups, live) {
  return withMembers(groups, (id) => live.has(id));
}
function removeFromGroups(groups, ids) {
  const drop = new Set(ids);
  return withMembers(groups, (id) => !drop.has(id));
}
function assignToGroup(groups, groupId, ids) {
  const moving = new Set(ids);
  const next = groups.map((g) => {
    const kept = g.ids.filter((id) => !moving.has(id));
    return { ...g, ids: g.id === groupId ? [...kept, ...ids] : kept };
  });
  return next.filter((g) => g.ids.length > 0);
}
function drawingUnits(paneDraws, groups) {
  const units = [];
  const seen = /* @__PURE__ */ new Set();
  for (const d of paneDraws) {
    if (seen.has(d.id)) continue;
    const g = groupOf(groups, d.id);
    if (g) {
      const members = paneDraws.filter((x) => g.ids.includes(x.id));
      for (const m of members) seen.add(m.id);
      units.push({ kind: "group", group: g, members });
    } else {
      seen.add(d.id);
      units.push({ kind: "draw", drawing: d });
    }
  }
  return units;
}
function unitZ(u) {
  if (u.kind === "draw") return u.drawing.zIndex;
  return u.members[0]?.zIndex ?? 0;
}
function paneItems(snap, pane, units) {
  const priceRow = () => ({ kind: "price", label: snap.priceLabel, visible: snap.priceVisible });
  const indicatorRow = (i) => ({
    kind: "indicator",
    id: i.id,
    label: indicatorRowLabel(i, snap.handleTitle),
    visible: snap.indicatorVisible(i.id),
    ownScale: i.ownScale
  });
  const unitItems = units.map((unit) => ({ kind: "unit", unit }));
  if (!snap.stackable) {
    const rows2 = pane.indicators.map((i) => ({ kind: "row", row: indicatorRow(i) }));
    if (pane.kind === "price") rows2.unshift({ kind: "row", row: priceRow() });
    return [...unitItems, ...rows2];
  }
  const zOf = new Map(snap.zOrder.map((e) => [e.id, e.z]));
  const rows = pane.indicators.map((i) => ({ item: { kind: "row", row: indicatorRow(i) }, z: zOf.get(i.id) ?? 0 }));
  if (pane.kind === "price") rows.push({ item: { kind: "row", row: priceRow() }, z: snap.candleZ });
  rows.sort((a, b) => b.z - a.z);
  if (!snap.interleave) return [...unitItems, ...rows.map((r) => r.item)];
  const entries = [...rows, ...units.map((unit) => ({ item: { kind: "unit", unit }, z: unitZ(unit) }))];
  entries.sort((a, b) => a.z === b.z ? Number(a.item.kind === "unit") - Number(b.item.kind === "unit") : b.z - a.z);
  return entries.map((e) => e.item);
}
function buildTree(snap) {
  const paneIds = new Set(snap.panes.map((p) => p.id));
  return snap.panes.map((pane) => ({
    id: pane.id,
    kind: pane.kind,
    label: paneLabel(pane, snap.handleTitle),
    order: pane.order,
    collapsed: pane.collapsed,
    maximized: pane.maximized,
    items: paneItems(snap, pane, drawingUnits(paneDrawings(snap.drawings, pane.id, paneIds), snap.groups))
  }));
}
function treeIsEmpty(panes) {
  return panes.every((p) => p.items.every((it) => it.kind === "row" && it.row.kind === "price"));
}

// src/widget/object-tree.ts
var STYLE_ID4 = "vela-widget-objtree";
var CSS4 = `
/* One pane's block. The transparent border reserves the drop-target outline. */
.vela-ot-pane {
    border: 1px solid transparent;
    border-radius: 6px;
    margin: 2px 0;
}
.vela-ot-panehead { display: flex; align-items: center; gap: 2px; padding: 5px 6px; }
.vela-ot-panename {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.vela-ot-panesep { height: 1px; background: var(--vela-border); margin: 6px 8px; }

.vela-ot-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 6px;
    border-radius: 6px;
    cursor: default;
}
.vela-ot-row:hover { background: var(--vela-hover); }
.vela-ot-row > .vela-icon { color: var(--vela-fg-muted); width: 14px; height: 14px; font-size: 14px; justify-content: center; flex: none; }
/* Drawing glyphs come from the type registry at toolbar scale \u2014 bring them down to row size. */
.vela-ot-row > .vela-icon svg { width: 14px; height: 14px; }
.vela-ot-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-ot-row[data-hidden] .vela-ot-name,
.vela-ot-row[data-hidden] > .vela-icon { opacity: 0.45; }
/* Two different states, and both can be true at once: "picked" is what the panel has selected
   (the group/duplicate candidates), "selected" mirrors what the CHART has selected. */
.vela-ot-row[data-picked] { background: var(--vela-active); }
.vela-ot-row[data-picked] .vela-ot-name { color: var(--vela-fg-bright); }
.vela-ot-row[data-selected] { box-shadow: inset 2px 0 0 var(--vela-accent); }
.vela-ot-avatar {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vela-fg-on-fill);
    font-size: 10px;
    font-weight: 700;
}
/* "scale": this indicator draws against its own price scale, not the pane's. */
.vela-ot-tag {
    flex: none;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vela-fg-muted);
    background: var(--vela-hover);
    border-radius: 3px;
    padding: 1px 4px;
}
/* One row's actions, kept in a tight cluster: they read as one control group, and the row's
   own wider gap stays between the label and them. */
.vela-ot-acts { display: flex; align-items: center; gap: 0; flex: none; }
.vela-ot-btn {
    all: unset;
    cursor: pointer;
    flex: none;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    color: var(--vela-fg-muted);
    font-size: 12px;
    visibility: hidden;
}
.vela-ot-row:hover .vela-ot-btn,
.vela-ot-panehead:hover .vela-ot-btn { visibility: visible; }
/* An engaged action stays out: hidden and locked are states, and a state the user can only
   see by hovering is a state they will not find. */
.vela-ot-row .vela-ot-btn[data-engaged] { visibility: visible; color: var(--vela-fg); }
.vela-ot-btn:hover:not(:disabled) { background: var(--vela-active); color: var(--vela-fg-bright); }
.vela-ot-btn:disabled { opacity: 0.35; cursor: default; }
.vela-ot-empty { padding: 20px 10px; text-align: center; color: var(--vela-fg-muted); font-size: 12px; }

/* \u2500\u2500 drawing groups \u2500\u2500 */
/* One top-level entry in a pane's drawing list: a lone drawing, or a whole group block. No
   border of its own \u2014 units stack flush, so consecutive highlighted rows read as one block; the
   drop-into-group outline is drawn inside the box instead (see the drag-and-drop rules). */
.vela-ot-unit { border-radius: 6px; }
/* Adjacent picked rows merge into one contiguous highlight: the shared edge loses its rounding. */
.vela-ot-unit:has(> .vela-ot-row[data-picked]) + .vela-ot-unit > .vela-ot-row[data-picked] { border-top-left-radius: 0; border-top-right-radius: 0; }
.vela-ot-unit:has(+ .vela-ot-unit > .vela-ot-row[data-picked]) > .vela-ot-row[data-picked] { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.vela-ot-row[data-row-kind='group'] > .vela-icon { width: 12px; font-size: 11px; }
/* A member sits indented under its group's header. */
.vela-ot-subrow { padding-left: 26px; }
.vela-ot-rename {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
    border: 1px solid var(--vela-accent);
    border-radius: var(--vela-radius-sm);
    background: var(--vela-surface-elev);
    color: var(--vela-fg-bright);
    font: inherit;
}
/* The selection bar. Always there \u2014 the actions it holds are the panel's, not a row's, so they
   stay in place and simply go dim until a drawing is selected. It stays put at the top of the
   list while the list scrolls under it, so they never scroll out of reach. */
.vela-ot-selbar {
    position: sticky;
    top: -8px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 2px;
    margin: -8px -8px 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vela-border);
    background: var(--vela-bg);
}
.vela-ot-selcount { flex: 1; min-width: 0; color: var(--vela-fg-muted); font-size: 11px; }
.vela-ot-selbar .vela-ot-btn { visibility: visible; width: 24px; height: 22px; }
.vela-ot-selbar .vela-ot-btn[data-icon='group'] .vela-icon { width: 16px; height: 16px; font-size: 16px; }

/* \u2500\u2500 drag-and-drop \u2500\u2500 */
.vela-ot-row[data-drag] { cursor: grab; }
.vela-ot .vela-panel-body[data-dragging] .vela-ot-row[data-drag] { cursor: grabbing; }
/* The row in flight fades: the ghost under the pointer is the thing being moved. */
.vela-ot-row[data-source] { opacity: 0.4; }
/* Buttons would only invite a click that a drag is about to swallow. */
.vela-ot .vela-panel-body[data-dragging] .vela-ot-btn { visibility: hidden; }

/* The band between two pane blocks: a hairline at rest, a bright bar when dropping there
   would open a new pane. Doubles as the plain separator when dragging isn't available. */
.vela-ot-gap { position: relative; height: 11px; border-radius: 3px; margin: 0 8px; }
.vela-ot-gap::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: var(--vela-border);
    transform: translateY(-50%);
}
.vela-ot-gap[data-drop] { height: 4px; background: var(--vela-fg-bright); }
.vela-ot-gap[data-drop]::before { display: none; }
/* A whole container accepts the drop: merging into a pane, or a pane with no drawings yet.
   The pane block's transparent border reserves the room for this outline; a group unit has no
   border to color, so it draws the same line as an inset outline (no layout footprint). */
.vela-ot [data-drop='target'] { border-color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-ot-unit[data-drop='target'] { outline: 1px solid var(--vela-fg-bright); outline-offset: -1px; }
/* Where a reorder would insert. */
.vela-ot [data-drop='before'] { box-shadow: inset 0 2px 0 var(--vela-fg-bright); }
.vela-ot [data-drop='after'] { box-shadow: inset 0 -2px 0 var(--vela-fg-bright); }

.vela-ot-ghost {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    max-width: 220px;
    padding: 3px 10px;
    border: 1px solid var(--vela-fg-bright);
    border-radius: var(--vela-radius-sm);
    background: var(--vela-surface-overlay);
    color: var(--vela-fg);
    box-shadow: var(--vela-shadow);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
`;
var REFRESH_EVENTS = [
  "indicator:added",
  "indicator:removed",
  "indicator:moved",
  "indicator:visibility",
  "pane:changed",
  "drawing:created",
  "drawing:edited",
  "drawing:removed"
];
var DRAG_SLOP = 4;
function insertionSlot(els, y) {
  for (let i = 0; i < els.length; i += 1) {
    const r = els[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) return i;
  }
  return els.length;
}
var MenuBuilder = class {
  constructor() {
    this.actions = /* @__PURE__ */ new Map();
    this.seq = 0;
  }
  entry(label, icon2, run, separatorBefore = false) {
    const id = this.next();
    this.actions.set(id, run);
    return { id, label, icon: icon2, separatorBefore };
  }
  submenu(label, icon2, submenu, separatorBefore = false) {
    return { id: this.next(), label, icon: icon2, submenu, separatorBefore };
  }
  next() {
    this.seq += 1;
    return `ot${this.seq}`;
  }
};
var ObjectTree = class extends SidePanel {
  constructor(host, iconFor) {
    super(host, "Object tree", "vela-ot");
    this.iconFor = iconFor;
    this.chart = null;
    /** What the CHART has selected — every member of a multi-selection, mirrored as rows. */
    this.selectedDrawings = /* @__PURE__ */ new Set();
    this.symbolName = "";
    /** The raw (possibly venue-prefixed) symbol — what icon resolution routes on. */
    this.symbolRaw = "";
    /** Drawing bundles — a view-side grouping, held for the panel's lifetime and never persisted.
     *  Kept per chart because a workspace points this one panel at whichever chart is active, and
     *  each chart's bundles have to survive the switch. */
    this.groupsPerChart = /* @__PURE__ */ new WeakMap();
    /** Group ids currently folded shut. Ids are never reused, so entries left behind by a group
     *  that is gone are inert and can outlive it. */
    this.collapsed = /* @__PURE__ */ new Set();
    /** Drawings picked IN THE PANEL — what the selection bar and "group selection" act on. */
    this.picked = /* @__PURE__ */ new Set();
    /** The group showing its rename field, if any. */
    this.renaming = null;
    /** Set while the panel pushes its pick to the chart, so the `drawing:selected` that comes
     *  back is recognised as our own echo instead of a fresh chart-side selection. */
    this.syncingSelection = false;
    this.groupSeq = 0;
    this.unsubs = [];
    /** The last render's model, kept so a right-click reads the same state the rows show. */
    this.pass = null;
    this.menu = null;
    this.menuActions = /* @__PURE__ */ new Map();
    this.drag = null;
    injectStyles(STYLE_ID4, CSS4, host.ownerDocument);
    this.body.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    this.body.addEventListener("pointerdown", (e) => this.onPointerDown(e));
  }
  get groups() {
    return (this.chart === null ? void 0 : this.groupsPerChart.get(this.chart)) ?? [];
  }
  set groups(next) {
    if (this.chart) this.groupsPerChart.set(this.chart, next);
  }
  toggle(open = !this.open, instant = false) {
    super.toggle(open, instant);
    if (open) this.refresh();
  }
  setSymbol(symbol) {
    this.symbolRaw = symbol;
    this.symbolName = parseSymbol(symbol).ticker;
  }
  /** (Re)bind to a chart instance — called after every widget rebuild. */
  onChart(chart) {
    this.detach();
    this.chart = chart;
    for (const ev of REFRESH_EVENTS) {
      this.unsubs.push(chart.on(ev, () => this.refresh()));
    }
    this.unsubs.push(
      chart.on("drawing:selected", ({ ids }) => {
        this.selectedDrawings = new Set(ids);
        if (!this.syncingSelection) this.picked = new Set(ids);
        this.refresh();
      })
    );
    this.refresh();
  }
  destroy() {
    this.detach();
    this.endDrag(false);
    this.menu?.destroy();
    this.menu = null;
    super.destroy();
  }
  detach() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.chart = null;
  }
  /** Read the chart into the layout's input. Every chart query happens here, once a pass. */
  snapshot(chart, handle) {
    const stackable = chart.renderer.supports("seriesOrder") && chart.renderer.supports("candleZOrder");
    return {
      panes: chart.panes.list(),
      indicatorVisible: (id) => handle(id)?.visible !== false,
      handleTitle: (id) => handle(id)?.title,
      stackable,
      interleave: stackable && chart.drawings.supported && chart.renderer.capabilities.drawingDepth === true,
      zOrder: stackable ? chart.renderer.get("seriesOrder") ?? [] : [],
      candleZ: stackable ? Number(chart.renderer.get("candleZOrder")) || 0 : 0,
      priceLabel: this.symbolName || "Price",
      priceVisible: chart.renderer.get("candleVisible") !== false,
      drawings: chart.drawings.supported ? chart.drawings.all() : [],
      groups: this.groups
    };
  }
  /**
   * Repaint because something changed — unless the panel is mid-interaction. A live drag
   * resolves drops against the rows as currently rendered, and a rename lives in an input
   * that a repaint would destroy mid-word. Both end by painting themselves.
   */
  refresh() {
    if (this.drag?.active === true || this.renaming !== null) return;
    this.render();
  }
  render() {
    if (this.el.hidden || !this.chart) return;
    const chart = this.chart;
    this.prune(chart);
    const byId = new Map(chart.indicators().map((h) => [h.id, h]));
    const snap = this.snapshot(chart, (id) => byId.get(id));
    const panes = buildTree(snap);
    const pass = { chart, handle: (id) => byId.get(id), stackable: snap.stackable, repanable: chart.panes.supported, interleave: snap.interleave, panes };
    this.pass = pass;
    this.body.replaceChildren();
    const doc = this.el.ownerDocument;
    this.body.appendChild(this.selectionBar(pass));
    panes.forEach((pane, i) => {
      if (i > 0) this.body.appendChild(this.gapEl(pass, panes[i - 1].id, pane.id));
      this.body.appendChild(this.paneBlock(pass, pane));
    });
    const last = panes[panes.length - 1];
    if (last && pass.repanable) this.body.appendChild(this.gapEl(pass, last.id, void 0));
    if (treeIsEmpty(panes)) {
      const empty = doc.createElement("div");
      empty.className = "vela-ot-empty";
      empty.textContent = "Add an indicator or a drawing to populate the tree";
      this.body.appendChild(empty);
    }
  }
  /** What the panel itself can do to the selected drawings: bundle them into a group, or
   *  duplicate all of them. Always in place, dim until there is a selection to act on. */
  selectionBar(pass) {
    const doc = this.el.ownerDocument;
    const bar = doc.createElement("div");
    bar.className = "vela-ot-selbar";
    const ids = [...this.picked];
    const groupable = canGroup(ids, this.groups);
    bar.appendChild(
      this.btn({
        icon: "group",
        title: ids.length === 0 ? "Group the selected drawings" : groupable ? `Group ${ids.length === 1 ? "this drawing" : "these drawings"}` : "Already in a group",
        disabled: !groupable,
        run: () => this.makeGroup(ids)
      })
    );
    bar.appendChild(
      this.btn({
        icon: "clone",
        title: ids.length === 0 ? "Duplicate the selected drawings" : "Duplicate",
        disabled: ids.length === 0,
        run: () => {
          for (const id of ids) this.cloneInto(pass, id);
          this.render();
        }
      })
    );
    const count = doc.createElement("span");
    count.className = "vela-ot-selcount";
    count.textContent = ids.length > 1 ? `${ids.length} selected` : "";
    bar.appendChild(count);
    return bar;
  }
  /** The band between two pane blocks. With re-paning available it is a drop zone that opens
   *  a fresh pane there; otherwise it is just the separator. `before`/`after` name the panes
   *  it sits between (either end is open at the edges of the list). */
  gapEl(pass, after, before) {
    const el = this.el.ownerDocument.createElement("div");
    if (!pass.repanable) {
      el.className = "vela-ot-panesep";
      return el;
    }
    el.className = "vela-ot-gap";
    if (before !== void 0) el.dataset.before = before;
    if (after !== void 0) el.dataset.after = after;
    return el;
  }
  /**
   * A pane, read top to bottom as front to back: ONE column holding its drawings, its
   * indicators and (in the main pane) the candles, in draw order. Every child of the stack
   * element is one slot, so a drop position is read straight off the rendered geometry.
   */
  paneBlock(pass, pane) {
    const doc = this.el.ownerDocument;
    const block = doc.createElement("div");
    block.className = "vela-ot-pane";
    block.dataset.pane = pane.id;
    block.dataset.kind = pane.kind;
    block.appendChild(this.paneHead(pass, pane));
    const stack = doc.createElement("div");
    stack.className = "vela-ot-stack";
    for (const item of pane.items) {
      stack.appendChild(item.kind === "row" ? this.rowEl(pass, pane, item.row) : this.unitEl(pass, pane, item.unit));
    }
    block.appendChild(stack);
    return block;
  }
  /** One top-level drawing entry: a lone drawing's row, or a group block — its header plus,
   *  unfolded, a member row for each drawing it holds. */
  unitEl(pass, pane, unit) {
    const doc = this.el.ownerDocument;
    const wrap = doc.createElement("div");
    wrap.className = "vela-ot-unit";
    if (unit.kind === "draw") {
      wrap.appendChild(this.drawRow(pass, unit.drawing));
    } else {
      wrap.dataset.group = unit.group.id;
      wrap.appendChild(this.groupRow(pass, pane, unit.group));
      if (!this.collapsed.has(unit.group.id)) {
        for (const m of unit.members) wrap.appendChild(this.drawRow(pass, m, true));
      }
    }
    return wrap;
  }
  /** The pane's name plus its ops: a study pane can move in the stack and collapse; every
   *  pane can be maximized. */
  paneHead(pass, pane) {
    const doc = this.el.ownerDocument;
    const { chart } = pass;
    const head = doc.createElement("div");
    head.className = "vela-ot-panehead";
    const name = doc.createElement("span");
    name.className = "vela-ot-panename";
    name.textContent = pane.label;
    name.title = pane.label;
    head.appendChild(name);
    if (!chart.panes.supported) return head;
    const acts = doc.createElement("span");
    acts.className = "vela-ot-acts";
    head.appendChild(acts);
    const op = (icon2, title, run) => {
      acts.appendChild(this.btn({ icon: icon2, title, run }));
    };
    if (pane.kind !== "price") {
      if (pane.order > 1) op("arrow-up", "Move pane up", () => chart.panes.move(pane.id, "up"));
      if (pane.order < pass.panes.length - 1) op("arrow-down", "Move pane down", () => chart.panes.move(pane.id, "down"));
      op(pane.collapsed ? "expand" : "collapse", pane.collapsed ? "Expand pane" : "Collapse pane", () => chart.panes.collapse(pane.id, !pane.collapsed));
    }
    op(pane.maximized ? "restore" : "maximize", pane.maximized ? "Restore panes" : "Maximize pane", () => chart.panes.maximize(pane.maximized ? null : pane.id));
    return head;
  }
  rowEl(pass, pane, row) {
    const doc = this.el.ownerDocument;
    const { chart } = pass;
    if (row.kind === "price") {
      const base = this.symbolName.replace(/[-_/]?(USDT|USDC|USD1|USDS|BUSD|USD|EUR|PERP)$/i, "") || this.symbolName;
      const icon2 = tickerIconEl(doc, base || "P", this.symbolName || "Price", "vela-ot-avatar", this.symbolRaw ? this.iconFor?.(this.symbolRaw) : void 0);
      const el2 = this.row(icon2, row.label, row.visible, [
        {
          icon: row.visible ? "eye" : "eye-off",
          title: row.visible ? "Hide" : "Show",
          engaged: !row.visible,
          run: () => {
            chart.renderer.set("candleVisible", !row.visible);
            this.refresh();
          }
        }
      ]);
      el2.dataset.rowKind = "price";
      el2.dataset.pane = pane.id;
      if (pass.stackable) {
        el2.dataset.drag = "1";
        el2.title = "Drag to change what draws in front";
      }
      return el2;
    }
    const handle = pass.handle(row.id);
    const el = this.row(
      iconEl("indicators", doc),
      row.label,
      row.visible,
      [
        {
          icon: row.visible ? "eye" : "eye-off",
          title: row.visible ? "Hide" : "Show",
          engaged: !row.visible,
          run: () => {
            handle?.setVisible(!row.visible);
            this.refresh();
          }
        },
        {
          icon: "trash",
          title: "Remove",
          run: () => {
            handle?.remove();
            this.refresh();
          }
        }
      ],
      row.ownScale ? "scale" : void 0
    );
    el.dataset.rowKind = "indicator";
    el.dataset.id = row.id;
    el.dataset.pane = pane.id;
    if (pass.repanable || pass.stackable) {
      el.dataset.drag = "1";
      el.title = pass.repanable ? "Drag to another pane, or between panes for a new one" : "Drag to change what draws in front";
    }
    return el;
  }
  /** A group's header: fold arrow, its name (or the rename field), then actions that apply to
   *  every member at once. Reports "all hidden"/"all locked" rather than a mixed state.
   *
   * The state comes from the whole bundle, not from the members listed under this pane: should
   * a member end up on another pane, the header still speaks for the group its actions affect.
   */
  groupRow(pass, pane, g) {
    const doc = this.el.ownerDocument;
    const folded = this.collapsed.has(g.id);
    const members = pass.chart.drawings.all().filter((d) => g.ids.includes(d.id));
    const { allHidden, allLocked } = groupState(members);
    const ids = [...g.ids];
    const el = this.row(iconEl(folded ? "chevron-right" : "chevron-down", doc), g.name, !allHidden, [
      {
        icon: allLocked ? "lock" : "unlock",
        title: allLocked ? "Unlock all" : "Lock all",
        engaged: allLocked,
        run: () => this.setMembers(pass, ids, { locked: !allLocked })
      },
      {
        icon: allHidden ? "eye-off" : "eye",
        title: allHidden ? "Show all" : "Hide all",
        engaged: allHidden,
        run: () => this.setMembers(pass, ids, { visible: allHidden })
      },
      { icon: "trash", title: "Remove all", run: () => this.removeGroup(pass, g.id, true) }
    ]);
    el.dataset.rowKind = "group";
    el.dataset.id = g.id;
    el.dataset.pane = pane.id;
    el.title = `${members.length} drawing${members.length === 1 ? "" : "s"} \u2014 drag to move them together`;
    if (this.renaming === g.id) {
      const name = el.querySelector(".vela-ot-name");
      const input = doc.createElement("input");
      input.className = "vela-ot-rename";
      input.value = g.name;
      name?.replaceWith(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.commitRename(g.id, input.value);
        } else if (e.key === "Escape") {
          this.renaming = null;
          this.render();
        } else if (e.key === " ") e.stopPropagation();
      });
      input.addEventListener("blur", () => this.commitRename(g.id, input.value));
    } else {
      el.dataset.drag = "1";
      el.addEventListener("click", () => {
        if (folded) this.collapsed.delete(g.id);
        else this.collapsed.add(g.id);
        this.render();
      });
    }
    return el;
  }
  drawRow(pass, d, inGroup = false) {
    const doc = this.el.ownerDocument;
    const { chart } = pass;
    const markup = drawingMeta(d.type).icon;
    let icon2;
    if (markup) {
      icon2 = doc.createElement("span");
      icon2.className = "vela-icon";
      icon2.setAttribute("aria-hidden", "true");
      icon2.innerHTML = markup;
    } else {
      icon2 = iconEl("pen", doc);
    }
    const el = this.row(icon2, drawingLabel(d), d.visible, [
      {
        icon: d.locked ? "lock" : "unlock",
        title: d.locked ? "Unlock" : "Lock",
        engaged: d.locked,
        run: () => {
          chart.drawings.lock(d.id, !d.locked);
          this.refresh();
        }
      },
      {
        icon: d.visible ? "eye" : "eye-off",
        title: d.visible ? "Hide" : "Show",
        engaged: !d.visible,
        run: () => {
          chart.drawings.show(d.id, !d.visible);
          this.refresh();
        }
      },
      {
        icon: "trash",
        title: "Remove",
        run: () => {
          chart.drawings.remove(d.id);
          this.refresh();
        }
      }
    ]);
    el.dataset.rowKind = "drawing";
    el.dataset.id = d.id;
    el.dataset.pane = d.paneId;
    el.dataset.drag = "1";
    el.title = "Drag to restack, or onto another pane to move it there";
    if (inGroup) el.classList.add("vela-ot-subrow");
    if (this.selectedDrawings.has(d.id)) el.dataset.selected = "1";
    if (this.picked.has(d.id)) el.dataset.picked = "1";
    el.addEventListener("click", (e) => this.onDrawClick(e, d.id));
    return el;
  }
  /** Clicking a drawing picks it; holding the platform's modifier extends the pick, and
   *  clicking the only picked row clears it. The chart mirrors whatever comes out. */
  onDrawClick(e, id) {
    if (e.ctrlKey || e.metaKey) {
      if (this.picked.has(id)) this.picked.delete(id);
      else this.picked.add(id);
    } else if (this.picked.has(id) && this.picked.size === 1) {
      this.picked.clear();
    } else {
      this.picked.clear();
      this.picked.add(id);
    }
    this.selectOnChart([...this.picked]);
    this.render();
  }
  /** Push the panel's pick onto the chart, muting the `drawing:selected` echo it causes. */
  selectOnChart(ids) {
    const chart = this.chart;
    if (!chart?.drawings.supported) return;
    this.syncingSelection = true;
    try {
      chart.drawings.select(ids);
    } finally {
      this.syncingSelection = false;
    }
  }
  /** The shared row shell: icon, name, optional tag, then the action buttons. */
  row(icon2, label, visible, actions, tag) {
    const doc = this.el.ownerDocument;
    const el = doc.createElement("div");
    el.className = "vela-ot-row";
    if (!visible) el.dataset.hidden = "1";
    const name = doc.createElement("span");
    name.className = "vela-ot-name";
    name.textContent = label;
    name.title = label;
    el.append(icon2, name);
    if (tag) {
      const t = doc.createElement("span");
      t.className = "vela-ot-tag";
      t.textContent = tag;
      t.title = "Draws against its own price scale";
      el.appendChild(t);
    }
    const acts = doc.createElement("span");
    acts.className = "vela-ot-acts";
    for (const a of actions) acts.appendChild(this.btn(a));
    el.appendChild(acts);
    return el;
  }
  btn(a) {
    const doc = this.el.ownerDocument;
    const b = doc.createElement("button");
    b.className = "vela-ot-btn";
    b.dataset.icon = a.icon;
    if (a.engaged) b.dataset.engaged = "1";
    if (a.disabled) b.disabled = true;
    b.title = a.title;
    b.appendChild(iconEl(a.icon, doc));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!a.disabled) a.run();
    });
    return b;
  }
  // ── groups ─────────────────────────────────────────────────────────────
  // A group is the panel's own idea, not the chart's: it bundles drawings so they hide, lock,
  // delete and move as one. It lives as long as the panel does.
  /** Bundle drawings into a fresh group, which takes over the pick. */
  makeGroup(ids) {
    if (!canGroup(ids, this.groups)) return;
    this.groupSeq += 1;
    this.groups = [...this.groups, { id: `grp-${this.groupSeq}`, name: nextGroupName(this.groups), ids: [...ids] }];
    this.picked.clear();
    this.render();
  }
  commitRename(id, value) {
    if (this.renaming !== id) return;
    const name = value.trim();
    this.groups = this.groups.map((g) => g.id === id && name !== "" ? { ...g, name } : g);
    this.renaming = null;
    this.render();
  }
  /** Dissolve a group. `withMembers` also deletes the drawings it held. */
  removeGroup(pass, id, withMembers2) {
    const g = this.groups.find((x) => x.id === id);
    this.groups = this.groups.filter((x) => x.id !== id);
    this.collapsed.delete(id);
    if (withMembers2 && g) {
      for (const m of g.ids) this.picked.delete(m);
      pass.chart.drawings.removeMany(g.ids);
    }
    this.render();
  }
  /** Apply one patch to every member of a group as a single undo step. */
  setMembers(pass, ids, patch) {
    if (ids.length === 0) return;
    pass.chart.drawings.updateMany(ids.map((id) => ({ id, patch })));
    this.render();
  }
  /** Duplicate a drawing, keeping the copy in the same group as its original — the chart has
   *  no notion of our groups, so the new id has to be spotted and filed here. */
  cloneInto(pass, id) {
    const { chart } = pass;
    if (!chart.drawings.supported) return;
    const before = new Set(chart.drawings.all().map((d) => d.id));
    chart.drawings.clone(id);
    const clone = chart.drawings.all().find((d) => !before.has(d.id));
    const g = groupOf(this.groups, id);
    if (g && clone) this.groups = assignToGroup(this.groups, g.id, [clone.id]);
  }
  // ── drag-and-drop ──────────────────────────────────────────────────────
  // Indicator rows move between panes, into a fresh pane, or to a slot in the main pane's
  // stack. The candles restack in place. Drawing rows take a slot among their pane's
  // drawings, and land in another pane's list to move there.
  onPointerDown(e) {
    if (e.button !== 0 || this.drag) return;
    const target = e.target;
    if (target.closest(".vela-ot-btn")) return;
    const rowEl = target.closest(".vela-ot-row[data-drag]");
    if (!rowEl) return;
    if (target.closest(".vela-ot-rename")) return;
    const kind = rowEl.dataset.rowKind;
    if (kind !== "price" && kind !== "indicator" && kind !== "drawing" && kind !== "group") return;
    const win = this.el.ownerDocument.defaultView;
    if (!win) return;
    const drag = {
      kind,
      id: rowEl.dataset.id ?? null,
      fromPane: rowEl.dataset.pane ?? PRICE_PANE_ID,
      label: rowEl.querySelector(".vela-ot-name")?.textContent ?? "object",
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      ghost: null,
      drop: null,
      onMove: (ev) => this.onDragMove(ev),
      onUp: () => this.endDrag(true),
      onCancel: () => this.endDrag(false)
    };
    this.drag = drag;
    win.addEventListener("pointermove", drag.onMove);
    win.addEventListener("pointerup", drag.onUp);
    win.addEventListener("pointercancel", drag.onCancel);
    e.preventDefault();
  }
  onDragMove(e) {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_SLOP) return;
      this.beginDrag(drag);
    }
    if (drag.ghost) {
      drag.ghost.style.left = `${e.clientX + 12}px`;
      drag.ghost.style.top = `${e.clientY + 8}px`;
    }
    drag.drop = this.resolveDrop(drag, e.clientX, e.clientY);
    this.paintDropHint(drag.drop);
  }
  beginDrag(drag) {
    drag.active = true;
    this.body.dataset.dragging = "1";
    const src = this.sourceRow(drag);
    if (src) src.dataset.source = "1";
    const ghost = this.el.ownerDocument.createElement("div");
    ghost.className = "vela-ot-ghost";
    ghost.textContent = drag.label;
    this.uiHost().appendChild(ghost);
    drag.ghost = ghost;
  }
  /** The rendered row a session started from — scanned rather than selected, so an id
   *  carrying CSS-special characters needs no escaping. */
  sourceRow(drag) {
    for (const el of this.body.querySelectorAll(".vela-ot-row")) {
      if (el.dataset.rowKind !== drag.kind) continue;
      if (drag.id === null || el.dataset.id === drag.id) return el;
    }
    return null;
  }
  /** What a drop at this point would do. Measured off the live geometry, which is why a
   *  refresh is suspended for the duration of the drag. */
  resolveDrop(drag, x, y) {
    const pass = this.pass;
    if (!pass) return null;
    if (drag.kind === "indicator") {
      for (const gap of this.body.querySelectorAll(".vela-ot-gap")) {
        const r = gap.getBoundingClientRect();
        if (y >= r.top - 4 && y <= r.bottom + 4 && x >= r.left && x <= r.right) {
          return { kind: "newPane", before: gap.dataset.before, after: gap.dataset.after, el: gap };
        }
      }
    }
    for (const block of this.body.querySelectorAll(".vela-ot-pane")) {
      const r = block.getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      const paneId = block.dataset.pane ?? PRICE_PANE_ID;
      if (drag.kind === "price" && block.dataset.kind !== "price") return null;
      if (drag.kind === "indicator" && !pass.stackable) {
        return paneId === drag.fromPane ? null : { kind: "merge", paneId, el: block };
      }
      const els = [...block.querySelector(":scope > .vela-ot-stack")?.children ?? []];
      if (drag.kind === "drawing") {
        for (const unit of els) {
          const groupId = unit.dataset.group;
          if (groupId === void 0) continue;
          const ur = unit.getBoundingClientRect();
          if (y < ur.top || y > ur.bottom) continue;
          const subrows = [...unit.querySelectorAll(":scope > .vela-ot-subrow")];
          return { kind: "intoGroup", paneId, groupId, memberSlot: insertionSlot(subrows, y), subrows, el: unit };
        }
      }
      let slot = insertionSlot(els, y);
      if ((drag.kind === "drawing" || drag.kind === "group") && !pass.interleave) {
        const pane = pass.panes.find((p) => p.id === paneId);
        const lead = pane ? pane.items.findIndex((it) => it.kind === "row") : -1;
        if (lead >= 0) slot = Math.min(slot, lead);
      }
      return { kind: "slot", paneId, slot, els, el: block };
    }
    return null;
  }
  paintDropHint(drop) {
    for (const el of this.body.querySelectorAll("[data-drop]")) delete el.dataset.drop;
    if (!drop) return;
    if (drop.kind === "newPane") {
      drop.el.dataset.drop = "gap";
      return;
    }
    if (drop.kind === "merge") {
      drop.el.dataset.drop = "target";
      return;
    }
    if (drop.kind === "intoGroup") {
      drop.el.dataset.drop = "target";
      const at2 = drop.subrows[drop.memberSlot];
      if (at2) at2.dataset.drop = "before";
      else if (drop.subrows.length > 0) drop.subrows[drop.subrows.length - 1].dataset.drop = "after";
      return;
    }
    const at = drop.els[drop.slot];
    if (drop.els.length === 0) drop.el.dataset.drop = "target";
    else if (at) at.dataset.drop = "before";
    else drop.els[drop.els.length - 1].dataset.drop = "after";
  }
  /** Close the session out: `apply` false abandons the move (a cancelled pointer, a teardown). */
  endDrag(apply) {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    const win = this.el.ownerDocument.defaultView;
    win?.removeEventListener("pointermove", drag.onMove);
    win?.removeEventListener("pointerup", drag.onUp);
    win?.removeEventListener("pointercancel", drag.onCancel);
    if (!drag.active) return;
    drag.ghost?.remove();
    delete this.body.dataset.dragging;
    const src = this.sourceRow(drag);
    if (src) delete src.dataset.source;
    this.paintDropHint(null);
    if (apply && drag.drop) this.applyDrop(drag, drag.drop);
    this.refresh();
  }
  applyDrop(drag, drop) {
    const pass = this.pass;
    if (!pass) return;
    const { chart } = pass;
    switch (drop.kind) {
      case "merge":
        if (drag.id !== null && drop.paneId !== drag.fromPane) {
          chart.panes.moveIndicator(drag.id, drop.paneId === PRICE_PANE_ID ? "price" : { pane: drop.paneId });
        }
        return;
      case "newPane": {
        const from = pass.panes.find((p) => p.id === drag.fromPane);
        const alone = from !== void 0 && from.kind !== "price" && paneRows(from).length <= 1;
        if (alone && (drop.before === drag.fromPane || drop.after === drag.fromPane)) return;
        if (drag.id !== null) chart.panes.moveIndicator(drag.id, { newPane: { before: drop.before, after: drop.after } });
        return;
      }
      case "slot":
      case "intoGroup":
        this.applySlotDrop(pass, drag, drop);
        return;
    }
  }
  /**
   * Land a drop in a pane's stack: place the dragged tokens (the candles, an indicator, a
   * drawing, or a group's whole run of drawings) at the measured position, then renormalize
   * the pane's z keys in one sweep — `candleZOrder`/`seriesOrder` for the series, a single
   * `updateMany` (one undo step) for the drawings, re-paning the ones that crossed panes.
   */
  applySlotDrop(pass, drag, drop) {
    const { chart } = pass;
    const target = pass.panes.find((p) => p.id === drop.paneId);
    if (!target) return;
    const isDrawing = drag.kind === "drawing" || drag.kind === "group";
    if (isDrawing && !chart.drawings.supported) return;
    const dragged = drag.kind === "price" ? [{ kind: "price" }] : drag.kind === "indicator" ? [{ kind: "indicator", id: drag.id }] : this.draggedDrawings(pass, drag).map((id) => ({ kind: "drawing", id }));
    if (dragged.length === 0 || drag.kind !== "price" && drag.id === null) return;
    if (drag.kind === "indicator" && drag.fromPane !== drop.paneId) {
      chart.panes.moveIndicator(drag.id, drop.paneId === PRICE_PANE_ID ? "price" : { pane: drop.paneId });
    }
    const tokens = paneTokens(target);
    const at = drop.kind === "intoGroup" ? groupTokenIndex(target, drop.groupId, drop.memberSlot) : tokenIndexOfSlot(target, drop.slot);
    const placed = placeTokens(tokens, dragged, at);
    if (drag.kind === "drawing") {
      this.groups = drop.kind === "intoGroup" ? assignToGroup(this.groups, drop.groupId, [drag.id]) : removeFromGroups(this.groups, [drag.id]);
    }
    const live = new Map(chart.drawings.all().map((d) => [d.id, d]));
    const draggedIds = new Set(dragged.flatMap((t) => t.kind === "drawing" ? [t.id] : []));
    const repaned = [...draggedIds].some((id) => live.get(id)?.paneId !== drop.paneId);
    if (tokensEqual(tokens, placed) && !repaned) return;
    this.writeStack(pass, drop.paneId, placed, draggedIds);
  }
  /** Renormalize one pane's z keys from a placed token stack: the series through the
   *  renderer's order settings, the drawings as ONE `updateMany` (a single undo step),
   *  re-paning the dragged ones that arrived from another pane. */
  writeStack(pass, paneId, placed, draggedIds) {
    const { chart } = pass;
    const live = new Map(chart.drawings.all().map((d) => [d.id, d]));
    const writes = stackWrites(placed);
    if (pass.stackable) {
      if (writes.candleZ !== null) chart.renderer.set("candleZOrder", writes.candleZ);
      for (const s of writes.series) chart.renderer.set("seriesOrder", { id: s.id, z: s.z });
    }
    if (writes.drawings.length > 0) {
      chart.drawings.updateMany(
        writes.drawings.map(({ id, z }) => ({
          id,
          patch: { zIndex: z, ...draggedIds.has(id) && live.get(id)?.paneId !== paneId ? { paneId } : {} }
        }))
      );
    }
  }
  /** Move a group's whole run to an end of its pane's stack — the menu twin of dragging it
   *  to the top or the bottom of the column. */
  restackGroup(pass, g, edge) {
    const member = new Set(g.ids);
    const mine = pass.chart.drawings.all().filter((d) => member.has(d.id));
    const paneId = mine[0]?.paneId ?? PRICE_PANE_ID;
    const target = pass.panes.find((p) => p.id === paneId) ?? pass.panes.find((p) => p.kind === "price");
    if (!target || mine.length === 0) return;
    const dragged = mine.map((d) => ({ kind: "drawing", id: d.id })).reverse();
    const tokens = paneTokens(target);
    const placed = placeTokens(tokens, dragged, edge === "front" ? 0 : tokens.length);
    if (tokensEqual(tokens, placed)) return;
    this.writeStack(pass, target.id, placed, /* @__PURE__ */ new Set());
    this.refresh();
  }
  /** The drawings a session moves: a group carries every member, front-most first, so the
   *  bundle keeps its own stacking wherever it lands. */
  draggedDrawings(pass, drag) {
    if (drag.id === null) return [];
    if (drag.kind !== "group") return [drag.id];
    const g = this.groups.find((x) => x.id === drag.id);
    if (!g) return [];
    const member = new Set(g.ids);
    return pass.chart.drawings.all().filter((d) => member.has(d.id)).map((d) => d.id).reverse();
  }
  // ── context menus ──────────────────────────────────────────────────────
  // Right-clicking a row opens the same actions its buttons expose, plus the ones with no
  // room on a row: re-paning an indicator, and reordering what draws in front.
  onContextMenu(e) {
    const pass = this.pass;
    if (!pass) return;
    const rowEl = e.target.closest(".vela-ot-row");
    if (!rowEl) return;
    e.preventDefault();
    const b = new MenuBuilder();
    const items = this.itemsForRow(b, pass, rowEl);
    if (items.length === 0) return;
    this.menuActions = b.actions;
    const menu = this.ensureMenu();
    menu.setItems(items);
    menu.openAt(e.clientX, e.clientY);
  }
  itemsForRow(b, pass, rowEl) {
    const paneId = rowEl.dataset.pane ?? PRICE_PANE_ID;
    const id = rowEl.dataset.id;
    switch (rowEl.dataset.rowKind) {
      case "price":
        return this.priceMenu(b, pass);
      case "indicator": {
        const row = id === void 0 ? void 0 : this.findIndicatorRow(pass, id);
        return row ? this.indicatorMenu(b, pass, row, paneId) : [];
      }
      case "drawing": {
        const d = id === void 0 ? void 0 : pass.chart.drawings.all().find((x) => x.id === id);
        return d ? this.drawingMenu(b, pass, d) : [];
      }
      case "group": {
        const g = id === void 0 ? void 0 : this.groups.find((x) => x.id === id);
        return g ? this.groupMenu(b, pass, g) : [];
      }
      default:
        return [];
    }
  }
  /** The nearest kit host, which is where anything floating has to mount: outside it the
   *  theme's custom properties don't resolve and the surface renders unstyled. */
  uiHost() {
    return this.el.closest(".vela-ui") ?? this.el;
  }
  /** The menu, built on first use — by then the panel is mounted, so the theme host resolves. */
  ensureMenu() {
    if (!this.menu) {
      this.menu = new Menu({ host: this.uiHost(), items: [], onSelect: (id) => this.menuActions.get(id)?.() });
    }
    return this.menu;
  }
  findIndicatorRow(pass, id) {
    for (const pane of pass.panes) {
      for (const row of paneRows(pane)) if (row.kind === "indicator" && row.id === id) return row;
    }
    return void 0;
  }
  priceMenu(b, pass) {
    const { chart } = pass;
    const visible = chart.renderer.get("candleVisible") !== false;
    const items = [
      b.entry(visible ? "Hide" : "Show", visible ? "eye-off" : "eye", () => {
        chart.renderer.set("candleVisible", !visible);
        this.refresh();
      })
    ];
    if (pass.stackable) {
      items.push(
        b.entry("Bring to front", "arrow-up", () => {
          chart.renderer.set("candleZOrder", this.stackBounds(pass, PRICE_PANE_ID).top + 1);
          this.refresh();
        }, true)
      );
      items.push(
        b.entry("Send to back", "arrow-down", () => {
          chart.renderer.set("candleZOrder", this.stackBounds(pass, PRICE_PANE_ID).bottom - 1);
          this.refresh();
        })
      );
    }
    return items;
  }
  /** The pane's stacking extremes as of now — what a front/back command has to beat. The z
   *  keys are plain numbers, not commands, so the writer beats the extremes itself; with a
   *  shared draw-order space the drawings' keys count too. */
  stackBounds(pass, paneId) {
    const { chart } = pass;
    const drawingZ = pass.interleave ? chart.drawings.all().filter((d) => d.paneId === paneId).map((d) => d.zIndex) : [];
    return zStackBounds(
      chart.renderer.get("seriesOrder") ?? [],
      Number(chart.renderer.get("candleZOrder")) || 0,
      drawingZ
    );
  }
  indicatorMenu(b, pass, row, paneId) {
    const { chart } = pass;
    const handle = pass.handle(row.id);
    const items = [
      b.entry(row.visible ? "Hide" : "Show", row.visible ? "eye-off" : "eye", () => {
        handle?.setVisible(!row.visible);
        this.refresh();
      })
    ];
    if (chart.renderer.supportsIndicatorSettings) {
      items.push(b.entry("Indicator settings", "gear", () => chart.renderer.openIndicatorSettings(row.id)));
    }
    if (chart.panes.supported) {
      const moves = this.moveItems(b, pass, row.id, paneId);
      if (moves.length > 0) items.push(b.submenu("Move to", "move-vertical", moves));
    }
    if (pass.stackable) {
      items.push(b.entry("Bring to front", "arrow-up", () => chart.renderer.set("seriesOrder", { id: row.id, z: this.stackBounds(pass, paneId).top + 1 }), true));
      items.push(b.entry("Send to back", "arrow-down", () => chart.renderer.set("seriesOrder", { id: row.id, z: this.stackBounds(pass, paneId).bottom - 1 })));
    }
    items.push(
      b.entry("Remove", "trash", () => {
        handle?.remove();
        this.refresh();
      }, true)
    );
    return items;
  }
  /** "Move to …" entries for an indicator — only the moves that would change something. */
  moveItems(b, pass, id, fromPane) {
    const { chart } = pass;
    const items = [];
    for (const p of pass.panes) {
      if (p.id === fromPane) continue;
      items.push(b.entry(p.label, void 0, () => chart.panes.moveIndicator(id, p.kind === "price" ? "price" : { pane: p.id })));
    }
    const current = pass.panes.find((p) => p.id === fromPane);
    const alone = current !== void 0 && current.kind !== "price" && paneRows(current).length <= 1;
    if (!alone) {
      if (fromPane !== PRICE_PANE_ID) items.push(b.entry("New pane above", void 0, () => chart.panes.moveIndicator(id, { newPane: { before: fromPane } })));
      items.push(b.entry("New pane below", void 0, () => chart.panes.moveIndicator(id, { newPane: { after: fromPane } })));
    }
    return items;
  }
  drawingMenu(b, pass, d) {
    const { chart } = pass;
    const items = [
      b.entry(d.visible ? "Hide" : "Show", d.visible ? "eye-off" : "eye", () => {
        chart.drawings.show(d.id, !d.visible);
        this.refresh();
      }),
      b.entry(d.locked ? "Unlock" : "Lock", d.locked ? "unlock" : "lock", () => {
        chart.drawings.lock(d.id, !d.locked);
        this.refresh();
      }),
      b.entry("Duplicate", "clone", () => {
        this.cloneInto(pass, d.id);
        this.render();
      }),
      // Front/back clear the WHOLE stack on a shared-z renderer — over or under the
      // candles and every indicator, not just the other drawings.
      b.entry("Bring to front", "arrow-up", () => chart.drawings.bringToFront(d.id), true),
      b.entry("Send to back", "arrow-down", () => chart.drawings.sendToBack(d.id))
    ];
    items.push(...this.groupingItems(b, d.id));
    items.push(b.entry("Remove", "trash", () => chart.drawings.remove(d.id), true));
    return items;
  }
  /** The grouping half of a drawing's menu: what it can do about the bundle it is (or isn't)
   *  part of. Only the moves that mean something for this row are offered. */
  groupingItems(b, id) {
    const items = [];
    const mine = groupOf(this.groups, id);
    const pick = this.picked.has(id) && this.picked.size > 1 ? [...this.picked] : null;
    if (pick && canGroup(pick, this.groups)) {
      items.push(b.entry(`Group selection (${pick.length})`, "group", () => this.makeGroup(pick), true));
    } else if (!pick && mine === null) {
      items.push(b.entry("New group", "group", () => this.makeGroup([id]), true));
    }
    const others = this.groups.filter((g) => g.id !== mine?.id);
    if (!pick && others.length > 0) {
      items.push(
        b.submenu(
          mine === null ? "Add to group" : "Move to group",
          "folder-plus",
          others.map(
            (g) => b.entry(g.name, void 0, () => {
              this.groups = assignToGroup(this.groups, g.id, [id]);
              this.render();
            })
          ),
          items.length === 0
        )
      );
    }
    if (mine !== null) {
      items.push(
        b.entry(`Remove from ${mine.name}`, "folder-minus", () => {
          this.groups = removeFromGroups(this.groups, [id]);
          this.render();
        }, items.length === 0)
      );
    }
    return items;
  }
  groupMenu(b, pass, g) {
    const ids = [...g.ids];
    const members = pass.chart.drawings.all().filter((d) => g.ids.includes(d.id));
    const { allHidden, allLocked } = groupState(members);
    const items = [
      b.entry("Rename\u2026", "pen", () => {
        this.renaming = g.id;
        this.render();
      }),
      b.entry(allHidden ? "Show all" : "Hide all", allHidden ? "eye" : "eye-off", () => this.setMembers(pass, ids, { visible: allHidden }), true),
      b.entry(allLocked ? "Unlock all" : "Lock all", allLocked ? "unlock" : "lock", () => this.setMembers(pass, ids, { locked: !allLocked })),
      b.entry("Select all", "group", () => {
        this.picked = new Set(ids);
        this.selectOnChart(ids);
        this.render();
      })
    ];
    if (members.length > 0) {
      items.push(b.entry("Bring all to front", "arrow-up", () => this.restackGroup(pass, g, "front")));
      items.push(b.entry("Send all to back", "arrow-down", () => this.restackGroup(pass, g, "back")));
    }
    items.push(b.entry("Ungroup", "ungroup", () => this.removeGroup(pass, g.id, false), true));
    items.push(b.entry("Remove all", "trash", () => this.removeGroup(pass, g.id, true)));
    return items;
  }
  /** Forget everything that refers to a drawing or group the chart no longer has — otherwise a
   *  deleted drawing would keep a group alive, or stay counted in the selection bar. */
  prune(chart) {
    const live = new Set((chart.drawings.supported ? chart.drawings.all() : []).map((d) => d.id));
    for (const id of [...this.picked]) if (!live.has(id)) this.picked.delete(id);
    if (this.groups.length === 0) {
      this.renaming = null;
      return;
    }
    this.groups = pruneGroups(this.groups, live);
    if (this.renaming !== null && !this.groups.some((g) => g.id === this.renaming)) this.renaming = null;
  }
};

// src/widget/data-window.ts
var STYLE_ID5 = "vela-widget-datawindow";
var CSS5 = `
.vela-dw-group {
    padding: 10px 8px 4px;
    margin-top: 4px;
    border-top: 1px solid var(--vela-border);
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.vela-dw-group:first-child { border-top: none; margin-top: 0; padding-top: 8px; }
/* The readout is DATA, not chrome: selectable (an exception to the UI-wide
   user-select:none) so values can be copied out. The panel header stays chrome. */
.vela-dw-group, .vela-dw-row { user-select: text; -webkit-user-select: text; cursor: text; }
.vela-dw-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 8px;
    border-radius: 4px;
}
.vela-dw-row:hover { background: var(--vela-hover); }
.vela-dw-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vela-fg-bright); }
.vela-dw-value { margin-left: auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
.vela-dw-empty { padding: 20px 10px; text-align: center; color: var(--vela-fg-muted); font-size: 12px; }
`;
var REFRESH_EVENTS2 = ["bar", "context:changed", "indicator:added", "indicator:removed", "indicator:visibility", "indicator:moved", "pane:changed", "market:changed", "history:complete"];
var EM_DASH = "\u2014";
function dataWindowSections(readout) {
  const sections = [];
  if (readout.date || readout.time) {
    sections.push({
      title: "Time",
      lines: [
        { label: "Date", value: readout.date || EM_DASH, color: "" },
        { label: "Time", value: readout.time || EM_DASH, color: "" }
      ]
    });
  }
  const { ohlc } = readout;
  if (ohlc) {
    const color = ohlc.up ? "var(--vela-up)" : "var(--vela-down)";
    const lines = [
      { label: "Open", value: ohlc.o, color },
      { label: "High", value: ohlc.h, color },
      { label: "Low", value: ohlc.l, color },
      { label: "Close", value: ohlc.c, color }
    ];
    if (ohlc.vol !== void 0) lines.push({ label: "Volume", value: ohlc.vol, color });
    sections.push({ title: "Price", lines });
  }
  for (const group of readout.groups) {
    sections.push({ title: group.name, lines: group.rows.map((r) => ({ label: r.label, value: r.value, color: r.color })) });
  }
  return sections;
}
var DataWindow = class extends SidePanel {
  constructor(host) {
    super(host, "Data window", "vela-dw");
    this.chart = null;
    this.unsubs = [];
    injectStyles(STYLE_ID5, CSS5, host.ownerDocument);
  }
  toggle(open = !this.open, instant = false) {
    super.toggle(open, instant);
    if (open) this.refresh();
  }
  /** (Re)bind to a chart instance — called after every widget rebuild. */
  onChart(chart) {
    this.detach();
    this.chart = chart;
    for (const ev of REFRESH_EVENTS2) this.unsubs.push(chart.on(ev, () => this.refresh()));
    this.unsubs.push(chart.renderer.onCrosshairMove(() => this.refresh()));
    this.refresh();
  }
  destroy() {
    this.detach();
    super.destroy();
  }
  detach() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.chart = null;
  }
  refresh() {
    if (this.el.hidden || !this.chart) return;
    const doc = this.el.ownerDocument;
    const readout = this.chart.renderer.dataWindowReadout();
    this.body.replaceChildren();
    const sections = readout ? dataWindowSections(readout) : [];
    if (sections.length === 0) {
      const empty = doc.createElement("div");
      empty.className = "vela-dw-empty";
      empty.textContent = readout ? "No data" : "This renderer provides no data readout.";
      this.body.appendChild(empty);
      return;
    }
    for (const section of sections) {
      const head = doc.createElement("div");
      head.className = "vela-dw-group";
      head.textContent = section.title;
      this.body.appendChild(head);
      for (const line of section.lines) {
        const row = doc.createElement("div");
        row.className = "vela-dw-row";
        const label = doc.createElement("span");
        label.className = "vela-dw-label";
        label.textContent = line.label;
        const value = doc.createElement("span");
        value.className = "vela-dw-value";
        value.textContent = line.value;
        if (line.color) value.style.color = line.color;
        row.append(label, value);
        this.body.appendChild(row);
      }
    }
  }
};

// src/widget/panel-dock.ts
var PanelDock = class {
  constructor(host, deps) {
    this.host = host;
    this.deps = deps;
    this.entries = [];
    /** Widths the USER settled, by panel id — the only ones worth persisting. */
    this.widths = /* @__PURE__ */ new Map();
    /** Floating panels the USER pinned as columns, by id — remembered for late registrations too. */
    this.pinned = /* @__PURE__ */ new Set();
    /** A restored `open` naming a panel that has not registered yet: honored when it docks. */
    this.pendingOpen = null;
    this.chart = null;
  }
  /** Dock a panel the shell owns (created and destroyed by it). */
  addBuiltIn(entry) {
    this.add({ ...entry, contributed: false });
  }
  /**
   * (Re)build the CONTRIBUTED panels from the registry — call once after the built-ins, and
   * again on `refreshActions()` so a late registration appears. Contributed panels that are
   * gone from the registry are dropped and a REPLACED descriptor is rebuilt; a panel whose
   * descriptor is unchanged stays mounted as it is, so its content and state survive.
   */
  refresh() {
    const openBefore = this.openId;
    const registered = sidePanels();
    for (const entry of [...this.entries]) if (entry.contributed && !registered.includes(entry.desc)) this.drop(entry);
    for (const desc of registered) {
      if (this.entries.some((e) => e.desc === desc)) continue;
      const panel = new SidePanel(this.host, desc.title, `vela-panel-${desc.id}`, {
        width: desc.width,
        resizable: desc.resizable,
        minWidth: desc.minWidth,
        maxWidth: desc.maxWidth,
        overlay: desc.overlay,
        maximizable: desc.maximizable
      });
      const entry = {
        id: desc.id,
        title: desc.title,
        icon: desc.icon,
        order: desc.order ?? DEFAULT_PANEL_ORDER,
        panel,
        contributed: true,
        desc
      };
      try {
        const header = {
          slot: panel.headerSlot,
          setTitle: (t) => panel.setTitle(t),
          get maximized() {
            return panel.maximized;
          },
          setMaximized: (on) => panel.setMaximized(on)
        };
        entry.handle = desc.mount(this.deps.context(), panel.content, header) ?? void 0;
        if (this.chart) entry.handle?.onChart?.(this.chart);
      } catch (err) {
        console.warn(`[vela] side panel "${desc.id}" failed to mount`, err);
      }
      this.add(entry);
    }
    if (openBefore && !this.openId) this.toggle(openBefore, true);
    this.publish();
  }
  /** Bind (or rebind) every docked panel to a chart instance. */
  onChart(chart) {
    this.chart = chart;
    for (const entry of this.entries) {
      if (entry.onChart) entry.onChart(chart);
      entry.handle?.onChart?.(chart);
    }
  }
  /** Open/close one panel by id — a bare call flips it. Unknown ids are ignored. */
  toggle(id, open) {
    this.entries.find((e) => e.id === id)?.panel.toggle(open);
  }
  /** The open panel's id, or null when the column is closed. */
  get openId() {
    return this.entries.find((e) => e.panel.open)?.id ?? null;
  }
  /** The docked panels in dock order — what a non-topbar chrome (the mobile
   *  three-dots drawer) lists so every panel stays reachable there too. */
  list() {
    return this.entries.map((e) => ({ id: e.id, title: e.title, icon: e.icon }));
  }
  /** The dock's persistable state, or null when there is nothing worth saving. */
  getState() {
    const out = {};
    const open = this.openId;
    if (open) out.open = open;
    if (this.widths.size > 0) out.widths = Object.fromEntries(this.widths);
    if (this.pinned.size > 0) out.pinned = [...this.pinned];
    return out.open || out.widths || out.pinned ? out : null;
  }
  /**
   * Restore a persisted dock state. Widths apply to any panel present, and are remembered for
   * panels that register later; `open` opens that panel, and its absence closes the column —
   * a document that predates the dock has no `panels` field at all, so the shell never calls
   * this and the default (everything closed) stands. An `open` naming a panel that has not
   * registered yet is held until it docks (a plugin loaded after the restore), unless the user
   * opens something in the meantime. `pinned` is the whole list of floating panels the user
   * docked — its absence means none is, so every floatable panel floats again.
   */
  applyState(state) {
    if (!state) return;
    if (state.widths) {
      for (const [id, px] of Object.entries(state.widths)) {
        this.widths.set(id, px);
        this.entries.find((e) => e.id === id)?.panel.setWidth(px);
      }
    }
    this.pinned = new Set(state.pinned ?? []);
    for (const entry of this.entries) entry.panel.setOverlay(!this.pinned.has(entry.id));
    for (const entry of this.entries) entry.panel.toggle(entry.id === state.open, true);
    this.pendingOpen = state.open && !this.entries.some((e) => e.id === state.open) ? state.open : null;
  }
  /** Drop the contributed panels (the shell destroys its own). */
  destroy() {
    for (const entry of [...this.entries]) if (entry.contributed) this.drop(entry);
    this.entries.length = 0;
  }
  add(entry) {
    this.entries.push(entry);
    this.entries.sort((a, b) => a.order - b.order);
    const stored = this.widths.get(entry.id);
    if (stored !== void 0) entry.panel.setWidth(stored);
    if (this.pinned.has(entry.id)) entry.panel.setOverlay(false);
    entry.panel.onOpenChange = (open) => {
      if (open) {
        for (const other of this.entries) if (other !== entry) other.panel.toggle(false, true);
        this.pendingOpen = null;
      }
      this.deps.chrome.setPanelActive(entry.id, open);
      if (open) entry.handle?.onOpen?.();
      this.deps.changed?.();
    };
    entry.panel.onWidthChange = (px) => {
      this.widths.set(entry.id, px);
      this.deps.changed?.();
    };
    entry.panel.onPlacementChange = (overlay) => {
      if (overlay) this.pinned.delete(entry.id);
      else this.pinned.add(entry.id);
      this.deps.changed?.();
    };
    if (this.pendingOpen === entry.id) entry.panel.toggle(true);
    if (!entry.contributed) this.publish();
  }
  drop(entry) {
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
    try {
      entry.handle?.destroy?.();
    } catch (err) {
      console.warn(`[vela] side panel "${entry.id}" failed to release`, err);
    }
    entry.panel.destroy();
  }
  /** Push the current toggle group to the chrome, pressed states included. */
  publish() {
    const buttons = this.entries.map((e) => ({ id: e.id, title: e.title, icon: e.icon }));
    this.deps.chrome.setPanelButtons(buttons, (id) => this.toggle(id));
    for (const entry of this.entries) this.deps.chrome.setPanelActive(entry.id, entry.panel.open);
  }
};

// src/widget/symbol-picker.ts
function dedupeSymbols(list) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const s of list) {
    const key = `${(s.prefix ?? s.provider ?? "").toLowerCase()}:${s.ticker.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
function foldGroups(list) {
  const groupsAbove = /* @__PURE__ */ new Set();
  const out = [];
  for (const s of list) {
    if (isGroupRow(s)) {
      groupsAbove.add(groupKeyOf(s));
      out.push(s);
    } else if (s.group == null || !groupsAbove.has(groupKeyOf(s))) out.push(s);
  }
  return out;
}
var TOP_TICKERS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
function parseQuery(raw, venues) {
  const m = raw.match(/^\s*([^\s:]+)\s*[:\s]\s*(.*)$/);
  if (m) {
    const t = m[1].toLowerCase();
    const scope = venues.includes(t) ? t : onlyOne(venues.filter((v) => v.startsWith(t)));
    if (scope) return { scope, term: m[2].trim() };
  }
  return { scope: null, term: raw.trim() };
}
function onlyOne(matches) {
  return matches.length === 1 ? matches[0] : null;
}
var venueOf = (s) => s.prefix ?? s.provider;
function filterSymbols(list, query, limit = 100, top = TOP_TICKERS) {
  const venues = [...new Set(list.flatMap((s) => [venueOf(s)?.toLowerCase(), s.provider?.toLowerCase()]).filter((p) => !!p))];
  const { scope, term } = parseQuery(query, venues);
  const pool = scope ? list.filter((s) => venueOf(s)?.toLowerCase() === scope || s.provider?.toLowerCase() === scope) : list;
  const q = term.toUpperCase();
  if (!q) {
    if (scope) return [...pool].sort((a, b) => a.ticker.localeCompare(b.ticker)).slice(0, limit);
    if (top === false) return pool.slice(0, limit);
    const byTicker = new Map(pool.map((s) => [s.ticker.toUpperCase(), s]));
    const pinned = top.map((t) => byTicker.get(t)).filter((s) => s !== void 0);
    const rest = pool.filter((s) => !top.includes(s.ticker.toUpperCase()));
    return [...pinned, ...rest].slice(0, limit);
  }
  const qLower = term.toLowerCase();
  const prefix = [];
  const substr = [];
  const desc = [];
  const venue = [];
  for (const s of pool) {
    const t = s.ticker.toUpperCase();
    if (t.startsWith(q)) prefix.push(s);
    else if (t.includes(q)) substr.push(s);
    else if ((s.description ?? "").toUpperCase().includes(q)) desc.push(s);
    else if (!scope && (venueOf(s)?.toLowerCase().includes(qLower) || s.provider?.toLowerCase().includes(qLower))) venue.push(s);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...substr, ...desc, ...venue].slice(0, limit);
}
var STYLE_ID6 = "vela-widget-symbolpicker";
var CSS6 = `
/* The dialog body is flush (a flex column): search + market tabs are a fixed head
   and the result list is the ONLY scroller, in both layouts. A sticky head over a
   scrolling padded body is not an option \u2014 browsers pin sticky boxes to the
   scroller's content box, so the head lands one padding below the top and covers
   the first row. */
.vela-sp-head { flex: none; padding: var(--vela-space-4) var(--vela-space-4) 0; }
.vela-sp-searchrow {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
}
.vela-sp-searchrow:focus-within { border-color: var(--vela-border-strong); }
.vela-sp-searchrow .vela-icon { color: var(--vela-fg-muted); }
.vela-sp-input {
    flex: 1;
    background: transparent;
    color: var(--vela-fg);
    border: none;
    font-size: 14px;
    outline: none;
    text-transform: uppercase;
}
.vela-sp-input::placeholder { text-transform: none; }
.vela-sp-tabs { display: flex; gap: 14px; margin: 12px 2px 0; border-bottom: 1px solid var(--vela-border); padding-bottom: 8px; }
/* Mobile (fullscreen dialog): the asset-class strip scrolls sideways instead of
   overflowing the body, and the result list stops capping itself \u2014 it fills the
   rest of the screen. The bottom inset (+ safe area) is the kit's: every mobile
   dialog body carries it, flush or not, so the list adds none of its own. */
[data-layout='mobile'] .vela-sp-tabs { overflow-x: auto; scrollbar-width: none; gap: 6px; }
[data-layout='mobile'] .vela-sp-tabs::-webkit-scrollbar { display: none; }
[data-layout='mobile'] .vela-sp-tab { flex: none; padding: 7px 10px; }
[data-layout='mobile'] .vela-sp-list { flex: 1 1 auto; max-height: none; margin-bottom: 0; }
.vela-sp-tab {
    all: unset;
    padding: 3px 10px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 13px;
    font-weight: 600;
}
.vela-sp-tab:hover { color: var(--vela-fg); }
.vela-sp-tab[data-active] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-sp-list {
    min-height: 0;
    margin: var(--vela-space-2) var(--vela-space-4) var(--vela-space-4);
    max-height: 46vh;
    overflow: auto;
}
.vela-sp-list::-webkit-scrollbar { width: 8px; }
.vela-sp-list::-webkit-scrollbar-thumb {
    background: var(--vela-scroll);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
}
.vela-sp-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 10px;
    border-radius: 8px;
    cursor: pointer;
}
.vela-sp-row:hover, .vela-sp-row[data-highlighted] { background: var(--vela-hover); }
.vela-sp-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vela-fg-on-fill);
    font-size: var(--vela-font-size-md);
    font-weight: 700;
}
.vela-sp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-sp-ticker { font-weight: 700; color: var(--vela-fg-bright); font-size: 14px; text-transform: uppercase; }
.vela-sp-desc { color: var(--vela-fg-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-sp-badge {
    flex: none;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
/* Provider brand marks \u2014 fixed by the venue, deliberately outside the theme palette. */
.vela-sp-badge[data-p='binance'] { color: #f0b90b; } /* palette-exempt: venue brand mark */
.vela-sp-badge[data-p='hyperliquid'] { color: #50d2c1; } /* palette-exempt: venue brand mark */
.vela-sp-empty { padding: var(--vela-space-3); color: var(--vela-fg-muted); text-align: center; }
/* Grouped listings (futures roots): the chevron unfolds members inline, indented. */
.vela-sp-expander {
    all: unset;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--vela-fg-muted);
}
.vela-sp-expander:hover { background: var(--vela-surface-elev); color: var(--vela-fg); }
.vela-sp-row[data-member] { padding-left: 34px; }
`;
var PAGE = 100;
var SymbolPicker = class {
  constructor(opts) {
    this.opts = opts;
    this.source = () => [];
    this.rows = [];
    this.highlighted = 0;
    this.seed = "";
    this.activeTab = "All";
    this.visible = PAGE;
    /** The last filter pass returned fewer raw rows than asked — the pool is drained
     *  (checked BEFORE folding: folding shortens pages without meaning exhaustion). */
    this.exhausted = false;
    /** Group rows currently expanded (venue-scoped keys) — members shown inline. */
    this.expanded = /* @__PURE__ */ new Set();
    /** The ranked pool cache — `key` fingerprints the raw pool the ranking ran on. */
    this.ranked = null;
    this.ranking = false;
    const doc = (opts.host ?? document.body).ownerDocument;
    injectStyles(STYLE_ID6, CSS6, doc);
    this.input = doc.createElement("input");
    this.input.className = "vela-sp-input";
    this.input.placeholder = "Search symbol\u2026";
    this.input.setAttribute("spellcheck", "false");
    const searchRow = doc.createElement("div");
    searchRow.className = "vela-sp-searchrow";
    searchRow.append(iconEl("search", doc), this.input);
    this.tabs = doc.createElement("div");
    this.tabs.className = "vela-sp-tabs";
    const head = doc.createElement("div");
    head.className = "vela-sp-head";
    for (const t of ["All", "Stocks", "ETFs", "Crypto", "Futures", "Forex", "Commodities"]) {
      const b = doc.createElement("button");
      b.className = "vela-sp-tab";
      b.textContent = t;
      if (t === this.activeTab) b.dataset.active = "1";
      b.addEventListener("click", () => {
        this.activeTab = t;
        for (const c of this.tabs.children) delete c.dataset.active;
        b.dataset.active = "1";
        this.refresh();
      });
      this.tabs.appendChild(b);
    }
    head.append(searchRow, this.tabs);
    this.list = doc.createElement("div");
    this.list.className = "vela-sp-list";
    this.list.addEventListener("scroll", () => {
      if (this.exhausted) return;
      if (this.list.scrollTop + this.list.clientHeight < this.list.scrollHeight - 200) return;
      this.visible += PAGE;
      this.grow();
    });
    this.dialog = new Dialog({
      title: "Symbol Search",
      host: opts.host,
      closeOnInteractOutside: true,
      flush: true,
      content: (body) => body.append(head, this.list),
      onOpenChange: (open) => {
        if (open) {
          this.input.value = this.seed.toUpperCase();
          this.seed = "";
          this.refresh();
          setTimeout(() => {
            this.input.focus();
            this.input.setSelectionRange(this.input.value.length, this.input.value.length);
          }, 0);
        } else {
          this.input.blur();
        }
        opts.onOpenChange?.(open);
      }
    });
    this.input.addEventListener("input", () => {
      const next = this.input.value.toUpperCase();
      if (this.input.value !== next) {
        const start = this.input.selectionStart;
        const end = this.input.selectionEnd;
        this.input.value = next;
        if (start != null && end != null) this.input.setSelectionRange(start, end);
      }
      this.refresh();
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") this.moveHighlight(1);
      else if (e.key === "ArrowUp") this.moveHighlight(-1);
      else if (e.key === "Enter") {
        const pick = this.rows[this.highlighted];
        if (pick) this.pick(pick);
        return;
      } else return;
      e.preventDefault();
    });
    this.list.addEventListener("click", (e) => {
      const target = e.target;
      const row = target.closest(".vela-sp-row");
      if (!row) return;
      const s = this.rows[Number(row.dataset.i)];
      if (!s) return;
      if (target.closest(".vela-sp-expander")) this.toggleExpand(s);
      else this.pick(s);
    });
  }
  /** Wire where symbols come from (re-called on every widget rebuild). */
  setSource(source) {
    this.source = source;
  }
  open(initialQuery = "") {
    this.seed = initialQuery;
    this.dialog.show();
  }
  get isOpen() {
    return this.dialog.open;
  }
  /** Text typed at the picker that never reached its field: closed, it opens seeded
   *  with the text; open (the field takes focus a tick after the dialog does, and a
   *  fast typist's next key lands in that tick), it extends the query. */
  type(text) {
    if (!this.isOpen) {
      this.open(text);
      return;
    }
    this.input.value = (this.input.value + text).toUpperCase();
    this.refresh();
  }
  close() {
    this.dialog.hide();
  }
  destroy() {
    this.dialog.destroy();
  }
  /** Route a row activation: a GROUP row loads its default member (the root itself is
   *  listed, never loadable), any other row loads itself. */
  pick(s) {
    const target = isGroupRow(s) ? defaultMemberOf(this.pool(), s) ?? s : s;
    this.select(target.ticker, target.prefix ?? target.provider, this.opts.onSelect);
  }
  /** Expand/collapse a group row IN PLACE — same query, same page, same scroll; only
   *  the member rows under the group appear or go. */
  toggleExpand(s) {
    const key = groupKeyOf(s);
    if (!this.expanded.delete(key)) this.expanded.add(key);
    const scrollTop = this.list.scrollTop;
    const focus = this.rows[this.highlighted];
    this.rows = this.computeRows();
    this.list.replaceChildren();
    this.rows.forEach((r, i) => this.list.appendChild(this.rowEl(r, i)));
    const at = focus ? this.rows.indexOf(focus) : -1;
    this.highlighted = at >= 0 ? at : Math.min(this.highlighted, Math.max(0, this.rows.length - 1));
    this.renderHighlight();
    this.list.scrollTop = scrollTop;
  }
  select(ticker, venue, onSelect) {
    this.close();
    onSelect(venue ? `${venue}:${ticker}` : ticker);
  }
  moveHighlight(delta) {
    if (!this.rows.length) return;
    this.highlighted = Math.min(this.rows.length - 1, Math.max(0, this.highlighted + delta));
    this.renderHighlight();
  }
  renderHighlight() {
    [...this.list.children].forEach((el, i) => {
      if (i === this.highlighted) {
        el.dataset.highlighted = "1";
        el.scrollIntoView({ block: "nearest" });
      } else delete el.dataset.highlighted;
    });
  }
  /** The picker's pool: the source, shaped by the registered symbol ranking. Cached —
   *  the hook runs when the pool CHANGES (an index lands or refreshes), never per
   *  keystroke; an async hook resolves onto the next repaint (stale-while-revalidate
   *  in between, the raw pool before the first resolve). */
  pool() {
    const raw = this.source();
    const hook = symbolRanking();
    if (!hook) return raw;
    const key = `${raw.length}:${raw[0]?.ticker ?? ""}:${raw[raw.length - 1]?.ticker ?? ""}`;
    if (this.ranked?.key !== key && !this.ranking) {
      this.ranking = true;
      Promise.resolve([...raw]).then((copy) => hook(copy)).then((out) => {
        this.ranked = { key, result: dedupeSymbols(out) };
      }).catch((err) => {
        console.warn("[vela] symbol ranking failed \u2014 pool order kept:", err);
        this.ranked = { key, result: [...raw] };
      }).finally(() => {
        this.ranking = false;
        this.refresh();
      });
    }
    return this.ranked?.result ?? raw;
  }
  computeRows() {
    const TAB_TYPES = { Crypto: ["crypto"], Stocks: ["stock"], ETFs: ["etf"], Futures: ["futures", "root"], Forex: ["forex"], Commodities: ["commodity"] };
    const all = this.pool();
    const pool = this.activeTab === "All" ? all : all.filter((s) => TAB_TYPES[this.activeTab]?.includes((s.type ?? "").toLowerCase()) || this.activeTab === "Crypto" && (s.type ?? "").toLowerCase() === "futures");
    const filtered = filterSymbols(pool, this.input.value, this.visible, symbolRanking() ? false : TOP_TICKERS);
    this.exhausted = filtered.length < this.visible;
    const folded = foldGroups(filtered);
    if (!this.expanded.size) return folded;
    const keyOf = (s) => `${(s.prefix ?? s.provider ?? "").toLowerCase()}:${s.ticker.toUpperCase()}`;
    const present = new Set(folded.map(keyOf));
    const out = [];
    for (const s of folded) {
      out.push(s);
      if (!isGroupRow(s) || !this.expanded.has(groupKeyOf(s))) continue;
      for (const m of groupMembers(all, s)) {
        if (present.has(keyOf(m))) continue;
        present.add(keyOf(m));
        out.push(m);
      }
    }
    return out;
  }
  refresh() {
    const doc = this.list.ownerDocument;
    this.visible = PAGE;
    this.rows = this.computeRows();
    this.highlighted = 0;
    this.list.replaceChildren();
    if (!this.rows.length) {
      const empty = doc.createElement("div");
      empty.className = "vela-sp-empty";
      empty.textContent = this.input.value ? "No symbols match." : "No symbols indexed (provider still loading?).";
      this.list.appendChild(empty);
      return;
    }
    this.rows.forEach((s, i) => this.list.appendChild(this.rowEl(s, i)));
    this.renderHighlight();
  }
  /** Append the page the grown `visible` just uncovered — rows already on screen stay put. */
  grow() {
    const already = this.rows.length;
    this.rows = this.computeRows();
    this.rows.slice(already).forEach((s, j) => this.list.appendChild(this.rowEl(s, already + j)));
  }
  rowEl(s, i) {
    const doc = this.list.ownerDocument;
    const row = doc.createElement("div");
    row.className = "vela-sp-row";
    row.dataset.i = String(i);
    row.dataset.ticker = s.ticker;
    const venue = s.prefix ?? s.provider;
    if (venue) row.dataset.venue = venue;
    const av = tickerIconEl(doc, baseOf(s), s.ticker, "vela-sp-avatar", this.opts.iconFor?.(s));
    const main = doc.createElement("span");
    main.className = "vela-sp-main";
    const t = doc.createElement("span");
    t.className = "vela-sp-ticker";
    t.textContent = s.ticker;
    const d = doc.createElement("span");
    d.className = "vela-sp-desc";
    d.textContent = s.description ?? (s.type ?? "");
    main.append(t, d);
    row.append(av, main);
    if (isGroupRow(s)) {
      row.dataset.group = "1";
      const expander = doc.createElement("button");
      expander.className = "vela-sp-expander";
      expander.setAttribute("aria-label", "Show contracts");
      expander.appendChild(iconEl(this.expanded.has(groupKeyOf(s)) ? "chevron-down" : "chevron-right", doc));
      row.appendChild(expander);
    } else if (s.group != null && this.expanded.has(groupKeyOf(s))) row.dataset.member = "1";
    if (venue) {
      const badge = doc.createElement("span");
      badge.className = "vela-sp-badge";
      badge.dataset.p = s.provider ?? venue;
      badge.textContent = venue;
      row.appendChild(badge);
    }
    return row;
  }
};

// src/widget/indicator-picker.ts
var STYLE_ID7 = "vela-widget-indpicker";
var CSS7 = `
.vela-ip-searchrow {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    margin-bottom: var(--vela-space-2);
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
}
.vela-ip-searchrow:focus-within { border-color: var(--vela-border-strong); }
.vela-ip-searchrow .vela-icon { color: var(--vela-fg-muted); }
.vela-ip-search { flex: 1; background: transparent; color: var(--vela-fg); border: none; font-size: 14px; outline: none; }
.vela-ip-list { max-height: 50vh; overflow: auto; min-width: 380px; }
/* Mobile (fullscreen dialog): no width floor \u2014 380px would overflow a phone \u2014
   and no height cap; the fullscreen body owns the scrolling. */
[data-layout='mobile'] .vela-ip-list { min-width: 0; max-height: none; }
.vela-ip-list::-webkit-scrollbar { width: 8px; }
.vela-ip-list::-webkit-scrollbar-thumb { background: var(--vela-scroll); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
.vela-ip-group {
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 10px 4px 4px;
    border-bottom: 1px solid var(--vela-border);
    margin-bottom: 2px;
}
.vela-ip-oncard {
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    padding: 6px 8px;
    margin-bottom: var(--vela-space-2);
}
.vela-ip-oncard .vela-ip-group { border-bottom: none; padding-top: 2px; }
.vela-ip-row {
    display: flex;
    align-items: center;
    gap: var(--vela-space-2);
    padding: 7px 6px;
    border-radius: var(--vela-radius-sm);
    cursor: pointer;
}
.vela-ip-row:hover { background: var(--vela-hover); }
.vela-ip-name { flex: 1; font-weight: 600; color: var(--vela-fg-bright); font-size: 13px; }
.vela-ip-badge {
    flex: none;
    padding: 1px 7px;
    border-radius: var(--vela-radius-sm);
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    color: var(--vela-accent);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
.vela-ip-trash {
    all: unset;
    cursor: pointer;
    color: var(--vela-fg-muted);
    padding: 2px 4px;
    border-radius: var(--vela-radius-sm);
    font-size: var(--vela-font-size-md);
}
.vela-ip-trash:hover { color: var(--vela-down); background: var(--vela-hover); }
.vela-ip-empty { padding: var(--vela-space-3); color: var(--vela-fg-muted); text-align: center; }
`;
var IndicatorPicker = class {
  constructor(opts) {
    this.isOpen = false;
    this.opts = opts;
    const doc = (opts.host ?? document.body).ownerDocument;
    injectStyles(STYLE_ID7, CSS7, doc);
    this.search = doc.createElement("input");
    this.search.className = "vela-ip-search";
    this.search.placeholder = "Search\u2026";
    this.search.spellcheck = false;
    this.search.addEventListener("input", () => this.refresh());
    const searchRow = doc.createElement("div");
    searchRow.className = "vela-ip-searchrow";
    searchRow.append(iconEl("search", doc), this.search);
    this.list = doc.createElement("div");
    this.list.className = "vela-ip-list";
    this.dialog = new Dialog({
      title: "Indicators",
      host: opts.host,
      draggable: true,
      closeOnInteractOutside: true,
      // The picker adds/removes indicators live — keep the chart undimmed behind it.
      content: (body) => body.append(searchRow, this.list),
      onOpenChange: (open) => {
        this.isOpen = open;
        if (open) {
          this.search.value = "";
          this.refresh();
          if (!this.search.closest('[data-layout="mobile"]')) setTimeout(() => this.search.focus(), 0);
        }
        opts.onOpenChange?.(open);
      }
    });
    this.list.addEventListener("click", (e) => {
      const trash = e.target.closest(".vela-ip-trash");
      const row = e.target.closest(".vela-ip-row");
      if (!row) return;
      if (trash) {
        this.opts.onRemove(Number(row.dataset.instance));
      } else if (row.dataset.library !== void 0) {
        this.opts.onAdd(Number(row.dataset.library));
      }
      this.refresh();
    });
  }
  open() {
    this.dialog.show();
  }
  /** Re-render the lists if the dialog is open (async catalog updates land late). */
  sync() {
    if (this.isOpen) this.refresh();
  }
  close() {
    this.dialog.hide();
  }
  destroy() {
    this.dialog.destroy();
  }
  refresh() {
    const doc = this.list.ownerDocument;
    const q = this.search.value.trim().toLowerCase();
    const library = this.opts.library();
    const instances = this.opts.onChart();
    this.list.replaceChildren();
    const match = (r) => !q || r.name.toLowerCase().includes(q);
    const rowEl = (r, opts) => {
      const row = doc.createElement("div");
      row.className = "vela-ip-row";
      if (opts.library !== void 0) row.dataset.library = String(opts.library);
      if (opts.instance !== void 0) row.dataset.instance = String(opts.instance);
      if (r.native) row.dataset.native = "1";
      const name = doc.createElement("span");
      name.className = "vela-ip-name";
      name.textContent = r.name;
      row.appendChild(name);
      if (r.beta) {
        const beta = doc.createElement("span");
        beta.className = "vela-ip-badge";
        beta.textContent = "beta";
        row.appendChild(beta);
      }
      if (opts.instance !== void 0) {
        const badgeText = r.native ? "vela" : r.language;
        if (badgeText) {
          const badge = doc.createElement("span");
          badge.className = "vela-ip-badge";
          badge.textContent = badgeText;
          row.appendChild(badge);
        }
        const trash = doc.createElement("button");
        trash.className = "vela-ip-trash";
        trash.appendChild(iconEl("trash", doc));
        trash.title = "Remove from chart";
        row.appendChild(trash);
      }
      return row;
    };
    const onChart = instances.map((r, i) => [r, i]).filter(([r]) => match(r));
    if (onChart.length) {
      const card = doc.createElement("div");
      card.className = "vela-ip-oncard";
      const title = doc.createElement("div");
      title.className = "vela-ip-group";
      title.textContent = `On chart \xB7 ${onChart.length}`;
      card.appendChild(title);
      for (const [r, i] of onChart) card.appendChild(rowEl(r, { instance: i }));
      this.list.appendChild(card);
    }
    const byCat = /* @__PURE__ */ new Map();
    library.forEach((r, i) => {
      if (!match(r)) return;
      const cat = r.category ?? "General";
      const bucket = byCat.get(cat) ?? [];
      bucket.push([r, i]);
      byCat.set(cat, bucket);
    });
    for (const [cat, bucket] of byCat) {
      const title = doc.createElement("div");
      title.className = "vela-ip-group";
      title.textContent = cat;
      this.list.appendChild(title);
      for (const [r, i] of bucket) this.list.appendChild(rowEl(r, { library: i }));
    }
    if (!onChart.length && byCat.size === 0) {
      const empty = doc.createElement("div");
      empty.className = "vela-ip-empty";
      empty.textContent = library.length ? "No indicators match." : "No indicators in the manifest.";
      this.list.appendChild(empty);
    }
  }
};

// src/widget/timeframe-quick.ts
var STYLE_ID8 = "vela-widget-tfquick";
var CSS8 = `
.vela-tq-input {
    display: block;
    margin: 0 auto;
    width: 220px;
    box-sizing: border-box;
    height: 40px;
    background: var(--vela-surface-elev);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    padding: 0 12px;
    font-size: 18px;
    text-align: center;
    outline: none;
}
.vela-tq-input:focus { border-color: var(--vela-border-strong); }
.vela-tq-hint { margin-top: var(--vela-space-2); text-align: center; color: var(--vela-fg-muted); min-height: 1.2em; }
.vela-tq-hint[data-invalid] { color: var(--vela-danger); }
`;
var TimeframeQuick = class {
  constructor(opts) {
    const doc = (opts.host ?? document.body).ownerDocument;
    injectStyles(STYLE_ID8, CSS8, doc);
    this.input = doc.createElement("input");
    this.input.className = "vela-tq-input";
    this.input.setAttribute("spellcheck", "false");
    this.hint = doc.createElement("div");
    this.hint.className = "vela-tq-hint";
    this.dialog = new Dialog({
      title: "Change timeframe",
      host: opts.host,
      draggable: true,
      closeOnInteractOutside: true,
      content: (body) => body.append(this.input, this.hint),
      onOpenChange: (open) => opts.onOpenChange?.(open)
    });
    this.input.addEventListener("input", () => {
      const { selectionStart, selectionEnd } = this.input;
      this.input.value = this.input.value.toUpperCase();
      this.input.setSelectionRange(selectionStart, selectionEnd);
      this.renderHint();
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const parsed = parseTimeframe(this.input.value);
      if (parsed.valid && parsed.canonical !== void 0) {
        this.close();
        opts.onApply(parsed.canonical);
      }
    });
  }
  open(seed = "") {
    this.dialog.show();
    this.input.value = seed.toUpperCase();
    this.renderHint();
    setTimeout(() => {
      this.input.focus();
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }, 0);
  }
  get isOpen() {
    return this.dialog.open;
  }
  /** Text typed at the entry that never reached its field: closed, it opens seeded
   *  with the text; open (the field takes focus a tick after the dialog does, and a
   *  fast typist's next key lands in that tick), it extends the entry. */
  type(text) {
    if (!this.isOpen) {
      this.open(text);
      return;
    }
    this.input.value += text.toUpperCase();
    this.renderHint();
  }
  close() {
    this.dialog.hide();
  }
  destroy() {
    this.dialog.destroy();
  }
  renderHint() {
    const raw = this.input.value.trim();
    const parsed = parseTimeframe(raw);
    if (!raw) {
      this.hint.textContent = "e.g. 15, 4H, D, 3M";
      delete this.hint.dataset.invalid;
    } else if (parsed.valid) {
      this.hint.textContent = parsed.label ?? "";
      delete this.hint.dataset.invalid;
    } else {
      this.hint.textContent = "Not a timeframe";
      this.hint.dataset.invalid = "1";
    }
  }
};

// src/widget/shortcuts-help.ts
var STYLE_ID9 = "vela-widget-shortcuts";
var CSS9 = `
.vela-sh-cat {
    color: var(--vela-fg-muted);
    font-size: var(--vela-font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: var(--vela-space-2) 0 var(--vela-space-1);
}
.vela-sh-row { display: flex; align-items: center; gap: var(--vela-space-3); padding: 3px 0; }
.vela-sh-label { flex: 1; }
.vela-sh-keys { display: flex; gap: 4px; }
.vela-sh-key {
    background: var(--vela-surface-overlay);
    border: 1px solid var(--vela-border-soft);
    border-radius: var(--vela-radius-sm);
    padding: 1px 7px;
    font-size: var(--vela-font-size-sm);
    font-variant-numeric: tabular-nums;
}
.vela-sh-static { color: var(--vela-fg-muted); font-size: var(--vela-font-size-sm); margin-top: var(--vela-space-2); }
`;
var ShortcutsHelp = class {
  constructor(keymap, host, onOpenChange) {
    this.keymap = keymap;
    const doc = (host ?? document.body).ownerDocument;
    injectStyles(STYLE_ID9, CSS9, doc);
    this.list = doc.createElement("div");
    this.dialog = new Dialog({
      title: "Keyboard shortcuts",
      host,
      closeOnInteractOutside: true,
      content: (body) => body.appendChild(this.list),
      onOpenChange: (open) => {
        if (open) this.refresh();
        onOpenChange?.(open);
      }
    });
  }
  open() {
    this.dialog.show();
  }
  close() {
    this.dialog.hide();
  }
  destroy() {
    this.dialog.destroy();
  }
  refresh() {
    const doc = this.list.ownerDocument;
    this.list.replaceChildren();
    const addCategory = (text) => {
      const cat = doc.createElement("div");
      cat.className = "vela-sh-cat";
      cat.textContent = text;
      this.list.appendChild(cat);
    };
    const addRow = (label, keys) => {
      const row = doc.createElement("div");
      row.className = "vela-sh-row";
      const l = doc.createElement("span");
      l.className = "vela-sh-label";
      l.textContent = label;
      const ks = doc.createElement("span");
      ks.className = "vela-sh-keys";
      for (const key of keys) {
        const k = doc.createElement("span");
        k.className = "vela-sh-key";
        k.textContent = key;
        ks.appendChild(k);
      }
      row.append(l, ks);
      this.list.appendChild(row);
    };
    const byCategory = /* @__PURE__ */ new Map();
    for (const b of this.keymap.bindings()) {
      const bucket = byCategory.get(b.category) ?? [];
      bucket.push(b);
      byCategory.set(b.category, bucket);
    }
    for (const [category, bindings] of byCategory) {
      addCategory(category);
      for (const b of bindings) addRow(b.label, b.display);
    }
    addCategory("Mouse");
    addRow("Scroll through history", ["Shift+Scroll"]);
    addRow("Measure from the press point", ["Shift+Click"]);
    addRow("Delete the drawing under the cursor", ["Middle-click"]);
    const s = doc.createElement("div");
    s.className = "vela-sh-static";
    s.textContent = "Typing a letter or 0 opens the symbol search; typing a digit from 1 to 9 opens the timeframe entry.";
    this.list.appendChild(s);
  }
};

// src/widget/indicators.ts
function entriesOf(manifest) {
  return Array.isArray(manifest) ? manifest : manifest.indicators;
}
async function resolveIndicators(config, fetchImpl = fetch) {
  let manifest;
  let baseUrl;
  if (typeof config === "function") {
    manifest = await config();
  } else if (typeof config === "string") {
    baseUrl = config;
    const res = await fetchImpl(config);
    if (!res.ok) throw new Error(`indicator manifest ${config}: HTTP ${res.status}`);
    manifest = await res.json();
  } else {
    manifest = config;
  }
  const out = [];
  for (const entry of entriesOf(manifest)) {
    try {
      let script = entry.script;
      if (script === void 0 && entry.url !== void 0) {
        let url = entry.url;
        try {
          const base = typeof location !== "undefined" ? new URL(baseUrl ?? ".", location.href) : new URL(baseUrl ?? "");
          url = new URL(entry.url, base).href;
        } catch {
        }
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        script = await res.text();
      }
      if (script === void 0) throw new Error("entry has neither script nor url");
      out.push({ name: entry.name, script, language: entry.language, enabled: entry.enabled !== false, category: entry.category });
    } catch (err) {
      console.warn(`[vela] indicator "${entry.name}" skipped:`, err);
    }
  }
  return out;
}
var ledgerEntryName = (e) => typeof e === "string" ? e : e.name;
var ledgerNativeType = (e) => typeof e === "string" ? e : e.type;
function indicatorLedger(i) {
  const natives = [...i.present];
  if (i.volumePending && !natives.some((e) => ledgerNativeType(e) === "volume")) natives.push("volume");
  return {
    manifest: i.manifestSettled ? [...i.instanceEntries] : [...i.pendingManifest ?? i.instanceEntries],
    natives
  };
}

// src/state/document.ts
var SYNC_KINDS = ["viewport", "symbol", "timeframe", "crosshair", "drawings", "style"];
function prefixedSymbol(cell) {
  if (!cell?.symbol) return void 0;
  if (cell.symbol.includes(":") || !cell.provider) return cell.symbol;
  return `${cell.provider}:${cell.symbol}`;
}
function encodeState(state) {
  return JSON.stringify(state);
}
function decodeState(raw) {
  try {
    return sanitizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}
function sanitizeState(doc) {
  if (doc == null || typeof doc !== "object") return null;
  const d = doc;
  if (d.version !== 1 || typeof d.layout !== "string") return null;
  const out = { version: 1, layout: d.layout, charts: [] };
  if (Array.isArray(d.charts)) {
    const byId = /* @__PURE__ */ new Map();
    for (const raw of d.charts) {
      const id = raw != null && typeof raw === "object" ? raw.id : void 0;
      if (typeof id !== "string" || id.length === 0) continue;
      const cell = sanitizeCell(raw);
      if (cell) byId.set(id, { id, ...cell });
    }
    out.charts = [...byId.values()];
  }
  if (typeof d.activeCellId === "string") out.activeCellId = d.activeCellId;
  if (typeof d.timezone === "string" && d.timezone) out.timezone = d.timezone;
  if (Array.isArray(d.favorites)) {
    const favs = d.favorites.filter((f) => typeof f === "string");
    if (favs.length > 0) out.favorites = favs;
  }
  if (Array.isArray(d.timeframeFavorites)) {
    const favs = d.timeframeFavorites.filter((f) => typeof f === "string");
    if (favs.length > 0) out.timeframeFavorites = favs;
  }
  const sync = sanitizeSync(d.sync);
  if (sync) out.sync = sync;
  const tracks = sanitizeTrackSizes(d.trackSizes);
  if (tracks) out.trackSizes = tracks;
  const panels = sanitizePanels(d.panels);
  if (panels) out.panels = panels;
  const ext = sanitizeExt(d.ext);
  if (ext) out.ext = ext;
  return out;
}
function sanitizeExt(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.length > 0 && value !== void 0) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}
function sanitizeCell(raw) {
  if (raw == null || typeof raw !== "object") return null;
  const c = raw;
  const out = {};
  if (typeof c.symbol === "string") out.symbol = c.symbol;
  if (typeof c.provider === "string") out.provider = c.provider;
  if (typeof c.timeframe === "string") out.timeframe = c.timeframe;
  if (typeof c.priceStyle === "string") out.priceStyle = c.priceStyle;
  if (typeof c.bars === "number" && Number.isFinite(c.bars) && c.bars > 0) out.bars = c.bars;
  if (c.session === "regular" || c.session === "extended") out.session = c.session;
  if (typeof c.watermark === "boolean") out.watermark = c.watermark;
  if (typeof c.replayWatermark === "boolean") out.replayWatermark = c.replayWatermark;
  if (typeof c.indicatorTitles === "boolean") out.indicatorTitles = c.indicatorTitles;
  if (typeof c.indicatorValues === "boolean") out.indicatorValues = c.indicatorValues;
  if (c.rendererConfig != null && typeof c.rendererConfig === "object") out.rendererConfig = c.rendererConfig;
  if (c.drawings != null && typeof c.drawings === "object") out.drawings = c.drawings;
  const ind = c.indicators;
  if (ind != null && typeof ind === "object") {
    const bag = (v) => v != null && typeof v === "object" && !Array.isArray(v) ? v : void 0;
    const manifest = Array.isArray(ind.manifest) ? ind.manifest.flatMap((n) => {
      if (typeof n === "string") return [n];
      if (n != null && typeof n === "object" && typeof n.name === "string") {
        const e = n;
        const inputs = bag(e.inputs);
        const props = bag(e.props);
        const hidden = e.hidden === true;
        return [inputs || props || hidden ? { name: e.name, ...inputs ? { inputs } : {}, ...props ? { props } : {}, ...hidden ? { hidden } : {} } : e.name];
      }
      return [];
    }) : [];
    const natives = Array.isArray(ind.natives) ? ind.natives.flatMap((n) => {
      if (typeof n === "string") return [n];
      if (n != null && typeof n === "object" && typeof n.type === "string") {
        const e = n;
        const inputs = bag(e.inputs);
        const hidden = e.hidden === true;
        return [inputs || hidden ? { type: e.type, ...inputs ? { inputs } : {}, ...hidden ? { hidden } : {} } : e.type];
      }
      return [];
    }) : [];
    out.indicators = { manifest, natives };
  }
  const ext = sanitizeExt(c.ext);
  if (ext) out.ext = ext;
  return out;
}
function sanitizeSync(raw) {
  if (raw == null || typeof raw !== "object") return null;
  const s = raw;
  const out = {};
  for (const kind of SYNC_KINDS) {
    const v = s[kind];
    if (v === true) out[kind] = true;
    else if (v != null && typeof v === "object") {
      const groups = {};
      for (const [id, g] of Object.entries(v)) if (typeof g === "string") groups[id] = g;
      if (Object.keys(groups).length > 0) out[kind] = groups;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
function sanitizePanels(raw) {
  if (raw == null || typeof raw !== "object") return null;
  const p = raw;
  const out = {};
  if (typeof p.open === "string" && p.open) out.open = p.open;
  if (p.widths != null && typeof p.widths === "object") {
    const widths = {};
    for (const [id, px] of Object.entries(p.widths)) {
      if (typeof px === "number" && Number.isFinite(px) && px > 0) widths[id] = px;
    }
    if (Object.keys(widths).length > 0) out.widths = widths;
  }
  if (Array.isArray(p.pinned)) {
    const pinned = p.pinned.filter((id) => typeof id === "string" && id !== "");
    if (pinned.length > 0) out.pinned = [...new Set(pinned)];
  }
  return out.open || out.widths || out.pinned ? out : null;
}
function sanitizeTrackSizes(raw) {
  if (raw == null || typeof raw !== "object") return null;
  const out = {};
  for (const [layoutId, ts] of Object.entries(raw)) {
    if (ts == null || typeof ts !== "object") continue;
    const t = ts;
    const entry = {};
    for (const axis of ["cols", "rows"]) {
      const arr = t[axis];
      if (Array.isArray(arr) && arr.length > 0 && arr.every((w) => typeof w === "number" && Number.isFinite(w) && w > 0)) {
        entry[axis] = arr;
      }
    }
    if (entry.cols || entry.rows) out[layoutId] = entry;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// src/workspace/sync.ts
function syncTargets(originId, setting, cellIds) {
  if (setting == null || setting === false) return [];
  if (setting === true) return cellIds.filter((id) => id !== originId);
  const group = setting[originId];
  if (group == null) return [];
  return cellIds.filter((id) => id !== originId && setting[id] === group);
}
function rangesWithin(a, b, epsMs) {
  return Math.abs(a.from - b.from) <= epsMs && Math.abs(a.to - b.to) <= epsMs;
}
var STYLE_SYNC_CONFIG_KEYS = [
  "layout",
  "panes",
  "grid",
  "margins",
  "priceScale",
  "crosshair",
  "animations",
  "candles",
  "bars",
  "line",
  "area",
  "baseline",
  "sessions"
];
function styleConfigPatch(origin, follower) {
  const from = asRecord(origin);
  const to = asRecord(follower);
  if (!from || !to) return null;
  const patch = {};
  for (const key of STYLE_SYNC_CONFIG_KEYS) {
    const block = asRecord(from[key]);
    if (block && JSON.stringify(block) !== JSON.stringify(to[key])) patch[key] = block;
  }
  const spacing = asRecord(from.series)?.spacing;
  if (typeof spacing === "number" && spacing !== asRecord(to.series)?.spacing) patch.series = { spacing };
  const fromTypes = asRecord(from.chartTypes) ?? {};
  const toTypes = asRecord(to.chartTypes) ?? {};
  const types = {};
  for (const typeId of /* @__PURE__ */ new Set([...Object.keys(fromTypes), ...Object.keys(toTypes)])) {
    const src = asRecord(fromTypes[typeId]) ?? {};
    const dst = asRecord(toTypes[typeId]) ?? {};
    for (const key of CANDLE_OVERRIDE_KEYS) {
      const value = src[key] ?? null;
      if (value !== (dst[key] ?? null)) (types[typeId] ?? (types[typeId] = {}))[key] = value;
    }
  }
  if (Object.keys(types).length > 0) patch.chartTypes = types;
  return Object.keys(patch).length > 0 ? patch : null;
}
function asRecord(v) {
  return v != null && typeof v === "object" ? v : null;
}

// src/workspace/persist.ts
var memoryStore = /* @__PURE__ */ new Map();
function memoryStorageAdapter() {
  return {
    get: (key) => memoryStore.get(key) ?? null,
    set: (key, value) => {
      memoryStore.set(key, value);
    },
    remove: (key) => {
      memoryStore.delete(key);
    }
  };
}

// src/widget/persist.ts
function localStorageAdapter(storageKey) {
  return {
    get(key) {
      try {
        return localStorage.getItem(storageKey ?? key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(storageKey ?? key, value);
      } catch {
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(storageKey ?? key);
      } catch {
      }
    }
  };
}

// src/widget/format.ts
function decimalsFor(ref) {
  const a = Math.abs(ref);
  return a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
}
function fmtPrice(n, dp) {
  if (n == null || !Number.isFinite(n)) return "\u2014";
  const d = dp ?? decimalsFor(n);
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtChange(open, close) {
  if (open == null || close == null || !Number.isFinite(open) || !Number.isFinite(close) || open === 0) return "";
  const diff = close - open;
  const pct = diff / open * 100;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${fmtPrice(diff, decimalsFor(close))} (${sign}${pct.toFixed(2)}%)`;
}
function fmtChangePct(open, close) {
  if (open == null || close == null || !Number.isFinite(open) || !Number.isFinite(close) || open === 0) return "";
  const pct = (close - open) / open * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

// src/widget/statusline-model.ts
function segmentVisibility(parts, chartHidden = false) {
  return { avatar: parts.logo, symbol: parts.name, meta: parts.name, market: parts.market, ohlc: parts.ohlc && !chartHidden, change: parts.change && !chartHidden, eye: chartHidden };
}
var STATUSLINE_LADDER = [
  { stacked: false, level: "full" },
  { stacked: true, level: "full" },
  { stacked: true, level: "compact" },
  { stacked: true, level: "minimal" }
];
function readoutCells(level, readout) {
  if (readout === "value") return [{ key: "close", label: "" }];
  if (level === "full") {
    return [
      { key: "open", label: "O" },
      { key: "high", label: "H" },
      { key: "low", label: "L" },
      { key: "close", label: "C" }
    ];
  }
  return [{ key: "close", label: level === "compact" ? "C" : "" }];
}
function statuslineMenuItems(parts, chartVisible) {
  return [
    { id: "part:logo", label: "Symbol logo", checked: parts.logo },
    { id: "part:name", label: "Symbol name", checked: parts.name },
    { id: "part:market", label: "Market status", checked: parts.market },
    { id: "part:ohlc", label: "OHLC values", checked: parts.ohlc },
    { id: "part:change", label: "Bar change values", checked: parts.change },
    { id: "chart", label: chartVisible ? "Hide chart" : "Show chart", separatorBefore: true }
  ];
}

// src/widget/statusline.ts
var STYLE_ID10 = "vela-widget-statusline";
var CSS10 = `
.vela-statusline {
    position: absolute;
    top: var(--vela-space-2);
    /* Track the indicator legend's left edge: the renderer publishes its toolbar gutter
     * on the mount container, and the legend sits 10px into the plot to its right \u2014
     * so the two columns stay aligned whether the toolbar is docked (44px), collapsed
     * (16px), or absent entirely (a workspace cell: 0). */
    left: calc(var(--vela-toolbar-gutter, 0px) + 10px);
    z-index: 10;
    display: flex;
    align-items: baseline;
    gap: var(--vela-space-2);
    /* The chip never grows past the plot: fit() measures overflow against this width to
     * walk the layout ladder (stack, then shed values), so overflow:hidden only guards
     * the transient between a resize and the next measure. */
    max-width: calc(100% - var(--vela-toolbar-gutter, 0px) - var(--vela-scale-gutter, 0px) - 24px);
    overflow: hidden;
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md);
    /* Same chip treatment as the indicator legend rows (InputsUI): a translucent wash of
     * the chart background when idle \u2014 enough to keep the readout legible when candles
     * reach it \u2014 and the solid chart background on hover. Symmetric 7px padding with a
     * compensating negative margin (mirroring the legend rows) keeps the avatar's left
     * edge on the legend column's left edge (both at left:10px) while the chip itself
     * extends 7px further left, so both columns' chips share the same left edge. */
    pointer-events: auto;
    background: color-mix(in srgb, var(--vela-bg) 60%, transparent);
    border-radius: 4px;
    padding: 2px 7px;
    margin-left: -7px;
}
/* Hovering opens the chip the same way a legend row opens: solid chart background
 * plus the same inset neutral outline the indicator rows wear (InputsUI's
 * setRowHighlighted) \u2014 the two columns read as one family. */
.vela-statusline:hover { background: var(--vela-bg); box-shadow: inset 0 0 0 1px var(--vela-border); }
/* Chart hidden (the price series' eye \u2014 renderer 'candleVisible'): the line dims to
 * the same 0.5 wash a hidden indicator's legend row wears. */
.vela-statusline.vela-sl-chart-hidden { opacity: 0.5; }
/* Two rows inside the chip \u2014 the identity (logo / symbol / meta / market badge) and the
 * value readout (O/H/L/C + change, or the show-chart eye). In the widest layout they sit
 * side by side on one line; the STACKED layouts (fit() decides, see the ladder in
 * statusline-model) turn the chip into a column so the values drop under the symbol. */
.vela-statusline .vela-sl-row {
    display: flex;
    align-items: baseline;
    gap: var(--vela-space-2);
    white-space: nowrap;
}
.vela-statusline.vela-sl-stacked {
    flex-direction: column;
    align-items: flex-start;
    /* The same air between the two rows as between the values row and the legend row
     * that follows the chip (see the stacked legend shift below). */
    row-gap: var(--vela-space-1);
}
/* Stacked, the identity row may shrink (the meta carries the ellipsis) \u2014 the values row
 * never does, so its overflow is what fit() measures to keep descending the ladder. */
.vela-statusline.vela-sl-stacked .vela-sl-identity { max-width: 100%; }
.vela-statusline.vela-sl-stacked .vela-sl-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}
.vela-statusline .vela-sl-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex: none;
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vela-fg-on-fill);
    font-size: 10px;
    font-weight: 700;
}
.vela-statusline .vela-sl-symbol { font-weight: 600; font-size: var(--vela-font-size-lg); }
.vela-statusline .vela-sl-meta { color: var(--vela-fg-muted); font-size: var(--vela-font-size-md); font-weight: 600; }
/* The meta opens with "\xB7 " \u2014 sit its dot one space-width after the ticker, as far as the
 * venue sits after it, not a full row gap away. */
.vela-statusline .vela-sl-symbol + .vela-sl-meta { margin-left: calc(var(--vela-space-1) - var(--vela-space-2)); }
/* Market status badge \u2014 a kit callout bubble (icon-only 16px circle, label on hover
 * via the kit tooltip); the session tint is applied per status in setMarketStatus. While
 * the chart replays past bars it wears the replay badge instead (the inverse chip). */
.vela-statusline .vela-sl-market { align-self: center; display: inline-flex; }
.vela-statusline .vela-sl-market > [hidden] { display: none !important; }
.vela-statusline .vela-sl-replay-badge, .vela-statusline .vela-sl-replay-badge svg { display: block; width: 16px; height: 16px; }
/* Tabular figures: every digit has one advance, so a readout whose text changes only in
 * its digits keeps its width \u2014 render() skips the ladder for those (see widthKey). */
.vela-statusline .vela-sl-values { font-variant-numeric: tabular-nums; }
.vela-statusline .vela-sl-ohlc { display: flex; gap: var(--vela-space-1); color: var(--vela-fg-muted); }
.vela-statusline .vela-sl-ohlc b { color: var(--vela-fg); font-weight: 500; }
/* The change value wears the SAME ink as the OHLC values (set inline per render) \u2014
 * these are the pre-ink fallbacks only. */
.vela-statusline .vela-sl-change[data-dir='up'] { color: var(--vela-up); }
.vela-statusline .vela-sl-change[data-dir='down'] { color: var(--vela-down); }
/* The show-chart eye \u2014 out only while the chart is hidden (syncParts drives display),
 * replacing the value readout it took away. Same footprint as a legend action button. */
.vela-statusline .vela-sl-eye {
    align-self: center;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--vela-fg-muted);
    cursor: pointer;
    line-height: 0;
    flex: none;
}
.vela-statusline .vela-sl-eye:hover { color: var(--vela-fg); background: color-mix(in srgb, var(--vela-fg) 12%, transparent); }
/* Stack the TOP pane's legend below the status line (lower study panes stay put).
 * The renderer marks whichever legend sits at the plot's top edge \u2014 the price pane
 * normally, or a maximized study pane filling the plot \u2014 so the legend never merges
 * with the status line whichever pane owns the top. The renderer sets the legend's
 * inline top \u2014 shift with a transform, don't fight it. Scoped to hosts that actually
 * CARRY a status line (the marker class set by the Statusline constructor) \u2014 the
 * stylesheet is document-global, so a bare attribute selector here would shift every
 * chart on the page, including statusline-less ones. */
.vela-has-statusline [${LEGEND_AT_TOP_ATTR}] { transform: translateY(26px); }
/* A stacked chip is two lines tall \u2014 the legend shifts one more line. fit() flags the
 * host whenever the ladder lands on a stacked layout. */
.vela-has-statusline.vela-sl-stacked-host [${LEGEND_AT_TOP_ATTR}] { transform: translateY(40px); }
/* Mobile: the same ladder at the phone's type scale \u2014 the width alone decides how much
 * of the readout fits, exactly as on a narrow desktop chart. */
[data-layout='mobile'] .vela-statusline { font-size: var(--vela-font-size-sm); }
[data-layout='mobile'] .vela-statusline .vela-sl-symbol { font-size: var(--vela-font-size-md); }
`;
function baseOfTicker(ticker) {
  return ticker.replace(/[-_/]?(USDT|USDC|USD1|USDS|BUSD|USD|EUR|PERP)$/i, "") || ticker;
}
var MARKET_LABELS = {
  open: "Market Open",
  pre: "Pre-Market",
  post: "Post-Market",
  extended: "Extended Hours",
  closed: "Market Closed",
  holiday: "Market Holiday"
};
var REPLAY_LABEL = "Replay Mode";
var REPLAY_BADGE_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="8" style="fill: var(--vela-selected-bg)"/><path d="M11.7 4.75v6.5L7.2 8zM7.2 4.75v6.5L2.7 8z" style="fill: var(--vela-selected-fg); stroke: var(--vela-selected-fg); stroke-width: 0.8; stroke-linejoin: round"/></svg>';
var MARKET_INKS = {
  open: "var(--vela-up)",
  pre: SESSION_PRE,
  post: SESSION_POST,
  extended: SESSION_POST,
  closed: SESSION_OFF,
  holiday: SESSION_OFF
};
function statuslineInkOf(renderer, priceStyle) {
  const cfg = renderer.getConfig();
  const c = (v) => typeof v === "string" ? v : null;
  switch (priceStyle) {
    case "bars":
      return [c(cfg?.bars?.upColor), c(cfg?.bars?.downColor), null, "ohlc"];
    case "line": {
      const v = c(cfg?.line?.color);
      return [v, v, null, "value"];
    }
    case "area": {
      const v = c(cfg?.area?.lineColor);
      return [v, v, null, "value"];
    }
    case "baseline": {
      const isUp = (bar) => {
        const level = Number(renderer.get("baselinePrice"));
        return Number.isFinite(level) ? bar.close >= level : bar.close >= bar.open;
      };
      return [c(cfg?.baseline?.topLineColor), c(cfg?.baseline?.bottomLineColor), isUp, "value"];
    }
    default:
      return [c(cfg?.candles?.upColor), c(cfg?.candles?.downColor), null, "ohlc"];
  }
}
var Statusline = class {
  constructor(host, symbol, iconFor) {
    this.host = host;
    this.iconFor = iconFor;
    this.parts = { logo: true, name: true, market: true, ohlc: true, change: true };
    this.marketStatus = "open";
    /** The chart replays past bars — the badge shows the replay mode (see {@link setReplaying}). */
    this.replaying = false;
    /** The right-click action menu — present once a host wires it via {@link attachMenu}. */
    this.menu = null;
    this.menuHooks = null;
    /** Mirror of the renderer's `candleVisible` — see {@link setChartHidden}. */
    this.chartHidden = false;
    this.lastBar = null;
    this.hoverBar = null;
    this.unsubs = [];
    /** Up/down ink for the OHLC + change values — the ACTIVE price style's configured
     *  colors (candle bodies, bar ticks, the line color, …); null falls back to the theme
     *  tokens. `isUp` overrides the close-vs-open direction rule where the style paints by
     *  something else (baseline: position against the baseline price). */
    this.upColor = null;
    this.downColor = null;
    this.isUp = null;
    /** 'ohlc' for bar-shaped styles; 'value' (the single plotted close) for line styles. */
    this.readout = "ohlc";
    /** Fit mode (multi-chart cells): one row, overflowing segments hidden — see {@link setFitMode}. */
    this.fitMode = false;
    this.fitRO = null;
    /** The ladder rung currently applied — see {@link fit}. */
    this.layout = { stacked: false, level: "full" };
    /** The readout {@link widthKey} the applied rung was fitted to. */
    this.fitKey = null;
    /** Web fonts landing after the last fit change every width without a resize. */
    this.onFontsLoaded = () => this.fit();
    this.onContextMenu = (e) => {
      if (!this.menu || !this.menuHooks) return;
      e.preventDefault();
      e.stopPropagation();
      const chartVisible = this.menuHooks.chartVisible();
      this.setChartHidden(!chartVisible);
      this.menu.setItems(statuslineMenuItems(this.parts, chartVisible));
      this.menu.openAt(e.clientX, e.clientY);
    };
    const doc = host.ownerDocument;
    injectStyles(STYLE_ID10, CSS10, doc);
    host.classList.add("vela-has-statusline");
    this.el = doc.createElement("div");
    this.el.className = "vela-statusline";
    this.el.dataset.velaScreenshot = "1";
    const ticker = parseSymbol(symbol).ticker;
    this.avatarEl = tickerIconEl(doc, baseOfTicker(ticker), ticker, "vela-sl-avatar", this.iconFor?.(symbol));
    this.symbolEl = doc.createElement("span");
    this.symbolEl.className = "vela-sl-symbol";
    this.symbolEl.textContent = ticker;
    this.metaEl = doc.createElement("span");
    this.metaEl.className = "vela-sl-meta";
    this.marketBubble = new CalloutBubble({
      icon: "market-open",
      background: `color-mix(in srgb, ${MARKET_INKS.open} 20%, transparent)`,
      color: MARKET_INKS.open,
      label: MARKET_LABELS.open,
      host
    });
    this.replayBadge = doc.createElement("span");
    this.replayBadge.className = "vela-sl-replay-badge";
    this.replayBadge.innerHTML = REPLAY_BADGE_SVG;
    this.replayBadge.hidden = true;
    this.marketEl = doc.createElement("span");
    this.marketEl.className = "vela-sl-market";
    this.marketEl.append(this.marketBubble.el, this.replayBadge);
    this.ohlcEl = doc.createElement("span");
    this.ohlcEl.className = "vela-sl-ohlc";
    this.changeEl = doc.createElement("span");
    this.changeEl.className = "vela-sl-change";
    this.eyeEl = doc.createElement("button");
    this.eyeEl.type = "button";
    this.eyeEl.className = "vela-sl-eye";
    this.eyeEl.innerHTML = iconAt("eye-off", 14);
    this.eyeEl.setAttribute("aria-label", "Show chart");
    this.eyeEl.style.display = "none";
    this.eyeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.menuHooks?.setChartVisible(true);
      this.setChartHidden(false);
    });
    this.identityRow = doc.createElement("span");
    this.identityRow.className = "vela-sl-row vela-sl-identity";
    this.identityRow.append(this.avatarEl, this.symbolEl, this.metaEl, this.marketEl);
    this.valuesRow = doc.createElement("span");
    this.valuesRow.className = "vela-sl-row vela-sl-values";
    this.valuesRow.append(this.ohlcEl, this.changeEl, this.eyeEl);
    this.el.append(this.identityRow, this.valuesRow);
    host.appendChild(this.el);
    if (typeof ResizeObserver !== "undefined") {
      this.fitRO = new ResizeObserver(() => this.fit());
      this.fitRO.observe(host);
    }
    doc.fonts?.addEventListener("loadingdone", this.onFontsLoaded);
    this.marketTip = new Tooltip(this.marketEl, { content: MARKET_LABELS.open, placement: "bottom" });
    this.eyeTip = new Tooltip(this.eyeEl, { content: "Show chart", placement: "bottom" });
    this.setMarketStatus("open");
    this.render();
  }
  setSymbol(symbol) {
    const ticker = parseSymbol(symbol).ticker;
    this.symbolEl.textContent = ticker;
    const fresh = tickerIconEl(this.el.ownerDocument, baseOfTicker(ticker), ticker, "vela-sl-avatar", this.iconFor?.(symbol));
    this.avatarEl.replaceWith(fresh);
    this.avatarEl = fresh;
    this.syncParts();
    this.fit();
  }
  /**
   * Multi-chart cells: the same width ladder as a single chart, plus a last resort for
   * cells too narrow for even its bottom rung — whatever still overflows is hidden
   * outright rather than clipped mid-glyph, least important first: the values, the
   * venue/timeframe meta, then the market badge; the logo + ticker always stay.
   */
  setFitMode(on) {
    if (on === this.fitMode) return;
    this.fitMode = on;
    this.fit();
  }
  /** Project the parts config onto the segments (the baseline fit() prunes from). */
  syncParts() {
    const seg = segmentVisibility(this.parts, this.chartHidden);
    this.avatarEl.style.display = seg.avatar ? "" : "none";
    this.symbolEl.style.display = seg.symbol ? "" : "none";
    this.metaEl.style.display = seg.meta ? "" : "none";
    this.marketEl.style.display = seg.market ? "" : "none";
    this.ohlcEl.style.display = seg.ohlc ? "" : "none";
    this.changeEl.style.display = seg.change ? "" : "none";
    this.eyeEl.style.display = seg.eye ? "inline-flex" : "none";
    this.valuesRow.style.display = seg.ohlc || seg.change || seg.eye ? "" : "none";
  }
  /** Apply one ladder rung: the stacked/inline shape and the readout's level. */
  applyLayout(layout) {
    this.layout = layout;
    this.el.classList.toggle("vela-sl-stacked", layout.stacked);
    this.host.classList.toggle("vela-sl-stacked-host", layout.stacked);
    this.renderValues();
  }
  /**
   * Walk the width ladder (see {@link STATUSLINE_LADDER}) until the chip fits its
   * max-width: the full one-line readout, then the values stacked under the symbol
   * line, then O/H/L shed, then the absolute change. In fit mode, when the last rung
   * still overflows, whole segments hide, least important first. Without layout
   * (detached host, node tests) nothing overflows, so the widest rung stays.
   */
  fit() {
    this.fitKey = this.widthKey();
    this.syncParts();
    const seg = segmentVisibility(this.parts, this.chartHidden);
    const overflows = () => this.el.scrollWidth > this.el.clientWidth;
    const hasValues = seg.ohlc || seg.change;
    for (const rung of STATUSLINE_LADDER) {
      this.applyLayout(rung);
      if (!hasValues || !overflows()) break;
    }
    if (!this.fitMode) return;
    const order = [
      [this.valuesRow, hasValues],
      [this.metaEl, seg.meta],
      [this.marketEl, seg.market]
    ];
    for (const [el, shown] of order) {
      if (!overflows()) break;
      if (shown) el.style.display = "none";
    }
    if (this.valuesRow.style.display === "none") this.applyLayout({ ...this.layout, stacked: false });
  }
  /** Shape + color the value readout after the active price style: its own up/down
   *  colors (candle bodies, bar ticks, the line color, …), the direction rule that
   *  picks between them (`isUp` replaces close-vs-open where the style paints by
   *  something else — baseline by position), and whether the readout is the four
   *  O/H/L/C values or the single plotted value (one-line styles). Null colors fall
   *  back to the theme's up/down tokens. See {@link statuslineInkOf}, which derives
   *  all of it from the live renderer. */
  setDirectionColors(up, down, isUp = null, readout = "ohlc") {
    this.upColor = up;
    this.downColor = down;
    this.isUp = isUp;
    this.readout = readout;
    this.render();
  }
  /** The "· BINANCE · 1h" segment after the symbol — venue first, then resolution. */
  setMeta(timeframe, provider) {
    this.metaEl.textContent = `${provider ? `\xB7 ${provider.toUpperCase()} ` : ""}\xB7 ${timeframeLabel(timeframe)}`;
    this.fit();
  }
  /** Dress the market badge for a session state: its icon, tinted circle, and the
   *  hover label. Callers with no session model leave the constructor's 'open'. */
  setMarketStatus(status) {
    this.marketStatus = status;
    this.dressBadge();
  }
  /** The chart entered or left a bar replay: the badge shows the replay mode meanwhile
   *  (the session state of a past bar says nothing about the market now). */
  setReplaying(replaying) {
    if (replaying === this.replaying) return;
    this.replaying = replaying;
    this.dressBadge();
  }
  dressBadge() {
    this.marketBubble.el.hidden = this.replaying;
    this.replayBadge.hidden = !this.replaying;
    if (this.replaying) {
      this.marketEl.dataset.status = "replay";
      this.marketTip.setContent(REPLAY_LABEL);
      return;
    }
    const status = this.marketStatus;
    this.marketEl.dataset.status = status;
    const ink = MARKET_INKS[status];
    this.marketBubble.set({
      icon: `market-${status}`,
      background: `color-mix(in srgb, ${ink} 20%, transparent)`,
      color: ink,
      label: MARKET_LABELS[status]
    });
    this.marketTip.setContent(MARKET_LABELS[status]);
  }
  /** Show/hide one part — the settings dialog's Status line tab and the right-click
   *  menu both drive these. 'name' owns the venue/timeframe meta too (see
   *  {@link segmentVisibility}). */
  setPartVisible(part, visible) {
    this.parts[part] = visible;
    this.syncParts();
    this.fit();
  }
  partVisible(part) {
    return this.parts[part];
  }
  /** Mirror the chart's (price series') visibility: dim the whole line like a hidden
   *  indicator's legend row, drop the value readout (OHLC + bar change — values of a
   *  series that isn't painted), and put the show-chart eye out in its place. The
   *  parts config is untouched, so showing the chart restores the readout exactly as
   *  configured. Idempotent; {@link render} re-syncs it from the live renderer, so
   *  toggles made elsewhere (the object tree's eye) converge too. */
  setChartHidden(hidden) {
    if (hidden === this.chartHidden) return;
    this.chartHidden = hidden;
    this.el.classList.toggle("vela-sl-chart-hidden", hidden);
    this.syncParts();
    this.fit();
  }
  /** Wire the right-click action menu: one checkable toggle per part plus hide/show
   *  for the chart itself. The menu is built once; later calls just swap the hooks. */
  attachMenu(hooks) {
    this.menuHooks = hooks;
    if (this.menu) return;
    this.menu = new Menu({
      host: this.host,
      items: [],
      placement: "bottom-start",
      // Pointer-anchored action menu — checked state reads as a leading ✓ (the
      // same shape as the chart's own context menu).
      checkmarks: true,
      onSelect: (id) => this.runMenuItem(id)
    });
    this.el.addEventListener("contextmenu", this.onContextMenu);
  }
  runMenuItem(id) {
    const hooks = this.menuHooks;
    if (!hooks) return;
    if (id.startsWith("part:")) {
      const part = id.slice("part:".length);
      hooks.setPart(part, !this.parts[part]);
    } else if (id === "chart") {
      const next = !hooks.chartVisible();
      hooks.setChartVisible(next);
      this.setChartHidden(!next);
    }
  }
  /** (Re)bind to a chart instance — called after every widget rebuild. */
  onChart(chart) {
    this.detach();
    this.lastBar = null;
    this.hoverBar = null;
    this.unsubs.push(
      chart.on("bar", (b) => {
        this.lastBar = b;
        if (!this.hoverBar) this.render();
      }),
      // A replay cut or restore replaces the newest bar without a `bar` event.
      chart.on("replay:start", () => {
        this.lastBar = null;
        this.setReplaying(true);
        this.render();
      }),
      chart.on("replay:end", () => {
        this.lastBar = null;
        this.setReplaying(false);
        this.render();
      }),
      chart.renderer.onCrosshairMove((e) => {
        this.hoverBar = e.ohlc;
        this.render();
      })
    );
    this.setReplaying(chart.replay.state.active);
    this.render();
  }
  destroy() {
    this.detach();
    this.fitRO?.disconnect();
    this.fitRO = null;
    this.el.ownerDocument.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
    this.el.removeEventListener("contextmenu", this.onContextMenu);
    this.menu?.destroy();
    this.menu = null;
    this.marketTip.destroy();
    this.eyeTip.destroy();
    this.marketBubble.destroy();
    this.host.classList.remove("vela-has-statusline", "vela-sl-stacked-host");
    this.el.remove();
  }
  detach() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
  render() {
    if (this.menuHooks) this.setChartHidden(!this.menuHooks.chartVisible());
    if (this.widthKey() === this.fitKey) this.renderValues();
    else this.fit();
  }
  /** Everything the readout's width depends on, at every rung: its shape, and each
   *  value's sign, digit count and decimals (the digits themselves are tabular — see
   *  the CSS; the grouping commas follow from the digit count). `toFixed` carries all
   *  three at a fraction of the locale formatter's cost — this runs per pointer move.
   *  The parts, the host's size and the fonts re-fit through their own paths. */
  widthKey() {
    const bar = this.hoverBar ?? this.lastBar;
    if (!bar) return this.readout;
    const dp = decimalsFor(bar.close);
    const diff = bar.close - bar.open;
    const text = [bar.open, bar.high, bar.low, bar.close, diff].map((v) => v.toFixed(dp));
    text.push((diff / bar.open * 100).toFixed(2));
    return `${this.readout} ${text.join(" ")}`.replace(/\d/g, "0");
  }
  /** Write the value readout for the current bar at the current ladder level. */
  renderValues() {
    const bar = this.hoverBar ?? this.lastBar;
    if (!bar) {
      this.ohlcEl.replaceChildren();
      this.changeEl.textContent = "";
      return;
    }
    const dp = decimalsFor(bar.close);
    const doc = this.el.ownerDocument;
    const up = this.isUp ? this.isUp(bar) : bar.close >= bar.open;
    const ink = up ? this.upColor ?? "var(--vela-up)" : this.downColor ?? "var(--vela-down)";
    const cell = (k, v) => {
      const s = doc.createElement("span");
      if (k) s.append(`${k} `);
      const b = doc.createElement("b");
      b.textContent = fmtPrice(v, dp);
      b.style.color = ink;
      s.appendChild(b);
      return s;
    };
    const { level } = this.layout;
    this.ohlcEl.replaceChildren(...readoutCells(level, this.readout).map((c) => cell(c.label, bar[c.key])));
    this.changeEl.textContent = level === "minimal" ? fmtChangePct(bar.open, bar.close) : fmtChange(bar.open, bar.close);
    this.changeEl.dataset.dir = up ? "up" : "down";
    this.changeEl.style.color = ink;
  }
};

// src/widget/watermark.ts
var MAX_FONT_PX = 36;
var MIN_FONT_PX = 12;
var FILL = 0.9;
var STYLE_ID11 = "vela-widget-watermark";
var CSS11 = `
.vela-watermark {
    position: absolute;
    /* Insets follow the renderer-published gutters AND the price-pane vertical
     * bounds (mount container), so the mark centers on the PRICE PANE \u2014 never
     * the study panes below, the drawings toolbar, or the price scale. */
    top: var(--vela-price-pane-top, 0px);
    bottom: var(--vela-price-pane-bottom, 0px);
    left: var(--vela-toolbar-gutter, 0px);
    right: var(--vela-scale-gutter, 0px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    pointer-events: none;
    z-index: 1;
    color: var(--vela-fg);
    opacity: 0.05;
    font-size: ${MAX_FONT_PX}px;
    font-weight: 700;
    letter-spacing: 0.04em;
    user-select: none;
    white-space: nowrap;
}
.vela-watermark-replay {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    margin-top: 0.1em;
    font-size: 0.8em;
}
.vela-watermark [hidden] { display: none !important; }
`;
function watermarkFontPx(availPx, textPxAtMax) {
  if (textPxAtMax <= 0) return MAX_FONT_PX;
  return Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.floor(MAX_FONT_PX * availPx * FILL / textPxAtMax)));
}
var Watermark = class {
  constructor(host, symbol, timeframe) {
    this.resizeObserver = null;
    /** The host's visibility preference (the persisted watermark toggle). */
    this.shown = true;
    /** The host's preference for the replay line (its own persisted toggle). */
    this.replayShown = true;
    /** The chart is replaying past bars. */
    this.replaying = false;
    /** A bar load is in flight with nothing painted — the loading affordance owns the
     *  canvas, so the mark stays out of its way. Starts true: the FIRST `load:start`
     *  fires during chart construction, before any subscriber can see it. */
    this.loading = true;
    injectStyles(STYLE_ID11, CSS11, host.ownerDocument);
    this.el = host.ownerDocument.createElement("div");
    this.el.className = "vela-watermark";
    this.el.dataset.velaScreenshot = "under";
    this.text = host.ownerDocument.createElement("span");
    this.replayLine = host.ownerDocument.createElement("span");
    this.replayLine.className = "vela-watermark-replay";
    this.replayLine.append(iconEl("replay", host.ownerDocument), host.ownerDocument.createTextNode("Replay"));
    this.el.append(this.text, this.replayLine);
    host.appendChild(this.el);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(this.el);
    }
    this.update(symbol, timeframe);
    this.sync();
  }
  setVisible(visible) {
    this.shown = visible;
    this.sync();
  }
  /** Show/hide the replay line (the host's toggle); it only ever shows while replaying. */
  setReplayVisible(visible) {
    this.replayShown = visible;
    this.sync();
  }
  /** The chart entered or left a bar replay. */
  setReplaying(replaying) {
    this.replaying = replaying;
    this.sync();
  }
  /** Loading and the watermark never share the canvas — hidden while a load is up. */
  setLoading(loading) {
    this.loading = loading;
    this.sync();
  }
  sync() {
    const replay = this.replayShown && this.replaying;
    this.text.hidden = !this.shown;
    this.replayLine.hidden = !replay;
    this.el.style.display = (this.shown || replay) && !this.loading ? "" : "none";
  }
  update(symbol, timeframe) {
    this.text.textContent = symbol ? `${parseSymbol(symbol).ticker} \xB7 ${timeframeLabel(timeframe)}` : "";
    this.fit();
  }
  /** Measure the text at the cap and shrink it to the price pane's width. */
  fit() {
    if (this.el.clientWidth <= 0 || !this.text.textContent) return;
    this.el.style.fontSize = `${MAX_FONT_PX}px`;
    const px = watermarkFontPx(this.el.clientWidth, this.text.getBoundingClientRect().width);
    if (px !== MAX_FONT_PX) this.el.style.fontSize = `${px}px`;
  }
  destroy() {
    this.resizeObserver?.disconnect();
    this.el.remove();
  }
};

// src/widget/context-menu.ts
var PRICE_AXIS_W = 60;
var TIME_AXIS_H = 26;
var OFF_PLOT = { price: null, time: null, paneKind: null };
var ChartContextMenu = class {
  constructor(host, cbs) {
    this.cbs = cbs;
    this.chart = null;
    this.offCrosshair = null;
    /** The bound chart's latest crosshair report — a right-click always follows a pointer
     *  move to its spot, so this is where it landed. */
    this.crosshair = OFF_PLOT;
    /** {@link crosshair} as it stood when the menu opened: the pointer moves on through the
     *  menu before a row is picked, and `run` must see the right-clicked spot. */
    this.pointer = OFF_PLOT;
    this.lastZone = "body";
    /** The pane whose scale the open price-axis menu targets (null ⇒ the main scale). */
    this.lastPane = null;
    this.onContextMenu = (e) => {
      e.preventDefault();
      if (!this.chart) return;
      this.pointer = this.crosshair;
      this.lastZone = this.zoneOf(e);
      this.lastPane = this.lastZone === "price-axis" ? this.paneAt(e) : null;
      this.menu.setItems(this.itemsFor(this.lastZone));
      this.menu.openAt(e.clientX, e.clientY);
    };
    this.host = host;
    this.menu = new Menu({
      host,
      items: [],
      placement: "bottom-start",
      // Pointer-anchored action menu: checked state reads as a leading ✓, not a
      // washed row (which would read as hover in a menu with no trigger button).
      checkmarks: true,
      iconBadges: true,
      onSelect: (id) => this.run(id)
    });
    host.addEventListener("contextmenu", this.onContextMenu);
  }
  /** (Re)bind to a chart instance — called after every widget rebuild. */
  onChart(chart) {
    this.offCrosshair?.();
    this.chart = chart;
    this.crosshair = OFF_PLOT;
    this.offCrosshair = chart.renderer.onCrosshairMove((e) => {
      this.crosshair = { price: e.price, time: e.time, paneKind: e.paneKind ?? null };
    });
  }
  destroy() {
    this.offCrosshair?.();
    this.offCrosshair = null;
    this.host.removeEventListener("contextmenu", this.onContextMenu);
    this.menu.destroy();
  }
  zoneOf(e) {
    const rect = this.host.getBoundingClientRect();
    if (e.clientX - rect.left > rect.width - PRICE_AXIS_W) return "price-axis";
    if (e.clientY - rect.top > rect.height - TIME_AXIS_H) return "time-axis";
    return "body";
  }
  /** The pane under the pointer, so every pane's price scale has its own menu. */
  paneAt(e) {
    const panes = this.chart?.renderer.get("paneScales");
    if (!Array.isArray(panes)) return null;
    return paneScaleAt(panes, e.clientY - this.host.getBoundingClientRect().top);
  }
  flag(feature) {
    return Boolean(this.chart?.renderer.get(feature));
  }
  /** A fresh widget context carrying the pointer captured at open. Copied by property
   *  descriptor: the context's getters must stay LIVE, and a spread would freeze them. */
  context() {
    const ctx = this.cbs.getContext?.();
    if (!ctx) return void 0;
    return Object.create(Object.getPrototypeOf(ctx), {
      ...Object.getOwnPropertyDescriptors(ctx),
      pointer: { value: this.pointer, enumerable: true }
    });
  }
  contributed(zone) {
    return widgetActions(`context:${zone}`, this.context()).map((a) => ({
      item: { id: `action:${a.id}`, label: a.label, icon: a.icon },
      order: a.order
    }));
  }
  itemsFor(zone) {
    return composeMenu(zone, this.builtinItems(zone), this.contributed(zone));
  }
  builtinItems(zone) {
    if (zone === "price-axis") {
      const pane = this.lastPane;
      return priceAxisItems({
        auto: this.chart?.renderer.get("autoScale") !== false,
        invert: pane ? pane.invert : this.flag("invertScale"),
        choice: scaleChoiceOf(pane ?? { mode: String(this.chart?.renderer.get("scaleMode") ?? "price"), log: this.flag("logScale") }),
        axisLabels: this.flag("axisLabels"),
        priceLabel: this.flag("priceLabel"),
        countdown: this.flag("countdown"),
        priceLine: this.flag("currentPriceLine")
      });
    }
    if (zone === "time-axis") {
      return timeAxisItems(this.cbs.timezone?.() ?? String(this.chart?.renderer.get("timezone") ?? "Etc/UTC"));
    }
    const chart = this.chart;
    return bodyItems({
      drawings: chart?.drawings.supported ? chart.drawings.all().length : 0,
      indicators: chart?.indicators().length ?? 0
    });
  }
  run(id) {
    const chart = this.chart;
    if (!chart) return;
    if (id.startsWith("action:")) {
      const ctx = this.context();
      if (ctx) widgetActions(`context:${this.lastZone}`, ctx).find((a) => a.id === id.slice("action:".length))?.run(ctx);
      return;
    }
    if (id.startsWith("toggle:")) {
      const feature = id.slice("toggle:".length);
      chart.renderer.set(feature, !this.flag(feature));
    } else if (id.startsWith("scale:")) {
      for (const [feature, value] of scaleWrites(id.slice("scale:".length), this.lastPane)) chart.renderer.set(feature, value);
    } else if (id.startsWith("tz:")) {
      const zone = id.slice("tz:".length);
      if (this.cbs.setTimezone) this.cbs.setTimezone(zone);
      else chart.renderer.set("timezone", resolveTimezone(zone, void 0));
    } else if (id === "auto") {
      chart.renderer.set("autoScale", chart.renderer.get("autoScale") === false);
    } else if (id === "invert") {
      const pane = this.lastPane;
      const [feature, value] = invertWrite(!(pane ? pane.invert : this.flag("invertScale")), pane);
      chart.renderer.set(feature, value);
    } else if (id.startsWith("settings")) {
      chart.renderer.openSettings(settingsSectionOf(id));
    } else if (id === "reset-view") {
      this.cbs.resetView();
    } else if (id === "remove-drawings") {
      if (chart.drawings.supported) for (const d of chart.drawings.all()) chart.drawings.remove(d.id);
    } else if (id === "remove-indicators") {
      for (const handle of chart.indicators()) handle.remove();
    }
  }
};

// src/widget/session-shading.ts
var DAY_MS = 864e5;
var MINUTE_MS = 6e4;
function parseWindow(text, allowOvernight = false) {
  if (typeof text !== "string") return null;
  const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(text);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (end > 1440 || start >= 1440) return null;
  if (start >= end && !allowOvernight) return null;
  return { start, end };
}
function parseSessionSpec(si) {
  const session = si?.["session"];
  if (typeof session !== "string" || session === "" || session === "24x7") return null;
  const regular = parseWindow(session);
  if (!regular) return null;
  const tz = si?.["timezone"];
  const timezone = typeof tz === "string" && tz !== "" ? tz : "Etc/UTC";
  const ext = parseWindow(si?.["session_extended"], true);
  if (ext && ext.start >= ext.end) {
    if (ext.start >= regular.end && ext.end >= regular.end) return { regular, extended: ext, overnight: true, timezone };
    return { regular, extended: { start: 0, end: 1440 }, overnight: false, timezone };
  }
  const extended = ext && ext.start <= regular.start && ext.end >= regular.end ? ext : { start: 0, end: 1440 };
  return { regular, extended, overnight: false, timezone };
}
var dtfCache = /* @__PURE__ */ new Map();
function civilFormatter(tz) {
  const cached = dtfCache.get(tz);
  if (cached !== void 0) return cached;
  let dtf = null;
  try {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    dtf = null;
  }
  dtfCache.set(tz, dtf);
  return dtf;
}
function civilParts(dtf, ms) {
  const parts = dtf.formatToParts(ms);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute"))
  };
}
function mergeAbutting(bands) {
  const sorted = [...bands].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    if (e <= s) continue;
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
function expandSessionZones(spec, from, to) {
  const pre = [];
  const post = [];
  const extended = [];
  const dtf = civilFormatter(spec.timezone);
  if (!dtf || !Number.isFinite(from) || !Number.isFinite(to)) return { pre, post, extended };
  const seen = /* @__PURE__ */ new Set();
  for (let cursor = from - DAY_MS; cursor < to + DAY_MS; cursor += DAY_MS) {
    const civil = civilParts(dtf, cursor);
    const key = civil.year * 1e4 + civil.month * 100 + civil.day;
    if (!Number.isFinite(key) || seen.has(key)) continue;
    seen.add(key);
    const sunday = civil.weekday === "Sun";
    if (civil.weekday === "Sat" || sunday && !spec.overnight) continue;
    const naive = Date.UTC(civil.year, civil.month - 1, civil.day);
    const noonGuess = naive + 720 * MINUTE_MS;
    const atNoon = civilParts(dtf, noonGuess);
    const offset = Date.UTC(atNoon.year, atNoon.month - 1, atNoon.day, atNoon.hour, atNoon.minute) - noonGuess;
    const at = (minutes) => naive + minutes * MINUTE_MS - offset;
    if (spec.overnight) {
      if (!sunday) {
        extended.push([at(0), at(spec.regular.start)]);
        if (spec.regular.end < spec.extended.end) extended.push([at(spec.regular.end), at(spec.extended.end)]);
      }
      if (civil.weekday !== "Fri") extended.push([at(spec.extended.start), at(1440)]);
      continue;
    }
    if (spec.extended.start < spec.regular.start) pre.push([at(spec.extended.start), at(spec.regular.start)]);
    if (spec.regular.end < spec.extended.end) post.push([at(spec.regular.end), at(spec.extended.end)]);
  }
  return { pre, post, extended: mergeAbutting(extended) };
}
var COVER_PAD_MIN_MS = 2 * DAY_MS;
var SessionShadingTracker = class {
  constructor(onZones) {
    this.onZones = onZones;
    /** Invalidates the one async step (metadata resolution) — bumped by track()/stop(). */
    this.epoch = 0;
    this.spec = null;
    this.ready = false;
    this.session = "regular";
    /** Whether one bar is shorter than a civil day — only then do pre/post bars exist. */
    this.intraday = false;
    this.covered = null;
    /** The newest range seen — viewport moves during metadata resolution (a load's fit
     *  animation) must not be lost, so the resolution always expands the LATEST range. */
    this.lastRange = null;
  }
  /** (Re)bind to a chart's data surface + market and expand once metadata lands. */
  track(data, symbol, opts) {
    const my = ++this.epoch;
    this.ready = false;
    this.spec = null;
    this.covered = null;
    this.session = opts.session;
    const tfMs = timeframeMs(opts.timeframe);
    this.intraday = Number.isFinite(tfMs) && tfMs < DAY_MS;
    this.lastRange = opts.range;
    void data.symbolInfo(symbol).catch(() => void 0).then((si) => {
      if (my !== this.epoch) return;
      this.ready = true;
      this.spec = parseSessionSpec(si);
      this.emit(this.lastRange ?? opts.range, true);
    });
  }
  /** Follow a pan/zoom synchronously: bands are epoch-anchored, so only a range that
   *  leaves the last expansion's coverage needs a recompute — no fetch, no debounce. */
  updateRange(range) {
    this.lastRange = range;
    if (!this.ready) return;
    this.emit(range, false);
  }
  stop() {
    this.epoch += 1;
    this.ready = false;
    this.spec = null;
    this.covered = null;
    this.lastRange = null;
  }
  emit(range, force) {
    if (!this.spec) {
      if (force) this.onZones(null);
      return;
    }
    if (this.session !== "extended" || !this.intraday) {
      if (force) this.onZones({ pre: [], post: [], extended: [] });
      return;
    }
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (!force && this.covered && from >= this.covered.from && to <= this.covered.to) return;
    const pad = Math.max(to - from, COVER_PAD_MIN_MS);
    const covered = { from: from - pad, to: to + pad };
    this.covered = covered;
    this.onZones(expandSessionZones(this.spec, covered.from, covered.to));
  }
};

// src/widget/market-status.ts
function civilDate(ms, tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(ms);
  } catch {
    return "";
  }
}
function isWeekday(ms, tz) {
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(ms);
    return wd !== "Sat" && wd !== "Sun";
  } catch {
    return false;
  }
}
function deriveMarketStatus(now, w, tz, overnight = false) {
  const within = (ws) => ws.find(([s, e]) => now >= s && now < e);
  if (within(w.regular)) return "open";
  const ext = within(w.extended);
  if (ext) {
    if (overnight) return "extended";
    return w.regular.some(([s]) => s >= now && s < ext[1]) ? "pre" : "post";
  }
  if (isWeekday(now, tz)) {
    const today = civilDate(now, tz);
    if (today !== "" && !w.extended.some(([s]) => civilDate(s, tz) === today)) return "holiday";
  }
  return "closed";
}
function nextStatusBoundary(now, w) {
  let next = null;
  for (const ws of [w.regular, w.extended]) {
    for (const [s, e] of ws) {
      for (const t of [s, e]) {
        if (t > now && (next == null || t < next)) next = t;
      }
    }
  }
  return next;
}
var FETCH_BACK_MS = 4 * 864e5;
var FETCH_AHEAD_MS = 10 * 864e5;
var MIN_TIMER_MS = 15e3;
var MAX_TIMER_MS = 36e5;
var RETRY_MS = 6e4;
var MarketStatusTracker = class {
  constructor(onStatus) {
    this.onStatus = onStatus;
    /** Invalidates detached async work — bumped by every track()/stop(). */
    this.epoch = 0;
    this.timer = null;
  }
  /** (Re)bind to a chart's data surface + symbol and start evaluating. */
  track(data, symbol) {
    const my = ++this.epoch;
    this.clearTimer();
    void this.evaluate(my, data, symbol);
  }
  stop() {
    this.epoch += 1;
    this.clearTimer();
  }
  async evaluate(my, data, symbol) {
    const resolved = data.resolve(symbol);
    const provider = resolved ? data.providerInstance(resolved.provider) : void 0;
    const si = await data.symbolInfo(symbol).catch(() => void 0);
    if (my !== this.epoch) return;
    const hasSessions = typeof si?.session === "string" && si.session !== "" && si.session !== "24x7";
    if (!provider?.getCalendar || !hasSessions || !resolved) {
      this.onStatus("open");
      return;
    }
    const tz = typeof si?.timezone === "string" && si.timezone !== "" ? si.timezone : "Etc/UTC";
    const now = Date.now();
    const range = { from: now - FETCH_BACK_MS, to: now + FETCH_AHEAD_MS };
    const [regular, extended] = await Promise.all([
      provider.getCalendar(resolved.ticker, { ...range, session: "regular" }).catch(() => null),
      provider.getCalendar(resolved.ticker, { ...range, session: "extended" }).catch(() => null)
    ]);
    if (my !== this.epoch) return;
    if (!regular || !extended) {
      this.arm(my, data, symbol, RETRY_MS);
      return;
    }
    const w = { regular, extended };
    const overnight = parseSessionSpec(si)?.overnight === true;
    this.onStatus(deriveMarketStatus(now, w, tz, overnight));
    const boundary = nextStatusBoundary(now, w);
    const delay = Math.min(boundary != null ? boundary - now : MAX_TIMER_MS, MAX_TIMER_MS);
    this.arm(my, data, symbol, Math.max(delay, MIN_TIMER_MS));
  }
  arm(my, data, symbol, delay) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (my !== this.epoch) return;
      void this.evaluate(my, data, symbol);
    }, delay);
  }
  clearTimer() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }
};

// src/widget/glide.ts
var MIN_SPAN_MS = 6e4;
var FOLLOW = 0.25;
var ZOOM_IN = 0.8;
var ZOOM_OUT = 1.25;
var PAN_FAST = 0.2;
function zoomTarget(base, factor) {
  const newSpan = Math.max(MIN_SPAN_MS, (base.to - base.from) * factor);
  return { from: base.to - newSpan, to: base.to };
}
function followStep(cur, target, follow = FOLLOW, epsFrac = 15e-4) {
  const eps = Math.max(MIN_SPAN_MS, (target.to - target.from) * epsFrac);
  const nf = cur.from + (target.from - cur.from) * follow;
  const nt = cur.to + (target.to - cur.to) * follow;
  const done = Math.abs(target.from - nf) <= eps && Math.abs(target.to - nt) <= eps;
  return { cur: done ? { ...target } : { from: nf, to: nt }, done };
}
function zoomAnimated(chart) {
  const control = chart.renderer;
  if (!control || !control.supports("animZoom")) return true;
  return Boolean(control.get("animZoom"));
}
var Glider = class {
  constructor(chart) {
    this.chart = chart;
    // The glide eases ITS OWN range, never the chart's read-back: getVisibleRange()
    // is data-bounded (whole bars, `to` capped at the newest bar) and the renderer
    // clamps what gets applied — chasing that read-back can never converge on a
    // clamped step, leaving the rAF loop re-applying a stale target forever (and
    // grinding the span down when panning past the newest bar). The internal range
    // converges geometrically, so the glide always terminates; the renderer is free
    // to clamp each applied frame.
    this.cur = null;
    this.target = null;
    this.raf = 0;
  }
  zoom(factor) {
    this.to((base) => zoomTarget(base, factor));
  }
  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cur = null;
    this.target = null;
  }
  to(make) {
    const chart = this.chart();
    const base = this.target ?? chart?.getVisibleRange();
    if (!chart || !base) return;
    const target = make(base);
    if (!zoomAnimated(chart)) {
      this.stop();
      chart.setVisibleRange(target);
      return;
    }
    this.cur ?? (this.cur = { ...base });
    this.target = target;
    if (!this.raf) this.tick();
  }
  tick() {
    this.raf = requestAnimationFrame(() => {
      const chart = this.chart();
      if (!chart || !this.cur || !this.target) {
        this.stop();
        return;
      }
      const { cur: next, done } = followStep(this.cur, this.target);
      this.cur = next;
      chart.setVisibleRange(next);
      if (done) this.stop();
      else this.tick();
    });
  }
};

// src/widget/cell-controls.ts
var CELL_CONTROLS_PROXIMITY_PX = 120;
var TIME_AXIS_H2 = 22;
var CONTROLS_BOTTOM_PX = TIME_AXIS_H2 + 12;
var CLUSTER_H = 24;
var CLUSTER_PILL = "rgba(0,0,0,0.65)";
var CLUSTER_LEFT_CSS = "calc((100% + var(--vela-toolbar-gutter, 0px) - var(--vela-scale-gutter, 0px)) / 2)";
var STYLE_ID12 = "vela-cell-controls";
var CSS12 = `
.vela-cc-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:var(--vela-radius-sm);background:transparent;line-height:0;font-size:12px;color:var(--vela-fg-muted);cursor:pointer;}
.vela-cc-btn svg{display:block;}
.vela-cc-btn:hover{background:var(--vela-active);color:var(--vela-fg-bright);}
.vela-cc-on,.vela-cc-on:hover{background:var(--vela-selected-bg);color:var(--vela-selected-fg);}
.vela-cc-grip{cursor:grab;touch-action:none;}
.vela-cc-grip:active{cursor:grabbing;}
`;
function plotCenterX(width, toolbarGutter = 0, scaleGutter = 0) {
  return (width + toolbarGutter - scaleGutter) / 2;
}
function nearBottomCenter(x, y, width, height, proximityPx = CELL_CONTROLS_PROXIMITY_PX, gutters = {}) {
  const cx = plotCenterX(width, gutters.toolbar ?? 0, gutters.scale ?? 0);
  const cy = height - CONTROLS_BOTTOM_PX - CLUSTER_H / 2;
  return Math.hypot(x - cx, y - cy) <= proximityPx;
}
var CellControls = class {
  constructor(host, deps) {
    this.host = host;
    this.deps = deps;
    this.near = false;
    /** A grip drag is underway — the proximity reveal must not hide the cluster
     *  while captured pointer moves sweep across the whole grid. */
    this.dragging = false;
    /** Mobile: the proximity reveal is meaningless without a cursor — the mobile
     *  bar's maximize stop replaces the cluster. */
    this.suspended = false;
    this.onHostMove = (e) => {
      if (this.suspended) return;
      if (this.dragging) return;
      const rect = this.host.getBoundingClientRect();
      this.setNear(nearBottomCenter(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height, CELL_CONTROLS_PROXIMITY_PX, this.hostGutters()));
    };
    this.onHostLeave = () => {
      if (this.dragging) return;
      this.setNear(false);
    };
    injectStyles(STYLE_ID12, CSS12, host.ownerDocument);
    this.glider = new Glider(deps.chart);
    this.root = host.ownerDocument.createElement("div");
    Object.assign(this.root.style, {
      position: "absolute",
      left: CLUSTER_LEFT_CSS,
      bottom: `${CONTROLS_BOTTOM_PX}px`,
      transform: "translateX(-50%)",
      zIndex: "6",
      display: "none",
      // revealed by cursor proximity (onHostMove)
      gap: "2px",
      padding: "2px",
      borderRadius: "var(--vela-radius-md)",
      background: CLUSTER_PILL,
      pointerEvents: "auto"
    });
    this.host.addEventListener("pointermove", this.onHostMove);
    this.host.addEventListener("pointerleave", this.onHostLeave);
    this.host.appendChild(this.root);
    this.refresh();
  }
  /** Rebuild the buttons (the multi-cell gate or the maximized state changed). */
  refresh() {
    this.root.textContent = "";
    const multi = this.deps.multiCell();
    const maximized = multi && this.deps.isMaximized();
    if (multi && !maximized) this.root.appendChild(this.makeGrip());
    this.root.appendChild(this.button("minus", "Zoom out", () => this.glider.zoom(ZOOM_OUT)));
    this.root.appendChild(this.button("plus", "Zoom in", () => this.glider.zoom(ZOOM_IN)));
    if (multi) {
      this.root.appendChild(
        this.button(maximized ? "restore" : "maximize", maximized ? "Restore layout" : "Maximize chart", () => this.deps.toggleMaximize(), {
          // The maximized state reads as an inverse chip (white-on-dark, dark-on-light),
          // the same active-state affordance as a collapsed pane's expand button.
          selected: maximized
        })
      );
    }
    this.root.appendChild(
      this.button("reset", "Reset chart", () => {
        this.glider.stop();
        this.deps.reset();
      })
    );
  }
  button(iconId, title, onClick, opts = {}) {
    const b = this.host.ownerDocument.createElement("button");
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.className = opts.selected === true ? "vela-cc-btn vela-cc-on" : "vela-cc-btn";
    b.innerHTML = icon(iconId);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }
  /** The drag handle (2×3 dot grip): press and drag onto another cell to trade
   *  slots with it. The preview highlight follows the pointer; releasing outside
   *  any other cell cancels. */
  makeGrip() {
    const b = this.host.ownerDocument.createElement("button");
    b.type = "button";
    b.title = "Drag to move chart";
    b.setAttribute("aria-label", "Drag to move chart");
    b.className = "vela-cc-btn vela-cc-grip";
    b.innerHTML = icon("grip");
    b.addEventListener("pointerdown", (e) => this.onGripDown(b, e));
    return b;
  }
  onGripDown(btn, e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
    }
    this.dragging = true;
    let target = null;
    const move = (ev) => {
      target = this.deps.dragTargetAt(ev.clientX, ev.clientY);
      this.deps.previewDrop(target);
    };
    const finish = (commit) => () => {
      this.dragging = false;
      this.deps.previewDrop(null);
      btn.removeEventListener("pointermove", move);
      btn.removeEventListener("pointerup", onUp);
      btn.removeEventListener("pointercancel", onCancel);
      if (commit && target != null) this.deps.dropOn(target);
    };
    const onUp = finish(true);
    const onCancel = finish(false);
    btn.addEventListener("pointermove", move);
    btn.addEventListener("pointerup", onUp);
    btn.addEventListener("pointercancel", onCancel);
  }
  /** Mobile flips the cluster off entirely (and hides it if currently revealed). */
  setSuspended(on) {
    this.suspended = on;
    if (on) this.setNear(false);
  }
  /** Live renderer gutters on the cell host (0 when unpublished — a test stub). */
  hostGutters() {
    const view = this.host.ownerDocument.defaultView;
    if (!view) return { toolbar: 0, scale: 0 };
    const cs = view.getComputedStyle(this.host);
    return {
      toolbar: Number.parseFloat(cs.getPropertyValue("--vela-toolbar-gutter")) || 0,
      scale: Number.parseFloat(cs.getPropertyValue("--vela-scale-gutter")) || 0
    };
  }
  setNear(near) {
    if (near === this.near) return;
    this.near = near;
    this.root.style.display = near ? "flex" : "none";
  }
  destroy() {
    this.glider.stop();
    this.host.removeEventListener("pointermove", this.onHostMove);
    this.host.removeEventListener("pointerleave", this.onHostLeave);
    this.root.remove();
  }
};

// src/widget/history.ts
var WidgetHistory = class {
  /** `getChart` late-resolves the CURRENT chart: drawing steps recorded before a chart
   *  rebuild must undo on the chart that exists when the user presses Ctrl+Z, not on a
   *  destroyed instance captured at record time. */
  constructor(getChart = () => null) {
    this.getChart = getChart;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = /* @__PURE__ */ new Set();
    this.unsubs = [];
    this.muted = false;
  }
  /** Record a reversible action (a fresh edit forks history: redo branch clears). */
  push(action) {
    if (this.muted) return;
    this.undoStack.push(action);
    this.redoStack.length = 0;
    this.notify();
  }
  undo() {
    const a = this.undoStack.pop();
    if (!a) return;
    this.mutedRun(() => a.undo());
    this.redoStack.push(a);
    this.notify();
  }
  redo() {
    const a = this.redoStack.pop();
    if (!a) return;
    this.mutedRun(() => a.redo());
    this.undoStack.push(a);
    this.notify();
  }
  /** Run `fn` without recording — for programmatic state application (setState,
   *  ledger restore), whose indicator/drawing events are not user edits. */
  silently(fn) {
    this.mutedRun(fn);
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  /** (Re)bind to a chart: drawing edits enter the unified stack as delegate steps. */
  onChart(chart) {
    for (const u of this.unsubs) u();
    this.unsubs = [
      chart.on("drawing:created", () => this.pushDrawingStep()),
      chart.on("drawing:edited", () => this.pushDrawingStep()),
      chart.on("drawing:removed", () => this.pushDrawingStep())
    ];
  }
  destroy() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.listeners.clear();
  }
  pushDrawingStep() {
    this.push({ undo: () => this.getChart()?.drawings.undo(), redo: () => this.getChart()?.drawings.redo() });
  }
  /** Replaying an action must not re-record the drawing events it triggers. */
  mutedRun(fn) {
    this.muted = true;
    try {
      fn();
    } finally {
      this.muted = false;
    }
  }
  notify() {
    for (const cb of this.listeners) cb();
  }
};

// src/workspace/ChartCell.ts
function seedDefaults(opts) {
  return {
    symbol: opts.symbol,
    timeframe: opts.timeframe,
    bars: opts.bars,
    priceStyle: opts.priceStyle,
    session: opts.session,
    data: opts.data,
    visibleRange: opts.visibleRange
  };
}
function cellChartDefaults(opts) {
  const { renderer, defaultLanguage, currentPriceLine, logScale, animations, glow, upColor, downColor, drawings, settings, priceAxis } = opts;
  return { renderer, defaultLanguage, currentPriceLine, logScale, animations, glow, upColor, downColor, drawings, settings, priceAxis };
}
function cellDrawings(opt) {
  if (opt === false) return false;
  if (opt === true || opt == null) return { toolbar: false };
  return { ...opt, toolbar: false };
}
function nativeLedgerEntry(handle) {
  const inputs = inputDeltas(handle.inputs, handle.inputValues());
  const hidden = !handle.visible;
  return inputs || hidden ? { type: handle.nativeType, ...inputs ? { inputs } : {}, ...hidden ? { hidden: true } : {} } : handle.nativeType;
}
function instanceDeltas(handle) {
  if (!handle) return void 0;
  const inputs = inputDeltas(handle.inputs, handle.inputValues());
  const props = inputDeltas(handle.props, handle.propValues());
  return inputs || props ? { ...inputs ? { inputs } : {}, ...props ? { props } : {} } : void 0;
}
var ChartCell = class {
  constructor(id, gridHost, seed, deps) {
    this.id = id;
    this.deps = deps;
    /** This cell's unified app+drawings undo timeline (the shared Ctrl+Z routes here). */
    this.history = new WidgetHistory(() => this.inner);
    /** Live manifest-indicator instances on this cell (the SAME entry may repeat).
     *  `external` marks instances added through the public seam (`ctx.addIndicator`)
     *  rather than the shell manifest — they share the undo/redo and picker plumbing
     *  but stay OUT of the persisted ledger (their names would never resolve against
     *  the manifest); persisting them is their plugin's job (`registerStatePersistence`). */
    this.instances = [];
    /** The native-indicator catalog with this cell's live supported/present flags. */
    this.nativeCatalog = [];
    /** Last crosshair position in this cell (the alt+H/alt+V shortcuts anchor here). */
    this.lastCrossTime = null;
    this.lastCrossPrice = null;
    /** The bottombar range chip this cell is framed on (null = none). */
    this.activeRangeId = null;
    /** Latched verdict of {@link sessionAvailable} (async metadata, sticky per symbol). */
    this.sessionAvailableFlag = false;
    /** The symbol of the most recent metadata probe — an older one landing late is dropped. */
    this.metadataProbeSymbol = null;
    /** Latched: the symbol's extended tape wraps midnight (an overnight roll market) —
     *  one extended-hours shading phase instead of the pre/post split. */
    this.sessionOvernightFlag = false;
    /** Keeps the session shading on the symbol's real calendar (see {@link SessionShadingTracker}). */
    this.sessionShading = new SessionShadingTracker((zones) => this.inner?.renderer.set("sessionZones", zones));
    this.manifest = [];
    /** A restored ledger's manifest entry NAMES, waiting for the manifest to resolve
     *  (a pool/persisted cell can be built before the shared manifest has loaded). */
    this.pendingManifestNames = null;
    /** The volume auto-add rides the cell's first candles (`load:end`); until then the
     *  registry can't show it and the dehydrated ledger reports the INTENT instead. */
    this.volumeMayBePending = true;
    /** Sync mirror of the chart's native instances (id + type) — the removal handler
     *  looks the removed id up here to learn which type an undo must re-add. */
    this.presentNatives = [];
    this.rangeBars = 0;
    this.pendingRange = null;
    /** Last symbol we toasted "no provider serves this" for — once per symbol (the
     *  core re-reports on every provider-index settle). */
    this.unresolvedToasted = null;
    /** The cell's third-party state bag (`ext` of the persisted per-chart state) —
     *  seeded from the boot/restored document, refreshed by handler `serialize` calls at
     *  dehydrate time. Entries with no registered handler this session ride along
     *  verbatim, so a document never loses a plugin's state in the plugin's absence. */
    this.extState = {};
    /** Indicator titles (this cell's in-chart legend rows) shown. */
    this.indicatorTitlesOn = true;
    /** Plot values beside this cell's legend titles shown. */
    this.indicatorValuesOn = true;
    this.destroyed = false;
    this.appTheme = deps.theme;
    const symbol = prefixedSymbol(seed);
    this.state = {
      symbol,
      provider: parseSymbol(symbol ?? "").provider ?? void 0,
      timeframe: seed.timeframe,
      priceStyle: seed.priceStyle,
      bars: seed.bars,
      session: normalizeSession(seed.session)
    };
    const doc = gridHost.ownerDocument;
    this.host = doc.createElement("div");
    this.host.className = "vela-cell";
    this.host.dataset.cellId = id;
    this.host.style.cssText = "position:relative;overflow:hidden;";
    this.host.addEventListener("pointerdown", () => this.deps.activate(id), true);
    this.host.addEventListener("focusin", () => this.deps.activate(id));
    gridHost.appendChild(this.host);
    this.inner = new Vela(
      this.host,
      {
        ...deps.chartDefaults,
        symbol,
        timeframe: seed.timeframe,
        bars: seed.bars,
        priceStyle: seed.priceStyle,
        session: normalizeSession(seed.session),
        data: seed.data,
        visibleRange: seed.visibleRange,
        theme: deps.theme,
        live: deps.live,
        // A RESTORED ledger is authoritative for the auto-added volume too: a
        // slot persisted without it must come back without it (fresh slots
        // keep the workspace default).
        volume: seed.indicators ? seed.indicators.natives.some((e) => ledgerNativeType(e) === "volume") : deps.volume,
        nativeBackend: deps.nativeBackend,
        // The user's drawings option minus its toolbar: one SHARED bar serves
        // the whole workspace (per-cell bars would cost a 44px gutter each).
        drawings: cellDrawings(deps.chartDefaults.drawings),
        // The renderer's own Time zone row edits a resolved IANA zone; the cell
        // contributes the workspace picker instead (`time-zone`, with the
        // exchange rule — see pushSettingsSections).
        settings: { ...deps.chartDefaults.settings, hidden: [...deps.chartDefaults.settings?.hidden ?? [], "symbol.timezone"] }
      },
      { dataFeed: deps.feed }
    );
    for (const [language, make] of Object.entries(resolveEngines(deps.engines))) this.inner.registerEngine(language, make());
    this.inner.renderer.set("attribution", false);
    this.inner.renderer.set("dialogHost", deps.dialogHost);
    this.inner.renderer.setLegendActions(legendActionsProviderFor(this.inner, () => deps.context()));
    this.inner.renderer.setLegendCallouts(legendCalloutsProviderFor(this.inner, () => deps.context()));
    if (this.inner.renderer.supports("historyChords")) this.inner.renderer.set("historyChords", false);
    this.history.onChart(this.inner);
    this.inner.renderer.onConfigChanged(() => {
      const zone = this.inner?.renderer.get("timezone");
      if (typeof zone === "string" && normalizeTimezone(zone) !== normalizeTimezone(this.displayTimezone)) {
        this.deps.setTimezone(normalizeTimezone(zone));
      }
      const style = this.priceStyle;
      if (style !== (this.state.priceStyle ?? "candles")) {
        this.state.priceStyle = style;
        this.deps.onPriceStyleChanged(this.id);
      }
      this.syncStatuslineColors();
      this.syncPlotOverlayTokens();
    });
    this.inner.on("theme:changed", (t) => {
      this.appTheme = t;
      this.syncPlotOverlayTokens();
    });
    this.syncPlotOverlayTokens();
    if (seed.rendererConfig != null) this.inner.renderer.applyConfig(seed.rendererConfig);
    if (seed.drawings != null) this.inner.drawings.fromJSON(seed.drawings);
    if (seed.indicators) {
      for (const entry of seed.indicators.natives) {
        const handle = this.inner.addNativeIndicator(ledgerNativeType(entry));
        this.applyNativeLedgerEntry(handle, entry);
      }
      this.pendingManifestNames = [...seed.indicators.manifest];
    }
    this.volumeIntent = seed.indicators ? seed.indicators.natives.some((e) => ledgerNativeType(e) === "volume") : deps.volume;
    this.extState = { ...seed.ext ?? {} };
    this.inner.on("load:end", () => {
      this.volumeMayBePending = false;
    });
    this.inner.on("data:unresolved", ({ symbol: symbol2, providers }) => {
      if (this.unresolvedToasted === symbol2) return;
      this.unresolvedToasted = symbol2;
      const list = providers.length > 0 ? providers.join(", ") : "none";
      this.deps.toast(`No registered provider serves "${symbol2}" (registered: ${list})`, "error", 6e3);
    });
    this.inner.on("load:start", ({ symbol: symbol2 }) => {
      this.watermark?.setLoading(true);
      this.refreshSymbolMetadata(symbol2);
    });
    this.inner.on("load:end", () => {
      this.watermark?.setLoading(false);
      this.refreshSessionShading();
    });
    this.inner.on("viewport:changed", (range) => this.sessionShading.updateRange(range));
    this.applyTimezone();
    this.indicatorTitlesOn = seed.indicatorTitles ?? true;
    if (!this.indicatorTitlesOn) this.inner.renderer.set("indicatorTitles", false);
    this.indicatorValuesOn = seed.indicatorValues ?? true;
    if (!this.indicatorValuesOn) this.inner.renderer.set("indicatorValues", false);
    this.watermarkOn = seed.watermark ?? deps.watermark;
    this.replayWatermarkOn = seed.replayWatermark ?? true;
    this.watermark = deps.watermark ? new Watermark(this.host, symbol ?? "", seed.timeframe ?? "60") : null;
    if (!this.watermarkOn) this.watermark?.setVisible(false);
    if (!this.replayWatermarkOn) this.watermark?.setReplayVisible(false);
    this.inner.on("replay:start", () => this.watermark?.setReplaying(true));
    this.inner.on("replay:end", () => this.watermark?.setReplaying(false));
    this.statusline = deps.statusline ? new Statusline(this.host, symbol ?? "", (sym) => this.inner?.data.symbolIcon(sym)) : null;
    this.statusline?.setMeta(seed.timeframe ?? "60", this.state.provider ?? "");
    this.statusline?.onChart(this.inner);
    this.statusline?.attachMenu({
      setPart: (part, visible) => this.setStatuslinePart(part, visible),
      chartVisible: () => this.inner?.renderer.get("candleVisible") !== false,
      setChartVisible: (visible) => this.inner?.renderer.set("candleVisible", visible)
    });
    this.marketStatus = this.statusline ? new MarketStatusTracker((s) => this.statusline?.setMarketStatus(s)) : null;
    void this.inner.data.ready().then(() => {
      if (this.inner && this.state.symbol) {
        this.statusline?.setSymbol(this.state.symbol);
        this.statusline?.setMeta(this.state.timeframe ?? "60", this.inner.data.displayPrefix(this.state.symbol) ?? this.state.provider ?? "");
      }
      this.refreshSymbolMetadata();
      if (this.inner && this.state.symbol) this.marketStatus?.track(this.inner.data, this.state.symbol);
    });
    this.syncStatuslineColors();
    this.cellControls = new CellControls(this.host, {
      chart: () => this.inner,
      reset: () => this.resetView(),
      multiCell: () => deps.multiCell(),
      isMaximized: () => deps.isMaximized(id),
      toggleMaximize: () => deps.toggleMaximize(id),
      dragTargetAt: (x, y) => deps.cellDragTarget(id, x, y),
      previewDrop: (target) => deps.previewDropTarget(target),
      dropOn: (target) => deps.dropCell(id, target)
    });
    this.contextMenu = new ChartContextMenu(this.host, {
      resetView: () => this.resetView(),
      timezone: () => this.deps.timezone(),
      setTimezone: (zone) => this.deps.setTimezone(zone),
      // Right-clicking activates the cell first (capture-phase pointerdown), so the
      // context the actions receive is this cell's — the active one.
      getContext: () => this.deps.context()
    });
    this.contextMenu.onChart(this.inner);
    this.inner.renderer.onCrosshairMove((e) => {
      this.lastCrossTime = e.time;
      this.lastCrossPrice = e.price;
    });
    this.inner.on("indicator:added", () => {
      this.syncPresentNatives();
      this.refreshNativeCatalog();
    });
    this.inner.on("indicator:inputs", () => this.deps.onStateDirty());
    this.inner.on("indicator:visibility", () => this.deps.onStateDirty());
    this.inner.on("indicator:removed", ({ id: id2 }) => {
      if (this.destroyed) return;
      const idx = this.instances.findIndex((it) => it.handle?.id === id2);
      if (idx >= 0) {
        const snapshot = this.instances[idx];
        this.instances.splice(idx, 1);
        this.history.push({
          undo: () => {
            snapshot.handle = this.addToChart(snapshot.entry, snapshot.values);
            this.instances.push(snapshot);
            this.deps.onIndicatorsChanged(this.id);
          },
          redo: () => this.dropInstance(snapshot)
        });
      } else {
        const gone = this.presentNatives.find((n) => n.id === id2);
        if (gone) {
          const { type } = gone;
          let revived = null;
          this.history.push({
            undo: () => {
              revived = this.inner?.addNativeIndicator(type) ?? null;
              this.refreshNativeCatalog();
            },
            redo: () => {
              revived?.remove();
              revived = null;
              this.refreshNativeCatalog();
            }
          });
        }
      }
      this.syncPresentNatives();
      this.refreshNativeCatalog();
    });
    this.syncPresentNatives();
    this.refreshNativeCatalog();
    this.pushSettingsSections();
    this.offMarket = this.inner.on("market:changed", ({ symbol: symbol2, timeframe }) => {
      this.projectMarket(symbol2, timeframe);
      this.refreshNativeCatalog();
      this.refreshSymbolMetadata();
      if (this.inner) this.marketStatus?.track(this.inner.data, symbol2);
      this.deps.onMarketChanged(this.id);
    });
  }
  /**
   * Project a market identity into the cell state and its display overlays (watermark,
   * statusline), WITHOUT the data-dependent bookkeeping. Runs twice per user pick: once
   * optimistically from the cell setters — the labels reflect the pick immediately, not
   * after the bars load — and again from `market:changed` (the committed pass, and the
   * only pass for host `chart.setMarket` calls). Idempotent, so the double run converges.
   */
  projectMarket(symbol, timeframe) {
    this.state.symbol = symbol;
    this.state.provider = parseSymbol(symbol).provider ?? void 0;
    this.state.timeframe = timeframe;
    this.state.session = normalizeSession(this.inner?.market.session);
    this.watermark?.update(symbol, timeframe);
    this.statusline?.setSymbol(symbol);
    this.statusline?.setMeta(timeframe, this.inner?.data.displayPrefix(symbol) ?? this.state.provider ?? "");
    if (this.inner) this.statusline?.onChart(this.inner);
  }
  /**
   * Does this cell's market HAVE sessions (RTH/ETH meaningful)? Derived from the
   * symbol's own metadata (`syminfo.session !== '24x7'`), asynchronously — the
   * workspace re-projects the shared bottombar when the verdict lands or changes.
   */
  get sessionAvailable() {
    return this.sessionAvailableFlag;
  }
  /** This cell's shown session (`regular` when unset — the provider default). */
  get session() {
    return normalizeSession(this.state.session) ?? "regular";
  }
  /** Switch this cell's shown session in place (a reload — RTH and ETH are different bars). */
  setSession(session) {
    if (session === this.session) return;
    this.state.session = session;
    this.deps.onStateDirty();
    void this.inner?.setMarket({ session });
  }
  /**
   * The symbol's own trading zone, once its metadata has landed — what the exchange
   * rule resolves to on this cell (the workspace labels the shared bottom bar with the
   * ACTIVE cell's). Undefined = unknown or undeclared (the rule then renders UTC).
   */
  get exchangeTimezone() {
    return this.exchangeZone;
  }
  /** The IANA zone this cell's axis renders in: the workspace choice, resolved. */
  get displayTimezone() {
    return resolveTimezone(this.deps.timezone(), this.exchangeZone);
  }
  /**
   * Push the resolved zone to the renderer — on the workspace choice changing, and on
   * this cell's market zone changing under the exchange rule. Skips the write when the
   * renderer already holds it (its config default is the bare `'UTC'` alias).
   */
  applyTimezone() {
    const chart = this.inner;
    if (!chart) return;
    const zone = this.displayTimezone;
    const current = chart.renderer.get("timezone");
    const held = typeof current === "string" && current ? current : "UTC";
    if (normalizeTimezone(held) === normalizeTimezone(zone)) return;
    chart.renderer.set("timezone", zone);
  }
  /** Re-read the symbol's metadata: session posture (RTH/ETH toggle, shading) and its
   *  trading zone (the exchange rule). Async — the workspace re-projects when a verdict lands. */
  refreshSymbolMetadata(symbol = this.state.symbol, retry = true) {
    const chart = this.inner;
    if (!chart || !symbol) return;
    this.metadataProbeSymbol = symbol;
    void chart.data.symbolInfo(symbol).then((si) => {
      if (this.inner !== chart || this.metadataProbeSymbol !== symbol) return;
      if (si === void 0 && retry) {
        void chart.data.ready().then(() => {
          if (this.inner === chart && this.metadataProbeSymbol === symbol) this.refreshSymbolMetadata(symbol, false);
        });
        return;
      }
      if (this.state.symbol !== symbol) return;
      const available = typeof si?.session === "string" && si.session !== "" && si.session !== "24x7";
      const overnight = parseSessionSpec(si)?.overnight === true;
      const zone = typeof si?.timezone === "string" && si.timezone !== "" ? si.timezone : void 0;
      const zoneChanged = zone !== this.exchangeZone;
      if (zoneChanged) {
        this.exchangeZone = zone;
        this.applyTimezone();
      }
      if (available !== this.sessionAvailableFlag || overnight !== this.sessionOvernightFlag || zoneChanged) {
        this.sessionAvailableFlag = available;
        this.sessionOvernightFlag = overnight;
        this.deps.onMarketChanged(this.id);
        this.pushSettingsSections();
      }
      this.refreshSessionShading();
    });
  }
  /** (Re)derive the pre/post-market shading bands for this cell's market. The bands
   *  expand locally from the symbol's session vocabulary, so they paint as soon as
   *  metadata is known and follow any pan depth without provider round trips. */
  refreshSessionShading() {
    const chart = this.inner;
    const symbol = this.state.symbol;
    if (!chart || !symbol) return;
    const now = Date.now();
    const requestedSpan = Math.max(this.state.bars ?? 1e3, this.rangeBars) * timeframeMs(this.state.timeframe ?? "60");
    const fallbackSpan = Number.isFinite(requestedSpan) ? Math.max(3 * 864e5, requestedSpan) : 3 * 864e5;
    const range = chart.getVisibleRange() ?? { from: now - fallbackSpan, to: now };
    this.sessionShading.track(chart.data, symbol, { session: this.session, timeframe: this.timeframe, range });
  }
  /** The session-shade colors live in the renderer CONFIG (persisted with it, edited
   *  live by the dialog swatch) — the cell only proxies them into its settings rows. */
  sessionShadeColor(key) {
    const cfg = this.inner?.renderer.getConfig();
    const v = cfg?.sessions?.[key];
    return typeof v === "string" ? v : "";
  }
  setSessionShadeColor(key, color) {
    this.inner?.renderer.applyConfig({ sessions: { [key]: color } });
    this.deps.onStateDirty();
  }
  /**
   * (Re)contribute this cell's settings-dialog sections: status line parts, the
   * per-cell fetch depth, the watermark toggle, and — only while the cell's symbol
   * HAS sessions — the Trading session group (RTH/ETH switch + the session shading
   * colors: pre/post-market on day-split tapes, one extended-hours swatch on
   * overnight roll markets) inside the Symbol tab. Bars/watermark/titles are
   * persistable cell state; a depth-only reload is silent, so mark dirty here.
   * Re-run whenever a gate changes (the dialog reads the sections on open).
   */
  pushSettingsSections() {
    const chart = this.inner;
    if (!chart) return;
    const rth = "Regular hours (RTH)";
    const eth = "Extended hours (ETH)";
    const shadeRows = this.sessionOvernightFlag ? [
      {
        kind: "color",
        label: "Extended hours",
        id: "extended-color",
        get: () => this.sessionShadeColor("extendedColor"),
        set: (v) => this.setSessionShadeColor("extendedColor", v)
      }
    ] : [
      {
        kind: "color",
        label: "Pre-market",
        id: "premarket-color",
        get: () => this.sessionShadeColor("premarketColor"),
        set: (v) => this.setSessionShadeColor("premarketColor", v)
      },
      {
        kind: "color",
        label: "Post-market",
        id: "postmarket-color",
        get: () => this.sessionShadeColor("postmarketColor"),
        set: (v) => this.setSessionShadeColor("postmarketColor", v)
      }
    ];
    const sessionSection = {
      title: "Trading session",
      id: "trading-session",
      placement: "symbol",
      rows: [
        {
          kind: "select",
          label: "Session",
          id: "session",
          options: [rth, eth],
          get: () => this.session === "extended" ? eth : rth,
          set: (v) => this.setSession(v === eth ? "extended" : "regular")
        },
        ...shadeRows
      ]
    };
    const advanced = {
      title: "Advanced",
      id: "advanced",
      placement: "end",
      rows: [
        {
          kind: "select",
          label: "Bars to fetch",
          id: "bars",
          options: ["500", "1000", "2000", "5000", "10000", "20000", "50000", "60000", "80000", "100000"],
          get: () => String(this.state.bars ?? 1e3),
          set: (v) => {
            this.state.bars = Number(v);
            this.deps.onStateDirty();
            void this.inner?.setMarket({ bars: Math.max(this.state.bars, this.rangeBars) });
          }
        }
      ]
    };
    const timezoneSection = {
      title: "Time zone",
      id: "time-zone",
      placement: "symbol",
      rows: [
        {
          kind: "select",
          label: "Time zone",
          id: "zone",
          options: timezoneMenuRows(this.deps.timezone()).map((r) => [r.value, r.label]),
          get: () => {
            const choice = this.deps.timezone();
            return isExchangeTimezone(choice) ? choice : normalizeTimezone(choice);
          },
          set: (v) => this.deps.setTimezone(v)
        }
      ]
    };
    const watermarkSection = {
      title: "Watermark",
      id: "watermark",
      placement: "symbol",
      rows: [
        {
          kind: "toggle",
          label: "Symbol watermark",
          id: "visible",
          get: () => this.watermarkOn,
          set: (v) => this.setWatermarkVisible(v)
        },
        {
          kind: "toggle",
          label: "Replay watermark",
          id: "replay",
          get: () => this.replayWatermarkOn,
          set: (v) => this.setReplayWatermarkVisible(v)
        }
      ]
    };
    const sections = [];
    if (this.statusline) {
      const sl = this.statusline;
      sections.push({
        title: "Status line",
        id: "status-line",
        rows: [
          { kind: "heading", label: "Status line", id: "parts" },
          {
            kind: "toggle",
            label: "Symbol name",
            id: "name",
            get: () => sl.partVisible("name"),
            set: (v) => this.setStatuslinePart("name", v)
          },
          {
            kind: "toggle",
            label: "Market status",
            id: "market",
            get: () => sl.partVisible("market"),
            set: (v) => this.setStatuslinePart("market", v)
          },
          {
            kind: "toggle",
            label: "OHLC values",
            id: "ohlc",
            get: () => sl.partVisible("ohlc"),
            set: (v) => this.setStatuslinePart("ohlc", v)
          },
          {
            kind: "toggle",
            label: "Bar change values",
            id: "change",
            get: () => sl.partVisible("change"),
            set: (v) => this.setStatuslinePart("change", v)
          },
          { kind: "heading", label: "Indicators", id: "indicators" },
          {
            kind: "toggle",
            label: "Titles",
            id: "indicator-titles",
            get: () => this.indicatorTitlesOn,
            set: (v) => this.setIndicatorTitlesVisible(v)
          },
          {
            kind: "toggle",
            label: "Values",
            id: "indicator-values",
            get: () => this.indicatorValuesOn,
            set: (v) => this.setIndicatorValuesVisible(v)
          }
        ]
      });
    }
    sections.push(advanced, timezoneSection);
    if (this.sessionAvailableFlag) sections.push(sessionSection);
    sections.push(watermarkSection);
    chart.renderer.setSettingsSections(sections);
  }
  /** Show/hide this cell's symbol watermark (persisted per cell). */
  setWatermarkVisible(visible) {
    this.watermarkOn = visible;
    this.watermark?.setVisible(visible);
    this.deps.onStateDirty();
    this.deps.onStatusPrefsChanged(this.id);
  }
  /** Show/hide the "Replay" line under this cell's watermark while it replays (persisted per cell). */
  setReplayWatermarkVisible(visible) {
    this.replayWatermarkOn = visible;
    this.watermark?.setReplayVisible(visible);
    this.deps.onStateDirty();
    this.deps.onStatusPrefsChanged(this.id);
  }
  /** Show/hide this cell's indicator titles — the in-chart legend rows (persisted per cell). */
  setIndicatorTitlesVisible(visible) {
    this.indicatorTitlesOn = visible;
    this.inner?.renderer.set("indicatorTitles", visible);
    this.deps.onStateDirty();
    this.deps.onStatusPrefsChanged(this.id);
  }
  /** Show/hide the plot values beside this cell's legend titles (persisted per cell). */
  setIndicatorValuesVisible(visible) {
    this.indicatorValuesOn = visible;
    this.inner?.renderer.set("indicatorValues", visible);
    this.deps.onStateDirty();
    this.deps.onStatusPrefsChanged(this.id);
  }
  /** Show/hide one status-line segment (the settings dialog's Status line tab). */
  setStatuslinePart(part, visible) {
    this.statusline?.setPartVisible(part, visible);
    this.deps.onStatusPrefsChanged(this.id);
  }
  /** This cell's Status line tab and watermark prefs as one bundle (see {@link CellStatusPrefs}). */
  statusPrefs() {
    const sl = this.statusline;
    return {
      parts: sl ? { logo: sl.partVisible("logo"), name: sl.partVisible("name"), market: sl.partVisible("market"), ohlc: sl.partVisible("ohlc"), change: sl.partVisible("change") } : null,
      indicatorTitles: this.indicatorTitlesOn,
      indicatorValues: this.indicatorValuesOn,
      watermark: this.watermarkOn,
      replayWatermark: this.replayWatermarkOn
    };
  }
  /** Converge this cell's Status line tab and watermark prefs to `prefs` — the
   *  follower half of the workspace's style link. Idempotent: matching values change
   *  nothing, so a propagated echo dies on its own. */
  applyStatusPrefs(prefs) {
    if (prefs.parts && this.statusline) {
      for (const part of Object.keys(prefs.parts)) {
        if (this.statusline.partVisible(part) !== prefs.parts[part]) this.statusline.setPartVisible(part, prefs.parts[part]);
      }
    }
    if (prefs.indicatorTitles !== this.indicatorTitlesOn) this.setIndicatorTitlesVisible(prefs.indicatorTitles);
    if (prefs.indicatorValues !== this.indicatorValuesOn) this.setIndicatorValuesVisible(prefs.indicatorValues);
    if (prefs.watermark !== this.watermarkOn) this.setWatermarkVisible(prefs.watermark);
    if (prefs.replayWatermark !== this.replayWatermarkOn) this.setReplayWatermarkVisible(prefs.replayWatermark);
  }
  /** The LIVE chart of this cell — never cache it across a layout change (the cell's
   *  identity is what endures; the chart dies with the cell). */
  get chart() {
    if (!this.inner) throw new Error(`[vela] cell "${this.id}" is destroyed`);
    return this.inner;
  }
  get symbol() {
    return this.state.symbol ?? "";
  }
  get timeframe() {
    return this.state.timeframe ?? "60";
  }
  get priceStyle() {
    const live = this.inner?.renderer.get("priceStyle");
    return typeof live === "string" ? live : this.state.priceStyle ?? "candles";
  }
  /** Manifest instances + native instances — the topbar indicator count. */
  get indicatorCount() {
    return this.instances.length + (this.inner ? this.nativeHandles().length : this.presentNatives.length);
  }
  /** Switch this cell's market in place (the chart instance survives). The projection
   *  is OPTIMISTIC — labels and chrome show the pick before the bars load; it follows
   *  the setMarket call so the statusline reads the already-blanked chart. */
  setSymbol(symbol) {
    if (!this.inner || symbol === this.symbol) return;
    this.unresolvedToasted = null;
    void this.inner.setMarket({ symbol });
    this.projectMarket(symbol, this.timeframe);
    this.deps.onMarketChanged(this.id);
  }
  setTimeframe(timeframe) {
    if (!this.inner || timeframe === this.timeframe) return;
    this.activeRangeId = null;
    this.rangeBars = 0;
    void this.inner.setMarket({ timeframe, bars: this.state.bars });
    this.projectMarket(this.symbol, timeframe);
    this.deps.onMarketChanged(this.id);
  }
  /** Applied live (renderer feature) — no reload. */
  setPriceStyle(style) {
    this.state.priceStyle = style;
    this.inner?.renderer.set("priceStyle", style);
    this.syncStatuslineColors();
    this.deps.onPriceStyleChanged(this.id);
  }
  /** OHLC/change ink in the status line follows the ACTIVE price style's configured
   *  colors and direction rule (candle bodies by close-vs-open, baseline by position
   *  against the live baseline price, …) instead of the fixed theme tokens. */
  syncStatuslineColors() {
    if (!this.statusline || !this.inner) return;
    this.statusline.setDirectionColors(...statuslineInkOf(this.inner.renderer, this.priceStyle));
  }
  /** Multi-cell grids keep the status line on one row and hide what doesn't fit —
   *  the workspace flips this with the layout (see Statusline.setFitMode). */
  setStatuslineFit(on) {
    this.statusline?.setFitMode(on);
  }
  /** The workspace shell keeps the app theme; the cell host's tokens re-derive from
   *  the LIVE plot surface for overlay ink (statusline, watermark). Menus portal to
   *  `.vela-ui` and keep the app-theme surface (see {@link applyPlotOverlayTokens}). */
  syncPlotOverlayTokens() {
    applyPlotOverlayTokens(this.host, this.appTheme, this.inner?.renderer.getConfig() ?? null);
  }
  /**
   * Frame a bottombar range chip: switch to its timeframe, fetch the depth its window
   * needs, and keep it framed (re-asserted once the deeper history is painted).
   */
  applyRange(preset) {
    if (!this.inner || this.destroyed) return;
    this.activeRangeId = preset.id;
    const tfChanged = preset.tf !== this.timeframe;
    const deeper = preset.bars > Math.max(this.state.bars ?? 500, this.rangeBars);
    this.rangeBars = preset.bars;
    if (tfChanged || deeper) {
      this.pendingRange = preset;
      void this.inner.setMarket({ timeframe: preset.tf, bars: Math.max(this.state.bars ?? 500, this.rangeBars), visibleRange: preset.preset }).then(() => {
        if (!this.destroyed && this.pendingRange === preset) {
          this.inner?.setVisibleRangePreset(preset.preset);
          this.pendingRange = null;
        }
      });
    } else {
      this.inner.setVisibleRangePreset(preset.preset);
    }
  }
  /** Reset this cell's view: re-enable auto scale and frame the full history —
   *  the same action the chart context menu offers. */
  resetView() {
    this.inner?.renderer.set("autoScale", true);
    this.inner?.setVisibleRangePreset("ALL");
  }
  /** Rebuild the view-controls cluster (the maximize gate or state changed). */
  refreshControls() {
    this.cellControls.refresh();
  }
  /** Mobile flips the per-cell cluster off (the shell's mobile bar replaces it). */
  setControlsSuspended(on) {
    this.cellControls.setSuspended(on);
  }
  /** Make this cell the active one and put keyboard focus on its chart surface. */
  focus() {
    this.deps.activate(this.id);
    this.inner?.renderer.focus();
  }
  /** Raster of this cell's chart (same pixels as the PNG download), or null. */
  screenshotCanvas() {
    return this.inner?.renderer.screenshotCanvas() ?? null;
  }
  /** Download this cell's chart as a PNG (named after its market). */
  downloadScreenshot() {
    const url = this.inner?.renderer.screenshot();
    if (!url) return;
    const a = this.host.ownerDocument.createElement("a");
    a.href = url;
    a.download = `${this.symbol || "chart"}-${this.timeframe}.png`;
    a.click();
  }
  // ── indicator ledger (shared manifest, per-cell instances) ──
  /**
   * Hand the cell the workspace's resolved manifest. A RESTORED ledger (pool or
   * persisted state) re-adds its recorded entries by name — held until the manifest
   * actually carries them. Otherwise `seedEnabled` auto-adds the manifest's `enabled`
   * entries (fresh cells only).
   */
  setManifest(list, seedEnabled) {
    this.manifest = list;
    if (this.pendingManifestNames) {
      if (list.length === 0) return;
      for (const led of this.pendingManifestNames) {
        const entry = list.find((e) => e.name === ledgerEntryName(led));
        if (entry) this.addManifestInstance(entry, { record: false, ...typeof led === "object" ? { inputs: led.inputs, props: led.props, hidden: led.hidden } : {} });
      }
      this.pendingManifestNames = null;
      return;
    }
    if (seedEnabled) {
      for (const entry of list) if (entry.enabled) this.addManifestInstance(entry, { record: false });
    }
  }
  /**
   * Replace the indicator ledger: natives converge to the listed set (volume
   * included — removing it sticks, the core's auto-add respects the opt-out), and
   * manifest instances are re-created by name, held until the shared manifest
   * resolves. Convergence is state application, not user edits — nothing enters the
   * undo timeline.
   */
  applyIndicatorLedger(led) {
    const chart = this.inner;
    if (!chart) return;
    this.volumeIntent = led.natives.some((e) => ledgerNativeType(e) === "volume");
    this.history.silently(() => {
      const owed = /* @__PURE__ */ new Map();
      for (const e of led.natives) {
        const type = ledgerNativeType(e);
        const queue = owed.get(type);
        if (queue) queue.push(e);
        else owed.set(type, [e]);
      }
      for (const h of this.nativeHandles()) {
        const entry = owed.get(h.nativeType)?.shift();
        if (entry !== void 0) this.applyNativeLedgerEntry(h, entry);
        else h.remove();
      }
      for (const queue of owed.values()) {
        for (const e of queue) {
          const h = chart.addNativeIndicator(ledgerNativeType(e));
          this.applyNativeLedgerEntry(h, e);
        }
      }
      for (const it of [...this.instances]) this.dropInstance(it);
      if (this.manifest.length > 0) {
        for (const item of led.manifest) {
          const entry = this.manifest.find((e) => e.name === ledgerEntryName(item));
          if (entry)
            this.addManifestInstance(entry, {
              record: false,
              ...typeof item === "object" ? { inputs: item.inputs, props: item.props, hidden: item.hidden } : {}
            });
        }
        this.pendingManifestNames = null;
      } else if (!this.deps.manifestSettled()) {
        this.pendingManifestNames = [...led.manifest];
      } else {
        this.pendingManifestNames = null;
      }
    });
    this.syncPresentNatives();
    this.refreshNativeCatalog();
  }
  /** The supported natives in picker order: A→Z by title — registration order follows
   *  the catalog's families, which is meaningless to the reader. This is the library
   *  index space the picker hands back, so `libraryRows` and `addFromLibrary` MUST both
   *  read it — indexing the unsorted catalog on add would land on a different study. */
  supportedNatives() {
    return this.nativeCatalog.filter((n) => n.supported).sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
  }
  /** The picker's library rows: supported natives first (see {@link supportedNatives}),
   *  then the manifest in the host's own order. */
  libraryRows() {
    return [
      ...this.supportedNatives().map((n) => ({ name: n.title, category: "Built-in", native: true, nativeType: n.type, beta: n.beta })),
      ...this.manifest.map((e) => ({ name: e.name, language: e.language, category: e.category }))
    ];
  }
  /** The picker's on-chart rows: native instances first, then live script instances. */
  onChartRows() {
    return [
      ...this.nativeHandles().map((h) => ({ name: h.title, native: true, nativeType: h.nativeType })),
      ...this.instances.map((it) => ({ name: it.entry.name, language: it.entry.language }))
    ];
  }
  /** Add by picker LIBRARY index (natives precede the manifest — mirrors libraryRows). */
  addFromLibrary(index) {
    const natives = this.supportedNatives();
    if (index < natives.length) this.addNative(natives[index].type);
    else {
      const entry = this.manifest[index - natives.length];
      if (entry) this.addManifestInstance(entry);
    }
  }
  /** Remove by picker ON-CHART index (native instances precede script instances — mirrors onChartRows). */
  removeFromChart(index) {
    const natives = this.nativeHandles();
    if (index < natives.length) this.removeNative(natives[index]);
    else this.removeInstance(index - natives.length);
  }
  /**
   * Add a script indicator through the PUBLIC seam (`ctx.addIndicator`) — same undo/
   * redo and picker plumbing as a manifest entry, but flagged `external` so the
   * persisted ledger never records a name the manifest can't resolve (the plugin owns
   * persistence via `registerStatePersistence`). Recording follows the ambient mute:
   * a persistence handler's `restore` runs silently, a user-driven call records.
   */
  addExternalIndicator(entry) {
    const { id, inputs, props, hidden, ...script } = entry;
    this.addManifestInstance(
      { ...script, enabled: true },
      { external: true, ...id !== void 0 ? { id } : {}, ...inputs ? { inputs } : {}, ...props ? { props } : {}, ...hidden ? { hidden: true } : {} }
    );
  }
  /** Add ONE instance of a manifest entry (repeatable — duplicates are legitimate). */
  addManifestInstance(entry, opts = {}) {
    if (this.destroyed) return;
    const values = opts.inputs || opts.props ? { inputs: opts.inputs, props: opts.props } : void 0;
    const handle = this.addToChart(entry, values, opts.id);
    if (!handle) return;
    const it = { entry, handle, id: handle.id, ...opts.external ? { external: true } : {}, ...values ? { values } : {} };
    if (opts.hidden) it.handle?.setVisible(false);
    this.instances.push(it);
    this.deps.onIndicatorsChanged(this.id);
    if (opts.record === false) return;
    const snapshot = it;
    this.history.push({
      undo: () => this.dropInstance(snapshot),
      redo: () => {
        snapshot.handle = this.addToChart(snapshot.entry, snapshot.values, snapshot.id);
        this.instances.push(snapshot);
        this.deps.onIndicatorsChanged(this.id);
      }
    });
  }
  removeInstance(index) {
    const it = this.instances[index];
    if (!it || this.destroyed) return;
    this.dropInstance(it);
    const snapshot = it;
    this.history.push({
      undo: () => {
        snapshot.handle = this.addToChart(snapshot.entry, snapshot.values, snapshot.id);
        this.instances.push(snapshot);
        this.deps.onIndicatorsChanged(this.id);
      },
      redo: () => this.dropInstance(snapshot)
    });
  }
  dropInstance(it) {
    const idx = this.instances.indexOf(it);
    if (idx >= 0) this.instances.splice(idx, 1);
    const captured = instanceDeltas(it.handle);
    if (captured) it.values = captured;
    else delete it.values;
    try {
      it.handle?.remove();
    } catch {
    }
    it.handle = null;
    this.deps.onIndicatorsChanged(this.id);
  }
  /** Add a native indicator. A multi-instance type gets a fresh instance every time; a
   *  single-instance type already on the chart hands back its existing one — nothing
   *  changed, so nothing enters the undo timeline. */
  /**
   * Converge one native handle to a restored ledger entry: every schema key gets the
   * entry's value or its declaration default (the DOCUMENT is the truth — a live
   * tweak must not survive a restore that says otherwise), and visibility follows
   * the `hidden` flag. Skips the input write when nothing differs — `setInputs`
   * re-runs the indicator, and a no-op restore must not flicker every native.
   */
  applyNativeLedgerEntry(handle, entry) {
    const wanted = typeof entry === "string" ? void 0 : entry.inputs;
    if (handle.inputs.length > 0) {
      const current = handle.inputValues();
      const next = {};
      for (const schema of handle.inputs) {
        const target = wanted?.[schema.key] ?? schema.defval;
        if (JSON.stringify(current[schema.key]) !== JSON.stringify(target)) next[schema.key] = target;
      }
      if (Object.keys(next).length > 0) handle.setInputs(next);
    } else if (wanted) {
      handle.setInputs(wanted);
    }
    const visible = !(typeof entry === "object" && entry.hidden);
    if (handle.visible !== visible) handle.setVisible(visible);
  }
  addNative(type) {
    const chart = this.inner;
    if (!chart) return;
    const before = new Set(chart.indicators().map((h) => h.id));
    let added = chart.addNativeIndicator(type);
    this.syncPresentNatives();
    this.refreshNativeCatalog();
    if (before.has(added.id)) return;
    this.history.push({
      undo: () => {
        added?.remove();
        added = null;
        this.refreshNativeCatalog();
      },
      redo: () => {
        added = this.inner?.addNativeIndicator(type) ?? null;
        this.refreshNativeCatalog();
      }
    });
  }
  removeNative(handle) {
    handle.remove();
    this.refreshNativeCatalog();
  }
  /** The chart's native instances, insertion order — the picker's on-chart rows and
   *  the removal index space (script instances follow them). */
  nativeHandles() {
    return this.inner?.indicators().filter((h) => h.nativeType !== void 0) ?? [];
  }
  /** Sync mirror of the chart's native instances — the removal handler looks the
   *  removed id up here (the registry has already forgotten it) to record its type. */
  syncPresentNatives() {
    this.presentNatives = this.nativeHandles().map((h) => ({ id: h.id, type: h.nativeType }));
  }
  /** Refresh the native catalog (supported/present flags) for this cell's market. */
  refreshNativeCatalog() {
    const chart = this.inner;
    if (!chart) return;
    void chart.availableNativeIndicators().then((list) => {
      if (this.destroyed || this.inner !== chart) return;
      this.nativeCatalog = list.map((n) => ({ type: n.type, title: n.title, supported: n.supported, present: n.present, beta: n.beta }));
      this.deps.onIndicatorsChanged(this.id);
    });
  }
  addToChart(entry, values, id) {
    try {
      return this.inner?.addIndicator(entry.script, {
        ...id !== void 0 ? { id } : {},
        ...entry.language !== void 0 ? { language: entry.language } : {},
        ...values?.inputs ? { inputs: values.inputs } : {},
        ...values?.props ? { props: values.props } : {}
      }) ?? null;
    } catch (err) {
      console.warn(`[vela] indicator "${entry.name}" failed to add:`, err);
      return null;
    }
  }
  // ── third-party state (the `ext` seam) ──
  /** The cell-bound surface persistence handlers work against (built per call — the
   *  widget-context rule; nothing here may be cached by a handler). Its add methods
   *  are ALWAYS muted — a `restore` that fetches before adding escapes the sync mute
   *  of {@link restorePersistedExt}, and a state application must never enter the
   *  undo timeline, however late its continuation lands. */
  stateContext() {
    return {
      cellId: this.id,
      chart: this.chart,
      addIndicator: (entry) => this.history.silently(() => this.addExternalIndicator(entry)),
      addNativeIndicator: (type) => this.history.silently(() => this.addNative(type))
    };
  }
  /**
   * Run the registered cell-scope `restore` handlers against the cell's restored
   * `ext` bag — the workspace calls this AFTER the core state is in place (chart
   * alive and wired, indicator ledger converged). Muted: nothing a restore does
   * enters the undo timeline. Handlers only see keys the document carries; a failing
   * handler is contained (one broken plugin must not take the cell down).
   */
  restorePersistedExt() {
    if (this.destroyed) return;
    for (const h of statePersistenceHandlers("cell")) {
      if (!(h.key in this.extState)) continue;
      try {
        this.history.silently(() => h.restore(this.extState[h.key], this.stateContext()));
      } catch (err) {
        console.warn(`[vela] state persistence "${h.key}" restore failed:`, err);
      }
    }
  }
  /** Assemble the cell's `ext` bag: fresh handler snapshots merged OVER the preserved
   *  entries — a key with no handler this session rides along verbatim; a registered
   *  handler returning `undefined` withdraws its entry. */
  dehydrateExt() {
    const ext = { ...this.extState };
    for (const h of statePersistenceHandlers("cell")) {
      try {
        const value = h.serialize(this.stateContext());
        if (value === void 0) delete ext[h.key];
        else ext[h.key] = value;
      } catch (err) {
        console.warn(`[vela] state persistence "${h.key}" serialize failed:`, err);
      }
    }
    this.extState = ext;
    return Object.keys(ext).length > 0 ? ext : void 0;
  }
  // ── lifecycle ──
  /**
   * Apply a restored cell state IN PLACE — the chart instance survives (the market
   * switches via `setMarket`) while cosmetics, renderer config, drawings, and the
   * indicator ledger converge to the document. The workspace takes this path when a
   * state document lands on a grid of the same shape (async-storage boot, host
   * `applyState`), so chart references, indicator handles, event subscriptions, and
   * the cell host all stay valid.
   */
  rehydrate(cs) {
    if (!this.inner || this.destroyed) return;
    if (cs.priceStyle && cs.priceStyle !== this.priceStyle) this.setPriceStyle(cs.priceStyle);
    if (cs.watermark !== void 0 && cs.watermark !== this.watermarkOn) this.setWatermarkVisible(cs.watermark);
    if (cs.replayWatermark !== void 0 && cs.replayWatermark !== this.replayWatermarkOn) this.setReplayWatermarkVisible(cs.replayWatermark);
    if (cs.indicatorTitles !== void 0 && cs.indicatorTitles !== this.indicatorTitlesOn) this.setIndicatorTitlesVisible(cs.indicatorTitles);
    if (cs.indicatorValues !== void 0 && cs.indicatorValues !== this.indicatorValuesOn) this.setIndicatorValuesVisible(cs.indicatorValues);
    if (cs.rendererConfig != null) this.inner.renderer.applyConfig(cs.rendererConfig);
    if (cs.drawings != null) this.inner.drawings.fromJSON(cs.drawings);
    if (cs.indicators) this.applyIndicatorLedger(cs.indicators);
    this.extState = { ...cs.ext ?? {} };
    this.restorePersistedExt();
    const symbol = prefixedSymbol(cs);
    const session = normalizeSession(cs.session) ?? "regular";
    const bars = typeof cs.bars === "number" && Number.isFinite(cs.bars) && cs.bars > 0 ? cs.bars : 0;
    const next = {};
    if (symbol && symbol !== this.symbol) next.symbol = symbol;
    if (cs.timeframe && cs.timeframe !== this.timeframe) next.timeframe = cs.timeframe;
    if (session !== this.session) {
      this.state.session = session;
      next.session = session;
    }
    if (bars > 0 && bars !== this.state.bars) {
      this.state.bars = bars;
      next.bars = Math.max(bars, this.rangeBars);
    }
    if (Object.keys(next).length > 0) void this.inner.setMarket(next);
  }
  /** Snapshot everything the pool needs to restore this slot later. The market fields
   *  come from the LIVE config (`chart.market`) — the requested identity — so a switch
   *  still loading when the snapshot is taken (persist-on-close) is not lost. */
  dehydrate() {
    const live = this.inner?.market;
    const ext = this.inner ? this.dehydrateExt() : Object.keys(this.extState).length > 0 ? { ...this.extState } : void 0;
    return {
      ...this.state,
      ...live ? { symbol: live.symbol, provider: live.provider, timeframe: live.timeframe } : {},
      priceStyle: this.priceStyle,
      watermark: this.watermarkOn,
      replayWatermark: this.replayWatermarkOn,
      indicatorTitles: this.indicatorTitlesOn,
      indicatorValues: this.indicatorValuesOn,
      rendererConfig: this.inner?.renderer.getConfig() ?? void 0,
      drawings: this.inner ? this.inner.drawings.toJSON() : void 0,
      // Natives from the chart's SYNC registry read — an async catalog mirror here
      // lost unload-time saves, and the old empty-set fallbacks resurrected removed
      // indicators. Manifest names fall back to the restored ledger only until the
      // shared manifest settles. See {@link indicatorLedger}. External instances
      // (`ctx.addIndicator`) stay out: their names would never resolve against the
      // manifest — their plugin persists them via the `ext` seam instead.
      indicators: indicatorLedger({
        // Live handles carry what the registry read cannot: the input DELTAS and
        // the hidden flag, so native settings/visibility survive the round-trip.
        present: this.inner ? this.nativeHandles().map((h) => nativeLedgerEntry(h)) : [],
        instanceEntries: this.instances.filter((it) => !it.external).map((it) => {
          const d = it.handle ? instanceDeltas(it.handle) : it.values;
          const hidden = it.handle ? !it.handle.visible : false;
          return d || hidden ? { name: it.entry.name, ...d ?? {}, ...hidden ? { hidden: true } : {} } : it.entry.name;
        }),
        pendingManifest: this.pendingManifestNames,
        manifestSettled: this.deps.manifestSettled(),
        volumePending: this.volumeMayBePending && this.volumeIntent
      }),
      ...ext ? { ext } : {}
    };
  }
  destroy() {
    this.destroyed = true;
    this.offMarket();
    this.cellControls.destroy();
    this.contextMenu.destroy();
    this.history.destroy();
    this.marketStatus?.stop();
    this.sessionShading.stop();
    this.statusline?.destroy();
    this.watermark?.destroy();
    this.inner?.destroy();
    this.inner = null;
    this.host.remove();
  }
};

// src/workspace/WorkspaceReplay.ts
var MAX_BARS_PER_STEP = 1e5;
var WorkspaceReplay = class {
  constructor(host) {
    this.host = host;
    this.bus = new TypedEventBus();
    /** The running session: the shared replay time (every chart shows the bars closed by it). */
    this.session = null;
    this.playing = false;
    this.intervalMs = 1e3;
    this.timer = null;
    /** Cells whose replay a symbol switch ended — restarted at the shared time once their bars land. */
    this.rejoining = /* @__PURE__ */ new Set();
    this.cellSubs = /* @__PURE__ */ new Map();
    /** Inside a group step: chart events are the controller's own doing. */
    this.stepping = false;
    /** Inside `finish`: the charts' `replay:end` events are the controller's own doing. */
    this.stopping = false;
    /** Driving a chart's own timer: its play/pause events are not the user's. */
    this.muted = 0;
    /** A chart finished during a group step — the session ends right after it. */
    this.finishedDuringStep = false;
    for (const cell of host.cells()) this.watch(cell);
    this.offHost = host.onCells((e) => {
      if (e.kind === "created") this.onCellCreated(e.id);
      else if (e.kind === "destroyed") this.onCellDestroyed(e.id);
    });
  }
  /**
   * Enter replay on every cell (or seek, when already replaying) — paused. Resolves once
   * every chart shows its rewound history (a chart whose history does not reach that far
   * loads older bars first). A chart with nothing to replay after the shared time stays
   * as it is.
   */
  async start(opts) {
    const cells = this.host.cells();
    const ref = cells.find((c) => c.id === (opts.cell ?? this.host.activeId())) ?? cells[0];
    if (!ref) return;
    if (this.playing) this.pause();
    this.rejoining.clear();
    await ref.chart.replay.start({ from: opts.from });
    const cursor = ref.chart.replay.state.cursorTime;
    if (cursor == null) return;
    const session = { clock: barClose(cursor, ref.chart.market.timeframe) };
    this.session = session;
    await Promise.all(this.host.cells().filter((c) => c.id !== ref.id).map((c) => this.startCell(c, session.clock)));
    if (this.session !== session) return;
    this.syncPlayback();
    const s = this.activeChart()?.replay.state;
    this.bus.emit("replay:start", { cursorTime: s?.cursorTime ?? cursor, remaining: s?.remaining ?? 0 });
  }
  /** Reveal the next bar(s): the clock moves to the next bar close on any chart. Returns false when nothing is left. */
  step() {
    const solo = this.solo();
    return solo ? solo.replay.step() : this.stepGroup();
  }
  /** Reveal the next update — in a single-chart layout, the chart's `stepUpdate()` (tick replay); otherwise {@link step}. */
  stepUpdate() {
    const solo = this.solo();
    return solo ? solo.replay.stepUpdate() : this.stepGroup();
  }
  /** Advance one update every `intervalMs` (default: the last pace, initially 1000). Calling it again while playing changes the pace. */
  play(intervalMs) {
    if (!this.session) return this;
    if (intervalMs !== void 0) {
      if (!(Number.isFinite(intervalMs) && intervalMs > 0)) {
        console.warn(`[vela] workspace.replay.play(${intervalMs}) ignored \u2014 the interval must be a positive number of ms`);
        return this;
      }
      this.intervalMs = intervalMs;
    }
    this.playing = true;
    this.clearTimer();
    this.syncPlayback();
    this.bus.emit("replay:play", { intervalMs: this.intervalMs });
    return this;
  }
  pause() {
    if (!this.playing) return this;
    this.playing = false;
    this.syncPlayback();
    this.bus.emit("replay:pause", void 0);
    return this;
  }
  /** Leave replay on every chart: full history back, live updates resumed. */
  stop() {
    this.finish("stopped");
    return this;
  }
  /** `active`/`playing`/`intervalMs` for the whole workspace; the cursor fields read the ACTIVE cell's chart. */
  get state() {
    const s = this.session ? this.activeChart()?.replay.state : void 0;
    return {
      active: this.session !== null,
      playing: this.playing,
      cursorTime: s?.cursorTime ?? null,
      remaining: s?.remaining ?? 0,
      nextTime: s?.nextTime ?? null,
      intervalMs: this.intervalMs
    };
  }
  /** The active cell's replayable history (`chart.replay.bounds`). */
  get bounds() {
    return this.activeChart()?.replay.bounds ?? null;
  }
  on(event, handler) {
    return this.bus.on(event, handler);
  }
  destroy() {
    this.session = null;
    this.playing = false;
    this.clearTimer();
    this.offHost();
    for (const off of this.cellSubs.values()) off();
    this.cellSubs.clear();
    this.bus.clear();
  }
  // ── internals ──
  /** The one chart of a single-chart layout — it replays on its own, tick replay included. */
  solo() {
    const cells = this.host.cells();
    return cells.length === 1 ? cells[0].chart : null;
  }
  activeChart() {
    const cells = this.host.cells();
    return (cells.find((c) => c.id === this.host.activeId()) ?? cells[0])?.chart ?? null;
  }
  /** Rewind one chart to the shared time: every bar that closed by `clock`, none after. */
  async startCell(cell, clock) {
    const replay = cell.chart.replay;
    const from = lastOpenClosedBy(clock, cell.chart.market.timeframe);
    const bounds = replay.bounds;
    if (!bounds || bounds.last <= from) return;
    await replay.start({ from });
  }
  /** Move the clock to the next bar close on any chart; each chart reveals what closed by then. */
  stepGroup() {
    const session = this.session;
    if (!session) return false;
    const cells = this.host.cells();
    let next = Infinity;
    for (const c of cells) {
      const t = c.chart.replay.state.nextTime;
      if (t != null) next = Math.min(next, barClose(t, c.chart.market.timeframe));
    }
    if (!Number.isFinite(next)) return false;
    this.stepping = true;
    try {
      for (const c of cells) {
        const tf = c.chart.market.timeframe;
        for (let n = 0; n < MAX_BARS_PER_STEP; n += 1) {
          const t = c.chart.replay.state.nextTime;
          if (t == null || barClose(t, tf) > next) break;
          if (!c.chart.replay.step()) break;
        }
      }
    } finally {
      this.stepping = false;
    }
    session.clock = next;
    if (this.finishedDuringStep) {
      this.finishedDuringStep = false;
      this.finish("finished");
      return true;
    }
    const s = this.activeChart()?.replay.state;
    if (s?.cursorTime != null) this.bus.emit("replay:step", { cursorTime: s.cursorTime, remaining: s.remaining });
    return true;
  }
  /** Put the timers in the state `playing` asks for: a single chart runs its own (it paces
   *  ticks), several run on the controller's clock. */
  syncPlayback() {
    const solo = this.solo();
    const run = this.playing && this.session !== null;
    this.muted += 1;
    try {
      for (const c of this.host.cells()) {
        if (c.chart === solo && run) {
          if (!c.chart.replay.state.playing || c.chart.replay.state.intervalMs !== this.intervalMs) c.chart.replay.play(this.intervalMs);
        } else if (c.chart.replay.state.playing) {
          c.chart.replay.pause();
        }
      }
    } finally {
      this.muted -= 1;
    }
    if (!run || solo) this.clearTimer();
    else if (this.timer == null) this.schedule();
  }
  schedule() {
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.playing || !this.session || this.solo()) return;
      if (this.stepGroup() || this.rejoining.size > 0) {
        if (this.playing && this.session && this.timer == null) this.schedule();
      } else {
        this.pause();
      }
    }, this.intervalMs);
  }
  clearTimer() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }
  /** End the session on every chart (idempotent). */
  finish(reason) {
    const had = this.session !== null;
    this.session = null;
    this.playing = false;
    this.clearTimer();
    this.rejoining.clear();
    this.stopping = true;
    try {
      for (const c of this.host.cells()) c.chart.replay.stop();
    } finally {
      this.stopping = false;
    }
    if (had) this.bus.emit("replay:end", { reason });
  }
  watch(cell) {
    const { id, chart } = cell;
    const isActive = () => (this.host.activeId() ?? this.host.cells()[0]?.id) === id;
    const offs = [
      chart.on("replay:end", ({ reason }) => {
        if (!this.session || this.stopping) return;
        if (reason === "market") this.rejoining.add(id);
        else if (this.stepping) this.finishedDuringStep || (this.finishedDuringStep = reason === "finished");
        else this.finish(reason);
      }),
      chart.on("market:changed", () => {
        if (!this.rejoining.delete(id) || !this.session) return;
        void this.startCell(cell, this.session.clock).then(() => this.syncPlayback());
      }),
      chart.on("replay:step", (e) => {
        if (this.session && !this.stepping && isActive()) this.bus.emit("replay:step", e);
      }),
      chart.on("replay:tick", (e) => {
        if (this.session && isActive()) this.bus.emit("replay:tick", e);
      }),
      // A single chart runs its own timer: a pause it takes on its own (a seek) is the session's.
      chart.on("replay:pause", () => {
        if (!this.session || this.muted > 0 || !this.playing || chart !== this.solo()) return;
        this.playing = false;
        this.bus.emit("replay:pause", void 0);
      })
    ];
    this.cellSubs.set(id, () => {
      for (const off of offs) off();
    });
  }
  onCellCreated(id) {
    const cell = this.host.cells().find((c) => c.id === id);
    if (!cell) return;
    this.watch(cell);
    const session = this.session;
    if (!session) return;
    this.rejoining.add(id);
    void cell.chart.ready().then(async () => {
      if (this.session !== session || !this.rejoining.delete(id)) return;
      await this.startCell(cell, session.clock);
      this.syncPlayback();
    });
    this.syncPlayback();
  }
  onCellDestroyed(id) {
    this.cellSubs.get(id)?.();
    this.cellSubs.delete(id);
    this.rejoining.delete(id);
    this.syncPlayback();
  }
};
function barClose(open, timeframe) {
  const months = monthSpan(timeframe);
  if (months > 0) {
    const d = new Date(open);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  }
  return open + timeframeToMs(timeframe ?? "60");
}
function lastOpenClosedBy(time, timeframe) {
  const months = monthSpan(timeframe);
  if (months > 0) {
    const d = new Date(time);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  }
  return time - timeframeToMs(timeframe ?? "60");
}
function monthSpan(timeframe) {
  const m = /^(\d*)M$/.exec((timeframe ?? "").trim());
  return m ? Number(m[1] || 1) : 0;
}

// src/workspace/layouts.ts
var registry = /* @__PURE__ */ new Map();
function registerLayout(def) {
  registry.set(def.id, def);
}
function unregisterLayout(id) {
  registry.delete(id);
}
function layoutDefinition(id) {
  return registry.get(id);
}
function layouts() {
  return [...registry.values()];
}
function slots(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}` }));
}
function registerBuiltinLayouts() {
  registerLayout({ id: "1", label: "Single", cols: [1], rows: [1], cells: slots(1) });
  registerLayout({ id: "2h", label: "2 side by side", cols: [1, 1], rows: [1], cells: slots(2) });
  registerLayout({ id: "2v", label: "2 stacked", cols: [1], rows: [1, 1], cells: slots(2) });
  registerLayout({ id: "4", label: "4 grid", cols: [1, 1], rows: [1, 1], cells: slots(4) });
  registerLayout({ id: "8", label: "8 grid", cols: [1, 1, 1, 1], rows: [1, 1], cells: slots(8) });
}
var GRID_PICKER_MAX = 4;
var GRID_BUILTIN_IDS = {
  "1x1": "1",
  "1x2": "2h",
  "2x1": "2v",
  "2x2": "4",
  "2x4": "8"
};
var clampTrack = (n) => Math.max(1, Math.min(GRID_PICKER_MAX, Math.round(n)));
function layoutForGrid(rows, cols) {
  const r = clampTrack(rows);
  const c = clampTrack(cols);
  const builtin = GRID_BUILTIN_IDS[`${r}x${c}`];
  const registered = builtin ? registry.get(builtin) : void 0;
  if (registered) return registered;
  return {
    id: `g${r}x${c}`,
    // Width-first label — matches the picker's caption ("3 × 2" = 3 wide, 2 tall).
    label: `${c} \xD7 ${r} grid`,
    cols: Array.from({ length: c }, () => 1),
    rows: Array.from({ length: r }, () => 1),
    cells: slots(r * c)
  };
}
var GRID_ID_RE = /^g([1-4])x([1-4])$/;
function ensureLayout(id) {
  const registered = registry.get(id);
  if (registered) return registered;
  const g = GRID_ID_RE.exec(id);
  if (g) return layoutForGrid(Number(g[1]), Number(g[2]));
  return void 0;
}
function layoutShape(def) {
  if (!def.areas && def.rows.length <= GRID_PICKER_MAX && def.cols.length <= GRID_PICKER_MAX && def.cells.length === def.rows.length * def.cols.length) {
    return { rows: def.rows.length, cols: def.cols.length };
  }
  return null;
}
function occupancyGrid(def) {
  if (def.areas) return def.areas.map((row) => row.trim().split(/\s+/));
  const cols = def.cols.length;
  return def.rows.map((_, r) => def.cols.map((_2, c) => def.cells[r * cols + c]?.id ?? `\xB7${r}x${c}`));
}
var GLYPH_MIN = 1.5;
var GLYPH_SPAN = 13;
function glyphStops(weights, n) {
  const w = Array.from({ length: n }, (_, i) => {
    const v = weights[i];
    return v !== void 0 && Number.isFinite(v) && v > 0 ? v : 1;
  });
  const total = w.reduce((a, b) => a + b, 0);
  const stops = [GLYPH_MIN];
  let acc = 0;
  for (const v of w) {
    acc += v;
    stops.push(Math.round((GLYPH_MIN + GLYPH_SPAN * acc / total) * 100) / 100);
  }
  return stops;
}
function layoutGlyph(def) {
  const grid = occupancyGrid(def);
  const rows = grid.length;
  const cols = grid.reduce((n, row) => Math.max(n, row.length), 0);
  const xs = glyphStops(def.cols, cols);
  const ys = glyphStops(def.rows, rows);
  const at = (r, c) => grid[r]?.[c];
  const seams = [];
  for (let c = 1; c < cols; c += 1) {
    let start = -1;
    for (let r = 0; r <= rows; r += 1) {
      const split = r < rows && at(r, c - 1) !== at(r, c);
      if (split && start < 0) start = r;
      if (!split && start >= 0) {
        seams.push(`M${xs[c]} ${ys[start]}V${ys[r]}`);
        start = -1;
      }
    }
  }
  for (let r = 1; r < rows; r += 1) {
    let start = -1;
    for (let c = 0; c <= cols; c += 1) {
      const split = c < cols && at(r - 1, c) !== at(r, c);
      if (split && start < 0) start = c;
      if (!split && start >= 0) {
        seams.push(`M${xs[start]} ${ys[r]}H${xs[c]}`);
        start = -1;
      }
    }
  }
  const frame = `<rect x="${GLYPH_MIN}" y="${GLYPH_MIN}" width="${GLYPH_SPAN}" height="${GLYPH_SPAN}" rx="1.5"/>`;
  return svg16(seams.length > 0 ? `${frame}<path d="${seams.join("")}"/>` : frame);
}
function gridStyles(def, trackSizes) {
  const cols = trackSizes?.cols?.length === def.cols.length ? trackSizes.cols : def.cols;
  const rows = trackSizes?.rows?.length === def.rows.length ? trackSizes.rows : def.rows;
  const container = {
    display: "grid",
    gridTemplateColumns: cols.map((w) => `${w}fr`).join(" "),
    gridTemplateRows: rows.map((w) => `${w}fr`).join(" ")
  };
  if (def.areas) container.gridTemplateAreas = def.areas.map((r) => `"${r}"`).join(" ");
  const perCell = {};
  for (const cell of def.cells) {
    perCell[cell.id] = cell.area ? { gridArea: cell.area } : {};
  }
  return { container, perCell };
}
function activeAfterLayout(current, cellIds) {
  if (current != null && cellIds.includes(current)) return current;
  return cellIds[0] ?? null;
}
function orderAfterLayout(order, slots2, active) {
  const next = [...order];
  if (active == null || slots2 <= 0) return next;
  const idx = next.indexOf(active);
  if (idx < 0 || idx < slots2) return next;
  next.splice(idx, 1);
  next.splice(slots2 - 1, 0, active);
  return next;
}

// src/workspace/splitters.ts
var MIN_TRACK_FRAC = 0.1;
function evenTracks(n) {
  return Array.from({ length: n }, () => 1);
}
function resizeTracks(weights, index, deltaPx, sizePx) {
  const out = [...weights];
  const a = out[index];
  const b = out[index + 1];
  if (a === void 0 || b === void 0 || sizePx <= 0) return out;
  const total = out.reduce((s, w) => s + w, 0);
  const min = total * MIN_TRACK_FRAC;
  let deltaFr = deltaPx / sizePx * total;
  deltaFr = Math.max(deltaFr, min - a);
  deltaFr = Math.min(deltaFr, b - min);
  out[index] = a + deltaFr;
  out[index + 1] = b - deltaFr;
  return out;
}
function trackOffsets(weights, sizePx, gapPx) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return [];
  const content = sizePx - gapPx * (weights.length - 1);
  const out = [];
  let acc = 0;
  for (let i = 0; i < weights.length - 1; i += 1) {
    acc += weights[i] / total * content;
    out.push(acc + gapPx * i + gapPx / 2);
  }
  return out;
}
function seamSegments(grid, axis, index) {
  const count = axis === "cols" ? grid.length : grid[0]?.length ?? 0;
  const isSeam = (k) => axis === "cols" ? grid[k]?.[index] !== grid[k]?.[index + 1] : grid[index]?.[k] !== grid[index + 1]?.[k];
  const out = [];
  for (let k = 0; k < count; k += 1) {
    if (!isSeam(k)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === k - 1) last[1] = k;
    else out.push([k, k]);
  }
  return out;
}
function segmentSpanPx(weights, sizePx, gapPx, from, to) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return { start: 0, end: 0 };
  const content = sizePx - gapPx * (weights.length - 1);
  const startOf = (k) => weights.slice(0, k).reduce((s, w) => s + w / total * content, 0) + gapPx * k;
  const start = from === 0 ? 0 : startOf(from) - gapPx / 2;
  const end = to === weights.length - 1 ? sizePx : startOf(to + 1) - gapPx / 2;
  return { start, end };
}
var HIT_PX = 8;
var SplitterLayer = class {
  constructor(container, deps) {
    this.container = container;
    this.deps = deps;
    this.strips = [];
    this.drag = null;
  }
  /** Rebuild + reposition the strips for the current tracks/size/occupancy. */
  layout() {
    const { cols, rows } = this.deps.tracks();
    const grid = this.deps.grid();
    const rect = this.container.getBoundingClientRect();
    const gap = this.deps.gapPx();
    const placements = [];
    for (const [i, x] of trackOffsets(cols, rect.width, gap).entries()) {
      for (const [from, to] of seamSegments(grid, "cols", i)) {
        const { start, end } = segmentSpanPx(rows, rect.height, gap, from, to);
        placements.push({
          axis: "cols",
          index: i,
          css: `left:${Math.round(x - HIT_PX / 2)}px;top:${Math.round(start)}px;width:${HIT_PX}px;height:${Math.round(end - start)}px;cursor:col-resize;`
        });
      }
    }
    for (const [i, y] of trackOffsets(rows, rect.height, gap).entries()) {
      for (const [from, to] of seamSegments(grid, "rows", i)) {
        const { start, end } = segmentSpanPx(cols, rect.width, gap, from, to);
        placements.push({
          axis: "rows",
          index: i,
          css: `left:${Math.round(start)}px;top:${Math.round(y - HIT_PX / 2)}px;width:${Math.round(end - start)}px;height:${HIT_PX}px;cursor:row-resize;`
        });
      }
    }
    while (this.strips.length > placements.length) this.strips.pop().remove();
    while (this.strips.length < placements.length) this.strips.push(this.makeStrip());
    for (const [k, p] of placements.entries()) this.place(this.strips[k], p.axis, p.index, p.css);
  }
  destroy() {
    for (const s of this.strips.splice(0)) s.remove();
    this.drag = null;
  }
  makeStrip() {
    const el = document.createElement("div");
    el.className = "vela-ws-splitter";
    el.style.cssText = "position:absolute;z-index:30;";
    el.addEventListener("pointerdown", (e) => this.onDown(el, e));
    el.addEventListener("dblclick", () => {
      const axis = el.dataset.axis;
      if (axis) this.deps.reset(axis);
    });
    this.container.appendChild(el);
    return el;
  }
  place(el, axis, index, css) {
    el.dataset.axis = axis;
    el.dataset.index = String(index);
    el.style.cssText = `position:absolute;z-index:30;${css}`;
  }
  onDown(el, e) {
    const axis = el.dataset.axis;
    const index = Number(el.dataset.index);
    if (!axis || Number.isNaN(index)) return;
    e.preventDefault();
    const rect = this.container.getBoundingClientRect();
    const gap = this.deps.gapPx();
    const tracks = this.deps.tracks()[axis];
    this.drag = {
      axis,
      index,
      startPx: axis === "cols" ? e.clientX : e.clientY,
      startWeights: [...tracks],
      sizePx: (axis === "cols" ? rect.width : rect.height) - gap * (tracks.length - 1)
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
    }
    const move = (ev) => {
      const d = this.drag;
      if (!d) return;
      const delta = (d.axis === "cols" ? ev.clientX : ev.clientY) - d.startPx;
      this.deps.apply(d.axis, resizeTracks(d.startWeights, d.index, delta, d.sizePx));
    };
    const up = () => {
      this.drag = null;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
};

// src/widget/toast.ts
var STYLE_ID13 = "vela-widget-toast";
var CSS13 = `
.vela-toast {
    position: absolute;
    left: 50%;
    bottom: 34px;
    transform: translateX(-50%);
    z-index: 30;
    display: none;
    align-items: center;
    gap: 8px;
    max-width: 70%;
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md);
    box-shadow: var(--vela-shadow);
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.vela-toast[data-open] { display: inline-flex; }
.vela-toast[data-type='error'] { color: var(--vela-down); border-color: var(--vela-down); }
.vela-toast[data-type='success'] { color: var(--vela-up); }
`;
var Toast = class {
  constructor(host) {
    this.timer = null;
    injectStyles(STYLE_ID13, CSS13, host.ownerDocument);
    this.el = host.ownerDocument.createElement("div");
    this.el.className = "vela-toast";
    host.appendChild(this.el);
  }
  /** Show a message; auto-hides after `ms` (0 = sticky until `hide()`). */
  show(message, type = "info", ms = 3e3) {
    this.el.textContent = message;
    this.el.dataset.type = type;
    this.el.dataset.open = "1";
    if (this.timer) clearTimeout(this.timer);
    this.timer = ms > 0 ? setTimeout(() => this.hide(), ms) : null;
  }
  hide() {
    delete this.el.dataset.open;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  destroy() {
    this.hide();
    this.el.remove();
  }
};

// src/widget/tool-shortcuts.ts
var TOOL_BINDINGS = [
  ["trendline", "drawings.trendline"],
  ["hline", "drawings.hline-cursor"],
  ["vline", "drawings.vline-cursor"]
];
function toolShortcutHints(keymap) {
  const byId = new Map(keymap.bindings().map((b) => [b.id, b.display[0]]));
  const out = {};
  for (const [type, id] of TOOL_BINDINGS) {
    const display = byId.get(id);
    if (display) out[type] = display;
  }
  return out;
}

// src/widget/layout-mode.ts
var MOBILE_BREAKPOINT_PX = 640;
var COARSE_BREAKPOINT_PX = 920;
function resolveLayoutMode(option, width, coarsePointer) {
  if (option !== "auto") return option;
  if (width <= 0) return "desktop";
  if (width < MOBILE_BREAKPOINT_PX) return "mobile";
  if (coarsePointer && width < COARSE_BREAKPOINT_PX) return "mobile";
  return "desktop";
}
var LayoutModeController = class {
  constructor(el, option = "auto") {
    this.el = el;
    this.option = option;
    this.listeners = /* @__PURE__ */ new Set();
    this.ro = null;
    this.mql = null;
    this.onMediaChange = () => this.evaluate();
    const win = el.ownerDocument.defaultView;
    if (win && typeof win.matchMedia === "function") {
      this.mql = win.matchMedia("(pointer: coarse)");
      if (typeof this.mql.addEventListener === "function") this.mql.addEventListener("change", this.onMediaChange);
    }
    this.mode = resolveLayoutMode(option, el.getBoundingClientRect().width, this.mql?.matches ?? false);
    el.dataset.layout = this.mode;
    if (option === "auto" && win && typeof win.ResizeObserver === "function") {
      this.ro = new win.ResizeObserver(() => this.evaluate());
      this.ro.observe(el);
    }
  }
  get current() {
    return this.mode;
  }
  /** Subscribe to mode transitions (fires with the NEW mode). */
  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  destroy() {
    this.ro?.disconnect();
    this.ro = null;
    if (this.mql && typeof this.mql.removeEventListener === "function") this.mql.removeEventListener("change", this.onMediaChange);
    this.mql = null;
    this.listeners.clear();
  }
  evaluate() {
    const next = resolveLayoutMode(this.option, this.el.getBoundingClientRect().width, this.mql?.matches ?? false);
    if (next === this.mode) return;
    this.mode = next;
    this.el.dataset.layout = next;
    for (const cb of [...this.listeners]) cb(next);
  }
};

// src/widget/mobile-bar.ts
var STYLE_ID14 = "vela-widget-mobilebar";
var CSS14 = `
.vela-mobilebar {
    display: none;
    align-items: stretch;
    gap: 2px;
    padding: 4px 6px calc(4px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--vela-border);
    color: var(--vela-fg-muted);
    flex: none;
}
[data-layout='mobile'] .vela-mobilebar { display: flex; }
[data-layout='mobile'] .vela-widget-topbar { display: none; }
[data-layout='mobile'] .vela-widget-bottombar { display: none; }
.vela-mb-item {
    all: unset;
    flex: 1 1 0;
    min-width: 0;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-weight: 600;
    -webkit-tap-highlight-color: transparent;
}
.vela-mb-item[hidden] { display: none !important; }
.vela-mb-item:active { background: var(--vela-hover); }
.vela-mb-item .vela-icon { font-size: 18px; width: 18px; height: 18px; }
/* A lit stop (the maximize toggle while something is isolated): the inverse
   "selected" chip \u2014 white on the dark theme, dark on the light one. */
.vela-mb-item.vela-mb-on, .vela-mb-item.vela-mb-on:active { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
/* Left-aligned contributed actions get their own stops (the built-in indicators
   slot) \u2014 the wrapper is layout-transparent so each stop flexes like a sibling. */
.vela-mb-actions { display: contents; }
.vela-mb-symbol {
    flex: 1.6 1 0;
    font-size: 14px;
    letter-spacing: 0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    line-height: 44px;
    text-align: center;
}
`;
var MobileBar = class {
  constructor(host, opts) {
    this.opts = opts;
    const doc = host.ownerDocument;
    injectStyles(STYLE_ID14, CSS14, doc);
    this.el = doc.createElement("div");
    this.el.className = "vela-mobilebar";
    const item = (cls, label, onClick, icon2) => {
      const b = doc.createElement("button");
      b.className = `vela-mb-item ${cls}`;
      b.setAttribute("aria-label", label);
      if (icon2) b.appendChild(iconEl(icon2, doc));
      b.addEventListener("click", onClick);
      return b;
    };
    this.symbolEl = item("vela-mb-symbol", "Symbol search", opts.onSymbolClick);
    this.symbolEl.textContent = parseSymbol(opts.symbol).ticker;
    this.tfEl = item("vela-mb-tf", "Timeframe", opts.onTimeframeClick);
    this.tfEl.textContent = timeframeLabel(opts.timeframe);
    const onIndicators = opts.onIndicatorsClick;
    const indicators = onIndicators ? item("vela-mb-indicators", "Indicators", onIndicators, "indicators") : null;
    this.actionsHost = doc.createElement("span");
    this.actionsHost.className = "vela-mb-actions";
    const onDrawings = opts.onDrawingsClick;
    const drawings = onDrawings ? item("vela-mb-drawings", "Drawings", onDrawings, "pen") : null;
    const onMaximize = opts.onMaximizeClick;
    this.maxEl = onMaximize ? item("vela-mb-maximize", "Maximize chart", onMaximize, "maximize") : null;
    const more = item("vela-mb-more", "More", opts.onMoreClick, "kebab");
    const settings = item("vela-mb-settings", "Chart settings", opts.onSettingsClick, "gear");
    this.el.append(this.symbolEl, this.tfEl, ...indicators ? [indicators] : [], this.actionsHost, ...drawings ? [drawings] : [], ...this.maxEl ? [this.maxEl] : [], more, settings);
    host.appendChild(this.el);
    this.renderActions();
  }
  /** Re-project the contributed actions placed on the bar (left-aligned by default —
   *  see `mobilePlacement`) as icon-only stops in the indicators slot (call after
   *  registrations change). The rest are three-dots drawer rows. */
  renderActions() {
    const ctx = this.opts.getContext?.();
    if (!ctx) return;
    const doc = this.el.ownerDocument;
    this.actionsHost.replaceChildren();
    const builtin = new Set(TOPBAR_BUILTIN_IDS);
    for (const action of widgetActions("topbar", ctx).filter((a) => mobilePlacement(a) === "bar" && !builtin.has(a.id))) {
      const b = doc.createElement("button");
      b.className = "vela-mb-item";
      b.setAttribute("aria-label", action.label);
      if (action.icon) b.appendChild(iconEl(action.icon, doc));
      else b.appendChild(doc.createTextNode(action.label));
      b.addEventListener("click", () => {
        const c = this.opts.getContext?.();
        if (c) action.run(c);
      });
      this.actionsHost.appendChild(b);
    }
  }
  setSymbol(symbol) {
    this.symbolEl.textContent = parseSymbol(symbol).ticker;
  }
  setTimeframe(tf) {
    this.tfEl.textContent = timeframeLabel(tf);
  }
  /** Light the maximize stop while something is isolated (a chart over the grid,
   *  or a maximized pane inside the active chart) — inverse chip + restore glyph. */
  setMaximizeActive(on) {
    if (!this.maxEl) return;
    this.maxEl.classList.toggle("vela-mb-on", on);
    this.maxEl.setAttribute("aria-label", on ? "Restore layout" : "Maximize chart");
    this.maxEl.replaceChildren(iconEl(on ? "restore" : "maximize", this.el.ownerDocument));
  }
  /** Show the maximize stop only while the grid holds more than one chart — on a
   *  one-cell layout there is nothing to isolate, so the stop would be a dead press. */
  setMaximizeVisible(visible) {
    if (!this.maxEl) return;
    this.maxEl.hidden = !visible;
  }
  destroy() {
    this.el.remove();
  }
};

// src/widget/timeframe-drawer.ts
var STYLE_ID15 = "vela-widget-tf-drawer";
var CSS15 = `
.vela-tfd-heading {
    padding: 4px 2px 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-bright);
}
.vela-tfd-heading + .vela-tfd-ranges,
.vela-tfd-heading + .vela-tfd-grid { padding-top: 0; }
.vela-tfd-ranges {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    /* Sideways-scrolling strip: keep its touches native scroll (the drawer body is pan-y). */
    touch-action: pan-x;
    padding: 0 2px 14px;
}
.vela-tfd-ranges::-webkit-scrollbar { display: none; }
.vela-tfd-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: 6px;
    padding-bottom: 4px;
}
.vela-tfd-chip {
    all: unset;
    min-height: 40px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--vela-fg);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-tfd-chip:active { background: var(--vela-hover); }
.vela-tfd-chip[data-active='1'] {
    color: var(--vela-fg-bright);
    border-color: var(--vela-fg-bright);
    background: var(--vela-hover);
}
`;
var TimeframeDrawer = class {
  constructor(opts) {
    this.opts = opts;
    this.rangeChips = /* @__PURE__ */ new Map();
    this.tfChips = /* @__PURE__ */ new Map();
    const doc = opts.host.ownerDocument;
    injectStyles(STYLE_ID15, CSS15, doc);
    this.drawer = new Drawer({ host: opts.host, onOpenChange: opts.onOpenChange });
    const rangeHeading = doc.createElement("div");
    rangeHeading.className = "vela-tfd-heading";
    rangeHeading.textContent = "Date Range";
    const ranges = doc.createElement("div");
    ranges.className = "vela-tfd-ranges";
    for (const preset of opts.ranges) {
      const chip = doc.createElement("button");
      chip.className = "vela-tfd-chip";
      chip.textContent = preset.id;
      chip.addEventListener("click", () => {
        opts.onRange(preset);
        this.drawer.hide();
      });
      this.rangeChips.set(preset.id, chip);
      ranges.appendChild(chip);
    }
    const tfHeading = doc.createElement("div");
    tfHeading.className = "vela-tfd-heading";
    tfHeading.textContent = "Timeframes";
    const grid = doc.createElement("div");
    grid.className = "vela-tfd-grid";
    for (const tf of opts.timeframes) {
      const chip = doc.createElement("button");
      chip.className = "vela-tfd-chip";
      chip.textContent = timeframeLabel(tf);
      chip.addEventListener("click", () => {
        opts.onTimeframe(tf);
        this.drawer.hide();
      });
      this.tfChips.set(tf, chip);
      grid.appendChild(chip);
    }
    this.drawer.body.append(rangeHeading, ranges, tfHeading, grid);
  }
  open() {
    const tf = this.opts.currentTimeframe();
    const range = this.opts.activeRange();
    for (const [id, chip] of this.rangeChips) {
      if (range !== null && id === range) chip.dataset.active = "1";
      else delete chip.dataset.active;
    }
    for (const [id, chip] of this.tfChips) {
      if (range === null && id === tf) chip.dataset.active = "1";
      else delete chip.dataset.active;
    }
    this.drawer.show();
  }
  close() {
    this.drawer.hide();
  }
  destroy() {
    this.drawer.destroy();
  }
};

// src/widget/drawings-drawer.ts
var STYLE_ID16 = "vela-widget-drawings-drawer";
var CSS16 = `
/* Search + tabs stay pinned while the tool list scrolls underneath. */
.vela-dd-sticky {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--vela-surface);
    padding-top: 2px;
}
.vela-dd-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin: 0 2px 8px;
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    color: var(--vela-fg-muted);
    background: var(--vela-surface);
}
.vela-dd-search input {
    all: unset;
    flex: 1 1 auto;
    min-width: 0;
    font-size: 14px;
    color: var(--vela-fg-bright);
}
.vela-dd-tabs {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    /* The strip scrolls sideways itself \u2014 its touches are native scroll, not tab swipes
       (the drawer body is pan-y so everywhere ELSE a sideways move swipes the tabs). */
    touch-action: pan-x;
    padding: 0 2px 8px;
    border-bottom: 1px solid var(--vela-border);
    background: var(--vela-surface);
}
.vela-dd-tabs::-webkit-scrollbar { display: none; }
.vela-dd-tab {
    all: unset;
    flex: none;
    min-height: 36px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-dd-tab[data-active='1'] { color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-dd-list { padding: 6px 0 4px; }
.vela-dd-section {
    padding: 10px 2px 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-dd-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-dd-row:active { background: var(--vela-hover); }
.vela-dd-row[data-active='1'] { background: var(--vela-hover); }
.vela-dd-row[data-active='1'] .vela-dd-label { color: var(--vela-accent); }
.vela-dd-glyph { flex: none; width: 24px; height: 24px; color: var(--vela-fg); }
.vela-dd-glyph svg { width: 24px; height: 24px; }
.vela-dd-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-dd-star {
    all: unset;
    flex: none;
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-dd-star[data-on='1'] { color: var(--vela-highlight); }
.vela-dd-empty { padding: 18px 2px; color: var(--vela-fg-muted); font-size: 13px; }
`;
var DrawingsDrawer = class {
  constructor(opts) {
    this.opts = opts;
    this.definition = { groups: [] };
    this.activeGroup = "";
    const doc = opts.host.ownerDocument;
    injectStyles(STYLE_ID16, CSS16, doc);
    this.drawer = new Drawer({
      host: opts.host,
      title: "Drawings",
      onOpenChange: opts.onOpenChange,
      // Swiping across the tool list pages through the group tabs.
      onSwipe: (dir) => this.stepGroup(dir === "left" ? 1 : -1)
    });
    const sticky = doc.createElement("div");
    sticky.className = "vela-dd-sticky";
    const search = doc.createElement("div");
    search.className = "vela-dd-search";
    search.appendChild(iconEl("search", doc));
    this.input = doc.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "Search tools\u2026";
    this.input.addEventListener("input", () => this.renderList());
    search.appendChild(this.input);
    this.tabs = doc.createElement("div");
    this.tabs.className = "vela-dd-tabs";
    sticky.append(search, this.tabs);
    this.list = doc.createElement("div");
    this.list.className = "vela-dd-list";
    this.drawer.body.append(sticky, this.list);
  }
  open() {
    this.definition = this.opts.toolbar();
    if (!this.definition.groups.some((g) => g.id === this.activeGroup)) this.activeGroup = this.definition.groups[0]?.id ?? "";
    this.input.value = "";
    this.renderTabs();
    this.renderList();
    this.drawer.show();
  }
  close() {
    this.drawer.hide();
  }
  destroy() {
    this.drawer.destroy();
  }
  /** Move the active group tab by `step` (a horizontal swipe on the list). Search mode
   *  shows the flattened results — no tabs to page through, so the swipe is inert. */
  stepGroup(step) {
    if (this.input.value.trim()) return;
    const groups = this.definition.groups;
    const next = groups[groups.findIndex((g) => g.id === this.activeGroup) + step];
    if (!next) return;
    this.activeGroup = next.id;
    this.renderTabs();
    this.renderList();
    this.tabs.querySelector('[data-active="1"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
  renderTabs() {
    const doc = this.tabs.ownerDocument;
    this.tabs.replaceChildren();
    for (const group of this.definition.groups) {
      const tab = doc.createElement("button");
      tab.className = "vela-dd-tab";
      tab.textContent = group.label;
      if (group.id === this.activeGroup) tab.dataset.active = "1";
      tab.addEventListener("click", () => {
        this.activeGroup = group.id;
        this.input.value = "";
        this.renderTabs();
        this.renderList();
      });
      this.tabs.appendChild(tab);
    }
  }
  renderList() {
    const doc = this.list.ownerDocument;
    this.list.replaceChildren();
    const query = this.input.value.trim().toLowerCase();
    const active = this.opts.currentTool();
    const section = (label) => {
      const el = doc.createElement("div");
      el.className = "vela-dd-section";
      el.textContent = label;
      this.list.appendChild(el);
    };
    const row = (tool) => {
      const el = doc.createElement("div");
      el.className = "vela-dd-row";
      if (tool.type === active) el.dataset.active = "1";
      const glyph = doc.createElement("span");
      glyph.className = "vela-dd-glyph";
      glyph.innerHTML = tool.icon;
      const label = doc.createElement("span");
      label.className = "vela-dd-label";
      label.textContent = tool.label;
      const star = doc.createElement("button");
      star.className = "vela-dd-star";
      const paintStar = (on) => {
        star.replaceChildren(iconEl(on ? "star-filled" : "star", doc));
        if (on) star.dataset.on = "1";
        else delete star.dataset.on;
      };
      paintStar(this.opts.isFavorite(tool.type));
      star.setAttribute("aria-label", `Favorite ${tool.label}`);
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        const on = !this.opts.isFavorite(tool.type);
        this.opts.onFavorite(tool.type, on);
        paintStar(on);
      });
      el.append(glyph, label, star);
      el.addEventListener("click", () => {
        this.opts.onSelect(tool.type);
        this.drawer.hide();
      });
      this.list.appendChild(el);
    };
    if (query) {
      let any = false;
      for (const group2 of this.definition.groups) {
        const hits = group2.tools.filter((t) => t.label.toLowerCase().includes(query));
        if (hits.length === 0) continue;
        any = true;
        section(group2.label);
        for (const tool of hits) row(tool);
      }
      if (!any) {
        const empty = doc.createElement("div");
        empty.className = "vela-dd-empty";
        empty.textContent = "No tools match.";
        this.list.appendChild(empty);
      }
      return;
    }
    const group = this.definition.groups.find((g) => g.id === this.activeGroup);
    if (!group) return;
    if (group.sections && group.sections.length > 0) {
      for (const s of group.sections) {
        section(s.label);
        for (const tool of s.tools) row(tool);
      }
    } else {
      for (const tool of group.tools) row(tool);
    }
  }
};

// src/widget/more-drawer.ts
var STYLE_ID17 = "vela-widget-more-drawer";
var CSS17 = `
.vela-md-actions {
    display: flex;
    gap: 6px;
    padding: 2px 2px 10px;
    border-bottom: 1px solid var(--vela-border);
}
.vela-md-action {
    all: unset;
    flex: 1 1 0;
    min-height: 48px;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-radius: 8px;
    font-size: 11px;
    color: var(--vela-fg);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-action:active { background: var(--vela-hover); }
.vela-md-action:disabled { opacity: 0.35; cursor: default; }
.vela-md-action .vela-icon { font-size: 17px; width: 17px; height: 17px; }
.vela-md-list { padding: 6px 0 4px; }
.vela-md-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-row:active { background: var(--vela-hover); }
.vela-md-row[data-checked='1'] { background: var(--vela-hover-strong); }
.vela-md-row .vela-icon { flex: none; font-size: 17px; width: 17px; height: 17px; color: var(--vela-fg-muted); }
.vela-md-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-md-row-value { flex: none; font-size: 13px; color: var(--vela-fg-muted); }
.vela-md-back {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 0 2px;
    font-size: 14px;
    font-weight: 600;
    color: var(--vela-fg-bright);
    cursor: pointer;
    border-bottom: 1px solid var(--vela-border);
    width: 100%;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
}
/* The layout sub-view's grid canvas, centered and touch-sized (the base .vela-lp-grid
   squares are popover-sized for a mouse). */
.vela-md-gridwrap { display: flex; justify-content: center; padding: 14px 0 10px; }
.vela-md-gridwrap .vela-lp-grid { grid-template-columns: repeat(4, 44px); grid-auto-rows: 44px; gap: 8px; }
.vela-md-section {
    padding: 12px 2px 4px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-md-empty { padding: 18px 2px; color: var(--vela-fg-muted); font-size: 13px; }
`;
var MoreDrawer = class {
  constructor(opts) {
    this.opts = opts;
    this.view = "main";
    injectStyles(STYLE_ID17, CSS17, opts.host.ownerDocument);
    this.drawer = new Drawer({ host: opts.host, onOpenChange: opts.onOpenChange });
  }
  open() {
    this.view = "main";
    this.render();
    this.drawer.show();
  }
  close() {
    this.drawer.hide();
  }
  destroy() {
    this.drawer.destroy();
  }
  show(view) {
    this.view = view;
    this.render();
  }
  render() {
    const doc = this.drawer.body.ownerDocument;
    this.drawer.body.replaceChildren();
    if (this.view !== "main") {
      const back = doc.createElement("button");
      back.className = "vela-md-back";
      back.appendChild(iconEl("chevron-left", doc));
      back.appendChild(doc.createTextNode(this.view === "style" ? "Chart type" : this.view === "layout" ? "Layout" : "Alerts"));
      back.addEventListener("click", () => this.show("main"));
      this.drawer.body.appendChild(back);
    }
    if (this.view === "main") this.renderMain(doc);
    else if (this.view === "style") this.renderStyle(doc);
    else if (this.view === "layout") this.renderLayout(doc);
    else this.renderAlerts(doc);
  }
  row(doc, label, opts) {
    const el = doc.createElement("div");
    el.className = "vela-md-row";
    if (opts.icon) {
      const icon2 = iconEl(opts.icon, doc);
      if (opts.glyph) icon2.innerHTML = opts.glyph;
      el.appendChild(icon2);
    }
    const text = doc.createElement("span");
    text.className = "vela-md-row-label";
    text.textContent = label;
    el.appendChild(text);
    if (opts.value) {
      const value = doc.createElement("span");
      value.className = "vela-md-row-value";
      value.textContent = opts.value;
      el.appendChild(value);
    }
    if (opts.checked) el.dataset.checked = "1";
    if (opts.chevron) el.appendChild(iconEl("chevron-right", doc));
    el.addEventListener("click", opts.onClick);
    return el;
  }
  renderMain(doc) {
    const actions = doc.createElement("div");
    actions.className = "vela-md-actions";
    const action = (icon2, label, enabled, run) => {
      const b = doc.createElement("button");
      b.className = "vela-md-action";
      b.disabled = !enabled;
      b.appendChild(iconEl(icon2, doc));
      b.appendChild(doc.createTextNode(label));
      b.addEventListener("click", () => {
        run();
        this.drawer.hide();
      });
      actions.appendChild(b);
    };
    if (this.opts.onUndo) action("undo", "Undo", this.opts.canUndo(), this.opts.onUndo);
    if (this.opts.onRedo) action("redo", "Redo", this.opts.canRedo(), this.opts.onRedo);
    if (this.opts.onScreenshot) action("camera", "Screenshot", true, this.opts.onScreenshot);
    if (actions.childElementCount > 0) this.drawer.body.appendChild(actions);
    const list = doc.createElement("div");
    list.className = "vela-md-list";
    const current = this.opts.priceStyles().find((s) => s.id === this.opts.priceStyle());
    list.appendChild(this.row(doc, "Chart type", { icon: "style-line", value: current?.label, chevron: true, onClick: () => this.show("style") }));
    if (this.opts.layout) {
      const shape = this.opts.layout.shape();
      const value = shape ? `${shape.cols} \xD7 ${shape.rows}` : this.opts.layout.presets().find((p) => p.checked)?.label;
      list.appendChild(this.row(doc, "Layout", { icon: "layout", glyph: this.opts.layout.glyph?.(), value, chevron: true, onClick: () => this.show("layout") }));
    }
    for (const act of this.opts.primaryActions?.() ?? []) list.appendChild(this.actionRow(doc, act));
    for (const panel of this.opts.panels()) {
      list.appendChild(
        this.row(doc, panel.title, {
          icon: panel.icon,
          onClick: () => {
            this.opts.onTogglePanel(panel.id);
            this.drawer.hide();
          }
        })
      );
    }
    if (this.opts.alerts) {
      const alertCount = this.opts.alerts().length;
      list.appendChild(this.row(doc, "Alerts", { icon: "bell", value: alertCount > 0 ? String(alertCount) : void 0, chevron: true, onClick: () => this.show("alerts") }));
    }
    for (const act of this.opts.actions()) list.appendChild(this.actionRow(doc, act));
    this.drawer.body.appendChild(list);
  }
  /** A contributed action's row: runs it and closes the drawer. */
  actionRow(doc, act) {
    return this.row(doc, act.label, {
      icon: act.icon,
      onClick: () => {
        act.run();
        this.drawer.hide();
      }
    });
  }
  renderStyle(doc) {
    const list = doc.createElement("div");
    list.className = "vela-md-list";
    const current = this.opts.priceStyle();
    for (const style of this.opts.priceStyles()) {
      list.appendChild(
        this.row(doc, style.label, {
          icon: style.icon,
          checked: style.id === current,
          onClick: () => {
            this.opts.onPriceStyle(style.id);
            this.drawer.hide();
          }
        })
      );
    }
    this.drawer.body.appendChild(list);
  }
  renderLayout(doc) {
    const layout = this.opts.layout;
    if (!layout) return;
    const list = doc.createElement("div");
    list.className = "vela-md-list";
    const wrap = doc.createElement("div");
    wrap.className = "vela-md-gridwrap";
    const { el: grid, squares } = layoutGridCanvas(doc);
    paintLayoutGrid(squares, layout.shape());
    grid.addEventListener("click", (e) => {
      const sq = e.target?.closest?.(".vela-lp-sq");
      if (!(sq instanceof HTMLButtonElement)) return;
      layout.onSelectGrid(Number(sq.dataset.r) + 1, Number(sq.dataset.c) + 1);
      this.drawer.hide();
    });
    wrap.appendChild(grid);
    list.appendChild(wrap);
    for (const preset of layout.presets()) {
      list.appendChild(
        this.row(doc, preset.label, {
          checked: preset.checked,
          onClick: () => {
            layout.onSelectPreset(preset.id);
            this.drawer.hide();
          }
        })
      );
    }
    const syncs = layout.syncs?.() ?? [];
    if (syncs.length > 0) {
      const heading = doc.createElement("div");
      heading.className = "vela-md-section";
      heading.textContent = "Sync";
      list.appendChild(heading);
      for (const s of syncs) {
        list.appendChild(
          this.row(doc, s.label, {
            checked: s.checked,
            onClick: () => {
              layout.onToggleSync?.(s.id);
              this.render();
            }
          })
        );
      }
    }
    this.drawer.body.appendChild(list);
  }
  renderAlerts(doc) {
    const alerts = this.opts.alerts?.() ?? [];
    if (alerts.length === 0) {
      const empty = doc.createElement("div");
      empty.className = "vela-md-empty";
      empty.textContent = "No alerts yet.";
      this.drawer.body.appendChild(empty);
      return;
    }
    const list = doc.createElement("div");
    list.className = "vela-md-list";
    for (const a of alerts) {
      list.appendChild(this.row(doc, `${a.title}: ${a.message}`, { value: new Date(a.time).toLocaleTimeString(), onClick: () => void 0 }));
    }
    this.drawer.body.appendChild(list);
  }
};

// src/widget/timezone-drawer.ts
var STYLE_ID18 = "vela-widget-timezone-drawer";
var CSS18 = `
.vela-tzd-list { padding: 2px 0 4px; }
.vela-tzd-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-tzd-row:active { background: var(--vela-hover); }
.vela-tzd-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-tzd-row .vela-icon { flex: none; color: var(--vela-fg-bright); }
`;
var TimezoneDrawer = class {
  constructor(opts) {
    this.opts = opts;
    injectStyles(STYLE_ID18, CSS18, opts.host.ownerDocument);
    this.drawer = new Drawer({ host: opts.host, title: "Time zone", onOpenChange: opts.onOpenChange });
  }
  open() {
    this.render();
    this.drawer.show();
  }
  close() {
    this.drawer.hide();
  }
  destroy() {
    this.drawer.destroy();
  }
  render() {
    const doc = this.drawer.body.ownerDocument;
    this.drawer.body.replaceChildren();
    const list = doc.createElement("div");
    list.className = "vela-tzd-list";
    for (const tz of timezoneMenuRows(this.opts.timezone())) {
      const row = doc.createElement("div");
      row.className = "vela-tzd-row";
      const label = doc.createElement("span");
      label.className = "vela-tzd-row-label";
      label.textContent = tz.label;
      row.appendChild(label);
      if (tz.checked) row.appendChild(iconEl("check", doc));
      row.addEventListener("click", () => {
        this.opts.onTimezone(tz.value);
        this.drawer.hide();
      });
      list.appendChild(row);
    }
    this.drawer.body.appendChild(list);
  }
};

// src/widget/price-scale-drawer.ts
var STYLE_ID19 = "vela-widget-price-scale-drawer";
var CSS19 = `
.vela-psd-list { padding: 2px 0 4px; }
.vela-psd-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-psd-row:active { background: var(--vela-hover); }
.vela-psd-row[data-sep='1'] { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--vela-border); border-radius: 0 0 8px 8px; }
.vela-psd-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-psd-row .vela-icon { flex: none; color: var(--vela-fg-bright); }
.vela-psd-section {
    padding: 12px 2px 4px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
`;
var PriceScaleDrawer = class {
  constructor(opts) {
    this.opts = opts;
    this.pane = null;
    injectStyles(STYLE_ID19, CSS19, opts.host.ownerDocument);
    this.drawer = new Drawer({ host: opts.host, title: "Price scale", onOpenChange: opts.onOpenChange });
  }
  open() {
    const chart = this.opts.chart();
    const panes = chart?.renderer.get("paneScales");
    this.pane = Array.isArray(panes) ? paneScaleAt(panes, this.opts.pressY()) : null;
    this.render();
    this.drawer.show();
  }
  close() {
    this.drawer.hide();
  }
  destroy() {
    this.drawer.destroy();
  }
  flag(feature) {
    return Boolean(this.opts.chart()?.renderer.get(feature));
  }
  render() {
    const chart = this.opts.chart();
    const doc = this.drawer.body.ownerDocument;
    this.drawer.body.replaceChildren();
    if (!chart) return;
    const pane = this.pane;
    const items = priceAxisItems({
      auto: chart.renderer.get("autoScale") !== false,
      invert: pane ? pane.invert : this.flag("invertScale"),
      choice: scaleChoiceOf(pane ?? { mode: String(chart.renderer.get("scaleMode") ?? "price"), log: this.flag("logScale") }),
      axisLabels: this.flag("axisLabels"),
      priceLabel: this.flag("priceLabel"),
      countdown: this.flag("countdown"),
      priceLine: this.flag("currentPriceLine")
    });
    const list = doc.createElement("div");
    list.className = "vela-psd-list";
    const row = (label, opts) => {
      const el = doc.createElement("div");
      el.className = "vela-psd-row";
      if (opts.sep) el.dataset.sep = "1";
      const text = doc.createElement("span");
      text.className = "vela-psd-row-label";
      text.textContent = label;
      el.appendChild(text);
      if (opts.checked) el.appendChild(iconEl("check", doc));
      el.addEventListener("click", opts.onClick);
      list.appendChild(el);
    };
    const section = (label) => {
      const el = doc.createElement("div");
      el.className = "vela-psd-section";
      el.textContent = label;
      list.appendChild(el);
    };
    for (const item of items) {
      if (item.id === "labels" && item.submenu) {
        section("Labels");
        for (const sub of item.submenu) {
          row(sub.label, {
            checked: sub.checked,
            onClick: () => {
              const feature = sub.id.slice("toggle:".length);
              chart.renderer.set(feature, !this.flag(feature));
              this.render();
            }
          });
        }
        continue;
      }
      if (item.id === "levels" && item.submenu) {
        section("Levels");
        for (const sub of item.submenu) {
          row(sub.label, {
            checked: sub.checked,
            onClick: () => {
              const feature = sub.id.slice("toggle:".length);
              chart.renderer.set(feature, !this.flag(feature));
              this.render();
            }
          });
        }
        continue;
      }
      if (item.id.startsWith("settings")) {
        row(item.label, {
          sep: true,
          onClick: () => {
            chart.renderer.openSettings(settingsSectionOf(item.id));
            this.drawer.hide();
          }
        });
        continue;
      }
      if (item.id === "auto") {
        row(item.label, {
          checked: item.checked,
          onClick: () => {
            chart.renderer.set("autoScale", chart.renderer.get("autoScale") === false);
            this.render();
          }
        });
        continue;
      }
      if (item.id === "invert") {
        row(item.label, {
          checked: item.checked,
          onClick: () => {
            const [feature, value] = invertWrite(!(pane ? pane.invert : this.flag("invertScale")), pane);
            chart.renderer.set(feature, value);
            const panes = chart.renderer.get("paneScales");
            this.pane = Array.isArray(panes) ? paneScaleAt(panes, this.opts.pressY()) : pane;
            this.render();
          }
        });
        continue;
      }
      if (item.id.startsWith("scale:")) {
        row(item.label, {
          checked: item.checked,
          sep: item.separatorBefore,
          onClick: () => {
            for (const [feature, value] of scaleWrites(item.id.slice("scale:".length), pane)) {
              chart.renderer.set(feature, value);
            }
            const panes = chart.renderer.get("paneScales");
            this.pane = Array.isArray(panes) ? paneScaleAt(panes, this.opts.pressY()) : pane;
            this.render();
          }
        });
      }
    }
    this.drawer.body.appendChild(list);
  }
};

// src/widget/drawing-pill.ts
var STYLE_ID20 = "vela-widget-drawing-pill";
var CSS20 = `
.vela-drawpill { display: none; }
[data-layout='mobile'] .vela-drawpill {
    position: absolute;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    z-index: 7;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border: 1px solid var(--vela-border-strong);
    border-radius: 999px;
    background: var(--vela-surface);
    box-shadow: var(--vela-shadow-dialog);
    color: var(--vela-fg);
}
[data-layout='mobile'] .vela-drawpill[hidden] { display: none !important; }
.vela-drawpill-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: var(--vela-hover);
    color: var(--vela-accent);
}
.vela-drawpill-tool svg { width: 22px; height: 22px; }
.vela-drawpill-btn {
    all: unset;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    position: relative;
}
.vela-drawpill-btn:active { background: var(--vela-hover); }
.vela-drawpill-btn[data-on='1'] { color: var(--vela-accent); background: var(--vela-hover); }
.vela-drawpill-btn .vela-icon { font-size: 17px; width: 17px; height: 17px; }
.vela-drawpill-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    font-size: 8px;
    font-weight: 700;
    color: var(--vela-accent);
}
`;
var DrawingPill = class {
  constructor(host) {
    this.chart = null;
    this.chartSubs = [];
    const doc = host.ownerDocument;
    injectStyles(STYLE_ID20, CSS20, doc);
    this.el = doc.createElement("div");
    this.el.className = "vela-drawpill";
    this.el.hidden = true;
    this.toolGlyph = doc.createElement("span");
    this.toolGlyph.className = "vela-drawpill-tool";
    const btn = (icon2, label, onClick) => {
      const b = doc.createElement("button");
      b.className = "vela-drawpill-btn";
      b.setAttribute("aria-label", label);
      b.appendChild(iconEl(icon2, doc));
      b.addEventListener("click", onClick);
      return b;
    };
    this.magnetBtn = btn("magnet", "Magnet snap", () => {
      const order = ["off", "weak", "strong"];
      const cur = this.chart?.drawings.getSnapMode() ?? "off";
      this.chart?.drawings.setSnapMode(order[(order.indexOf(cur) + 1) % order.length]);
    });
    this.magnetBadge = doc.createElement("span");
    this.magnetBadge.className = "vela-drawpill-badge";
    this.magnetBtn.appendChild(this.magnetBadge);
    this.stayBtn = btn(iconMarkup("pen-lock") ? "pen-lock" : "pen", "Stay in drawing mode", () => {
      this.chart?.drawings.setStayMode(!this.chart.drawings.getStayMode());
    });
    this.eraserBtn = btn("eraser", "Eraser", () => {
      this.chart?.drawings.setMode(this.chart.drawings.getMode() === "eraser" ? null : "eraser");
    });
    const close = btn("close", "Exit drawing mode", () => {
      this.chart?.drawings.setTool(null);
      this.chart?.drawings.setMode(null);
    });
    this.el.append(this.toolGlyph, this.magnetBtn, this.stayBtn, this.eraserBtn, close);
    host.appendChild(this.el);
  }
  /** Rebind to another chart (a rebuild, or the workspace's active cell changing) —
   *  the previous chart's subscriptions are dropped so only one chart drives the pill. */
  onChart(chart) {
    for (const off of this.chartSubs) off();
    this.chart = chart;
    this.chartSubs = [
      chart.on("drawing:tool", () => this.sync()),
      chart.on("drawing:snap", () => this.sync()),
      chart.on("drawing:stay", () => this.sync()),
      chart.on("drawing:mode", () => this.sync())
    ];
    this.sync();
  }
  sync() {
    const drawings = this.chart?.drawings;
    if (!drawings || !drawings.supported) {
      this.el.hidden = true;
      return;
    }
    const tool = drawings.getTool();
    const eraser = drawings.getMode() === "eraser";
    this.el.hidden = tool === null && !eraser;
    if (this.el.hidden) return;
    this.toolGlyph.innerHTML = tool !== null ? getDrawingType(tool)?.icon ?? "" : iconMarkup("eraser") ?? "";
    const snap = drawings.getSnapMode();
    this.magnetBtn.dataset.on = snap !== "off" ? "1" : "";
    this.magnetBadge.textContent = snap === "weak" ? "W" : snap === "strong" ? "S" : "";
    this.stayBtn.dataset.on = drawings.getStayMode() ? "1" : "";
    this.eraserBtn.dataset.on = eraser ? "1" : "";
  }
  destroy() {
    for (const off of this.chartSubs) off();
    this.chartSubs = [];
    this.el.remove();
  }
};

// src/workspace/context.ts
function buildContext(host) {
  return {
    get chart() {
      const cell = host.active();
      if (!cell) throw new Error("VelaWorkspace has no active cell yet");
      return cell.chart;
    },
    get symbol() {
      return host.active()?.symbol ?? "";
    },
    get timeframe() {
      return host.active()?.timeframe ?? "60";
    },
    get priceStyle() {
      return host.active()?.priceStyle ?? "candles";
    },
    setSymbol: (symbol) => host.active()?.setSymbol(symbol),
    setTimeframe: (tf) => host.active()?.setTimeframe(tf),
    setPriceStyle: (style) => host.active()?.setPriceStyle(style),
    openSymbolSearch: (query) => host.openSymbolSearch(query),
    togglePanel: (id, open) => host.togglePanel(id, open),
    dockStrip: (el) => host.dockStrip(el),
    host: host.root,
    toast: (message, kind) => host.toast(message, kind),
    addIndicator: (entry) => host.active()?.addExternalIndicator(entry),
    addNativeIndicator: (type) => host.active()?.addNative(type),
    stateChanged: () => host.stateDirty(),
    get cells() {
      return host.cells().map((c) => ({ id: c.id, chart: c.chart, symbol: c.symbol, timeframe: c.timeframe }));
    },
    get activeCellId() {
      return host.active()?.id ?? "";
    },
    setActiveCell: (id) => host.setActiveCell(id),
    replay: host.replay
  };
}

// src/workspace/screenshot.ts
function destRect(tile, dpr) {
  const dx = Math.round(tile.x * dpr);
  const dy = Math.round(tile.y * dpr);
  return {
    dx,
    dy,
    dw: Math.round((tile.x + tile.width) * dpr) - dx,
    dh: Math.round((tile.y + tile.height) * dpr) - dy
  };
}
function tilesFromCellRects(grid, cells) {
  if (grid.width <= 0 || grid.height <= 0) return [];
  const tiles = [];
  for (const c of cells) {
    if (c.hidden || c.width <= 0 || c.height <= 0) continue;
    tiles.push({ x: c.left - grid.left, y: c.top - grid.top, width: c.width, height: c.height });
  }
  return tiles;
}
function compositeLayoutScreenshot(doc, frame, tiles) {
  if (frame.width <= 0 || frame.height <= 0 || tiles.length === 0) return null;
  const dpr = frame.dpr > 0 ? frame.dpr : 1;
  const out = doc.createElement("canvas");
  out.width = Math.max(1, Math.round(frame.width * dpr));
  out.height = Math.max(1, Math.round(frame.height * dpr));
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = frame.gapColor;
  ctx.fillRect(0, 0, out.width, out.height);
  let painted = 0;
  for (const tile of tiles) {
    if (tile.width <= 0 || tile.height <= 0) continue;
    const { dx, dy, dw, dh } = destRect(tile, dpr);
    if (dw <= 0 || dh <= 0) continue;
    ctx.drawImage(tile.source, dx, dy, dw, dh);
    painted += 1;
  }
  if (painted === 0) return null;
  return out.toDataURL("image/png");
}
function triggerPngDownload(doc, url, filename) {
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

// src/workspace/VelaWorkspace.ts
var DEFAULT_TIMEFRAMES = ["1", "5", "15", "30", "60", "240", "D", "W", "M"];
var GAP_PX = 2;
var POOL_CAP = 16;
var TIME_AXIS_H3 = 22;
var ALERT_CAP = 50;
var STYLE_ID21 = "vela-workspace";
var CSS21 = `
.vela-workspace { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--vela-bg); }
.vela-ws-main { position: relative; display: flex; flex-direction: row; flex: 1 1 auto; min-height: 0; }
.vela-ws-toolbar { position: relative; flex: none; }
.vela-ws-strips { position: relative; flex: none; display: flex; flex-direction: column; min-width: 0; }
.vela-ws-strips:empty { display: none; }
.vela-ws-grid { position: relative; flex: 1 1 auto; min-width: 0; display: grid; gap: ${GAP_PX}px; background: var(--vela-border-soft); }
.vela-cell { background: var(--vela-bg); position: relative; }
/* Active-cell highlight: an overlay ring ABOVE the chart's own canvas stack (a plain
   outline on the cell is painted under them) \u2014 inert to the pointer. Scoped to
   multi-cell grids ([data-multi]): a single-cell layout always has an active cell,
   and ringing the only chart would just be noise. */
.vela-ws-grid[data-multi='1'] .vela-cell[data-active='1']::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid var(--vela-fg-bright);
    pointer-events: none;
    z-index: 10;
}
/* Splitter hover mirrors the in-chart pane separator hover (CrosshairRenderer):
   a soft band over the whole grab target + a solid 2px line on the seam center. */
.vela-ws-splitter:hover { background: var(--vela-separator-hover-band); }
.vela-ws-splitter:hover::after { content: ''; position: absolute; background: var(--vela-separator-hover-line); }
.vela-ws-splitter[data-axis='cols']:hover::after { left: calc(50% - 1px); top: 0; width: 2px; height: 100%; }
.vela-ws-splitter[data-axis='rows']:hover::after { top: calc(50% - 1px); left: 0; height: 2px; width: 100%; }
/* Mobile: the docked drawing-toolbar column would eat a phone-width grid \u2014 the shell's
   drawings drawer + on-chart pill replace it (same policy as the widget's in-chart bar). */
[data-layout='mobile'] .vela-ws-toolbar { display: none; }
/* A maximized cell owns the whole grid: the splitter strips have no seams to grab and
   the active ring would just outline the only visible chart \u2014 both are noise here. */
.vela-ws-grid[data-maximized='1'] .vela-ws-splitter { display: none; }
.vela-ws-grid[data-maximized='1'] .vela-cell[data-active='1']::after { display: none; }
/* Drop-target preview while a cell's drag handle is held: a dashed ring + the same
   soft wash the splitter hover uses, over the chart, inert to the pointer. */
.vela-cell[data-drop-target='1']::before {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px dashed var(--vela-fg-bright);
    background: var(--vela-separator-hover-band);
    pointer-events: none;
    z-index: 11;
}
`;
registerIcon("layout", svg16('<rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/><path d="M8 1.5v13M1.5 8h13"/>'));
function declaredOrder(cells) {
  const names = Object.keys(cells ?? {});
  for (const n of names) {
    if (/^\d+$/.test(n)) {
      console.warn(`[vela] workspace cell "${n}" ignored \u2014 a purely-numeric name cannot keep its declaration order (JS object key semantics); use e.g. "cell${n}"`);
    }
  }
  return names.filter((n) => !/^\d+$/.test(n));
}
function nextAutoCellId(taken) {
  for (let i = 1; ; i += 1) {
    if (!taken.has(`c${i}`)) return `c${i}`;
  }
}
function resolveTyping(key, open) {
  if (open.dialogs > 0) {
    if (key.length !== 1) return null;
    if (open.symbolSearch) return { target: "symbol", text: key.toUpperCase() };
    if (open.timeframeEntry) return { target: "timeframe", text: key.toUpperCase() };
    return null;
  }
  if (/^[a-zA-Z0]$/.test(key)) return { target: "symbol", text: key.toUpperCase() };
  if (/^[1-9]$/.test(key)) return { target: "timeframe", text: key };
  return null;
}
var VelaWorkspace = class {
  constructor(container, opts = {}) {
    this.events = new TypedEventBus();
    this.feed = new MultiProviderFeed();
    this.cellsById = /* @__PURE__ */ new Map();
    /** The one second pulse behind every time display: the bottom-bar clock and each
     *  cell's countdown chip subscribe to it, so they can never read different seconds. */
    this.clock = new SecondClock();
    this.pool = /* @__PURE__ */ new Map();
    this.trackSizes = /* @__PURE__ */ new Map();
    this.resizeObserver = null;
    /** Cell identities by SLOT POSITION — `order[i]` lives in the layout's i-th slot.
     *  Names come from the `cells` declaration order (then the persisted document);
     *  slots beyond the list get auto identities. Grows, never reorders. */
    this.order = [];
    this.activeId = null;
    /** The cell maximized over the whole grid (null = normal grid). TRANSIENT view
     *  state — never persisted; any structural change (layout, applyState) restores. */
    this.maximizedId = null;
    this.cellBackend = "auto";
    this.destroyed = false;
    this.shortcutsHelp = null;
    this.glider = new Glider(() => this.activeId ? this.cellsById.get(this.activeId)?.chart ?? null : null);
    /** The GLOBAL armed tool/magnet/stay (workspace policy) — re-applied to whichever cell
     *  takes the focus; only the ACTIVE cell ever holds a non-null tool. Measure/eraser
     *  stay transient and per-cell: they exit when the focus leaves. */
    this.globalTool = null;
    this.globalSnap = "off";
    this.globalStay = false;
    /** Live subscription to the ACTIVE cell's unified history (rebound on every projection). */
    this.historyUnsub = null;
    /** Favorite drawing tools — a WORKSPACE preference (one star set, every cell). */
    this.favs = [];
    /** Favorite timeframes — the shared topbar's quick-switch chips, one set for the grid. */
    this.tfFavs = [];
    /** Live sync configuration (mutable copy of the option). */
    this.syncOpts = {};
    this.stateTimer = null;
    /** Re-entrance guard for {@link flushPendingState}: a `state:changed` subscriber that
     *  calls back into the workspace (`destroy()` on save is the obvious one) must not
     *  re-enter the flush and recurse. */
    this.emitting = false;
    /** False until the constructor finishes. Boot is not an edit: seeding the sync
     *  settings marks state dirty, so without this a workspace mounted and torn down
     *  inside the debounce window would flush and tell the host the user had changed
     *  something — a save of the default document over whatever was stored. */
    this.booted = false;
    /** A page unload gets the same flush as a teardown — the pending edit reaches the
     *  host, the timer is cleared, and a `destroy()` that follows adds no second write. */
    this.onUnload = () => {
      this.flushPendingState();
      this.persistNow();
    };
    /** Re-entrance guard around one propagation tick: followers' synchronous echoes
     *  (their setVisibleRange re-emits viewport:changed) must not re-propagate. */
    this.syncBusy = false;
    /** Same guard for the drawings link: the propagated mutations' own `drawing:*`
     *  events fire synchronously inside the propagation loop and must not fan out again. */
    this.drawingSyncBusy = false;
    /** Same guard for the style link: a follower's `applyConfig` re-fires its
     *  `onConfigChanged` in the same tick, and a state restore applies per-cell
     *  configs that legitimately differ — neither must propagate. */
    this.styleSyncBusy = false;
    /** LINKED drawings (the drawings sync): one map per synced set (cellId → that
     *  cell's drawing id), reachable from every member under its `cellId\0drawingId`
     *  key — any member finds its peers to push edits/removals onto. Survives a
     *  toggle-off (propagation freezes while the setting is off; re-enabling resumes
     *  edit/delete for these pairs). Cleared on reload / `applyState`. */
    this.drawingLinks = /* @__PURE__ */ new Map();
    this.manifest = [];
    /** The shared manifest can no longer change instance sets — resolved, or no
     *  `indicators` option so nothing ever will. Gates the cells' ledger fallback. */
    this.manifestSettled = false;
    this.openDialogs = 0;
    this.alerts = [];
    this.alertsMenu = null;
    this.tfDrawer = null;
    this.drawingsDrawer = null;
    this.moreDrawer = null;
    this.timezoneDrawer = null;
    this.priceScaleDrawer = null;
    /** Plot-local y of the last price-axis long-press (targets the pane under the finger). */
    this.priceScalePressY = 0;
    this.attachmentDisposers = /* @__PURE__ */ new Map();
    /** The document-level third-party state bag (`state.ext`) — seeded from the restored
     *  document, refreshed by global-scope handler `serialize` calls at snapshot time.
     *  Entries with no registered handler this session ride along verbatim. */
    this.extState = {};
    /** The single grid-wide attribution mark — re-inked on a live theme swap. */
    this.attributionMark = null;
    this.onRootKeydown = (ev) => this.routeTyping(ev);
    /** The sync-link control surface: `set(kind, true | {cellId: group} | false)`,
     *  `get(kind)`, `state()`. Enabling a market/viewport link aligns the followers to
     *  the ACTIVE cell once, so the grid starts coherent; `crosshair` mirrors the
     *  pointer time as ghost crosshairs on the followers (also a toggle in the layout
     *  dropdown). */
    this.sync = {
      set: (kind, setting) => this.applySyncSetting(kind, setting === false ? void 0 : setting, true),
      get: (kind) => this.syncOpts[kind],
      state: () => ({ ...this.syncOpts })
    };
    registerBuiltinLayouts();
    registerBuiltinChartTypes();
    const hostEl = typeof container === "string" ? document.querySelector(container) : container;
    if (!hostEl) throw new Error(`VelaWorkspace: container not found: ${String(container)}`);
    this.opts = opts;
    this.replay = new WorkspaceReplay({
      cells: () => this.cells(),
      activeId: () => this.activeId,
      onCells: (handler) => {
        const offs = [
          this.events.on("cell:created", ({ id }) => handler({ kind: "created", id })),
          this.events.on("cell:destroyed", ({ id }) => handler({ kind: "destroyed", id })),
          this.events.on("cell:active", ({ id }) => handler({ kind: "active", id }))
        ];
        return () => {
          for (const off of offs) off();
        };
      }
    });
    this.persistKey = opts.persist === void 0 || opts.persist === false ? null : opts.persist === true ? "vela-workspace" : opts.persist;
    this.storage = opts.storage ?? localStorageAdapter();
    let boot = null;
    if (this.persistKey !== null) {
      const raw = this.storage.get(this.persistKey);
      if (typeof raw === "string") boot = decodeState(raw);
      else if (raw != null && typeof raw === "object") {
        void raw.then((r) => {
          if (!this.destroyed && r) this.applyState(decodeState(r));
        });
      }
      if (typeof window !== "undefined") window.addEventListener("beforeunload", this.onUnload);
    }
    this.timezone = boot?.timezone ?? opts.timezone ?? "Etc/UTC";
    if (boot?.favorites) this.favs = [...boot.favorites];
    if (boot?.timeframeFavorites) this.tfFavs = [...boot.timeframeFavorites];
    const sync = boot?.sync ?? opts.sync;
    for (const kind of SYNC_KINDS) this.applySyncSetting(kind, sync?.[kind]);
    this.monoLayout = opts.layout === false;
    const optLayout = opts.layout === false || opts.layout === void 0 ? "4" : opts.layout;
    this.def = this.resolveLayout(this.monoLayout ? "1" : boot?.layout && ensureLayout(boot.layout) ? boot.layout : optLayout);
    this.alertCap = Math.max(1, opts.alertCap ?? ALERT_CAP);
    this.topbarComp = resolveTopbarComposition(opts.topbar);
    this.indicatorsOverride = topbarActionOverride("indicators");
    this.screenshotOverride = topbarActionOverride("screenshot");
    if (boot?.trackSizes) for (const [id, ts] of Object.entries(boot.trackSizes)) this.trackSizes.set(id, ts);
    if (boot?.ext) this.extState = { ...boot.ext };
    if (boot?.charts) for (const { id, ...cs } of boot.charts) this.pool.set(id, cs);
    this.order = boot?.charts ? boot.charts.map((c) => c.id) : declaredOrder(opts.cells);
    const bootActive = boot?.activeCellId ?? null;
    const doc = hostEl.ownerDocument;
    injectStyles(STYLE_ID21, CSS21, doc);
    this.root = doc.createElement("div");
    this.root.className = "vela-workspace";
    ensureUIHost(this.root, resolveTheme(opts.theme));
    for (const [name, make] of Object.entries(opts.providers ?? {})) void this.feed.registerProvider(name, make());
    void this.feed.ready().then(() => {
      if (!this.destroyed) this.refreshRetention();
    });
    this.symbolPicker = new SymbolPicker({
      host: this.root,
      // Row icons come from each descriptor's OWNING provider (resolveSymbolIcon).
      iconFor: (d) => this.feed.symbolIconOf(d),
      onSelect: (ticker) => this.active.setSymbol(ticker),
      onOpenChange: (open) => {
        if (open) for (const cell of this.cells()) cell.chart.renderer.closeDialogs();
        this.trackDialog(open);
      }
    });
    this.symbolPicker.setSource(() => this.feed.symbols());
    this.indicatorPicker = opts.indicatorPicker !== false && !this.indicatorsOverride && topbarHas(this.topbarComp, "indicators") ? new IndicatorPicker({
      host: this.root,
      library: () => this.active.libraryRows(),
      onChart: () => this.active.onChartRows(),
      onAdd: (i) => this.active.addFromLibrary(i),
      onRemove: (i) => this.active.removeFromChart(i),
      onOpenChange: (open) => {
        if (open) for (const cell of this.cells()) cell.chart.renderer.closeDialogs();
        this.trackDialog(open);
      }
    }) : null;
    const picker = this.indicatorPicker;
    this.tfQuick = new TimeframeQuick({
      host: this.root,
      onApply: (tf) => this.setActiveTimeframe(tf),
      onOpenChange: (open) => this.trackDialog(open)
    });
    this.topbar = new Topbar(this.root, {
      symbol: "",
      // RAW option, not the resolved lists — the bar distinguishes a host-declared
      // side (list is law) from a default one (an override's `order` may flow).
      composition: opts.topbar,
      onSymbolClick: () => this.symbolPicker.open(),
      ...picker ? { onIndicatorsClick: () => picker.open() } : {},
      onUndoClick: () => this.active.history.undo(),
      onRedoClick: () => this.active.history.redo(),
      onScreenshotClick: () => this.downloadScreenshot(),
      onAlertsClick: (anchor) => this.openAlertsMenu(anchor),
      timeframe: "60",
      timeframes: opts.timeframes ?? DEFAULT_TIMEFRAMES,
      timeframeFavorites: this.tfFavs,
      priceStyle: "candles",
      onTimeframe: (tf) => this.setActiveTimeframe(tf),
      onTimeframeFavorite: (tf, on) => this.setTimeframeFavorite(tf, on),
      onPriceStyle: (style) => this.active.setPriceStyle(style),
      // Single-chart mode: no layout block at all — the topbar renders no layout
      // button and no sync switches (see TopbarOptions.layout).
      layout: this.monoLayout ? void 0 : {
        current: this.def.id,
        // The picker composes dynamic layouts on its grid canvas; registered
        // presets the canvas cannot express (bespoke plugin areas) list as rows.
        shape: () => layoutShape(this.def),
        presets: () => layouts().filter((l) => layoutShape(l) === null).map((l) => ({ id: l.id, label: l.label })),
        onSelectGrid: (rows, cols) => this.setLayout(layoutForGrid(rows, cols)),
        onSelectPreset: (id) => this.setLayout(id),
        // The SYNC switches reflect the simple all-cells form; flipping one
        // OVERRIDES a host-set group record with plain on/off (groups stay an
        // API-only shape).
        syncs: () => [
          { id: "symbol", label: "Symbol", checked: this.syncOpts.symbol === true },
          { id: "timeframe", label: "Interval", checked: this.syncOpts.timeframe === true },
          { id: "crosshair", label: "Crosshair", checked: this.syncOpts.crosshair === true },
          { id: "style", label: "Style", checked: this.syncOpts.style === true }
        ],
        onToggleSync: (id) => {
          const kind = id;
          this.sync.set(kind, this.syncOpts[kind] ? false : true);
        },
        glyph: () => layoutGlyph(this.def)
      },
      getContext: () => this.context()
    });
    const main = doc.createElement("div");
    main.className = "vela-ws-main";
    const toolbar = buildToolbar(opts.drawings);
    this.drawingsEnabled = opts.drawings !== false;
    this.toolbarDef = toolbar.definition;
    let toolbarHost = null;
    if (this.drawingsEnabled && toolbar.visible && opts.drawingToolbar !== false) {
      toolbarHost = doc.createElement("div");
      toolbarHost.className = "vela-ws-toolbar";
      main.appendChild(toolbarHost);
    }
    this.gridEl = doc.createElement("div");
    this.gridEl.className = "vela-ws-grid";
    main.appendChild(this.gridEl);
    this.dock = new PanelDock(main, {
      chrome: this.topbar,
      context: () => this.context(),
      changed: () => this.markStateDirty()
    });
    this.objectTree = new ObjectTree(main, (sym) => this.feed.symbolIcon(sym));
    this.dataWindow = new DataWindow(main);
    this.dock.addBuiltIn({ id: "dataWindow", title: "Data window", icon: "datawindow", order: 10, panel: this.dataWindow, onChart: (c) => this.dataWindow.onChart(c) });
    this.dock.addBuiltIn({ id: "objects", title: "Object tree", icon: "objects", order: 20, panel: this.objectTree, onChart: (c) => this.objectTree.onChart(c) });
    this.dock.refresh();
    if (boot?.panels) this.dock.applyState(boot.panels);
    this.root.appendChild(main);
    this.stripsEl = doc.createElement("div");
    this.stripsEl.className = "vela-ws-strips";
    this.root.appendChild(this.stripsEl);
    this.toastHost = new Toast(this.gridEl);
    const attribution = rendererDefaults().attribution;
    if (attribution !== false) {
      const background = resolveTheme(opts.theme).background;
      const mark = typeof attribution === "string" && attribution.trim() ? createCustomMark(doc, attribution, background) : createAttributionMark(doc, background);
      Object.assign(mark.style, {
        left: "calc(var(--vela-toolbar-gutter, 0px) + 12px)",
        bottom: `calc(var(--vela-bottom-gutter, ${TIME_AXIS_H3}px) + 10px)`,
        zIndex: "11"
      });
      mark.dataset.velaScreenshot = "1";
      this.gridEl.appendChild(mark);
      this.attributionMark = mark;
    }
    this.drawToolbar = toolbarHost ? new DrawingToolbar(
      toolbarHost,
      resolveTheme(opts.theme),
      (type) => {
        this.active.chart.drawings.setTool(type);
        this.refocusActive();
      },
      (mode) => {
        this.active.chart.drawings.setSnapMode(mode);
        this.refocusActive();
      },
      () => {
        const d = this.active.chart.drawings;
        d.setMode(d.getMode() === "measure" ? null : "measure");
        this.refocusActive();
      },
      () => {
        const d = this.active.chart.drawings;
        d.setMode(d.getMode() === "eraser" ? null : "eraser");
        this.refocusActive();
      },
      // No refocus on a star: the flyout stays open for more browsing.
      (type, on) => this.active.chart.drawings.setFavorite(type, on),
      (on) => {
        this.active.chart.drawings.setStayMode(on);
        this.refocusActive();
      },
      {
        dock: "static",
        // Drawings sync is a WORKSPACE link (same model as the layout
        // dropdown's switches) — the bar only hosts its toggle.
        onDrawingsSync: (on) => {
          this.sync.set("drawings", on);
          this.refocusActive();
        }
      }
    ) : null;
    this.drawToolbar?.setDefinition(this.toolbarDef);
    this.drawToolbar?.setVisible(true);
    this.drawToolbar?.setDrawingsSyncMode(!!this.syncOpts.drawings);
    this.bottombar = opts.bottombar !== false ? new Bottombar(this.root, {
      timezone: this.timezone,
      clock: this.clock,
      onRange: (preset) => {
        this.active.applyRange(preset);
        this.bottombar?.setActiveRange(preset.id);
      },
      onTimezone: (zone) => this.setTimezone(zone),
      // RTH/ETH acts on the ACTIVE cell (like the range chips): sessions
      // are a per-chart market dimension, not a shell preference.
      onSession: (session) => this.active.setSession(session),
      onSettingsClick: () => this.active.chart.renderer.openSettings()
    }) : null;
    this.mobileBar = opts.bottombar !== false ? new MobileBar(this.root, {
      symbol: "",
      timeframe: "60",
      onSymbolClick: () => this.symbolPicker.open(),
      onTimeframeClick: () => this.openTimeframeDrawer(),
      // Same visibility truth as the desktop bar: composition-hidden
      // indicators lose their mobile stop too; an override takes it over.
      ...topbarHas(this.topbarComp, "indicators") && (picker || this.indicatorsOverride) ? { onIndicatorsClick: this.indicatorsOverride ? () => this.runOverride(this.indicatorsOverride) : () => picker.open() } : {},
      getContext: () => this.context(),
      ...this.drawingsEnabled ? { onDrawingsClick: () => this.openDrawingsDrawer() } : {},
      // Multi-chart only: the stop that isolates the ACTIVE chart (the
      // per-cell hover cluster has no cursor to reveal it on mobile).
      ...this.monoLayout ? {} : { onMaximizeClick: () => this.toggleMobileMaximize() },
      onMoreClick: () => this.openMoreDrawer(),
      onSettingsClick: () => this.active.chart.renderer.openSettings()
    }) : null;
    this.drawingPill = this.drawingsEnabled ? new DrawingPill(this.gridEl) : null;
    hostEl.appendChild(this.root);
    this.layoutCtl = new LayoutModeController(this.root, opts.layoutMode ?? "auto");
    this.layoutCtl.onChange((mode) => this.onLayoutModeChange(mode));
    this.splitters = new SplitterLayer(this.gridEl, {
      tracks: () => this.currentTracks(),
      grid: () => occupancyGrid(this.def),
      apply: (axis, weights) => this.applyTracks(axis, weights),
      reset: (axis) => this.applyTracks(axis, evenTracks(this.currentTracks()[axis].length)),
      gapPx: () => GAP_PX
    });
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.splitters.layout());
      this.resizeObserver.observe(this.gridEl);
    }
    this.keymap = new KeymapManager();
    this.keymap.attach(this.root);
    this.registerDefaultKeys();
    this.drawToolbar?.setShortcuts(toolShortcutHints(this.keymap));
    this.root.addEventListener("keydown", this.onRootKeydown);
    this.root.tabIndex = -1;
    this.cellBackend = this.backendFor(this.def);
    this.applyGrid();
    this.buildCells();
    this.syncCellPresentation();
    this.setActiveCell(bootActive != null && this.cellsById.has(bootActive) ? bootActive : this.order[0] ?? null);
    if (opts.autofocus) this.refocusActive();
    if (opts.indicators !== void 0) {
      void resolveIndicators(opts.indicators).then((list) => {
        if (this.destroyed) return;
        this.manifest = list;
        this.manifestSettled = true;
        for (const cell of this.cellsById.values()) cell.setManifest(list, true);
        this.projectActiveCell();
      });
    } else {
      this.manifestSettled = true;
    }
    this.mountAttachments();
    this.restoreGlobalExt();
    this.booted = true;
  }
  // ── access ──────────────────────────────────────────────────
  /** The cell with identity `id` (its declared name, or `c<N>` when undeclared), or
   *  undefined when no live cell holds it. */
  cell(id) {
    return this.cellsById.get(id);
  }
  /** Every live cell, in slot order. Enumerated over `order` — the IDENTITY space —
   *  never the layout's positional slot ids, which only coincide with it for a
   *  workspace whose cells are undeclared. Identities past the current layout size are
   *  pooled, not live, so they drop out here. */
  cells() {
    return this.order.map((id) => this.cellsById.get(id)).filter((c) => c != null);
  }
  /** The ACTIVE cell — the one the shared chrome reflects and acts on. */
  get active() {
    const cell = this.activeId ? this.cellsById.get(this.activeId) : void 0;
    if (!cell) throw new Error("VelaWorkspace has no active cell (destroyed?)");
    return cell;
  }
  /** Shortcut for `active.chart` — the same habit as `widget.chart`. LIVE: read it at
   *  the point of use; the durable identity to hold is the cell (or its id). */
  get chart() {
    return this.active.chart;
  }
  /**
   * PNG data URL of the visible layout: every live cell in its grid slot, or the
   * maximized cell alone. Same pixels the screenshot button downloads. A single
   * visible cell returns that cell's own chart export (the one-chart case).
   */
  screenshot() {
    const cells = this.shotCells();
    if (cells.length === 0) return null;
    if (cells.length === 1) return cells[0].chart.renderer.screenshot();
    return this.compositeLayoutShot(cells);
  }
  /** Download {@link screenshot} as a PNG. A multi-cell layout is named
   *  `vela-layout.png`; one visible cell keeps `${symbol}-${timeframe}.png`. */
  downloadScreenshot() {
    const cells = this.shotCells();
    if (cells.length <= 1) {
      (cells[0] ?? this.active).downloadScreenshot();
      return;
    }
    const url = this.compositeLayoutShot(cells);
    if (!url) return;
    triggerPngDownload(this.root.ownerDocument, url, "vela-layout.png");
  }
  /** Live cells the screenshot should include — maximized siblings are `hidden`. */
  shotCells() {
    return this.cells().filter((c) => c.host.style.visibility !== "hidden");
  }
  /** Place every cell's raster onto one canvas the size of the grid. */
  compositeLayoutShot(cells) {
    const gridEl = this.gridEl;
    const grid = gridEl.getBoundingClientRect();
    const win = gridEl.ownerDocument.defaultView;
    const dpr = win?.devicePixelRatio ?? 1;
    const gapColor = win ? win.getComputedStyle(gridEl).backgroundColor : "";
    const tiles = [];
    for (const cell of cells) {
      const source = cell.screenshotCanvas();
      if (!source) continue;
      const r = cell.host.getBoundingClientRect();
      const place = tilesFromCellRects(grid, [{ left: r.left, top: r.top, width: r.width, height: r.height }])[0];
      if (!place) continue;
      tiles.push({ source, ...place });
    }
    return compositeLayoutScreenshot(gridEl.ownerDocument, {
      width: grid.width,
      height: grid.height,
      dpr,
      gapColor: gapColor || "#000000"
    }, tiles);
  }
  setActiveCell(id) {
    if (id === this.activeId || this.destroyed) return;
    const prev = this.activeId;
    if (prev) {
      const el = this.cellsById.get(prev)?.host;
      if (el) delete el.dataset.active;
    }
    this.activeId = id;
    const prevCell = prev ? this.cellsById.get(prev) : void 0;
    if (prevCell) {
      prevCell.chart.drawings.setTool(null);
      prevCell.chart.drawings.setMode(null);
    }
    if (id) {
      const el = this.cellsById.get(id)?.host;
      if (el) el.dataset.active = "1";
    }
    if (id) {
      this.projectActiveCell();
      this.events.emit("cell:active", { id, prev });
      this.markStateDirty();
    }
  }
  on(event, handler) {
    return this.events.on(event, handler);
  }
  /** The context handed to contributed actions/attachments (rebuilt per invocation). */
  context() {
    return buildContext({
      // Null during early construction (the topbar projects actions before cells exist).
      active: () => this.activeId ? this.cellsById.get(this.activeId) ?? null : null,
      cells: () => this.cells(),
      setActiveCell: (id) => this.setActiveCell(id),
      openSymbolSearch: (query) => this.symbolPicker.open(query ?? ""),
      togglePanel: (id, open) => this.dock.toggle(id, open),
      dockStrip: (el) => {
        this.stripsEl.appendChild(el);
        return () => {
          if (el.parentElement === this.stripsEl) el.remove();
        };
      },
      root: this.root,
      toast: (message, kind) => this.toastHost.show(message, kind),
      stateDirty: () => this.markStateDirty(),
      replay: this.replay
    });
  }
  /** Re-project contributed topbar actions + side panels, and mount late-registered attachments. */
  refreshActions() {
    this.mountAttachments();
    this.topbar.renderActions();
    this.mobileBar?.renderActions();
    this.dock.refresh();
    for (const cell of this.cells()) {
      cell.chart.renderer.setLegendActions(legendActionsProviderFor(cell.chart, () => this.context()));
      cell.chart.renderer.setLegendCallouts(legendCalloutsProviderFor(cell.chart, () => this.context()));
    }
  }
  // ── state surface (the SDK's read/restore of the whole grid's config + content) ──
  /**
   * Snapshot the COMPLETE workspace state as a versioned, serializable document:
   * layout + splitter sizes, active cell, sync links, timezone, and — per slot, live
   * AND dormant — the market, the renderer's cosmetic config, the user-drawings
   * document, and the indicator ledger. This is what `persist` writes; hosts build
   * custom flows on it (server snapshots, share links, templates).
   */
  getState() {
    const byId = /* @__PURE__ */ new Map();
    for (const [id, cs] of this.pool) byId.set(id, cs);
    for (const [id, cell] of this.cellsById) byId.set(id, cell.dehydrate());
    const charts = [];
    for (const id of this.order) {
      const cs = byId.get(id);
      if (cs) {
        charts.push({ id, ...cs });
        byId.delete(id);
      }
    }
    for (const [id, cs] of byId) charts.push({ id, ...cs });
    const state = { version: 1, layout: this.def.id, timezone: this.timezone, sync: { ...this.syncOpts }, charts };
    if (this.activeId) state.activeCellId = this.activeId;
    if (this.favs.length > 0) state.favorites = [...this.favs];
    if (this.tfFavs.length > 0) state.timeframeFavorites = [...this.tfFavs];
    if (this.trackSizes.size > 0) state.trackSizes = Object.fromEntries([...this.trackSizes].map(([k, v]) => [k, { ...v }]));
    const panels = this.dock.getState();
    if (panels) state.panels = panels;
    const ext = { ...this.extState };
    for (const h of statePersistenceHandlers("global")) {
      try {
        const value = h.serialize(this.context());
        if (value === void 0) delete ext[h.key];
        else ext[h.key] = value;
      } catch (err) {
        console.warn(`[vela] state persistence "${h.key}" serialize failed:`, err);
      }
    }
    this.extState = ext;
    if (Object.keys(ext).length > 0) state.ext = ext;
    return state;
  }
  /**
   * Restore a state document produced by {@link getState} (untrusted-safe: malformed
   * fields are dropped). When the document matches the live grid one-to-one — same
   * layout, same ordered slot identities — it is applied IN PLACE: every chart
   * instance survives (markets switch via `setMarket`), so chart references,
   * indicator handles, and event subscriptions stay valid. Any structural difference
   * (layout, slot count, renamed ids) falls back to the full rebuild: prefs, sync
   * links, layout, and every slot are replaced, current cells rebuilt from the
   * document. A layout id that is not registered keeps the current grid (register
   * custom layouts first).
   */
  applyState(state) {
    if (this.destroyed) return;
    const st = sanitizeState(state);
    if (!st) return;
    if (st.favorites) this.favs = [...st.favorites];
    if (st.timeframeFavorites) {
      this.tfFavs = [...st.timeframeFavorites];
      this.topbar.setTimeframeFavorites(this.tfFavs);
    }
    this.dock.applyState(st.panels);
    for (const kind of SYNC_KINDS) this.applySyncSetting(kind, st.sync?.[kind]);
    this.trackSizes.clear();
    if (st.trackSizes) for (const [id, ts] of Object.entries(st.trackSizes)) this.trackSizes.set(id, ts);
    const targetDef = this.monoLayout ? this.def : ensureLayout(st.layout) ?? this.def;
    const liveCount = this.def.cells.length;
    const inPlace = targetDef.id === this.def.id && st.charts.length >= liveCount && this.order.length >= liveCount && this.def.cells.every((_, i) => st.charts[i].id === this.order[i] && this.cellsById.has(this.order[i]));
    if (inPlace) {
      if (st.favorites) {
        for (const cell of this.cellsById.values()) cell.chart.drawings.setFavorites(this.favs);
      }
      this.drawingLinks.clear();
      this.styleSyncBusy = true;
      try {
        for (const [i] of this.def.cells.entries()) {
          const { id, ...cs } = st.charts[i];
          this.cellsById.get(id)?.rehydrate(cs);
        }
      } finally {
        this.styleSyncBusy = false;
      }
      if (st.timezone) this.setTimezone(st.timezone);
      this.pool.clear();
      for (const { id, ...cs } of st.charts.slice(liveCount)) this.pool.set(id, cs);
      this.order = st.charts.map((c) => c.id);
      this.clearMaximized();
      this.applyGrid();
      this.refreshCellControls();
      const nextActive2 = st.activeCellId && this.cellsById.has(st.activeCellId) ? st.activeCellId : this.order[0] ?? null;
      if (nextActive2 === this.activeId) this.projectActiveCell();
      else this.setActiveCell(nextActive2);
      this.refreshRetention();
      this.extState = { ...st.ext ?? {} };
      this.restoreGlobalExt();
      this.markStateDirty();
      return;
    }
    if (st.timezone) {
      this.timezone = st.timezone;
      this.bottombar?.setTimezone(st.timezone);
    }
    for (const [id, cell] of [...this.cellsById]) {
      cell.destroy();
      this.cellsById.delete(id);
      this.events.emit("cell:destroyed", { id });
    }
    this.pool.clear();
    this.drawingLinks.clear();
    for (const { id, ...cs } of st.charts) this.pool.set(id, cs);
    this.order = st.charts.map((c) => c.id);
    const def = this.monoLayout ? null : ensureLayout(st.layout);
    if (def) this.def = def;
    this.cellBackend = this.backendFor(this.def);
    this.clearMaximized();
    this.applyGrid();
    this.buildCells();
    this.syncCellPresentation();
    this.topbar.setLayout(this.def.id);
    const nextActive = st.activeCellId && this.cellsById.has(st.activeCellId) ? st.activeCellId : this.order[0] ?? null;
    if (nextActive === this.activeId) this.projectActiveCell();
    else this.setActiveCell(nextActive);
    this.refreshRetention();
    this.events.emit("layout:changed", { layout: this.def.id });
    this.extState = { ...st.ext ?? {} };
    this.restoreGlobalExt();
    this.markStateDirty();
  }
  /** Run the registered global-scope `restore` handlers against the document-level
   *  `ext` bag — keys present in the document only; a failing handler is contained.
   *  Handlers whose restore touches chart content should be `scope: 'cell'` instead
   *  (those run inside the cell's history-mute). */
  restoreGlobalExt() {
    for (const h of statePersistenceHandlers("global")) {
      if (!(h.key in this.extState)) continue;
      try {
        h.restore(this.extState[h.key], this.context());
      } catch (err) {
        console.warn(`[vela] state persistence "${h.key}" restore failed:`, err);
      }
    }
  }
  /**
   * Set the workspace-global display timezone — applied to EVERY cell. An IANA zone,
   * or `'exchange'` (the exchange rule): each cell then renders in its OWN market's
   * zone (Chicago for a CME future, New York for a US equity, UTC for crypto), and the
   * bottom bar follows the active cell's.
   */
  setTimezone(zone) {
    this.timezone = zone;
    this.projectTimezone();
    for (const cell of this.cellsById.values()) cell.applyTimezone();
    this.markStateDirty();
  }
  /** Bottom bar ⇐ the stored choice + the ACTIVE cell's market zone (labels the exchange row). */
  projectTimezone() {
    const active = this.activeId ? this.cellsById.get(this.activeId) : void 0;
    this.bottombar?.setTimezone(this.timezone, active?.exchangeTimezone);
  }
  /**
   * Swap the workspace theme at runtime — `'dark'`, `'light'`, or a full custom theme,
   * applied to the shared chrome (topbar, panels, drawing toolbar) and EVERY cell.
   * Also reached from any cell's chart settings → Canvas → Theme. The choice sticks:
   * cells rebuilt by later layout switches reconstruct with it.
   */
  setTheme(theme) {
    if (this.destroyed) return;
    const t = resolveTheme(theme);
    this.opts.theme = theme;
    ensureUIHost(this.root, t);
    this.drawToolbar?.setTheme(t);
    if (this.attributionMark) applyAttributionMarkTheme(this.attributionMark, t.background);
    for (const cell of this.cellsById.values()) cell.chart.setTheme(t);
  }
  // ── layout ──────────────────────────────────────────────────
  get layout() {
    return this.def;
  }
  /**
   * Switch the grid. Cells are diffed BY IDENTITY (`order` head of the next size):
   * surviving cells keep their live charts untouched; cells past the new size
   * dehydrate into the pool; (re)appearing positions hydrate their identity from
   * the pool (or its seed). Crossing the WebGL budget rebuilds every cell through
   * the pool so the backend stays uniform.
   */
  setLayout(layout) {
    if (this.destroyed) return;
    if (this.monoLayout) return;
    this.clearMaximized();
    const next = this.resolveLayout(layout);
    const nextBackend = this.backendFor(next);
    const rebuildAll = nextBackend !== this.cellBackend;
    this.order = orderAfterLayout(this.order, next.cells.length, this.activeId);
    const keep = new Set(this.order.slice(0, next.cells.length));
    const preexisting = new Set(this.cellsById.keys());
    for (const [id, cell] of [...this.cellsById]) {
      if (!keep.has(id) || rebuildAll) {
        this.poolSet(id, cell.dehydrate());
        cell.destroy();
        this.cellsById.delete(id);
        this.events.emit("cell:destroyed", { id });
      }
    }
    this.def = next;
    this.cellBackend = nextBackend;
    this.applyGrid();
    this.buildCells();
    this.alignNewCellStyles(preexisting);
    this.alignNewCellDrawings(preexisting);
    this.syncCellPresentation();
    this.refreshCellControls();
    this.topbar.setLayout(next.id);
    const nextActive = activeAfterLayout(this.activeId, this.order.slice(0, next.cells.length));
    if (nextActive === this.activeId) this.projectActiveCell();
    else this.setActiveCell(nextActive);
    this.refreshRetention();
    this.events.emit("layout:changed", { layout: next.id });
    this.markStateDirty();
  }
  /** The identity of the cell maximized over the whole grid, or null. */
  get maximizedCell() {
    return this.maximizedId;
  }
  /**
   * Maximize one cell over the whole grid, or restore the layout with `null`. Pure
   * presentation: the other cells stay alive underneath — charts, subscriptions and
   * state untouched — so restoring is instant. The maximized cell becomes the active
   * one. Transient view state (also reachable from each cell's bottom-center view
   * cluster): switching layouts or applying a state document restores the grid.
   */
  maximizeCell(id) {
    if (this.destroyed) return;
    if (id != null && (!this.cellsById.has(id) || this.def.cells.length <= 1)) return;
    if (id === this.maximizedId) return;
    this.maximizedId = id;
    if (id) this.setActiveCell(id);
    this.applyGrid();
    this.refreshCellControls();
    this.syncMobileMaximize();
    this.events.emit("cell:maximized", { id });
  }
  /** The mobile bar's maximize stop: one press isolates the ACTIVE chart over the
   *  grid; while something is already isolated — the chart, or a pane inside it
   *  (mobile's double-tap) — the press restores that instead. Every branch re-syncs
   *  the stop on its own (`maximizeCell` directly, `panes.maximize` via its
   *  synchronous `pane:changed`). */
  toggleMobileMaximize() {
    const cell = this.activeId ? this.cellsById.get(this.activeId) : void 0;
    if (!cell) return;
    if (this.maximizedId) this.maximizeCell(null);
    else if (cell.chart.panes.list().some((p) => p.maximized)) cell.chart.panes.maximize(null);
    else this.maximizeCell(cell.id);
  }
  /** Keep the mobile bar's maximize stop truthful: lit (inverse chip, restore
   *  glyph) while the active chart covers the grid OR one of its panes is
   *  maximized — the state a double-tap toggles is otherwise invisible on mobile. */
  syncMobileMaximize() {
    if (!this.mobileBar) return;
    const cell = this.activeId ? this.cellsById.get(this.activeId) : void 0;
    const paneMax = cell ? cell.chart.panes.list().some((p) => p.maximized) : false;
    this.mobileBar.setMaximizeActive(this.maximizedId != null || paneMax);
    this.mobileBar.setMaximizeVisible(this.def.cells.length > 1);
  }
  /**
   * Trade the SLOTS of two live cells — the grid arrangement changes, the cells
   * themselves (charts, indicators, drawings, the active flag) stay untouched.
   * What each cell's drag handle commits; also callable directly by hosts.
   */
  swapCells(a, b) {
    if (this.destroyed || a === b) return;
    const i = this.order.indexOf(a);
    const j = this.order.indexOf(b);
    if (i < 0 || j < 0 || !this.cellsById.has(a) || !this.cellsById.has(b)) return;
    [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    for (const [k] of this.def.cells.entries()) {
      const host = this.cellsById.get(this.order[k] ?? "")?.host;
      if (host) this.gridEl.appendChild(host);
    }
    this.applyGrid();
    this.markStateDirty();
  }
  resize() {
    this.splitters.layout();
  }
  /** Show a toast over the grid — the same surface the shell's own notices use
   *  (alerts, script errors) and the one contributions reach via `ctx.toast`. */
  toast(message, kind = "info", durationMs = 3e3) {
    if (this.destroyed) return;
    this.toastHost.show(message, kind, durationMs);
  }
  destroy() {
    if (this.destroyed) return;
    this.flushPendingState();
    this.destroyed = true;
    this.replay.destroy();
    if (this.persistKey !== null && typeof window !== "undefined") window.removeEventListener("beforeunload", this.onUnload);
    this.resizeObserver?.disconnect();
    this.splitters.destroy();
    for (const [id, cell] of [...this.cellsById]) {
      try {
        this.poolSet(id, cell.dehydrate());
      } catch (err) {
        console.warn(`[vela] could not snapshot cell "${id}" while destroying:`, err);
      }
      cell.destroy();
      this.cellsById.delete(id);
    }
    for (const dispose of this.attachmentDisposers.values()) {
      try {
        dispose();
      } catch {
      }
    }
    this.attachmentDisposers.clear();
    this.root.removeEventListener("keydown", this.onRootKeydown);
    this.keymap.destroy();
    this.drawToolbar?.destroy();
    this.topbar.destroy();
    this.bottombar?.destroy();
    this.mobileBar?.destroy();
    this.drawingPill?.destroy();
    this.tfDrawer?.destroy();
    this.drawingsDrawer?.destroy();
    this.moreDrawer?.destroy();
    this.timezoneDrawer?.destroy();
    this.priceScaleDrawer?.destroy();
    this.layoutCtl.destroy();
    this.dock.destroy();
    this.objectTree.destroy();
    this.dataWindow.destroy();
    this.symbolPicker.destroy();
    this.indicatorPicker?.destroy();
    this.tfQuick.destroy();
    this.shortcutsHelp?.destroy();
    this.toastHost.destroy();
    this.alertsMenu?.destroy();
    this.glider.stop();
    sharedBarStore.retain(/* @__PURE__ */ new Set(), this);
    this.root.remove();
    this.events.clear();
  }
  // ── the projection rule (trigger ① — full rebind on activation) ──
  /** Re-project the shared chrome from the ACTIVE cell. The chrome holds no state of
   *  its own — this is a pure read of the cell, safe to call redundantly. */
  projectActiveCell() {
    const cell = this.activeId ? this.cellsById.get(this.activeId) : void 0;
    if (!cell) return;
    this.topbar.setSymbol(cell.symbol);
    this.topbar.setTimeframe(cell.timeframe);
    this.topbar.setPriceStyle(cell.priceStyle);
    this.topbar.setIndicatorCount(cell.indicatorCount);
    this.topbar.renderActions();
    this.mobileBar?.renderActions();
    this.mobileBar?.setSymbol(cell.symbol);
    this.mobileBar?.setTimeframe(cell.timeframe);
    this.syncMobileMaximize();
    this.drawingPill?.onChart(cell.chart);
    const pushHistory = () => this.topbar.setHistoryState(cell.history.canUndo, cell.history.canRedo);
    this.historyUnsub?.();
    this.historyUnsub = cell.history.onChange(pushHistory);
    pushHistory();
    this.objectTree.setSymbol(cell.symbol);
    this.dock.onChart(cell.chart);
    this.bottombar?.setActiveRange(cell.activeRangeId);
    this.bottombar?.setSession({ session: cell.session, enabled: cell.sessionAvailable });
    this.projectTimezone();
    this.indicatorPicker?.sync();
    this.glider.stop();
    const d = cell.chart.drawings;
    if (d.getTool() !== this.globalTool) d.setTool(this.globalTool);
    if (d.getSnapMode() !== this.globalSnap) d.setSnapMode(this.globalSnap);
    if (d.getStayMode() !== this.globalStay) d.setStayMode(this.globalStay);
    if (this.drawToolbar) {
      this.drawToolbar.setActiveTool(this.globalTool);
      this.drawToolbar.setMagnetMode(this.globalSnap);
      this.drawToolbar.setStayMode(this.globalStay);
      const mode = d.getMode();
      this.drawToolbar.setMeasureActive(mode === "measure");
      this.drawToolbar.setEraserActive(mode === "eraser");
      this.drawToolbar.setFavorites(d.favorites());
    }
  }
  /** Put keyboard focus back on the active cell's chart surface (after a toolbar press
   *  stole it) so chart/drawing shortcuts keep working. */
  refocusActive() {
    if (this.activeId) this.cellsById.get(this.activeId)?.chart.renderer.focus();
  }
  /** Debounced dirty mark: one `state:changed` (+ one storage write in persist mode)
   *  per burst of edits, flushed hard on unload/destroy. */
  markStateDirty() {
    if (this.destroyed || !this.booted) return;
    if (this.stateTimer != null) clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.events.emit("state:changed", void 0);
      this.persistNow();
    }, 500);
  }
  /**
   * Push a pending debounced change out NOW, for a teardown or a page unload — the
   * two moments the 500ms timer would otherwise never reach.
   *
   * Dropping it was a silent data loss: the timer carries BOTH halves of the dirty
   * signal — the `state:changed` event and the storage write — so a host that saves
   * from that event (a server-backed host, where `persistNow` is a no-op for want of
   * a `persistKey`) simply never heard about the user's last edit.
   *
   * Idempotent and re-entrancy safe, which the ordering here buys:
   *  - a no-op unless a timer is actually pending, so a teardown with nothing
   *    outstanding stays silent and never invents an edit;
   *  - the timer is cleared FIRST, so nothing survives this call and a second call
   *    does nothing — `destroy()` after an unload flush adds no second write;
   *  - the state is snapshotted BEFORE the handlers run, and that snapshot is what
   *    gets persisted, so storage and the host are told the same thing even if a
   *    handler mutates state while it runs;
   *  - `emitting` is held across the emit, so a handler calling back in (a host that
   *    tears down on save is the obvious one) cannot re-enter this and recurse.
   */
  flushPendingState() {
    if (this.stateTimer == null || this.emitting) return;
    clearTimeout(this.stateTimer);
    this.stateTimer = null;
    const snapshot = this.persistKey !== null ? encodeState(this.getState()) : null;
    this.emitting = true;
    try {
      this.events.emit("state:changed", void 0);
    } finally {
      this.emitting = false;
    }
    if (snapshot !== null && this.persistKey !== null) {
      try {
        void this.storage.set(this.persistKey, snapshot);
      } catch {
      }
    }
  }
  /** Write the current state through the storage adapter now (fire-and-forget). */
  persistNow() {
    if (this.persistKey === null || this.destroyed) return;
    try {
      void this.storage.set(this.persistKey, encodeState(this.getState()));
    } catch {
    }
  }
  // ── internals ───────────────────────────────────────────────
  resolveLayout(layout) {
    if (typeof layout !== "string") return layout;
    const def = ensureLayout(layout);
    if (!def) throw new Error(`[vela] unknown workspace layout "${layout}" \u2014 register it with registerLayout().`);
    return def;
  }
  backendFor(def) {
    const explicit = this.opts.nativeBackend;
    if (explicit && explicit !== "auto") return explicit;
    return def.cells.length > (this.opts.maxWebglCells ?? 8) ? "canvas2d" : "auto";
  }
  currentTracks() {
    const sizes = this.trackSizes.get(this.def.id);
    return {
      cols: sizes?.cols?.length === this.def.cols.length ? [...sizes.cols] : [...this.def.cols],
      rows: sizes?.rows?.length === this.def.rows.length ? [...sizes.rows] : [...this.def.rows]
    };
  }
  applyTracks(axis, weights) {
    const sizes = this.trackSizes.get(this.def.id) ?? {};
    sizes[axis] = weights;
    this.trackSizes.set(this.def.id, sizes);
    this.applyGrid();
    this.markStateDirty();
  }
  /** Apply the grid template (+ per-cell areas) and reposition the splitter strips.
   *  Geometry is keyed by SLOT (`perCell[slot.id]`); the cell living there is
   *  `order[i]` — the identity/position decoupling in one line. */
  applyGrid() {
    const { container, perCell } = gridStyles(this.def, this.trackSizes.get(this.def.id));
    if (this.def.cells.length > 1) this.gridEl.dataset.multi = "1";
    else delete this.gridEl.dataset.multi;
    this.gridEl.style.gridTemplateColumns = container.gridTemplateColumns ?? "";
    this.gridEl.style.gridTemplateRows = container.gridTemplateRows ?? "";
    this.gridEl.style.gridTemplateAreas = container.gridTemplateAreas ?? "";
    for (const [i, slot] of this.def.cells.entries()) {
      const host = this.cellsById.get(this.order[i] ?? "")?.host;
      if (host) host.style.gridArea = perCell[slot.id]?.gridArea ?? "";
    }
    this.applyMaximizePresentation();
    this.mountAttributionMark();
    this.splitters.layout();
  }
  /** Overlay the maximize presentation on the freshly applied grid: EVERY cell spans
   *  the full track grid — the maximized one on top, the siblings invisible beneath
   *  it (their charts stay alive — restoring is instant). The siblings must span too:
   *  left in their slots they would auto-flow into implicit zero-height rows, whose
   *  gaps steal height from the maximized cell and collapse their renderers to 0.
   *  The splitter strips and the active ring hide via the `data-maximized` rules. */
  applyMaximizePresentation() {
    const maxId = this.maximizedId;
    if (maxId) this.gridEl.dataset.maximized = "1";
    else delete this.gridEl.dataset.maximized;
    for (const [id, cell] of this.cellsById) {
      const style = cell.host.style;
      if (maxId) style.gridArea = "1 / 1 / -1 / -1";
      style.zIndex = maxId && id === maxId ? "5" : "";
      style.visibility = maxId && id !== maxId ? "hidden" : "";
    }
  }
  /** Rebuild every cell's view cluster (the maximize gate or state changed). */
  refreshCellControls() {
    for (const cell of this.cellsById.values()) cell.refreshControls();
  }
  /** Drop the transient maximize on a structural change (layout switch, state
   *  document) — WITH the event, so hosts tracking `cell:maximized` never drift
   *  from `maximizedCell`. The caller's own grid re-apply paints the restore. */
  clearMaximized() {
    if (this.maximizedId == null) return;
    this.maximizedId = null;
    this.events.emit("cell:maximized", { id: null });
  }
  /** The live cell under a viewport point, excluding `excludeId` and any host a
   *  maximize has hidden — the drag handle's hit-test. */
  cellAtPoint(x, y, excludeId) {
    for (const [id, cell] of this.cellsById) {
      if (id === excludeId || cell.host.style.visibility === "hidden") continue;
      const r = cell.host.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  }
  /** Mark one cell as the live drop target of a grip drag (null clears all) —
   *  the `data-drop-target` stylesheet rule paints the dashed preview ring. */
  setDropTarget(id) {
    for (const [cid, cell] of this.cellsById) {
      if (cid === id) cell.host.dataset.dropTarget = "1";
      else delete cell.host.dataset.dropTarget;
    }
  }
  /** The cell whose bottom-left corner the grid's attribution mark floats in — the
   *  maximized cell while one covers the grid, else the bottom-left slot's cell. */
  bottomLeftCell() {
    if (this.maximizedId) return this.cellsById.get(this.maximizedId);
    const grid = occupancyGrid(this.def);
    const slot = grid[grid.length - 1]?.[0];
    const idx = this.def.cells.findIndex((c) => (c.area ?? c.id) === slot);
    return this.cellsById.get(this.order[idx >= 0 ? idx : 0] ?? "");
  }
  /** Keep the shared attribution mark inside the BOTTOM-LEFT visible cell: its
   *  offsets ride that cell's renderer-published `--vela-bottom-gutter` /
   *  `--vela-toolbar-gutter`, so collapsed pane strips push the mark up without any
   *  bookkeeping here. Re-run after anything that changes which host that is
   *  (layout switch, maximize, cell rebuild); a destroyed host drops the mark from
   *  the DOM, and this re-mount brings it back. */
  mountAttributionMark() {
    const mark = this.attributionMark;
    if (!mark) return;
    const host = this.bottomLeftCell()?.host ?? this.gridEl;
    if (mark.parentElement !== host) host.appendChild(mark);
  }
  /** Create the cells the current layout wants but don't exist yet (pool-first).
   *  A slot's CELL IDENTITY is `order[i]` (declaration order — never the slot's own
   *  positional id); slots past the declared list mint an auto identity once. */
  buildCells() {
    const theme = resolveTheme(this.opts.theme);
    const { perCell } = gridStyles(this.def, this.trackSizes.get(this.def.id));
    for (const [i, slot] of this.def.cells.entries()) {
      let id = this.order[i];
      if (!id) {
        id = nextAutoCellId(/* @__PURE__ */ new Set([...this.order, ...this.pool.keys(), ...this.cellsById.keys()]));
        this.order[i] = id;
      }
      if (this.cellsById.has(id)) continue;
      const pooled = this.pool.get(id);
      const seed = pooled ?? { ...seedDefaults(this.opts), ...this.opts.cells?.[id] ?? {} };
      this.pool.delete(id);
      const cell = new ChartCell(id, this.gridEl, seed, {
        feed: this.feed,
        engines: this.opts.engines ?? {},
        chartDefaults: cellChartDefaults(this.opts),
        theme,
        live: this.opts.live ?? false,
        volume: this.opts.volume ?? true,
        statusline: this.opts.statusline !== false,
        watermark: this.opts.watermark !== false,
        nativeBackend: this.cellBackend,
        dialogHost: this.root,
        timezone: () => this.timezone,
        setTimezone: (zone) => this.setTimezone(zone),
        context: () => this.context(),
        activate: (id2) => this.setActiveCell(id2),
        multiCell: () => !this.monoLayout && this.def.cells.length > 1,
        isMaximized: (id2) => this.maximizedId === id2,
        toggleMaximize: (id2) => this.maximizeCell(this.maximizedId === id2 ? null : id2),
        cellDragTarget: (id2, x, y) => this.cellAtPoint(x, y, id2),
        previewDropTarget: (target) => this.setDropTarget(target),
        dropCell: (id2, target) => this.swapCells(id2, target),
        onMarketChanged: (id2) => this.onCellMarketChanged(id2),
        onPriceStyleChanged: (id2) => this.onCellPriceStyleChanged(id2),
        onIndicatorsChanged: (id2) => this.onCellIndicatorsChanged(id2),
        onStatusPrefsChanged: (id2) => this.propagateStylePrefs(id2),
        onStateDirty: () => this.markStateDirty(),
        manifestSettled: () => this.manifestSettled,
        toast: (message, kind, durationMs) => this.toastHost.show(message, kind, durationMs)
      });
      cell.host.style.gridArea = perCell[slot.id]?.gridArea ?? "";
      this.cellsById.set(id, cell);
      if (id === this.activeId) cell.host.dataset.active = "1";
      this.wireCell(cell);
      cell.chart.renderer.setLayoutMode(this.layoutCtl.current);
      cell.chart.renderer.setWallClock(this.clock);
      cell.setControlsSuspended(this.layoutCtl.current === "mobile");
      if (this.favs.length > 0) cell.chart.drawings.setFavorites(this.favs);
      cell.setManifest(this.manifest, pooled?.indicators == null);
      cell.restorePersistedExt();
      this.events.emit("cell:created", { id });
    }
    for (const [i] of this.def.cells.entries()) {
      const host = this.cellsById.get(this.order[i] ?? "")?.host;
      if (host) this.gridEl.appendChild(host);
    }
    this.mountAttributionMark();
  }
  /** Per-cell chart subscriptions (trigger ② — the chart instance is stable for the
   *  cell's whole life, so these live and die with the cell). */
  wireCell(cell) {
    const chart = cell.chart;
    chart.on("indicator:error", ({ error }) => this.toastHost.show(`[${cell.id}] ${error.message}`, "error", 5e3));
    chart.on("script:run", (run) => this.events.emit("script:run", { ...run, cell: cell.id }));
    chart.on("priceStyle:change", ({ from, to }) => this.events.emit("cell:priceStyle", { id: cell.id, from, to }));
    chart.on("alert", (alert) => {
      const source = [parseSymbol(cell.symbol).ticker || cell.symbol, timeframeLabel(cell.timeframe), alert.indicator].filter(Boolean).join(" ");
      this.alerts.unshift({ cellId: cell.id, source, title: alert.title ?? "Alert", message: alert.message, time: alert.time });
      if (this.alerts.length > this.alertCap) this.alerts.pop();
      this.toastHost.show(`${source} \u2014 ${alert.title ? alert.title + " \u2014 " : ""}${alert.message}`, "info", 4e3);
      this.topbar.setAlertCount(this.alerts.length);
    });
    chart.on("drawing:favorites", ({ favorites }) => {
      this.favs = favorites;
      for (const other of this.cellsById.values()) {
        if (other !== cell) other.chart.drawings.setFavorites(favorites);
      }
      this.drawToolbar?.setFavorites(favorites);
      this.markStateDirty();
    });
    chart.renderer.onCrosshairMove((e) => this.propagateCrosshair(cell.id, e.time, e.paneKind === "price" ? e.price : null));
    chart.on("drawing:created", ({ id }) => {
      this.propagateDrawing(cell.id, id);
      this.markStateDirty();
    });
    chart.on("drawing:draft", ({ doc }) => this.propagateDraft(cell.id, doc));
    chart.on("drawing:edited", ({ id }) => {
      this.propagateDrawingEdit(cell.id, id);
      this.markStateDirty();
    });
    chart.on("drawing:removed", ({ id }) => {
      this.propagateDrawingRemoval(cell.id, id);
      this.markStateDirty();
    });
    chart.on("drawing:tool", ({ type }) => {
      if (cell.id !== this.activeId) return;
      this.globalTool = type;
      this.drawToolbar?.setActiveTool(type);
    });
    chart.on("drawing:snap", ({ mode }) => {
      if (cell.id !== this.activeId) return;
      this.globalSnap = mode;
      this.drawToolbar?.setMagnetMode(mode);
    });
    chart.on("drawing:stay", ({ on }) => {
      if (cell.id !== this.activeId) return;
      this.globalStay = on;
      this.drawToolbar?.setStayMode(on);
    });
    chart.on("drawing:mode", ({ mode }) => {
      if (cell.id !== this.activeId) return;
      this.drawToolbar?.setMeasureActive(mode === "measure");
      this.drawToolbar?.setEraserActive(mode === "eraser");
    });
    chart.on("viewport:changed", (range) => this.propagateViewport(cell.id, range));
    chart.renderer.onConfigChanged(() => this.propagateStylePrefs(cell.id));
    chart.on("theme:changed", (t) => this.setTheme(t));
    chart.on("pane:changed", () => {
      if (cell.id === this.activeId) this.syncMobileMaximize();
    });
    chart.renderer.onAxisLongPress((e) => {
      if (this.layoutCtl.current !== "mobile") return;
      if (e.axis === "time") this.openTimezoneDrawer();
      else this.openPriceScaleDrawer(e.y);
    });
  }
  // ── sync links ──────────────────────────────────────────────
  applySyncSetting(kind, setting, align = false) {
    if (setting == null || setting === false) delete this.syncOpts[kind];
    else this.syncOpts[kind] = setting;
    if (kind === "drawings") {
      for (const cell of this.cellsById.values()) cell.chart.drawings.setExternalGhost(null);
      this.drawToolbar?.setDrawingsSyncMode(!!setting);
      this.markStateDirty();
      return;
    }
    if (kind === "crosshair") {
      for (const cell of this.cellsById.values()) cell.chart.renderer.setExternalCrosshair(null);
      if (setting && ![...this.cellsById.values()].some((c) => c.chart.renderer.supportsExternalCrosshair)) {
        console.warn("[vela] crosshair sync: no cell renderer supports an external crosshair \u2014 nothing will show.");
      }
      if (this.topbar && this.def) this.topbar.setLayout(this.def.id);
      this.markStateDirty();
      return;
    }
    if (this.topbar && this.def) this.topbar.setLayout(this.def.id);
    this.markStateDirty();
    if (align && setting && this.activeId) {
      if (kind === "viewport") {
        const range = this.cellsById.get(this.activeId)?.chart.getVisibleRange();
        if (range) this.propagateViewport(this.activeId, range);
      } else if (kind === "style") {
        this.propagateStylePrefs(this.activeId);
      } else {
        this.propagateMarket(this.activeId);
      }
    }
  }
  /**
   * Align cells minted by a layout change to their style group: with the link on, a
   * NEW cell (fresh slot or one returning from the pool, which missed edits while
   * dormant) inherits the presentation of a pre-existing group peer — the active
   * cell when it is one — instead of sitting on its own state beside a styled
   * group. Propagation runs FROM the peer, so a newborn's defaults never overwrite
   * the group, and the equality short-circuits keep converged peers untouched.
   */
  alignNewCellStyles(preexisting) {
    const setting = this.syncOpts.style;
    if (!setting) return;
    const ids = [...this.cellsById.keys()];
    const propagated = /* @__PURE__ */ new Set();
    for (const id of ids) {
      if (preexisting.has(id)) continue;
      const peers = syncTargets(id, setting, ids).filter((p) => preexisting.has(p));
      if (peers.length === 0) continue;
      const source = this.activeId && peers.includes(this.activeId) ? this.activeId : peers[0];
      if (propagated.has(source)) continue;
      propagated.add(source);
      this.propagateStylePrefs(source);
    }
  }
  /**
   * Bring cells minted by a layout change into their drawings group: with the link
   * on, a NEW cell (fresh slot, or one returning from the pool that missed edits
   * while dormant) receives the drawings of a pre-existing group peer — the active
   * cell when it is one. A drawing the arriving cell already holds a linked copy of
   * is refreshed in place; any other is copied and linked like a freshly synced
   * drawing, so later edits and removals follow both ways. The arrival is the cell's
   * starting state, not an edit: it stays out of the cell's undo timeline, and the
   * busy guard keeps the copies' own events from fanning back out.
   */
  alignNewCellDrawings(preexisting) {
    const setting = this.syncOpts.drawings;
    if (!setting) return;
    const ids = [...this.cellsById.keys()];
    for (const id of ids) {
      if (preexisting.has(id)) continue;
      const cell = this.cellsById.get(id);
      if (!cell?.chart.drawings.supported) continue;
      const peers = syncTargets(id, setting, ids).filter((p) => preexisting.has(p));
      if (peers.length === 0) continue;
      const sourceId = this.activeId && peers.includes(this.activeId) ? this.activeId : peers[0];
      const source = this.cellsById.get(sourceId);
      if (!source) continue;
      const drawings = cell.chart.drawings;
      this.drawingSyncBusy = true;
      try {
        cell.history.silently(() => {
          const held = new Set(drawings.all().map((d) => d.id));
          for (const doc of source.chart.drawings.all()) {
            const group = this.drawingLinks.get(`${sourceId}\0${doc.id}`) ?? /* @__PURE__ */ new Map([[sourceId, doc.id]]);
            const peerId = group.get(id);
            if (peerId != null && held.has(peerId)) {
              drawings.update(peerId, { anchors: doc.anchors, style: doc.style, text: doc.text, props: doc.props });
              continue;
            }
            const copy = drawings.add(doc.type, {
              paneId: doc.paneId,
              anchors: doc.anchors,
              style: doc.style,
              text: doc.text,
              props: doc.props,
              zIndex: doc.zIndex
            });
            if (!copy) continue;
            if (peerId != null) this.drawingLinks.delete(`${id}\0${peerId}`);
            group.set(id, copy.id);
            for (const [cellId, dId] of group) this.drawingLinks.set(`${cellId}\0${dId}`, group);
          }
        });
      } finally {
        this.drawingSyncBusy = false;
      }
    }
  }
  /**
   * Mirror an origin cell's presentation — the style-link slice of its renderer
   * config ({@link styleConfigPatch}) plus its Status line and watermark prefs —
   * onto its same-group followers (the style link). Loop-safe two ways: the busy
   * guard eats the followers' SYNCHRONOUS echoes (their `applyConfig` re-fires
   * `onConfigChanged` in the same tick), and the equality short-circuits leave
   * already-converged followers untouched, so nothing re-emits once the group agrees.
   */
  propagateStylePrefs(originId) {
    if (this.styleSyncBusy || this.destroyed) return;
    const targets = syncTargets(originId, this.syncOpts.style, [...this.cellsById.keys()]);
    if (targets.length === 0) return;
    const origin = this.cellsById.get(originId);
    if (!origin) return;
    const config = origin.chart.renderer.getConfig();
    const prefs = origin.statusPrefs();
    this.styleSyncBusy = true;
    try {
      for (const id of targets) {
        const cell = this.cellsById.get(id);
        if (!cell) continue;
        const patch = styleConfigPatch(config, cell.chart.renderer.getConfig());
        if (patch) cell.chart.renderer.applyConfig(patch);
        cell.applyStatusPrefs(prefs);
      }
    } finally {
      this.styleSyncBusy = false;
    }
  }
  /**
   * Mirror an origin cell's pointer time onto its same-group followers as GHOST
   * crosshairs (`renderer.setExternalCrosshair`). The horizontal price level rides
   * along ONLY to followers showing the same ticker — price scales are comparable
   * there, while an origin's price painted on another market's pane would be noise.
   * Leaving the origin propagates `null` (the event already carries it) and clears
   * every ghost. No busy guard needed: an external crosshair never re-emits
   * `onCrosshairMove` — the flow is one-way by port contract, so no echo loop can
   * exist.
   */
  propagateCrosshair(originId, time, price = null) {
    if (this.destroyed) return;
    const setting = this.syncOpts.crosshair;
    if (!setting) return;
    const originTicker = parseSymbol(this.cellsById.get(originId)?.symbol ?? "").ticker;
    for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
      const follower = this.cellsById.get(id);
      if (!follower) continue;
      const comparable = originTicker !== "" && parseSymbol(follower.symbol).ticker === originTicker;
      follower.chart.renderer.setExternalCrosshair(time, comparable ? price : null);
    }
  }
  /**
   * Push an origin cell's visible range onto its same-group followers. Loop-safe two
   * ways: the busy guard eats the followers' SYNCHRONOUS echoes (their setVisibleRange
   * re-emits `viewport:changed` in the same tick), and the half-bar epsilon
   * short-circuits any async residue — a follower already within half of ITS OWN bar
   * interval is left alone, so cross-timeframe groups settle instead of oscillating.
   */
  propagateViewport(originId, range) {
    if (this.syncBusy || this.destroyed) return;
    const targets = syncTargets(originId, this.syncOpts.viewport, [...this.cellsById.keys()]);
    if (targets.length === 0) return;
    this.syncBusy = true;
    try {
      for (const id of targets) {
        const cell = this.cellsById.get(id);
        if (!cell) continue;
        const current = cell.chart.getVisibleRange();
        const tfMs = timeframeToMs(cell.timeframe);
        const eps = Number.isFinite(tfMs) ? tfMs / 2 : 0;
        if (current && rangesWithin(current, range, eps)) continue;
        cell.chart.setVisibleRange(range);
      }
    } finally {
      this.syncBusy = false;
    }
  }
  /**
   * Copy a freshly created drawing onto the origin's same-group followers (fresh ids
   * through `drawings.add` — anchors are time+price, so the copy lands at the same
   * spot whatever the follower shows) and register the whole set as LINKED: edits
   * and removals of any member follow while the link is on ({@link drawingLinks}).
   * The busy guard stops the copies' own `drawing:created` events from fanning out.
   */
  propagateDrawing(originId, drawingId) {
    if (this.drawingSyncBusy || this.destroyed) return;
    const setting = this.syncOpts.drawings;
    if (!setting) return;
    const doc = this.cellsById.get(originId)?.chart.drawings.all().find((d) => d.id === drawingId);
    if (!doc) return;
    this.drawingSyncBusy = true;
    try {
      const group = /* @__PURE__ */ new Map([[originId, drawingId]]);
      for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
        const copy = this.cellsById.get(id)?.chart.drawings.add(doc.type, {
          paneId: doc.paneId,
          anchors: doc.anchors,
          style: doc.style,
          text: doc.text,
          props: doc.props
        });
        if (copy) group.set(id, copy.id);
      }
      if (group.size > 1) {
        for (const [cellId, dId] of group) this.drawingLinks.set(`${cellId}\0${dId}`, group);
      }
    } finally {
      this.drawingSyncBusy = false;
    }
  }
  /** Mirror an in-progress placement (its current ghost, `null` = placement ended)
   *  onto the origin's same-group followers — the live half of the drawings link;
   *  the created copy replaces the ghosts when the placement completes. One-way by
   *  contract (an external ghost never re-emits drafts), so no busy guard needed. */
  propagateDraft(originId, doc) {
    if (this.destroyed) return;
    const setting = this.syncOpts.drawings;
    if (!setting) return;
    for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
      this.cellsById.get(id)?.chart.drawings.setExternalGhost(doc);
    }
  }
  /** Push a linked drawing's edited CONTENT (anchors, style, text, per-type props)
   *  onto its same-group peers — any member propagates, not just the original. */
  propagateDrawingEdit(originId, drawingId) {
    if (this.drawingSyncBusy || this.destroyed) return;
    const setting = this.syncOpts.drawings;
    if (!setting) return;
    const group = this.drawingLinks.get(`${originId}\0${drawingId}`);
    if (!group) return;
    const doc = this.cellsById.get(originId)?.chart.drawings.all().find((d) => d.id === drawingId);
    if (!doc) return;
    this.drawingSyncBusy = true;
    try {
      for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
        const peerId = group.get(id);
        if (peerId == null) continue;
        this.cellsById.get(id)?.chart.drawings.update(peerId, {
          anchors: doc.anchors,
          style: doc.style,
          text: doc.text,
          props: doc.props
        });
      }
    } finally {
      this.drawingSyncBusy = false;
    }
  }
  /** Remove a linked drawing's peers with it. The removed member always leaves its
   *  link group (whatever the setting); peers are only deleted while the link is on.
   *  A propagated peer removal re-enters here under the busy guard and just cleans
   *  its own link key. */
  propagateDrawingRemoval(originId, drawingId) {
    if (this.destroyed) return;
    const key = `${originId}\0${drawingId}`;
    const group = this.drawingLinks.get(key);
    if (!group) return;
    this.drawingLinks.delete(key);
    group.delete(originId);
    if (this.drawingSyncBusy) return;
    const setting = this.syncOpts.drawings;
    if (!setting) return;
    this.drawingSyncBusy = true;
    try {
      for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
        const peerId = group.get(id);
        if (peerId != null) this.cellsById.get(id)?.chart.drawings.remove(peerId);
      }
    } finally {
      this.drawingSyncBusy = false;
    }
  }
  /**
   * Push an origin cell's symbol/timeframe onto its same-group followers (fired from
   * `market:changed`). Convergence comes from IDEMPOTENCE, not the guard: a follower's
   * own (async) `market:changed` propagates back, but every peer already carries the
   * value, so the cell setters no-op and the wave dies.
   */
  propagateMarket(originId) {
    if (this.syncBusy || this.destroyed) return;
    const origin = this.cellsById.get(originId);
    if (!origin) return;
    const ids = [...this.cellsById.keys()];
    this.syncBusy = true;
    try {
      if (origin.symbol) {
        for (const id of syncTargets(originId, this.syncOpts.symbol, ids)) this.cellsById.get(id)?.setSymbol(origin.symbol);
      }
      for (const id of syncTargets(originId, this.syncOpts.timeframe, ids)) this.cellsById.get(id)?.setTimeframe(origin.timeframe);
    } finally {
      this.syncBusy = false;
    }
  }
  /** Trigger ② — a cell's market changed: retention + sync always; chrome only if active. */
  onCellMarketChanged(id) {
    this.refreshRetention();
    this.propagateMarket(id);
    this.markStateDirty();
    if (id !== this.activeId) return;
    const cell = this.cellsById.get(id);
    if (!cell) return;
    this.topbar.setSymbol(cell.symbol);
    this.topbar.setTimeframe(cell.timeframe);
    this.mobileBar?.setSymbol(cell.symbol);
    this.mobileBar?.setTimeframe(cell.timeframe);
    this.objectTree.setSymbol(cell.symbol);
    this.bottombar?.setSession({ session: cell.session, enabled: cell.sessionAvailable });
    this.projectTimezone();
    this.bottombar?.setActiveRange(cell.activeRangeId);
  }
  /** Trigger ② — a cell's price style changed: the topbar button/menu only if active.
   *  Reads the cell back (not the requested style) so the button reflects what the
   *  renderer actually applied. */
  onCellPriceStyleChanged(id) {
    this.markStateDirty();
    if (id !== this.activeId) return;
    const cell = this.cellsById.get(id);
    if (!cell) return;
    this.topbar.setPriceStyle(cell.priceStyle);
  }
  /** Trigger ② — a cell's indicator ledger changed: count + picker only if active. */
  onCellIndicatorsChanged(id) {
    this.markStateDirty();
    if (id !== this.activeId) return;
    const cell = this.cellsById.get(id);
    if (!cell) return;
    this.topbar.setIndicatorCount(cell.indicatorCount);
    this.indicatorPicker?.sync();
  }
  /** Timeframe changes routed from the topbar menu / quick entry (chip state follows). */
  setActiveTimeframe(tf) {
    this.bottombar?.setActiveRange(null);
    this.active.setTimeframe(tf);
  }
  /** Star/unstar a timeframe — a WORKSPACE preference (one chip row, whatever the
   *  active cell); the topbar follows and the set persists with the document. */
  setTimeframeFavorite(tf, on) {
    if (on === this.tfFavs.includes(tf)) return;
    this.tfFavs = on ? [tf, ...this.tfFavs] : this.tfFavs.filter((f) => f !== tf);
    this.topbar.setTimeframeFavorites(this.tfFavs);
    this.markStateDirty();
  }
  /** The mode flipped (container resized across the breakpoint, or a coarse-pointer
   *  change). Close the open surfaces — a desktop card must not linger over the
   *  mobile chrome (and vice versa) — and re-present every cell's own chrome. */
  onLayoutModeChange(mode) {
    this.symbolPicker.close();
    this.indicatorPicker?.close();
    this.tfDrawer?.close();
    this.drawingsDrawer?.close();
    this.moreDrawer?.close();
    this.timezoneDrawer?.close();
    this.priceScaleDrawer?.close();
    this.alertsMenu?.destroy();
    this.alertsMenu = null;
    for (const cell of this.cellsById.values()) {
      cell.chart.renderer.closeDialogs();
      cell.chart.renderer.setLayoutMode(mode);
      cell.setControlsSuspended(mode === "mobile");
    }
    this.syncCellPresentation();
  }
  /** Push the layout-shape-dependent chrome onto every cell: multi-cell grids keep
   *  the status line on one row (segments that don't fit hide), and on MOBILE their
   *  legends' fold chip routes to the object tree instead of unfolding in place —
   *  per-indicator controls live there (the legend rows have no room in a grid cell). */
  syncCellPresentation() {
    const multi = this.def.cells.length > 1;
    const overview = multi && this.layoutCtl.current === "mobile" ? () => this.dock.toggle("objects", true) : null;
    for (const cell of this.cellsById.values()) {
      cell.setStatuslineFit(multi);
      cell.chart.renderer.setLegendOverviewAction(overview);
    }
  }
  // ── mobile drawers (built on first open; every read is live and hits the ACTIVE cell) ──
  openTimeframeDrawer() {
    this.tfDrawer ?? (this.tfDrawer = new TimeframeDrawer({
      host: this.root,
      timeframes: this.opts.timeframes ?? DEFAULT_TIMEFRAMES,
      ranges: RANGE_PRESETS,
      currentTimeframe: () => this.active.timeframe,
      activeRange: () => this.active.activeRangeId,
      onTimeframe: (tf) => this.setActiveTimeframe(tf),
      onRange: (preset) => {
        this.active.applyRange(preset);
        this.bottombar?.setActiveRange(preset.id);
      },
      onOpenChange: (open) => this.trackDialog(open)
    }));
    this.tfDrawer.open();
  }
  openDrawingsDrawer() {
    this.drawingsDrawer ?? (this.drawingsDrawer = new DrawingsDrawer({
      host: this.root,
      toolbar: () => this.toolbarDef,
      // the shared static toolbar's definition (see constructor)
      currentTool: () => this.active.chart.drawings.getTool(),
      isFavorite: (type) => this.active.chart.drawings.isFavorite(type),
      onFavorite: (type, on) => this.active.chart.drawings.setFavorite(type, on),
      onSelect: (type) => this.active.chart.drawings.setTool(type),
      onOpenChange: (open) => this.trackDialog(open)
    }));
    this.drawingsDrawer.open();
  }
  openMoreDrawer() {
    const has = (id) => topbarHas(this.topbarComp, id);
    this.moreDrawer ?? (this.moreDrawer = new MoreDrawer({
      host: this.root,
      ...has("undo-redo") ? { onUndo: () => this.active.history.undo(), onRedo: () => this.active.history.redo() } : {},
      ...has("screenshot") ? { onScreenshot: this.screenshotOverride ? () => this.runOverride(this.screenshotOverride) : () => this.downloadScreenshot() } : {},
      canUndo: () => this.active.history.canUndo,
      canRedo: () => this.active.history.canRedo,
      priceStyles: () => priceStyleIds().map((id) => ({ id, label: priceStyleLabel(id), icon: priceStyleIcon(id) })),
      priceStyle: () => this.active.priceStyle,
      onPriceStyle: (id) => this.active.setPriceStyle(id),
      panels: () => has("panels") ? [...this.dock.list()] : [],
      onTogglePanel: (id) => this.dock.toggle(id),
      ...has("alerts") ? { alerts: () => this.alerts.map((a) => ({ title: `${a.source} \xB7 ${a.title}`, message: a.message, time: a.time })) } : {},
      // Actions placed on the bottom bar (left-aligned by default) have their stop
      // there — only the menu-placed ones land in the drawer, or they would appear
      // twice: left (primary) ones with the primary rows, right ones at the end.
      // Built-in-id actions are slot OVERRIDES: they reach the drawer through the
      // slot's own routed button (screenshot) or stop (indicators), never as a row.
      primaryActions: () => this.drawerActions("left"),
      actions: () => this.drawerActions("right"),
      // The desktop layout dropdown's whole surface — the grid canvas, the
      // non-canvas presets and the sync switches — relocated into the kebab
      // drawer (the topbar is hidden on mobile). Same reads as the topbar block;
      // single-chart mode and a composition without 'layout' omit it here too.
      layout: this.monoLayout || !has("layout") ? void 0 : {
        shape: () => layoutShape(this.def),
        presets: () => layouts().filter((l) => layoutShape(l) === null).map((l) => ({ id: l.id, label: l.label, checked: l.id === this.def.id })),
        onSelectGrid: (rows, cols) => this.setLayout(layoutForGrid(rows, cols)),
        onSelectPreset: (id) => this.setLayout(id),
        syncs: () => [
          { id: "symbol", label: "Symbol", checked: this.syncOpts.symbol === true },
          { id: "timeframe", label: "Interval", checked: this.syncOpts.timeframe === true },
          { id: "crosshair", label: "Crosshair", checked: this.syncOpts.crosshair === true },
          { id: "style", label: "Style", checked: this.syncOpts.style === true }
        ],
        onToggleSync: (id) => {
          const kind = id;
          this.sync.set(kind, this.syncOpts[kind] ? false : true);
        },
        glyph: () => layoutGlyph(this.def)
      },
      onOpenChange: (open) => this.trackDialog(open)
    }));
    this.moreDrawer.open();
  }
  /** The contributed topbar actions the mobile menu lists, from one cluster. */
  drawerActions(cluster) {
    const builtin = new Set(TOPBAR_BUILTIN_IDS);
    return widgetActions("topbar", this.context()).filter((a) => mobilePlacement(a) === "menu" && a.align === "left" === (cluster === "left") && !builtin.has(a.id)).map((a) => ({ label: a.label, icon: a.icon, run: () => a.run(this.context()) }));
  }
  openTimezoneDrawer() {
    this.timezoneDrawer ?? (this.timezoneDrawer = new TimezoneDrawer({
      host: this.root,
      timezone: () => this.timezone,
      onTimezone: (zone) => this.setTimezone(zone),
      onOpenChange: (open) => this.trackDialog(open)
    }));
    this.timezoneDrawer.open();
  }
  openPriceScaleDrawer(y) {
    this.priceScalePressY = y;
    this.priceScaleDrawer ?? (this.priceScaleDrawer = new PriceScaleDrawer({
      host: this.root,
      chart: () => this.activeId ? this.cellsById.get(this.activeId)?.chart ?? null : null,
      pressY: () => this.priceScalePressY,
      onOpenChange: (open) => this.trackDialog(open)
    }));
    this.priceScaleDrawer.open();
  }
  /** The aggregated alerts bell — entries carry their cell; selecting one activates it. */
  openAlertsMenu(anchor) {
    this.alertsMenu?.destroy();
    const items = this.alerts.length ? this.alerts.map((a, i) => ({
      id: String(i),
      label: `${a.source} \xB7 ${new Date(a.time).toLocaleTimeString()} \xB7 ${a.title}: ${a.message}`.slice(0, 80)
    })) : [{ id: "none", label: "No alerts yet", disabled: true }];
    this.alertsMenu = new Menu({
      host: this.root,
      items,
      onSelect: (id) => {
        const alert = this.alerts[Number(id)];
        if (alert && this.cellsById.has(alert.cellId)) this.setActiveCell(alert.cellId);
      }
    });
    const r = anchor.getBoundingClientRect();
    this.alertsMenu.openAt(r.left, r.bottom + 4);
  }
  /** Mount registered attachments not yet mounted on this workspace (idempotent per id). */
  mountAttachments() {
    for (const att of widgetAttachments()) {
      if (this.attachmentDisposers.has(att.id)) continue;
      try {
        this.attachmentDisposers.set(att.id, att.mount(this.context()));
      } catch (err) {
        console.warn(`[vela] workspace attachment "${att.id}" failed to mount:`, err);
      }
    }
  }
  /** Invoke a slot override the way its button would: fresh context, `when` respected. */
  runOverride(action) {
    const ctx = this.context();
    if (!action.when || action.when(ctx)) action.run(ctx);
  }
  /** The default shortcut set — every binding acts on the ACTIVE cell. */
  registerDefaultKeys() {
    if (topbarHas(this.topbarComp, "screenshot")) {
      const ov = this.screenshotOverride;
      this.keymap.register({
        id: "chart.screenshot",
        keys: "mod+alt+s",
        label: ov ? ov.label : "Download a screenshot of the layout",
        category: "Chart",
        run: ov ? () => this.runOverride(ov) : () => this.downloadScreenshot()
      });
    }
    this.keymap.register({ id: "chart.reset-view", keys: "alt+r", label: "Reset view (all history)", category: "Chart", run: () => this.active.chart.setVisibleRangePreset("ALL") });
    this.keymap.register({ id: "chart.toggle-log", keys: "alt+l", label: "Toggle logarithmic scale", category: "Chart", run: () => this.active.chart.renderer.set("logScale", !this.active.chart.renderer.get("logScale")) });
    this.keymap.register({
      id: "chart.toggle-percent",
      keys: "alt+p",
      label: "Toggle percent scale",
      category: "Chart",
      run: () => {
        const mode = this.active.chart.renderer.get("scaleMode");
        this.active.chart.renderer.set("scaleMode", mode === "percent" ? "price" : "percent");
      }
    });
    this.keymap.register({ id: "drawings.trendline", keys: "alt+t", label: "Arm the trend line tool", category: "Drawings", run: () => this.active.chart.drawings.setTool("trendline") });
    this.keymap.register({
      id: "drawings.hline-cursor",
      keys: "alt+h",
      label: "Horizontal line at the cursor price",
      category: "Drawings",
      run: () => {
        const c = this.active;
        if (c.lastCrossTime != null && c.lastCrossPrice != null) c.chart.drawings.add("hline", { anchors: [{ time: c.lastCrossTime, price: c.lastCrossPrice }] });
      }
    });
    this.keymap.register({
      id: "drawings.vline-cursor",
      keys: "alt+v",
      label: "Vertical line at the cursor time",
      category: "Drawings",
      run: () => {
        const c = this.active;
        if (c.lastCrossTime != null && c.lastCrossPrice != null) c.chart.drawings.add("vline", { anchors: [{ time: c.lastCrossTime, price: c.lastCrossPrice }] });
      }
    });
    this.keymap.register({ id: "history.undo", keys: ["mod+z"], label: "Undo (active chart)", category: "Edit", run: () => this.active.history.undo() });
    this.keymap.register({ id: "history.redo", keys: ["mod+y", "mod+shift+z"], label: "Redo (active chart)", category: "Edit", run: () => this.active.history.redo() });
    this.keymap.register({ id: "view.zoom-in", keys: "mod+arrowup", label: "Zoom in", category: "Chart", run: () => this.glider.zoom(ZOOM_IN) });
    this.keymap.register({ id: "view.zoom-out", keys: "mod+arrowdown", label: "Zoom out", category: "Chart", run: () => this.glider.zoom(ZOOM_OUT) });
    this.keymap.register({ id: "view.pan-left", keys: "mod+arrowleft", label: "Pan toward history", category: "Chart", run: () => this.active.chart.panBy(-PAN_FAST) });
    this.keymap.register({ id: "view.pan-right", keys: "mod+arrowright", label: "Pan toward now", category: "Chart", run: () => this.active.chart.panBy(PAN_FAST) });
    const indOv = this.indicatorsOverride;
    if (indOv && topbarHas(this.topbarComp, "indicators")) {
      this.keymap.register({ id: "indicators.open", keys: "/", label: indOv.label, category: "Indicators", run: () => this.runOverride(indOv) });
    } else if (this.indicatorPicker) {
      this.keymap.register({ id: "indicators.open", keys: "/", label: "Open the indicator picker", category: "Indicators", run: () => this.indicatorPicker?.open() });
    }
    this.keymap.register({
      id: "help.shortcuts",
      keys: "?",
      label: "Show this shortcuts panel",
      category: "Help",
      run: () => {
        this.shortcutsHelp ?? (this.shortcutsHelp = new ShortcutsHelp(this.keymap, this.root, (open) => this.trackDialog(open)));
        this.shortcutsHelp.open();
      }
    });
  }
  /** Bare-typing router: letters and `0` → symbol search (seeded), digits 1–9 → timeframe entry. */
  routeTyping(ev) {
    if (this.destroyed) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (isEditableTarget(ev)) return;
    const hit = resolveTyping(ev.key, { dialogs: this.openDialogs, symbolSearch: this.symbolPicker.isOpen, timeframeEntry: this.tfQuick.isOpen });
    if (!hit) return;
    ev.preventDefault();
    if (hit.target === "symbol") this.symbolPicker.type(hit.text);
    else this.tfQuick.type(hit.text);
  }
  trackDialog(open) {
    this.openDialogs = Math.max(0, this.openDialogs + (open ? 1 : -1));
    if (open) this.keymap.pushScope("dialog");
    else this.keymap.popScope("dialog");
  }
  /** Pool a dehydrated slot state (bounded — oldest entries drop past the cap). */
  poolSet(id, state) {
    this.pool.delete(id);
    this.pool.set(id, state);
    if (this.pool.size > POOL_CAP) {
      const oldest = this.pool.keys().next().value;
      if (oldest != null) this.pool.delete(oldest);
    }
  }
  /**
   * Declare every live cell's symbol to the shared bar cache so one cell's load never
   * evicts the others' history (multi-symbol retention). Keys are CANONICAL tickers —
   * resolved through the registry when its indexes are ready, raw until then (refreshed
   * again on `feed.ready()`).
   */
  refreshRetention() {
    const symbols = /* @__PURE__ */ new Set();
    for (const cell of this.cellsById.values()) {
      const raw = cell.symbol;
      if (!raw) continue;
      symbols.add(this.feed.resolveSymbol(raw)?.ticker ?? raw);
    }
    sharedBarStore.retain(symbols, this);
  }
};

export { Bottombar, ChartCell, ChartContextMenu, DataWindow, GRID_PICKER_MAX, IndicatorPicker, ObjectTree, PanelDock, RANGE_PRESETS, ShortcutsHelp, Statusline, SymbolPicker, TimeframeQuick, Topbar, VelaWorkspace, Watermark, WorkspaceReplay, activeAfterLayout, barClose, dataWindowSections, decimalsFor, decodeState, encodeState, ensureLayout, evenTracks, filterSymbols, fmtChange, fmtPrice, gridStyles, lastOpenClosedBy, layoutDefinition, layoutForGrid, layoutShape, layouts, localStorageAdapter, memoryStorageAdapter, parseTimeframe, priceStyleLabel, rangesWithin, registerBuiltinLayouts, registerLayout, resizeTracks, resolveIndicators, sanitizeState, syncTargets, timeframeLabel, timeframeMs, trackOffsets, unregisterLayout };
