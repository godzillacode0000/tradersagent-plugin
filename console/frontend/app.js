/* LuxAlgo Library × Vela — MVP frontend.
 *
 * Two halves:
 *   1. chart  — Vela (LuxAlgo's chart engine) + VelaPinets' PineEngine, both loaded
 *               from LuxAlgo's own published browser builds. Live BTCUSDT bars come
 *               from Vela's bundled BinanceProvider; if that fails we rebuild the
 *               chart on deterministic synthetic bars so the page always renders.
 *   2. library — every search/detail call goes to our backend, which proxies the
 *               LuxAlgo MCP server. No LuxAlgo code is copied into this file.
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const el = {
  q: $('#q'), form: $('#search-form'), results: $('#results'), detail: $('#detail'),
  mcp: $('#mcp-status'), bars: $('#bars-status'), count: $('#indicator-count'),
  chartLog: $('#chart-log'), chartOrigin: $('#chart-origin'), toast: $('#toast'),
  libraryPanel: $('.panel--left'), libraryToggle: $('#library-toggle'),
  main: $('.main'), libraryOpen: $('#library-open'), detailOpen: $('#detail-open'),
  libOpen: $('#lib-open'),
  browse: $('#browse'), browseToggle: $('#browse-toggle'), browseBody: $('#browse-body'),
  browseList: $('#browse-list'), browseFamilies: $('#browse-families'),
  browseCount: $('#browse-count'), browseMore: $('#browse-more'),
  browseConcepts: $('#browse-concepts'), browseConceptsTitle: $('#browse-concepts-title'),
  browseConceptsCount: $('#browse-concepts-count'), browseConceptsList: $('#browse-concepts-list'),
  browseConceptsMore: $('#browse-concepts-more'),
  browseConceptsClose: $('#browse-concepts-close'),
  scriptOpen: $('#script-open'),
  statusbar: $('.statusbar'),
};

/* ── panel layout (chart-first, 16 Sep) ──────────────────────────────────────
 * The chart owns the pane. The library and the detail panel open from their two small topbar
 * toggles, and that choice sticks across reloads. The panels follow intent, never the reverse: a
 * picked result opens the detail panel, running a search opens the library.
 */
const PANELS_KEY = 'luxalgo-web:panels';

function readPanelPrefs() {
  try { return JSON.parse(localStorage.getItem(PANELS_KEY)) || {}; } catch { return {}; }
}

/* The right column is ONE track (data-detail) carrying two views: the picked result and the
   script editor (restored 23 Sep). Opening either opens the column; the buttons follow the view
   that is actually showing, and clicking the showing one closes the column. */
function rightViewIs(name) {
  const v = document.getElementById('view-script');
  if (!v) return name === 'detail';
  return name === 'script'
    ? !v.classList.contains('view--hidden')
    : v.classList.contains('view--hidden');
}

function showRightView(which) {
  const v = document.getElementById('view-script');
  if (v) v.classList.toggle('view--hidden', which !== 'script');
  el.detail.classList.toggle('view--hidden', which === 'script');
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify({ ...readPanelPrefs(), rightview: which }));
  } catch { /* private mode */ }
}

function syncRightButtons() {
  const col = el.main.dataset.detail === 'on';
  el.detailOpen.setAttribute('aria-pressed', String(col && rightViewIs('detail')));
  el.scriptOpen.setAttribute('aria-pressed', String(col && rightViewIs('script')));
}

/* Vela repaints through its own resize observer, but a panel flip (the right column opening or
   closing, the Library appearing) can land between its frames and leave the canvas blank — the
   operator's recording showed exactly that: open the Script pane and the chart goes white, so the
   run paints onto an invisible chart. Nudge it on the next frames after every flip. */
function nudgeChart() {
  const kick = () => {
    /* The workspace owns the cells (and the resize observer that watches them); the chart owns its
       canvas. A panel flip changes the column the chart lives in, so both have to be told, and the
       page must land on the new size before the paint — hence the repeat passes. */
    window.dispatchEvent(new Event('resize'));
    try { const ws = window.__wsApp && window.__wsApp.ws; if (ws && typeof ws.resize === 'function') ws.resize(); } catch { /* bare chart */ }
    const c = chart || (window.__wsApp && window.__wsApp.activeChart && window.__wsApp.activeChart());
    if (c && typeof c.resize === 'function') {
      try { c.resize(); } catch { /* older Vela build */ }
    }
    /* resize() alone leaves the canvas blank after the column changes (proved on the live page):
       re-applying the SAME visible range forces a full redraw without moving the user's view. */
    if (c && typeof c.getVisibleRange === 'function' && typeof c.setVisibleRange === 'function') {
      try { c.setVisibleRange(c.getVisibleRange()); } catch { /* older Vela build */ }
    }
  };
  requestAnimationFrame(() => { kick(); setTimeout(kick, 90); setTimeout(kick, 320); setTimeout(kick, 700); });
}

function setPanel(name, on) {
  if (name === 'detail' || name === 'script') {
    on = Boolean(on);
    if (on) showRightView(name);
    el.main.dataset.detail = on ? 'on' : 'off';
    if (on) setPaneTop();
    syncRightButtons();
    try { localStorage.setItem(PANELS_KEY, JSON.stringify({ ...readPanelPrefs(), detail: on })); } catch { /* private mode */ }
    nudgeChart();
    return;
  }
  el.main.dataset[name] = on ? 'on' : 'off';
  if (el.libraryOpen) el.libraryOpen.setAttribute('aria-pressed', String(Boolean(on)));
  try { localStorage.setItem(PANELS_KEY, JSON.stringify({ ...readPanelPrefs(), [name]: Boolean(on) })); } catch { /* private mode */ }
  nudgeChart();
}

function togglePanel(name) {
  if (name === 'detail' || name === 'script') {
    const open = el.main.dataset.detail === 'on' && rightViewIs(name);
    setPanel(name, !open);
    return;
  }
  setPanel(name, el.main.dataset[name] !== 'on');
}

let chart = null;
let pineReady = false;
let mounted = [];
// Resolved once the chart exists (live or offline bars). Mounting awaits this so a
// fast click cannot outrun the boot sequence.
let markChartReady;
const chartReady = new Promise((resolve) => { markChartReady = resolve; });

/* The chart restores Vela's persisted studies after a reload, and the chart bridge can apply
   or add more at any time, so the chip follows the chart's own report on a light timer —
   not only when this page happens to mount something itself. */
setInterval(refreshIndicatorCount, 4000);

/* The `<>` control rides VELA's own toolbar (operator, 23 Sep: "sy nak editor script tun ikut
   sebaris toolbar Vela"). Vela's widget topbar is real DOM — no fork needed for this — so the
   live NODE moves into its right cluster: same #script-open, so the bridge's click,
   syncRightButtons' aria state and every test grepping the id keep working from wherever it
   hangs. It lands before the camera icon like the reference he sent, and takes the sibling
   tool's colour read at runtime (--vela-tool-color) so dark and light themes both fit with no
   hardcoded grey. Vela rebuilds that row on its own schedule; a rebuild only DETACHES the node
   (our reference survives innerHTML wipes), so this runs on a light timer to re-dock — and with
   no workspace row (bare chart) the control goes back to our topbar where .topbar rules apply. */
function dockScriptButton() {
  const btn = el.scriptOpen;
  if (!btn) return false;
  const slot = document.querySelector('.vela-widget-topbar .vela-topbar-right');
  if (!slot) {
    if (!btn.isConnected) {
      const home = document.querySelector('.topbar__right');
      const mcp = document.getElementById('mcp-status');
      if (home) (mcp ? home.insertBefore(btn, mcp) : home.appendChild(btn));
      btn.style.removeProperty('--vela-tool-color');
    }
    // The catalogue button travels with it: both live on Vela's row when there is one.
    const lib = el.libOpen, libHome = document.querySelector('.topbar__right');
    if (lib && !lib.isConnected && libHome) libHome.insertBefore(lib, btn.nextSibling);
    if (lib) lib.style.removeProperty('--vela-tool-color');
    return false;
  }
  if (btn.parentElement !== slot) {
    const cam = slot.querySelector('.vela-widget-screenshot');
    if (cam) slot.insertBefore(btn, cam); else slot.appendChild(btn);
  }
  // Beside `<>`, same slot, same colour read — one dock, two doors.
  const lib = el.libOpen;
  if (lib && lib.parentElement !== slot) {
    slot.insertBefore(lib, btn.nextSibling);
  }
  const sib = slot.querySelector('.vela-widget-tool');
  if (sib) {
    const colour = getComputedStyle(sib).color;
    btn.style.setProperty('--vela-tool-color', colour);
    if (lib) lib.style.setProperty('--vela-tool-color', colour);
  }
  return true;
}
setInterval(dockScriptButton, 4000);


/* F5 (25 Sep): the right column must never sit on top of the chart's own toolbar row — that is
   where Vela keeps its controls and where our Script / catalogue buttons are docked. The row is
   real DOM, so measure it; the CSS fallback covers a bare chart with no row at all. */
function setPaneTop() {
  const row = document.querySelector('.vela-widget-topbar');
  const h = row ? Math.ceil(row.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty(
    '--lx-pane-top', `calc(var(--lx-topbar-h) + ${h > 0 ? h : 44}px)`);
}
window.addEventListener('resize', setPaneTop);

/* F3 (25 Sep): one short pulse on the chart after a successful Run, so "did it draw anything?"
   has an answer on screen even while the pane is open. */
function flashChart() {
  const host = document.getElementById('chart');
  if (!host) return;
  host.classList.remove('is-painted');
  void host.offsetWidth;
  host.classList.add('is-painted');
  setTimeout(() => host.classList.remove('is-painted'), 1600);
}

/* ------------------------------------------------------------------ helpers */

/* The activity line (26 Sep, spec §5): "Last: drew 12-bar high/low", tool in the title. Only real
   mutations call this — searches and "loading…" are not "what the agent did to my chart". */
function noteActivity(text, tool) {
  const line = document.getElementById('last-action');
  if (!line) return;
  line.textContent = text;
  line.title = tool ? tool + ' · ' + text : text;
  const bar = line.closest('.statusbar');
  if (bar) bar.classList.add('has-activity');
}

function toast(message, bad = false) {
  el.toast.textContent = message;
  el.toast.className = 'toast' + (bad ? ' toast--bad' : '');
  // The footer is a message slip, not a strip: it exists only while a message is on it.
  el.statusbar.classList.toggle('is-live', Boolean(message));
  if (message) setTimeout(() => {
    if (el.toast.textContent === message) {
      el.toast.textContent = '';
      el.statusbar.classList.remove('is-live');
    }
  }, 6000);
}
/* Phase 1.3 — the stale-legend banner. The chart's own series count against the list the API can
   name; when the chart draws more than the API knows, the legend is describing a frame the console
   no longer agrees with (the AMD POC case: the legend said one indicator, the state said zero).
   A banner, not a toast: this is a state that persists until the frame is reloaded. */
function checkStaleLegend() {
  const slot = document.getElementById('stale-legend');
  if (!slot) return;
  let counts = null;
  try {
    counts = window.ChartBridge && typeof window.ChartBridge.studyCounts === 'function'
      ? window.ChartBridge.studyCounts() : null;
  } catch (err) { counts = null; }
  const bar = slot.closest('.statusbar');
  if (!counts || !counts.mismatch) {
    slot.textContent = '';
    if (bar) bar.classList.remove('has-stale');
    return;
  }
  slot.textContent = `legend shows ${counts.series} studies · the console knows ${counts.natives} — reload`;
  slot.title = 'The chart legend and the console disagree about what is on this chart';
  if (bar) bar.classList.add('has-stale');
}
setInterval(checkStaleLegend, 3000);
setTimeout(checkStaleLegend, 1500);
document.getElementById('stale-legend')?.addEventListener('click', () => window.location.reload());

/* The log line is not furniture either: it shows while it has something to say, then folds away.
   `quiet` is for the boot self-report — kept in the DOM (scripts and window.__app read it) without
   putting a permanent line under the chart. */
let logTimer;
function log(message, quiet = false) {
  el.chartLog.textContent = message;
  if (quiet) return;
  el.chartLog.classList.add('is-live');
  clearTimeout(logTimer);
  logTimer = setTimeout(() => el.chartLog.classList.remove('is-live'), 7000);
}
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

async function api(path, params = {}) {
  const url = new URL(path, location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) url.searchParams.set(k, v); });
  const res = await fetch(url);
  const payload = await res.json().catch(() => ({ ok: false, error: `bad JSON (HTTP ${res.status})` }));
  if (!payload.ok) throw new Error(payload.error || `HTTP ${res.status}`);
  return payload.data;
}

/* --------------------------------------------------------------- synthetic */
function syntheticBars(n = 400) {
  // Deterministic pseudo-random walk — same bars on every load, no network.
  let seed = 1337, price = 42000, out = [];
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    const drift = (rnd() - 0.48) * 260;
    const open = price;
    const close = Math.max(1000, open + drift);
    const high = Math.max(open, close) + rnd() * 90;
    const low = Math.min(open, close) - rnd() * 90;
    out.push({ time: start + i * 3_600_000, open, high, low, close, volume: Math.round(50 + rnd() * 300) });
    price = close;
  }
  return out;
}

/* ------------------------------------------------------------------- theme */
/* Two systems, one user action (brief §5.4): set data-theme on <html> for our
 * --lx-* palette AND hand the same string to Vela for its own shell. The chart's *colours*, though,
 * come from chart-palette.js — a theme string does not touch a renderer config that already holds
 * explicit colours. */
const THEME_KEY = 'luxalgo-web:theme';
/* The palette rules live in chart-palette.js: it parks a hand-made palette BEFORE the workspace is
 * constructed (Vela replaces the renderer config during creation), paints one of our palettes with
 * applyConfig — a theme string does not touch a config that already holds explicit colours — and
 * restores the parked copy when the console goes back to light. Here we only call it and say what
 * happened. */
function syncChartPalette(theme) {
  const cp = window.ChartPalette;
  if (!cp) return false;
  const result = cp.apply(theme);
  if (!result.ok) console.warn('[theme] chart palette not applied:', result.why);
  else if (result.restored) console.info('[theme] chart palette restored from the parked copy');
  return !!result.ok;
}

function currentTheme() {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

function applyTheme(next) {
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  // Two systems, one user action: our palette + the chart's own theme. When the
  // full workspace owns the chart, it drives its own shell theme.
  const viaWs = window.__wsApp?.setTheme ? window.__wsApp.setTheme(next) : false;
  if (!viaWs) { try { chart?.setTheme?.(next); } catch (err) { console.warn('[theme] chart.setTheme failed:', err); } }
  // …and the palette itself, because a config that already holds colours ignores the string.
  const viaPalette = syncChartPalette(next);
  log('Theme: ' + next + ' (palette' + (viaWs ? ' + workspace shell' : ' + chart') +
      (viaPalette ? ' + explicit chart palette' : '') + ')');
}

/* ------------------------------------------------------------------- chart */
function newChart(host, options) {
  const Ctor = window.Vela?.Vela ?? window.Vela;
  const Pine = window.VelaPinets?.PineEngine;
  if (typeof Ctor !== 'function') throw new Error('Vela browser build did not load');
  host.innerHTML = '';
  const instance = new Ctor(host, {
    theme: currentTheme(),
    // Vela's own defaults, written out so nobody "improves" the 650ms intro later
    animations: { zoom: true, pan: true, autoscale: true, intro: { style: 'settle', duration: 650 }, liveBar: false },
    // the app owns the theme switch, so hide Vela's own theme row
    settings: { hidden: ['advanced.bars', 'canvas.theme'] },
    ...options,
  });
  if (typeof Pine === 'function') {
    instance.registerEngine('pine', new Pine());
    pineReady = true;
  } else {
    pineReady = false;
    toast('Pine engine missing — indicators cannot be mounted', true);
  }
  return instance;
}

/* The bars pill is the longest thing in the top row, and the pane the plugin docks is ~620px wide —
   at that width the row has almost no slack left. The pill carries a hard CSS cap (#bars-status),
   and the old window-width heuristic missed the real pane width: the operator saw "bars: live ·
   wo…", a word cut in half (23 Sep pane audit). So don't guess — measure: if the full sentence
   cannot fit its own pill, show the short form. Everything the pill knows stays in `title`. */
let barsLast = null;
function setBars(text, detail) {
  barsLast = { text, detail };
  const full = detail ? text + ' · ' + detail : text;
  el.bars.textContent = full;
  el.bars.title = full;
  if (detail && el.bars.scrollWidth > el.bars.clientWidth) el.bars.textContent = text;
}
/* The pane can be resized while the page stays open — re-measure rather than keep a stale form. */
window.addEventListener('resize', () => { if (barsLast) setBars(barsLast.text, barsLast.detail); });

/* F6 (25 Sep): dragging the app's split changes this page's box, and nothing repainted it —
   measured live: #chart 360px tall inside a 295px .panel--chart, so the chart overflowed its own
   panel and the layout looked broken. One debounced handler owns every window resize: re-measure
   the pane top, re-fit the bars pill, then nudge Vela exactly as a panel flip does. Debounced
   because a drag fires dozens of times a second and nudgeChart() does repeat passes by design. */
let resizeTimer = null;
function onWindowResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    setPaneTop();
    if (typeof barsLast !== 'undefined' && barsLast) setBars(barsLast.text, barsLast.detail);
    nudgeChart();
  }, 140);
}
window.addEventListener('resize', onWindowResize);

async function bootChart() {
  const host = $('#chart');
  setBars('bars: loading…');
  el.bars.className = 'pill pill--wait';

  // Preferred path: the FULL Vela application (workspace.js). It brings the real
  // chrome — symbol/timeframe pickers, drawing toolbar, object tree, data window,
  // settings dialog, PNG export, persistence — none of which the bare chart has.
  if (window.__wsApp) {
    log('Full Vela workspace detected — adopting its active chart.');
    const ws = await window.__wsApp.ready;
    if (ws) {
      chart = window.__wsApp.activeChart();
      if (chart) {
        // Registered as the workspace `engines: { pine }` option — but whether a
        // script actually executes is still verified per mount, never assumed.
        pineReady = !!window.__wsApp.pineRegistered;
        setBars('bars: live', 'workspace cell');
        el.bars.className = 'pill pill--ok';
        el.chartOrigin.textContent = 'full Vela workspace · binance provider';
        document.body.classList.add('has-workspace');   // hides our redundant chart header
        log('Workspace active: cell chart adopted. Pine mounting remains experimental.');
        /* The workspace built its toolbar row by now — put the `<>` control on it. */
        dockScriptButton();
        unblockPineEngine();
        markChartReady(); exposeChart();
        /* The chart's stored palette is not the console's: Vela restores whatever it last saved, and a
           theme string does not rewrite explicit colours. So the console asserts its palette now, and
           a few more times over the next minute, because Vela re-applies its own at moments we do not
           control (first layout, resize, the frame becoming visible again). Switching the console to
           light restores the chart's original palette from the parked copy — see chart-palette.js. */
        syncChartPalette(currentTheme());
        window.ChartPalette?.armAfterBoot?.(currentTheme());
        return;
      }
      log('Workspace loaded but exposed no active chart — falling back to the bare chart.');
    } else {
      log('Workspace unavailable (' + (window.__wsApp.error?.message || 'failed') + ') — bare chart path.');
    }
  }

  const Binance = window.Vela?.BinanceProvider;

  if (typeof Binance === 'function') {
    try {
      chart = newChart(host, { symbol: 'BTCUSDT', timeframe: '1h' });
      chart.data.registerProvider('binance', new Binance());
      const ready = typeof chart.ready === 'function' ? chart.ready() : Promise.resolve();
      await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('provider timeout')), 12000))]);
      setBars('bars: live', 'Binance BTCUSDT 1h');
      el.bars.className = 'pill pill--ok';
      el.chartOrigin.textContent = 'provider: binance (live public data)';
      log('Live bars via Vela’s BinanceProvider. Pine engine: ' + (pineReady ? 'ready' : 'missing'));
      unblockPineEngine();
      markChartReady(); exposeChart();
      return;
    } catch (err) {
      console.warn('[boot] live provider path failed:', err);
      log('Live provider failed (' + err.message + ') — rebuilding on offline synthetic bars.');
    }
  }

  chart = newChart(host, { data: syntheticBars(400), timeframe: '1h' });
  setBars('bars: offline', 'synthetic bars');
  el.bars.className = 'pill pill--bad';
  el.chartOrigin.textContent = 'provider: none (offline bars)';
  unblockPineEngine();
  markChartReady(); exposeChart();
}

/**
 * The Pine engine only *executes* a script once the chart has been told its history is
 * complete. `addIndicator()` alone can leave a handle unprepared forever: no 'ready', no
 * 'error', no console output, no series — verified on this build (Vela 0.7.0 +
 * vela-pinets 0.2.11): the same handle sat silent for 90 s until the engine was kicked.
 *
 * CRITICAL: `chart.historyComplete()` and `chart.runIndicator(id)` return promises that
 * NEVER SETTLE on a live chart. `await`ing either one hangs the caller forever (this bit
 * the first version of this function — the click handler silently did nothing). So they
 * are always fired without awaiting, and success is decided by observing the chart.
 */
const PINE_KICK_MS = 1500;
const PINE_DEADLINE_MS = 15000;

function seriesCount() {
  try { return chart.inspect().totals.series; } catch { return -1; }
}

/** The PineTS paint layer reaches the chart through this (it may not import app.js). */
function exposeChart() { window.__consoleChart = chart; }

/**
 * The market the chart is showing, read off its own pickers.
 *
 * Vela exposes no plain market object on this build, and the picker row lists every choice
 * (30m · 4h · 1D · 1W …) beside the active one — so a "first match wins" scan reads 30m on a 1h
 * chart. Prefer whatever the page has marked active, then fall back to the old scan.
 *
 * Exposed as `window.chartMarket` so the bridge and this file agree on one reading instead of
 * keeping two scrapes that drift.
 */
function marketFromDom() {
  const host = document.getElementById('chart') || document.body;
  const texts = [];
  const active = [];
  const read = (list, el) => {
    const t = (el.textContent || '').trim();
    if (t && t.length <= 16) list.push(t);
  };
  try {
    host.querySelectorAll('button, span, div').forEach((el) => {
      if (el.children.length) return;
      read(texts, el);
    });
    host.querySelectorAll('[aria-current], [aria-pressed="true"], [aria-selected="true"], [class*="active"], [class*="selected"]')
      .forEach((el) => read(active, el));
  } catch (err) { /* a DOM that vanished mid-read is not a reason to fail a heartbeat */ }
  const sym = (t) => /^[A-Z0-9]{4,14}$/.test(t) && /(USDT|USD|USDC|BTC|ETH)$/.test(t);
  const tf = (t) => /^\d{1,3}[mhdwM]$/.test(t);
  return {
    symbol: active.find(sym) || texts.find(sym) || null,
    interval: active.find(tf) || texts.find(tf) || null,
  };
}

/**
 * The bars PineTS runs over. Vela does not document one public bars getter across
 * builds, so try each accessor that exists and fall back to the venue's own public
 * endpoint — for the market the chart is actually showing, so the series line up by time.
 */
async function chartBars() {
  const c = chart;
  if (!c) return [];
  const pick = (v) => (Array.isArray(v) && v.length ? v : null);
  try { const b = pick(typeof c.getBars === 'function' ? c.getBars() : null); if (b) return b; } catch {}
  try {
    const m = c.market;
    const b = pick(m && (m.data || m.bars));
    if (b) return b;
  } catch {}
  try {
    const d = c.data;
    const b = pick(typeof d?.bars === 'function' ? d.bars() : null) || pick(d?.bars);
    if (b) return b;
  } catch {}
  try {
    // NEVER a hardcoded symbol here: this fallback used to fetch BTCUSDT regardless of the chart,
    // so every study and every reported number was computed on a different market than the one on
    // screen (a SOLUSDT chart reporting 81,305 as its last price — read off a bridge that believed
    // the chart). Ask the chart what it is showing; no bars is an honest answer.
    const m = (typeof window.chartMarket === 'function') ? window.chartMarket() : marketFromDom();
    const symbol = m && m.symbol;
    const interval = (m && m.interval) || '1h';
    if (!symbol) return [];
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`);
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length) {
      return rows.map(([t, o, h, l, cl, v]) => ({
        time: t, open: +o, high: +h, low: +l, close: +cl, volume: +v
      }));
    }
  } catch {}
  return [];
}

/* The agent desk (agent-dock.js) runs the same scripts through the same bars — one accessor, not two. */
window.chartBars = chartBars;
window.chartMarket = marketFromDom;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Mark the bar history final so engines may run. Never awaited — see note above. */
function unblockPineEngine(handle) {
  try {
    chart.historyComplete?.();
    if (handle?.id) chart.runIndicator?.(handle.id);
    log('Engine kick sent (historyComplete' + (handle?.id ? ' + runIndicator' : '') + ')');
  } catch (err) { console.warn('[pine] engine kick failed:', err); }
}

/**
 * Mount a Pine script and do not resolve until it has actually executed.
 * Resolves true only on a real signal: the handle fired 'ready', or a new series
 * appeared on the chart. Never trusts the addIndicator call itself.
 */
async function mountIndicator(source, name) {
  if (!pineReady) throw new Error('Pine engine not registered');
  if (typeof chart.addIndicator !== 'function') throw new Error('addIndicator unavailable in this Vela build');

  const before = seriesCount();
  const handle = chart.addIndicator(source);

  let ready = false;
  let engineError = null;
  if (handle && handle.on) {
    handle.on('ready', () => { ready = true; });
    handle.on('error', (e) => { engineError = e; });
  }

  const t0 = Date.now();
  const deadline = t0 + PINE_DEADLINE_MS;
  const kickAt = [PINE_KICK_MS, 4000, 8000];
  let kicks = 0;

  while (Date.now() < deadline) {
    if (ready) break;
    if (engineError) throw new Error('engine error: ' + JSON.stringify(engineError));
    if (seriesCount() > before) break;                       // a series really landed
    if (kicks < kickAt.length && Date.now() - t0 >= kickAt[kicks]) { kicks += 1; unblockPineEngine(handle); }
    await sleep(200);
  }

  if (!(ready || seriesCount() > before)) {
    try { if (handle?.remove) handle.remove(); } catch {}
    throw new Error(`engine never ran the script within ${PINE_DEADLINE_MS / 1000}s (see README → “Pine engine”)`);
  }

  mounted.push(name);
  refreshIndicatorCount();
  log('Ran on chart after ' + ((Date.now() - t0) / 1000).toFixed(1) + 's: ' + name);
  return true;
}

/**
 * What the chip counts: the studies Vela says are on the chart right now.
 *
 * `mounted` only knows the scripts THIS page ran, so a page load that restores Vela's
 * persisted indicators left the chip reading "0 indicators" while the legend listed
 * several — the chart was right and the chip was wrong. The chart's own report is the
 * honest source; `mounted` is only the fallback for when the handle cannot answer,
 * and the always-present volume pane is not an applied study, so it is filtered out.
 */
function studiesOnChart() {
  try {
    const snap = typeof chart?.inspect === 'function' ? chart.inspect() : null;
    const list = Array.isArray(snap?.indicators) ? snap.indicators : null;
    if (!list) return null;
    return list
      .map((i) => i.title || i.id || i.type || '')
      .filter((t) => t && !/^vol(ume)?$/i.test(String(t)));
  } catch { return null; }
}

function refreshIndicatorCount() {
  const onChart = studiesOnChart();
  const names = onChart || mounted;
  /* Overlay runs are not Vela studies, so inspect() never lists them — yet SMC sitting on screen
     while the chip read "0 indicators" was the confusion of 23 Sep. Count them here. */
  const overlay = (window.TraderRun ? window.TraderRun.list() : [])
    .filter((n) => !names.includes(n));
  const all = names.concat(overlay);
  const n = all.length;
  el.count.textContent = n + (n === 1 ? ' indicator' : ' indicators');
  el.count.title = n
    ? 'On the chart now: ' + (names.join(' · ') || '(none as a Vela study)') +
      (overlay.length ? ' · overlay: ' + overlay.join(' · ') : '')
    : 'Indicators that actually executed on the chart — a mount that silently did nothing is never counted';
}

/** Mount after the chart has finished booting (queues instead of throwing). */
async function queueMount(source, name) {
  if (!chart) {
    toast('Waiting for the chart to finish booting…');
    await chartReady;
  }
  return mountIndicator(source, name);
}

/* ---------------------------------------------------------------- browse all */
/* The catalogue as clickable rows. Search needs a name to start from; this needs nothing — open
   it, pick a family, read down the list. Paging is server-side (page_size caps at 100), and the
   families come from /api/families so the chip row cannot drift from the catalogue's own keys. */
const BROWSE_PAGE = 100;
/* `loading` guards the fetch, `queued` remembers what arrived while it ran. */
let browseState = { page: 0, family: '', rows: [], loading: false, queued: null };
/* The family chips describe concept taxonomy, not indicator-script families. Keep their disclosure
   and paging separate from the indicator list behind "Browse all". */
let familyConceptState = {
  page: 0, family: '', label: 'All library concepts', rows: [], total: 0,
  loading: false, queued: null, open: false,
  clusters: new Set(),   // cluster names already headed in the popover (pages must not repeat them)
};

/* The one-letter mark at the head of every row. It gives the list a column the eye can run down
   (a wall of same-shaped text is what "flat" meant), and it carries the kind in its colour:
   amber for a concept, blue for an indicator script. */
function glyphFor(row) {
  const name = String(row.name || row.slug || '?').trim();
  return name ? name[0].toUpperCase() : '?';
}

function browseRow(row) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'row';
  button.dataset.slug = row.slug;
  button.dataset.kind = 'indicator';       // a catalogue entry is always an indicator
  button.title = row.name || row.slug;     // the name ellipsizes; the tooltip keeps it readable
  button.innerHTML = `
    <div class="row__top">
      <span class="row__glyph" aria-hidden="true">${esc(glyphFor(row))}</span>
      <span class="row__name">${esc(row.name || row.slug)}</span>
    </div>
    <div class="row__sub">
      <span class="row__meta">
        <span class="row__meta-fam">${esc(row.family || 'unclassified')}</span>
        ${row.date_displayed ? `<span class="row__meta-date">· ${esc(row.date_displayed)}</span>` : ''}
      </span>
      <span class="row__kind row__kind--indicator">indicator</span>
    </div>
    ${row.description ? `<div class="row__desc">${esc(row.description)}</div>` : ''}`;
  // The same door a search hit uses — one landasan, one executor.
  button.addEventListener('click', () => openResult({ ...row, kind: 'indicator' }, button));
  return button;
}

function browseConceptRow(row) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'row';
  button.dataset.slug = row.slug;
  button.dataset.kind = 'concept';
  button.title = row.name || row.slug;
  const aliases = Array.isArray(row.aliases) ? row.aliases.filter(Boolean).slice(0, 3) : [];
  const aliasText = aliases.length
    ? `<div class="row__desc">Also: ${esc(aliases.join(' · '))}${row.aliases.length > aliases.length ? ' · …' : ''}</div>`
    : '';
  const meta = [row.family || familyConceptState.label, row.cluster].filter(Boolean).join(' · ');
  button.innerHTML = `
    <div class="row__top">
      <span class="row__glyph" aria-hidden="true">${esc(glyphFor(row))}</span>
      <span class="row__name">${esc(row.name || row.slug)}</span>
    </div>
    <div class="row__sub">
      ${meta ? `<span class="row__meta">${esc(meta)}</span>` : '<span class="row__meta"></span>'}
    </div>
    ${aliasText}`;
  button.addEventListener('click', () => openResult({ ...row, kind: 'concept' }, button));
  return button;
}

async function loadBrowse(reset = false) {
  if (!el.browseList) return;
  // One load at a time. Two overlapping calls appended into one list (a 59-indicator family
  // measured 118 rows), and guarding that with a "newest wins" token cancelled the winning paint
  // instead — two triggers on one open left the list blank. So join instead of race: while a load
  // is in flight the same request reuses it, and a genuine change (family/append) queues behind it.
  if (browseState.loading) {
    browseState.queued = reset ? 'reset' : 'more';
    return;
  }
  browseState.loading = true;
  browseState.queued = null;
  const resetting = reset;
  if (resetting) {
    browseState.page = 0;
    browseState.rows = [];
    el.browseList.innerHTML = skeletonRows(5);
  }
  el.browseMore?.classList.remove('is-done');
  const wantedFamily = browseState.family;
  try {
    const data = await api('/api/indicators', {
      page: browseState.page, page_size: BROWSE_PAGE,
      ...(wantedFamily ? { family: wantedFamily } : {}),
    });
    const rows = data.indicators || [];
    // The family moved while this was in flight — drop it; the queued load has the right filter.
    if (wantedFamily !== browseState.family) { browseState.loading = false; return drainBrowse(); }
    if (resetting) el.browseList.innerHTML = '';
    if (!rows.length && !browseState.rows.length) {
      el.browseList.innerHTML = '<div class="browse__note">Nothing in this family.</div>';
      el.browseMore?.classList.add('is-done');
      browseState.loading = false;
      drainBrowse();
      return;
    }
    browseState.rows.push(...rows);
    rows.forEach((row) => el.browseList.appendChild(browseRow(row)));
    browseState.page += 1;
    const total = data.total ?? browseState.rows.length;
    // The count is telemetry, not a label (26 Sep — the operator circled `☰ 806` on the chart row:
    // a number in the chrome reads as a foreign element, spec §4). The door says WHAT it opens and
    // the number lives in its tooltip; the label is never overwritten.
    if (el.libOpen && !el.libOpen.dataset.counted && data.total) {
      el.libOpen.setAttribute('data-tip',
        `Catalogue — all ${data.total} LuxAlgo Library indicators, one click from the chart`);
      el.libOpen.dataset.counted = '1';
    }
    if (el.browseCount) {
      el.browseCount.textContent = browseState.family
        ? `${browseState.rows.length} of ${total} · ${browseState.family}`
        : `${browseState.rows.length} of ${total}`;
    }
    // The endpoint reports the page count; when it does not, a short page is the last page.
    const more = data.pages ? browseState.page < data.pages : rows.length === BROWSE_PAGE;
    if (!more) el.browseMore?.classList.add('is-done');
    checkHealth();   // this read moved the backend's MCP counter
  } catch (err) {
    browseState.loading = false;
    el.browseList.innerHTML = `<div class="browse__note">Catalogue unavailable: ${esc(err.message)}<br>
      Is the console backend running? <code>./console/start.sh</code> (or the luxalgo-web user unit)</div>`;
    return;
  }
  browseState.loading = false;
  drainBrowse();
}

/* Run whatever arrived while a load was in flight — a family change wins over a plain append. */
function drainBrowse() {
  const q = browseState.queued;
  browseState.queued = null;
  if (q === 'reset') loadBrowse(true);
  else if (q === 'more') loadBrowse(false);
}

function setFamilyDisclosure(activeButton = null, open = false) {
  document.querySelectorAll('.browse__fam').forEach((button) => {
    const expanded = open && button === activeButton;
    button.classList.toggle('is-on', expanded);
    button.setAttribute('aria-expanded', String(expanded));
  });
  /* While a family is disclosed the popover IS the surface. Its bottom edge is bounded (46vh), so
     without this the script list behind it — and that list's own "Load more" — showed through under
     the popover: two lists and two "Load more" buttons on one screen. */
  el.browseBody?.classList.toggle('is-concepts', open);
  // The panel's own empty-state copy sits under the browse block and peeked out below the popover's
  // bounded bottom edge — same leak, different element. The whole view carries the flag.
  el.browseBody?.closest('.view')?.classList.toggle('is-concepts', open);
  /* Bring the open bubble into the row's view. The row scrolls sideways, so a family past the fold
     (Wyckoff, Validation) left the operator looking at unselected chips with no sign of which one
     was on. Nearest, not center: the row should move as little as it takes. */
  if (open && activeButton) activeButton.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function closeFamilyConcepts() {
  familyConceptState.open = false;
  el.browseConcepts?.classList.add('view--hidden');
  setFamilyDisclosure();
}

/* Concepts arrive family-filtered but not grouped, and the popover is long: cluster headings break
   the wall of names into runs you can skim. Headings are decorative (aria-hidden) so the list's own
   roles stay simple, and a cluster that continues onto the next page keeps the heading it got. */
function appendConceptRows(rows) {
  rows.forEach((row) => {
    const cluster = row.cluster || '';
    if (cluster && !familyConceptState.clusters.has(cluster)) {
      familyConceptState.clusters.add(cluster);
      const head = document.createElement('div');
      head.className = 'browse__group';
      head.setAttribute('aria-hidden', 'true');
      head.textContent = cluster;
      el.browseConceptsList.appendChild(head);
    }
    el.browseConceptsList.appendChild(browseConceptRow(row));
  });
}

async function loadFamilyConcepts(reset = false) {
  const state = familyConceptState;
  if (!el.browseConceptsList || (!reset && !state.open)) return;
  if (state.loading) {
    state.queued = reset ? 'reset' : 'more';
    return;
  }
  state.loading = true;
  state.queued = null;
  const resetting = reset;
  if (resetting) {
    state.page = 0;
    state.rows = [];
    state.total = 0;
    state.clusters.clear();
    el.browseConceptsList.innerHTML = skeletonRows(4);
  }
  const moreWrap = el.browseConceptsMore?.parentElement;
  moreWrap?.classList.remove('is-done');
  if (el.browseConceptsMore) el.browseConceptsMore.disabled = true;
  const wantedFamily = state.family;
  const wantedLabel = state.label;
  try {
    const data = await api('/api/concepts', {
      page: state.page, page_size: BROWSE_PAGE,
      ...(wantedFamily ? { family: wantedFamily } : {}),
    });
    const rows = data.concepts || [];
    if (wantedFamily !== state.family) { state.loading = false; return drainFamilyConcepts(); }
    if (resetting) el.browseConceptsList.innerHTML = '';
    const total = Number(data.total ?? (state.rows.length + rows.length));
    if (!rows.length && !state.rows.length) {
      state.total = total;
      el.browseConceptsList.innerHTML = `<div class="browse__note">No concepts found for ${esc(wantedLabel)}.</div>`;
      if (el.browseConceptsCount) el.browseConceptsCount.textContent = `0 of ${total}`;
      moreWrap?.classList.add('is-done');
      state.queued = null;
      state.loading = false;
      drainFamilyConcepts();
      return;
    }
    state.rows.push(...rows);
    appendConceptRows(rows);
    state.page += 1;
    state.total = total;
    if (el.browseConceptsCount) {
      // The title above already names the family; only the all-families case needs the scope.
      const scope = wantedFamily ? '' : ' · all families';
      el.browseConceptsCount.textContent = `${state.rows.length} of ${state.total}${scope}`;
    }
    const more = rows.length > 0 && state.rows.length < state.total;
    moreWrap?.classList.toggle('is-done', !more);
    if (el.browseConceptsMore) el.browseConceptsMore.disabled = !more;
    checkHealth();
  } catch (err) {
    state.loading = false;
    if (wantedFamily !== state.family) return drainFamilyConcepts();
    state.queued = null;
    el.browseConceptsList.innerHTML = `<div class="browse__note">Concept list unavailable: ${esc(err.message)}</div>`;
    if (el.browseConceptsCount) el.browseConceptsCount.textContent = 'Concepts unavailable';
    moreWrap?.classList.add('is-done');
    return;
  }
  state.loading = false;
  drainFamilyConcepts();
}

function drainFamilyConcepts() {
  const queued = familyConceptState.queued;
  familyConceptState.queued = null;
  if (queued === 'reset') loadFamilyConcepts(true);
  else if (queued === 'more') loadFamilyConcepts(false);
}

async function loadFamilies() {
  if (!el.browseFamilies) return;
  try {
    const data = await api('/api/families', {});
    const fams = data.families || [];
    // The family counts are concepts; the ALL chip needs the catalogue's own total, which no
    // family carries. One 1-row read answers it exactly (and never drifts like a baked number).
    let conceptTotal = 0;
    try { conceptTotal = Number((await api('/api/concepts', { page_size: 1 })).total || 0); }
    catch { /* the chip falls back to a bare label — never a wrong number */ }
    el.browseFamilies.innerHTML = '';
    const all = document.createElement('button');
    all.type = 'button'; all.className = 'browse__fam'; all.dataset.family = '';
    all.dataset.label = 'All library concepts';
    all.setAttribute('aria-controls', 'browse-concepts');
    all.setAttribute('aria-expanded', 'false');
    all.innerHTML = `<span class="browse__fam-label">All concepts</span>`
      + (conceptTotal ? `<span class="browse__fam-count">${esc(String(conceptTotal))}</span>` : '')
      + `<span class="browse__fam-caret" aria-hidden="true">▾</span>`;
    all.title = 'Show all library concepts';
    all.addEventListener('click', () => pickFamily('', all));
    el.browseFamilies.appendChild(all);
    fams.forEach((f) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'browse__fam'; b.dataset.family = f.key;
      b.dataset.label = f.name;
      b.setAttribute('aria-controls', 'browse-concepts');
      b.setAttribute('aria-expanded', 'false');
      // Concept counts, not indicator counts — say which, or the numbers read as a partition.
      b.innerHTML = `<span class="browse__fam-label">${esc(f.name)}</span>`
        + (f.concept_count ? `<span class="browse__fam-count">${esc(String(f.concept_count))}</span>` : '')
        + `<span class="browse__fam-caret" aria-hidden="true">▾</span>`;
      b.title = `${f.name} — ${f.concept_count || 0} library concepts, upstream`;
      b.addEventListener('click', () => pickFamily(f.key, b));
      el.browseFamilies.appendChild(b);
    });
  } catch (err) {
    el.browseFamilies.innerHTML = `<span class="browse__note">Families unavailable: ${esc(err.message)}</span>`;
  }
}

function pickFamily(key, button) {
  const family = key || '';
  if (familyConceptState.open && familyConceptState.family === family) {
    closeFamilyConcepts();
    return;
  }
  familyConceptState.family = family;
  familyConceptState.label = button?.dataset.label || (family || 'All library concepts');
  familyConceptState.open = true;
  familyConceptState.page = 0;
  familyConceptState.rows = [];
  familyConceptState.total = 0;
  if (el.browseConceptsTitle) el.browseConceptsTitle.textContent = familyConceptState.label;
  if (el.browseConceptsCount) el.browseConceptsCount.textContent = `Loading ${familyConceptState.label}…`;
  el.browseConcepts?.classList.remove('view--hidden');
  setFamilyDisclosure(button, true);
  loadFamilyConcepts(true);
  checkHealth();
}

function toggleBrowse(on) {
  const open = typeof on === 'boolean' ? on : el.browseBody.classList.contains('view--hidden');
  if (!open) closeFamilyConcepts();
  el.browseBody.classList.toggle('view--hidden', !open);
  // The search empty state is a welcome, not part of the catalogue: with the catalogue open it read
  // as a stray paragraph under the list (operator's still, 25 Sep).
  document.getElementById('view-library')?.classList.toggle('is-browsing', open);
  el.browseToggle?.classList.toggle('is-on', open);
  el.browseToggle?.setAttribute('aria-expanded', String(open));
  el.libOpen?.setAttribute('aria-pressed', String(open && (el.main.dataset.library === 'on')));
  try { localStorage.setItem(PANELS_KEY, JSON.stringify({ ...readPanelPrefs(), browse: open })); } catch { /* private mode */ }
  if (open) {
    if (!el.browseFamilies.children.length) loadFamilies();
    // The indicator catalogue loads independently; family bubbles fetch concepts into their own
    // disclosure list and never filter or clear these indicator rows.
    if (!browseState.rows.length && !browseState.loading) loadBrowse(true);
  }
}

/* ---------------------------------------------------------------- library UI */
function skeletons(n = 4) {
  el.results.innerHTML = Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
}

/* Row-shaped placeholders for any list that is about to be replaced. The old text note ("Loading
   the catalogue…") told the eye nothing about what was coming; a skeleton of the same height keeps
   the list from jumping when the rows land. */
function skeletonRows(n = 5) {
  return Array.from({ length: n }, () => '<div class="skeleton skeleton--row"></div>').join('');
}

function renderResults(rows) {
  if (!rows.length) {
    el.results.innerHTML = '<div class="empty"><p>No matches.</p><p class="muted">Try a broader term, or set type to “all”.</p></div>';
    return;
  }
  el.results.innerHTML = '';
  rows.forEach((row) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row';
    button.dataset.slug = row.slug;
    button.dataset.kind = row.kind;
    button.title = row.name || row.slug;
    button.innerHTML = `
      <div class="row__top">
        <span class="row__glyph" aria-hidden="true">${esc(glyphFor(row))}</span>
        <span class="row__name">${esc(row.name || row.slug)}</span>
      </div>
      <div class="row__sub">
        <span class="row__meta">${esc(row.family || '')}${row.family ? ' · ' : ''}${esc(row.slug)}</span>
        <span class="row__kind row__kind--${esc(row.kind)}">${esc(row.kind)}</span>
      </div>
      ${row.description ? `<div class="row__desc">${esc(row.description)}</div>` : ''}`;
    button.addEventListener('click', () => openResult(row, button));
    el.results.appendChild(button);
  });
}

async function runSearch(event) {
  event?.preventDefault();
  const term = el.q.value.trim();
  if (!term) return;
  setLibraryCollapsed(false);           // a search always brings the results back into view
  setPanel('library', true);            // …and the panel it lives in, if it was hidden
  skeletons();
  toast('Searching the Library…');
  try {
    const data = await api('/api/search', {
      q: term, type: $('#type').value, family: $('#family').value, limit: 12,
    });
    const rows = data.results || [];
    renderResults(rows);
    toast(`${rows.length} result${rows.length === 1 ? '' : 's'} for “${term}”`);
    checkHealth();   // this search just moved the backend's MCP counter — the pill must follow
  } catch (err) {
    el.results.innerHTML = `<div class="empty"><p>Search failed.</p><p class="muted">${esc(err.message)}</p>
      <p class="muted">Is the backend running? <code>./console/start.sh</code> (or the luxalgo-web user unit)</p></div>`;
    toast('Search failed: ' + err.message, true);
  }
}

/* One place that puts a button into a running state: the label stays, a spinner is added and the
   button is disabled, so a second click can never double-run a script. */
function setActionState(button, state, label) {
  if (!button) return;
  button.classList.toggle('is-busy', state === 'busy');
  button.disabled = state === 'busy';
  if (label) button.textContent = label;
}

function licenseLine(source = '') {
  const first = source.split('\n').slice(0, 3).join(' ');
  const match = first.match(/(CC BY-NC-SA 4\.0|MPL-2\.0|Mozilla Public License 2\.0|AGPL[^ ]*|MIT|Apache-2\.0)/i);
  return match ? match[0] : null;
}

async function openResult(row, button) {
  document.querySelectorAll('.row--active').forEach((n) => n.classList.remove('row--active'));
  button?.classList.add('row--active');
  el.detail.innerHTML = '<h2 class="detail__title">Loading…</h2><div class="skeleton"></div>';
  setPanel('detail', true);   // picking a result IS the reason this panel exists
  try {
    if (row.kind === 'indicator') {
      const data = await api('/api/source', { slug: row.slug });
      const source = data.source || '';
      const lic = licenseLine(source);
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
        <div class="code${source.length > 1200 ? ' code--collapsed' : ''}" id="code-block">
          <div class="code__bar">
            <button type="button" class="code__toggle code__label" id="code-toggle" aria-expanded="${source.length > 1200 ? 'false' : 'true'}" aria-controls="code-body">
              <span class="code__chev" aria-hidden="true">▸</span>Pine
            </button>
            <span class="code__meta muted">${source.length.toLocaleString()} chars${source.length > 12000 ? ' · preview truncated' : ''}</span>
            <button type="button" class="btn btn--ghost code__copy" id="copy">⧉ Copy</button>
          </div>
          <div class="code__body" id="code-body">
            <pre>${esc(source.slice(0, 12000))}${source.length > 12000 ? '\n… truncated in preview …' : ''}</pre>
          </div>
        </div>`;
      $('#mount').addEventListener('click', async () => {
        const label = data.name || row.slug;
        const button = $('#mount');
        setActionState(button, 'busy');
        toast(`Mounting “${label}”… waiting for the engine`);
        try {
          await queueMount(source, label);
          toast(`“${label}” is running on the chart`);
          noteActivity(`mounted “${label}”`, 'chart_add_indicator');
        } catch (err) { toast('Not mounted: ' + err.message, true); }
        finally { setActionState(button, 'idle'); }
      });
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
      $('#code-toggle').addEventListener('click', (event) => {
        const collapsed = $('#code-block').classList.toggle('code--collapsed');
        event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
      });
      $('#copy').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(source);
          setActionState(button, 'idle', '✓ Copied');
          setTimeout(() => setActionState(button, 'idle', '⧉ Copy'), 1400);
          toast('Pine source copied');
        } catch { toast('Clipboard blocked by the browser', true); }
      });
      checkHealth();   // the source fetch moved the counter — refresh the pill before leaving
      return;
    }

    const data = await api('/api/concept', { slug: row.slug });
    const body = data.content_markdown || data.body_markdown || data.raw || 'No write-up returned.';
    el.detail.innerHTML = `
      <h2 class="detail__title">${esc(data.name || row.slug)}</h2>
      <div class="detail__meta">
        <span class="badge">concept</span>
        <span class="badge">${esc(data.family || row.family || '')}</span>
        <a class="badge" href="${esc(row.url || '#')}" target="_blank" rel="noreferrer">Library page</a>
      </div>
      <div class="detail__text">${renderMarkdown(body.slice(0, 14000))}</div>`;
    checkHealth();   // the concept fetch moved the counter — refresh the pill
  } catch (err) {
    el.detail.innerHTML = `<h2 class="detail__title">Failed</h2><p class="muted">${esc(err.message)}</p>`;
    toast('Could not load detail: ' + err.message, true);
  }
}

/* --------------------------------------------------------------------- tabs */
/**
 * The library folds to its search row so the chart keeps the height (operator's call, 15 Sep).
 * Folded, the filters, shortcuts, onboarding text and results are hidden; a search always
 * unfolds it, and the caret in the search row toggles it by hand.
 */
function setLibraryCollapsed(on) {
  if (!el.libraryPanel) return;
  el.libraryPanel.classList.toggle('is-collapsed', on);
  if (el.libraryToggle) {
    el.libraryToggle.textContent = on ? '⌄' : '⌃';
    el.libraryToggle.setAttribute('aria-expanded', String(!on));
    el.libraryToggle.title = on ? 'Show filters, shortcuts and results' : 'Fold the library away';
  }
}

function showView(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.view === name;
    tab.classList.toggle('tab--active', on);
    tab.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('view--hidden', view.id !== 'view-' + name);
  });
}

/* -------------------------------------------------------------- indicators (26 Sep) */
/* LuxAlgo's own modal puts BUILT-INS (their chart's natives) and LIBRARY (their catalogue) behind
   one search box, with favourites — operator's ask, 26 Sep, after watching the original app.
   This console had the two halves in two places: Vela's own Indicators menu for natives, the
   Library panel for the catalogue. Neither knew about the other, and neither remembered what the
   operator actually reaches for.

   Nothing is copied from the catalogue: natives come from this frame's own
   `availableNativeIndicators()`, the catalogue from /api/indicators, and mounting a built-in is the
   SAME `addNativeIndicator()` call the bridge's `add` action makes — then read back with
   `presentNativeIndicators()`, because a call that returned is not a study that landed. */
const FAV_KEY = 'luxalgo-web:indicator-favorites';

const indState = {
  section: 'favorites',
  q: '',
  natives: null,        // null = not read yet; [] = this chart truly has none
  nativesError: '',
  library: { rows: [], page: 0, size: 60, total: 0, query: '', loading: false, queued: null },
};

function readFavourites() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY));
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
  } catch { return []; }
}
const favId = (kind, id) => kind + ':' + id;
const isFavourite = (kind, id) => readFavourites().includes(favId(kind, id));

function toggleFavourite(kind, id, label) {
  const key = favId(kind, id);
  const list = readFavourites();
  const at = list.indexOf(key);
  if (at === -1) list.push(key); else list.splice(at, 1);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  toast((at === -1 ? '★ ' : '☆ ') + label + (at === -1 ? ' starred' : ' unstarred'));
  renderIndicators();
}

/** The catalogue half: Vela's own natives for this market. */
async function loadNatives() {
  const c = chart || (window.__wsApp && window.__wsApp.activeChart && window.__wsApp.activeChart());
  if (!c || typeof c.availableNativeIndicators !== 'function') {
    indState.nativesError = 'this chart has no native catalogue to read';
    indState.natives = [];
    return;
  }
  try {
    const rows = await c.availableNativeIndicators();
    indState.natives = (rows || [])
      .map((r) => ({ type: r.type, title: r.title || r.type, supported: r.supported !== false,
                     present: Boolean(r.present), beta: Boolean(r.beta) }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title)));
  } catch (err) {
    indState.nativesError = err.message || 'the native catalogue did not answer';
    indState.natives = [];
  }
}

/** The other half: the LuxAlgo Library catalogue, paged and searchable server-side.

    A call already in flight cannot be joined: the door can set the section and the search text in
    the same breath, and the first load (started by the section change, with the old query) would
    swallow the second one — measured live on 26 Sep, `--section library --q supertrend` painted
    `0 row(s)` while the API answered `total 10`. So a request that arrives while one is running is
    QUEUED and drained after it, exactly as `browse` does. */
async function loadLibrary(reset = false) {
  const lib = indState.library;
  if (lib.loading) { lib.queued = reset ? 'reset' : 'more'; return; }
  if (reset) { lib.page = 0; lib.rows = []; lib.query = indState.q; }
  lib.loading = true;
  try {
    const data = await api('/api/indicators', { text: indState.q, page: lib.page, page_size: lib.size });
    lib.rows = lib.page === 0 ? (data.indicators || []) : lib.rows.concat(data.indicators || []);
    lib.total = data.total || lib.rows.length;
  } catch (err) {
    toast('Library: ' + err.message, true);
  } finally {
    lib.loading = false;
    const queued = lib.queued;
    lib.queued = null;
    if (queued) loadLibrary(queued === 'reset').then(renderIndicators);
  }
}

function indCard(kind, id, title, meta, opts = {}) {
  const starred = isFavourite(kind, id);
  const sub = [];
  if (meta) sub.push(esc(meta));
  if (opts.present) sub.push('<span class="ind-card__on">on chart</span>');
  if (opts.unsupported) sub.push('<span class="ind-card__off">not on this market</span>');
  if (opts.beta) sub.push('<span class="ind-card__beta">beta</span>');
  if (opts.missing) sub.push('<span class="ind-card__off">not in this build</span>');
  return `<article class="ind-card${opts.present ? ' is-on' : ''}" data-kind="${esc(kind)}" data-id="${esc(id)}"
      data-label="${esc(title)}" tabindex="0" role="button"
      aria-label="${esc(title)} — click to mount, star to keep">
    <button type="button" class="ind-card__star${starred ? ' is-starred' : ''}" data-star="1"
            aria-pressed="${starred}" title="${starred ? 'Remove from favourites' : 'Add to favourites'}"
            aria-label="Favourite ${esc(title)}">${starred ? '★' : '☆'}</button>
    <span class="ind-card__title">${esc(title)}</span>
    ${sub.length ? `<span class="ind-card__meta">${sub.join(' · ')}</span>` : ''}
  </article>`;
}

function renderIndicators() {
  const grid = document.getElementById('ind-grid');
  if (!grid) return;
  const favs = readFavourites();
  const natives = indState.natives || [];
  const byType = new Map(natives.map((n) => [n.type, n]));
  const libRows = indState.library.rows;
  const bySlug = new Map(libRows.map((r) => [r.slug, r]));
  const q = indState.q.trim().toLowerCase();
  const html = [];

  if (indState.section === 'favorites') {
    if (!favs.length) {
      html.push('<p class="ind-note">Nothing starred yet. Open <strong>BUILT-INS</strong> or '
        + '<strong>LIBRARY</strong>, then click the ☆ on anything worth keeping — '
        + 'the star is remembered in this console, not on a server.</p>');
    }
    favs.forEach((key) => {
      const [kind, ...rest] = key.split(':');
      const id = rest.join(':');
      if (kind === 'native') {
        const hit = byType.get(id);
        html.push(indCard('native', id, hit ? hit.title : id, 'built-in',
          { present: hit && hit.present, missing: !hit }));
      } else {
        const hit = bySlug.get(id);
        html.push(indCard('library', id, hit ? hit.name : id, hit ? hit.family : 'library',
          { missing: !hit }));
      }
    });
  } else if (indState.section === 'builtins') {
    if (indState.nativesError) {
      html.push(`<p class="ind-note">${esc(indState.nativesError)}</p>`);
    } else if (!natives.length) {
      html.push('<p class="ind-note">The native catalogue is still loading…</p>');
    } else {
      const shown = q ? natives.filter((n) => (n.title + ' ' + n.type).toLowerCase().includes(q)) : natives;
      if (!shown.length) html.push('<p class="ind-note">No built-in matches “' + esc(indState.q) + '”.</p>');
      shown.forEach((n) => html.push(indCard('native', n.type, n.title,
        n.present ? 'built-in' : 'built-in', { present: n.present, unsupported: !n.supported, beta: n.beta })));
    }
  } else {
    if (!libRows.length) {
      html.push(indState.library.loading
        ? '<p class="ind-note">Reading the catalogue…</p>'
        : '<p class="ind-note">No catalogue rows for “' + esc(indState.q) + '”.</p>');
    }
    const shown = q && indState.library.query !== indState.q
      /* These rows are not the server's answer to THIS query (they are a general page), so filter
         them here. When they ARE the answer, they are painted as they came: the catalogue's own
         search is not a substring match — `orderblock` answers with two rows whose names say
         "Order Block" and whose slugs say `order-blocks`, and a local `includes()` re-filter threw
         both away and reported an empty search against a non-empty answer (measured 26 Sep). */
      ? libRows.filter((r) => (r.name + ' ' + r.slug + ' ' + (r.family || '')).toLowerCase().includes(q))
      : libRows;
    shown.forEach((r) => html.push(indCard('library', r.slug, r.name || r.slug, r.family)));
  }

  grid.innerHTML = html.join('');
  const counts = {
    favorites: favs.length,
    builtins: natives.length,
    library: indState.library.total,
  };
  document.querySelectorAll('#ind-nav .ind-tab').forEach((tab) => {
    const on = tab.dataset.section === indState.section;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', String(on));
    const badge = tab.querySelector('.ind-tab__n');
    if (badge) badge.textContent = counts[tab.dataset.section] ? ' ' + counts[tab.dataset.section] : '';
  });
  const more = document.getElementById('ind-more');
  if (more) {
    const canPage = indState.section === 'library' && !indState.q
      && indState.library.rows.length < indState.library.total;
    more.hidden = !canPage;
  }
  const count = document.getElementById('ind-count');
  if (count) {
    count.textContent = indState.section === 'builtins'
      ? `${natives.length} built-in${natives.length === 1 ? '' : 's'} on this build`
      : (indState.section === 'library' ? `${indState.library.total} in the catalogue` : '');
  }
}

/** Mount a built-in and report what the CHART says afterwards, not what we asked for. */
function mountNative(type, title) {
  const c = chart || (window.__wsApp && window.__wsApp.activeChart && window.__wsApp.activeChart());
  if (!c || typeof c.addNativeIndicator !== 'function') { toast('No chart on this page', true); return false; }
  const before = (typeof c.presentNativeIndicators === 'function') ? c.presentNativeIndicators() : [];
  if (before.includes(type)) {
    toast(title + ' is already on the chart — nothing added');
    return false;
  }
  c.addNativeIndicator(type);
  const after = (typeof c.presentNativeIndicators === 'function') ? c.presentNativeIndicators() : [];
  const landed = after.includes(type);
  toast(landed ? 'Added ' + title : title + ' did not land — the chart still does not carry it', !landed);
  noteActivity((landed ? 'added ' : 'tried to add ') + title + ' from the Indicators panel', 'chart_add_indicator');
  refreshIndicatorCount();
  renderIndicators();
  return landed;
}

function setIndSection(section) {
  indState.section = section;
  if (section === 'library' && !indState.library.rows.length) {
    loadLibrary(true).then(renderIndicators);
  }
  renderIndicators();
}

/** The bridge's `indicators` door sets the search box and its state in one move. */
function setIndSearch(q) {
  const box = document.getElementById('ind-q');
  const text = String(q == null ? '' : q);
  if (box) box.value = text;
  indState.q = text;
  /* Same rule the typing path uses: a query the catalogue can answer is fetched, and so is clearing
     it — otherwise the previous search's rows stay on screen under an empty box. */
  if (indState.section === 'library' && (text.trim().length >= 2 || indState.library.query)) {
    loadLibrary(true).then(renderIndicators);
    return;
  }
  renderIndicators();
}

/* The surface's own functions are reachable from the bridge (both files are classic scripts), but
   the bridge is not allowed to assume that — expose them explicitly so a future bundling step
   cannot quietly break the agent's door. */
window.openIndicators = openIndicators;
window.setIndSection = setIndSection;
window.setIndSearch = setIndSearch;
window.indicatorsSurface = () => {
  const grid = document.getElementById('ind-grid');
  const cards = Array.from(document.querySelectorAll('#ind-grid .ind-card'));
  return {
    section: indState.section,
    query: indState.q,
    rows: cards.map((c) => ({ kind: c.dataset.kind, id: c.dataset.id, label: c.dataset.label,
                              onChart: c.classList.contains('is-on'),
                              starred: Boolean(c.querySelector('.ind-card__star.is-starred')) })),
    builtins: (indState.natives || []).length,
    catalogueTotal: indState.library.total,
    favourites: readFavourites().length,
    gridPresent: Boolean(grid),
    loading: Boolean(indState.library.loading || indState.library.queued),
  };
};

/** Star / unstar without a click — the agent's side of the same ☆ the operator presses. */
window.mountNative = mountNative;
window.setIndFavourite = (kind, id, on) => {
  const key = favId(kind, id);
  const list = readFavourites();
  const at = list.indexOf(key);
  if (on && at === -1) list.push(key);
  if (!on && at !== -1) list.splice(at, 1);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  renderIndicators();
  return { starred: list.includes(key), favourites: list.length };
};

function openIndicators(on) {
  const modal = document.getElementById('ind-modal');
  if (!modal) return false;
  const show = on !== false;
  modal.classList.toggle('view--hidden', !show);
  document.body.classList.toggle('has-ind-modal', show);
  if (!show) return true;
  if (indState.natives === null) loadNatives().then(renderIndicators);
  if (!indState.library.rows.length) loadLibrary(true).then(renderIndicators);
  renderIndicators();
  const box = document.getElementById('ind-q');
  if (box) box.focus();
  return true;
}

function initIndicators() {
  const modal = document.getElementById('ind-modal');
  const open = document.getElementById('ind-open');
  if (!modal || !open) return;
  open.addEventListener('click', () => openIndicators(modal.classList.contains('view--hidden')));
  document.getElementById('ind-close').addEventListener('click', () => openIndicators(false));
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) { openIndicators(false); return; }
    const tab = ev.target.closest('.ind-tab');
    if (tab) { setIndSection(tab.dataset.section); return; }
    const card = ev.target.closest('.ind-card');
    if (!card) return;
    if (ev.target.closest('[data-star]')) {
      toggleFavourite(card.dataset.kind, card.dataset.id, card.dataset.label);
      return;
    }
    const kind = card.dataset.kind;
    const id = card.dataset.id;
    const label = card.dataset.label;
    if (kind === 'native') { mountNative(id, label); return; }
    /* A catalogue row keeps its own home: the Details pane, with the Pine source and the SAME
       Run PineTS / Add to chart buttons every other door uses. */
    const row = indState.library.rows.find((r) => r.slug === id) || { slug: id, name: label, kind: 'indicator' };
    openIndicators(false);
    openResult({ ...row, kind: 'indicator' }, card);
  });
  modal.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      const card = ev.target.closest('.ind-card');
      if (card && !ev.target.closest('[data-star]')) { ev.preventDefault(); card.click(); }
    }
  });
  let debounce = null;
  const box = document.getElementById('ind-q');
  box.addEventListener('input', () => {
    indState.q = box.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (indState.section !== 'library') { renderIndicators(); return; }
      /* Any query the catalogue can answer is its own answer to fetch — including a short one.
         Clearing the box has to fetch too, or the previous search's rows would stay on screen. */
      if (indState.q.trim().length >= 2 || indState.library.query) loadLibrary(true).then(renderIndicators);
      else renderIndicators();
    }, 250);
  });
  document.getElementById('ind-more').addEventListener('click', () => {
    indState.library.page += 1;
    loadLibrary(false).then(renderIndicators);
  });
}

/** Escape: close the surface if it is up, and say whether that consumed the key.

    The F6 rule is one Escape, one surface — so the topmost surface has to answer first, and the
    listener that owns the right column asks this before it hides that column. */
function closeIndicatorsIfOpen() {
  if (!indState.open) return false;
  openIndicators(false);
  return true;
}

/* ------------------------------------------------------------------- wiring */
async function checkHealth() {
  try {
    const data = await api('/api/health');
    // Two backend generations answer this endpoint: the MVP shape
    // ({mcp_ready, tools}) and the richer scout shape ({mcp:{connected}, calls}).
    const ready = data.mcp_ready != null
      ? Boolean(data.mcp_ready && data.tools > 0)
      : Boolean(data.mcp && data.mcp.connected);
    const label = data.tools != null ? `${data.tools} tools`
      : (data.mcp && data.mcp.calls != null
          ? `${data.mcp.calls} ${data.mcp.calls === 1 ? 'call' : 'calls'} ok`
          : 'ready');
    /* Spec §5: the counter is engineer telemetry — the chrome keeps a connection DOT and the
       numbers move into the tooltip. */
    el.mcp.textContent = ready ? '● Agent' : '● Agent offline';
    el.mcp.className = 'pill ' + (ready ? 'pill--ok' : 'pill--bad');
    el.mcp.title = (ready ? 'MCP: ' + label : 'MCP: offline')
      + ' · ' + (ready
        ? (data.mcp_url || (data.mcp && data.mcp.url) || 'connected')
        : ((data.mcp_error || (data.mcp && data.mcp.last_error)) || 'not connected'));
    if (!ready) toast('LuxAlgo MCP is not connected — see backend log', true);
  } catch (err) {
    el.mcp.textContent = '● Agent offline';
    el.mcp.className = 'pill pill--bad';
    el.mcp.title = err.message;
    toast('Backend unreachable — start ./console/start.sh (or luxalgo-web.service) first', true);
  }
}

/* F6 (25 Sep): Escape closes whatever this pane opened. Only the family popover listened for
   it, so the script / detail pane — the operator's "I opened PineTS, Escape should hide it" —
   could only be closed with its ✕. Bound BEFORE conceptsKeydown so one Escape closes ONE surface:
   the popover stands down here while it is open, the pane goes next, the Library last. */
function escapeKeydown(e) {
  if (e.key !== 'Escape') return;
  if (familyConceptState.open) return;
  if (el.main && el.main.dataset.detail === 'on') {
    e.preventDefault();
    setPanel('detail', false);
    return;
  }
  if (el.main && el.main.dataset.library === 'on') {
    e.preventDefault();
    setPanel('library', false);
  }
}

/* Keyboard rules for the disclosure, in one place. Escape closes and hands focus back to the chip
   that opened it; arrows walk whichever surface has focus (the chip row, or the concept list). No
   roving tabindex: the popover is short and the arrows are a convenience, not the only way in. */
function conceptsKeydown(e) {
  if (e.key === 'Escape' && familyConceptState.open) {
    e.preventDefault();
    closeFamilyConcepts();
    el.browseFamilies?.querySelector('.browse__fam.is-on')?.focus();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const inPopover = familyConceptState.open && el.browseConcepts?.contains(e.target);
  const onChip = e.target instanceof Element && !!e.target.closest('.browse__fam');
  const scope = inPopover ? el.browseConceptsList : (onChip ? el.browseFamilies : null);
  if (!scope) return;
  const items = Array.from(scope.querySelectorAll(inPopover ? '.row' : '.browse__fam'));
  if (!items.length) return;
  const index = items.indexOf(document.activeElement);
  let next;
  if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  else if (e.key === 'ArrowDown') next = index < 0 ? 0 : Math.min(items.length - 1, index + 1);
  else next = index < 0 ? items.length - 1 : Math.max(0, index - 1);
  e.preventDefault();
  items[next].focus();
}

/* Click-away, bound in the capture phase so a click that lands on the chart or the chat still
   closes the disclosure before anything else reacts to it. The chip itself is exempt: it toggles. */
function onDocumentPointerDown(e) {
  if (!familyConceptState.open) return;
  if (el.browseConcepts?.contains(e.target)) return;
  if (e.target instanceof Element && e.target.closest('.browse__fam')) return;
  closeFamilyConcepts();
}

async function main() {
  /* Chart-first: the LIBRARY starts where he left it. The DETAIL panel deliberately never restores
     open: nothing is selected at load time, so it would paint an empty "Nothing selected" column
     over the chart — the operator's complaint of 17 Sep. It opens when a result is picked, or from
     the toggle if he asks for it. (setPanel persists, so a stale `detail: true` is cleaned up here.) */
  const panelPrefs = readPanelPrefs();
  setPanel('library', panelPrefs.library === true);
  toggleBrowse(panelPrefs.browse === true);
  setPanel('detail', false);   // never restore the column open (his 17 Sep complaint)
  showRightView(panelPrefs.rightview === 'script' ? 'script' : 'detail');
  el.libraryOpen.addEventListener('click', () => togglePanel('library'));
  el.detailOpen.addEventListener('click', () => togglePanel('detail'));
  el.scriptOpen.addEventListener('click', () => togglePanel('script'));

  // The chart-side catalogue button: it is a door, not a toggle — a click always lands on the
  // open list (panel out, browse body out, list filled), because "nothing happened" is what the
  // operator reported the last time a row only revealed a collapsed surface.
  el.browseToggle?.addEventListener('click', () => toggleBrowse());
  el.browseMore?.addEventListener('click', () => loadBrowse(false));
  el.browseConceptsMore?.addEventListener('click', () => loadFamilyConcepts(false));
  el.browseConceptsClose?.addEventListener('click', () => closeFamilyConcepts());
  document.addEventListener('keydown', escapeKeydown);
  document.addEventListener('keydown', conceptsKeydown);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  el.libOpen?.addEventListener('click', () => {
    setPanel('library', true);
    setLibraryCollapsed(false);
    toggleBrowse(true);
    toast('LuxAlgo Library ready');
    checkHealth();
  });

  // Script pane (restored 23 Sep) — Run goes through the one landasan; the draft survives reloads.
  const srcBox = $('#script-src'), outBox = $('#script-out'), nameBox = $('#script-name'), runBtn = $('#script-run');
  try {
    const draft = JSON.parse(localStorage.getItem('luxalgo-web:script') || 'null');
    if (draft && typeof draft === 'object') {
      if (typeof draft.src === 'string') srcBox.value = draft.src;
      if (typeof draft.name === 'string' && draft.name.trim()) nameBox.value = draft.name;
    }
  } catch { /* private mode */ }
  let draftTimer;
  const saveDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try { localStorage.setItem('luxalgo-web:script', JSON.stringify({ src: srcBox.value, name: nameBox.value })); } catch { /* private mode */ }
    }, 400);
  };
  srcBox.addEventListener('input', saveDraft);
  nameBox.addEventListener('input', saveDraft);
  $('#script-close').addEventListener('click', () => setPanel('script', false));
  /* Escape hides the right column again (operator's note in the app's chat, 25 Sep: "i got opened
     the PineTS but when i click escape, i want it to hide back"). It works from inside the editor
     too — the draft is saved as you type (saveDraft), so hiding the pane loses nothing. */
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented) return;
    /* The Indicators surface is the topmost thing when it is up, so it takes the Escape first —
       one Escape closes ONE surface (the F6 rule below). */
    if (typeof closeIndicatorsIfOpen === 'function' && closeIndicatorsIfOpen()) {
      ev.preventDefault();
      return;
    }
    if (el.main.dataset.detail !== 'on') return;
    setPanel('script', false);
  });
  runBtn.addEventListener('click', async () => {
    const source = srcBox.value;
    const label = nameBox.value.trim() || 'Untitled script';
    runBtn.disabled = true;
    outBox.textContent = `Running “${label}”…`;
    try {
      await chartReady;
      const r = await window.TraderRun.run(source, label);
      if (!r.ok) {
        outBox.textContent = '✗ ' + r.reason;
        toast('Pine: ' + r.reason, true);
      } else {
        outBox.textContent = window.TraderRun.summarize(r);
        log(`“${label}” ran in ${r.ms} ms`);
        refreshIndicatorCount();
        /* F3 (25 Sep): say where the paint went, and point at it — the operator's recording showed
           a run finishing with nothing visibly changing, because the chart behind the pane was
           blank. A pulse on the chart closes that loop. */
        const n = Array.isArray(r.series) ? r.series.length : (r.series || 0);
        toast(`“${label}” ran in ${r.ms} ms · ${n} series · the paint is on the chart`);
        noteActivity(`ran “${label}” · ${n} series · ${r.ms} ms`, 'chart_apply_pine');
        nudgeChart();
        flashChart();
      }
    } catch (err) {
      outBox.textContent = '✗ ' + err.message;
      toast('Run failed: ' + err.message, true);
    } finally { runBtn.disabled = false; }
  });

  el.form.addEventListener('submit', runSearch);
  $('#chips').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    el.q.value = chip.dataset.q;
    runSearch();
  });


  // The library folds away so the chart keeps the height; the caret toggles it.
  if (el.libraryToggle && el.libraryPanel) {
    el.libraryToggle.addEventListener('click', () =>
      setLibraryCollapsed(!el.libraryPanel.classList.contains('is-collapsed')));
    setLibraryCollapsed(el.libraryPanel.classList.contains('is-collapsed'));
  }

  // Theme: one button, two systems (our palette + the chart's own theme)
  $('#theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });
  document.documentElement.dataset.theme = currentTheme();

  initIndicators();
  await checkHealth();
  try { await bootChart(); }
  catch (err) { console.error(err); log('Chart failed to boot: ' + err.message); toast('Chart failed: ' + err.message, true); }
  /* The bridge's own mutations (`apply`, `draw` from the agent's CLI) never touch a button on this
     page, so wrap the one function both of them end in: every run that produced a sentence lands on
     the activity line, whoever started it. */
  if (window.TraderRun && typeof window.TraderRun.summarize === 'function') {
    const summarize = window.TraderRun.summarize.bind(window.TraderRun);
    window.TraderRun.summarize = (r) => {
      const line = summarize(r);
      noteActivity(line, 'chart_apply_pine');
      return line;
    };
  }


  if (new URLSearchParams(location.search).get('q')) {
    el.q.value = new URLSearchParams(location.search).get('q');
    runSearch();
  }

  // Exposed for scripted checks (browser automation, console experiments).
  window.__app = {
    get chart() { return chart; }, mountIndicator, queueMount, runSearch, api,
    /* The bridge's `palette` op needs the SAME action the ◐ toggle runs (our palette + Vela's
       chrome + the chart's parked colours). Exposing it keeps one implementation. */
    applyTheme,
    showView,
    get mounted() { return mounted.slice(); },
    get pineReady() { return pineReady; },
  };
  // Silent: this is the app's own self-report, kept in the DOM for scripts — not a line to park
  // under the chart (operator's call, 16 Sep).
  log('Ready. Vela: ' + (chart ? 'mounted' : 'failed') + ' · Pine engine: ' + (pineReady ? 'registered (execution verified per mount)' : 'missing'), true);
}

window.addEventListener('DOMContentLoaded', main);
