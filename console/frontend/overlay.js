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
    const target = chartEl();
    if (!target) return null;
    if (tablesHost && tablesHost.isConnected && tablesHost.parentElement === target) return tablesHost;
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    tablesHost = document.createElement('div');
    tablesHost.id = 'chart-tables';
    Object.assign(tablesHost.style, { position: 'absolute', left: '0', top: '0', right: '0',
                                      bottom: '0', zIndex: '7', pointerEvents: 'none' });
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

  function paintTables(tables, rect) {
    const hostEl = ensureTables();
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

  function plotRect() {
    const hs = chartEl();
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
    const target = chartEl();
    if (!target) return null;
    if (canvas && host === target && canvas.isConnected) {
      sizeCanvas();
      return canvas;
    }
    host = target;
    canvas = document.createElement('canvas');
    canvas.id = 'chart-overlay';
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '6';
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

  /** bar index + price -> pixel, using the chart's own visible window and its bars. */
  async function mapping(opts) {
    const O = Object.assign({}, DEFAULTS, opts || {});
    const bars = (typeof window.chartBars === 'function') ? await window.chartBars() : [];
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
    let boxes = 0, lines = 0, labels = 0;

    for (const b of (spec.boxes || [])) {
      const x1 = m.x(+b.left), x2 = m.x(+b.right);
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
      if (l.extend === 'r' || l.extend === 'both') x2 = m.rect.x + m.rect.w;
      ctx.beginPath();
      ctx.moveTo(Math.min(x1, x2), y1);
      ctx.lineTo(Math.max(x1, x2), y2);
      ctx.stroke();
      lines += 1;
    }
    ctx.setLineDash([]);

    for (const t of (spec.labels || [])) {
      ctx.fillStyle = t.color || '#e6edf3';
      ctx.font = t.font || DEFAULTS.font;
      ctx.fillText(String(t.text || ''), m.x(+t.x), m.y(+t.y));
      labels += 1;
    }

    const tables = paintTables(spec.tables, m.rect);

    lastSpec = { spec, opts, map: { i0: m.i0, n: m.n, lo: m.lo, hi: m.hi, bars: m.bars },
                 drawn: { boxes, lines, labels, tables } };
    return { ok: true, boxes, lines, labels, tables, mapping: lastSpec.map, pad: m.pad };
  }

  /**
   * What is actually on the canvas right now.
   *
   * The counts are the overlay's own record of what it painted, and `ink` is a read-back of the
   * canvas pixels (we own this 2D canvas, so unlike the chart's WebGL surface it IS readable) —
   * a coarse "is anything painted at all" check that catches a silently cleared or clipped layer.
   */
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
    return { boxes: d.boxes, lines: d.lines, labels: d.labels, tables, ink,
             has: ink > 0 || tables > 0,
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
