/**
 * chart-overlay — draw our own marks over the Vela chart.
 *
 * Why this exists: in this Vela build a script has NO drawing surface. `chart.drawings.add()` is
 * ignored (the wrapper needs a `userDrawingsPort` the workspace does not pass) and there is no
 * native that expresses a fair-value gap, an order block or a liquidity level. So a Library script
 * that builds its indicator out of boxes/lines/labels computes perfectly and paints nothing.
 *
 * PineTS still RETURNS that geometry — `plots.__boxes__ / __lines__ / __labels__`, with
 * `xloc: "bi"` bar indices and prices — so the honest answer is to paint it ourselves on a canvas
 * above the chart, and to say so.
 *
 * Coordinates in, pixels out. Everything the mapping needs comes from the page itself:
 *   bars   : window.chartBars()            (time + OHLC, the series the chart is showing)
 *   range  : chart.getVisibleRange()       ({from,to} in ms)
 *   plot   : the bounding rect of the price pane's canvas (excludes both axes)
 *
 * Calibration: Vela's autoscale padding is not documented, so `pricePad` (0.02 default) is applied
 * to the visible high/low and checked against the chart's own last-price line before trusting it.
 *
 * Classic script. AGPL-free: nothing here is LuxAlgo code, it only consumes their output.
 */
(function () {
  'use strict';

  const DEFAULTS = { pricePad: 0.02, barOffset: 0, font: '11px system-ui, sans-serif',
                     calibMaxAgeMs: 15000, emphasise: true };

  /** Raise a colour's alpha to at least `min` so a thin script line stays visible. Hue untouched. */
  function emphasiseColour(colour, on, min) {
    if (!on || !colour) return colour;
    let r, g, b, a = 1;
    const m = String(colour).replace(/\s+/g, '').match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const parts = m[1].split(',').map(Number);
      r = parts[0]; g = parts[1]; b = parts[2];
      a = parts.length > 3 ? parts[3] : 1;
    } else if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(colour)) {
      const h = String(colour).slice(1);
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
      a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    } else return colour;
    if (a >= min) return colour;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + min + ')';
  }
  let canvas = null;
  let host = null;
  let lastSpec = null;
  let tablesHost = null;

  /* A script's dashboard (Sharpe, profit factor, heatmap) is a Pine `table`, and Pine paints it into a
     corner of the pane. A canvas cannot hold a table, so the dashboard gets its own DOM layer over the
     chart: an HTML <table> positioned where the script asked, cells coloured as the script asked. */
  /* Where the overlay sits in the stack. The chart's own layers beat 6/7 (measured 27 Sep: a canvas
     and a table painted at 6/7 were in the DOM, in the pane, opaque — and invisible), and the
     console's own surfaces must stay above us: `--lx-z-overlay` is 30, Vela's dialog 40, toast 60,
     modal 70. So the band between the chart and the console's overlay is where this lives. */
  const CANVAS_Z = 25;
  const TABLES_Z = 26;

  const TABLE_POS = {
    top_left:      { top: 8, left: 8 },
    top_center:    { top: 8, left: '50%', cx: true },
    top_right:     { top: 8, right: 8 },
    middle_left:   { top: '50%', left: 8, cy: true },
    middle_center: { top: '50%', left: '50%', cx: true, cy: true },
    middle_right:  { top: '50%', right: 8, cy: true },
    bottom_left:   { bottom: 8, left: 8 },
    bottom_center: { bottom: 8, left: '50%', cx: true },
    bottom_right:  { bottom: 8, right: 8 }
  };
  const TABLE_SIZE = { tiny: '10px', small: '11px', normal: '12px', large: '14px', huge: '16px' };
  const TABLE_ALIGN = { left: 'left', center: 'center', right: 'right' };

  function ensureTables() {
    /* Same lesson as the overlay canvas (see `ensureCanvas`): the table host must live in the CANDLE
       canvas's parent. It sat one level up, in `#chart`, at z 26 — and a stacking context at the
       plot level that beat the canvas at z 25 (measured 29 Sep) hides a div at z 26 the same way:
       the table was in the DOM, opaque, and invisible (found again 2 Oct, from the outside). */
    const target = overlayHost() || chartEl();
    if (!target) return null;
    if (tablesHost && tablesHost.isConnected && tablesHost.parentElement === target) return tablesHost;
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    tablesHost = document.createElement('div');
    tablesHost.id = 'chart-tables';
    Object.assign(tablesHost.style, { position: 'absolute', left: '0', top: '0', right: '0',
                                      bottom: '0', zIndex: String(TABLES_Z), pointerEvents: 'none' });
    target.appendChild(tablesHost);
    return tablesHost;
  }

  /** Pine marks a covered cell `_merged` with `_merge_parent: [r0,c0]` — that parent owns the span. */
  function spanFor(cells, r, c) {
    const key = String((cells[r][c] || {})._merge_parent);
    const isChild = (rr, cc) => {
      const x = cells[rr] && cells[rr][cc];
      return !!(x && x._merged && String(x._merge_parent) === key);
    };
    let colspan = 1;
    while (c + colspan < (cells[r] || []).length && isChild(r, c + colspan)) colspan += 1;
    let rowspan = 1;
    while (r + rowspan < cells.length && isChild(r + rowspan, c)) rowspan += 1;
    return { colspan, rowspan };
  }

  /** Put the host exactly over the price pane, so "top_left" means the pane's top-left corner. */
  function placeTablesHost() {
    const hostEl = ensureTables();
    const target = chartEl();
    const pane = paneCanvas();
    if (!hostEl || !target || !pane) return hostEl;
    try {
      const t = target.getBoundingClientRect();
      const p = pane.getBoundingClientRect();
      if (p.width < 2 || p.height < 2) return hostEl;
      Object.assign(hostEl.style, {
        left: Math.round(p.x - t.x) + 'px', top: Math.round(p.y - t.y) + 'px',
        width: Math.round(p.width) + 'px', height: Math.round(p.height) + 'px',
        right: 'auto', bottom: 'auto'
      });
    } catch (err) { /* keep the whole-element box rather than nothing */ }
    return hostEl;
  }

  function paintTables(tables, rect) {
    const hostEl = placeTablesHost();
    if (!hostEl) return 0;
    hostEl.innerHTML = '';
    let painted = 0;
    for (const t of (tables || [])) {
      const cells = Array.isArray(t.cells) ? t.cells : [];
      if (!cells.length) continue;
      const where = TABLE_POS[String(t.position || 'top_right')] || TABLE_POS.top_right;
      const wrap = document.createElement('div');
      Object.assign(wrap.style, {
        position: 'absolute',
        background: t.bgcolor || 'rgba(18,18,18,0.92)',
        border: Math.max(1, Number(t.frame_width) || 1) + 'px solid ' + (t.frame_color || 'rgba(120,120,120,0.65)'),
        borderRadius: '4px', padding: '2px', fontFamily: 'system-ui, sans-serif',
        maxWidth: Math.max(140, (rect ? rect.w : 700) - 24) + 'px', overflow: 'hidden',
        boxShadow: '0 2px 10px rgba(0,0,0,0.35)'
      });
      const shift = [];
      for (const k of ['top', 'bottom', 'left', 'right']) if (where[k] != null) wrap.style[k] = where[k] + 'px';
      if (where.left === '50%') wrap.style.left = '50%';
      if (where.top === '50%') wrap.style.top = '50%';
      if (where.cx) shift.push('translateX(-50%)');
      if (where.cy) shift.push('translateY(-50%)');
      if (shift.length) wrap.style.transform = shift.join(' ');
      const tbl = document.createElement('table');
      Object.assign(tbl.style, { borderCollapse: 'collapse', fontSize: '11px' });
      for (let r = 0; r < cells.length; r++) {
        const row = cells[r] || [];
        const tr = document.createElement('tr');
        for (let c = 0; c < row.length; c++) {
          const cell = row[c] || {};
          if (cell._merged) continue;                       // covered by its parent's span
          const sp = spanFor(cells, r, c);
          const td = document.createElement('td');
          td.colSpan = sp.colspan;
          td.rowSpan = sp.rowspan;
          Object.assign(td.style, {
            color: cell.text_color || '#dbdbdb',
            background: cell.bgcolor || 'transparent',
            fontSize: TABLE_SIZE[String(cell.text_size || 'small')] || '11px',
            textAlign: TABLE_ALIGN[String(cell.text_halign || 'center')] || 'center',
            padding: '3px 6px', whiteSpace: 'nowrap', lineHeight: '1.25',
            border: Math.max(0, Number(t.border_width) || 0) + 'px solid ' + (t.border_color || 'transparent')
          });
          td.textContent = String(cell.text == null ? '' : cell.text);
          tr.appendChild(td);
        }
        tbl.appendChild(tr);
      }
      wrap.appendChild(tbl);
      hostEl.appendChild(wrap);
      painted += 1;
    }
    return painted;
  }

  function chartEl() {
    return document.getElementById('chart') || document.body;
  }

  /** The pane canvas the candles are drawn on — its rect IS the plot area. */
  function paneCanvas() {
    const hs = chartEl();
    const list = Array.from(hs.querySelectorAll('canvas')).filter((c) => c.id !== 'chart-overlay');
    if (!list.length) return null;
    let best = null;
    for (const c of list) {
      const r = c.getBoundingClientRect();
      if (!best || r.width * r.height > best.getBoundingClientRect().width * best.getBoundingClientRect().height) best = c;
    }
    return best;
  }

  /* The overlay must be the last child of the SAME parent as the candle canvas. Appending it to
     #chart at z-index 25 still lost: Vela's plot lives in its own stacking context and painted
     over us. state() then counted pixels on a canvas the operator could not see. */
  function overlayHost() {
    const plot = paneCanvas();
    return (plot && plot.parentElement) || chartEl();
  }

  function plotRect() {
    const hs = overlayHost();
    const c = paneCanvas();
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const base = hs.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
  }

  /**
   * Where the candles actually are, in pixels.
   *
   * The live pane is a WebGL surface (`getImageData` returns all-black), so the fit reads the chart's
   * OWN screenshot instead: `chart.screenshot()` returns a PNG, decoding it into a fresh 2D canvas
   * makes the pixels readable, and the topmost/bottommost candle-coloured row of that image is the
   * visible window's highest high / lowest low. Anchoring on the extremes cancels Vela's unpublished
   * autoscale padding out of the two-point fit.
   */
  let calibCache = null;
  let calibAt = 0;

  async function chartScreenshot() {
    const c = window.__consoleChart || {};
    try {
      if (typeof c.screenshot === 'function') return await c.screenshot();
      if (c.renderer && typeof c.renderer.screenshot === 'function') return await c.renderer.screenshot();
    } catch (err) { /* reported by the caller */ }
    return null;
  }

  /** Read the extremes out of the chart's own PNG. */
  async function pixelExtremes(maxAgeMs) {
    const age = Date.now() - calibAt;
    if (calibCache && age < (maxAgeMs || 15000)) return calibCache;
    const url = await chartScreenshot();
    if (!url) return null;
    let img;
    try {
      img = new Image();
      img.src = (typeof url === 'string') ? url : String(url);
      await img.decode();
    } catch (err) { return null; }
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth || img.width;
    cv.height = img.naturalHeight || img.height;
    if (!cv.width || !cv.height) return null;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    let data;
    try { data = ctx.getImageData(0, 0, cv.width, cv.height).data; } catch (err) { return null; }
    let top = Infinity, bottom = -Infinity, topX = -1, bottomX = -1;
    for (let y = 0; y < cv.height; y++) {
      const row = y * cv.width * 4;
      for (let x = 0; x < cv.width; x += 2) {
        const i = row + x * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const coloured = (mx - mn) > 55 && mx > 70;          // a candle, not grid/background
        if (!coloured) continue;
        if (y < top) { top = y; topX = x; }
        if (y > bottom) { bottom = y; bottomX = x; }
      }
    }
    if (!isFinite(top)) return null;
    const rect = plotRect();
    // The screenshot covers the whole chart area, so its lower rows are the volume pane's bars —
    // the bottom candle row is NOT the price low. Only the top extreme is trustworthy; the lower
    // bound comes from Vela's own symmetric autoscale padding, measured from that top anchor.
    const k = (rect && cv.height) ? rect.h / cv.height : 1;
    calibCache = {
      top: (rect ? rect.y : 0) + top * k,
      bottom: (rect ? rect.y : 0) + bottom * k,          // kept for diagnostics only
      imageW: cv.width, imageH: cv.height, topX, bottomX, k,
      pane: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null,
      source: 'screenshot'
    };
    calibAt = Date.now();
    return calibCache;
  }

  function ensureCanvas() {
    const target = overlayHost();
    if (!target) return null;
    if (canvas && host === target && canvas.isConnected) {
      sizeCanvas();
      target.appendChild(canvas);
      return canvas;
    }
    host = target;
    canvas = document.createElement('canvas');
    canvas.id = 'chart-overlay';
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = String(CANVAS_Z);
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.appendChild(canvas);
    sizeCanvas();
    return canvas;
  }

  function sizeCanvas() {
    if (!canvas || !host) return;
    const r = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* Vela's own coordinate system (3 Oct). The screenshot fit below GUESSED the price scale and the
     drawing was painted once, so it drifted off the candles the moment the chart scrolled, autoscaled
     or printed a bar (the operator's Order Block Detector: zigzag apex 400 USD above the high, OB
     levels floating over empty space). The renderer exposes the truth: coords.timeToX(time) and
     coords.priceToY(price, pane.scale, pane.bounds) — the very calls Vela paints its own candles with. */
  function velaRenderer() {
    const c = window.__consoleChart;
    const r = c && (c.rendererControl || c.renderer);
    const inner = r && (r.renderer || r);
    return (inner && inner.coords && inner.scene) ? inner : null;
  }

  function pricePane(rd) {
    try {
      const panes = rd.scene.orderedPanes ? rd.scene.orderedPanes() : Array.from(rd.scene.panes.values());
      return panes.find((p) => p.kind === 'price') || panes[0] || null;
    } catch (err) { return null; }
  }

  /* The bars behind every drawing. `window.chartBars()` can fall back to an HTTP fetch of
     /api/bars when the renderer will not hand its series over, and the follow loop re-maps on
     every frame that a pan or zoom changes — measured live 3 Oct: 56 /api/bars in 10 s with one
     overlay on, against a 6-per-10-s idle baseline. A pointless request storm on a laptop this
     small, so one fetch serves a whole burst: the list is held for BARS_TTL_MS. The bars only
     supply bar-index -> time; prices come from the script itself, so a few seconds of staleness
     at the live edge cannot move a drawing. */
  const BARS_TTL_MS = 5000;
  let barsCache = { at: 0, bars: [] };
  async function barsNow() {
    const now = Date.now();
    if (barsCache.bars.length && (now - barsCache.at) < BARS_TTL_MS) return barsCache.bars;
    const fetched = (typeof window.chartBars === 'function') ? await window.chartBars() : [];
    if (Array.isArray(fetched) && fetched.length) barsCache = { at: now, bars: fetched };
    return barsCache.bars;
  }

  async function nativeMapping() {
    const rd = velaRenderer();
    if (!rd) return null;
    const pane = pricePane(rd);
    const rect = plotRect();
    const bars = await barsNow();
    if (!pane || !pane.scale || !pane.bounds || !rect || !bars.length) return null;
    const co = rd.coords;
    if (typeof co.timeToX !== 'function' || typeof co.priceToY !== 'function' || !co.width) return null;
    /* The coords are in the plot's CSS pixels with the origin at the canvas's left edge. The canvas
       is WIDER than the plot — it also holds the price-axis column on the right — so `co.width` is
       the plot and `rect.w` is plot + axis. Never scale one by the other: a rect.w/co.width ratio
       stretched x by ~8% and pushed every right edge over the axis labels (3 Oct, measured). */
    const timeOf = (index) => {
      const i = Math.round(+index);
      if (i >= 0 && i < bars.length) return bars[i].openTime || bars[i].time;
      const last = bars[bars.length - 1], prev = bars[bars.length - 2] || last;
      const step = (last.openTime || last.time) - (prev.openTime || prev.time) || 60000;
      return (last.openTime || last.time) + (i - (bars.length - 1)) * step;
    };
    const b = pane.bounds;
    const sig = [co.width, co.rightEdgeLogical, co.pxPerBar ? co.pxPerBar() : 0, pane.scale.min, pane.scale.max,
                 b.top, b.height, bars.length, rect.x, rect.y, rect.w].join('|');
    return {
      native: true, sig, rect, bars: bars.length,
      i0: 0, n: bars.length, lo: pane.scale.min, hi: pane.scale.max, pad: 0,
      clip: { x: rect.x, y: rect.y + b.top, w: co.width, h: b.height },
      x: (index) => rect.x + co.timeToX(timeOf(index)),
      y: (price) => rect.y + co.priceToY(+price, pane.scale, b),
      right: rect.x + co.width,
    };
  }

  /** bar index + price -> pixel, using the chart's own visible window and its bars. */
  async function mapping(opts) {
    const nat = await nativeMapping();
    if (nat) return nat;
    return guessedMapping(opts);
  }

  async function guessedMapping(opts) {
    const O = Object.assign({}, DEFAULTS, opts || {});
    const bars = await barsNow();
    const range = (window.__consoleChart && window.__consoleChart.getVisibleRange)
      ? window.__consoleChart.getVisibleRange() : null;
    const rect = plotRect();
    if (!bars.length || !range || !rect) return null;
    let i0 = bars.findIndex((b) => (b.openTime || b.time) >= range.from);
    let i1 = bars.length - 1;
    for (let i = bars.length - 1; i >= 0; i--) {
      if ((bars[i].openTime || bars[i].time) <= range.to) { i1 = i; break; }
    }
    if (i0 < 0) i0 = 0;
    if (i1 <= i0) i1 = bars.length - 1;
    const win = bars.slice(i0, i1 + 1);
    let lo = Math.min(...win.map((b) => b.low));
    let hi = Math.max(...win.map((b) => b.high));
    const pad = (hi - lo) * O.pricePad;
    lo -= pad; hi += pad;
    const n = i1 - i0 + 1;
    const bw = rect.w / Math.max(1, n);
    const rawLo = Math.min(...win.map((b) => b.low));
    const rawHi = Math.max(...win.map((b) => b.high));
    const ex = await pixelExtremes(O.calibMaxAgeMs);
    // Two-point fit anchored on the candle extremes: the topmost candle row IS rawHi, and an
    // autoscale that pads both ends equally puts rawLo at paneBottom - (top - paneTop).
    const yTop = ex ? ex.top : rect.y;
    const padTop = ex && ex.pane ? Math.max(0, ex.top - ex.pane.y) : 0;
    const yBottom = ex && ex.pane ? (ex.pane.y + ex.pane.h - padTop) : rect.y + rect.h;
    const scale = (yBottom - yTop) / Math.max(1e-9, rawHi - rawLo);
    return {
      rect, i0, n, lo, hi, rawLo, rawHi, anchored: !!ex,
      x: (index) => rect.x + (index - O.barOffset - i0 + 0.5) * bw,
      bw,
      y: (price) => yTop + (rawHi - price) * scale,
      bars: bars.length, visible: n, pad: O.pricePad,
    };
  }

  /* The cheap signature the follow loop reads each frame: straight off the renderer, synchronous,
     no bars and no fetch. It must move whenever the candles move — a pan shifts where a fixed bar
     time sits (the two timeToX anchors), a zoom changes pxPerBar, autoscale or a new bar moves the
     price scale or the plot bounds, a pane resize moves rect. A drawing is re-mapped only when this
     signature actually changed. */
  function cheapSig() {
    const rd = velaRenderer();
    if (!rd) return null;
    const pane = pricePane(rd);
    const co = rd.coords;
    if (!pane || !pane.scale || !pane.bounds || !co || typeof co.timeToX !== 'function') return null;
    const rect = plotRect();
    if (!rect) return null;
    const b = pane.bounds;
    const ref = barsCache.bars;
    const timeAt = (i) => (ref[i] ? (ref[i].openTime || ref[i].time) : null);
    const anchorL = ref.length ? co.timeToX(timeAt(0)) : -1;
    const anchorR = ref.length ? co.timeToX(timeAt(ref.length - 1)) : -1;
    return [co.width, co.rightEdgeLogical, co.pxPerBar ? co.pxPerBar() : 0,
            pane.scale.min, pane.scale.max, b.top, b.height,
            rect.x, rect.y, rect.w, ref.length, anchorL, anchorR].join('|');
  }

  /* Follow the chart. Only a changed cheap signature re-maps and repaints, so an idle chart costs
     nothing while a pan, zoom, autoscale or new bar repaints in the same frame the candles move.
     rAF stops by itself when the pane is hidden. */
  let following = false;
  let repainting = false;
  let lastCheap = null;
  let repaints = 0;            // a pan must be provable from the door: state() carries this count
  function follow() {
    if (following) return;
    following = true;
    lastCheap = cheapSig();
    const tick = async () => {
      if (!lastSpec) { following = false; return; }
      if (!repainting) {
        const cheap = cheapSig();
        if (cheap && cheap !== lastCheap) {
          lastCheap = cheap;
          repainting = true;
          try {
            await apply(lastSpec.spec, lastSpec.opts);
            repaints += 1;                 // counted after the paint landed, never before
          } finally { repainting = false; }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function clear() {
    lastSpec = null;                               // state() reads this back as "nothing painted"
    if (tablesHost) tablesHost.innerHTML = '';
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return 1;
  }

  /** Draw a spec of boxes/lines/labels given in bar-index + price space. */
  async function apply(spec, opts) {
    const O2 = Object.assign({}, DEFAULTS, opts || {});
    const cv = ensureCanvas();
    if (!cv) return { ok: false, reason: 'no chart container to draw over' };
    const m = await mapping(opts);
    if (!m) return { ok: false, reason: 'no visible window / bars to map against' };
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save();
    if (m.clip) {                       /* never paint over the price axis or the volume pane */
      ctx.beginPath();
      ctx.rect(m.clip.x, m.clip.y, m.clip.w, m.clip.h);
      ctx.clip();
    }
    const rightEdge = m.right || (m.rect.x + m.rect.w);
    let boxes = 0, lines = 0, labels = 0, polylines = 0;

    for (const b of (spec.boxes || [])) {
      const x1 = m.x(+b.left);
      const x2 = (b.extend === 'r' || b.extend === 'both' || !isFinite(+b.right)) ? rightEdge : m.x(+b.right);
      const y1 = m.y(+b.top), y2 = m.y(+b.bottom);
      const x = Math.min(x1, x2), w = Math.max(2, Math.abs(x2 - x1));
      const yy = Math.min(y1, y2), h = Math.max(2, Math.abs(y2 - y1));
      // Faithful to the script's colours, but with a visible floor: Library scripts often emit
      // 1px borders and ~50% alpha fills, which vanish on a dark chart. `emphasise` (default on)
      // raises only the minimum — it never changes a colour's hue.
      ctx.fillStyle = emphasiseColour(b.bgcolor || 'rgba(33,87,243,0.35)', O2.emphasise !== false, 0.30);
      ctx.fillRect(x, yy, w, h);
      if (b.border_color) {
        ctx.strokeStyle = b.border_color;
        ctx.lineWidth = Math.max(b.border_width || 1, O2.emphasise !== false ? 1.6 : 1);
        ctx.strokeRect(x, yy, w, h);
      }
      boxes += 1;
    }

    for (const l of (spec.lines || [])) {
      ctx.strokeStyle = l.color || '#2157f3';
      ctx.lineWidth = Math.max(l.width || 1, O2.emphasise !== false ? 1.8 : 1);
      ctx.setLineDash(l.style && /dash/i.test(l.style) ? [5, 4] : []);
      let x1 = m.x(+l.x1), x2 = m.x(+l.x2);
      const y1 = m.y(+l.y1), y2 = m.y(+l.y2);
      // `extend: "l"` / `"r"` / `"both"` — Pine's way of saying "run off the edge".
      if (l.extend === 'l' || l.extend === 'both') x1 = 0;
      if (l.extend === 'r' || l.extend === 'both') x2 = rightEdge;
      ctx.beginPath();
      ctx.moveTo(Math.min(x1, x2), y1);
      ctx.lineTo(Math.max(x1, x2), y2);
      ctx.stroke();
      lines += 1;
    }
    ctx.setLineDash([]);

    for (const pl of (spec.polylines || [])) {
      const pts = (pl.points || []).filter((p) => p && isFinite(p.x) && isFinite(p.y));
      if (pts.length < 2) continue;
      ctx.lineWidth = Math.max(pl.width || 1, O2.emphasise !== false ? 1.6 : 1);
      ctx.setLineDash(pl.style && /dash/i.test(pl.style) ? [5, 4] : []);
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        const X = m.x(+p.x), Y = m.y(+p.y);
        if (!started) { ctx.moveTo(X, Y); started = true; } else { ctx.lineTo(X, Y); }
      }
      if (pl.closed) ctx.closePath();
      if (pl.fill) {
        ctx.fillStyle = emphasiseColour(pl.fill, O2.emphasise !== false, 0.28);
        ctx.fill();
      }
      if (pl.color) {
        ctx.strokeStyle = pl.color;
        ctx.stroke();
      } else if (!pl.fill) {
        ctx.strokeStyle = '#2157f3';
        ctx.stroke();
      }
      polylines += 1;
    }
    ctx.setLineDash([]);

    for (const t of (spec.labels || [])) {
      ctx.fillStyle = t.color || '#e6edf3';
      ctx.font = t.font || DEFAULTS.font;
      ctx.fillText(String(t.text || ''), m.x(+t.x), m.y(+t.y));
      labels += 1;
    }

    ctx.restore();
    const tables = paintTables(spec.tables, m.rect);

    lastSpec = { spec, opts, sig: m.sig || null,
                 map: { i0: m.i0, n: m.n, lo: m.lo, hi: m.hi, bars: m.bars, native: !!m.native },
                 drawn: { boxes, lines, labels, polylines, tables } };
    if (m.native) follow();
    return { ok: true, boxes, lines, labels, polylines, tables, mapping: lastSpec.map, pad: m.pad };
  }

  /**
   * What is actually on the canvas right now.
   *
   * The counts are the overlay's own record of what it painted, and `ink` is a read-back of the
   * canvas pixels (we own this 2D canvas, so unlike the chart's WebGL surface it IS readable) —
   * a coarse "is anything painted at all" check that catches a silently cleared or clipped layer.
   */




  /** Where the painted tables actually sit, measured against the pane. */
  function tablePlacement() {
    const wrap = tablesHost && tablesHost.firstElementChild;
    if (!wrap) return { inPane: null, rect: null, cells: 0 };
    let r;
    try { r = wrap.getBoundingClientRect(); } catch (err) { return { inPane: null, rect: null, cells: 0 }; }
    const pane = paneCanvas();
    let inPane = null;
    if (pane && r.width > 0 && r.height > 0) {
      const p = pane.getBoundingClientRect();
      inPane = r.right > p.left && r.left < p.right && r.bottom > p.top && r.top < p.bottom;
    }
    let paneRect = null;
    if (pane) {
      try {
        const p = pane.getBoundingClientRect();
        paneRect = { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) };
      } catch (err) { paneRect = null; }
    }
    return { inPane,
             paneRect,
             rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
             cells: wrap.querySelectorAll('td').length,
             text: (wrap.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) };
  }

  function state() {
    const d = (lastSpec && lastSpec.drawn) || { boxes: 0, lines: 0, labels: 0, tables: 0 };
    let ink = -1;
    try {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        ink = 0;
        for (let i = 3; i < img.length; i += 4 * 97) if (img[i] > 8) ink += 1;
      }
    } catch (err) {
      ink = -1;                                  // reported as unknown, never as "empty"
    }
    const tables = (tablesHost && tablesHost.childElementCount) || 0;   // read the DOM, not the wish
    /* "In the DOM" is not "on screen". A wrapper can be painted and still land outside the pane —
       a workspace container wider than the cell it belongs to, or a scrolled position — and then
       the count reads 1 while the operator sees nothing. Measured against the same pane rect the
       mapping uses, so a caller can tell the two apart instead of trusting the count. */
    const place = tablePlacement();
    /* "In the DOM" is not "visible": a layer above ours can hide a placed table (round 6, found from
       the outside — the count said 1, the pane showed nothing). Probe the TOP layer at the table's
       centre: the host is pointer-events:none, so flip it hit-testable for the call, ask the browser,
       restore. `has` counts a table only when the browser says it is actually on top — the #55 rule,
       applied to a widget that can be hidden instead of painted over. */
    let tablesVisible = null;
    const tr = place.rect;
    if (tables > 0 && tablesHost && tr && tr.w > 1 && tr.h > 1) {
      const prev = tablesHost.style.pointerEvents;
      tablesHost.style.pointerEvents = 'auto';
      try {
        const el = document.elementFromPoint(tr.x + tr.w / 2, tr.y + tr.h / 2);
        tablesVisible = !!(el && tablesHost.contains(el));
      } catch (err) { tablesVisible = null; }
      tablesHost.style.pointerEvents = prev;
    }
    return { boxes: d.boxes, lines: d.lines, labels: d.labels, tables, ink,
             repaints,
             tablesInPane: place.inPane, tablesRect: place.rect, tablesCells: place.cells,
             tablesText: place.text, paneRect: place.paneRect, tablesVisible,
             viewport: window.innerWidth + 'x' + window.innerHeight,
             has: ink > 0 || (tables > 0 && tablesVisible === true),
             canvas: canvas ? canvas.width + 'x' + canvas.height : null };
  }

  window.ChartOverlay = {
    apply, clear, state,
    get drawn() { return lastSpec; },
    debug: async (opts) => mapping(opts),
    calibrate: async (maxAgeMs) => pixelExtremes(maxAgeMs),
  };
  console.log('[chart-overlay] ready — draws agent-supplied boxes/lines over the chart');
})();
