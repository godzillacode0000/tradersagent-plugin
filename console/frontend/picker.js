/* The quick-add picker (31 Oct) — what the Indicators button opens by default.
 *
 * The operator picked two views from a mock-up review and kept both: this compact dropdown ("Quick",
 * the default) and the slide-in panel in drawer.js ("Panel"), with a switch in each that is
 * remembered. Quick is for "just add RSI": type straight away, categories on the left (yours first:
 * Recent, Favourites, On chart), results in the middle, a preview with the picture and the write-up's
 * first lines on the right. Panel is for browsing the whole library.
 *
 * Nothing here owns data or actions. Rows come from the drawer (`libDrawer.items()`), and Run,
 * Remove, ☆ and Details go back through `libDrawer.act()`, so a run from either view is the same run
 * (one LuxAlgo script at a time, remembered across a reload) and the agent's `indicators` door, which
 * drives the panel, still sees the same state.
 *
 * This file also keeps the two small per-viewer preferences both views read: which view the button
 * opens, and the scripts used most recently. drawer.js deliberately writes no storage of its own.
 * Loaded after app.js and drawer.js (classic scripts), so their top-level names are in scope.
 */
(function () {
  'use strict';

  const VIEW_KEY = 'ta-indicators-view';
  const RECENT_KEY = 'ta-indicators-recent';
  const RECENT_MAX = 8;
  const LIST_MAX = 80;               /* rows painted at once; search still sees every script */

  const read = (key, fallback) => {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };

  const view = () => (read(VIEW_KEY, 'quick') === 'panel' ? 'panel' : 'quick');
  const setView = (v) => write(VIEW_KEY, v === 'panel' ? 'panel' : 'quick');
  const recent = () => {
    const r = read(RECENT_KEY, []);
    return Array.isArray(r) ? r.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  };
  const noteRecent = (id) => {
    if (!id) return;
    write(RECENT_KEY, [id, ...recent().filter((x) => x !== id)].slice(0, RECENT_MAX));
  };

  /* One colour per family, the same in both views. Known families get a fixed hue; anything new the
     catalogue adds gets a stable one from its name, never a random one per paint. */
  const TONES = { smc: '#a77bf3', 'smart-money-concepts': '#a77bf3', trend: '#3b9cf0', momentum: '#f0a03b',
    volume: '#2bc4a5', volatility: '#ef6f8f', oscillators: '#f0a03b', __builtin: 'var(--lx-fg-muted)', unfiled: 'var(--lx-fg-muted)' };
  const PALETTE = ['#3b9cf0', '#a77bf3', '#f0a03b', '#2bc4a5', '#ef6f8f', '#8fb83b'];
  function tone(key) {
    const k = String(key || 'unfiled').toLowerCase();
    if (TONES[k]) return TONES[k];
    let h = 0;
    for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /* `text` with every case-insensitive hit of `q` marked — each part escaped on its own. */
  function highlight(text, q) {
    const s = String(text || '');
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return esc(s);
    let out = '', at = 0;
    const low = s.toLowerCase();
    for (let i = low.indexOf(needle); i !== -1; i = low.indexOf(needle, at)) {
      out += esc(s.slice(at, i)) + '<mark>' + esc(s.slice(i, i + needle.length)) + '</mark>';
      at = i + needle.length;
    }
    return out + esc(s.slice(at));
  }

  /* ── A real preview for every built-in (31 Oct: "there must be preview of each indicator").
     Vela ships no picture for its 77 built-ins, but each one's descriptor carries the calculation the
     chart itself runs (`create().spec.compute(bars, inputs)`). So the preview IS the indicator: its
     own maths with its default settings, on the last bars of the chart that is open — overlays drawn
     over the candles, oscillators in a pane below them. Volume and the volume profile are drawn from
     the candles' own volume. Nothing is fetched; a failure leaves the tile as it was. */
  let vela = null;
  let barsSnap = { at: 0, bars: null };
  const SHOW = 90;                                    /* bars drawn; the maths sees up to 300 */
  async function previewBars() {
    if (barsSnap.bars && Date.now() - barsSnap.at < 20000) return barsSnap.bars;
    let bars = [];
    try { bars = typeof window.chartBars === 'function' ? await window.chartBars() : []; } catch { bars = []; }
    barsSnap = { at: Date.now(), bars: (bars || []).filter((b) => b && Number.isFinite(b.close)).slice(-300) };
    return barsSnap.bars;
  }
  const outputs = new Map();                          /* type -> output, for the current bars snapshot */
  async function nativeOutput(type) {
    if (!vela) vela = import('@luxalgo/vela').catch(() => null);
    const v = await vela;
    const bars = await previewBars();
    if (!v || !bars.length) return null;
    const d = v.getNativeIndicator && v.getNativeIndicator(type);
    if (!d) return null;
    const key = type + '@' + barsSnap.at;
    if (!outputs.has(key)) {
      let out = null;
      if (type !== 'volume' && type !== 'vpvr') {
        try { out = d.create().spec.compute(bars, d.defaultInputs ? d.defaultInputs() : {}); } catch { out = null; }
      }
      outputs.set(key, out);
    }
    return { bars, out: outputs.get(key), overlay: Boolean(d.overlay), type };
  }

  const UP = '#26a69a', DOWN = '#ef5350';
  function render(canvas, r) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 112, h = canvas.clientHeight || 72;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const bars = r.bars.slice(-SHOW);
    const off = r.bars.length - bars.length;
    const n = bars.length;
    const pad = 3;
    const X = (i) => pad + (i + 0.5) * ((w - 2 * pad) / n);
    const bw = Math.max(1, ((w - 2 * pad) / n) * 0.6);
    const tail = (vals) => (Array.isArray(vals) ? vals.slice(off) : []);
    const out = r.out || {};
    const plots = (out.plots || []).filter((p) => Array.isArray(p.values));
    const sub = !r.overlay && r.type !== 'vpvr';     /* oscillators (and volume) get a pane of their own */
    const priceH = sub ? h * 0.42 : h;
    // price scale: candles, plus an overlay's own values so a band is never clipped
    let lo = Infinity, hi = -Infinity;
    for (const b of bars) { lo = Math.min(lo, b.low); hi = Math.max(hi, b.high); }
    if (r.overlay) for (const p of plots) for (const v of tail(p.values)) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const span = (hi - lo) || 1;
    const PY = (v) => pad + (1 - (v - lo) / span) * (priceH - 2 * pad);
    g.globalAlpha = r.overlay || sub ? 0.5 : 0.85;
    bars.forEach((b, i) => {
      g.strokeStyle = g.fillStyle = b.close >= b.open ? UP : DOWN;
      g.beginPath(); g.moveTo(X(i), PY(b.high)); g.lineTo(X(i), PY(b.low)); g.lineWidth = 1; g.stroke();
      const y1 = PY(Math.max(b.open, b.close)), y2 = PY(Math.min(b.open, b.close));
      g.fillRect(X(i) - bw / 2, y1, bw, Math.max(1, y2 - y1));
    });
    g.globalAlpha = 1;
    if (r.type === 'vpvr') {                            // volume profile: a histogram of volume by price, on the right
      const bins = new Array(24).fill(0);
      for (const b of bars) bins[Math.min(23, Math.floor(((b.close - lo) / span) * 24))] += b.volume || 0;
      const top = Math.max(...bins) || 1;
      g.fillStyle = 'rgba(91,156,246,.45)';
      bins.forEach((v, k) => { const len = (v / top) * w * 0.35; const y = PY(lo + (k + 1) * span / 24); g.fillRect(w - pad - len, y, len, Math.max(1, (priceH - 2 * pad) / 24 - 1)); });
      return;
    }
    // the indicator's own pane (or the price pane, for an overlay)
    const top = sub ? priceH + 2 : 0, H = sub ? h - priceH - 2 : h;
    let ylo, yhi;
    if (r.type === 'volume') {
      ylo = 0; yhi = Math.max(...bars.map((b) => b.volume || 0)) || 1;
    } else if (sub) {
      ylo = Infinity; yhi = -Infinity;
      if (out.scale && Number.isFinite(out.scale.top) && Number.isFinite(out.scale.bottom)) { ylo = out.scale.bottom; yhi = out.scale.top; }
      else {
        for (const p of plots) for (const v of tail(p.values)) if (Number.isFinite(v)) { ylo = Math.min(ylo, v); yhi = Math.max(yhi, v); }
        for (const l of out.levels || []) if (Number.isFinite(l.price)) { ylo = Math.min(ylo, l.price); yhi = Math.max(yhi, l.price); }
      }
      if (!Number.isFinite(ylo)) return;
      if (yhi === ylo) { yhi += 1; ylo -= 1; }
    }
    const Y = sub ? (v) => top + pad + (1 - (v - ylo) / (yhi - ylo)) * (H - 2 * pad) : PY;
    if (sub) { g.fillStyle = 'rgba(128,128,128,.07)'; g.fillRect(0, top, w, H); }
    if (r.type === 'volume') {
      bars.forEach((b, i) => { g.fillStyle = b.close >= b.open ? 'rgba(38,166,154,.75)' : 'rgba(239,83,80,.75)'; const y = Y(b.volume || 0); g.fillRect(X(i) - bw / 2, y, bw, top + H - pad - y); });
      return;
    }
    const byKey = Object.fromEntries(plots.map((p) => [p.key, tail(p.values)]));
    for (const band of out.bands || []) {                // fills between two plots
      const a = byKey[band.from], b = byKey[band.to];
      if (!a || !b) continue;
      g.fillStyle = band.color || 'rgba(91,156,246,.1)';
      g.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) if (Number.isFinite(a[i])) { started ? g.lineTo(X(i), Y(a[i])) : g.moveTo(X(i), Y(a[i])); started = true; }
      for (let i = n - 1; i >= 0; i--) if (Number.isFinite(b[i])) g.lineTo(X(i), Y(b[i]));
      if (started) g.fill();
    }
    g.setLineDash([3, 3]); g.lineWidth = 1;
    for (const l of out.levels || []) {
      if (!Number.isFinite(l.price) || (sub && (l.price < ylo || l.price > yhi))) continue;
      g.strokeStyle = 'rgba(140,140,150,.6)';
      g.beginPath(); g.moveTo(0, Y(l.price)); g.lineTo(w, Y(l.price)); g.stroke();
    }
    g.setLineDash([]);
    for (const p of plots) {
      const vals = tail(p.values);
      const kind = p.kind || 'line';
      const cols = Array.isArray(p.colors) ? tail(p.colors) : null;
      if (kind === 'columns') {
        const base = Y(Number.isFinite(p.base) ? p.base : 0);
        vals.forEach((v, i) => { if (!Number.isFinite(v)) return; g.fillStyle = (cols && cols[i]) || p.color || '#5b9cf6'; const y = Y(v); g.fillRect(X(i) - bw / 2, Math.min(y, base), bw, Math.max(1, Math.abs(base - y))); });
      } else if (kind === 'circles' || kind === 'cross') {
        vals.forEach((v, i) => { if (!Number.isFinite(v)) return; g.fillStyle = (cols && cols[i]) || p.color || '#5b9cf6'; g.beginPath(); g.arc(X(i), Y(v), 1.3, 0, 7); g.fill(); });
      } else {
        g.strokeStyle = p.color || '#5b9cf6';
        g.lineWidth = 1.4;
        g.beginPath();
        let pen = false;
        vals.forEach((v, i) => {
          if (!Number.isFinite(v)) { pen = false; return; }
          if (!pen) { g.moveTo(X(i), Y(v)); pen = true; }
          else if (kind === 'step') { g.lineTo(X(i), Y(vals[i - 1])); g.lineTo(X(i), Y(v)); }
          else g.lineTo(X(i), Y(v));
        });
        g.stroke();
      }
    }
    // ZigZag-style segments: points carry a bar time and a price
    const t0 = bars.length ? bars[0].time : 0;
    const idx = (t) => { let k = bars.findIndex((b) => b.time >= t); return k < 0 ? n - 1 : k; };
    for (const pl of out.polylines || []) {
      const pts = (pl.points || []).filter((pt) => Number.isFinite(pt.price) && pt.x >= t0);
      if (pts.length < 2) continue;
      g.strokeStyle = pl.lineColor || '#f23645'; g.lineWidth = 1.4;
      g.beginPath(); pts.forEach((pt, k) => (k ? g.lineTo(X(idx(pt.x)), Y(pt.price)) : g.moveTo(X(idx(pt.x)), Y(pt.price)))); g.stroke();
    }
  }

  /* Draw `type`'s preview into `canvas`. Resolves true when something was drawn. */
  async function drawNative(canvas, type) {
    try {
      const r = await nativeOutput(type);
      if (!r || !canvas.isConnected) return false;
      render(canvas, r);
      canvas.classList.add('is-drawn');
      return true;
    } catch { return false; }
  }
  /* Every built-in tile still blank inside `root`, a few per frame so a long list never stalls. */
  function drawNativeTiles(root) {
    const tiles = Array.from((root || document).querySelectorAll('canvas[data-native-preview]:not(.is-drawn)'));
    const step = () => {
      const batch = tiles.splice(0, 6);
      batch.forEach((c) => drawNative(c, c.dataset.nativePreview));
      if (tiles.length) requestAnimationFrame(step);
    };
    if (tiles.length) requestAnimationFrame(step);
  }

  /* Shared with drawer.js before the dropdown's own DOM exists, so the panel never waits on it. */
  window.taIndicators = { view, setView, recent, noteRecent, tone, highlight, drawNative, drawNativeTiles };

  const ICON = {
    search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.6"/><path d="M10.6 10.6 14 14"/></svg>',
    plus: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 2v8M2 6h8"/></svg>',
    run: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.4 2.2v7.6a.6.6 0 0 0 .9.5l6-3.8a.6.6 0 0 0 0-1L4.3 1.7a.6.6 0 0 0-.9.5z" fill="currentColor"/></svg>',
  };

  const st = { open: false, q: '', cat: 'all', focus: 0, items: [], shown: [], opener: null };
  let el = null, input, rail, list, prev, debounce = null;

  function build() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'qp';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Add an indicator');
    el.innerHTML = `
      <div class="qp__top">
        <label class="qp__search">${ICON.search}
          <input type="search" autocomplete="off" spellcheck="false" placeholder="Add an indicator…"
                 aria-label="Search indicators" aria-controls="qp-list">
          <kbd class="qp-kbd">esc</kbd>
        </label>
      </div>
      <div class="qp__body">
        <nav class="qp__rail" aria-label="Categories"></nav>
        <ul class="qp__list" id="qp-list" role="listbox" aria-label="Indicators"></ul>
        <aside class="qp__prev" aria-live="polite"></aside>
      </div>
      <div class="qp__foot">
        <span class="qp__keys"><kbd class="qp-kbd">↑</kbd><kbd class="qp-kbd">↓</kbd> move</span>
        <span class="qp__keys"><kbd class="qp-kbd">↵</kbd> run</span>
        <span class="qp__keys qp__wide"><kbd class="qp-kbd">→</kbd> details</span>
        <div class="ta-viewswitch" role="group" aria-label="Indicators view">
          <button type="button" data-view="quick" aria-pressed="true">Quick</button>
          <button type="button" data-view="panel" aria-pressed="false" title="The slide-in panel: browse the whole library">Panel</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    input = el.querySelector('input');
    rail = el.querySelector('.qp__rail');
    list = el.querySelector('.qp__list');
    prev = el.querySelector('.qp__prev');

    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { st.q = input.value; st.focus = 0; paint(); list.scrollTop = 0; }, 90);
    });
    input.addEventListener('keydown', onKey);
    rail.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-cat]');
      if (!b) return;
      st.cat = b.dataset.cat;
      st.q = '';
      input.value = '';
      st.focus = 0;
      paint();
      list.scrollTop = 0;
      input.focus({ preventScroll: true });
    });
    /* Hover moves the focus (and the preview with it) without a repaint of the list. */
    list.addEventListener('pointermove', (ev) => {
      const li = ev.target.closest('.qp-row');
      if (li && Number(li.dataset.i) !== st.focus) setFocus(Number(li.dataset.i), false);
    });
    list.addEventListener('click', (ev) => {
      const li = ev.target.closest('.qp-row');
      if (!li) return;
      const i = Number(li.dataset.i);
      const act = ev.target.closest('[data-act]');
      if (act) { doAct(st.shown[i], act.dataset.act); return; }
      setFocus(i, false);
      input.focus({ preventScroll: true });
    });
    list.addEventListener('dblclick', (ev) => {
      const li = ev.target.closest('.qp-row');
      if (li && !ev.target.closest('[data-act]')) doAct(st.shown[Number(li.dataset.i)], 'primary');
    });
    prev.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]');
      if (act) doAct(st.shown[st.focus], act.dataset.act);
    });
    /* A failed preview picture becomes the same letter tile the panel uses. */
    prev.addEventListener('error', (ev) => {
      const img = ev.target;
      if (!img || img.tagName !== 'IMG') return;
      const tile = document.createElement('span');
      tile.className = 'qp__shot qp__shot--none';
      tile.textContent = (img.alt || '·').charAt(0).toUpperCase();
      img.replaceWith(tile);
    }, true);
    el.querySelector('.ta-viewswitch').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-view]');
      if (b && b.dataset.view === 'panel') switchToPanel();
    });
  }

  /* The categories: yours first, then the library's families, then the built-ins. */
  function categories() {
    const items = st.items;
    const fams = (indState.cat.groups || []).map((g) => ({
      id: g.key, label: g.name, n: items.filter((x) => !x.native && x.family === g.key).length, tone: tone(g.key),
    })).filter((c) => c.n > 0);
    const rec = recent();
    return [
      { head: 'Yours' },
      { id: 'recent', label: 'Recent', n: items.filter((x) => rec.includes(x.id)).length, tone: 'var(--lx-fg-muted)' },
      { id: 'fav', label: 'Favourites', n: items.filter((x) => x.starred).length, tone: '#f0b43b' },
      { id: 'on', label: 'On chart', n: items.filter((x) => x.on).length, tone: 'var(--lx-profit)' },
      { head: 'LuxAlgo' },
      { id: 'all', label: 'All scripts', n: items.filter((x) => !x.native).length, tone: 'var(--lx-accent)' },
      ...fams,
      { head: 'Built-in' },
      { id: 'builtin', label: 'Classic', n: items.filter((x) => x.native).length, tone: 'var(--lx-fg-muted)' },
    ];
  }

  /* "rsi" is Relative Strength Index: a name's initials are as good as its start (31 Oct: "rsi" put
     Connors RSI and Stochastic RSI above the RSI itself). */
  const initials = (name) => name.split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w[0]).join('').toLowerCase();
  function score(x, q) {
    const name = x.name.toLowerCase();
    if (initials(x.name) === q.replace(/\s+/g, '') || x.slug.toLowerCase() === q) return -1;
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (x.slug.toLowerCase().includes(q.replace(/\s+/g, '-'))) return 2;
    if ((x.famLabel + ' ' + (x.cluster || '')).toLowerCase().includes(q)) return 3;
    return 4;
  }

  function rowsFor() {
    const q = st.q.trim().toLowerCase();
    const items = st.items;
    if (q) {
      /* A search looks everywhere — LuxAlgo scripts and built-ins — whatever category is picked. */
      return items.filter((x) => (x.name + ' ' + initials(x.name) + ' ' + x.slug + ' ' + x.famLabel + ' ' + (x.cluster || '') + ' ' + (x.description || ''))
        .toLowerCase().includes(q))
        .map((x, i) => ({ x, i, s: score(x, q) })).sort((a, b) => a.s - b.s || a.i - b.i).map((o) => o.x);
    }
    switch (st.cat) {
      case 'recent': { const rec = recent(); return rec.map((id) => items.find((x) => x.id === id)).filter(Boolean); }
      case 'fav': return items.filter((x) => x.starred);
      case 'on': return items.filter((x) => x.on);
      case 'builtin': return items.filter((x) => x.native);
      case 'all': return items.filter((x) => !x.native);
      default: return items.filter((x) => !x.native && x.family === st.cat);
    }
  }

  const tag = (x) => `<span class="ta-tag" style="--t:${tone(x.family)}">${esc(x.famLabel)}</span>`;
  function primary(x) {
    if (x.on && !x.native) return { act: 'remove', html: 'Remove', cls: 'is-remove', label: 'Take it off the chart' };
    if (x.native) return { act: 'primary', html: ICON.plus + 'Add', cls: '', label: 'Add this built-in to the chart', off: !x.supported };
    return { act: 'primary', html: ICON.run + 'Run', cls: '', label: 'Run it on the chart (replaces the script that is on now)' };
  }

  function paint() {
    if (!st.open) return;
    const cat = indState.cat;
    st.items = (window.libDrawer && window.libDrawer.items) ? window.libDrawer.items() : [];
    const cats = categories();
    rail.innerHTML = cats.map((c) => c.head
      ? `<h6>${esc(c.head)}</h6>`
      : `<button type="button" class="qp-cat${!st.q && st.cat === c.id ? ' is-on' : ''}" data-cat="${esc(c.id)}"
           aria-pressed="${!st.q && st.cat === c.id}" title="${esc(c.label)}"><span class="qp-cat__sw" style="--t:${c.tone}"></span><span class="qp-cat__lbl">${esc(c.label)}</span><i>${c.n}</i></button>`).join('');
    if (cat.state !== 'ready' && !st.items.length) {
      list.innerHTML = cat.state === 'error'
        ? `<li class="qp__empty">The catalogue did not answer: ${esc(cat.error)}</li>`
        : '<li class="qp__empty">Loading the library…</li>';
      prev.innerHTML = '';
      return;
    }
    const all = rowsFor();
    st.shown = all.slice(0, LIST_MAX);
    if (st.focus >= st.shown.length) st.focus = Math.max(0, st.shown.length - 1);
    if (!st.shown.length) {
      const why = st.q ? `Nothing matches “${esc(st.q)}”.`
        : st.cat === 'recent' ? 'Nothing used yet — what you run shows up here.'
        : st.cat === 'fav' ? 'No favourites yet — ☆ a script in the Panel view.'
        : st.cat === 'on' ? 'Nothing on the chart yet.' : 'Nothing here.';
      list.innerHTML = `<li class="qp__empty">${why}</li>`;
      prev.innerHTML = '';
      return;
    }
    list.innerHTML = st.shown.map((x, i) => {
      const p = primary(x);
      return `<li class="qp-row${i === st.focus ? ' is-focus' : ''}" id="qp-opt-${i}" role="option" aria-selected="${i === st.focus}" data-i="${i}">
          <span class="qp-row__nm">${highlight(x.name, st.q)}</span>
          ${x.on ? '<span class="qp-row__on"><span class="ta-dot" aria-hidden="true"></span>on chart</span>' : tag(x)}
          <button type="button" class="qp-row__act ${p.cls}" data-act="${p.act}" aria-label="${esc(p.label)}" ${p.off ? 'disabled' : ''}>${p.html}</button>
        </li>`;
    }).join('') + (all.length > st.shown.length ? `<li class="qp__more">${all.length - st.shown.length} more — type to narrow</li>` : '');
    input.setAttribute('aria-activedescendant', 'qp-opt-' + st.focus);
    paintPreview();
  }

  function paintPreview() {
    const x = st.shown[st.focus];
    if (!x) { prev.innerHTML = ''; return; }
    const p = primary(x);
    const pic = x.native
      ? `<canvas class="qp__shot qp__shot--live" data-native-preview="${esc(x.slug)}" role="img"
           aria-label="${esc(x.name)} on the last bars of this chart"></canvas>`
      : `<img class="qp__shot" src="${esc(thumbUrl(x.slug, x.image_url, 160))}" alt="${esc(x.name)}" decoding="async">`;
    const about = x.native
      ? 'A built-in study — the preview is its own calculation, default settings, on this chart’s last bars. Add stacks it with what is already on.'
      : (x.description || 'Run it to see it on this chart, or open Details for the write-up and the Pine source.');
    prev.innerHTML = `${pic}
      <b class="qp__name">${esc(x.name)}</b>
      <div>${x.on ? '<span class="qp-row__on"><span class="ta-dot" aria-hidden="true"></span>on chart</span>' : tag(x)}</div>
      <p class="qp__about">${esc(about)}</p>
      <div class="qp__acts">
        <button type="button" class="qp-btn qp-btn--pri ${p.cls}" data-act="${p.act}" ${p.off ? 'disabled' : ''}>${p.html}${p.act === 'primary' ? ' on chart' : ''}</button>
        ${x.native ? '' : '<button type="button" class="qp-btn" data-act="details">Details</button>'}
      </div>`;
    if (x.native) drawNativeTiles(prev);
  }

  function setFocus(i, scroll) {
    if (!st.shown.length) return;
    st.focus = Math.max(0, Math.min(st.shown.length - 1, i));
    list.querySelectorAll('.qp-row').forEach((li) => {
      const on = Number(li.dataset.i) === st.focus;
      li.classList.toggle('is-focus', on);
      li.setAttribute('aria-selected', String(on));
      if (on && scroll) li.scrollIntoView({ block: 'nearest' });
    });
    input.setAttribute('aria-activedescendant', 'qp-opt-' + st.focus);
    paintPreview();
  }

  function onKey(ev) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setFocus(st.focus + 1, true); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setFocus(st.focus - 1, true); }
    else if (ev.key === 'Enter') { ev.preventDefault(); doAct(st.shown[st.focus], 'primary'); }
    else if (ev.key === 'ArrowRight' && input.selectionStart === input.value.length) {
      const x = st.shown[st.focus];
      if (x && !x.native) { ev.preventDefault(); doAct(x, 'details'); }
    } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
  }

  function doAct(x, what) {
    if (!x || !window.libDrawer || !window.libDrawer.act) return;
    if (what === 'primary' && x.native && !x.supported) return;
    close();                                  /* the run toasts its own outcome; the chart is the result */
    window.libDrawer.act(x, what === 'primary' ? 'run' : what);
  }

  /* Under the Indicators button when Vela's row shows it; across the top of a narrow pane otherwise. */
  function place() {
    const anchor = Array.from(document.querySelectorAll('.vela-widget-action-left, button'))
      .find((b) => /^\s*Indicators\s*$/.test(b.textContent || '') && b.getBoundingClientRect().width > 0);
    const W = window.innerWidth, H = window.innerHeight;
    const narrow = W < 760 || !anchor;
    el.classList.toggle('is-narrow', narrow);
    if (narrow) {
      const strip = document.getElementById('fallback-strip');
      const top = Math.max(8, strip && strip.getBoundingClientRect().height ? strip.getBoundingClientRect().bottom + 6 : 8);
      Object.assign(el.style, { left: '8px', top: top + 'px', width: (W - 16) + 'px', maxHeight: (H - top - 8) + 'px', height: '' });
      return;
    }
    const r = anchor.getBoundingClientRect();
    const width = Math.min(700, W - 16);
    const left = Math.max(8, Math.min(W - width - 8, r.left - 12));
    const top = r.bottom + 8;
    Object.assign(el.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: Math.min(460, H - top - 12) + 'px', maxHeight: '' });
  }

  const away = (ev) => {
    if (!st.open || el.contains(ev.target)) return;
    /* the button that opened it toggles it itself */
    if (st.opener && st.opener.contains && st.opener.contains(ev.target)) return;
    close();
  };

  function open() {
    build();
    st.opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    st.open = true;
    st.q = '';
    input.value = '';
    st.focus = 0;
    /* Open where it is most useful: what you used lately, else the whole library. */
    st.cat = recent().length ? 'recent' : 'all';
    if (indState.cat.state === 'idle' || indState.cat.state === 'error') loadCatalogue().then(paint);
    if (indState.natives === null) loadNatives().then(paint);
    el.hidden = false;
    place();
    paint();
    requestAnimationFrame(() => el.classList.add('is-open'));
    input.focus({ preventScroll: true });
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', place);
  }

  function close() {
    if (!st.open) return;
    st.open = false;
    el.classList.remove('is-open');
    el.hidden = true;
    document.removeEventListener('pointerdown', away, true);
    window.removeEventListener('resize', place);
    const back = st.opener && document.contains(st.opener) ? st.opener : null;
    if (el.contains(document.activeElement) && back) back.focus({ preventScroll: true });
    st.opener = null;
  }

  function switchToPanel() {
    const q = st.q;
    setView('panel');
    close();
    if (!window.libDrawer) return;
    window.libDrawer.open(true);
    if (q) window.libDrawer.search(q);
  }

  /* The one door: the Indicators button, the narrow pane's Scripts button and the palette all land here. */
  function toggle() {
    if (st.open) { close(); return; }
    if (view() === 'panel') { if (window.libDrawer) window.libDrawer.toggle(); return; }
    if (window.libDrawer && window.libDrawer.state && window.libDrawer.state().open) { window.libDrawer.open(false); return; }
    open();
  }

  /* What is on changed (a run landed, a clear) — the ● on chart marks follow while it is open. */
  window.addEventListener('ta-onchart', () => paint());

  window.closePickerIfOpen = function () {
    if (!st.open) return false;
    close();
    return true;
  };

  Object.assign(window.taIndicators, {
    open, close, toggle,
    isOpen: () => st.open,
    state: () => ({ open: st.open, view: view(), q: st.q, cat: st.cat, focus: st.focus,
                    rows: st.shown.length, recent: recent().length }),
  });
})();
