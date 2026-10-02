import { svg24, NEUTRAL, BEARISH, WARNING, BULLISH, INFO, ACCENT_BRIGHT, VALID, INVALID, MARKER, ACCENT, injectStyles, iconEl } from './chunk-BZQM2XO7.js';

// src/core/model/series.ts
function isLineLikeSeries(spec) {
  return spec.kind !== "candle" && spec.kind !== "bar" && spec.kind !== "markers";
}
function seriesShownOn(spec, surface) {
  if (spec.display) return spec.display[surface] !== false;
  return spec.visible !== false;
}
function seriesInScale(spec) {
  return seriesShownOn(spec, "pane") || seriesShownOn(spec, "priceScale");
}

// src/core/native-indicators/NativeIndicator.ts
function nativeInstanceChannel(type, instanceId) {
  return `${type}#${instanceId}`;
}
var REGISTRY = /* @__PURE__ */ new Map();
function registerNativeIndicator(descriptor) {
  REGISTRY.set(descriptor.type, descriptor);
}
function unregisterNativeIndicator(type) {
  REGISTRY.delete(type);
}
function getNativeIndicator(type) {
  return REGISTRY.get(type);
}
function nativeIndicatorTypes() {
  return [...REGISTRY.keys()];
}
function nativeIndicatorDescriptors() {
  return [...REGISTRY.values()];
}

// src/core/drawings/style.ts
var DEFAULT_DRAWING_COLOR = ACCENT_BRIGHT;
function defaultStyle() {
  return { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" };
}
function defaultText(value = "") {
  return { value, size: "normal", hAlign: "left", vAlign: "top" };
}

// src/core/drawings/Drawing.ts
var _Drawing = class _Drawing {
  // Public so the registry can construct concrete subclasses; `abstract` still
  // prevents `new Drawing()` directly.
  constructor(init) {
    this.locked = false;
    this.visible = true;
    this.zIndex = 0;
    this.id = init.id ?? `dw-${_Drawing.seq += 1}`;
    this.paneId = init.paneId;
    this.anchors = (init.anchors ?? []).map((p) => ({ time: p.time, price: p.price }));
    this.style = init.style ? { ...init.style } : defaultStyle();
    this.text = init.text ? { ...init.text } : void 0;
    this.locked = init.locked ?? false;
    this.visible = init.visible ?? true;
    this.zIndex = init.zIndex ?? 0;
    this.createdAt = init.createdAt ?? Date.now();
    if (init.props) this.readProps(init.props);
  }
  /** True once enough anchors exist to be a real shape. */
  isComplete() {
    return this.anchors.length >= this.anchorSchema().min;
  }
  /**
   * How the tool is placed: `'click'` (click each anchor; a variable-count tool —
   * `max > min` — keeps adding until a finish gesture), `'drag'` (press at the first
   * corner, drag, release at the second — the press-drag-release idiom for boxes/ranges/positions),
   * or `'freehand'` (press, drag to capture a path, release). Drives the state machine.
   */
  placementMode() {
    return "click";
  }
  /**
   * Hook run once after interactive placement finishes, before the `create` intent —
   * lets a type finalize its anchors against the live projector (e.g. a position deriving
   * its stop/target/width in pixel space so a bare click drops a default-sized box).
   * Default: no-op.
   */
  onPlaced(_proj) {
  }
  /**
   * After a single handle (anchor `index`) is dragged, re-impose any cross-anchor invariant —
   * e.g. a position keeps its stop and target on opposite sides of the entry, flipping the
   * non-dragged side across the entry when a drag would put them on the same side. Default: no-op.
   */
  constrainHandleDrag(_index) {
  }
  /**
   * Apply a whole-body drag — translate the original anchors by (dt, dp) in data space.
   * Default moves every anchor together; a type can pin some (e.g. a callout keeps its
   * pointer tip fixed and moves only the box).
   */
  translateBody(dt, dp, orig) {
    return orig.map((o) => ({ time: o.time + dt, price: o.price + dp }));
  }
  /**
   * Time span (epoch ms) the drawing occupies, for visible-range culling. Default
   * is the anchor extent; a full-width drawing (e.g. a horizontal line) overrides
   * to `null` meaning "all time" so it never culls.
   */
  timeExtent() {
    if (this.anchors.length === 0) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const a of this.anchors) {
      if (a.time < lo) lo = a.time;
      if (a.time > hi) hi = a.time;
    }
    return { min: lo, max: hi };
  }
  /**
   * Editable per-level config for a rich "gear" settings panel (Fibonacci levels):
   * each entry's `color` / `enabled` / `label` is mutated via a `levels.<i>.<field>`
   * settings path. Simple drawings return null (no gear).
   */
  editableLevels() {
    return null;
  }
  /** Apply a `{ 'dot.path': value }` patch (the popup emits these). */
  applySettings(patch) {
    for (const [path, value] of Object.entries(patch)) {
      if (path.startsWith("text.") && !this.text) this.text = defaultText();
      setByPath(this, path, value);
    }
  }
  /** Re-read per-type extras (props) onto this instance — used by the store on an edit. */
  applyProps(props) {
    this.readProps(props);
  }
  // ── serialization ──
  serialize() {
    return {
      id: this.id,
      type: this.type,
      paneId: this.paneId,
      anchors: this.anchors.map((p) => ({ time: p.time, price: p.price })),
      style: { ...this.style },
      text: this.text ? { ...this.text } : void 0,
      locked: this.locked,
      visible: this.visible,
      zIndex: this.zIndex,
      createdAt: this.createdAt,
      props: this.writeProps()
    };
  }
  /** Per-type extras to serialize into `props` (override in subclasses). */
  writeProps() {
    return void 0;
  }
  /** Read per-type extras from a `props` bag (override in subclasses). */
  readProps(_props) {
  }
};
/** Fallback id counter — used only when no id is supplied (store assigns real ids). */
_Drawing.seq = 0;
var Drawing = _Drawing;
function setByPath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i];
    let next = cur[k];
    if (next == null || typeof next !== "object") {
      next = {};
      cur[k] = next;
    }
    cur = next;
  }
  cur[keys[keys.length - 1]] = value;
}

// src/core/drawings/schema.ts
var LINE_STYLE_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" }
];
var LINE_FIELDS = [
  { path: "style.lineColor", label: "Line color", kind: "color", group: "line" },
  { path: "style.lineWidth", label: "Line width", kind: "number", min: 1, max: 10, step: 1, group: "line" },
  { path: "style.lineStyle", label: "Line style", kind: "lineStyle", options: LINE_STYLE_OPTIONS, group: "line" }
];
var FILL_FIELDS = [{ path: "style.fillColor", label: "Fill color", kind: "color", group: "fill" }];
var TEXT_SIZE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "huge", label: "Huge" }
];
var TEXT_FIELDS = [
  { path: "text.value", label: "Text", kind: "text", group: "text" },
  { path: "text.color", label: "Text color", kind: "color", group: "text" },
  { path: "text.size", label: "Text size", kind: "select", options: TEXT_SIZE_OPTIONS, group: "text" },
  { path: "text.bold", label: "Bold", kind: "boolean", group: "text" },
  { path: "text.italic", label: "Italic", kind: "boolean", group: "text" }
];

// src/core/drawings/hittest.ts
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distToPolyline(px, py, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = distToSegment(px, py, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}
function pointInBox(px, py, x1, y1, x2, y2, pad = 0) {
  const lo = Math.min(x1, x2) - pad;
  const hi = Math.max(x1, x2) + pad;
  const top = Math.min(y1, y2) - pad;
  const bot = Math.max(y1, y2) + pad;
  return px >= lo && px <= hi && py >= top && py <= bot;
}
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    const intersect = a[1] > py !== b[1] > py && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0];
    if (intersect) inside = !inside;
  }
  return inside;
}
function lineSegmentIntersection(lx1, ly1, lx2, ly2, ax, ay, bx, by) {
  const dx = lx2 - lx1;
  const dy = ly2 - ly1;
  const ex = bx - ax;
  const ey = by - ay;
  const denom = ex * dy - ey * dx;
  if (Math.abs(denom) < 1e-9) return null;
  const s = ((ay - ly1) * dx - (ax - lx1) * dy) / denom;
  if (s < 0 || s > 1) return null;
  return [ax + s * ex, ay + s * ey];
}
function handleAt(px, py, handles, rad = 6) {
  for (let i = 0; i < handles.length; i += 1) {
    const h = handles[i];
    if (Math.hypot(px - h[0], py - h[1]) <= rad) return i;
  }
  return -1;
}
function extendRay(x1, y1, x2, y2, extend, width, height) {
  if (extend === "none") return [x1, y1, x2, y2];
  const dx = x2 - x1;
  const left = extend === "left" || extend === "both";
  const right = extend === "right" || extend === "both";
  if (Math.abs(dx) < 1e-6) {
    if (left && right) return [x1, 0, x2, height];
    const downward = y2 >= y1;
    if (right) return downward ? [x1, y1, x2, height] : [x1, y1, x2, 0];
    return downward ? [x1, 0, x2, y2] : [x1, height, x2, y2];
  }
  const slope = (y2 - y1) / dx;
  const yAt = (x) => y1 + slope * (x - x1);
  const lx = left ? -2 : Math.min(x1, x2);
  const rx = right ? width + 2 : Math.max(x1, x2);
  return [lx, yAt(lx), rx, yAt(rx)];
}

// src/core/drawings/types/TrendLine.ts
var TrendLine = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "trendline";
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "p1", free: "both" }, { role: "p2", free: "both" }] };
  }
  pixels(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const y1 = proj.yOf(a.price, this.paneId);
    const y2 = proj.yOf(b.price, this.paneId);
    if (y1 == null || y2 == null) return null;
    return [proj.xOf(a.time), y1, proj.xOf(b.time), y2];
  }
  hitTest(px, py, proj, tol) {
    const p = this.pixels(proj);
    return p != null && distToSegment(px, py, p[0], p[1], p[2], p[3]) <= tol;
  }
  handlePoints(proj) {
    const p = this.pixels(proj);
    return p ? [[p[0], p[1]], [p[2], p[3]]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const p = this.pixels(proj);
    if (!p) return null;
    const x = Math.min(p[0], p[2]);
    const y = Math.min(p[1], p[3]);
    return { x, y, w: Math.abs(p[2] - p[0]), h: Math.abs(p[3] - p[1]) };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return {
      fields: [
        ...LINE_FIELDS,
        { path: "style.arrowRight", label: "Arrow", kind: "boolean", group: "line" },
        ...TEXT_FIELDS
      ]
    };
  }
};

// src/core/drawings/types/HorizontalLine.ts
var HorizontalLine = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "hline";
  }
  anchorSchema() {
    return { min: 1, max: 1, slots: [{ role: "p", free: "y" }] };
  }
  y(proj) {
    const a = this.anchors[0];
    return a ? proj.yOf(a.price, this.paneId) : null;
  }
  hitTest(_px, py, proj, tol) {
    const y = this.y(proj);
    return y != null && Math.abs(py - y) <= tol;
  }
  handlePoints(proj) {
    const a = this.anchors[0];
    const y = this.y(proj);
    if (!a || y == null) return [];
    return [[proj.xOf(a.time), y]];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const y = this.y(proj);
    return y == null ? null : { x: 0, y: y - 1, w: proj.width, h: 2 };
  }
  priceRange() {
    const a = this.anchors[0];
    return a ? { min: a.price, max: a.price } : null;
  }
  // A horizontal line spans the full width → never cull by time.
  timeExtent() {
    return null;
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/Ray.ts
var Ray = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "ray";
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "p1", free: "both" }, { role: "p2", free: "both" }] };
  }
  pixels(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const y1 = proj.yOf(a.price, this.paneId);
    const y2 = proj.yOf(b.price, this.paneId);
    if (y1 == null || y2 == null) return null;
    return [proj.xOf(a.time), y1, proj.xOf(b.time), y2];
  }
  hitTest(px, py, proj, tol) {
    const p = this.pixels(proj);
    if (!p) return false;
    const [ex1, ey1, ex2, ey2] = extendRay(p[0], p[1], p[2], p[3], "right", proj.width, proj.height);
    return distToSegment(px, py, ex1, ey1, ex2, ey2) <= tol;
  }
  handlePoints(proj) {
    const p = this.pixels(proj);
    return p ? [[p[0], p[1]], [p[2], p[3]]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const p = this.pixels(proj);
    if (!p) return null;
    return { x: Math.min(p[0], p[2]), y: Math.min(p[1], p[3]), w: Math.abs(p[2] - p[0]), h: Math.abs(p[3] - p[1]) };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/TwoPointLine.ts
var TwoPointLine = class extends Drawing {
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "p1", free: "both" }, { role: "p2", free: "both" }] };
  }
  pixels(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const y1 = proj.yOf(a.price, this.paneId);
    const y2 = proj.yOf(b.price, this.paneId);
    if (y1 == null || y2 == null) return null;
    return [proj.xOf(a.time), y1, proj.xOf(b.time), y2];
  }
  hitTest(px, py, proj, tol) {
    const p = this.pixels(proj);
    return p != null && distToSegment(px, py, p[0], p[1], p[2], p[3]) <= tol;
  }
  handlePoints(proj) {
    const p = this.pixels(proj);
    return p ? [[p[0], p[1]], [p[2], p[3]]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const p = this.pixels(proj);
    if (!p) return null;
    return { x: Math.min(p[0], p[2]), y: Math.min(p[1], p[3]), w: Math.abs(p[2] - p[0]), h: Math.abs(p[3] - p[1]) };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/ExtendedLine.ts
var ExtendedLine = class extends TwoPointLine {
  constructor() {
    super(...arguments);
    this.type = "extendedline";
  }
  hitTest(px, py, proj, tol) {
    const p = this.pixels(proj);
    if (!p) return false;
    const [ex1, ey1, ex2, ey2] = extendRay(p[0], p[1], p[2], p[3], "both", proj.width, proj.height);
    return distToSegment(px, py, ex1, ey1, ex2, ey2) <= tol;
  }
  // Spans the full width in both directions → never cull by time.
  timeExtent() {
    return null;
  }
};

// src/core/drawings/types/VerticalLine.ts
var VerticalLine = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "vline";
  }
  anchorSchema() {
    return { min: 1, max: 1, slots: [{ role: "p", free: "x" }] };
  }
  x(proj) {
    const a = this.anchors[0];
    return a ? proj.xOf(a.time) : null;
  }
  hitTest(px, _py, proj, tol) {
    const x = this.x(proj);
    return x != null && Math.abs(px - x) <= tol;
  }
  handlePoints(proj) {
    const a = this.anchors[0];
    const x = this.x(proj);
    if (!a || x == null) return [];
    const y = proj.yOf(a.price, this.paneId);
    return y == null ? [] : [[x, y]];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const x = this.x(proj);
    return x == null ? null : { x: x - 1, y: 0, w: 2, h: proj.height };
  }
  priceRange() {
    return null;
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/HorizontalRay.ts
var HorizontalRay = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "hray";
  }
  anchorSchema() {
    return { min: 1, max: 1, slots: [{ role: "p", free: "both" }] };
  }
  pt(proj) {
    const a = this.anchors[0];
    if (!a) return null;
    const y = proj.yOf(a.price, this.paneId);
    return y == null ? null : [proj.xOf(a.time), y];
  }
  hitTest(px, py, proj, tol) {
    const p = this.pt(proj);
    return p != null && distToSegment(px, py, p[0], p[1], proj.width, p[1]) <= tol;
  }
  handlePoints(proj) {
    const p = this.pt(proj);
    return p ? [p] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const p = this.pt(proj);
    return p ? { x: p[0], y: p[1] - 1, w: Math.max(0, proj.width - p[0]), h: 2 } : null;
  }
  priceRange() {
    const a = this.anchors[0];
    return a ? { min: a.price, max: a.price } : null;
  }
  // Extends right to the edge → visible whenever its anchor sits at/left of the viewport.
  timeExtent() {
    const a = this.anchors[0];
    return a ? { min: a.time, max: Number.POSITIVE_INFINITY } : null;
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/CrossLine.ts
var CrossLine = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "crossline";
  }
  anchorSchema() {
    return { min: 1, max: 1, slots: [{ role: "p", free: "both" }] };
  }
  pt(proj) {
    const a = this.anchors[0];
    if (!a) return null;
    const y = proj.yOf(a.price, this.paneId);
    return y == null ? null : [proj.xOf(a.time), y];
  }
  hitTest(px, py, proj, tol) {
    const p = this.pt(proj);
    return p != null && (Math.abs(py - p[1]) <= tol || Math.abs(px - p[0]) <= tol);
  }
  handlePoints(proj) {
    const p = this.pt(proj);
    return p ? [p] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const p = this.pt(proj);
    return p ? { x: p[0] - 1, y: p[1] - 1, w: 2, h: 2 } : null;
  }
  priceRange() {
    const a = this.anchors[0];
    return a ? { min: a.price, max: a.price } : null;
  }
  // The horizontal arm spans the full width → never cull by time.
  timeExtent() {
    return null;
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/InfoLine.ts
var InfoLine = class extends TwoPointLine {
  constructor() {
    super(...arguments);
    this.type = "infoline";
  }
};

// src/core/drawings/types/TrendAngle.ts
var TrendAngle = class extends TwoPointLine {
  constructor() {
    super(...arguments);
    this.type = "trendangle";
  }
};

// src/core/drawings/types/Box.ts
var Box = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "box";
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "c1", free: "both" }, { role: "c2", free: "both" }] };
  }
  rect(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    if (ya == null || yb == null) return null;
    return { x1: proj.xOf(a.time), y1: ya, x2: proj.xOf(b.time), y2: yb };
  }
  hitTest(px, py, proj, tol) {
    const r = this.rect(proj);
    if (!r) return false;
    if (this.style.fillColor && pointInBox(px, py, r.x1, r.y1, r.x2, r.y2)) return true;
    const edges = [
      [r.x1, r.y1, r.x2, r.y1],
      [r.x2, r.y1, r.x2, r.y2],
      [r.x2, r.y2, r.x1, r.y2],
      [r.x1, r.y2, r.x1, r.y1]
    ];
    return edges.some((e) => distToSegment(px, py, e[0], e[1], e[2], e[3]) <= tol);
  }
  handlePoints(proj) {
    const r = this.rect(proj);
    return r ? [[r.x1, r.y1], [r.x2, r.y2]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const r = this.rect(proj);
    if (!r) return null;
    return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return {
      fields: [
        ...LINE_FIELDS.map((f) => ({ ...f, label: f.label.replace("Line", "Border") })),
        { path: "style.fillColor", label: "Fill color", kind: "color", group: "fill" },
        ...TEXT_FIELDS
      ]
    };
  }
};

// src/core/drawings/types/PinnedLabel.ts
var SIZE_PX = { tiny: 10, small: 12, normal: 14, large: 18, huge: 24, auto: 14 };
var PinnedLabel = class extends Drawing {
  /** The placeholder string when no text has been entered yet. */
  defaultLabel() {
    return "Text";
  }
  /** The string used to size the approximate hit box (subclasses with computed text override it). */
  labelText() {
    return this.text?.value ?? this.defaultLabel();
  }
  anchorSchema() {
    return { min: 1, max: 1, slots: [{ role: "p", free: "both" }] };
  }
  /** Approximate pixel box of the label (the painter renders the precise glyphs). */
  box(proj) {
    const a = this.anchors[0];
    if (!a) return null;
    const y = proj.yOf(a.price, this.paneId);
    if (y == null) return null;
    const fs = SIZE_PX[this.text?.size ?? "normal"] ?? 14;
    const lines = this.labelText().split("\n");
    const cols = Math.max(1, ...lines.map((l) => l.length));
    return { x: proj.xOf(a.time), y, w: Math.max(12, cols * fs * 0.6) + 8, h: lines.length * fs * 1.4 + 4 };
  }
  hitTest(px, py, proj, _tol) {
    const b = this.box(proj);
    return b != null && pointInBox(px, py, b.x, b.y, b.x + b.w, b.y + b.h);
  }
  handlePoints(proj) {
    const a = this.anchors[0];
    const y = a ? proj.yOf(a.price, this.paneId) : null;
    return a && y != null ? [[proj.xOf(a.time), y]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    return this.box(proj);
  }
  priceRange() {
    const a = this.anchors[0];
    return a ? { min: a.price, max: a.price } : null;
  }
};

// src/core/drawings/types/TextLabel.ts
var TextLabel = class extends PinnedLabel {
  constructor(init) {
    super(init);
    this.type = "text";
    if (!this.text) this.text = { ...defaultText(), size: "large" };
  }
  schema() {
    return { fields: [...TEXT_FIELDS], textIsContent: true };
  }
};

// src/core/drawings/types/Note.ts
var Note = class extends PinnedLabel {
  constructor(init) {
    super(init);
    this.type = "note";
    if (!this.text) this.text = defaultText("Note");
  }
  defaultLabel() {
    return "Note";
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS], textIsContent: true };
  }
};

// src/core/drawings/types/PriceLabel.ts
var PriceLabel = class extends PinnedLabel {
  constructor() {
    super(...arguments);
    this.type = "pricelabel";
  }
  /** Sized from the (approximate) price string — the painter formats it precisely. */
  labelText() {
    const p = this.anchors[0]?.price;
    return p == null ? "0.00" : p.toFixed(2);
  }
  /** The label value is auto (the price), so expose only styling — not a `text.value` field. */
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS.filter((f) => f.path !== "text.value")] };
  }
};

// src/core/drawings/types/CalloutBase.ts
var SIZE_PX2 = { tiny: 10, small: 12, normal: 14, large: 18, huge: 24, auto: 14 };
var CalloutBase = class extends Drawing {
  constructor(init) {
    super(init);
    if (!this.text) this.text = defaultText(this.defaultLabel());
  }
  /** The placeholder text seeded for a fresh annotation. */
  defaultLabel() {
    return "Callout";
  }
  /** The string used to size the approximate hit box (auto-text subclasses override it). */
  labelText() {
    return this.text?.value ?? this.defaultLabel();
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "target", free: "both" }, { role: "box", free: "both" }] };
  }
  /** Approximate pixel box around the box anchor (the painter renders the precise glyphs). */
  box(proj) {
    const c = this.anchors[1];
    if (!c) return null;
    const cy = proj.yOf(c.price, this.paneId);
    if (cy == null) return null;
    const fs = SIZE_PX2[this.text?.size ?? "normal"] ?? 14;
    const lines = this.labelText().split("\n");
    const cols = Math.max(1, ...lines.map((l) => l.length));
    const w = Math.max(20, cols * fs * 0.6) + 16;
    const h = lines.length * fs * 1.4 + 12;
    return { x: proj.xOf(c.time) - w / 2, y: cy - h / 2, w, h };
  }
  /** The target tip + box-center pixels (drives the painter, hit-test, and the tip handle). */
  points(proj) {
    const t = this.anchors[0];
    const c = this.anchors[1];
    if (!t || !c) return null;
    const ty = proj.yOf(t.price, this.paneId);
    const cy = proj.yOf(c.price, this.paneId);
    if (ty == null || cy == null) return null;
    return [
      [proj.xOf(t.time), ty],
      [proj.xOf(c.time), cy]
    ];
  }
  hitTest(px, py, proj, tol) {
    const b = this.box(proj);
    if (b && pointInBox(px, py, b.x, b.y, b.x + b.w, b.y + b.h, tol)) return true;
    const p = this.points(proj);
    return p != null && distToSegment(px, py, p[0][0], p[0][1], p[1][0], p[1][1]) <= tol;
  }
  /** Only the pointer tip is a draggable handle — the box is moved by dragging its body, so no
   *  handle dot sits over the text. */
  handlePoints(proj) {
    const p = this.points(proj);
    return p ? [p[0]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  /** A body drag moves only the box; the pointer tip stays pinned at its target. */
  translateBody(dt, dp, orig) {
    const t = orig[0];
    const b = orig[1];
    if (!t || !b) return orig.map((o) => ({ time: o.time + dt, price: o.price + dp }));
    return [
      { time: t.time, price: t.price },
      { time: b.time + dt, price: b.price + dp }
    ];
  }
  bounds(proj) {
    return this.box(proj);
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS], textIsContent: true };
  }
};

// src/core/drawings/types/Callout.ts
var Callout = class extends CalloutBase {
  constructor() {
    super(...arguments);
    this.type = "callout";
  }
};

// src/core/drawings/types/PriceNote.ts
var PriceNote = class extends CalloutBase {
  constructor() {
    super(...arguments);
    this.type = "pricenote";
  }
  defaultLabel() {
    return "";
  }
  /** Sized from the (approximate) pinned price string — the painter formats it precisely. */
  labelText() {
    const p = this.anchors[0]?.price;
    return p == null ? "0.00" : p.toFixed(2);
  }
  /** The label is the auto price, so expose only styling — not a `text.value` field. */
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS.filter((f) => f.path !== "text.value")] };
  }
};

// src/core/drawings/types/Comment.ts
var Comment = class extends CalloutBase {
  constructor() {
    super(...arguments);
    this.type = "comment";
  }
  defaultLabel() {
    return "Comment";
  }
};

// src/core/drawings/types/Signpost.ts
var Signpost = class extends CalloutBase {
  constructor() {
    super(...arguments);
    this.type = "signpost";
  }
  defaultLabel() {
    return "Signpost";
  }
};

// src/core/drawings/types/SegmentDrawing.ts
var SegmentDrawing = class extends Drawing {
  hitTest(px, py, proj, tol) {
    const g = this.geometry(proj);
    if (!g) return false;
    if (this.style.fillColor && g.fill && pointInPolygon(px, py, g.fill)) return true;
    return g.segments.some((s) => distToSegment(px, py, s[0], s[1], s[2], s[3]) <= tol);
  }
  handlePoints(proj) {
    const pts = [];
    for (const a of this.anchors) {
      const y = proj.yOf(a.price, this.paneId);
      if (y == null) return [];
      pts.push([proj.xOf(a.time), y]);
    }
    return pts;
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const pts = this.handlePoints(proj);
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
};

// src/core/drawings/types/ParallelChannel.ts
var ParallelChannel = class extends SegmentDrawing {
  constructor() {
    super(...arguments);
    this.type = "parallelchannel";
  }
  anchorSchema() {
    return {
      min: 3,
      max: 3,
      slots: [
        { role: "p1", free: "both" },
        { role: "p2", free: "both" },
        { role: "offset", free: "y" }
        // width only — drag the midpoint handle vertically
      ]
    };
  }
  /** Price delta of the parallel line from the baseline, measured at the midpoint. */
  offset() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    const c = this.anchors[2];
    if (!a || !b || !c) return 0;
    return c.price - (a.price + b.price) / 2;
  }
  /** Handles: the two baseline ends + the offset handle ON the parallel line at the midpoint. */
  handlePoints(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return [];
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    if (ya == null || yb == null) return [];
    const pts = [
      [proj.xOf(a.time), ya],
      [proj.xOf(b.time), yb]
    ];
    const c = this.anchors[2];
    if (c) {
      const yc = proj.yOf(c.price, this.paneId);
      if (yc != null) pts.push([proj.xOf((a.time + b.time) / 2), yc]);
    }
    return pts;
  }
  /** The channel spans the baseline's time only (the offset anchor's time is ignored). */
  timeExtent() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.time, b.time), max: Math.max(a.time, b.time) };
  }
  geometry(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const d = this.offset();
    const xa = proj.xOf(a.time);
    const xb = proj.xOf(b.time);
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    const ya2 = proj.yOf(a.price + d, this.paneId);
    const yb2 = proj.yOf(b.price + d, this.paneId);
    if (ya == null || yb == null || ya2 == null || yb2 == null) return null;
    return {
      segments: [
        [xa, ya, xb, yb],
        [xa, ya2, xb, yb2]
      ],
      fill: [
        [xa, ya],
        [xb, yb],
        [xb, yb2],
        [xa, ya2]
      ]
    };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const d = this.offset();
    const prices = [a.price, b.price, a.price + d, b.price + d];
    const c = this.anchors[2];
    if (c) prices.push(c.price);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/DisjointChannel.ts
var DisjointChannel = class extends SegmentDrawing {
  constructor() {
    super(...arguments);
    this.type = "disjointchannel";
  }
  anchorSchema() {
    return {
      min: 4,
      max: 4,
      slots: [
        { role: "top1", free: "both" },
        { role: "top2", free: "both" },
        { role: "bot1", free: "both" },
        { role: "bot2", free: "both" }
      ]
    };
  }
  seg(i, j, proj) {
    const a = this.anchors[i];
    const b = this.anchors[j];
    if (!a || !b) return null;
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    if (ya == null || yb == null) return null;
    return [proj.xOf(a.time), ya, proj.xOf(b.time), yb];
  }
  geometry(proj) {
    const top = this.seg(0, 1, proj);
    const bot = this.seg(2, 3, proj);
    const segments = [top, bot].filter((s) => s != null);
    if (segments.length === 0) return null;
    const fill = top && bot ? [
      [top[0], top[1]],
      [top[2], top[3]],
      [bot[2], bot[3]],
      [bot[0], bot[1]]
    ] : null;
    return { segments, fill };
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((a) => a.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/FlatTopBottom.ts
var FlatTopBottom = class extends SegmentDrawing {
  constructor() {
    super(...arguments);
    this.type = "flattopbottom";
  }
  anchorSchema() {
    return {
      min: 3,
      max: 3,
      slots: [
        { role: "p1", free: "both" },
        { role: "p2", free: "both" },
        { role: "flat", free: "y" }
        // only the flat side's price matters
      ]
    };
  }
  /** Handles: the two baseline ends + the flat-side handle at the baseline midpoint. */
  handlePoints(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return [];
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    if (ya == null || yb == null) return [];
    const pts = [
      [proj.xOf(a.time), ya],
      [proj.xOf(b.time), yb]
    ];
    const c = this.anchors[2];
    if (c) {
      const yc = proj.yOf(c.price, this.paneId);
      if (yc != null) pts.push([proj.xOf((a.time + b.time) / 2), yc]);
    }
    return pts;
  }
  /** The channel spans the baseline's time only (the flat anchor's time is ignored). */
  timeExtent() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.time, b.time), max: Math.max(a.time, b.time) };
  }
  geometry(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const xa = proj.xOf(a.time);
    const xb = proj.xOf(b.time);
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    if (ya == null || yb == null) return null;
    const c = this.anchors[2];
    if (!c) return { segments: [[xa, ya, xb, yb]], fill: null };
    const flatY = proj.yOf(c.price, this.paneId);
    if (flatY == null) return null;
    return {
      segments: [
        [xa, ya, xb, yb],
        // sloped side
        [xa, flatY, xb, flatY]
        // flat side (constant price)
      ],
      fill: [
        [xa, ya],
        [xb, yb],
        [xb, flatY],
        [xa, flatY]
      ]
    };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const prices = [a.price, b.price];
    const c = this.anchors[2];
    if (c) prices.push(c.price);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/RegressionChannel.ts
var DEVIATIONS = 2;
function defaultRegressionStyle() {
  return {
    midColor: NEUTRAL,
    // neutral gray midline
    midStyle: "solid",
    upperColor: BULLISH,
    upperStyle: "solid",
    lowerColor: BEARISH,
    lowerStyle: "solid",
    upperFill: `${BULLISH}26`,
    // translucent, mid → upper
    lowerFill: `${BEARISH}26`,
    // translucent, mid → lower
    showR2: true
  };
}
function computeRegressionFit(bars) {
  const n = bars.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (let i = 0; i < n; i += 1) {
    const y = bars[i].close;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
    sumYY += y * y;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  let sse = 0;
  for (let i = 0; i < n; i += 1) {
    const resid = bars[i].close - (intercept + slope * i);
    sse += resid * resid;
  }
  const sigma = Math.sqrt(sse / n);
  const den = Math.sqrt(denom * (n * sumYY - sumY * sumY));
  const r = den === 0 ? 0 : (n * sumXY - sumX * sumY) / den;
  return {
    t0: bars[0].time,
    t1: bars[n - 1].time,
    mid0: intercept,
    mid1: intercept + slope * (n - 1),
    dev: DEVIATIONS * sigma,
    r2: Math.max(0, Math.min(1, r * r)),
    n
  };
}
var RegressionChannel = class extends Drawing {
  constructor(init) {
    super(init);
    this.type = "regressionchannel";
    /** Last computed price span (midline ± band), cached so autoscale's `priceRange()`
     *  — which gets no projector — can fold the channel in without recomputing. */
    this.cachedRange = null;
    if (!this.reg) this.reg = defaultRegressionStyle();
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "start", free: "x" }, { role: "end", free: "x" }] };
  }
  /** Fit against the bars in the anchor time-range, caching the price span for autoscale. */
  fit(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const from = Math.min(a.time, b.time);
    const to = Math.max(a.time, b.time);
    const bars = proj.barsInRange?.(from, to) ?? null;
    const f = bars ? computeRegressionFit(bars) : null;
    if (f) {
      this.cachedRange = { min: Math.min(f.mid0, f.mid1) - f.dev, max: Math.max(f.mid0, f.mid1) + f.dev };
    }
    return f;
  }
  /** Resolve the fit to pixel geometry for the painter + hit-test. */
  layout(proj) {
    const f = this.fit(proj);
    if (!f) return null;
    const midY0 = proj.yOf(f.mid0, this.paneId);
    const midY1 = proj.yOf(f.mid1, this.paneId);
    const upperY0 = proj.yOf(f.mid0 + f.dev, this.paneId);
    const upperY1 = proj.yOf(f.mid1 + f.dev, this.paneId);
    const lowerY0 = proj.yOf(f.mid0 - f.dev, this.paneId);
    const lowerY1 = proj.yOf(f.mid1 - f.dev, this.paneId);
    if (midY0 == null || midY1 == null || upperY0 == null || upperY1 == null || lowerY0 == null || lowerY1 == null) return null;
    return {
      x0: proj.xOf(f.t0),
      x1: proj.xOf(f.t1),
      midY0,
      midY1,
      upperY0,
      upperY1,
      lowerY0,
      lowerY1,
      r2: f.r2,
      showR2: this.reg.showR2
    };
  }
  /** The band outline polygon (upper edge left→right, then lower edge right→left). */
  band(proj) {
    const L = this.layout(proj);
    if (!L) return null;
    return [
      [L.x0, L.upperY0],
      [L.x1, L.upperY1],
      [L.x1, L.lowerY1],
      [L.x0, L.lowerY0]
    ];
  }
  hitTest(px, py, proj, tol) {
    const L = this.layout(proj);
    if (!L) return false;
    const poly = [
      [L.x0, L.upperY0],
      [L.x1, L.upperY1],
      [L.x1, L.lowerY1],
      [L.x0, L.lowerY0]
    ];
    if (pointInPolygon(px, py, poly)) return true;
    const lines = [
      [L.x0, L.midY0, L.x1, L.midY1],
      [L.x0, L.upperY0, L.x1, L.upperY1],
      [L.x0, L.lowerY0, L.x1, L.lowerY1]
    ];
    return lines.some((s) => distToSegment(px, py, s[0], s[1], s[2], s[3]) <= tol);
  }
  handlePoints(proj) {
    const L = this.layout(proj);
    if (L) return [[L.x0, L.midY0], [L.x1, L.midY1]];
    const pts = [];
    for (const a of this.anchors) {
      const y = proj.yOf(a.price, this.paneId);
      if (y == null) return [];
      pts.push([proj.xOf(a.time), y]);
    }
    return pts;
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const poly = this.band(proj);
    if (!poly) return null;
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  priceRange() {
    if (this.cachedRange) return this.cachedRange;
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return {
      fields: [
        { path: "reg.midColor", label: "Midline color", kind: "color", group: "line" },
        { path: "reg.midStyle", label: "Midline style", kind: "lineStyle", group: "line" },
        { path: "reg.upperColor", label: "Upper line color", kind: "color", group: "line" },
        { path: "reg.upperStyle", label: "Upper line style", kind: "lineStyle", group: "line" },
        { path: "reg.lowerColor", label: "Lower line color", kind: "color", group: "line" },
        { path: "reg.lowerStyle", label: "Lower line style", kind: "lineStyle", group: "line" },
        { path: "reg.upperFill", label: "Upper fill", kind: "color", group: "fill" },
        { path: "reg.lowerFill", label: "Lower fill", kind: "color", group: "fill" },
        { path: "reg.showR2", label: "Show R\xB2", kind: "boolean", group: "behavior" }
      ]
    };
  }
  writeProps() {
    return { ...this.reg };
  }
  readProps(props) {
    this.reg = { ...defaultRegressionStyle(), ...props };
  }
};

// src/core/drawings/types/AnchoredVwap.ts
var TRANSPARENT_BAND = `${INFO}00`;
function defaultVwapStyle() {
  return {
    midColor: INFO,
    // VWAP midline (opaque)
    midStyle: "solid",
    multiplier: 1,
    upperColor: TRANSPARENT_BAND,
    // band edges hidden by default
    upperStyle: "solid",
    lowerColor: TRANSPARENT_BAND,
    lowerStyle: "solid",
    bandFill: `${INFO}33`
    // band hue at ~20% opacity
  };
}
function computeVwap(bars, mult) {
  const n = bars.length;
  if (n < 1) return null;
  let totalVol = 0;
  for (const b of bars) totalVol += b.volume > 0 ? b.volume : 0;
  const useVol = totalVol > 0;
  let cumW = 0;
  let cumPV = 0;
  let cumP2V = 0;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const b = bars[i];
    const tp = (b.high + b.low + b.close) / 3;
    const w = useVol ? Math.max(0, b.volume) : 1;
    cumW += w;
    cumPV += tp * w;
    cumP2V += tp * tp * w;
    const mid = cumW > 0 ? cumPV / cumW : tp;
    const variance = cumW > 0 ? Math.max(0, cumP2V / cumW - mid * mid) : 0;
    const dev = Math.sqrt(variance) * mult;
    out.push({ time: b.time, mid, upper: mid + dev, lower: mid - dev });
  }
  return out;
}
var AnchoredVwap = class extends Drawing {
  constructor(init) {
    super(init);
    this.type = "anchoredvwap";
    /** Last computed price span (min lower … max upper), cached so autoscale's `priceRange()`
     *  — which gets no projector — folds the curve in without recomputing. */
    this.cachedRange = null;
    /** Last computed time span (anchor bar … last bar), cached for `timeExtent()` culling. */
    this.cachedExtent = null;
    if (!this.vwap) this.vwap = defaultVwapStyle();
  }
  anchorSchema() {
    return { min: 1, max: 1, slots: [{ role: "anchor", free: "x" }] };
  }
  /** Compute the VWAP samples from the anchor time forward, caching the price + time spans. */
  series(proj) {
    const a = this.anchors[0];
    if (!a) return null;
    const bars = proj.barsInRange?.(a.time, Number.POSITIVE_INFINITY) ?? null;
    if (!bars || bars.length < 1) return null;
    const pts = computeVwap(
      bars.map((b) => ({ time: b.time, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 })),
      this.vwap.multiplier
    );
    if (pts && pts.length > 0) {
      let min = Infinity;
      let max = -Infinity;
      for (const p of pts) {
        if (p.lower < min) min = p.lower;
        if (p.upper > max) max = p.upper;
      }
      this.cachedRange = { min, max };
      this.cachedExtent = { min: pts[0].time, max: pts[pts.length - 1].time };
    }
    return pts;
  }
  /** Resolve the samples to pixel polylines for the painter + hit-test. */
  layout(proj) {
    const pts = this.series(proj);
    if (!pts) return null;
    const mid = [];
    const upper = [];
    const lower = [];
    for (const p of pts) {
      const x = proj.xOf(p.time);
      const my = proj.yOf(p.mid, this.paneId);
      const uy = proj.yOf(p.upper, this.paneId);
      const ly = proj.yOf(p.lower, this.paneId);
      if (my == null || uy == null || ly == null) continue;
      mid.push([x, my]);
      upper.push([x, uy]);
      lower.push([x, ly]);
    }
    return mid.length > 0 ? { mid, upper, lower } : null;
  }
  /** The band outline polygon (upper edge left→right, then lower edge right→left). */
  bandPolygon(L) {
    return [...L.upper, ...[...L.lower].reverse()];
  }
  hitTest(px, py, proj, tol) {
    const L = this.layout(proj);
    if (!L) return false;
    if (pointInPolygon(px, py, this.bandPolygon(L))) return true;
    return polylineHit(px, py, L.mid, tol) || polylineHit(px, py, L.upper, tol) || polylineHit(px, py, L.lower, tol);
  }
  handlePoints(proj) {
    const L = this.layout(proj);
    if (L && L.mid.length > 0) return [L.mid[0]];
    const a = this.anchors[0];
    if (!a) return [];
    const y = proj.yOf(a.price, this.paneId);
    return y == null ? [] : [[proj.xOf(a.time), y]];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const L = this.layout(proj);
    if (!L) return null;
    const pts = [...L.upper, ...L.lower];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  priceRange() {
    return this.cachedRange;
  }
  /** Spans anchor→last-bar (cached from the last compute); null before the first paint so it
   *  isn't culled from autoscale prematurely. */
  timeExtent() {
    return this.cachedExtent;
  }
  schema() {
    return {
      fields: [
        { path: "vwap.midColor", label: "VWAP color", kind: "color", group: "line" },
        { path: "vwap.midStyle", label: "VWAP style", kind: "lineStyle", group: "line" },
        { path: "vwap.multiplier", label: "Band multiplier", kind: "number", min: 0.5, max: 5, step: 0.5, group: "behavior" },
        { path: "vwap.upperColor", label: "Upper band color", kind: "color", group: "line" },
        { path: "vwap.lowerColor", label: "Lower band color", kind: "color", group: "line" },
        { path: "vwap.bandFill", label: "Band fill", kind: "color", group: "fill" }
      ]
    };
  }
  writeProps() {
    return { ...this.vwap };
  }
  readProps(props) {
    this.vwap = { ...defaultVwapStyle(), ...props };
  }
};
function polylineHit(px, py, pts, tol) {
  for (let i = 1; i < pts.length; i += 1) {
    if (distToSegment(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= tol) return true;
  }
  return false;
}

// src/core/drawings/types/FixedRangeVolumeProfile.ts
var OUTSIDE_UP = `${BULLISH}66`;
var OUTSIDE_DOWN = `${BEARISH}66`;
var VA_UP = `${BULLISH}BF`;
var VA_DOWN = `${BEARISH}BF`;
function defaultFrvpStyle() {
  return {
    rows: 24,
    valueAreaPct: 70,
    widthPct: 35,
    anchor: "left",
    upColor: OUTSIDE_UP,
    downColor: OUTSIDE_DOWN,
    vaUpColor: VA_UP,
    vaDownColor: VA_DOWN,
    showVah: true,
    vahColor: NEUTRAL,
    vahStyle: "solid",
    showVal: true,
    valColor: NEUTRAL,
    valStyle: "solid",
    showPoc: true,
    pocColor: void 0,
    // theme contrast ink until the user picks a color
    pocStyle: "solid",
    showDevelopingPoc: false,
    developingPocColor: ACCENT,
    developingPocStyle: "dotted",
    showDevelopingVa: false,
    developingVaColor: ACCENT,
    developingVaStyle: "dotted"
  };
}
function clampIndex(k, n) {
  return k < 0 ? 0 : k >= n ? n - 1 : k;
}
function growValueArea(rows, poc, valueAreaFrac) {
  const n = rows.length;
  let total = 0;
  let maxTotal = 0;
  for (let k = 0; k < n; k += 1) {
    const t = rows[k].up + rows[k].down;
    total += t;
    if (t > maxTotal) maxTotal = t;
  }
  const target = total * Math.min(1, Math.max(0, valueAreaFrac));
  let vaFrom = poc;
  let vaTo = poc;
  let acc = maxTotal;
  while (acc < target && (vaFrom > 0 || vaTo < n - 1)) {
    const below = vaFrom > 0 ? rows[vaFrom - 1].up + rows[vaFrom - 1].down : -1;
    const above = vaTo < n - 1 ? rows[vaTo + 1].up + rows[vaTo + 1].down : -1;
    if (above > below) {
      vaTo += 1;
      acc += above;
    } else {
      vaFrom -= 1;
      acc += below;
    }
  }
  return { vaFrom, vaTo };
}
function accumulateBar(rows, min, rowH, bar) {
  const v = bar.volume;
  if (!(v > 0)) return;
  const n = rows.length;
  const side = bar.close >= bar.open ? "up" : "down";
  const hit = /* @__PURE__ */ new Set();
  for (const p of [bar.open, bar.high, bar.low, bar.close]) {
    hit.add(clampIndex(Math.floor((p - min) / rowH), n));
  }
  for (const k of hit) rows[k][side] += v;
}
function findPoc(rows) {
  let maxTotal = 0;
  let poc = 0;
  for (let k = 0; k < rows.length; k += 1) {
    const t = rows[k].up + rows[k].down;
    if (t > maxTotal) {
      maxTotal = t;
      poc = k;
    }
  }
  return maxTotal > 0 ? { poc, maxTotal } : null;
}
function buildEstimatedProfile(bars, rowCount, valueAreaFrac) {
  let min = Infinity;
  let max = -Infinity;
  for (const b of bars) {
    if (!(b.volume > 0)) continue;
    if (b.low < min) min = b.low;
    if (b.high > max) max = b.high;
  }
  if (!Number.isFinite(min)) return null;
  const n = max > min ? Math.max(1, Math.round(rowCount)) : 1;
  const rowH = max > min ? (max - min) / n : 1;
  const rows = Array.from({ length: n }, (_, k) => ({ price: min + k * rowH, up: 0, down: 0 }));
  for (const b of bars) accumulateBar(rows, min, rowH, b);
  const pocInfo = findPoc(rows);
  if (!pocInfo) return null;
  const { poc, maxTotal } = pocInfo;
  const { vaFrom, vaTo } = growValueArea(rows, poc, valueAreaFrac);
  return { rows, rowH, min, maxTotal, poc, vaFrom, vaTo };
}
function computeFixedRangeProfile(bars, rowCount, valueAreaFrac, wantDeveloping) {
  const profile = buildEstimatedProfile(bars, rowCount, valueAreaFrac);
  if (!profile) return null;
  if (!wantDeveloping || bars.length < 1) {
    return { profile, developingPoc: [], developingVaHigh: [], developingVaLow: [] };
  }
  const { min, rowH } = profile;
  const n = profile.rows.length;
  const rows = Array.from({ length: n }, (_, k) => ({ price: min + k * rowH, up: 0, down: 0 }));
  const developingPoc = [];
  const developingVaHigh = [];
  const developingVaLow = [];
  for (const bar of bars) {
    accumulateBar(rows, min, rowH, bar);
    const pocInfo = findPoc(rows);
    if (!pocInfo) continue;
    const { poc } = pocInfo;
    const { vaFrom, vaTo } = growValueArea(rows, poc, valueAreaFrac);
    developingPoc.push({ time: bar.time, price: rows[poc].price + rowH / 2 });
    developingVaHigh.push({ time: bar.time, price: rows[vaTo].price + rowH });
    developingVaLow.push({ time: bar.time, price: rows[vaFrom].price });
  }
  return { profile, developingPoc, developingVaHigh, developingVaLow };
}
var FixedRangeVolumeProfile = class extends Drawing {
  constructor(init) {
    super(init);
    this.type = "fixedrangevp";
    this.cachedRange = null;
    if (!this.frvp) this.frvp = defaultFrvpStyle();
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "start", free: "x" }, { role: "end", free: "x" }] };
  }
  /** Bars in the anchor time-range (inclusive), or null when either anchor / feed is missing. */
  barsInSpan(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const from = Math.min(a.time, b.time);
    const to = Math.max(a.time, b.time);
    const raw = proj.barsInRange?.(from, to) ?? null;
    if (!raw || raw.length < 1) return null;
    return raw.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume ?? 0
    }));
  }
  /** Compute the profile (+ developing series when enabled), caching the price span for autoscale. */
  compute(proj) {
    const bars = this.barsInSpan(proj);
    if (!bars) return null;
    const s = this.frvp;
    const wantDev = s.showDevelopingPoc || s.showDevelopingVa;
    const result = computeFixedRangeProfile(bars, s.rows, s.valueAreaPct / 100, wantDev);
    if (result) {
      const { profile } = result;
      this.cachedRange = {
        min: profile.min,
        max: profile.min + profile.rowH * profile.rows.length
      };
    }
    return result;
  }
  /** Resolve the compute to pixel geometry for the painter + hit-test. */
  layout(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const computed = this.compute(proj);
    if (!computed) return null;
    const { profile } = computed;
    const t0 = Math.min(a.time, b.time);
    const t1 = Math.max(a.time, b.time);
    const x0 = proj.xOf(t0);
    const x1 = proj.xOf(t1);
    const spanW = Math.abs(x1 - x0);
    const maxW = Math.max(1, Math.min(100, Math.max(0, this.frvp.widthPct)) / 100 * spanW);
    const growRight = this.frvp.anchor === "left";
    const anchorX = growRight ? Math.min(x0, x1) : Math.max(x0, x1);
    const grow = growRight ? 1 : -1;
    const yEdges = [];
    for (let k = 0; k <= profile.rows.length; k += 1) {
      const y = proj.yOf(profile.min + k * profile.rowH, this.paneId);
      if (y == null) return null;
      yEdges.push(y);
    }
    const yAt = (price) => proj.yOf(price, this.paneId);
    const vahPrice = profile.rows[profile.vaTo].price + profile.rowH;
    const valPrice = profile.rows[profile.vaFrom].price;
    const pocPrice = profile.rows[profile.poc].price + profile.rowH / 2;
    const toPoly = (pts) => {
      const out = [];
      for (const p of pts) {
        const y = yAt(p.price);
        if (y == null) continue;
        out.push([proj.xOf(p.time), y]);
      }
      return out;
    };
    return {
      x0: Math.min(x0, x1),
      x1: Math.max(x0, x1),
      anchorX,
      maxW,
      grow,
      profile,
      yEdges,
      vahY: yAt(vahPrice),
      valY: yAt(valPrice),
      pocY: yAt(pocPrice),
      developingPoc: toPoly(computed.developingPoc),
      developingVaHigh: toPoly(computed.developingVaHigh),
      developingVaLow: toPoly(computed.developingVaLow)
    };
  }
  hitTest(px, py, proj, tol) {
    const L = this.layout(proj);
    if (!L) return false;
    const left = L.grow === 1 ? L.anchorX : L.anchorX - L.maxW;
    const right = L.grow === 1 ? L.anchorX + L.maxW : L.anchorX;
    const yLo = Math.min(L.yEdges[0], L.yEdges[L.yEdges.length - 1]);
    const yHi = Math.max(L.yEdges[0], L.yEdges[L.yEdges.length - 1]);
    if (pointInPolygon(px, py, [
      [left, yLo],
      [right, yLo],
      [right, yHi],
      [left, yHi]
    ])) return true;
    const hLines = [
      [L.x0, L.vahY],
      [L.x0, L.valY],
      [L.x0, L.pocY]
    ];
    for (const [, y] of hLines) {
      if (y != null && distToSegment(px, py, L.x0, y, L.x1, y) <= tol) return true;
    }
    for (const poly of [L.developingPoc, L.developingVaHigh, L.developingVaLow]) {
      for (let i = 1; i < poly.length; i += 1) {
        if (distToSegment(px, py, poly[i - 1][0], poly[i - 1][1], poly[i][0], poly[i][1]) <= tol) return true;
      }
    }
    return false;
  }
  handlePoints(proj) {
    const L = this.layout(proj);
    if (L && L.pocY != null) return [[L.x0, L.pocY], [L.x1, L.pocY]];
    const pts = [];
    for (const a of this.anchors) {
      const y = proj.yOf(a.price, this.paneId);
      if (y == null) return [];
      pts.push([proj.xOf(a.time), y]);
    }
    return pts;
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const L = this.layout(proj);
    if (!L) return null;
    const left = Math.min(L.x0, L.grow === 1 ? L.anchorX : L.anchorX - L.maxW);
    const right = Math.max(L.x1, L.grow === 1 ? L.anchorX + L.maxW : L.anchorX);
    const yLo = Math.min(L.yEdges[0], L.yEdges[L.yEdges.length - 1]);
    const yHi = Math.max(L.yEdges[0], L.yEdges[L.yEdges.length - 1]);
    return { x: left, y: yLo, w: right - left, h: yHi - yLo };
  }
  priceRange() {
    if (this.cachedRange) return this.cachedRange;
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return {
      fields: [
        { path: "frvp.rows", label: "Rows", kind: "number", min: 1, max: 500, step: 1, group: "behavior" },
        { path: "frvp.valueAreaPct", label: "Value Area", kind: "number", min: 0, max: 100, step: 1, group: "behavior" },
        { path: "frvp.widthPct", label: "Width %", kind: "number", min: 0, max: 100, step: 1, group: "behavior" },
        {
          path: "frvp.anchor",
          label: "Anchor",
          kind: "select",
          options: [
            { value: "right", label: "Right" },
            { value: "left", label: "Left" }
          ],
          group: "behavior"
        },
        { path: "frvp.upColor", label: "Up Volume", kind: "color", group: "fill" },
        { path: "frvp.downColor", label: "Down Volume", kind: "color", group: "fill" },
        { path: "frvp.vaUpColor", label: "Value Area Up", kind: "color", group: "fill" },
        { path: "frvp.vaDownColor", label: "Value Area Down", kind: "color", group: "fill" },
        { path: "frvp.showVah", label: "VAH", kind: "boolean", group: "line" },
        { path: "frvp.vahColor", label: "VAH color", kind: "color", group: "line" },
        { path: "frvp.vahStyle", label: "VAH style", kind: "lineStyle", options: LINE_STYLE_OPTIONS, group: "line" },
        { path: "frvp.showVal", label: "VAL", kind: "boolean", group: "line" },
        { path: "frvp.valColor", label: "VAL color", kind: "color", group: "line" },
        { path: "frvp.valStyle", label: "VAL style", kind: "lineStyle", options: LINE_STYLE_OPTIONS, group: "line" },
        { path: "frvp.showPoc", label: "POC", kind: "boolean", group: "line" },
        { path: "frvp.pocColor", label: "POC color", kind: "color", group: "line" },
        { path: "frvp.pocStyle", label: "POC style", kind: "lineStyle", options: LINE_STYLE_OPTIONS, group: "line" },
        { path: "frvp.showDevelopingPoc", label: "Developing POC", kind: "boolean", group: "line" },
        { path: "frvp.developingPocColor", label: "Developing POC color", kind: "color", group: "line" },
        { path: "frvp.developingPocStyle", label: "Developing POC style", kind: "lineStyle", options: LINE_STYLE_OPTIONS, group: "line" },
        { path: "frvp.showDevelopingVa", label: "Developing VA", kind: "boolean", group: "line" },
        { path: "frvp.developingVaColor", label: "Developing VA color", kind: "color", group: "line" },
        { path: "frvp.developingVaStyle", label: "Developing VA style", kind: "lineStyle", options: LINE_STYLE_OPTIONS, group: "line" }
      ]
    };
  }
  writeProps() {
    return { ...this.frvp };
  }
  readProps(props) {
    this.frvp = { ...defaultFrvpStyle(), ...props };
  }
};

// src/core/drawings/types/Pitchfork.ts
var Pitchfork = class extends SegmentDrawing {
  constructor() {
    super(...arguments);
    this.type = "pitchfork";
  }
  anchorSchema() {
    return {
      min: 3,
      max: 3,
      slots: [
        { role: "pivot", free: "both" },
        { role: "upper", free: "both" },
        { role: "lower", free: "both" }
      ]
    };
  }
  geometry(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const px = (p) => {
      const y = proj.yOf(p.price, this.paneId);
      return y == null ? null : [proj.xOf(p.time), y];
    };
    const P0 = px(a);
    const P1 = px(b);
    if (!P0 || !P1) return null;
    const c = this.anchors[2];
    if (!c) return { segments: [[P0[0], P0[1], P1[0], P1[1]]], fill: null };
    const P2 = px(c);
    if (!P2) return null;
    const mx = (P1[0] + P2[0]) / 2;
    const my = (P1[1] + P2[1]) / 2;
    const dx = mx - P0[0];
    const dy = my - P0[1];
    const w = proj.width;
    const h = proj.height;
    return {
      segments: [
        extendRay(P0[0], P0[1], mx, my, "right", w, h),
        // median
        extendRay(P1[0], P1[1], P1[0] + dx, P1[1] + dy, "right", w, h),
        // upper tine
        extendRay(P2[0], P2[1], P2[0] + dx, P2[1] + dy, "right", w, h),
        // lower tine
        [P1[0], P1[1], P2[0], P2[1]]
        // base line p2–p3
      ],
      fill: null
    };
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((p) => p.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/PitchforkVariant.ts
var PitchforkVariant = class extends SegmentDrawing {
  anchorSchema() {
    return {
      min: 3,
      max: 3,
      slots: [
        { role: "pivot", free: "both" },
        { role: "upper", free: "both" },
        { role: "lower", free: "both" }
      ]
    };
  }
  geometry(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const px = (p) => {
      const y = proj.yOf(p.price, this.paneId);
      return y == null ? null : [proj.xOf(p.time), y];
    };
    const P0 = px(a);
    const P1 = px(b);
    if (!P0 || !P1) return null;
    const c = this.anchors[2];
    if (!c) return { segments: [[P0[0], P0[1], P1[0], P1[1]]], fill: null };
    const S = px(this.medianStart(a, b, c));
    const P2 = px(c);
    if (!S || !P2) return null;
    const mx = (P1[0] + P2[0]) / 2;
    const my = (P1[1] + P2[1]) / 2;
    const dx = mx - S[0];
    const dy = my - S[1];
    const w = proj.width;
    const h = proj.height;
    return {
      segments: [
        extendRay(S[0], S[1], mx, my, "right", w, h),
        // median
        extendRay(P1[0], P1[1], P1[0] + dx, P1[1] + dy, "right", w, h),
        // upper tine
        extendRay(P2[0], P2[1], P2[0] + dx, P2[1] + dy, "right", w, h),
        // lower tine
        [P1[0], P1[1], P2[0], P2[1]],
        // base line
        // The median leaves from the shifted origin, not the pivot — without this construction
        // line the pivot handle would float unattached to the shape it defines.
        [P0[0], P0[1], P1[0], P1[1]]
        // pivot → first tine anchor
      ],
      fill: null
    };
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((p) => p.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/SchiffPitchfork.ts
var SchiffPitchfork = class extends PitchforkVariant {
  constructor() {
    super(...arguments);
    this.type = "schiffpitchfork";
  }
  medianStart(p0, p1) {
    return { time: p0.time, price: (p0.price + p1.price) / 2 };
  }
};

// src/core/drawings/types/ModifiedSchiffPitchfork.ts
var ModifiedSchiffPitchfork = class extends PitchforkVariant {
  constructor() {
    super(...arguments);
    this.type = "modifiedschiffpitchfork";
  }
  medianStart(p0, p1) {
    return { time: (p0.time + p1.time) / 2, price: (p0.price + p1.price) / 2 };
  }
};

// src/core/drawings/types/InsidePitchfork.ts
var InsidePitchfork = class extends SegmentDrawing {
  constructor() {
    super(...arguments);
    this.type = "insidepitchfork";
  }
  anchorSchema() {
    return {
      min: 3,
      max: 3,
      slots: [
        { role: "pivot", free: "both" },
        { role: "upper", free: "both" },
        { role: "lower", free: "both" }
      ]
    };
  }
  geometry(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const px = (p) => {
      const y = proj.yOf(p.price, this.paneId);
      return y == null ? null : [proj.xOf(p.time), y];
    };
    const P0 = px(a);
    const P1 = px(b);
    if (!P0 || !P1) return null;
    const c = this.anchors[2];
    if (!c) return { segments: [[P0[0], P0[1], P1[0], P1[1]]], fill: null };
    const B = px({ time: (a.time + b.time) / 2, price: (a.price + b.price) / 2 });
    const P2 = px(c);
    if (!B || !P2) return null;
    const mx = (P1[0] + P2[0]) / 2;
    const my = (P1[1] + P2[1]) / 2;
    const dx = P2[0] - B[0];
    const dy = P2[1] - B[1];
    const w = proj.width;
    const h = proj.height;
    return {
      segments: [
        extendRay(mx, my, mx + dx, my + dy, "right", w, h),
        // median through M
        extendRay(P1[0], P1[1], P1[0] + dx, P1[1] + dy, "right", w, h),
        // upper tine
        extendRay(P2[0], P2[1], P2[0] + dx, P2[1] + dy, "right", w, h),
        // lower tine
        [P1[0], P1[1], P2[0], P2[1]],
        // base line
        [B[0], B[1], P2[0], P2[1]],
        // construction: modified base → p3
        [P0[0], P0[1], P1[0], P1[1]]
        // construction: the back trend line p1 → p2
      ],
      fill: null
    };
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((p) => p.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/Arrow.ts
var Arrow = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "arrow";
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "p1", free: "both" }, { role: "p2", free: "both" }] };
  }
  pixels(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const y1 = proj.yOf(a.price, this.paneId);
    const y2 = proj.yOf(b.price, this.paneId);
    if (y1 == null || y2 == null) return null;
    return [proj.xOf(a.time), y1, proj.xOf(b.time), y2];
  }
  hitTest(px, py, proj, tol) {
    const p = this.pixels(proj);
    return p != null && distToSegment(px, py, p[0], p[1], p[2], p[3]) <= tol;
  }
  handlePoints(proj) {
    const p = this.pixels(proj);
    return p ? [[p[0], p[1]], [p[2], p[3]]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const p = this.pixels(proj);
    if (!p) return null;
    return { x: Math.min(p[0], p[2]), y: Math.min(p[1], p[3]), w: Math.abs(p[2] - p[0]), h: Math.abs(p[3] - p[1]) };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return {
      fields: [
        ...LINE_FIELDS,
        { path: "style.arrowRight", label: "Head (end)", kind: "boolean", group: "line" },
        { path: "style.arrowLeft", label: "Head (start)", kind: "boolean", group: "line" },
        ...TEXT_FIELDS
      ]
    };
  }
};

// src/core/drawings/types/Ellipse.ts
var PERIM_SAMPLES = 48;
var Ellipse = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "ellipse";
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "c1", free: "both" }, { role: "c2", free: "both" }] };
  }
  oval(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    if (ya == null || yb == null) return null;
    const xa = proj.xOf(a.time);
    const xb = proj.xOf(b.time);
    return { cx: (xa + xb) / 2, cy: (ya + yb) / 2, rx: Math.abs(xb - xa) / 2, ry: Math.abs(yb - ya) / 2 };
  }
  perimeter(o) {
    const pts = [];
    for (let i = 0; i <= PERIM_SAMPLES; i += 1) {
      const t = i / PERIM_SAMPLES * Math.PI * 2;
      pts.push([o.cx + o.rx * Math.cos(t), o.cy + o.ry * Math.sin(t)]);
    }
    return pts;
  }
  hitTest(px, py, proj, tol) {
    const o = this.oval(proj);
    if (!o || o.rx < 1 || o.ry < 1) return false;
    const f = ((px - o.cx) / o.rx) ** 2 + ((py - o.cy) / o.ry) ** 2;
    if (this.style.fillColor && f <= 1) return true;
    return distToPolyline(px, py, this.perimeter(o)) <= tol;
  }
  handlePoints(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return [];
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    if (ya == null || yb == null) return [];
    return [[proj.xOf(a.time), ya], [proj.xOf(b.time), yb]];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const o = this.oval(proj);
    if (!o) return null;
    return { x: o.cx - o.rx, y: o.cy - o.ry, w: o.rx * 2, h: o.ry * 2 };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/Triangle.ts
var Triangle = class extends SegmentDrawing {
  constructor() {
    super(...arguments);
    this.type = "triangle";
  }
  anchorSchema() {
    return {
      min: 3,
      max: 3,
      slots: [
        { role: "v1", free: "both" },
        { role: "v2", free: "both" },
        { role: "v3", free: "both" }
      ]
    };
  }
  geometry(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const px = (p) => {
      const y = proj.yOf(p.price, this.paneId);
      return y == null ? null : [proj.xOf(p.time), y];
    };
    const A = px(a);
    const B = px(b);
    if (!A || !B) return null;
    const c = this.anchors[2];
    if (!c) return { segments: [[A[0], A[1], B[0], B[1]]], fill: null };
    const C = px(c);
    if (!C) return null;
    return {
      segments: [
        [A[0], A[1], B[0], B[1]],
        [B[0], B[1], C[0], C[1]],
        [C[0], C[1], A[0], A[1]]
      ],
      fill: [A, B, C]
    };
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((p) => p.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/PathDrawing.ts
var MAX_PATH_POINTS = 512;
var PathDrawing = class extends SegmentDrawing {
  anchorSchema() {
    return { min: 2, max: MAX_PATH_POINTS, slots: [] };
  }
  geometry(proj) {
    const pts = [];
    for (const a of this.anchors) {
      const y = proj.yOf(a.price, this.paneId);
      if (y == null) return null;
      pts.push([proj.xOf(a.time), y]);
    }
    if (pts.length < 2) return null;
    const segments = [];
    for (let i = 1; i < pts.length; i += 1) segments.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
    return { segments, fill: null };
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((a) => a.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/Polyline.ts
var Polyline = class extends PathDrawing {
  constructor() {
    super(...arguments);
    this.type = "polyline";
  }
};

// src/core/drawings/types/Freehand.ts
var BrushStroke = class extends PathDrawing {
  placementMode() {
    return "freehand";
  }
  handlePoints(_proj) {
    return [];
  }
  bounds(proj) {
    const xs = [];
    const ys = [];
    for (const a of this.anchors) {
      const y2 = proj.yOf(a.price, this.paneId);
      if (y2 == null) continue;
      xs.push(proj.xOf(a.time));
      ys.push(y2);
    }
    if (xs.length === 0) return null;
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
};
var Freehand = class extends BrushStroke {
  constructor() {
    super(...arguments);
    this.type = "freehand";
  }
};

// src/core/drawings/types/Highlighter.ts
var HIGHLIGHTER_FIELDS = [
  { path: "style.lineColor", label: "Color", kind: "color", group: "line" },
  { path: "style.lineWidth", label: "Width", kind: "number", min: 4, max: 60, step: 1, group: "line" }
];
var Highlighter = class extends BrushStroke {
  constructor() {
    super(...arguments);
    this.type = "highlighter";
  }
  schema() {
    return { fields: HIGHLIGHTER_FIELDS };
  }
};

// src/core/drawings/types/Circle.ts
var Circle = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "circle";
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "center", free: "both" }, { role: "edge", free: "both" }] };
  }
  geom(proj) {
    const c = this.anchors[0];
    const e = this.anchors[1];
    if (!c || !e) return null;
    const cy = proj.yOf(c.price, this.paneId);
    const ey = proj.yOf(e.price, this.paneId);
    if (cy == null || ey == null) return null;
    const cx = proj.xOf(c.time);
    const ex = proj.xOf(e.time);
    return { cx, cy, r: Math.hypot(ex - cx, ey - cy) };
  }
  hitTest(px, py, proj, tol) {
    const g = this.geom(proj);
    if (!g || g.r < 1) return false;
    const d = Math.hypot(px - g.cx, py - g.cy);
    if (this.style.fillColor && d <= g.r) return true;
    return Math.abs(d - g.r) <= tol;
  }
  handlePoints(proj) {
    const c = this.anchors[0];
    const e = this.anchors[1];
    if (!c || !e) return [];
    const cy = proj.yOf(c.price, this.paneId);
    const ey = proj.yOf(e.price, this.paneId);
    if (cy == null || ey == null) return [];
    return [[proj.xOf(c.time), cy], [proj.xOf(e.time), ey]];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const g = this.geom(proj);
    if (!g) return null;
    return { x: g.cx - g.r, y: g.cy - g.r, w: g.r * 2, h: g.r * 2 };
  }
  priceRange() {
    const c = this.anchors[0];
    const e = this.anchors[1];
    if (!c || !e) return null;
    return { min: Math.min(c.price, e.price), max: Math.max(c.price, e.price) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/RotatedRect.ts
var RotatedRect = class extends SegmentDrawing {
  constructor() {
    super(...arguments);
    this.type = "rotatedrect";
  }
  anchorSchema() {
    return { min: 3, max: 3, slots: [{ role: "p1", free: "both" }, { role: "p2", free: "both" }, { role: "w", free: "both" }] };
  }
  px(proj, i) {
    const a = this.anchors[i];
    if (!a) return null;
    const y = proj.yOf(a.price, this.paneId);
    return y == null ? null : [proj.xOf(a.time), y];
  }
  geometry(proj) {
    const A = this.px(proj, 0);
    const B = this.px(proj, 1);
    if (!A || !B) return null;
    const W = this.px(proj, 2);
    if (!W || this.anchors.length < 3) {
      return { segments: [[A[0], A[1], B[0], B[1]]], fill: null };
    }
    const vx = B[0] - A[0];
    const vy = B[1] - A[1];
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) return { segments: [[A[0], A[1], B[0], B[1]]], fill: null };
    const nx = -vy / len;
    const ny = vx / len;
    const h = (W[0] - A[0]) * nx + (W[1] - A[1]) * ny;
    const ox = nx * h;
    const oy = ny * h;
    const C0 = A;
    const C1 = B;
    const C2 = [B[0] + ox, B[1] + oy];
    const C3 = [A[0] + ox, A[1] + oy];
    return {
      segments: [
        [C0[0], C0[1], C1[0], C1[1]],
        [C1[0], C1[1], C2[0], C2[1]],
        [C2[0], C2[1], C3[0], C3[1]],
        [C3[0], C3[1], C0[0], C0[1]]
      ],
      fill: [C0, C1, C2, C3]
    };
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((a) => a.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  schema() {
    return { fields: [...LINE_FIELDS.map((f) => ({ ...f, label: f.label.replace("Line", "Border") })), ...FILL_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/Path.ts
var Path = class extends PathDrawing {
  constructor() {
    super(...arguments);
    this.type = "path";
  }
};

// src/core/drawings/types/Arc.ts
var ARC_SAMPLES = 40;
var Arc = class extends SegmentDrawing {
  constructor() {
    super(...arguments);
    this.type = "arc";
  }
  anchorSchema() {
    return { min: 3, max: 3, slots: [{ role: "p1", free: "both" }, { role: "p2", free: "both" }, { role: "apex", free: "both" }] };
  }
  pinApex() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    const apex = this.anchors[2];
    if (a && b && apex) apex.time = (a.time + b.time) / 2;
  }
  onPlaced() {
    this.pinApex();
  }
  constrainHandleDrag() {
    this.pinApex();
  }
  px(proj, i) {
    const a = this.anchors[i];
    if (!a) return null;
    const y = proj.yOf(a.price, this.paneId);
    return y == null ? null : [proj.xOf(a.time), y];
  }
  geometry(proj) {
    const A = this.px(proj, 0);
    const B = this.px(proj, 1);
    if (!A || !B) return null;
    const apex = this.anchors[2];
    if (!apex || this.anchors.length < 3) {
      return { segments: [[A[0], A[1], B[0], B[1]]], fill: null };
    }
    const ay = proj.yOf(apex.price, this.paneId);
    if (ay == null) return null;
    const Mx = (A[0] + B[0]) / 2;
    const My = (A[1] + B[1]) / 2;
    const hx = (B[0] - A[0]) / 2;
    const hy = (B[1] - A[1]) / 2;
    const len = Math.hypot(hx, hy);
    if (len < 1e-6) return { segments: [[A[0], A[1], B[0], B[1]]], fill: null };
    let nx = -hy / len;
    let ny = hx / len;
    const off = (ay - My) * ny;
    if (off < 0) {
      nx = -nx;
      ny = -ny;
    }
    const h = Math.abs(off);
    const pts = [];
    for (let i = 0; i <= ARC_SAMPLES; i += 1) {
      const t = i / ARC_SAMPLES * Math.PI;
      const c = Math.cos(t);
      const s = Math.sin(t);
      pts.push([Mx + c * hx + s * h * nx, My + c * hy + s * h * ny]);
    }
    const segments = [];
    for (let i = 1; i < pts.length; i += 1) segments.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
    segments.push([pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]]);
    return { segments, fill: pts };
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((a) => a.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  schema() {
    return { fields: [...LINE_FIELDS.map((f) => ({ ...f, label: f.label.replace("Line", "Border") })), ...FILL_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/Curve.ts
var CURVE_SAMPLES = 40;
var Curve = class extends SegmentDrawing {
  constructor() {
    super(...arguments);
    this.type = "curve";
  }
  anchorSchema() {
    return { min: 3, max: 3, slots: [{ role: "p1", free: "both" }, { role: "p2", free: "both" }, { role: "control", free: "both" }] };
  }
  px(proj, i) {
    const a = this.anchors[i];
    if (!a) return null;
    const y = proj.yOf(a.price, this.paneId);
    return y == null ? null : [proj.xOf(a.time), y];
  }
  geometry(proj) {
    const P0 = this.px(proj, 0);
    const P2 = this.px(proj, 1);
    if (!P0 || !P2) return null;
    const C = this.px(proj, 2);
    if (!C || this.anchors.length < 3) {
      return { segments: [[P0[0], P0[1], P2[0], P2[1]]], fill: null };
    }
    const pts = [];
    for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
      const t = i / CURVE_SAMPLES;
      const u = 1 - t;
      pts.push([u * u * P0[0] + 2 * u * t * C[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * C[1] + t * t * P2[1]]);
    }
    const segments = [];
    for (let i = 1; i < pts.length; i += 1) segments.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
    return { segments, fill: pts };
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((a) => a.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/ArrowMark.ts
var GLYPH = { head: 11, headW: 9, stemW: 3.5, len: 22 };
var ArrowMark = class extends Drawing {
  anchorSchema() {
    return { min: 1, max: 1, slots: [{ role: "p", free: "both" }] };
  }
  /** The filled glyph polygon in pixel space, tip at the anchor. */
  glyphPoints(proj) {
    const a = this.anchors[0];
    if (!a) return null;
    const y = proj.yOf(a.price, this.paneId);
    if (y == null) return null;
    const x = proj.xOf(a.time);
    const { head, headW, stemW, len } = GLYPH;
    const base = [
      [0, 0],
      [-headW, head],
      [-stemW, head],
      [-stemW, len],
      [stemW, len],
      [stemW, head],
      [headW, head]
    ];
    const dir = this.dir();
    const rot = ([bx, by]) => {
      switch (dir) {
        case "up":
          return [bx, by];
        case "down":
          return [bx, -by];
        case "left":
          return [by, bx];
        default:
          return [-by, bx];
      }
    };
    return base.map((p) => {
      const [rx, ry] = rot(p);
      return [x + rx, y + ry];
    });
  }
  hitTest(px, py, proj, _tol) {
    const g = this.glyphPoints(proj);
    return g != null && pointInPolygon(px, py, g);
  }
  handlePoints(proj) {
    const a = this.anchors[0];
    if (!a) return [];
    const y = proj.yOf(a.price, this.paneId);
    return y == null ? [] : [[proj.xOf(a.time), y]];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const g = this.glyphPoints(proj);
    if (!g) return null;
    const xs = g.map((p) => p[0]);
    const ys = g.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  priceRange() {
    const a = this.anchors[0];
    return a ? { min: a.price, max: a.price } : null;
  }
  schema() {
    return { fields: [{ path: "style.lineColor", label: "Color", kind: "color", group: "line" }, ...TEXT_FIELDS] };
  }
};
var ArrowMarkUp = class extends ArrowMark {
  constructor() {
    super(...arguments);
    this.type = "arrowmarkup";
  }
  dir() {
    return "up";
  }
};
var ArrowMarkDown = class extends ArrowMark {
  constructor() {
    super(...arguments);
    this.type = "arrowmarkdown";
  }
  dir() {
    return "down";
  }
};

// src/core/drawings/types/GlyphStamp.ts
var GLYPH_OPTIONS = ["\u2605", "\u2606", "\u25CF", "\u25C6", "\u25B2", "\u25BC", "\u27A4", "\u2691", "\u271A", "\u2715", "\u2764", "\u2666"];
var STAMP_SIZE_OPTIONS = ["small", "normal", "large", "huge"];
var STAMP_PX = { small: 16, normal: 22, large: 32, huge: 44 };
var GlyphStamp = class extends Drawing {
  constructor(init) {
    super(init);
    if (!this.glyph) this.glyph = this.defaultGlyph();
    if (!this.size) this.size = "normal";
  }
  /** The on-screen glyph size in px for the current named size. */
  sizePx() {
    return STAMP_PX[this.size] ?? STAMP_PX.normal;
  }
  anchorSchema() {
    return { min: 1, max: 1, slots: [{ role: "p", free: "both" }] };
  }
  /** The anchor pixel (the glyph box is sizePx() square, centered here). */
  center(proj) {
    const a = this.anchors[0];
    if (!a) return null;
    const y = proj.yOf(a.price, this.paneId);
    return y == null ? null : [proj.xOf(a.time), y];
  }
  hitTest(px, py, proj, tol) {
    const c = this.center(proj);
    if (!c) return false;
    const r = this.sizePx() / 2 + tol;
    return Math.abs(px - c[0]) <= r && Math.abs(py - c[1]) <= r;
  }
  handlePoints(proj) {
    const c = this.center(proj);
    return c ? [c] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const c = this.center(proj);
    if (!c) return null;
    const s = this.sizePx();
    return { x: c[0] - s / 2, y: c[1] - s / 2, w: s, h: s };
  }
  priceRange() {
    const a = this.anchors[0];
    return a ? { min: a.price, max: a.price } : null;
  }
  schema() {
    return {
      fields: [
        { path: "glyph", label: "Icon", kind: "select", options: GLYPH_OPTIONS.map((g) => ({ value: g, label: g })), group: "line" },
        { path: "size", label: "Size", kind: "select", options: STAMP_SIZE_OPTIONS.map((s) => ({ value: s, label: s })), group: "line" },
        { path: "style.lineColor", label: "Color", kind: "color", group: "line" },
        ...TEXT_FIELDS
      ]
    };
  }
  writeProps() {
    return { glyph: this.glyph, size: this.size };
  }
  readProps(props) {
    if (typeof props.glyph === "string") this.glyph = props.glyph;
    if (typeof props.size === "string") this.size = props.size;
  }
};
var FlagMark = class extends GlyphStamp {
  constructor() {
    super(...arguments);
    this.type = "flagmark";
  }
  defaultGlyph() {
    return "\u2691";
  }
};
var IconStamp = class extends GlyphStamp {
  constructor() {
    super(...arguments);
    this.type = "iconstamp";
  }
  defaultGlyph() {
    return "\u2605";
  }
};

// src/core/drawings/types/FibRatios.ts
var isFibSize = (v) => v === "small" || v === "normal" || v === "large" || v === "huge";
function sanitizeLevel(v) {
  if (!v || typeof v !== "object") return null;
  const o = v;
  if (typeof o.ratio !== "number" || typeof o.color !== "string") return null;
  return {
    ratio: o.ratio,
    color: o.color,
    enabled: o.enabled !== false,
    ...typeof o.label === "string" && o.label ? { label: o.label } : {}
  };
}
var FibRatios = class extends Drawing {
  constructor(init) {
    super(init);
    if (!this.levels) this.levels = this.defaultLevels().map((l) => ({ ...l }));
    if (!this.numbersSize) this.numbersSize = "small";
    if (!this.labelsSize) this.labelsSize = "normal";
  }
  /** Optional fill bands between entries (retracement/extension override); default none. */
  fillBands(_proj) {
    return [];
  }
  editableLevels() {
    return this.levels;
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "p1", free: "both" }, { role: "p2", free: "both" }] };
  }
  hitTest(px, py, proj, tol) {
    const lines = this.entryLines(proj);
    return lines != null && lines.some((l) => distToSegment(px, py, l.x1, l.y1, l.x2, l.y2) <= tol);
  }
  handlePoints(proj) {
    const pts = [];
    for (const a of this.anchors) {
      const y = proj.yOf(a.price, this.paneId);
      if (y == null) return [];
      pts.push([proj.xOf(a.time), y]);
    }
    return pts;
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const pts = this.handlePoints(proj);
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  schema() {
    return { fields: LINE_FIELDS.filter((f) => f.path !== "style.lineColor") };
  }
  writeProps() {
    return { levels: this.levels.map((l) => ({ ...l })), numbersSize: this.numbersSize, labelsSize: this.labelsSize };
  }
  readProps(props) {
    if (Array.isArray(props.levels)) {
      const parsed = props.levels.map(sanitizeLevel).filter((l) => l != null);
      if (parsed.length) this.levels = parsed;
    }
    if (isFibSize(props.numbersSize)) this.numbersSize = props.numbersSize;
    if (isFibSize(props.labelsSize)) this.labelsSize = props.labelsSize;
  }
};

// src/core/drawings/types/FibLevels.ts
var FibLevels = class extends FibRatios {
  /** Per-level pixel line + price for the ENABLED levels, spanning the anchors' time range. */
  levelLines(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const xa = proj.xOf(a.time);
    const xb = proj.xOf(b.time);
    const x1 = Math.min(xa, xb);
    const x2 = Math.max(xa, xb);
    const delta = b.price - a.price;
    const out = [];
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      const price = a.price + lv.ratio * delta;
      const y = proj.yOf(price, this.paneId);
      if (y == null) continue;
      out.push({ ratio: lv.ratio, color: lv.color, label: lv.label, price, x1, x2, y });
    }
    return out;
  }
  entryLines(proj) {
    const lines = this.levelLines(proj);
    if (!lines) return null;
    return lines.map((l) => ({
      color: l.color,
      label: l.label,
      x1: l.x1,
      y1: l.y,
      x2: l.x2,
      y2: l.y,
      numberText: `${l.ratio} (${l.price.toFixed(2)})`,
      numberX: l.x1 + 4,
      numberY: l.y - 7,
      numberAlign: "left",
      labelX: (l.x1 + l.x2) / 2,
      labelY: l.y - 7
    }));
  }
  fillBands(proj) {
    const lines = this.levelLines(proj);
    if (!lines) return [];
    const bands = [];
    for (let i = 1; i < lines.length; i += 1) {
      const a = lines[i - 1];
      const b = lines[i];
      bands.push({ color: b.color, x: a.x1, y: Math.min(a.y, b.y), w: a.x2 - a.x1, h: Math.abs(b.y - a.y) });
    }
    return bands;
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const delta = b.price - a.price;
    const prices = this.levels.filter((l) => l.enabled).map((l) => a.price + l.ratio * delta);
    if (prices.length === 0) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }
};

// src/core/drawings/levelPalette.ts
var LEVEL_ANCHOR = NEUTRAL;
var LEVEL_RED = BEARISH;
var LEVEL_ORANGE = WARNING;
var LEVEL_GREEN = "#4caf50";
var LEVEL_TEAL = BULLISH;
var LEVEL_BLUE = INFO;
var LEVEL_PURPLE = "#9c27b0";
var LEVEL_PINK = "#e91e63";
var LEVEL_AQUA = "#26a69a";
var LEVEL_VIOLET = "#ab47bc";
var LEVEL_CORAL = "#ef5350";
var LEVEL_AMBER = "#ffb74d";
var LEVEL_CYAN = "#38c0fd";
var LEVEL_UNITY = "#b2b5be";
var LEVEL_CYCLE = [
  LEVEL_CYAN,
  LEVEL_BLUE,
  LEVEL_TEAL,
  LEVEL_GREEN,
  LEVEL_ORANGE,
  LEVEL_RED,
  LEVEL_PINK,
  LEVEL_PURPLE,
  LEVEL_ANCHOR,
  LEVEL_AQUA,
  LEVEL_VIOLET,
  LEVEL_CORAL
];
function cycleColor(index) {
  return LEVEL_CYCLE[(index % LEVEL_CYCLE.length + LEVEL_CYCLE.length) % LEVEL_CYCLE.length];
}
var RATIO_COLORS = [
  [0, LEVEL_ANCHOR],
  [0.125, LEVEL_RED],
  [0.236, LEVEL_RED],
  [0.25, LEVEL_RED],
  [0.382, LEVEL_ORANGE],
  [0.5, LEVEL_GREEN],
  [0.618, LEVEL_TEAL],
  [0.75, LEVEL_BLUE],
  [0.786, LEVEL_BLUE],
  [1, LEVEL_ANCHOR],
  [1.272, LEVEL_BLUE],
  [1.382, LEVEL_ORANGE],
  [1.618, LEVEL_RED],
  [2, LEVEL_ANCHOR],
  [2.382, LEVEL_ORANGE],
  [2.618, LEVEL_ORANGE],
  [3, LEVEL_ANCHOR],
  [4.236, LEVEL_GREEN],
  [6.854, LEVEL_TEAL],
  [11.09, LEVEL_BLUE]
];
function levelColor(ratio, index = 0) {
  return RATIO_COLORS.find(([r]) => r === ratio)?.[1] ?? cycleColor(index);
}
function fibLevels(specs) {
  return specs.map((spec, i) => {
    const s = typeof spec === "number" ? { ratio: spec } : spec;
    return {
      ratio: s.ratio,
      color: s.color ?? levelColor(s.ratio, i),
      enabled: s.enabled !== false,
      ...s.label ? { label: s.label } : {}
    };
  });
}
function cycleLevels(count, enabledCount = count) {
  return Array.from({ length: count }, (_, i) => ({
    ratio: i + 1,
    color: cycleColor(i),
    enabled: i < enabledCount,
    label: String(i + 1)
  }));
}

// src/core/drawings/types/FibRetracement.ts
var LEVELS = fibLevels([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
var FibRetracement = class extends FibLevels {
  constructor() {
    super(...arguments);
    this.type = "fibretracement";
  }
  defaultLevels() {
    return LEVELS;
  }
};

// src/core/drawings/types/FibExtension.ts
var LEVELS2 = fibLevels([0, 0.382, 0.618, 1, 1.272, 1.618, { ratio: 2.618, color: LEVEL_PURPLE }]);
var FibExtension = class extends FibLevels {
  constructor() {
    super(...arguments);
    this.type = "fibextension";
  }
  defaultLevels() {
    return LEVELS2;
  }
};

// src/core/drawings/types/FibExtensionTrend.ts
var LEVELS3 = fibLevels([0, 0.382, 0.5, 0.618, 1, 1.618, { ratio: 2.618, color: LEVEL_PURPLE }]);
var FibExtensionTrend = class extends FibRatios {
  constructor() {
    super(...arguments);
    this.type = "fibextensiontrend";
  }
  anchorSchema() {
    return {
      min: 3,
      max: 3,
      slots: [
        { role: "a", free: "both" },
        { role: "b", free: "both" },
        { role: "c", free: "both" }
      ]
    };
  }
  defaultLevels() {
    return LEVELS3;
  }
  entryLines(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    const c = this.anchors[2];
    if (!a || !b || !c) return null;
    const move = b.price - a.price;
    const xs = [proj.xOf(a.time), proj.xOf(b.time), proj.xOf(c.time)];
    const x1 = Math.min(...xs);
    const x2 = Math.max(...xs);
    const out = [];
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      const price = c.price + lv.ratio * move;
      const y = proj.yOf(price, this.paneId);
      if (y == null) continue;
      out.push({
        color: lv.color,
        label: lv.label,
        x1,
        y1: y,
        x2,
        y2: y,
        numberText: `${lv.ratio} (${price.toFixed(2)})`,
        numberX: x1 + 4,
        numberY: y - 7,
        numberAlign: "left",
        labelX: (x1 + x2) / 2,
        labelY: y - 7
      });
    }
    return out;
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    const c = this.anchors[2];
    if (!a || !b || !c) return null;
    const move = b.price - a.price;
    const prices = this.levels.filter((l) => l.enabled).map((l) => c.price + l.ratio * move);
    prices.push(a.price, b.price, c.price);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }
};

// src/core/drawings/types/FibFan.ts
var FAN_LEVELS = fibLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1]);
var FibFan = class extends FibRatios {
  constructor() {
    super(...arguments);
    this.type = "fibfan";
  }
  defaultLevels() {
    return FAN_LEVELS;
  }
  fanLines(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const x0 = proj.xOf(a.time);
    const y0 = proj.yOf(a.price, this.paneId);
    if (y0 == null) return null;
    const xb = proj.xOf(b.time);
    const delta = b.price - a.price;
    const out = [];
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      const ty = proj.yOf(a.price + lv.ratio * delta, this.paneId);
      if (ty == null) continue;
      const [x1, y1, x2, y2] = extendRay(x0, y0, xb, ty, "right", proj.width, proj.height);
      out.push({ ratio: lv.ratio, color: lv.color, label: lv.label, x1, y1, x2, y2, labelX: xb + 5, labelY: ty });
    }
    return out;
  }
  entryLines(proj) {
    const lines = this.fanLines(proj);
    if (!lines) return null;
    return lines.map((l) => ({
      color: l.color,
      label: l.label,
      x1: l.x1,
      y1: l.y1,
      x2: l.x2,
      y2: l.y2,
      numberText: String(l.ratio),
      numberX: l.labelX,
      numberY: l.labelY,
      numberAlign: "left",
      labelX: l.labelX,
      labelY: l.labelY + 13
    }));
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
};

// src/core/drawings/types/FibTimeZones.ts
var TZ_LEVELS = [0, 1, 2, 3, 5, 8, 13, 21, 34].map((n) => ({ ratio: n, color: DEFAULT_DRAWING_COLOR, enabled: true }));
var FibTimeZones = class extends FibRatios {
  constructor() {
    super(...arguments);
    this.type = "fibtimezones";
  }
  defaultLevels() {
    return TZ_LEVELS;
  }
  zoneLines(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const unit = b.time - a.time;
    if (Math.abs(unit) < 1e-9) return null;
    const out = [];
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      out.push({ n: lv.ratio, color: lv.color, label: lv.label, x: proj.xOf(a.time + lv.ratio * unit) });
    }
    return out;
  }
  entryLines(proj) {
    const lines = this.zoneLines(proj);
    if (!lines) return null;
    const h = proj.height;
    return lines.map((l) => ({
      color: l.color,
      label: l.label,
      x1: l.x,
      y1: 0,
      x2: l.x,
      y2: h,
      numberText: String(l.n),
      numberX: l.x,
      numberY: 9,
      numberAlign: "center",
      labelX: l.x,
      labelY: 24
    }));
  }
  priceRange() {
    return null;
  }
  timeExtent() {
    return null;
  }
};

// src/core/drawings/types/FibChannel.ts
var CHANNEL_LEVELS = fibLevels([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618]);
var FibChannel = class extends FibRatios {
  constructor() {
    super(...arguments);
    this.type = "fibchannel";
  }
  defaultLevels() {
    return CHANNEL_LEVELS;
  }
  anchorSchema() {
    return { min: 3, max: 3, slots: [{ role: "p1", free: "both" }, { role: "p2", free: "both" }, { role: "offset", free: "both" }] };
  }
  entryLines(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const y0 = proj.yOf(a.price, this.paneId);
    const y1 = proj.yOf(b.price, this.paneId);
    if (y0 == null || y1 == null) return null;
    const x0 = proj.xOf(a.time);
    const x1 = proj.xOf(b.time);
    let dX = 0;
    let dY = 0;
    const c = this.anchors[2];
    if (c) {
      const y2 = proj.yOf(c.price, this.paneId);
      if (y2 == null) return null;
      dX = proj.xOf(c.time) - x0;
      dY = y2 - y0;
    }
    const out = [];
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      const ox = lv.ratio * dX;
      const oy = lv.ratio * dY;
      const lx2 = x1 + ox;
      const ly2 = y1 + oy;
      out.push({
        color: lv.color,
        label: lv.label,
        x1: x0 + ox,
        y1: y0 + oy,
        x2: lx2,
        y2: ly2,
        numberText: String(lv.ratio),
        numberX: lx2 + 5,
        numberY: ly2,
        numberAlign: "left",
        labelX: lx2 + 5,
        labelY: ly2 + 13
      });
    }
    return out;
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    const c = this.anchors[2];
    if (!a || !b) return null;
    const dPrice = c ? c.price - a.price : 0;
    let min = Infinity;
    let max = -Infinity;
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      for (const base of [a.price, b.price]) {
        const p = base + lv.ratio * dPrice;
        if (p < min) min = p;
        if (p > max) max = p;
      }
    }
    return min <= max ? { min, max } : null;
  }
};

// src/core/drawings/types/FibSpeedFan.ts
var FAN_LEVELS2 = fibLevels([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
var FibSpeedFan = class extends FibRatios {
  constructor() {
    super(...arguments);
    this.type = "fibspeedfan";
  }
  defaultLevels() {
    return FAN_LEVELS2;
  }
  entryLines(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const y1 = proj.yOf(a.price, this.paneId);
    const y2 = proj.yOf(b.price, this.paneId);
    if (y1 == null || y2 == null) return null;
    const x1 = proj.xOf(a.time);
    const x2 = proj.xOf(b.time);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dir = dx >= 0 ? "right" : "left";
    const w = proj.width;
    const h = proj.height;
    const out = [];
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      const pex = x1 + dx;
      const pey = y1 + dy * lv.ratio;
      const pr = extendRay(x1, y1, pex, pey, dir, w, h);
      out.push({
        color: lv.color,
        label: lv.label,
        x1: pr[0],
        y1: pr[1],
        x2: pr[2],
        y2: pr[3],
        numberText: String(lv.ratio),
        numberX: dir === "right" ? pex + 5 : pex - 5,
        numberY: pey,
        numberAlign: dir === "right" ? "left" : "right",
        labelX: pex,
        labelY: pey
      });
      if (lv.ratio === 1) continue;
      const tex = x1 + dx * lv.ratio;
      const tey = y1 + dy;
      const tr = extendRay(x1, y1, tex, tey, dir, w, h);
      out.push({
        color: lv.color,
        label: lv.label,
        x1: tr[0],
        y1: tr[1],
        x2: tr[2],
        y2: tr[3],
        numberText: String(lv.ratio),
        numberX: tex,
        numberY: tey + (dy >= 0 ? 12 : -12),
        numberAlign: "center",
        labelX: tex,
        labelY: tey + 12
      });
    }
    return out;
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
};

// src/core/drawings/types/TrendFibTime.ts
var TIME_LEVELS = fibLevels([
  0,
  0.382,
  { ratio: 0.5, enabled: false },
  // hidden by default
  0.618,
  1,
  1.382,
  1.618,
  2,
  2.382,
  2.618,
  3
]);
var TrendFibTime = class extends FibRatios {
  constructor() {
    super(...arguments);
    this.type = "trendfibtime";
  }
  defaultLevels() {
    return TIME_LEVELS;
  }
  anchorSchema() {
    return { min: 3, max: 3, slots: [{ role: "p1", free: "both" }, { role: "p2", free: "both" }, { role: "p3", free: "both" }] };
  }
  entryLines(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    const c = this.anchors[2];
    if (!a || !b || !c) return null;
    const unit = b.time - a.time;
    if (Math.abs(unit) < 1e-9) return null;
    const h = proj.height;
    const out = [];
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      const x = proj.xOf(c.time + lv.ratio * unit);
      out.push({
        color: lv.color,
        label: lv.label,
        x1: x,
        y1: 0,
        x2: x,
        y2: h,
        numberText: String(lv.ratio),
        numberX: x,
        numberY: 9,
        numberAlign: "center",
        labelX: x,
        labelY: 24
      });
    }
    return out;
  }
  priceRange() {
    return null;
  }
  timeExtent() {
    return null;
  }
};

// src/core/drawings/types/RadialFib.ts
function angleInSweep(ang, a0, a1) {
  if (a1 - a0 >= Math.PI * 2 - 1e-3) return true;
  let d = ang - a0;
  const TWO_PI = Math.PI * 2;
  while (d < 0) d += TWO_PI;
  while (d >= TWO_PI) d -= TWO_PI;
  return d <= a1 - a0 + 1e-6;
}
var RadialFib = class extends FibRatios {
  /** Straight lines drawn alongside the rings (baseline / wedge rays); previewed before `radial` resolves. */
  boundingLines(_proj) {
    return [];
  }
  // Ring tools hit-test by radius, not line segments → entryLines is unused (the painter dispatches
  // them to the arc branch). Satisfy the abstract with an empty set.
  entryLines(_proj) {
    return [];
  }
  hitTest(px, py, proj, tol) {
    const g = this.radial(proj);
    if (g) {
      const dist = Math.hypot(px - g.cx, py - g.cy);
      const ang = Math.atan2(py - g.cy, px - g.cx);
      if (angleInSweep(ang, g.a0, g.a1)) {
        for (const lv of this.levels) {
          if (lv.enabled && Math.abs(dist - g.R0 * lv.ratio) <= tol) return true;
        }
      }
    }
    return this.boundingLines(proj).some((b) => distToSegment(px, py, b[0], b[1], b[2], b[3]) <= tol);
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((a) => a.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
};

// src/core/drawings/types/FibCircles.ts
var CIRCLE_LEVELS = fibLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618]);
var FibCircles = class extends RadialFib {
  constructor() {
    super(...arguments);
    this.type = "fibcircles";
  }
  defaultLevels() {
    return CIRCLE_LEVELS;
  }
  radial(proj) {
    const c = this.anchors[0];
    const e = this.anchors[1];
    if (!c || !e) return null;
    const cy = proj.yOf(c.price, this.paneId);
    const ey = proj.yOf(e.price, this.paneId);
    if (cy == null || ey == null) return null;
    const cx = proj.xOf(c.time);
    const ex = proj.xOf(e.time);
    return { cx, cy, R0: Math.hypot(ex - cx, ey - cy), a0: 0, a1: Math.PI * 2 };
  }
};

// src/core/drawings/types/FibArcs.ts
var ARC_LEVELS = fibLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618]);
var FibArcs = class extends RadialFib {
  constructor() {
    super(...arguments);
    this.type = "fibarcs";
  }
  defaultLevels() {
    return ARC_LEVELS;
  }
  pts(proj) {
    const c = this.anchors[0];
    const e = this.anchors[1];
    if (!c || !e) return null;
    const cy = proj.yOf(c.price, this.paneId);
    const ey = proj.yOf(e.price, this.paneId);
    if (cy == null || ey == null) return null;
    return { cx: proj.xOf(c.time), cy, ex: proj.xOf(e.time), ey };
  }
  radial(proj) {
    const p = this.pts(proj);
    if (!p) return null;
    const R0 = Math.hypot(p.ex - p.cx, p.ey - p.cy);
    const phi = Math.atan2(p.ey - p.cy, p.ex - p.cx);
    return { cx: p.cx, cy: p.cy, R0, a0: phi - Math.PI / 2, a1: phi + Math.PI / 2 };
  }
  boundingLines(proj) {
    const p = this.pts(proj);
    return p ? [[p.cx, p.cy, p.ex, p.ey]] : [];
  }
};

// src/core/drawings/types/FibWedge.ts
var WEDGE_LEVELS = fibLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1]);
var FibWedge = class extends RadialFib {
  constructor() {
    super(...arguments);
    this.type = "fibwedge";
  }
  defaultLevels() {
    return WEDGE_LEVELS;
  }
  anchorSchema() {
    return { min: 3, max: 3, slots: [{ role: "apex", free: "both" }, { role: "radius", free: "both" }, { role: "angle", free: "both" }] };
  }
  px(proj, i) {
    const a = this.anchors[i];
    if (!a) return null;
    const y = proj.yOf(a.price, this.paneId);
    return y == null ? null : [proj.xOf(a.time), y];
  }
  radial(proj) {
    const p0 = this.px(proj, 0);
    const p1 = this.px(proj, 1);
    const p2 = this.px(proj, 2);
    if (!p0 || !p1 || !p2) return null;
    const R0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (R0 < 1) return null;
    const angle1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const angle2 = Math.atan2(p2[1] - p0[1], p2[0] - p0[0]);
    let lo = Math.min(angle1, angle2);
    let hi = Math.max(angle1, angle2);
    if (hi - lo > Math.PI) [lo, hi] = [hi, lo + Math.PI * 2];
    return { cx: p0[0], cy: p0[1], R0, a0: lo, a1: hi };
  }
  boundingLines(proj) {
    const p0 = this.px(proj, 0);
    const p1 = this.px(proj, 1);
    if (!p0 || !p1) return [];
    const out = [[p0[0], p0[1], p1[0], p1[1]]];
    const p2 = this.px(proj, 2);
    if (p2) {
      const R0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const len = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
      if (len > 1e-6) {
        out.push([p0[0], p0[1], p0[0] + (p2[0] - p0[0]) / len * R0, p0[1] + (p2[1] - p0[1]) / len * R0]);
      }
    }
    return out;
  }
};

// src/core/drawings/types/FibSpiral.ts
var PHI = 1.6180339887;
var GROWTH = Math.log(PHI) / (Math.PI / 2);
var STEP = Math.PI / 64;
var MAX_S = Math.PI;
var MIN_R = 0.5;
var FibSpiral = class extends Drawing {
  constructor() {
    super(...arguments);
    this.type = "fibspiral";
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "center", free: "both" }, { role: "edge", free: "both" }] };
  }
  /** The spiral sampled to pixel points (eye → through the edge anchor → a little beyond). */
  spiralPoints(proj) {
    const c = this.anchors[0];
    const e = this.anchors[1];
    if (!c || !e) return null;
    const cy = proj.yOf(c.price, this.paneId);
    const ey = proj.yOf(e.price, this.paneId);
    if (cy == null || ey == null) return null;
    const cx = proj.xOf(c.time);
    const ex = proj.xOf(e.time);
    const R0 = Math.hypot(ex - cx, ey - cy);
    if (R0 < 1) return null;
    const theta0 = Math.atan2(ey - cy, ex - cx);
    const sMin = Math.max(Math.log(MIN_R / R0) / GROWTH, -8 * Math.PI * 2);
    const pts = [];
    for (let s = sMin; s <= MAX_S; s += STEP) {
      const r = R0 * Math.exp(GROWTH * s);
      const ang = theta0 + s;
      pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
    }
    return pts;
  }
  hitTest(px, py, proj, tol) {
    const pts = this.spiralPoints(proj);
    return pts != null && pts.length >= 2 && distToPolyline(px, py, pts) <= tol;
  }
  handlePoints(proj) {
    const c = this.anchors[0];
    const e = this.anchors[1];
    if (!c || !e) return [];
    const cy = proj.yOf(c.price, this.paneId);
    const ey = proj.yOf(e.price, this.paneId);
    if (cy == null || ey == null) return [];
    return [[proj.xOf(c.time), cy], [proj.xOf(e.time), ey]];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const pts = this.handlePoints(proj);
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  priceRange() {
    const c = this.anchors[0];
    const e = this.anchors[1];
    if (!c || !e) return null;
    return { min: Math.min(c.price, e.price), max: Math.max(c.price, e.price) };
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
  }
};

// src/core/drawings/types/GannFan.ts
var GANN_FAN_LEVELS = fibLevels([
  { ratio: 0.125, color: LEVEL_RED, label: "1/8" },
  { ratio: 0.25, color: LEVEL_ORANGE, label: "1/4" },
  { ratio: 0.333, color: LEVEL_AMBER, label: "1/3" },
  { ratio: 0.5, color: LEVEL_GREEN, label: "1/2" },
  { ratio: 1, color: LEVEL_UNITY, label: "1/1" },
  { ratio: 2, color: LEVEL_TEAL, label: "2/1" },
  { ratio: 3, color: LEVEL_BLUE, label: "3/1" },
  { ratio: 4, color: LEVEL_AQUA, label: "4/1" },
  { ratio: 8, color: LEVEL_PURPLE, label: "8/1" }
]);
var GannFan = class extends FibRatios {
  constructor() {
    super(...arguments);
    this.type = "gannfan";
  }
  defaultLevels() {
    return GANN_FAN_LEVELS;
  }
  entryLines(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const x0 = proj.xOf(a.time);
    const y0 = proj.yOf(a.price, this.paneId);
    if (y0 == null) return null;
    const xb = proj.xOf(b.time);
    const dp = b.price - a.price;
    const out = [];
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      const ty = proj.yOf(a.price + dp * lv.ratio, this.paneId);
      if (ty == null) continue;
      const [x1, y1, x2, y2] = extendRay(x0, y0, xb, ty, "right", proj.width, proj.height);
      out.push({
        color: lv.color,
        x1,
        y1,
        x2,
        y2,
        numberText: lv.label ?? String(lv.ratio),
        numberX: xb + 5,
        numberY: ty,
        numberAlign: "left",
        labelX: xb + 5,
        labelY: ty
      });
    }
    return out;
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
};

// src/core/drawings/types/GannBox.ts
var GANN_BOX_LEVELS = fibLevels([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1].map((ratio) => ({ ratio, label: String(ratio) })));
var GannBox = class extends FibRatios {
  constructor() {
    super(...arguments);
    this.type = "gannbox";
  }
  defaultLevels() {
    return GANN_BOX_LEVELS;
  }
  // Placed click-move-click (the inherited 'click' mode): first click sets a corner, the second
  // sets the opposite one — matching the plain Rectangle tool.
  corners(proj) {
    const c1 = this.anchors[0];
    const c2 = this.anchors[1];
    if (!c1 || !c2) return null;
    const xa = proj.xOf(c1.time);
    const xb = proj.xOf(c2.time);
    const ya = proj.yOf(c1.price, this.paneId);
    const yb = proj.yOf(c2.price, this.paneId);
    if (ya == null || yb == null) return null;
    return { c1, c2, left: Math.min(xa, xb), right: Math.max(xa, xb), top: Math.min(ya, yb), bot: Math.max(ya, yb) };
  }
  entryLines(proj) {
    const g = this.corners(proj);
    if (!g) return null;
    const { c1, c2, left, right, top, bot } = g;
    const out = [];
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      const py = proj.yOf(c1.price + lv.ratio * (c2.price - c1.price), this.paneId);
      if (py != null) {
        out.push({ color: lv.color, x1: left, y1: py, x2: right, y2: py, numberText: lv.label ?? String(lv.ratio), numberX: left - 5, numberY: py, numberAlign: "right", labelX: left, labelY: py });
      }
      const vx = proj.xOf(c1.time + lv.ratio * (c2.time - c1.time));
      out.push({ color: lv.color, x1: vx, y1: top, x2: vx, y2: bot, numberText: "", numberX: vx, numberY: top, numberAlign: "center", labelX: vx, labelY: top });
    }
    const diag = this.levels.find((l) => l.ratio === 1)?.color ?? LEVEL_ANCHOR;
    out.push({ color: diag, x1: left, y1: top, x2: right, y2: bot, numberText: "", numberX: 0, numberY: 0, numberAlign: "left", labelX: 0, labelY: 0 });
    out.push({ color: diag, x1: left, y1: bot, x2: right, y2: top, numberText: "", numberX: 0, numberY: 0, numberAlign: "left", labelX: 0, labelY: 0 });
    return out;
  }
  hitTest(px, py, proj, tol) {
    const g = this.corners(proj);
    return g != null && pointInBox(px, py, g.left, g.top, g.right, g.bot, tol);
  }
  priceRange() {
    const c1 = this.anchors[0];
    const c2 = this.anchors[1];
    if (!c1 || !c2) return null;
    return { min: Math.min(c1.price, c2.price), max: Math.max(c1.price, c2.price) };
  }
};

// src/core/drawings/types/GannSquare.ts
var GRID_LEVELS = fibLevels([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1].map((ratio) => ({ ratio, label: String(ratio) })));
var FAN = [
  { label: "3x1", x: 3, y: 1, color: LEVEL_RED },
  { label: "2x1", x: 2, y: 1, color: LEVEL_ORANGE },
  { label: "1x1", x: 1, y: 1, color: LEVEL_UNITY },
  { label: "1x2", x: 1, y: 2, color: LEVEL_TEAL },
  { label: "1x3", x: 1, y: 3, color: LEVEL_BLUE }
];
var GANN_SQUARE_ARCS = [
  { k: 0.25, color: LEVEL_RED },
  { k: 0.5, color: LEVEL_ORANGE },
  { k: 0.75, color: LEVEL_GREEN },
  { k: 1, color: LEVEL_TEAL }
];
var GannSquare = class extends FibRatios {
  constructor() {
    super(...arguments);
    this.type = "gannsquare";
  }
  defaultLevels() {
    return GRID_LEVELS;
  }
  // Placed click-move-click (the inherited 'click' mode): first click sets a corner, the second
  // sets the opposite one — matching the plain Rectangle tool.
  box(proj) {
    const c1 = this.anchors[0];
    const c2 = this.anchors[1];
    if (!c1 || !c2) return null;
    const oy = proj.yOf(c1.price, this.paneId);
    const ey = proj.yOf(c2.price, this.paneId);
    if (oy == null || ey == null) return null;
    const ox = proj.xOf(c1.time);
    const ex = proj.xOf(c2.time);
    return { ox, oy, bx: ex - ox, py: ey - oy, left: Math.min(ox, ex), top: Math.min(oy, ey), right: Math.max(ox, ex), bot: Math.max(oy, ey) };
  }
  /** The origin corner + box pixel deltas, consumed by the arc painter. */
  arcGeom(proj) {
    const b = this.box(proj);
    return b ? { ox: b.ox, oy: b.oy, bx: b.bx, py: b.py } : null;
  }
  entryLines(proj) {
    const b = this.box(proj);
    if (!b) return null;
    const c1 = this.anchors[0];
    const c2 = this.anchors[1];
    const out = [];
    for (const lv of this.levels) {
      if (!lv.enabled) continue;
      const hy = proj.yOf(c1.price + lv.ratio * (c2.price - c1.price), this.paneId);
      if (hy != null) {
        out.push({ color: lv.color, x1: b.left, y1: hy, x2: b.right, y2: hy, numberText: lv.label ?? String(lv.ratio), numberX: b.left - 5, numberY: hy, numberAlign: "right", labelX: b.left, labelY: hy });
      }
      const vx = proj.xOf(c1.time + lv.ratio * (c2.time - c1.time));
      out.push({ color: lv.color, x1: vx, y1: b.top, x2: vx, y2: b.bot, numberText: "", numberX: vx, numberY: b.top, numberAlign: "center", labelX: vx, labelY: b.top });
    }
    for (const f of FAN) {
      let u;
      let v;
      if (f.x > f.y) {
        u = b.ox + b.bx;
        v = b.oy + f.y / f.x * b.py;
      } else {
        v = b.oy + b.py;
        u = b.ox + f.x / f.y * b.bx;
      }
      out.push({ color: f.color, x1: b.ox, y1: b.oy, x2: u, y2: v, numberText: f.label, numberX: u + 4, numberY: v, numberAlign: "left", labelX: u + 4, labelY: v });
    }
    return out;
  }
  hitTest(px, py, proj, tol) {
    const b = this.box(proj);
    return b != null && pointInBox(px, py, b.left, b.top, b.right, b.bot, tol);
  }
  priceRange() {
    const c1 = this.anchors[0];
    const c2 = this.anchors[1];
    if (!c1 || !c2) return null;
    return { min: Math.min(c1.price, c2.price), max: Math.max(c1.price, c2.price) };
  }
};

// src/core/drawings/types/DedekindTessellation.ts
var DEDEKIND_CURVATURE_OPTIONS = [4, 8, 12, 16, 24, 32, 48, 64];
var DEFAULT_MAX_CURVATURE = 24;
var MIN_ARC_PX = 0.75;
function isDedekindCenter(k, n) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n <= 0) return false;
  const k2m1 = k * k - 1;
  if (n % 2 === 1) return k2m1 % n === 0;
  if (n % 8 === 0) {
    if (k2m1 % n !== 0) return false;
    return k2m1 / n % 2 !== 0;
  }
  return false;
}
function dedekindCentersInUnit(n) {
  const out = [];
  for (let k = 0; k < n; k += 1) {
    if (isDedekindCenter(k, n)) out.push(k);
  }
  return out;
}
var DedekindTessellation = class extends Drawing {
  constructor(init) {
    super(init);
    this.type = "dedekind";
    if (this.maxCurvature === void 0) this.maxCurvature = DEFAULT_MAX_CURVATURE;
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "c1", free: "both" }, { role: "c2", free: "both" }] };
  }
  /** Pixel box + isotropic hyperbolic scale (null until both corners resolve). */
  box(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    if (ya == null || yb == null) return null;
    const left = Math.min(proj.xOf(a.time), proj.xOf(b.time));
    const right = Math.max(proj.xOf(a.time), proj.xOf(b.time));
    const top = Math.min(ya, yb);
    const bot = Math.max(ya, yb);
    const w = right - left;
    const h = bot - top;
    if (w < 1 || h < 1) return null;
    const unitPx = h;
    const realSpan = w / unitPx;
    return { left, right, top, bot, unitPx, x0: 0, realSpan };
  }
  /**
   * Semicircles + vertical geodesics in media pixels, already culled to the box.
   * Verticals are at every half-integer (Kocik case B); arcs use curvatures 1…maxCurvature.
   */
  geodesics(proj) {
    const box = this.box(proj);
    if (!box) return null;
    const { left, top, bot, unitPx, x0, realSpan } = box;
    const maxN = Math.max(1, Math.min(64, Math.round(this.maxCurvature)));
    const xMin = x0 - 1 / maxN;
    const xMax = x0 + realSpan + 1 / maxN;
    const right = left + realSpan * unitPx;
    const out = [];
    const k0 = Math.floor(xMin * 2);
    const k1 = Math.ceil(xMax * 2);
    for (let k = k0; k <= k1; k += 1) {
      if (k % 2 === 0) continue;
      const x = left + (k / 2 - x0) * unitPx;
      if (x < left - 0.5 || x > right + 0.5) continue;
      out.push({ kind: "vline", x, y0: bot, y1: top });
    }
    for (let n = 1; n <= maxN; n += 1) {
      const r = 1 / n;
      const rPx = r * unitPx;
      if (rPx < MIN_ARC_PX) continue;
      const ks = dedekindCentersInUnit(n);
      if (ks.length === 0) continue;
      const tLo = Math.floor(xMin) - 1;
      const tHi = Math.ceil(xMax) + 1;
      for (let t = tLo; t <= tHi; t += 1) {
        for (const k of ks) {
          const c = k / n + t;
          if (c + r < xMin || c - r > xMax) continue;
          const cx = left + (c - x0) * unitPx;
          if (cx + rPx < left - 1 || cx - rPx > right + 1) continue;
          out.push({ kind: "arc", cx, cy: bot, r: rPx });
        }
      }
    }
    return out;
  }
  hitTest(px, py, proj, tol) {
    const b = this.box(proj);
    return b != null && pointInBox(px, py, b.left, b.top, b.right, b.bot, tol);
  }
  handlePoints(proj) {
    const b = this.box(proj);
    return b ? [[b.left, b.top], [b.right, b.bot]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const b = this.box(proj);
    if (!b) return null;
    return { x: b.left, y: b.top, w: b.right - b.left, h: b.bot - b.top };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return {
      fields: [
        ...LINE_FIELDS,
        {
          path: "maxCurvature",
          label: "Max curvature",
          kind: "number",
          min: 4,
          max: 64,
          step: 4,
          group: "behavior"
        },
        ...TEXT_FIELDS
      ]
    };
  }
  writeProps() {
    return { maxCurvature: this.maxCurvature };
  }
  readProps(props) {
    if (typeof props.maxCurvature === "number" && Number.isFinite(props.maxCurvature)) {
      this.maxCurvature = Math.max(1, Math.min(64, Math.round(props.maxCurvature)));
    }
  }
};

// src/core/drawings/types/MachFigure.ts
var MACH_WAVE_COUNT_OPTIONS = [3, 4, 5, 6, 8, 10, 12];
var MACH_NUMBER_OPTIONS = [1.5, 2, 2.5, 3, 4, 5];
var DEFAULT_WAVES = 6;
var DEFAULT_MACH = 2;
function linearMachLevels(enabledCount = DEFAULT_WAVES) {
  return [...cycleLevels(LEVEL_CYCLE.length, enabledCount)];
}
function sanitizeLevel2(v) {
  if (!v || typeof v !== "object") return null;
  const o = v;
  if (typeof o.ratio !== "number" || typeof o.color !== "string") return null;
  return {
    ratio: o.ratio,
    color: o.color,
    enabled: o.enabled !== false,
    ...typeof o.label === "string" && o.label ? { label: o.label } : {}
  };
}
var SHOW_RATIOS_FIELD = {
  path: "showRatios",
  label: "Show ratios",
  kind: "boolean",
  group: "behavior"
};
var MachFigure = class extends Drawing {
  constructor(init) {
    super(init);
    if (this.waveCount === void 0) this.waveCount = DEFAULT_WAVES;
    if (this.showRatios === void 0) this.showRatios = true;
    const levelsFromProps = Array.isArray(init.props?.levels);
    if (!this.levels) this.levels = this.defaultLevels().map((l) => ({ ...l }));
    if (!levelsFromProps && this.shouldSyncWaveCount()) this.syncLevelsToWaveCount();
  }
  /** Linear Sonic/Supersonic sync `waveCount` → enabled levels; Golden tools return false. */
  shouldSyncWaveCount() {
    return true;
  }
  syncLevelsToWaveCount() {
    const n = Math.max(1, Math.min(this.levels.length, Math.round(this.waveCount)));
    this.waveCount = n;
    for (let i = 0; i < this.levels.length; i += 1) this.levels[i].enabled = i < n;
  }
  editableLevels() {
    return this.levels;
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "d1", free: "both" }, { role: "d2", free: "both" }] };
  }
  /** Pixel geometry for the current anchors, or null until both ends resolve. */
  geom(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const ay = proj.yOf(a.price, this.paneId);
    const by = proj.yOf(b.price, this.paneId);
    if (ay == null || by == null) return null;
    const ax = proj.xOf(a.time);
    const bx = proj.xOf(b.time);
    const c0x = (ax + bx) / 2;
    const c0y = (ay + by) / 2;
    const R = Math.hypot(bx - ax, by - ay) / 2;
    if (R < 1) return null;
    let fx = bx - ax;
    let fy = by - ay;
    const flen = Math.hypot(fx, fy);
    if (flen < 1e-9) {
      fx = 1;
      fy = 0;
    } else {
      fx /= flen;
      fy /= flen;
    }
    const active = this.levels.filter((l) => l.enabled && l.ratio > 0).slice().sort((p, q) => p.ratio - q.ratio);
    if (active.length === 0) return null;
    const M = Math.max(1, this.machNumber());
    const circles = [];
    for (const lv of active) {
      const r = lv.ratio * R;
      circles.push({
        cx: c0x + M * (r - R) * fx,
        cy: c0y + M * (r - R) * fy,
        r,
        color: lv.color,
        ratio: lv.ratio
      });
    }
    const noseX = c0x - M * R * fx;
    const noseY = c0y - M * R * fy;
    const maxR = circles[circles.length - 1].r;
    const rayLen = M * maxR + 2 * R;
    const rays = [];
    if (M <= 1 + 1e-9) {
      const px = -fy;
      const py = fx;
      rays.push([noseX - px * rayLen, noseY - py * rayLen, noseX + px * rayLen, noseY + py * rayLen]);
    } else {
      const mu = Math.asin(1 / M);
      const cos = Math.cos(mu);
      const sin = Math.sin(mu);
      const rot = (dx, dy, s) => [dx * cos - dy * s * sin, dx * s * sin + dy * cos];
      const [d1x, d1y] = rot(fx, fy, 1);
      const [d2x, d2y] = rot(fx, fy, -1);
      rays.push([noseX, noseY, noseX + d1x * rayLen, noseY + d1y * rayLen]);
      rays.push([noseX, noseY, noseX + d2x * rayLen, noseY + d2y * rayLen]);
    }
    return { c0x, c0y, R, fx, fy, noseX, noseY, circles, rays };
  }
  hitTest(px, py, proj, tol) {
    const g = this.geom(proj);
    if (!g) return false;
    for (const c of g.circles) {
      if (Math.abs(Math.hypot(px - c.cx, py - c.cy) - c.r) <= tol) return true;
    }
    return g.rays.some((r) => distToSegment(px, py, r[0], r[1], r[2], r[3]) <= tol);
  }
  handlePoints(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return [];
    const ay = proj.yOf(a.price, this.paneId);
    const by = proj.yOf(b.price, this.paneId);
    if (ay == null || by == null) return [];
    return [
      [proj.xOf(a.time), ay],
      [proj.xOf(b.time), by]
    ];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const g = this.geom(proj);
    if (!g) return null;
    let loX = g.noseX;
    let hiX = g.noseX;
    let loY = g.noseY;
    let hiY = g.noseY;
    for (const c of g.circles) {
      loX = Math.min(loX, c.cx - c.r);
      hiX = Math.max(hiX, c.cx + c.r);
      loY = Math.min(loY, c.cy - c.r);
      hiY = Math.max(hiY, c.cy + c.r);
    }
    for (const r of g.rays) {
      loX = Math.min(loX, r[0], r[2]);
      hiX = Math.max(hiX, r[0], r[2]);
      loY = Math.min(loY, r[1], r[3]);
      hiY = Math.max(hiY, r[1], r[3]);
    }
    return { x: loX, y: loY, w: hiX - loX, h: hiY - loY };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  /** Sync the Waves dropdown onto `levels[].enabled` (first N on). */
  applySettings(patch) {
    super.applySettings(patch);
    if (Object.prototype.hasOwnProperty.call(patch, "waveCount") && typeof this.waveCount === "number") {
      const n = Math.max(1, Math.min(this.levels.length, Math.round(this.waveCount)));
      this.waveCount = n;
      for (let i = 0; i < this.levels.length; i += 1) this.levels[i].enabled = i < n;
    }
  }
  schema() {
    return {
      fields: [
        ...LINE_FIELDS,
        {
          path: "waveCount",
          label: "Waves",
          kind: "number",
          min: 3,
          max: 12,
          step: 1,
          group: "behavior"
        },
        SHOW_RATIOS_FIELD,
        ...TEXT_FIELDS
      ]
    };
  }
  writeProps() {
    return {
      waveCount: this.waveCount,
      showRatios: this.showRatios,
      levels: this.levels.map((l) => ({ ...l }))
    };
  }
  readProps(props) {
    if (typeof props.waveCount === "number" && Number.isFinite(props.waveCount)) {
      this.waveCount = Math.max(2, Math.min(12, Math.round(props.waveCount)));
    }
    if (typeof props.showRatios === "boolean") this.showRatios = props.showRatios;
    if (Array.isArray(props.levels)) {
      const parsed = props.levels.map(sanitizeLevel2).filter((l) => l != null);
      if (parsed.length) this.levels = parsed;
    }
  }
};
var Sonic = class extends MachFigure {
  constructor() {
    super(...arguments);
    this.type = "sonic";
  }
  defaultLevels() {
    return linearMachLevels(DEFAULT_WAVES);
  }
  machNumber() {
    return 1;
  }
};
var Supersonic = class extends MachFigure {
  constructor(init) {
    super(init);
    this.type = "supersonic";
    if (this.mach === void 0) this.mach = DEFAULT_MACH;
  }
  defaultLevels() {
    return linearMachLevels(DEFAULT_WAVES);
  }
  machNumber() {
    return Math.max(1.01, this.mach);
  }
  schema() {
    return {
      fields: [
        ...LINE_FIELDS,
        {
          path: "mach",
          label: "Mach number",
          kind: "number",
          min: 1.5,
          max: 5,
          step: 0.5,
          group: "behavior"
        },
        {
          path: "waveCount",
          label: "Waves",
          kind: "number",
          min: 3,
          max: 12,
          step: 1,
          group: "behavior"
        },
        SHOW_RATIOS_FIELD,
        ...TEXT_FIELDS
      ]
    };
  }
  writeProps() {
    return { ...super.writeProps(), mach: this.mach };
  }
  readProps(props) {
    super.readProps(props);
    if (typeof props.mach === "number" && Number.isFinite(props.mach)) {
      this.mach = Math.max(1.01, Math.min(20, props.mach));
    }
  }
};

// src/core/drawings/types/GoldenMach.ts
var GOLDEN_MACH_LEVELS = fibLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 4.236, 6.854, 11.09]);
var DEFAULT_MACH2 = 2;
var GoldenSonic = class extends MachFigure {
  constructor() {
    super(...arguments);
    this.type = "goldensonic";
  }
  shouldSyncWaveCount() {
    return false;
  }
  defaultLevels() {
    return GOLDEN_MACH_LEVELS;
  }
  machNumber() {
    return 1;
  }
  schema() {
    return { fields: [...LINE_FIELDS, SHOW_RATIOS_FIELD, ...TEXT_FIELDS] };
  }
};
var GoldenSupersonic = class extends MachFigure {
  constructor(init) {
    super(init);
    this.type = "goldensupersonic";
    if (this.mach === void 0) this.mach = DEFAULT_MACH2;
  }
  shouldSyncWaveCount() {
    return false;
  }
  defaultLevels() {
    return GOLDEN_MACH_LEVELS;
  }
  machNumber() {
    return Math.max(1.01, this.mach);
  }
  schema() {
    return {
      fields: [
        ...LINE_FIELDS,
        {
          path: "mach",
          label: "Mach number",
          kind: "number",
          min: 1.5,
          max: 5,
          step: 0.5,
          group: "behavior"
        },
        SHOW_RATIOS_FIELD,
        ...TEXT_FIELDS
      ]
    };
  }
  writeProps() {
    return { ...super.writeProps(), mach: this.mach };
  }
  readProps(props) {
    super.readProps(props);
    if (typeof props.mach === "number" && Number.isFinite(props.mach)) {
      this.mach = Math.max(1.01, Math.min(20, props.mach));
    }
  }
};

// src/core/drawings/types/PatternDrawing.ts
var PatternDrawing = class extends Drawing {
  /** Show consecutive-leg retracement ratios (harmonic patterns). */
  legRatios() {
    return false;
  }
  /** Vertex-index triples to tint (the harmonic body), or none. */
  fillTriangles() {
    return [];
  }
  /** Two vertex indices whose line is drawn as an extended neckline (head & shoulders), or null. */
  necklineIndices() {
    return null;
  }
  anchorSchema() {
    const n = this.vertexLabels().length;
    const slots = [];
    for (let i = 0; i < n; i += 1) slots.push({ role: `p${i}`, free: "both" });
    return { min: n, max: n, slots };
  }
  handlePoints(proj) {
    const pts = [];
    for (const a of this.anchors) {
      const y = proj.yOf(a.price, this.paneId);
      if (y == null) return [];
      pts.push([proj.xOf(a.time), y]);
    }
    return pts;
  }
  hitTest(px, py, proj, tol) {
    const pts = this.handlePoints(proj);
    return pts.length >= 2 && distToPolyline(px, py, pts) <= tol;
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const pts = this.handlePoints(proj);
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  priceRange() {
    if (this.anchors.length === 0) return null;
    const ps = this.anchors.map((a) => a.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  // ── harmonic validation hooks (overridden by HarmonicPattern; null = not a validated pattern) ──
  /** The harmonic pattern's name (drawn as a badge), or null for a plain pattern. */
  patternName() {
    return null;
  }
  /** Whether the leg ratio shown at vertex `i` is within the pattern's ideal band (null = no rule). */
  ratioOk(_i) {
    return null;
  }
  /** Whether ALL the pattern's defining ratios are satisfied (null = not enough points / not harmonic). */
  valid() {
    return null;
  }
  /** Consecutive-leg ratio at vertex `i` (≥2): |leg(i-1,i)| / |leg(i-2,i-1)| in price. */
  ratioAt(i) {
    const a = this.anchors[i - 2];
    const b = this.anchors[i - 1];
    const c = this.anchors[i];
    if (!a || !b || !c) return null;
    const prev = Math.abs(b.price - a.price);
    return prev < 1e-9 ? null : Math.abs(c.price - b.price) / prev;
  }
  schema() {
    return { fields: [...LINE_FIELDS, ...this.fillTriangles().length ? FILL_FIELDS : []] };
  }
};

// src/core/drawings/types/XABCD.ts
var XABCD = class extends PatternDrawing {
  constructor() {
    super(...arguments);
    this.type = "xabcd";
  }
  vertexLabels() {
    return ["X", "A", "B", "C", "D"];
  }
  legRatios() {
    return true;
  }
  fillTriangles() {
    return [
      [0, 1, 2],
      [2, 3, 4]
    ];
  }
};

// src/core/drawings/types/ABCDPattern.ts
var ABCDPattern = class extends PatternDrawing {
  constructor() {
    super(...arguments);
    this.type = "abcd";
  }
  vertexLabels() {
    return ["A", "B", "C", "D"];
  }
  legRatios() {
    return true;
  }
};

// src/core/drawings/types/ElliottImpulse.ts
var ElliottImpulse = class extends PatternDrawing {
  constructor() {
    super(...arguments);
    this.type = "elliottimpulse";
  }
  vertexLabels() {
    return ["1", "2", "3", "4", "5"];
  }
};

// src/core/drawings/types/ElliottCorrection.ts
var ElliottCorrection = class extends PatternDrawing {
  constructor() {
    super(...arguments);
    this.type = "elliottcorrection";
  }
  vertexLabels() {
    return ["A", "B", "C"];
  }
};

// src/core/drawings/types/HeadShoulders.ts
var HeadShoulders = class extends PatternDrawing {
  constructor() {
    super(...arguments);
    this.type = "headshoulders";
  }
  vertexLabels() {
    return ["", "LS", "", "H", "", "RS", ""];
  }
  necklineIndices() {
    return [2, 4];
  }
};

// src/core/drawings/types/HarmonicPattern.ts
var HarmonicPattern = class extends PatternDrawing {
  vertexLabels() {
    return ["X", "A", "B", "C", "D"];
  }
  legRatios() {
    return true;
  }
  fillTriangles() {
    return [
      [0, 1, 2],
      [2, 3, 4]
    ];
  }
  /** A named leg ratio in price space (absolute), or null if a leg is degenerate. */
  legValue(name) {
    const [x, a, b, c, d] = this.anchors;
    if (!x || !a || !b || !c || !d) return null;
    const leg = (p, q) => Math.abs(q.price - p.price);
    const xa = leg(x, a);
    const ab = leg(a, b);
    const bc = leg(b, c);
    switch (name) {
      case "ab":
        return xa < 1e-9 ? null : ab / xa;
      case "bc":
        return ab < 1e-9 ? null : bc / ab;
      case "cd":
        return bc < 1e-9 ? null : leg(c, d) / bc;
      default:
        return xa < 1e-9 ? null : leg(a, d) / xa;
    }
  }
  inBand(v, b) {
    return v != null && v >= b.min && v <= b.max;
  }
  ratioOk(i) {
    const r = this.ranges();
    if (i === 2) return this.inBand(this.legValue("ab"), r.ab);
    if (i === 3) return this.inBand(this.legValue("bc"), r.bc);
    if (i === 4) return this.inBand(this.legValue("cd"), r.cd);
    return null;
  }
  valid() {
    if (this.anchors.length < 5) return null;
    const r = this.ranges();
    return this.inBand(this.legValue("ab"), r.ab) && this.inBand(this.legValue("bc"), r.bc) && this.inBand(this.legValue("cd"), r.cd) && this.inBand(this.legValue("ad"), r.ad);
  }
};

// src/core/drawings/types/Gartley.ts
var Gartley = class extends HarmonicPattern {
  constructor() {
    super(...arguments);
    this.type = "gartley";
  }
  patternName() {
    return "Gartley";
  }
  ranges() {
    return { ab: { min: 0.55, max: 0.68 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 1.13, max: 1.618 }, ad: { min: 0.74, max: 0.83 } };
  }
};

// src/core/drawings/types/Bat.ts
var Bat = class extends HarmonicPattern {
  constructor() {
    super(...arguments);
    this.type = "bat";
  }
  patternName() {
    return "Bat";
  }
  ranges() {
    return { ab: { min: 0.382, max: 0.5 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 1.618, max: 2.618 }, ad: { min: 0.84, max: 0.92 } };
  }
};

// src/core/drawings/types/Butterfly.ts
var Butterfly = class extends HarmonicPattern {
  constructor() {
    super(...arguments);
    this.type = "butterfly";
  }
  patternName() {
    return "Butterfly";
  }
  ranges() {
    return { ab: { min: 0.74, max: 0.83 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 1.618, max: 2.618 }, ad: { min: 1.272, max: 1.618 } };
  }
};

// src/core/drawings/types/Crab.ts
var Crab = class extends HarmonicPattern {
  constructor() {
    super(...arguments);
    this.type = "crab";
  }
  patternName() {
    return "Crab";
  }
  ranges() {
    return { ab: { min: 0.382, max: 0.618 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 2.618, max: 3.618 }, ad: { min: 1.55, max: 1.69 } };
  }
};

// src/core/drawings/types/Shark.ts
var Shark = class extends HarmonicPattern {
  constructor() {
    super(...arguments);
    this.type = "shark";
  }
  patternName() {
    return "Shark";
  }
  ranges() {
    return { ab: { min: 0.382, max: 0.618 }, bc: { min: 1.13, max: 1.618 }, cd: { min: 1.618, max: 2.24 }, ad: { min: 0.886, max: 1.13 } };
  }
};

// src/core/drawings/types/Cypher.ts
var XC_OVER_XA = { min: 1.272, max: 1.414 };
var CD_OVER_XC = { min: 0.74, max: 0.83 };
var Cypher = class extends HarmonicPattern {
  constructor() {
    super(...arguments);
    this.type = "cypher";
  }
  patternName() {
    return "Cypher";
  }
  ranges() {
    return { ab: { min: 0.382, max: 0.618 }, bc: { min: 0, max: Infinity }, cd: { min: 0, max: Infinity }, ad: { min: 0, max: Infinity } };
  }
  /** XC/XA — point C is a projection of the XA leg beyond A. */
  xcOverXa() {
    const x = this.anchors[0];
    const a = this.anchors[1];
    const c = this.anchors[3];
    if (!x || !a || !c) return null;
    const xa = Math.abs(a.price - x.price);
    return xa < 1e-9 ? null : Math.abs(c.price - x.price) / xa;
  }
  /** CD/XC — D is a retracement of the XC line. */
  cdOverXc() {
    const x = this.anchors[0];
    const c = this.anchors[3];
    const d = this.anchors[4];
    if (!x || !c || !d) return null;
    const xc = Math.abs(c.price - x.price);
    return xc < 1e-9 ? null : Math.abs(d.price - c.price) / xc;
  }
  ratioOk(i) {
    if (i === 2) return this.inBand(this.legValue("ab"), this.ranges().ab);
    return null;
  }
  valid() {
    if (this.anchors.length < 5) return null;
    return this.inBand(this.legValue("ab"), this.ranges().ab) && this.inBand(this.xcOverXa(), XC_OVER_XA) && this.inBand(this.cdOverXc(), CD_OVER_XC);
  }
};

// src/core/drawings/types/MeasureBox.ts
function signed(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}
function formatDuration(ms) {
  const m = Math.abs(ms);
  const DAY = 864e5;
  const HR = 36e5;
  const MIN = 6e4;
  if (m >= DAY) {
    const d = Math.floor(m / DAY);
    const h = Math.round(m % DAY / HR);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  if (m >= HR) {
    const h = Math.floor(m / HR);
    const mn = Math.round(m % HR / MIN);
    return mn ? `${h}h ${mn}m` : `${h}h`;
  }
  if (m >= MIN) return `${Math.round(m / MIN)}m`;
  return `${Math.round(m / 1e3)}s`;
}
var MeasureBox = class extends Drawing {
  constructor(init) {
    super(init);
    if (this.showPrice === void 0) this.showPrice = true;
    if (this.showDate === void 0) this.showDate = true;
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "c1", free: "both" }, { role: "c2", free: "both" }] };
  }
  // Placed click-move-click (the inherited 'click' mode): first click sets a corner, the second
  // sets the opposite one — consistent with the box/Gann tools.
  /** The measurement lines, filtered by the enabled toggles. */
  measureLabel(proj) {
    const lines = [];
    if (this.showPrice) lines.push(this.priceLabel());
    if (this.showDate) lines.push(this.timeLabel(proj));
    return lines;
  }
  /** Up (later price ≥ earlier) → green; else red. */
  isUp() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    return a != null && b != null && b.price >= a.price;
  }
  /** Formatted `Δprice (Δ%)` between the two anchors. */
  priceLabel() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return "";
    const delta = b.price - a.price;
    const percent = a.price !== 0 ? delta / a.price * 100 : 0;
    return `${signed(delta)} (${signed(percent)}%)`;
  }
  /** Formatted `N bars, duration` between the two anchors (bars only when the projector knows). */
  timeLabel(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return "";
    const duration = formatDuration(b.time - a.time);
    const bars = proj.barsBetween ? Math.round(proj.barsBetween(a.time, b.time)) : null;
    return bars != null ? `${bars} bars, ${duration}` : duration;
  }
  rect(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    if (ya == null || yb == null) return null;
    return { x1: proj.xOf(a.time), y1: ya, x2: proj.xOf(b.time), y2: yb };
  }
  hitTest(px, py, proj, tol) {
    const r = this.rect(proj);
    return r != null && pointInBox(px, py, r.x1, r.y1, r.x2, r.y2, tol);
  }
  handlePoints(proj) {
    const r = this.rect(proj);
    return r ? [[r.x1, r.y1], [r.x2, r.y2]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const r = this.rect(proj);
    if (!r) return null;
    return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return {
      fields: [
        { path: "showPrice", label: "Show price", kind: "boolean", group: "behavior" },
        { path: "showDate", label: "Show date", kind: "boolean", group: "behavior" },
        ...LINE_FIELDS.filter((f) => f.path !== "style.lineColor"),
        // box border (the fill is direction-tinted)
        { path: "text.color", label: "Text color", kind: "color", group: "text" },
        { path: "text.size", label: "Text size", kind: "select", options: TEXT_SIZE_OPTIONS, group: "text" }
      ]
    };
  }
  writeProps() {
    return { showPrice: this.showPrice, showDate: this.showDate };
  }
  readProps(props) {
    if (typeof props.showPrice === "boolean") this.showPrice = props.showPrice;
    if (typeof props.showDate === "boolean") this.showDate = props.showDate;
  }
};

// src/core/drawings/types/DatePriceRange.ts
var DatePriceRange = class extends MeasureBox {
  constructor() {
    super(...arguments);
    this.type = "datepricerange";
  }
};

// src/core/drawings/types/PositionTool.ts
var DIRECTION_OPTIONS = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" }
];
var _PositionTool = class _PositionTool extends Drawing {
  constructor(init) {
    super(init);
    this.type = "position";
    if (this.riskPercent === void 0) this.riskPercent = _PositionTool.DEFAULT_RISK_PERCENT;
    if (this.accountBalance === void 0) this.accountBalance = _PositionTool.DEFAULT_ACCOUNT_BALANCE;
    if (this.showText === void 0) this.showText = true;
    if (this.showHeader === void 0) this.showHeader = true;
    if (this.showPrices === void 0) this.showPrices = false;
    if (this.showLossSize === void 0) this.showLossSize = true;
    if (this.showTargetLabel === void 0) this.showTargetLabel = true;
    if (this.showStopLabel === void 0) this.showStopLabel = true;
    if (this.profitColor === void 0) this.profitColor = _PositionTool.DEFAULT_PROFIT_COLOR;
    if (this.lossColor === void 0) this.lossColor = _PositionTool.DEFAULT_LOSS_COLOR;
  }
  /** `'LONG'` or `'SHORT'`, computed from geometry so it flips live as the drag crosses the
   *  entry (target above entry → long; below → short). */
  directionLabel() {
    const p = this.prices();
    return p && p.target >= p.entry ? "LONG" : "SHORT";
  }
  /** Direction as a settings path: reading reflects the geometry; writing the opposite value
   *  mirrors the stop AND the target across the entry, turning the trade around in place
   *  while preserving each side's distance (and therefore the R:R). */
  get direction() {
    return this.directionLabel() === "LONG" ? "long" : "short";
  }
  set direction(v) {
    const entry = this.anchors[0];
    const stop = this.anchors[1];
    const target = this.anchors[2];
    if (!entry || !stop || !target) return;
    if ((v === "long" || v === "short") && v !== this.direction) {
      stop.price = 2 * entry.price - stop.price;
      target.price = 2 * entry.price - target.price;
    }
  }
  /** Position size as a settings path: reading returns the computed size; writing back-solves
   *  the risk % so that `size × stop distance = balance × risk%` holds for the typed size. */
  get quantity() {
    return this.positionSize();
  }
  set quantity(v) {
    const p = this.prices();
    if (!p || !Number.isFinite(v) || v < 0) return;
    const dist = Math.abs(p.entry - p.stop);
    if (dist < 1e-9 || this.accountBalance <= 0) return;
    this.riskPercent = v * dist / this.accountBalance * 100;
  }
  // ── price levels as settings paths (the gear panel patches these directly) ──
  get entryPrice() {
    return this.anchors[0]?.price ?? 0;
  }
  set entryPrice(v) {
    const a = this.anchors[0];
    if (a && Number.isFinite(v)) {
      a.price = v;
      this.constrainHandleDrag(0);
    }
  }
  get stopPrice() {
    return this.anchors[1]?.price ?? 0;
  }
  set stopPrice(v) {
    const a = this.anchors[1];
    if (a && Number.isFinite(v)) {
      a.price = v;
      this.constrainHandleDrag(1);
    }
  }
  get targetPrice() {
    return this.anchors[2]?.price ?? 0;
  }
  set targetPrice(v) {
    const a = this.anchors[2];
    if (a && Number.isFinite(v)) {
      a.price = v;
      this.constrainHandleDrag(2);
    }
  }
  anchorSchema() {
    return {
      min: 2,
      max: 2,
      slots: [
        { role: "entry", free: "both" },
        { role: "stop", free: "both" },
        { role: "target", free: "both" }
      ]
    };
  }
  // Placed click-move-click (the inherited 'click' mode), consistent with the box/Gann/range tools.
  /**
   * Resolve the two placed anchors (entry + target) into the final entry/stop/target box,
   * computing the stop/width in PIXEL space so the box has a consistent visual size at any
   * scale. The second click is the profit direction — a target above the entry yields a long
   * (stop below); below yields a short. A degenerate second click (≈ the entry) falls back to
   * a default-sized long-facing box.
   */
  onPlaced(proj) {
    const e = this.anchors[0];
    if (!e) return;
    const ex = proj.xOf(e.time);
    const ey = proj.yOf(e.price, this.paneId);
    if (ey == null) return;
    const t = this.anchors[1];
    const ty = t ? proj.yOf(t.price, this.paneId) : null;
    let targetPx;
    let endPx;
    if (t && ty != null && Math.abs(ty - ey) >= _PositionTool.MIN_DRAG_PX) {
      targetPx = ty;
      endPx = ex + Math.max(Math.abs(proj.xOf(t.time) - ex), _PositionTool.MIN_WIDTH_PX);
    } else {
      targetPx = ey - _PositionTool.DEFAULT_RISK_PX * _PositionTool.DEFAULT_RR;
      endPx = ex + _PositionTool.DEFAULT_WIDTH_PX;
    }
    const stopPx = ey - (targetPx - ey) / _PositionTool.DEFAULT_RR;
    const endTime = proj.pxToPoint(endPx, ey, this.paneId).time;
    this.anchors = [
      { time: e.time, price: e.price },
      { time: endTime, price: proj.pxToPoint(ex, stopPx, this.paneId).price },
      { time: endTime, price: proj.pxToPoint(ex, targetPx, this.paneId).price }
    ];
  }
  /**
   * Keep the stop (loss) and target (reward) on OPPOSITE sides of the entry. When a handle
   * drag would put them on the same side — e.g. dragging the stop of a long up past the entry
   * (flipping it to a short) — reflect the *other* side across the entry so the two never
   * collapse onto one direction. R:R (each side's distance from entry) is preserved.
   */
  constrainHandleDrag(index) {
    const entry = this.anchors[0];
    const stop = this.anchors[1];
    const target = this.anchors[2];
    if (!entry || !stop || !target) return;
    const stopSide = Math.sign(stop.price - entry.price);
    const targetSide = Math.sign(target.price - entry.price);
    if (stopSide === 0 || targetSide === 0 || stopSide !== targetSide) return;
    if (index === 2) stop.price = 2 * entry.price - stop.price;
    else target.price = 2 * entry.price - target.price;
  }
  /** The three levels — entry, stop, target — deriving the stop while only two anchors exist
   *  (the live drag preview, before onPlaced sets the precise box). During preview the second
   *  anchor is the target (profit); after placement anchors are [entry, stop, target]. */
  resolved() {
    const e = this.anchors[0];
    const a1 = this.anchors[1];
    if (!e || !a1) return null;
    if (this.anchors[2]) return [e, a1, this.anchors[2]];
    const stop = {
      time: a1.time,
      price: e.price - (a1.price - e.price) / _PositionTool.DEFAULT_RR
    };
    return [e, stop, a1];
  }
  prices() {
    const r = this.resolved();
    return r ? { entry: r[0].price, stop: r[1].price, target: r[2].price } : null;
  }
  /** Risk:reward ratio = |target − entry| / |entry − stop| (0 when risk is degenerate). */
  rr() {
    const p = this.prices();
    if (!p) return 0;
    const risk = Math.abs(p.entry - p.stop);
    return risk < 1e-9 ? 0 : Math.abs(p.target - p.entry) / risk;
  }
  /** Reward % = |target − entry| / entry · 100. */
  rewardPct() {
    const p = this.prices();
    return p && p.entry !== 0 ? Math.abs(p.target - p.entry) / p.entry * 100 : 0;
  }
  /** Risk % of price = |entry − stop| / entry · 100 (distinct from the account riskPercent). */
  riskPct() {
    const p = this.prices();
    return p && p.entry !== 0 ? Math.abs(p.entry - p.stop) / p.entry * 100 : 0;
  }
  /** Dollar amount risked at the stop = accountBalance × riskPercent / 100. */
  dollarLoss() {
    return Math.max(0, this.accountBalance) * (Math.max(0, this.riskPercent) / 100);
  }
  /** Position size in units = dollarLoss / |entry − stop| (0 when risk is degenerate). */
  positionSize() {
    const p = this.prices();
    if (!p) return 0;
    const risk = Math.abs(p.entry - p.stop);
    return risk < 1e-9 ? 0 : this.dollarLoss() / risk;
  }
  // ── painted label lines (each respects its own toggle; the painter checks showText) ──
  /** `DIR · R:R x.xx` — the always-on header when text is shown. */
  headerLabel() {
    return `${this.directionLabel()}  \xB7  R:R ${this.rr().toFixed(2)}`;
  }
  /** `Loss $… · Size …` — the painter hides it when showLossSize is off. */
  lossSizeLabel() {
    return `Loss $${formatMoney(this.dollarLoss())}  \xB7  Size ${formatQty(this.positionSize())}`;
  }
  /** `Target +x.xx%`, with the level price appended when showPrices is on. */
  targetLabel() {
    const p = this.prices();
    const at = this.showPrices && p ? `  @ ${formatPrice(p.target)}` : "";
    return `Target +${this.rewardPct().toFixed(2)}%${at}`;
  }
  /** `Stop −x.xx%`, with the level price appended when showPrices is on. */
  stopLabel() {
    const p = this.prices();
    const at = this.showPrices && p ? `  @ ${formatPrice(p.stop)}` : "";
    return `Stop \u2212${this.riskPct().toFixed(2)}%${at}`;
  }
  // ── stop/target input units (the gear panel's Price / Points dropdowns) ──
  /** The stop or target expressed in the given unit: the absolute price, or the distance from
   *  the entry in price points. */
  levelDisplayValue(level, mode) {
    const p = this.prices();
    if (!p) return 0;
    const price = level === "stop" ? p.stop : p.target;
    if (mode === "price") return roundFloat(price);
    return roundFloat(Math.abs(price - p.entry));
  }
  /** The absolute price a typed value in the given unit resolves to. Points measure the
   *  distance from the entry; the level keeps its current side (target defaults to the profit
   *  side, stop to the loss side, when it sits exactly on the entry). */
  levelPriceFromDisplay(level, mode, value) {
    const p = this.prices();
    if (!p || mode === "price") return value;
    const current = level === "stop" ? p.stop : p.target;
    let side = Math.sign(current - p.entry);
    if (side === 0) side = (level === "target" ? 1 : -1) * (this.direction === "long" ? 1 : -1);
    return p.entry + side * Math.abs(value);
  }
  box(proj) {
    const pts = this.handlePoints(proj);
    if (pts.length < 3) return null;
    const xs = pts.map((p) => p[0]);
    return { x1: Math.min(...xs), x2: Math.max(...xs), ey: pts[0][1], sy: pts[1][1], ty: pts[2][1] };
  }
  /** Pixel layout for the painter: the box x-range + each level's y. */
  layout(proj) {
    return this.box(proj);
  }
  hitTest(px, py, proj, tol) {
    const b = this.box(proj);
    if (!b) return false;
    const top = Math.min(b.ey, b.sy, b.ty);
    const bot = Math.max(b.ey, b.sy, b.ty);
    return pointInBox(px, py, b.x1, top, b.x2, bot, tol);
  }
  handlePoints(proj) {
    const r = this.resolved();
    if (!r) return [];
    const pts = [];
    for (const a of r) {
      const y = proj.yOf(a.price, this.paneId);
      if (y == null) return [];
      pts.push([proj.xOf(a.time), y]);
    }
    return pts;
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const b = this.box(proj);
    if (!b) return null;
    const y = Math.min(b.ey, b.sy, b.ty);
    return { x: b.x1, y, w: b.x2 - b.x1, h: Math.max(b.ey, b.sy, b.ty) - y };
  }
  priceRange() {
    const r = this.resolved();
    if (!r) return null;
    const ps = r.map((a) => a.price);
    return { min: Math.min(...ps), max: Math.max(...ps) };
  }
  schema() {
    return {
      fields: [
        { path: "riskPercent", label: "Risk %", kind: "number", min: 0, max: 100, step: 0.1, group: "behavior" },
        { path: "accountBalance", label: "Account balance", kind: "number", min: 0, max: 1e12, step: 1, group: "behavior" },
        { path: "quantity", label: "Position size", kind: "number", group: "behavior" },
        { path: "direction", label: "Direction", kind: "select", options: DIRECTION_OPTIONS, group: "behavior" },
        { path: "entryPrice", label: "Entry price", kind: "number", group: "behavior" },
        { path: "stopPrice", label: "Stop price", kind: "number", group: "behavior" },
        { path: "targetPrice", label: "Target price", kind: "number", group: "behavior" },
        { path: "showText", label: "Show text", kind: "boolean", group: "behavior" },
        { path: "showHeader", label: "Show direction & ratio", kind: "boolean", group: "behavior" },
        { path: "showLossSize", label: "Show loss & size", kind: "boolean", group: "behavior" },
        { path: "showTargetLabel", label: "Show target label", kind: "boolean", group: "behavior" },
        { path: "showStopLabel", label: "Show stop label", kind: "boolean", group: "behavior" },
        { path: "showPrices", label: "Show level prices", kind: "boolean", group: "behavior" },
        { path: "profitColor", label: "Profit zone", kind: "color", group: "fill" },
        { path: "lossColor", label: "Loss zone", kind: "color", group: "fill" },
        ...LINE_FIELDS.filter((f) => f.path !== "style.lineColor"),
        { path: "text.color", label: "Text color", kind: "color", group: "text" },
        { path: "text.size", label: "Text size", kind: "select", options: TEXT_SIZE_OPTIONS, group: "text" }
      ]
    };
  }
  writeProps() {
    return {
      riskPercent: this.riskPercent,
      accountBalance: this.accountBalance,
      showText: this.showText,
      showHeader: this.showHeader,
      showPrices: this.showPrices,
      showLossSize: this.showLossSize,
      showTargetLabel: this.showTargetLabel,
      showStopLabel: this.showStopLabel,
      profitColor: this.profitColor,
      lossColor: this.lossColor
    };
  }
  readProps(props) {
    if (typeof props.riskPercent === "number" && Number.isFinite(props.riskPercent)) {
      this.riskPercent = props.riskPercent;
    }
    if (typeof props.accountBalance === "number" && Number.isFinite(props.accountBalance)) {
      this.accountBalance = props.accountBalance;
    }
    if (typeof props.showText === "boolean") this.showText = props.showText;
    if (typeof props.showHeader === "boolean") this.showHeader = props.showHeader;
    if (typeof props.showPrices === "boolean") this.showPrices = props.showPrices;
    if (typeof props.showLossSize === "boolean") this.showLossSize = props.showLossSize;
    if (typeof props.showTargetLabel === "boolean") this.showTargetLabel = props.showTargetLabel;
    if (typeof props.showStopLabel === "boolean") this.showStopLabel = props.showStopLabel;
    if (typeof props.profitColor === "string") this.profitColor = props.profitColor;
    if (typeof props.lossColor === "string") this.lossColor = props.lossColor;
  }
};
/** Default reward:risk used to derive the stop from the placed (or default) target. */
_PositionTool.DEFAULT_RR = 2;
/** Below this vertical drag (media px) a placement is treated as a bare click → default box. */
_PositionTool.MIN_DRAG_PX = 6;
_PositionTool.DEFAULT_RISK_PX = 64;
_PositionTool.DEFAULT_WIDTH_PX = 150;
_PositionTool.MIN_WIDTH_PX = 48;
_PositionTool.DEFAULT_RISK_PERCENT = 1;
_PositionTool.DEFAULT_ACCOUNT_BALANCE = 1e4;
_PositionTool.DEFAULT_PROFIT_COLOR = VALID;
_PositionTool.DEFAULT_LOSS_COLOR = INVALID;
var PositionTool = _PositionTool;
function formatMoney(n) {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
function formatQty(n) {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4).replace(/\.?0+$/, "");
  return n.toPrecision(4).replace(/\.?0+$/, "");
}
function formatPrice(n) {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toPrecision(4).replace(/\.?0+$/, "");
}
function roundFloat(n) {
  return Math.round(n * 1e8) / 1e8;
}

// src/core/drawings/types/Magnifier.ts
var MAGNIFIER_TIMEFRAME_OPTIONS = [
  { value: "auto", label: "Auto", ms: 0 },
  { value: "1", label: "1m", ms: 6e4 },
  { value: "5", label: "5m", ms: 3e5 },
  { value: "15", label: "15m", ms: 9e5 },
  { value: "30", label: "30m", ms: 18e5 },
  { value: "60", label: "1h", ms: 36e5 },
  { value: "240", label: "4h", ms: 144e5 },
  { value: "D", label: "1D", ms: 864e5 }
];
function magnifierTimeframeLabel(value) {
  const opt = MAGNIFIER_TIMEFRAME_OPTIONS.find((o) => o.value === value);
  if (opt) return opt.label;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    if (n % 1440 === 0) return `${n / 1440}D`;
    if (n % 60 === 0) return `${n / 60}h`;
    return `${n}m`;
  }
  return value;
}
function defaultMagnifierStyle() {
  return { timeframe: "auto", upColor: "", downColor: "" };
}
var Magnifier = class extends Drawing {
  constructor(init) {
    super(init);
    this.type = "magnifier";
    /** Pixel rect of the timeframe chip as painted last frame, caret included — the chip is
     *  an interactive dropdown trigger, so the interaction layer needs the exact rect the
     *  painter measured. Renderer-transient: never serialized, null while unpainted. */
    this.chipRect = null;
    if (!this.magnifier) this.magnifier = defaultMagnifierStyle();
  }
  anchorSchema() {
    return { min: 2, max: 2, slots: [{ role: "c1", free: "both" }, { role: "c2", free: "both" }] };
  }
  placementMode() {
    return "drag";
  }
  /** The pixel rectangle between the two corner anchors (painter + hit-test share it). */
  rect(proj) {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    const ya = proj.yOf(a.price, this.paneId);
    const yb = proj.yOf(b.price, this.paneId);
    if (ya == null || yb == null) return null;
    return { x1: proj.xOf(a.time), y1: ya, x2: proj.xOf(b.time), y2: yb };
  }
  hitTest(px, py, proj, tol) {
    const r = this.rect(proj);
    if (!r) return false;
    if (pointInBox(px, py, r.x1, r.y1, r.x2, r.y2)) return true;
    const edges = [
      [r.x1, r.y1, r.x2, r.y1],
      [r.x2, r.y1, r.x2, r.y2],
      [r.x2, r.y2, r.x1, r.y2],
      [r.x1, r.y2, r.x1, r.y1]
    ];
    return edges.some((e) => distToSegment(px, py, e[0], e[1], e[2], e[3]) <= tol);
  }
  handlePoints(proj) {
    const r = this.rect(proj);
    return r ? [[r.x1, r.y1], [r.x2, r.y2]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const r = this.rect(proj);
    if (!r) return null;
    return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }
  schema() {
    return {
      fields: [
        {
          path: "magnifier.timeframe",
          label: "Timeframe",
          kind: "select",
          options: MAGNIFIER_TIMEFRAME_OPTIONS,
          group: "behavior"
        },
        ...LINE_FIELDS.map((f) => ({ ...f, label: f.label.replace("Line", "Border") })),
        { path: "magnifier.upColor", label: "Up candles", kind: "color", group: "fill" },
        { path: "magnifier.downColor", label: "Down candles", kind: "color", group: "fill" }
      ]
    };
  }
  writeProps() {
    return { ...this.magnifier };
  }
  readProps(props) {
    this.magnifier = { ...defaultMagnifierStyle(), ...props };
  }
};

// src/core/drawings/registry.ts
var REGISTRY2 = /* @__PURE__ */ new Map();
function registerDrawingType(meta) {
  REGISTRY2.set(meta.type, meta);
}
function getDrawingType(type) {
  return REGISTRY2.get(type);
}
function drawingTypes() {
  return [...REGISTRY2.values()];
}
function createDrawing(type, init) {
  const meta = REGISTRY2.get(type);
  if (!meta) return null;
  const style = { ...meta.defaultStyle, ...init.style ?? {} };
  return meta.create({ ...init, style });
}
function resetDrawingSettings(drawing) {
  const fresh = createDrawing(drawing.type, { paneId: drawing.paneId });
  if (!fresh) return;
  drawing.style = { ...fresh.style };
  const keptValue = drawing.text?.value;
  if (fresh.text) {
    drawing.text = { ...fresh.text };
    if (keptValue !== void 0) drawing.text.value = keptValue;
  } else {
    drawing.text = void 0;
  }
  const props = fresh.serialize().props;
  if (props !== void 0) drawing.applyProps(props);
}
function deserializeDrawing(doc) {
  const meta = REGISTRY2.get(doc.type);
  return meta ? meta.create(doc) : null;
}
var LINE_ICON = svg24('<line x1="4" y1="19" x2="20" y2="5"/>');
var HLINE_ICON = svg24('<line x1="3" y1="12" x2="21" y2="12"/>');
registerDrawingType({
  type: "trendline",
  group: "lines",
  label: "Trend Line",
  icon: LINE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new TrendLine(init)
});
registerDrawingType({
  type: "hline",
  group: "lines",
  label: "Horizontal Line",
  icon: HLINE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "dashed" },
  create: (init) => new HorizontalLine(init)
});
var RAY_ICON = svg24('<line x1="3" y1="20" x2="21" y2="6"/><circle cx="3" cy="20" r="1.6" fill="currentColor"/>');
var BOX_ICON = svg24('<rect x="4" y="6" width="16" height="12" rx="1"/>');
var TEXT_ICON = svg24('<path d="M5 6h14M12 6v13"/>');
registerDrawingType({
  type: "ray",
  group: "lines",
  label: "Ray",
  icon: RAY_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new Ray(init)
});
var EXTLINE_ICON = svg24('<path d="M5 19 19 5"/><path d="M5 19 8.5 19M5 19 5 15.5"/><path d="M19 5 15.5 5M19 5 19 8.5"/>');
var VLINE_ICON = svg24('<line x1="12" y1="3" x2="12" y2="21"/>');
var HRAY_ICON = svg24('<line x1="5" y1="12" x2="21" y2="12"/><circle cx="5" cy="12" r="1.6" fill="currentColor"/>');
var CROSSLINE_ICON = svg24('<line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/>');
var INFOLINE_ICON = svg24('<path d="M4 20 20 4"/><rect x="9" y="9" width="9" height="6" rx="1"/>');
var TRENDANGLE_ICON = svg24('<path d="M4 20 20 6"/><path d="M4 20 15 20"/><path d="M11 20a7 7 0 0 0-2-4.9"/>');
registerDrawingType({
  type: "extendedline",
  group: "lines",
  label: "Extended Line",
  icon: EXTLINE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new ExtendedLine(init)
});
registerDrawingType({
  type: "vline",
  group: "lines",
  label: "Vertical Line",
  icon: VLINE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new VerticalLine(init)
});
registerDrawingType({
  type: "hray",
  group: "lines",
  label: "Horizontal Ray",
  icon: HRAY_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new HorizontalRay(init)
});
registerDrawingType({
  type: "crossline",
  group: "lines",
  label: "Cross Line",
  icon: CROSSLINE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new CrossLine(init)
});
registerDrawingType({
  type: "infoline",
  group: "lines",
  label: "Info Line",
  icon: INFOLINE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new InfoLine(init)
});
registerDrawingType({
  type: "trendangle",
  group: "lines",
  label: "Trend Angle",
  icon: TRENDANGLE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new TrendAngle(init)
});
registerDrawingType({
  type: "box",
  group: "shapes",
  label: "Rectangle",
  icon: BOX_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}26` },
  create: (init) => new Box(init)
});
registerDrawingType({
  type: "text",
  group: "annotations",
  label: "Text",
  icon: TEXT_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new TextLabel(init)
});
var CALLOUT_ICON = svg24('<path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-5 5v-5H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>');
registerDrawingType({
  type: "callout",
  group: "annotations",
  label: "Callout",
  icon: CALLOUT_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
  create: (init) => new Callout(init)
});
var NOTE_ICON = svg24('<path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-4 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M8 8.5h8M8 12h5"/>');
var PRICE_NOTE_ICON = svg24('<rect x="10" y="4.5" width="11" height="8" rx="1.5"/><path d="M10 8.5 4 16"/><circle cx="3.5" cy="16.5" r="1.6" fill="currentColor" stroke="none"/>');
var COMMENT_ICON = svg24('<path d="M5 4.5h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-7l-4 4v-4H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"/>');
var PRICE_LABEL_ICON = svg24('<path d="M3 12 7 8h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7Z"/><path d="M10.5 12.5h6" stroke-width="1.4"/>');
var SIGNPOST_ICON = svg24('<path d="M12 11.5V21"/><rect x="5" y="4" width="14" height="7" rx="1"/><path d="M9 7.5h6"/>');
registerDrawingType({
  type: "note",
  group: "annotations",
  label: "Note",
  icon: NOTE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
  create: (init) => new Note(init)
});
registerDrawingType({
  type: "pricenote",
  group: "annotations",
  label: "Price Note",
  icon: PRICE_NOTE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
  create: (init) => new PriceNote(init)
});
registerDrawingType({
  type: "comment",
  group: "annotations",
  label: "Comment",
  icon: COMMENT_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
  create: (init) => new Comment(init)
});
registerDrawingType({
  type: "pricelabel",
  group: "annotations",
  label: "Price Label",
  icon: PRICE_LABEL_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
  create: (init) => new PriceLabel(init)
});
registerDrawingType({
  type: "signpost",
  group: "annotations",
  label: "Signpost",
  icon: SIGNPOST_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
  create: (init) => new Signpost(init)
});
var PARALLEL_ICON = svg24('<line x1="3" y1="16" x2="21" y2="8"/><line x1="3" y1="21" x2="21" y2="13"/>');
var DISJOINT_ICON = svg24('<line x1="3" y1="7" x2="21" y2="10"/><line x1="3" y1="18" x2="21" y2="14"/>');
var PITCHFORK_ICON = svg24('<circle cx="4" cy="12" r="1.6" fill="currentColor"/><line x1="4" y1="12" x2="10" y2="12"/><line x1="10" y1="6" x2="10" y2="18"/><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>');
registerDrawingType({
  type: "parallelchannel",
  group: "channels",
  label: "Parallel Channel",
  icon: PARALLEL_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
  create: (init) => new ParallelChannel(init)
});
registerDrawingType({
  type: "disjointchannel",
  group: "channels",
  label: "Disjoint Channel",
  icon: DISJOINT_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
  create: (init) => new DisjointChannel(init)
});
var FLATTOP_ICON = svg24('<line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="18" x2="21" y2="11"/>');
registerDrawingType({
  type: "flattopbottom",
  group: "channels",
  label: "Flat Top/Bottom",
  icon: FLATTOP_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
  create: (init) => new FlatTopBottom(init)
});
var REGRESSION_ICON = svg24('<line x1="3" y1="8" x2="21" y2="4"/><line x1="3" y1="16" x2="21" y2="12"/><line x1="3" y1="12" x2="21" y2="8" stroke-dasharray="3 3"/>');
registerDrawingType({
  type: "regressionchannel",
  group: "channels",
  label: "Linear Regression",
  icon: REGRESSION_ICON,
  defaultStyle: { lineColor: NEUTRAL, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new RegressionChannel(init)
});
registerDrawingType({
  type: "pitchfork",
  group: "pitchforks",
  label: "Pitchfork",
  icon: PITCHFORK_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new Pitchfork(init)
});
var SCHIFF_ICON = svg24('<circle cx="4" cy="8" r="1.6" fill="currentColor"/><line x1="4" y1="8" x2="10" y2="12"/><line x1="10" y1="6" x2="10" y2="18"/><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>');
var MODSCHIFF_ICON = svg24('<circle cx="6" cy="9" r="1.6" fill="currentColor"/><line x1="6" y1="9" x2="10" y2="12"/><line x1="10" y1="6" x2="10" y2="18"/><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>');
var INSIDE_ICON = svg24('<line x1="4" y1="12" x2="10" y2="12"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="10" y1="8" x2="21" y2="8"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="16" x2="21" y2="16"/>');
registerDrawingType({
  type: "schiffpitchfork",
  group: "pitchforks",
  label: "Schiff Pitchfork",
  icon: SCHIFF_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new SchiffPitchfork(init)
});
registerDrawingType({
  type: "modifiedschiffpitchfork",
  group: "pitchforks",
  label: "Modified Schiff Pitchfork",
  icon: MODSCHIFF_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new ModifiedSchiffPitchfork(init)
});
registerDrawingType({
  type: "insidepitchfork",
  group: "pitchforks",
  label: "Inside Pitchfork",
  icon: INSIDE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new InsidePitchfork(init)
});
var ARROW_ICON = svg24('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>');
var ELLIPSE_ICON = svg24('<ellipse cx="12" cy="12" rx="9" ry="6"/>');
var TRIANGLE_ICON = svg24('<path d="M12 4 20 19 4 19Z"/>');
registerDrawingType({
  type: "arrow",
  group: "shapes",
  label: "Arrow",
  icon: ARROW_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid", arrowRight: true },
  create: (init) => new Arrow(init)
});
registerDrawingType({
  type: "ellipse",
  group: "shapes",
  label: "Ellipse",
  icon: ELLIPSE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
  create: (init) => new Ellipse(init)
});
registerDrawingType({
  type: "triangle",
  group: "shapes",
  label: "Triangle",
  icon: TRIANGLE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
  create: (init) => new Triangle(init)
});
var POLYLINE_ICON = svg24('<polyline points="3 17 9 10 13 14 21 5"/>');
var FREEHAND_ICON = svg24('<path d="M9.5 12 17 4.5a2.12 2.12 0 0 1 3 3L12.5 15"/><path d="M7 14a3 3 0 0 0-3 3c0 1.3-1.2 1.5-1.5 2 .8.9 2 1.5 3.5 1.5a3.5 3.5 0 0 0 3.5-3.5 3 3 0 0 0-2.5-3Z"/>');
var HIGHLIGHTER_ICON = svg24('<path d="M9 11 15 5l4 4-6 6H9Z"/><path d="M9 15l-2 2"/><path d="M4 21h6"/>');
registerDrawingType({
  type: "polyline",
  group: "shapes",
  label: "Polyline",
  icon: POLYLINE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new Polyline(init)
});
registerDrawingType({
  type: "freehand",
  group: "shapes",
  label: "Brush",
  icon: FREEHAND_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new Freehand(init)
});
registerDrawingType({
  type: "highlighter",
  group: "shapes",
  label: "Highlighter",
  icon: HIGHLIGHTER_ICON,
  // A marker: wide + translucent by default (the alpha in the color is the highlight's see-through).
  defaultStyle: { lineColor: `${MARKER}59`, lineWidth: 14, lineStyle: "solid" },
  create: (init) => new Highlighter(init)
});
var CIRCLE_ICON = svg24('<circle cx="12" cy="12" r="8"/>');
var ROTRECT_ICON = svg24('<path d="M5 14 9.5 5 19 10 14.5 19 Z"/>');
var PATH_ICON = svg24('<path d="M4 19 9 11 13 14 17 8 20 4"/><path d="M17.2 5.5 20 4 19.4 7.1"/>');
var ARC_ICON = svg24('<path d="M4 17a8 8 0 0 1 16 0"/><path d="M4 17 20 17"/>');
var CURVE_ICON = svg24('<path d="M4 18Q12 1 20 14"/>');
var ARROW_UP_ICON = svg24('<path d="M12 5 12 19"/><path d="M6 11 12 5 18 11"/>');
var ARROW_DOWN_ICON = svg24('<path d="M12 5 12 19"/><path d="M6 13 12 19 18 13"/>');
registerDrawingType({
  type: "circle",
  group: "shapes",
  label: "Circle",
  icon: CIRCLE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
  create: (init) => new Circle(init)
});
registerDrawingType({
  type: "rotatedrect",
  group: "shapes",
  label: "Rotated Rectangle",
  icon: ROTRECT_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}26` },
  create: (init) => new RotatedRect(init)
});
registerDrawingType({
  type: "path",
  group: "shapes",
  label: "Path",
  icon: PATH_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new Path(init)
});
registerDrawingType({
  type: "arc",
  group: "shapes",
  label: "Arc",
  icon: ARC_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}26` },
  create: (init) => new Arc(init)
});
registerDrawingType({
  type: "curve",
  group: "shapes",
  label: "Curve",
  icon: CURVE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new Curve(init)
});
registerDrawingType({
  type: "arrowmarkup",
  group: "shapes",
  label: "Arrow Mark Up",
  icon: ARROW_UP_ICON,
  defaultStyle: { lineColor: BULLISH, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new ArrowMarkUp(init)
});
registerDrawingType({
  type: "arrowmarkdown",
  group: "shapes",
  label: "Arrow Mark Down",
  icon: ARROW_DOWN_ICON,
  defaultStyle: { lineColor: BEARISH, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new ArrowMarkDown(init)
});
var FLAG_MARK_ICON = svg24('<path d="M6 21V4"/><path d="M6 5h11l-2.5 3.5L17 12H6" fill="currentColor" stroke="none"/>');
var ICON_STAMP_ICON = svg24('<path d="m12 3 2.6 5.8 6.4.6-4.8 4.2 1.4 6.2L12 16.9 6.4 19.8 7.8 13.6 3 9.4l6.4-.6Z"/>');
registerDrawingType({
  type: "flagmark",
  group: "stamps",
  label: "Flag",
  icon: FLAG_MARK_ICON,
  defaultStyle: { lineColor: ACCENT, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FlagMark(init)
});
registerDrawingType({
  type: "iconstamp",
  group: "stamps",
  label: "Icon",
  icon: ICON_STAMP_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new IconStamp(init)
});
var FIB_RETRACE_ICON = svg24('<line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="14" x2="21" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/>');
var FIB_EXTEND_ICON = svg24('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="11" x2="21" y2="11"/><line x1="3" y1="15" x2="14" y2="15"/><line x1="3" y1="20" x2="14" y2="20"/>');
registerDrawingType({
  type: "fibretracement",
  group: "fibonacci",
  label: "Fib Retracement",
  icon: FIB_RETRACE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FibRetracement(init)
});
registerDrawingType({
  type: "fibextension",
  group: "fibonacci",
  label: "Fib Extension",
  icon: FIB_EXTEND_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FibExtension(init)
});
var FIB_TREND_ICON = svg24('<path d="M3 20 10 9l4 5"/><path d="M14 14h7M14 9h7M14 4h7"/>');
registerDrawingType({
  type: "fibextensiontrend",
  group: "fibonacci",
  label: "Trend-Based Fib Extension",
  icon: FIB_TREND_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FibExtensionTrend(init)
});
var FIB_FAN_ICON = svg24('<path d="M4 20 20 5M4 20 21 11M4 20 21 17M4 20 20 20"/>');
var FIB_TZ_ICON = svg24('<path d="M3 5v14M6 5v14M11 5v14M19 5v14"/>');
registerDrawingType({
  type: "fibfan",
  group: "fibonacci",
  label: "Fib Fan",
  icon: FIB_FAN_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FibFan(init)
});
registerDrawingType({
  type: "fibtimezones",
  group: "fibonacci",
  label: "Fib Time Zones",
  icon: FIB_TZ_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "dashed" },
  create: (init) => new FibTimeZones(init)
});
var FIB_CHANNEL_ICON = svg24('<path d="M3 18 18 9M5 21 20 12M6 13 21 4"/>');
var FIB_SPEEDFAN_ICON = svg24('<path d="M4 4 20 20M4 4 20 12M4 4 12 20M4 4 20 4M4 4 4 20"/>');
var FIB_TRENDTIME_ICON = svg24('<path d="M3 19 9 8M9 8 12 5v14M14 5v14M18 5v14M21 5v14"/>');
registerDrawingType({
  type: "fibchannel",
  group: "fibonacci",
  label: "Fib Channel",
  icon: FIB_CHANNEL_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FibChannel(init)
});
registerDrawingType({
  type: "fibspeedfan",
  group: "fibonacci",
  label: "Fib Speed Resistance Fan",
  icon: FIB_SPEEDFAN_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FibSpeedFan(init)
});
registerDrawingType({
  type: "trendfibtime",
  group: "fibonacci",
  label: "Trend-Based Fib Time",
  icon: FIB_TRENDTIME_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "dashed" },
  create: (init) => new TrendFibTime(init)
});
var FIB_CIRCLES_ICON = svg24('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="10"/>');
var FIB_ARCS_ICON = svg24('<path d="M8 20a4 4 0 0 1 8 0"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/><circle cx="12" cy="20" r="1.4" fill="currentColor" stroke="none"/>');
var FIB_WEDGE_ICON = svg24('<path d="M4 20 20 16M4 20 14 4"/><path d="M11.8 18.1A8 8 0 0 0 8.2 13.2"/><path d="M16.6 16.9A13 13 0 0 0 10.9 9"/>');
var FIB_SPIRAL_ICON = svg24('<path d="M13 12a2 2 0 1 1-2-2 4 4 0 0 1 4 4 6 6 0 0 1-9 5.2 9 9 0 0 1 .5-15"/>');
registerDrawingType({
  type: "fibcircles",
  group: "fibonacci",
  label: "Fib Circles",
  icon: FIB_CIRCLES_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FibCircles(init)
});
registerDrawingType({
  type: "fibarcs",
  group: "fibonacci",
  label: "Fib Speed Resistance Arcs",
  icon: FIB_ARCS_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FibArcs(init)
});
registerDrawingType({
  type: "fibwedge",
  group: "fibonacci",
  label: "Fib Wedge",
  icon: FIB_WEDGE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FibWedge(init)
});
registerDrawingType({
  type: "fibspiral",
  group: "fibonacci",
  label: "Fib Spiral",
  icon: FIB_SPIRAL_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new FibSpiral(init)
});
var GANN_FAN_ICON = svg24('<path d="M4 20 20 20M4 20 20 13M4 20 20 6M4 20 15 4M4 20 9 4M4 20 4 4"/>');
var GANN_BOX_ICON = svg24('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16M4 4 20 20" opacity="0.6"/>');
registerDrawingType({
  type: "gannfan",
  group: "fibonacci",
  label: "Gann Fan",
  icon: GANN_FAN_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new GannFan(init)
});
registerDrawingType({
  type: "gannbox",
  group: "fibonacci",
  label: "Gann Box",
  icon: GANN_BOX_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new GannBox(init)
});
var GANN_SQUARE_ICON = svg24('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 20 20 4M4 20 20 12M4 20 12 4" opacity="0.7"/><path d="M4 20a16 16 0 0 1 16-16" opacity="0.5"/>');
registerDrawingType({
  type: "gannsquare",
  group: "fibonacci",
  label: "Gann Square",
  icon: GANN_SQUARE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new GannSquare(init)
});
var DEDEKIND_ICON = svg24(
  '<path d="M2 20h20"/><path d="M4 20a8 8 0 0 1 16 0" opacity="0.9"/><path d="M6 20a4 4 0 0 1 8 0" opacity="0.75"/><path d="M10 20a2 2 0 0 1 4 0" opacity="0.6"/><path d="M8 20v-6M12 20v-9M16 20v-6" opacity="0.45"/>'
);
registerDrawingType({
  type: "dedekind",
  group: "geometry",
  label: "Dedekind Tessellation",
  icon: DEDEKIND_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new DedekindTessellation(init)
});
var SONIC_ICON = svg24(
  '<circle cx="16" cy="12" r="5" opacity="0.55"/><circle cx="13" cy="12" r="3.5" opacity="0.75"/><circle cx="10.5" cy="12" r="2"/><path d="M8 4v16"/>'
);
var SUPERSONIC_ICON = svg24(
  '<circle cx="17" cy="12" r="4.5" opacity="0.45"/><circle cx="13" cy="12" r="3" opacity="0.7"/><circle cx="10" cy="12" r="1.6"/><path d="M6 12 16 5M6 12 16 19"/>'
);
registerDrawingType({
  type: "sonic",
  group: "geometry",
  label: "Sonic",
  icon: SONIC_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new Sonic(init)
});
registerDrawingType({
  type: "supersonic",
  group: "geometry",
  label: "Supersonic",
  icon: SUPERSONIC_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new Supersonic(init)
});
var GOLDEN_SONIC_ICON = svg24(
  '<circle cx="16" cy="12" r="5" opacity="0.4"/><circle cx="13" cy="12" r="3.2" opacity="0.65"/><circle cx="10.8" cy="12" r="1.8"/><path d="M8 4v16"/><path d="M15 8.5h2M12.5 10h2" opacity="0.5"/>'
);
var GOLDEN_SUPERSONIC_ICON = svg24(
  '<circle cx="17" cy="12" r="4.5" opacity="0.4"/><circle cx="12.5" cy="12" r="2.8" opacity="0.65"/><circle cx="9.8" cy="12" r="1.4"/><path d="M6 12 16 5M6 12 16 19"/>'
);
registerDrawingType({
  type: "goldensonic",
  group: "geometry",
  label: "Golden Sonic",
  icon: GOLDEN_SONIC_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new GoldenSonic(init)
});
registerDrawingType({
  type: "goldensupersonic",
  group: "geometry",
  label: "Golden Supersonic",
  icon: GOLDEN_SUPERSONIC_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new GoldenSupersonic(init)
});
var XABCD_ICON = svg24('<path d="M3 18 7 8 11 14 15 6 20 16"/>');
var ABCD_ICON = svg24('<path d="M4 17 9 7 14 15 20 5"/>');
var ELLIOTT_IMPULSE_ICON = svg24('<path d="M3 19 8 9 12 13 17 5 21 9"/>');
var ELLIOTT_CORRECTION_ICON = svg24('<path d="M4 7 11 16 20 9"/>');
var HEAD_SHOULDERS_ICON = svg24('<path d="M3 18 6 12 9 16 12 5 15 16 18 12 21 18"/>');
registerDrawingType({
  type: "xabcd",
  group: "patterns",
  label: "XABCD Pattern",
  icon: XABCD_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new XABCD(init)
});
registerDrawingType({
  type: "abcd",
  group: "patterns",
  label: "ABCD Pattern",
  icon: ABCD_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new ABCDPattern(init)
});
registerDrawingType({
  type: "elliottimpulse",
  group: "patterns",
  label: "Elliott Impulse Wave (1-5)",
  icon: ELLIOTT_IMPULSE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new ElliottImpulse(init)
});
registerDrawingType({
  type: "elliottcorrection",
  group: "patterns",
  label: "Elliott Correction Wave (ABC)",
  icon: ELLIOTT_CORRECTION_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new ElliottCorrection(init)
});
registerDrawingType({
  type: "headshoulders",
  group: "patterns",
  label: "Head & Shoulders",
  icon: HEAD_SHOULDERS_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new HeadShoulders(init)
});
var HARMONIC_ICON = svg24('<path d="M3 17 7 6 12 14 17 5 21 16"/><path d="M3 17 21 16" opacity="0.45"/>');
var harmonic = { group: "patterns", icon: HARMONIC_ICON, defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" } };
registerDrawingType({ type: "gartley", label: "Gartley", ...harmonic, create: (init) => new Gartley(init) });
registerDrawingType({ type: "bat", label: "Bat", ...harmonic, create: (init) => new Bat(init) });
registerDrawingType({ type: "butterfly", label: "Butterfly", ...harmonic, create: (init) => new Butterfly(init) });
registerDrawingType({ type: "crab", label: "Crab", ...harmonic, create: (init) => new Crab(init) });
registerDrawingType({ type: "shark", label: "Shark", ...harmonic, create: (init) => new Shark(init) });
registerDrawingType({ type: "cypher", label: "Cypher", ...harmonic, create: (init) => new Cypher(init) });
var MEASURE_ICON = svg24('<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M4 18 20 6" opacity="0.5"/>');
registerDrawingType({
  type: "datepricerange",
  group: "measure",
  label: "Date & Price Range",
  icon: MEASURE_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new DatePriceRange(init)
});
var POSITION_ICON = svg24(
  '<rect x="4.5" y="4.5" width="15" height="7.5" rx="1" fill="currentColor" fill-opacity="0.25"/><rect x="4.5" y="12" width="15" height="7.5" rx="1"/>'
);
registerDrawingType({
  type: "position",
  group: "measure",
  label: "Long/Short Position",
  icon: POSITION_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new PositionTool(init)
});
var MAGNIFIER_ICON = svg24(
  '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/><path d="M8 12.5v-3M10.5 13.5v-5.5M13 12v-2"/>'
);
registerDrawingType({
  type: "magnifier",
  group: "measure",
  label: "Magnifier",
  icon: MAGNIFIER_ICON,
  // An empty border color means the THEME's contrast ink (white on dark, black on
  // light), resolved at paint time so it follows theme switches; a user pick wins.
  defaultStyle: { lineColor: "", lineWidth: 1, lineStyle: "solid" },
  coversSeries: true,
  // the inset's backdrop must sit over the base candles it replaces
  placementHint: "Drag an area on the chart to view it at a lower timeframe",
  create: (init) => new Magnifier(init)
});
var VWAP_ICON = svg24('<line x1="5" y1="3" x2="5" y2="21"/><path d="M5 16c4 0 5-9 8-9s3 5 8 3"/>');
registerDrawingType({
  type: "anchoredvwap",
  group: "measure",
  label: "Anchored VWAP",
  icon: VWAP_ICON,
  defaultStyle: { lineColor: INFO, lineWidth: 2, lineStyle: "solid" },
  create: (init) => new AnchoredVwap(init)
});
var FRVP_ICON = svg24('<path d="M4 4v16"/><path d="M4 8h10"/><path d="M4 12h14"/><path d="M4 16h8"/><path d="M4 20h12"/>');
registerDrawingType({
  type: "fixedrangevp",
  group: "measure",
  label: "Fixed Range Volume Profile",
  icon: FRVP_ICON,
  defaultStyle: { lineColor: BULLISH, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new FixedRangeVolumeProfile(init)
});

// src/chart-types/registry.ts
function normalizeSettingsRow(r) {
  switch (r.kind) {
    case "row":
      return { label: r.label, toggle: r.toggle, controls: r.controls, when: r.when };
    case "toggle": {
      const controls = [];
      if (r.number) controls.push({ kind: "number", ...r.number });
      for (const c of r.colors ?? []) controls.push({ kind: "color", ...c });
      if (r.width) controls.push({ kind: "width", ...r.width });
      return { label: r.label, toggle: { key: r.key, defval: r.defval }, controls, when: r.when };
    }
    case "number":
      return { label: r.label, controls: [{ kind: "number", key: r.key, label: r.label, defval: r.defval, min: r.min, max: r.max, step: r.step }], when: r.when };
    case "color":
      return { label: r.label, controls: [{ kind: "color", key: r.key, label: r.label, defval: r.defval }], when: r.when };
    case "select":
      return { label: r.label, controls: [{ kind: "select", key: r.key, label: r.label, options: r.options, defval: r.defval }], when: r.when };
    case "range":
      return {
        label: r.label,
        controls: [
          { kind: "number", key: r.minKey, label: `${r.label} \u2014 min`, defval: r.defval, min: r.min, max: r.max, step: r.step, placeholder: r.placeholder },
          { kind: "hint", text: "\u2013" },
          { kind: "number", key: r.maxKey, label: `${r.label} \u2014 max`, defval: r.defval, min: r.min, max: r.max, step: r.step, placeholder: r.placeholder }
        ],
        when: r.when
      };
  }
}
function settingsRowValueKeys(r) {
  if (r.kind === "heading" || r.kind === "header") return [];
  const n = normalizeSettingsRow(r);
  const keys = [];
  if (n.toggle) keys.push({ key: n.toggle.key, type: "boolean", defval: n.toggle.defval });
  for (const c of n.controls) {
    if (c.kind === "hint") continue;
    if (c.kind === "color" || c.kind === "select") keys.push({ key: c.key, type: "string", defval: c.defval });
    else keys.push({ key: c.key, type: "number", defval: c.defval });
  }
  return keys;
}
function settingsRowVisible(when, bag) {
  if (!when) return true;
  const conds = Array.isArray(when) ? when : [when];
  return conds.every((c) => c.anyOf ? c.anyOf.some((x) => x === bag[c.key]) : bag[c.key] === c.equals);
}
var registry = /* @__PURE__ */ new Map();
function registerChartType(def) {
  registry.set(def.id, def);
}
function unregisterChartType(id) {
  registry.delete(id);
}
function chartType(id) {
  return typeof id === "string" ? registry.get(id) : void 0;
}
function chartTypes() {
  return [...registry.values()];
}
function tickerModifierIds() {
  return [...registry.values()].filter((d) => d.tickerModifier ?? d.barTransform != null).map((d) => d.id);
}

// src/core/renderer-defaults.ts
var defaults = /* @__PURE__ */ new Map();
function registerRendererDefaults(values) {
  const applied = Object.entries(values);
  for (const [key, value] of applied) defaults.set(key, value);
  return () => {
    for (const [key, value] of applied) if (defaults.get(key) === value) defaults.delete(key);
  };
}
function unregisterRendererDefaults(...keys) {
  if (keys.length === 0) defaults.clear();
  else for (const key of keys) defaults.delete(key);
}
function rendererDefaults() {
  return Object.fromEntries(defaults);
}

// src/core/model/inputs.ts
function inputVisible(when, values) {
  if (!when) return true;
  const conds = Array.isArray(when) ? when : [when];
  return conds.every((c) => c.anyOf ? c.anyOf.some((x) => x === values[c.key]) : values[c.key] === c.equals);
}
function inputDeltas(schema, values) {
  const out = {};
  for (const s of schema) {
    const v = values[s.key];
    if (v !== void 0 && JSON.stringify(v) !== JSON.stringify(s.defval)) out[s.key] = v;
  }
  return Object.keys(out).length > 0 ? out : void 0;
}

// src/renderers/native/layers.ts
function foldBaseModulation(acc, next) {
  if (next == null) return acc;
  if (acc == null) return { ...next };
  return {
    candleBodyScale: minOpt(acc.candleBodyScale, next.candleBodyScale),
    candleBodyAlpha: minOpt(acc.candleBodyAlpha, next.candleBodyAlpha),
    gridAlpha: minOpt(acc.gridAlpha, next.gridAlpha)
  };
}
function minOpt(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}
var registry2 = /* @__PURE__ */ new Map();
function registerRendererLayer(def) {
  registry2.set(def.id, def);
}
function unregisterRendererLayer(id) {
  registry2.delete(id);
}
function rendererLayers() {
  return [...registry2.values()];
}

// src/core/model/identity.ts
function stableSeriesId(parts) {
  const normTitle = parts.title.trim().toLowerCase().replace(/\s+/g, "-");
  return `${parts.instanceId}:${parts.kind}:${normTitle}#${parts.ordinal}`;
}

// src/widget/topbar-composition.ts
var TOPBAR_BUILTIN_IDS = ["symbol", "timeframes", "style", "layout", "indicators", "actions", "undo-redo", "alerts", "panels", "screenshot"];
var TOPBAR_DEFAULT_LEFT = ["symbol", "timeframes", "style", "layout", "indicators", "actions", "undo-redo"];
var TOPBAR_DEFAULT_RIGHT = ["actions", "alerts", "panels", "screenshot"];
function resolveTopbarComposition(opt) {
  const seen = /* @__PURE__ */ new Set();
  const take = (list) => {
    const out = [];
    const local = /* @__PURE__ */ new Set();
    for (const id of list) {
      if (!id || local.has(id) || id !== "actions" && seen.has(id)) continue;
      local.add(id);
      seen.add(id);
      out.push(id);
    }
    return out;
  };
  return { left: take(opt?.left ?? TOPBAR_DEFAULT_LEFT), right: take(opt?.right ?? TOPBAR_DEFAULT_RIGHT) };
}
function topbarHas(comp, id) {
  return comp.left.includes(id) || comp.right.includes(id);
}
function pinnedTopbarActionIds(comp) {
  const builtin = new Set(TOPBAR_BUILTIN_IDS);
  return [...comp.left, ...comp.right].filter((id) => !builtin.has(id));
}

// src/widget/contributions.ts
function mobilePlacement(action) {
  return action.mobile ?? (action.align === "left" ? "bar" : "menu");
}
var registry3 = /* @__PURE__ */ new Map();
var attachments = /* @__PURE__ */ new Map();
var panels = /* @__PURE__ */ new Map();
function registerWidgetAttachment(att) {
  attachments.set(att.id, att);
  return () => {
    if (attachments.get(att.id) === att) attachments.delete(att.id);
  };
}
function unregisterWidgetAttachment(id) {
  attachments.delete(id);
}
function widgetAttachments() {
  return [...attachments.values()];
}
var DEFAULT_PANEL_ORDER = 100;
function registerSidePanel(desc) {
  panels.set(desc.id, desc);
  return () => {
    if (panels.get(desc.id) === desc) panels.delete(desc.id);
  };
}
function unregisterSidePanel(id) {
  panels.delete(id);
}
function sidePanels() {
  return [...panels.values()].sort((a, b) => (a.order ?? DEFAULT_PANEL_ORDER) - (b.order ?? DEFAULT_PANEL_ORDER));
}
var OVERRIDABLE_TOPBAR_IDS = ["indicators", "screenshot"];
var overridableSet = new Set(OVERRIDABLE_TOPBAR_IDS);
var builtinTopbarSet = new Set(TOPBAR_BUILTIN_IDS);
function topbarActionOverride(id) {
  if (!overridableSet.has(id)) return void 0;
  return registry3.get(id);
}
function registerWidgetAction(desc) {
  if (builtinTopbarSet.has(desc.id) && !overridableSet.has(desc.id)) {
    console.warn(`[vela] widget action "${desc.id}": this built-in topbar slot is a stateful control and cannot be overridden \u2014 ignored. Overridable slots: ${OVERRIDABLE_TOPBAR_IDS.join(", ")}.`);
    return () => void 0;
  }
  registry3.set(desc.id, desc);
  return () => {
    if (registry3.get(desc.id) === desc) registry3.delete(desc.id);
  };
}
function unregisterWidgetAction(id) {
  registry3.delete(id);
}
function widgetActions(target, ctx) {
  const list = [...registry3.values()].filter((d) => d.target === target);
  list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return ctx ? list.filter((d) => !d.when || d.when(ctx)) : list;
}
var legendRegistry = /* @__PURE__ */ new Map();
function registerLegendAction(desc) {
  legendRegistry.set(desc.id, desc);
  return () => {
    if (legendRegistry.get(desc.id) === desc) legendRegistry.delete(desc.id);
  };
}
function unregisterLegendAction(id) {
  legendRegistry.delete(id);
}
function legendActions() {
  return [...legendRegistry.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
function legendActionsProviderFor(chart, context) {
  return (indicatorId) => {
    const handle = chart.indicators().find((h) => h.id === indicatorId);
    if (!handle) return [];
    const info = { id: handle.id, title: handle.title, ...handle.source !== void 0 ? { source: handle.source } : {} };
    return legendActions().filter((d) => !d.when || d.when(info)).map((d) => ({ id: d.id, icon: d.icon, tooltip: d.tooltip, run: () => d.run(context(), info) }));
  };
}
var calloutRegistry = /* @__PURE__ */ new Map();
function registerLegendCallout(desc) {
  calloutRegistry.set(desc.id, desc);
  return () => {
    if (calloutRegistry.get(desc.id) === desc) calloutRegistry.delete(desc.id);
  };
}
function unregisterLegendCallout(id) {
  calloutRegistry.delete(id);
}
function legendCallouts() {
  return [...calloutRegistry.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
function legendCalloutsProviderFor(chart, context) {
  return (indicatorId) => {
    const handle = chart.indicators().find((h) => h.id === indicatorId);
    if (!handle) return [];
    const info = { id: handle.id, title: handle.title, ...handle.source !== void 0 ? { source: handle.source } : {} };
    const views = [];
    for (const d of legendCallouts()) {
      const spec = d.callout(info);
      if (!spec) continue;
      views.push({
        id: d.id,
        icon: spec.icon,
        background: spec.background,
        ...spec.color !== void 0 ? { color: spec.color } : {},
        tooltip: spec.tooltip,
        ...spec.content !== void 0 ? {
          content: {
            ...spec.content.title !== void 0 ? { title: spec.content.title } : {},
            items: spec.content.items.map(
              (item) => item.type === "text" ? item : {
                type: "button",
                label: item.label,
                ...item.primary !== void 0 ? { primary: item.primary } : {},
                ...item.close !== void 0 ? { close: item.close } : {},
                run: () => item.run(context(), info)
              }
            )
          }
        } : {}
      });
    }
    return views;
  };
}
var stateHandlers = /* @__PURE__ */ new Map();
function registerStatePersistence(handler) {
  stateHandlers.set(handler.key, handler);
  return () => {
    if (stateHandlers.get(handler.key) === handler) stateHandlers.delete(handler.key);
  };
}
function unregisterStatePersistence(key) {
  stateHandlers.delete(key);
}
function statePersistenceHandlers(scope) {
  return [...stateHandlers.values()].filter((h) => h.scope === scope);
}
var symbolRankingHook;
function registerSymbolRanking(hook) {
  symbolRankingHook = hook;
  return () => {
    if (symbolRankingHook === hook) symbolRankingHook = void 0;
  };
}
function symbolRanking() {
  return symbolRankingHook;
}
var defaultEngines = /* @__PURE__ */ new Map();
function registerDefaultEngine(language, make) {
  defaultEngines.set(language, make);
  return () => {
    if (defaultEngines.get(language) === make) defaultEngines.delete(language);
  };
}
function unregisterDefaultEngine(language) {
  defaultEngines.delete(language);
}
function resolveEngines(overrides) {
  return { ...Object.fromEntries(defaultEngines), ...overrides };
}

// src/widget/side-panel.ts
var STYLE_ID = "vela-widget-sidepanel";
var DEFAULT_PANEL_WIDTH = 280;
var DEFAULT_PANEL_MIN_WIDTH = 200;
var DEFAULT_PANEL_MAX_WIDTH = 640;
var CSS = `
.vela-panel[hidden] { display: none !important; }
.vela-panel {
    position: relative;
    width: var(--vela-panel-w, ${DEFAULT_PANEL_WIDTH}px);
    flex: none;
    border-left: 1px solid var(--vela-border);
    display: flex;
    flex-direction: column;
    color: var(--vela-fg);
    font-size: 13px;
    box-sizing: border-box;
    background: var(--vela-bg);
}
.vela-panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 8px 10px 14px;
    border-bottom: 1px solid var(--vela-border);
    font-size: 14px;
    font-weight: 600;
    color: var(--vela-fg-bright);
}
.vela-panel-title { flex: none; }
.vela-panel-title:empty { display: none; }
/* The contributed slot claims the space between title and close; its children lay out
   inline and the close button stays pinned right. */
.vela-panel-header-slot { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; }
.vela-panel-close {
    all: unset;
    cursor: pointer;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
    font-size: 16px;
}
.vela-panel-close .vela-icon { width: 16px; height: 16px; }
.vela-panel-close:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
/* The pin: same footprint as the close button it sits beside; filled + bright once pinned. */
.vela-panel-pin {
    all: unset;
    cursor: pointer;
    width: 26px;
    height: 26px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
}
.vela-panel-pin .vela-icon { width: 15px; height: 15px; }
.vela-panel-pin:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-panel-pin[data-on='1'] { color: var(--vela-fg-bright); }
.vela-panel-body { flex: 1; overflow: auto; padding: 8px; }
.vela-panel-body::-webkit-scrollbar { width: 8px; }
.vela-panel-body::-webkit-scrollbar-thumb { background: var(--vela-scroll); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
/* Straddles the panel's inner border so the whole seam is grabbable; it paints only under the
   pointer \u2014 a permanently visible bar would read as a second border. */
.vela-panel-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    width: 7px;
    cursor: col-resize;
    touch-action: none;
    z-index: 1;
}
.vela-panel-resizer::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: transparent;
}
/* The same hover ink as the workspace grid splitters and the canvas pane separators, so
   every draggable seam in the shell reads as one family. */
.vela-panel-resizer:hover::after,
.vela-panel-resizer[data-dragging]::after { background: var(--vela-separator-hover-line); }
/* An OVERLAY panel floats over the chart's right edge instead of taking a column: the
   chart keeps its width and layout (the dock host is position:relative \u2014 the anchoring the
   mobile rule below relies on too). Same z-order as that mobile overlay, above the chart's
   own DOM overlays; the shadow separates it from the plot it covers. */
.vela-panel[data-overlay] {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    max-width: 100%;
    z-index: 25;
    box-shadow: var(--vela-shadow);
}
/* Mobile: a 280px column would crush a phone-width chart \u2014 the panel overlays the
   chart area instead (its flex parent is position:relative), full-bleed, closed by
   the same header \u2715. Width dragging is a pointer affordance; off on mobile. */
[data-layout='mobile'] .vela-panel {
    position: absolute;
    inset: 0;
    width: auto;
    z-index: 25;
    border-left: none;
}
[data-layout='mobile'] .vela-panel-resizer { display: none; }
`;
function clampPanelWidth(px, min = DEFAULT_PANEL_MIN_WIDTH, max = DEFAULT_PANEL_MAX_WIDTH) {
  const lo = Number.isFinite(min) && min > 0 ? min : DEFAULT_PANEL_MIN_WIDTH;
  const hi = Number.isFinite(max) ? Math.max(max, lo) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(px)) return lo;
  return Math.round(Math.min(Math.max(px, lo), hi));
}
var SidePanel = class {
  /** `modifier` is the panel's own class, carrying its content styles (e.g. `vela-ot`). */
  constructor(host, title, modifier, opts = {}) {
    /**
     * Notified whenever the panel opens or closes, by ANY path — a topbar toggle, the header ✕,
     * or another panel taking the dock. The owning shell reflects it on its chrome, so a button's
     * pressed state can never drift from the panel it controls.
     */
    this.onOpenChange = null;
    /** Notified when the USER settles a new width (drag release, or double-click reset) — never on
     *  a programmatic {@link setWidth}, so restoring a persisted width raises no change. */
    this.onWidthChange = null;
    /** Notified when the USER pins or unpins a floating panel (`overlay` is the NEW placement) —
     *  never on a programmatic {@link setOverlay}, for the same reason as widths. */
    this.onPlacementChange = null;
    this.pin = null;
    const doc = host.ownerDocument;
    injectStyles(STYLE_ID, CSS, doc);
    this.minWidth = opts.resizable ? opts.minWidth ?? DEFAULT_PANEL_MIN_WIDTH : 1;
    this.maxWidth = opts.resizable ? opts.maxWidth ?? DEFAULT_PANEL_MAX_WIDTH : Number.POSITIVE_INFINITY;
    this.declaredWidth = clampPanelWidth(opts.width ?? DEFAULT_PANEL_WIDTH, this.minWidth, this.maxWidth);
    this.widthPx = this.declaredWidth;
    this.el = doc.createElement("div");
    this.el.className = `vela-panel ${modifier}`;
    this.el.hidden = true;
    this.floatable = opts.overlay === true;
    this.overlayOn = this.floatable;
    if (this.overlayOn) this.el.dataset.overlay = "1";
    this.el.style.setProperty("--vela-panel-w", `${this.widthPx}px`);
    const header = doc.createElement("div");
    header.className = "vela-panel-header";
    this.heading = doc.createElement("span");
    this.heading.className = "vela-panel-title";
    this.heading.textContent = title;
    this.slot = doc.createElement("div");
    this.slot.className = "vela-panel-header-slot";
    const close = doc.createElement("button");
    close.className = "vela-panel-close";
    close.appendChild(iconEl("close", doc));
    close.title = "Close";
    close.addEventListener("click", () => this.toggle(false));
    if (this.floatable) {
      this.pin = doc.createElement("button");
      this.pin.className = "vela-panel-pin";
      this.pin.addEventListener("click", () => {
        this.setOverlay(!this.overlayOn);
        this.onPlacementChange?.(this.overlayOn);
      });
      this.refreshPin();
    }
    header.append(this.heading, this.slot, ...this.pin ? [this.pin] : [], close);
    this.body = doc.createElement("div");
    this.body.className = "vela-panel-body";
    this.el.append(header, this.body);
    if (opts.resizable) this.mountResizer(doc);
    host.appendChild(this.el);
  }
  get open() {
    return !this.el.hidden;
  }
  /** Open/close the panel — a bare call flips it. */
  toggle(open = this.el.hidden) {
    if (open === !this.el.hidden) return;
    this.el.hidden = !open;
    this.onOpenChange?.(open);
  }
  /** The scrolling body, for a panel filled from OUTSIDE the class — a contributed panel's
   *  `mount` receives exactly this element. Subclasses use the protected `body`. */
  get content() {
    return this.body;
  }
  /** The header slot between the title and the close button — a contributed panel's
   *  `mount` receives it (via {@link SidePanelHeader}) to dock compact controls. */
  get headerSlot() {
    return this.slot;
  }
  /** Replace the header title. The topbar toggle keeps the DECLARED title as its
   *  tooltip — this only changes what the open column says about itself. */
  setTitle(title) {
    this.heading.textContent = title;
  }
  /** Current width in px. */
  get width() {
    return this.widthPx;
  }
  /** Resize the panel (clamped). Silent — {@link onWidthChange} reports user drags only. */
  setWidth(px) {
    const next = clampPanelWidth(px, this.minWidth, this.maxWidth);
    if (next === this.widthPx) return;
    this.widthPx = next;
    this.el.style.setProperty("--vela-panel-w", `${next}px`);
  }
  /** Whether the panel floats over the chart right now (false for every docked panel). */
  get overlay() {
    return this.overlayOn;
  }
  /** Float or dock the panel. Only a panel declared `overlay` can float — on any other this is
   *  a no-op. Silent — {@link onPlacementChange} reports the user's pin clicks only. */
  setOverlay(overlay) {
    if (!this.floatable || overlay === this.overlayOn) return;
    this.overlayOn = overlay;
    if (overlay) this.el.dataset.overlay = "1";
    else delete this.el.dataset.overlay;
    this.refreshPin();
  }
  refreshPin() {
    if (!this.pin) return;
    const pinned = !this.overlayOn;
    const doc = this.pin.ownerDocument;
    this.pin.replaceChildren(iconEl(pinned ? "pin-filled" : "pin", doc));
    this.pin.dataset.on = pinned ? "1" : "0";
    this.pin.title = pinned ? "Unpin \u2014 float over the chart" : "Pin beside the chart";
    this.pin.setAttribute("aria-label", this.pin.title);
    this.pin.setAttribute("aria-pressed", pinned ? "true" : "false");
  }
  destroy() {
    this.el.remove();
  }
  /** The drag handle on the panel's inner (left) edge — the panel is docked right, so dragging
   *  AWAY from the edge widens it. Pointer capture keeps the drag alive over the chart canvas. */
  mountResizer(doc) {
    const handle = doc.createElement("div");
    handle.className = "vela-panel-resizer";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    let startX = 0;
    let startWidth = 0;
    let dragging = false;
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      delete handle.dataset.dragging;
      handle.releasePointerCapture(e.pointerId);
      if (this.widthPx !== startWidth) this.onWidthChange?.(this.widthPx);
    };
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startWidth = this.widthPx;
      handle.dataset.dragging = "1";
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.setWidth(startWidth + (startX - e.clientX));
      e.preventDefault();
    });
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("dblclick", () => {
      const before = this.widthPx;
      this.setWidth(this.declaredWidth);
      if (this.widthPx !== before) this.onWidthChange?.(this.widthPx);
    });
    this.el.appendChild(handle);
  }
};

export { AnchoredVwap, ArrowMark, Callout, CalloutBase, Comment, DEDEKIND_CURVATURE_OPTIONS, DEFAULT_DRAWING_COLOR, DEFAULT_PANEL_MAX_WIDTH, DEFAULT_PANEL_MIN_WIDTH, DEFAULT_PANEL_ORDER, DEFAULT_PANEL_WIDTH, DIRECTION_OPTIONS, DedekindTessellation, Drawing, FibRatios, FibSpiral, FixedRangeVolumeProfile, GANN_SQUARE_ARCS, GLYPH_OPTIONS, GannSquare, GlyphStamp, LINE_STYLE_OPTIONS, MACH_NUMBER_OPTIONS, MACH_WAVE_COUNT_OPTIONS, MAGNIFIER_TIMEFRAME_OPTIONS, MachFigure, Magnifier, MeasureBox, Note, OVERRIDABLE_TOPBAR_IDS, PatternDrawing, PositionTool, PriceLabel, PriceNote, RadialFib, RegressionChannel, STAMP_SIZE_OPTIONS, SegmentDrawing, SidePanel, Signpost, TEXT_SIZE_OPTIONS, TOPBAR_BUILTIN_IDS, TOPBAR_DEFAULT_LEFT, TOPBAR_DEFAULT_RIGHT, TextLabel, chartType, chartTypes, clampPanelWidth, createDrawing, deserializeDrawing, drawingTypes, foldBaseModulation, formatDuration, getDrawingType, getNativeIndicator, inputDeltas, inputVisible, isLineLikeSeries, legendActions, legendActionsProviderFor, legendCallouts, legendCalloutsProviderFor, lineSegmentIntersection, magnifierTimeframeLabel, mobilePlacement, nativeIndicatorDescriptors, nativeIndicatorTypes, nativeInstanceChannel, normalizeSettingsRow, pinnedTopbarActionIds, registerChartType, registerDefaultEngine, registerDrawingType, registerLegendAction, registerLegendCallout, registerNativeIndicator, registerRendererDefaults, registerRendererLayer, registerSidePanel, registerStatePersistence, registerSymbolRanking, registerWidgetAction, registerWidgetAttachment, rendererDefaults, rendererLayers, resetDrawingSettings, resolveEngines, resolveTopbarComposition, seriesInScale, seriesShownOn, settingsRowValueKeys, settingsRowVisible, sidePanels, stableSeriesId, statePersistenceHandlers, symbolRanking, tickerModifierIds, topbarActionOverride, topbarHas, unregisterChartType, unregisterDefaultEngine, unregisterLegendAction, unregisterLegendCallout, unregisterNativeIndicator, unregisterRendererDefaults, unregisterRendererLayer, unregisterSidePanel, unregisterStatePersistence, unregisterWidgetAction, unregisterWidgetAttachment, widgetActions, widgetAttachments };
