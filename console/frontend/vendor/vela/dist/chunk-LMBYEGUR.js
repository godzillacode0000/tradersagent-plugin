import { normalizeProps, nextUid, runMachine, spreadProps } from './chunk-NELQJCGK.js';
import { injectStyles } from './chunk-BZQM2XO7.js';
import * as tooltip from '@zag-js/tooltip';
import * as dialog from '@zag-js/dialog';

// src/ui/keymap.ts
var KEY_ALIASES = {
  esc: "escape",
  space: " ",
  plus: "+",
  minus: "-",
  del: "delete",
  return: "enter",
  left: "arrowleft",
  right: "arrowright",
  up: "arrowup",
  down: "arrowdown"
};
var MAC_GLYPHS = { meta: "\u2318", ctrl: "\u2303", alt: "\u2325", shift: "\u21E7" };
function parseChord(spec, mac) {
  const parts = spec.toLowerCase().split("+").map((p) => p.trim()).filter((p, i, a) => p !== "" || a[i - 1] === "");
  const chord = { ctrl: false, meta: false, alt: false, shift: false, key: "" };
  for (const raw of parts) {
    const p = raw === "" ? "+" : raw;
    if (p === "mod") mac ? chord.meta = true : chord.ctrl = true;
    else if (p === "ctrl" || p === "control") chord.ctrl = true;
    else if (p === "meta" || p === "cmd" || p === "command") chord.meta = true;
    else if (p === "alt" || p === "option") chord.alt = true;
    else if (p === "shift") chord.shift = true;
    else chord.key = KEY_ALIASES[p] ?? p;
  }
  return chord;
}
function eventMatches(ev, c) {
  return ev.ctrlKey === c.ctrl && ev.metaKey === c.meta && ev.altKey === c.alt && // Shift is part of producing many printable keys ('?', '+') — only enforce it
  // when the chord names a non-printable/letter key where shift is a real modifier.
  (c.key.length > 1 || /^[a-z0-9 ]$/.test(c.key) ? ev.shiftKey === c.shift : true) && ev.key.toLowerCase() === c.key;
}
function isEditableTarget(ev) {
  const t = ev.target;
  if (!t || typeof t !== "object") return false;
  const tag = (t.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (t.isContentEditable === true) return true;
  return (typeof t.getAttribute === "function" ? t.getAttribute("role") : null) === "textbox";
}
function displayChord(spec, mac) {
  const c = parseChord(spec, mac);
  const keyLabel = c.key === " " ? "Space" : c.key.length === 1 ? c.key.toUpperCase() : c.key.charAt(0).toUpperCase() + c.key.slice(1);
  if (mac) {
    return (c.ctrl ? MAC_GLYPHS.ctrl : "") + (c.alt ? MAC_GLYPHS.alt : "") + (c.shift ? MAC_GLYPHS.shift : "") + (c.meta ? MAC_GLYPHS.meta : "") + keyLabel;
  }
  const mods = [c.ctrl && "Ctrl", c.alt && "Alt", c.shift && "Shift", c.meta && "Win"].filter(Boolean);
  return [...mods, keyLabel].join("+");
}
var KeymapManager = class {
  constructor(opts = {}) {
    this.descriptors = /* @__PURE__ */ new Map();
    this.rebinds = /* @__PURE__ */ new Map();
    this.scopeStack = [];
    this.target = null;
    this.onKeydown = (ev) => {
      this.handleKeydown(ev);
    };
    this.mac = opts.platform !== void 0 ? opts.platform === "mac" : typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform ?? "");
    this.baseScope = opts.baseScope ?? "chart";
  }
  /** Register (or replace, by id) a binding. Returns a disposer. */
  register(desc) {
    this.descriptors.set(desc.id, desc);
    return () => {
      if (this.descriptors.get(desc.id) === desc) this.descriptors.delete(desc.id);
    };
  }
  unregister(id) {
    this.descriptors.delete(id);
    this.rebinds.delete(id);
  }
  /** User-level rebinding: overrides the descriptor's default chords (null resets). */
  rebind(id, keys) {
    if (keys === null) this.rebinds.delete(id);
    else this.rebinds.set(id, Array.isArray(keys) ? [...keys] : [keys]);
  }
  /** Snapshot for a shortcuts help panel / rebinding UI. */
  bindings() {
    return [...this.descriptors.values()].map((d) => {
      const keys = this.activeKeys(d);
      return {
        id: d.id,
        label: d.label,
        category: d.category ?? "General",
        scope: d.scope ?? this.baseScope,
        keys,
        display: keys.map((k) => displayChord(k, this.mac))
      };
    });
  }
  pushScope(scope) {
    this.scopeStack.push(scope);
    return () => this.popScope(scope);
  }
  /** Pops the TOPMOST occurrence of `scope` (tolerates out-of-order teardown). */
  popScope(scope) {
    const i = this.scopeStack.lastIndexOf(scope);
    if (i >= 0) this.scopeStack.splice(i, 1);
  }
  get activeScope() {
    return this.scopeStack[this.scopeStack.length - 1] ?? this.baseScope;
  }
  attach(target) {
    this.detach();
    this.target = target;
    target.addEventListener("keydown", this.onKeydown);
  }
  detach() {
    this.target?.removeEventListener("keydown", this.onKeydown);
    this.target = null;
  }
  /** The matcher — public so hosts/tests can feed events from their own listeners. */
  handleKeydown(ev) {
    const editable = isEditableTarget(ev);
    for (const d of this.descriptors.values()) {
      const scope = d.scope ?? this.baseScope;
      if (scope !== "global" && scope !== this.activeScope) continue;
      if (editable && !d.allowInInput) continue;
      if (d.when && !d.when()) continue;
      for (const spec of this.activeKeys(d)) {
        if (eventMatches(ev, parseChord(spec, this.mac))) {
          if (d.preventDefault !== false) {
            ev.preventDefault?.();
            ev.stopPropagation?.();
          }
          d.run(ev);
          return true;
        }
      }
    }
    return false;
  }
  destroy() {
    this.detach();
    this.descriptors.clear();
    this.rebinds.clear();
    this.scopeStack.length = 0;
  }
  activeKeys(d) {
    return this.rebinds.get(d.id) ?? (Array.isArray(d.keys) ? d.keys : [d.keys]);
  }
};
function tooltipController(opts = {}) {
  return {
    machine: tooltip.machine,
    props: {
      id: nextUid("vela-tooltip"),
      openDelay: opts.openDelay ?? 0,
      closeDelay: opts.closeDelay ?? 0,
      interactive: opts.interactive ?? false,
      ids: opts.triggerId ? { trigger: opts.triggerId } : void 0,
      positioning: { placement: opts.placement ?? "top" }
    },
    connect: (service) => tooltip.connect(service, normalizeProps)
  };
}

// src/ui/components/tooltip/styles.ts
var TOOLTIP_STYLE_ID = "vela-ui-tooltip";
var TOOLTIP_CSS = `
.vela-tooltip {
    background: var(--vela-bg);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-soft);
    border-radius: var(--vela-radius-md);
    box-shadow: var(--vela-shadow);
    font-size: var(--vela-font-size-md);
    line-height: 1.4;
    padding: var(--vela-space-1) var(--vela-space-2);
    max-width: 280px;
    pointer-events: none;
    z-index: var(--vela-z-tooltip);
}
.vela-tooltip[data-interactive] { pointer-events: auto; }
.vela-tooltip[data-state='open'] { animation: vela-tooltip-in 0.12s ease; }
@keyframes vela-tooltip-in {
    from { opacity: 0; transform: scale(0.97); }
    to { opacity: 1; transform: scale(1); }
}
`;
function resolveHost(trigger, host) {
  return host ?? trigger.closest(".vela-ui") ?? trigger.ownerDocument.body;
}
var Tooltip = class {
  constructor(trigger, opts) {
    this.trigger = trigger;
    const doc = trigger.ownerDocument;
    injectStyles(TOOLTIP_STYLE_ID, TOOLTIP_CSS, doc);
    this.positioner = doc.createElement("div");
    this.positioner.className = "vela-ui-layer";
    this.content = doc.createElement("div");
    this.content.className = "vela-tooltip";
    this.positioner.appendChild(this.content);
    resolveHost(trigger, opts.host).appendChild(this.positioner);
    this.setContent(opts.content);
    const ctrl = tooltipController(opts);
    const mid = String(ctrl.props.id);
    if (opts.triggerId) trigger.id = opts.triggerId;
    this.handle = runMachine(ctrl.machine, ctrl.props, (service) => {
      const api = ctrl.connect(service);
      spreadProps(trigger, api.getTriggerProps(), mid);
      spreadProps(this.positioner, api.getPositionerProps(), mid);
      spreadProps(this.content, api.getContentProps(), mid);
    });
  }
  setContent(content) {
    this.content.replaceChildren(typeof content === "function" ? content() : content);
  }
  destroy() {
    this.handle.stop();
    this.positioner.remove();
    this.trigger.removeAttribute("data-scope");
  }
};
function drawerController(opts = {}) {
  return {
    machine: dialog.machine,
    props: {
      id: nextUid("vela-drawer"),
      modal: true,
      closeOnEscape: opts.closeOnEscape ?? true,
      closeOnInteractOutside: opts.closeOnInteractOutside ?? true,
      initialFocusEl: opts.initialFocusEl,
      onOpenChange: (d) => opts.onOpenChange?.(d.open)
    },
    connect: (service) => dialog.connect(service, normalizeProps)
  };
}

// src/ui/components/drawer/styles.ts
var DRAWER_STYLE_ID = "vela-ui-drawer";
var DRAWER_CSS = `
.vela-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: var(--vela-backdrop);
    z-index: var(--vela-z-dialog);
}
.vela-drawer-positioner {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: var(--vela-z-dialog);
}
/* Inside a shell that declares a size class, the sheet scopes to the SHELL's bounds
   (the widget root is position:relative) instead of the whole viewport \u2014 an embedded
   chart must not curtain the host page. */
[data-layout] .vela-drawer-backdrop, [data-layout] .vela-drawer-positioner { position: absolute; }
.vela-drawer {
    background: var(--vela-surface);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-bottom: none;
    border-radius: 14px 14px 0 0;
    box-shadow: var(--vela-shadow-dialog);
    font-size: 13px;
    width: 100%;
    max-height: 85%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
}
.vela-drawer[data-state='open'] { animation: vela-drawer-in var(--vela-dur-med) var(--vela-ease); }
@keyframes vela-drawer-in {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
}
/* The grab zone owns its touches (drag-to-dismiss), so the browser must not scroll it. */
.vela-drawer-grab {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 0 6px;
    cursor: grab;
    touch-action: none;
    user-select: none;
}
.vela-drawer-grab::before {
    content: '';
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--vela-border-strong);
}
.vela-drawer-title {
    flex: none;
    padding: 0 16px 10px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.2px;
    color: var(--vela-fg-bright);
    user-select: none;
}
.vela-drawer-title:empty { display: none; }
.vela-drawer-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    /* Vertical pans stay native scrolling; horizontal moves reach the sheet's gesture
       recognizer as pointer events (tab swipes). Without this the browser claims a
       sideways touch as a scroll attempt and CANCELS the pointer stream, so swipes
       never registered on real touch devices. Sideways-scrolling strips inside the
       body opt back in with their own touch-action: pan-x. */
    touch-action: pan-y;
    padding: 0 var(--vela-space-3) calc(var(--vela-space-3) + env(safe-area-inset-bottom, 0px));
}
.vela-drawer-body::-webkit-scrollbar { width: 8px; }
.vela-drawer-body::-webkit-scrollbar-thumb {
    background: var(--vela-scroll);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
}
`;
var DISMISS_FRACTION = 0.33;
var DISMISS_PX = 96;
var SLOP_PX = 8;
var HSWIPE_MIN_PX = 48;
function classifyGesture(dx, dy, ctx) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) return "pending";
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 && !ctx.scrolled ? "drag" : "scroll";
  return ctx.canSwipe && !ctx.hScrollable ? "hswipe" : "scroll";
}
function dragDismisses(dy, panelHeightPx) {
  return dy >= Math.min(DISMISS_PX, panelHeightPx * DISMISS_FRACTION);
}
function swipeDirection(dx, dy) {
  if (Math.abs(dx) < HSWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? "left" : "right";
}
var Drawer = class {
  constructor(opts = {}) {
    const doc = (opts.host ?? document.body).ownerDocument;
    injectStyles(DRAWER_STYLE_ID, DRAWER_CSS, doc);
    const host = opts.host ?? doc.body;
    this.backdrop = doc.createElement("div");
    this.backdrop.className = "vela-drawer-backdrop vela-ui-layer";
    this.positioner = doc.createElement("div");
    this.positioner.className = "vela-drawer-positioner vela-ui-layer";
    this.panel = doc.createElement("div");
    this.panel.className = "vela-drawer";
    this.panel.tabIndex = -1;
    const grab = doc.createElement("div");
    grab.className = "vela-drawer-grab";
    this.titleEl = doc.createElement("div");
    this.titleEl.className = "vela-drawer-title";
    this.titleEl.textContent = opts.title ?? "";
    this.body = doc.createElement("div");
    this.body.className = "vela-drawer-body";
    if (opts.content instanceof Node) this.body.appendChild(opts.content);
    else if (typeof opts.content === "function") opts.content(this.body);
    this.panel.append(grab, this.titleEl, this.body);
    this.positioner.appendChild(this.panel);
    host.append(this.backdrop, this.positioner);
    this.wireGestures(grab, opts.onSwipe);
    this.ctrl = drawerController({ ...opts, initialFocusEl: () => this.panel });
    const mid = String(this.ctrl.props.id);
    this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => {
      const api = this.ctrl.connect(service);
      spreadProps(this.backdrop, api.getBackdropProps(), mid);
      spreadProps(this.positioner, api.getPositionerProps(), mid);
      spreadProps(this.panel, api.getContentProps(), mid);
      spreadProps(this.titleEl, api.getTitleProps(), mid);
      this.backdrop.style.display = api.open ? "" : "none";
      this.positioner.style.display = api.open ? "" : "none";
    });
  }
  /** Any element between `from` and the panel that has already been scrolled down —
   *  a downward pull there must scroll it back up, never drag the sheet. */
  scrolledAncestor(from) {
    let el = from instanceof Element ? from : null;
    while (el && el !== this.panel) {
      if (el.scrollTop > 0) return true;
      el = el.parentElement;
    }
    return false;
  }
  /** Any element between `from` and the panel that scrolls horizontally on its own
   *  (the tab strip, chip rows) — a sideways move there is ITS scroll, not a swipe. */
  hScrollableAncestor(from) {
    let el = from instanceof Element ? from : null;
    while (el && el !== this.panel) {
      if (el.scrollWidth > el.clientWidth + 1) return true;
      el = el.parentElement;
    }
    return false;
  }
  /**
   * One gesture recognizer for the whole sheet. A downward pull dismisses from
   * anywhere — the grab handle immediately, the content once it is decidedly vertical
   * and its scroller is at rest (a scrolled list keeps native scrolling). A decidedly
   * horizontal move becomes an `onSwipe` (tabbed drawers flip pages with it). The
   * non-passive touchmove hook is what keeps the browser from claiming the pull as a
   * scroll once the sheet is (or may become) the drag target.
   */
  wireGestures(grab, onSwipe) {
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let mode = "idle";
    const beginDrag = (e) => {
      mode = "drag";
      startY = e.clientY;
      this.panel.style.transition = "none";
      try {
        this.panel.setPointerCapture(e.pointerId);
      } catch {
      }
    };
    this.panel.addEventListener("pointerdown", (e) => {
      if (e.isPrimary === false) return;
      startX = e.clientX;
      startY = e.clientY;
      dx = 0;
      dy = 0;
      if (grab.contains(e.target)) beginDrag(e);
      else mode = "pending";
    });
    this.panel.addEventListener("pointermove", (e) => {
      if (mode === "idle" || mode === "scroll") return;
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      if (mode === "pending") {
        const intent = classifyGesture(dx, dy, {
          canSwipe: !!onSwipe,
          scrolled: this.scrolledAncestor(e.target),
          hScrollable: this.hScrollableAncestor(e.target)
        });
        if (intent === "pending") return;
        if (intent === "drag") beginDrag(e);
        else mode = intent;
      }
      if (mode === "drag") {
        dy = Math.max(0, e.clientY - startY);
        this.panel.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
      }
    });
    this.panel.addEventListener(
      "touchmove",
      (e) => {
        if (mode === "drag" || mode === "hswipe") {
          e.preventDefault();
          return;
        }
        if (mode !== "pending") return;
        const t = e.touches[0];
        if (!t) return;
        const mdx = t.clientX - startX;
        const mdy = t.clientY - startY;
        if (mdy > Math.abs(mdx) && !this.scrolledAncestor(e.target)) e.preventDefault();
      },
      { passive: false }
    );
    const settle = () => {
      if (mode === "idle") return;
      const finished = mode;
      mode = "idle";
      if (finished === "drag") {
        this.panel.style.transition = "";
        this.panel.style.transform = "";
        if (dragDismisses(dy, this.panel.getBoundingClientRect().height)) this.hide();
      } else if (finished === "hswipe") {
        const dir = swipeDirection(dx, dy);
        if (dir) onSwipe?.(dir);
      }
    };
    this.panel.addEventListener("pointerup", settle);
    this.panel.addEventListener("pointercancel", settle);
  }
  setTitle(title) {
    this.titleEl.textContent = title;
  }
  get open() {
    return this.ctrl.connect(this.handle.service).open;
  }
  show() {
    this.ctrl.connect(this.handle.service).setOpen(true);
  }
  hide() {
    this.ctrl.connect(this.handle.service).setOpen(false);
  }
  destroy() {
    this.handle.stop();
    this.backdrop.remove();
    this.positioner.remove();
  }
};

export { Drawer, KeymapManager, Tooltip, drawerController, isEditableTarget, tooltipController };
