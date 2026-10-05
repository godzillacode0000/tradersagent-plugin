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
  detail: $('#detail'),
  dot: $('#status-dot'),
  chartLog: $('#chart-log'), chartOrigin: $('#chart-origin'), toast: $('#toast'),
  main: $('.main'),
  scriptFallback: $('#script-fallback'),
  fullFallback: $('#full-fallback'), focusExit: $('#chart-focus-exit'),
  statusbar: $('.statusbar'),
};

/* ── panel layout (chart-first, 16 Sep) ──────────────────────────────────────
 * The chart owns the pane. The library and the detail panel open from the agent's own actions
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
  /* The detail element moved into the drawer (3 Oct); its visibility is the drawer's business. */
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify({ ...readPanelPrefs(), rightview: which }));
  } catch { /* private mode */ }
}

function syncRightButtons() {
  const col = el.main.dataset.detail === 'on';
  /* The `<>` toggle is a Vela widget action now; only the bare-chart fallback wears the pressed state. */
  if (el.scriptFallback) el.scriptFallback.setAttribute('aria-pressed', String(col && rightViewIs('script')));
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

/* #4 — dock or overlay? A docked column needs room for a legible chart (320px) AND a legible pane
   (380px); 760px is the floor, with a little air. Below it the pane overlays, which is what the
   console has always done. Re-evaluated on resize, so a Hermes pane that widens starts docking. */
const DOCK_MIN = 760;
function syncDock() {
  const dock = window.innerWidth >= DOCK_MIN ? 'on' : 'off';
  if (el.main.dataset.dock !== dock) {
    el.main.dataset.dock = dock;
    nudgeChart();
  }
}
syncDock();
window.addEventListener('resize', syncDock);

function setPanel(name, on) {
  if (name === 'detail' || name === 'script') {
    on = Boolean(on);
    if (on) { syncDock(); showRightView(name); }
    el.main.dataset.detail = on ? 'on' : 'off';
    if (on) setPaneTop();
    syncRightButtons();
    try { localStorage.setItem(PANELS_KEY, JSON.stringify({ ...readPanelPrefs(), detail: on })); } catch { /* private mode */ }
    nudgeChart();
    return;
  }
  el.main.dataset[name] = on ? 'on' : 'off';
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


/* `<>` Script and full screen are real Vela widget actions now (3 Oct, workspace.js registers them):
   Vela renders and maintains them in its own row, so the hand-docking this file used to do — and its
   4 s re-dock timer, which is why buttons jumped between rows — is gone. A bare chart (no workspace
   row) gets plain fallback buttons instead; see showFallbacks() in the boot wiring. */


/* ── Full screen for the chart (27 Sep) ───────────────────────────────────────────────────────────
 * The operator's ask: "sy nak ada button capability untuk boleh kasi fullscreen ni chart". Two halves,
 * because they answer two different questions — and only the first one can be guaranteed:
 *
 *   · `body.chart-focus` hides the console's own chrome (topbar, statusbar, both panels) so the CHART
 *     owns this page. Pure CSS, works in every host, nothing to refuse.
 *   · native fullscreen is asked for on top of that, so the console takes the whole display. It needs
 *     the plugin pane's iframe to carry `allowfullscreen` (plugin/plugin.js) and a host that allows
 *     it; if it is refused the page half still lands, and `native` in the answer says which happened.
 *
 * Esc, the button again, or the floating ✕ comes back. The `fullscreenchange` listener in the boot
 * section re-syncs the class, because an Esc inside native fullscreen never reaches a keydown handler.
 */
function isChartFullscreen() {
  return Boolean(document.fullscreenElement) || document.body.classList.contains('chart-focus');
}

/** Vela measures its host with a ResizeObserver, but this costs nothing and covers a host that only
    listens for window resizes: full screen changes the chart's box without a window resize. */
function syncChartBox() {
  try { window.dispatchEvent(new Event('resize')); } catch { /* nothing to do */ }
}

/** Paint the page half from the state we hold — class, floating ✕, the button's own pressed look. */
function paintChartFocus(on) {
  document.body.classList.toggle('chart-focus', on);
  if (el.focusExit) el.focusExit.hidden = !on;
  if (el.fullFallback) {
    el.fullFallback.setAttribute('aria-pressed', String(on));
    el.fullFallback.classList.toggle('is-on', on);
  }
  syncChartBox();
}

/* Whether the BROWSER was in fullscreen, kept apart from what was asked for. `isChartFullscreen()`
   reads the class too, so it can never be the thing that decides to turn the class off — measured
   27 Sep: Esc inside native fullscreen left the class on, and the console stayed full-bleed with no
   visible way back. */
let nativeFullscreenWasOn = false;

function setChartFullscreen(on = true) {
  const want = on !== false;
  paintChartFocus(want);
  let native = Boolean(document.fullscreenElement);
  try {
    if (want && !native && document.documentElement.requestFullscreen) {
      const asked = document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (asked && asked.catch) asked.catch(() => { /* the page half is already on */ });
    } else if (!want && native && document.exitFullscreen) {
      const left = document.exitFullscreen();
      if (left && left.catch) left.catch(() => { /* it is leaving anyway */ });
    }
  } catch { /* no fullscreen API here — the chart still takes the page */ }
  native = Boolean(document.fullscreenElement);
  nativeFullscreenWasOn = native;
  return { fullscreen: want, native, page: document.body.classList.contains('chart-focus') };
}
window.setChartFullscreen = setChartFullscreen;
window.isChartFullscreen = isChartFullscreen;


/* F5 (25 Sep): the right column must never sit on top of the chart's own toolbar row — that is
   where Vela keeps its controls and where our Script / catalogue buttons are docked. The row is
   real DOM, so measure it; the CSS fallback covers a bare chart with no row at all. */
function setPaneTop() {
  const row = document.querySelector('.vela-widget-topbar');
  const h = row ? Math.ceil(row.getBoundingClientRect().height) : 0;
  /* No console first row any more (3 Oct): the pane's top is Vela's own row height, nothing else. */
  /* With no Vela row the fallback strip floats top-right at z above the pane, and on a docked pane it
     covered the name field, ▶ Run and ✕ (the operator's screenshot at ~770 px, 5 Oct). Measure where the
     strip ends so the pane can start below it. 0 when every button in it is hidden. */
  const strip = document.getElementById('fallback-strip');
  const sb = strip && strip.offsetHeight > 0 ? Math.ceil(strip.getBoundingClientRect().bottom) + 6 : 0;
  document.documentElement.style.setProperty('--lx-strip-h', `${sb}px`);
  /* An overlay pane (under 760 px) starts below the row — or, with no usable row, below the strip. */
  document.documentElement.style.setProperty('--lx-pane-top', `${h > 0 ? h : Math.max(44, sb)}px`);
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
const ACTIVITY_MAX = 140;   // one sentence the eye can take in; the whole thing stays in the tooltip
function noteActivity(text, tool) {
  const line = document.getElementById('last-action');
  if (!line) return;
  const full = String(text == null ? '' : text);
  line.textContent = full.length > ACTIVITY_MAX ? full.slice(0, ACTIVITY_MAX - 1).trimEnd() + '…' : full;
  line.title = tool ? tool + ' · ' + full : full;
  const bar = line.closest('.statusbar');
  if (bar) bar.classList.add('has-activity');
}

window.taToast = (m, b) => toast(m, b);          // broker.js speaks through the footer slip
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
  // Their port ships two engines and the docs' own line — "Off the main thread" — makes the worker the
  // one to reach for first. Here the OTHER axis wins: the module's PineEngine runs on the patched
  // `pinets` (import map → vendor/pinets), while both worker classes run an engine copy inlined in
  // vela-pinets' dist (the audit's #17). The workspace offers the same switch — `?engine=worker` or
  // localStorage `luxalgo-web:pine-engine` — and this path honours it too (round 3 said it did not,
  // so the switch silently applied to the workspace only; round 4 found it was never shipped here).
  const wantWorker = (() => {
    try {
      if (new URLSearchParams(location.search).get('engine') === 'worker') return true;
      return localStorage.getItem('luxalgo-web:pine-engine') === 'worker';
    } catch (err) { return false; }
  })();
  const Pine = wantWorker
    ? (window.VelaPinets?.PineWorkerEngine ?? window.__velaPinetsModule?.PineEngine)
    : (window.__velaPinetsModule?.PineEngine
      ?? window.VelaPinets?.PineWorkerEngine ?? window.VelaPinets?.PineEngine);
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
    log('Pine engine on this chart: ' +
        (Pine === window.__velaPinetsModule?.PineEngine ? 'PineEngine (main thread, patched fork)'
          : Pine === window.VelaPinets?.PineWorkerEngine ? 'PineWorkerEngine (Web Worker, vela-pinets copy)'
            : Pine === window.VelaPinets?.PineEngine ? 'PineEngine (main thread, vela-pinets copy)'
              : 'unknown engine class'));
  } else {
    pineReady = false;
    toast('Pine engine missing — indicators cannot be mounted', true);
  }
  return instance;
}

/* The bars line feeds the status dot (3 Oct). It used to be a pill in the top row whose text had to
   be measured against a hard CSS cap (#bars-status) — the operator once saw "bars: live · wo…", a
   word cut in half (23 Sep pane audit). The dot shows text only when something is wrong, so the full
   sentence now lives in `title` and nothing can be clipped mid-word. */
let barsLast = null;
/* One status dot (3 Oct): the Agent pill and the bars pill were two green lights saying "fine".
   Each source keeps its own state; the dot paints green when both are fine and grows text only
   when something is wrong — "it is green almost always, so show text only when something is wrong". */
const statusState = { mcp: null, bars: null };   // null = not answered yet; { ok, text }
function paintStatus() {
  const m = statusState.mcp, b = statusState.bars;
  if (!el.dot) return;
  const bad = [];
  if (m && m.ok === false) bad.push(m.text || 'agent offline');
  if (b && b.ok === false) bad.push(b.text || 'no bars');
  const waiting = !m || !b;
  el.dot.className = 'status-dot ' + (bad.length ? 'is-bad' : waiting ? 'is-wait' : 'is-ok');
  el.dot.textContent = bad.length ? '● ' + bad.join(' · ') : '●';
  el.dot.title = [m && m.text, b && b.text].filter(Boolean).join(' · ')
    || 'Agent and bars — the two lights this dot replaced';
  /* The dot rides Vela's row as a widget action (3 Oct); this statusbar copy is the bare-chart
     fallback. Publish the state once and let the row re-render itself. */
  window.taToast = toast;
  window.taStatus = { state: bad.length ? 'bad' : waiting ? 'wait' : 'ok',
                      text: bad.join(' · '), title: el.dot.title };
  window.dispatchEvent(new CustomEvent('ta-status'));
}
function setBars(text, detail) {
  barsLast = { text, detail };
  const full = detail ? text + ' · ' + detail : text;
  statusState.bars = { ok: /live/.test(text) ? true : /offline|failed/.test(text) ? false : null, text: full };
  paintStatus();
}

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
        el.chartOrigin.textContent = 'full Vela workspace · binance provider';
        document.body.classList.add('has-workspace');   // hides our redundant chart header
        log('Workspace active: cell chart adopted. Pine mounting remains experimental.');
        /* The workspace built its toolbar row by now — put the `<>` control on it. */
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

  /* The bare-chart fallback below registers an engine SYNCHRONOUSLY, and the global build
     (`window.VelaPinets`) carries vela-pinets' own, unpatched engine. Fetch the module's classes
     first — that module runs on the `pinets` the import map serves, i.e. the patched fork — and
     fall back to the global if it cannot load. The workspace path (the live one) does this already. */
  try {
    const mod = await import('@luxalgo/vela-pinets');
    if (typeof mod.PineEngine === 'function') {
      window.__velaPinetsModule = { PineEngine: mod.PineEngine, PineWorkerEngine: mod.PineWorkerEngine };
    }
  } catch (err) {
    log('vela-pinets module unavailable — the bare chart will use the global build\'s engine.');
  }

  const Binance = window.Vela?.BinanceProvider;

  if (typeof Binance === 'function') {
    try {
      chart = newChart(host, { symbol: 'BTCUSDT', timeframe: '1h' });
      chart.data.registerProvider('binance', new Binance());
      const ready = typeof chart.ready === 'function' ? chart.ready() : Promise.resolve();
      await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('provider timeout')), 12000))]);
      setBars('bars: live', 'Binance BTCUSDT 1h');
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
/* Vela's timeframe strings → the lowercase interval the venue (and /api/bars) takes. A cell keeps whatever
   string it was set with: '1m' '15m' '1h' '4h' '1d' '1w', or bare minutes ('60', '240') or TradingView
   style ('D', 'W'). An unrecognised string is passed on lowercased rather than guessed at. */
function intervalOf(tf) {
  const s = String(tf == null ? '' : tf).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n % 1440 === 0 ? (n / 1440) + 'd' : n % 60 === 0 ? (n / 60) + 'h' : n + 'm';
  }
  const m = s.match(/^(\d*)([mhdwMHDW])$/);
  if (!m) return s.toLowerCase();
  const n = m[1] || '1';
  const u = m[2];
  return u === 'M' ? n + 'M' : n + u.toLowerCase();   // a capital M is a month (Binance's own spelling)
}

/** What the ACTIVE workspace cell is showing — the workspace knows; nothing has to be scraped. */
function marketFromWorkspace() {
  try {
    const ws = window.__wsApp && window.__wsApp.ws;
    if (!ws || !ws.cellsById) return null;
    const cell = typeof ws.cellsById.get === 'function' ? ws.cellsById.get(ws.activeId) : ws.cellsById[ws.activeId];
    if (!cell || !cell.symbol || !cell.timeframe) return null;
    return { symbol: String(cell.symbol), interval: intervalOf(cell.timeframe) };
  } catch (err) { return null; }
}

function marketFromDom() {
  /* The workspace first. The DOM scan below used to be the only reader, and Vela keeps its closed
     timeframe dropdown in the page: its first item is "1m", so the scan answered "1m" on EVERY chart
     (measured 4 Oct: 4h, 15m and 1h all read 1m) and every Pine run, study number and the heartbeat's
     timeframe came from the last 500 minutes of bars instead of the chart's own. */
  const fromWs = marketFromWorkspace();
  if (fromWs) return fromWs;
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
      if (el.closest('.vela-menu-item, [role="menu"], [role="listbox"], [hidden]')) return;   // a closed dropdown lists every choice
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
async function chartBars(opts) {
  /* `opts.limit` is how many bars a Pine run asked for (default 500: the heartbeat and the overlay's
     bar-index map ask often and stay cheap). A chart that hands over its own series ignores it. */
  const want = Math.max(30, Math.min(5000, Math.round(Number(opts && opts.limit) || 500)));
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
    // Through the console, not straight to the venue: api.binance.com sends no
    // Access-Control-Allow-Origin for http://127.0.0.1:8787, so the browser blocked this fetch and
    // every run reported "0 bars available". Same origin, and the console normalises the chart's
    // display timeframe ("30M") to the lowercase interval the venue accepts.
    const res = await fetch(`/api/bars?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${want}`);
    const payload = await res.json();
    // The console wraps every endpoint the same way: { ok, data: { bars, count, ... } }.
    const rows = payload && payload.ok && payload.data && Array.isArray(payload.data.bars)
      ? payload.data.bars
      : null;
    if (rows && rows.length) {
      return rows.map((r) => ({
        time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume
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
  log('Ran on chart after ' + ((Date.now() - t0) / 1000).toFixed(1) + 's: ' + name);
  return true;
}

/* The indicator-count pill is gone (3 Oct): what is on the chart is named by the drawer's own
   "On chart" strip (drawer.js), which reads the same one landasan list. */

/** Mount after the chart has finished booting (queues instead of throwing). */
async function queueMount(source, name) {
  if (!chart) {
    toast('Waiting for the chart to finish booting…');
    await chartReady;
  }
  return mountIndicator(source, name);
}

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

/** The catalogue's own preview for a slug — the row in hand, the loaded page, or what a star kept. */
function indicatorShot(slug, row) {
  if (row && row.image_url) return row.image_url;
  const hit = (indState.cat.rows || []).find((r) => r.slug === slug);
  return (hit && hit.image_url) || readShots()[favId('library', slug)] || '';
}

/** The local preview endpoint. The catalogue's picture is fetched and shrunk ONCE by the console and
 *  served from here: sixty cards straight from S3 meant sixty ~0.8 s waits over six connections
 *  (measured 26 Sep), which is why the grid looked empty while it filled.
 *
 *  Two widths, because the card grew (27 Sep): a card is up to ~430 px wide and asked for 480, the
 *  Details pane takes 960. Asking for the size actually painted is the whole point — the source is
 *  1600 px wide whatever we do. */
const CARD_SHOT_W = 480;
const DETAIL_SHOT_W = 960;

function thumbUrl(slug, rawUrl, width = CARD_SHOT_W) {
  if (!slug) return '';
  const params = new URLSearchParams({ slug: String(slug), w: String(width) });
  if (rawUrl) params.set('u', String(rawUrl));
  return '/api/library/thumb?' + params.toString();
}

async function openResult(row, button) {
  document.querySelectorAll('.row--active').forEach((n) => n.classList.remove('row--active'));
  button?.classList.add('row--active');
  el.detail.innerHTML = '<h2 class="detail__title">Loading…</h2><div class="skeleton"></div>';
  /* The detail is a view of the DRAWER now (3 Oct): one surface over the chart. This opens the
     drawer too, so a pick from the Library panel or the modal lands in the same place. */
  if (window.libDrawer && window.libDrawer.detail) window.libDrawer.detail(true);
  try {
    if (row.kind === 'indicator') {
      const data = await api('/api/source', { slug: row.slug });
      const source = data.source || '';
      const lic = licenseLine(source);
      /* The catalogue ships a preview picture per indicator (`image_url`, 1600×1000): the same
         thing the Library page shows, and the answer to "how does this look on a chart?" before
         running anything. Its own row is the authority; a star remembers it for later. */
      const shot = indicatorShot(row.slug, row);
      const local = thumbUrl(row.slug, shot, DETAIL_SHOT_W);
      if (shot) rememberShot(favId('library', row.slug), shot);
      el.detail.innerHTML = `
        <div class="detail__head">
          ${local ? `<img class="detail__shot" src="${esc(local)}" loading="lazy" decoding="async"
              alt="${esc(data.name || row.slug)} as it looks on a chart">` : ''}
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
            <button class="btn btn--ghost" id="edit-copy" title="Open this source in the Script pane — your changes never touch the Library">✎ Edit a copy</button>
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
      /* (c) "Edit a copy" (the doc's §2c): the source goes into the Script pane as a COPY — the
         editor is the one surface allowed to sit beside the chart, and the Library row is untouched. */
      $('#edit-copy').addEventListener('click', () => {
        const box = document.getElementById('script-src');
        const name = document.getElementById('script-name');
        if (!box) { toast('No script pane on this page', true); return; }
        box.value = source;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        if (name) name.value = (data.name || row.slug) + ' (copy)';
        if (window.libDrawer) window.libDrawer.open(false);
        setPanel('script', true);
        noteActivity(`copied “${data.name || row.slug}” into the Script pane`, 'edit_copy');
      });
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

/* What the one surface reads: the chart's own natives and the whole LuxAlgo catalogue (one call,
   `/api/catalogue`, kept on disk). The drawer filters it in memory, so a search cannot race a
   section change the way the old paged fetch could (measured 26 Sep: `0 row(s)` while the API
   answered ten). */
const indState = {
  natives: null,        // null = not read yet; [] = this chart truly has none
  nativesError: '',
  cat: { rows: [], groups: [], state: 'idle', error: '', pages: 0 },
};

/* The catalogue's own preview pictures, remembered next to the stars: a favourite starred from the
   LIBRARY keeps its thumbnail even before the catalogue page that carried it is loaded again. The
   URL comes from the row (`image_url`, LuxAlgo's S3 — 1600×1000 chart shots). */
const SHOT_KEY = 'luxalgo-web:indicator-shots';

function readShots() {
  try {
    const v = JSON.parse(localStorage.getItem(SHOT_KEY));
    return (v && typeof v === 'object') ? v : {};
  } catch { return {}; }
}

function rememberShot(key, url) {
  if (!key || !url) return;
  const map = readShots();
  if (map[key] === url) return;
  map[key] = url;
  try { localStorage.setItem(SHOT_KEY, JSON.stringify(map)); } catch { /* private mode */ }
}

function readFavourites() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY));
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
  } catch { return []; }
}
const favId = (kind, id) => kind + ':' + id;
const isFavourite = (kind, id) => readFavourites().includes(favId(kind, id));

function toggleFavourite(kind, id, label, shot) {
  const key = favId(kind, id);
  const list = readFavourites();
  const at = list.indexOf(key);
  if (at === -1) { list.push(key); rememberShot(key, shot); } else list.splice(at, 1);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  toast((at === -1 ? '★ ' : '☆ ') + label + (at === -1 ? ' starred' : ' unstarred'));
  if (window.libDrawer && window.libDrawer.refresh) window.libDrawer.refresh();
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

/** The other half: the LuxAlgo Library catalogue — the whole thing, once (see `loadCatalogue`).

    The paged-server version is gone on purpose. It could race (the door sets the section and the
    search text in the same breath, and the first load, started with the old query, swallowed the
    second: measured live on 26 Sep, `--section library --q supertrend` painted `0 row(s)` while the
    API answered `total 10`), it could not count a family it had not paged to, and a card's write-up
    lives on the row — none of which a page of sixty can answer. Filtering locally cannot race
    anything. */
/** The family filter lives in the nav while the LIBRARY is showing: one line per family of the
    catalogue, with its count, plus "Everything". This is the "respective concept or aspect or group"
    half of the ask — the headers in the grid say where you are, this says where you can go. */



/** The whole catalogue, once. `/api/catalogue` walks the nine pages on the server and keeps the
    answer on disk, so this is one local call after the first time on a machine. */
async function loadCatalogue() {
  if (indState.cat.state === 'loading') return;
  indState.cat.state = 'loading';
  if (window.libDrawer && window.libDrawer.refresh) window.libDrawer.refresh();
  try {
    const data = await api('/api/catalogue');
    indState.cat.rows = data.rows || [];
    indState.cat.groups = data.groups || [];
    indState.cat.pages = data.pages || 0;
    indState.cat.state = 'ready';
  } catch (err) {
    indState.cat.state = 'error';
    indState.cat.error = err.message || 'the catalogue did not answer';
    toast('Catalogue: ' + indState.cat.error, true);
  }
  if (window.libDrawer && window.libDrawer.refresh) window.libDrawer.refresh();
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
  noteActivity((landed ? 'added ' : 'tried to add ') + title + ' from the drawer', 'chart_add_indicator');
  if (window.libDrawer && window.libDrawer.refresh) window.libDrawer.refresh();
  return landed;
}





/* The drawer exposes its own API to the bridge (window.libDrawer, drawer.js); these two are exposed
   here for the same reason — the bridge must not assume a classic script's globals, so a future
   bundling step cannot quietly break the agent's doors. `openResult` is the one way a picked row
   reaches the Details view, and the agent's `open` action uses it for concepts (which have no row of
   their own). */
window.mountNative = mountNative;
window.openResult = openResult;




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
    /* Spec §5, amended 3 Oct: the dot is shared with the bars state — see paintStatus(). The numbers
       live in the tooltip; text appears on the dot only when something is wrong. */
    statusState.mcp = {
      ok: ready,
      text: (ready ? 'Agent: ' + label : 'Agent: offline') + ' · ' + (ready
        ? (data.mcp_url || (data.mcp && data.mcp.url) || 'connected')
        : ((data.mcp_error || (data.mcp && data.mcp.last_error)) || 'not connected')),
    };
    paintStatus();
    if (!ready) toast('LuxAlgo MCP is not connected — see backend log', true);
  } catch (err) {
    statusState.mcp = { ok: false, text: 'Agent: offline — ' + err.message };
    paintStatus();
    toast('Backend unreachable — start ./console/start.sh (or luxalgo-web.service) first', true);
  }
}


/* The script pane's control surface (3 Oct): the `<>` toggle is a Vela widget action, so the agent
   has no button to click — these functions ARE the door, and they answer with the pane's own state
   (the COLUMN and the view — the 23 Sep lesson) so a report of "open" is never about a shut column. */
window.scriptPane = {
  open: () => { setPanel('script', true); return window.scriptPane.state(); },
  close: () => { setPanel('script', false); return window.scriptPane.state(); },
  toggle: () => { togglePanel('script'); return window.scriptPane.state(); },
  state: () => ({ open: el.main.dataset.detail === 'on' && rightViewIs('script') }),
};

/* F6 (25 Sep): Escape closes whatever this pane opened. Only the family popover listened for it,
   so the script pane — the operator's "I opened PineTS, Escape should hide it" — could only be
   closed with its ✕.

   ONE handler, one layer per press, topmost first (5 Oct): the library drawer (it sits over the chart),
   then the script pane's Settings view (it takes the editor's place), then the pane itself. The drawer
   check used to live in a second handler bound after this one; with the pane open this one had already
   closed the pane and prevented the event, so the drawer stayed open and the pane went first — the
   reverse of the intent (measured in Hermes Desktop, 5 Oct). A press the Edge sheet handled never gets
   here (its capture handler stops it). This handler must NOT skip a press that is merely
   defaultPrevented: after a click on the chart Vela marks Escape handled (its own cancel / deselect), and
   skipping then meant Escape no longer closed the pane (measured 5 Oct, caught by an A/B run). */
function escapeKeydown(ev) {
  if (ev.key !== 'Escape') return;
  const closed = (typeof window.closeDrawerIfOpen === 'function' && window.closeDrawerIfOpen())
    || (typeof window.closeScriptLayerIfOpen === 'function' && window.closeScriptLayerIfOpen());
  if (closed) { ev.preventDefault(); return; }
  if (el.main && el.main.dataset.detail === 'on') {
    ev.preventDefault();
    setPanel('detail', false);
  }
}

async function main() {
  /* Chart-first (16 Sep): the chart owns the pane, and the script pane deliberately never restores
     open — nothing is being edited at load time, so it would paint an empty column over the chart.
     (setPanel persists, so a stale `detail: true` is cleaned up here.) The picked result lives in
     the drawer now (3 Oct), not in a column. */
  setPanel('detail', false);   // never restore the column open (his 17 Sep complaint)
  showRightView('script');   /* the column keeps ONE view now (3 Oct) — the editor; the detail is the drawer's */
  /* Bare-chart fallbacks (3 Oct): the drawer door, the script pane and full screen are Vela widget
     actions now, so with no workspace row there is nothing to press. One check after boot reveals
     plain buttons for the two here (drawer.js reveals its own), wired to the same functions the
     widget actions run. */
  /* The door is unreachable in Vela's compact mode too: under ~640px Vela hides its desktop row
     (0-width), so "no row" must mean "no USABLE row", not "no element" — else a narrow pane has no
     toolbar and no way in (the doc's compact-mode check). */
  const showFallbacks = () => {
    const row = document.querySelector('.vela-widget-topbar');
    const usable = !!(row && row.getBoundingClientRect().width > 0);
    for (const b of [el.scriptFallback, el.fullFallback]) if (b) b.hidden = usable;
    setPaneTop();
    /* The status dot is a widget action in Vela's row; the statusbar copy is the fallback only. */
    if (el.dot) el.dot.hidden = usable;
  };
  window.addEventListener('ws-failed', showFallbacks);
  window.addEventListener('resize', showFallbacks);
  setTimeout(showFallbacks, 8000);
  el.scriptFallback?.addEventListener('click', () => togglePanel('script'));
  el.fullFallback?.addEventListener('click', () => setChartFullscreen(!isChartFullscreen()));

  document.addEventListener('keydown', escapeKeydown);

  // Script pane (restored 23 Sep) — Run goes through the one landasan; the draft survives reloads.
  const srcBox = $('#script-src'), outBox = $('#script-out'), nameBox = $('#script-name'), runBtn = $('#script-run');
  const statBox = $('#script-stat'), stateDot = $('#script-state'), statusBtn = $('#script-status');
  const runsBox = $('#script-runs'), fixBox = $('#script-fix'), gutter = $('#script-gutter');
  const paneEl = $('#view-script'), gearBtn = $('#script-gear'), setBox = $('#script-settings');
  const setBody = $('#script-settings-body'), setTitle = $('#script-settings-title'), setReset = $('#script-settings-reset');
  const markCur = $('#script-mark-cur'), markErr = $('#script-mark-err');
  const ST = window.ScriptTools;

  /* The status line (5 Oct) replaces the Logs chip, the static "Pine v6" pill and the hint paragraph:
     one line that always says what the last Run did, as a word first ("Ran", "Failed") so the dot is
     never the only signal. Pressing it opens / folds the run list below. Stacked under the chart
     (under 760 px, a 40dvh pane) the list starts folded, so the editor keeps the room. */
  const setStatus = (state, text) => {
    if (stateDot) stateDot.dataset.state = state;
    if (statBox) { statBox.textContent = text; statBox.title = text; }
  };
  const setRunsOpen = (open) => {
    if (!runsBox || !statusBtn) return;
    runsBox.classList.toggle('is-folded', !open);
    statusBtn.setAttribute('aria-expanded', String(open));
  };
  setRunsOpen(window.innerWidth >= DOCK_MIN);
  if (statusBtn) {
    statusBtn.addEventListener('click', () => setRunsOpen(statusBtn.getAttribute('aria-expanded') !== 'true'));
  }

  /* The run list: newest first, one entry per Run — when, which script, what it drew, its ⚠ notes, and the
     full engine line behind a fold. Built with textContent only: the name is typed by the operator and
     the reason is engine text, so neither ever reaches innerHTML. The engine has no log.* output to
     show (searched the bundle, 5 Oct), so this is a run history, not a Pine console. */
  const RUNS_MAX = 20;
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const drewWords = (d) => {
    if (!d) return '';
    const parts = [];
    for (const [k, one, many] of [['boxes', 'box', 'boxes'], ['lines', 'line', 'lines'], ['labels', 'label', 'labels'], ['tables', 'table', 'tables']]) {
      const v = d[k] || 0;
      if (v) parts.push(v + ' ' + (v === 1 ? one : many));
    }
    return parts.join(' · ');
  };
  const addRun = ({ ok, label, facts, notes, detail, line }) => {
    if (!outBox) return;
    const li = node('li', 'run ' + (ok ? 'run--ok' : 'run--fail'));
    const head = node('div', 'run__head');
    head.appendChild(node('span', 'run__mark', ok ? '✓' : '✗'));
    head.appendChild(node('span', 'run__name', label));
    head.appendChild(node('time', 'run__time', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })));
    li.appendChild(head);
    if (facts) li.appendChild(node('div', 'run__facts', facts));
    if (line) {
      const go = node('button', 'run__go', 'Go to line ' + line);
      go.type = 'button';
      go.addEventListener('click', () => goToLine(line));
      li.appendChild(go);
    }
    for (const n of notes || []) li.appendChild(node('div', 'run__note', '⚠ ' + n));
    if (detail) {
      const d = node('details', 'run__more');
      d.appendChild(node('summary', null, 'Engine detail'));
      d.appendChild(node('pre', null, detail));
      li.appendChild(d);
    }
    outBox.prepend(li);
    while (outBox.childElementCount > RUNS_MAX) outBox.lastElementChild.remove();
    outBox.scrollTop = 0;
  };

  /* ── line numbers, the caret's line, and the line an error names ─────────────────────────────────
     A textarea has no gutter of its own, so a sibling mirrors the count. The editor does not wrap
     (wrap="off"), so one source line is one row and the numbers cannot drift. Once lines scroll
     sideways the textarea grows a horizontal scrollbar its sibling does not have; without the same room
     at the bottom the gutter could not scroll as far, and the last numbers slid off. The two row
     tints are drawn from the same arithmetic (row height x line), so they sit exactly on their line. */
  let curLine = 0, errLine = 0;
  const rowHeight = () => parseFloat(getComputedStyle(srcBox).lineHeight) || 19;
  const padTop = () => parseFloat(getComputedStyle(srcBox).paddingTop) || 0;
  const placeMark = (mark, line) => {
    if (!mark) return;
    if (!line) { mark.hidden = true; return; }
    const lh = rowHeight();
    const y = padTop() + (line - 1) * lh - srcBox.scrollTop;
    mark.hidden = y < -lh || y > srcBox.clientHeight;
    mark.style.height = lh + 'px';
    mark.style.transform = `translateY(${y}px)`;
  };
  const paintGutterClasses = () => {
    if (!gutter) return;
    for (const s of gutter.querySelectorAll('.is-cur, .is-err')) s.classList.remove('is-cur', 'is-err');
    const c = gutter.children[curLine - 1];
    if (c && document.activeElement === srcBox) c.classList.add('is-cur');
    const e = gutter.children[errLine - 1];
    if (e) e.classList.add('is-err');
  };
  const paintMarks = () => {
    placeMark(markCur, document.activeElement === srcBox ? curLine : 0);
    placeMark(markErr, errLine);
    paintGutterClasses();
  };
  const paintGutter = () => {
    if (!gutter) return;
    const n = Math.max(1, srcBox.value.split('\n').length);
    if (gutter.childElementCount !== n) {
      gutter.textContent = '';
      for (let i = 1; i <= n; i++) gutter.appendChild(node('span', null, String(i)));
    }
    const bar = Math.max(0, srcBox.offsetHeight - srcBox.clientHeight);
    gutter.style.paddingBottom = `calc(var(--lx-space-2) + ${bar}px)`;
    gutter.scrollTop = srcBox.scrollTop;
    paintMarks();
  };
  const caretLine = () => srcBox.value.slice(0, srcBox.selectionStart).split('\n').length;
  const syncCaret = () => { const l = caretLine(); if (l !== curLine) { curLine = l; paintMarks(); } };
  const clearError = () => { if (errLine) { errLine = 0; paintMarks(); } };
  const revealLine = (line) => {
    const lh = rowHeight();
    const top = padTop() + (line - 1) * lh;
    if (top < srcBox.scrollTop + lh || top > srcBox.scrollTop + srcBox.clientHeight - 2 * lh) {
      srcBox.scrollTop = Math.max(0, top - srcBox.clientHeight / 3);
    }
    if (gutter) gutter.scrollTop = srcBox.scrollTop;
  };
  const showErrorAt = (line) => { errLine = line; revealLine(line); paintMarks(); };
  const goToLine = (line) => {
    const rows = srcBox.value.split('\n');
    const n = Math.min(Math.max(1, line), rows.length);
    let start = 0;
    for (let i = 0; i < n - 1; i++) start += rows[i].length + 1;
    setSettingsOpen(false);
    srcBox.focus();
    srcBox.setSelectionRange(start, start + rows[n - 1].length);
    revealLine(n);
    syncCaret();
  };

  /* Lost line breaks (5 Oct). A script that arrives as ONE line — pasted from somewhere that ate the
     newlines, or sent with a literal "\n" — is a silent failure in Pine: the first `//` comments out
     everything after it, and Run draws nothing. Say so, and when the breaks are only escaped, offer to
     put them back (the operator presses it; the source is never rewritten behind their back). The
     decision is ScriptTools.diagnoseBreaks: breaks inside a string literal are left as written, escaped
     breaks are flagged at any length (a 69-character collapsed script is just as broken), and the length
     gate stays only on the no-escape case, so an ordinary one-line `plot(close)` is never flagged. */
  const checkBreaks = () => {
    if (!fixBox) return;
    const d = ST.diagnoseBreaks(srcBox.value);
    if (!d.kind) { fixBox.hidden = true; fixBox.textContent = ''; return; }
    fixBox.textContent = '';
    fixBox.appendChild(node('span', null, d.kind === 'escaped'
      ? 'This script is one line with "\\n" where the line breaks should be.'
      : 'This script is one line, so the first // comment hides everything after it.'));
    if (d.kind === 'escaped') {
      const b = node('button', 'btn btn--ghost', 'Restore line breaks');
      b.type = 'button';
      b.addEventListener('click', () => {
        srcBox.value = d.fixed;
        srcBox.dispatchEvent(new Event('input', { bubbles: true }));
      });
      fixBox.appendChild(b);
    }
    fixBox.hidden = false;
  };

  /* ── the script's inputs (Settings) ──────────────────────────────────────────────────────────────
     The engine reads the script's input.*() declarations without running it (PineTSRunner.scanInputs, in
     a worker). Each becomes a control; a value the operator changes is kept against the script's own
     title, handed to the next Run as an override, and — if that script is on the chart — applied at once,
     so there is no Save. Untouched inputs are never sent: an unchanged script runs exactly as before. */
  let inputsMeta = [];            // what the engine says the script declares
  let inputStore = {};            // inputKey -> value, only what differs from the default
  let storeFor = '';              // the declared title those values belong to
  let settingsOpen = false;
  let scanSeq = 0, scanTimer = null, scanDirty = false;
  let lastRunSource = null;       // the source of the last successful Run from this pane
  let applyTimer = null;

  const changedCount = () => Object.keys(ST.overridesFor(inputsMeta, inputStore)).length;
  const currentValue = (meta) => {
    const key = ST.inputKey(meta);
    return Object.prototype.hasOwnProperty.call(inputStore, key) ? inputStore[key] : meta.defval;
  };
  const paintGear = () => {
    if (!gearBtn) return;
    gearBtn.hidden = inputsMeta.length === 0;
    const n = changedCount();
    gearBtn.setAttribute('aria-label', 'Script inputs (' + inputsMeta.length + (n ? ', ' + n + ' changed' : '') + ')');
    gearBtn.title = 'Inputs · ' + inputsMeta.length + (n ? ' · ' + n + ' changed' : '');
    if (n) gearBtn.dataset.changed = '1'; else delete gearBtn.dataset.changed;
  };

  const setSettingsOpen = (open) => {
    open = Boolean(open) && inputsMeta.length > 0;
    settingsOpen = open;
    if (paneEl) paneEl.classList.toggle('is-settings', open);
    if (setBox) setBox.hidden = !open;
    if (gearBtn) gearBtn.setAttribute('aria-pressed', String(open));
    if (open) renderSettings();
    else paintGutter();
  };

  /* one control per input; every value goes through ScriptTools.coerce, so a number is clamped to its own
     min / max and a choice is always one of its options before it can reach the engine */
  const hexParts = (v) => { const s = String(v || '#000000FF'); return { rgb: s.slice(0, 7).toLowerCase(), a: s.length >= 9 ? s.slice(7, 9).toUpperCase() : 'FF' }; };
  const msToLocalInput = (ms) => { const d = new Date(Number(ms)); return isFinite(d) ? d.toISOString().slice(0, 16) : ''; };

  const settingRow = (meta) => {
    const key = ST.inputKey(meta);
    const id = 'set-' + meta.id;
    const row = node('div', 'set__row');
    const label = node('label', 'set__label', meta.title || meta.name || meta.varId || meta.id);
    label.htmlFor = id;
    if (meta.tooltip) label.title = String(meta.tooltip);
    const ctl = node('div', 'set__ctl');
    const undo = node('button', 'set__undo', '↺');
    undo.type = 'button';
    undo.hidden = true;
    undo.title = 'Back to ' + String(meta.defval);
    undo.setAttribute('aria-label', 'Reset ' + (meta.title || meta.id) + ' to ' + String(meta.defval));

    const commit = (raw) => {
      const o = ST.overridesFor([meta], { [key]: raw });
      if (Object.prototype.hasOwnProperty.call(o, meta.id)) inputStore[key] = o[meta.id]; else delete inputStore[key];
      undo.hidden = !Object.prototype.hasOwnProperty.call(inputStore, key);
      inputsChanged();
    };
    const t = meta.type;
    let field;
    if (t === 'bool') {
      field = node('button', 'set__switch');
      field.type = 'button';
      field.setAttribute('role', 'switch');
      field.appendChild(node('span', 'set__knob'));
      const paint = () => field.setAttribute('aria-checked', String(currentValue(meta) === true));
      paint();
      field.addEventListener('click', () => { commit(!(currentValue(meta) === true)); paint(); });
    } else if (Array.isArray(meta.options) && meta.options.length) {
      field = node('select', 'set__select');
      for (const o of meta.options) { const op = node('option', null, String(o)); op.value = String(o); field.appendChild(op); }
      field.value = String(currentValue(meta));
      field.addEventListener('change', () => commit(field.value));
    } else if (t === 'color') {
      field = node('span', 'set__color');
      const pick = node('input', 'set__swatch');
      pick.type = 'color';
      pick.id = id;
      const hex = node('span', 'set__hex');
      const paint = () => { const v = hexParts(currentValue(meta)); pick.value = v.rgb; hex.textContent = v.rgb.toUpperCase() + (v.a === 'FF' ? '' : v.a); };
      paint();
      pick.addEventListener('input', () => { commit(pick.value.toUpperCase() + hexParts(currentValue(meta)).a); paint(); });
      field.append(pick, hex);
    } else if (t === 'int' || t === 'float' || t === 'price') {
      field = node('input', 'set__input');
      field.type = 'number';
      if (Number.isFinite(meta.minval)) field.min = String(meta.minval);
      if (Number.isFinite(meta.maxval)) field.max = String(meta.maxval);
      field.step = Number.isFinite(meta.step) ? String(meta.step) : (t === 'int' ? '1' : 'any');
      field.value = String(currentValue(meta));
      /* While typing, only a value already inside the input's own range counts ("1" on the way to "14" must
         not be clamped to the minimum and re-run); on leaving the field it is clamped and shown as kept. */
      field.addEventListener('input', () => {
        const n = Number(field.value);
        const inRange = field.value !== '' && isFinite(n) && !(Number.isFinite(meta.minval) && n < meta.minval) && !(Number.isFinite(meta.maxval) && n > meta.maxval);
        if (inRange) commit(field.value);
      });
      field.addEventListener('change', () => { commit(field.value); field.value = String(currentValue(meta)); });
      field.addEventListener('blur', () => { field.value = String(currentValue(meta)); });
    } else if (t === 'time') {
      field = node('input', 'set__input');
      field.type = 'datetime-local';
      field.value = msToLocalInput(currentValue(meta));
      field.addEventListener('change', () => { const ms = Date.parse(field.value + ':00Z'); if (isFinite(ms)) commit(ms); });
    } else {
      field = node('input', 'set__input');
      field.type = 'text';
      field.spellcheck = false;
      field.value = String(currentValue(meta));
      field.addEventListener('input', () => commit(field.value));
    }
    if (t !== 'color') field.id = id;
    undo.hidden = !Object.prototype.hasOwnProperty.call(inputStore, key);
    undo.addEventListener('click', () => {
      delete inputStore[key];
      undo.hidden = true;
      inputsChanged();
      renderSettings();
    });
    ctl.append(field, undo);
    row.append(label, ctl);
    return row;
  };

  const renderSettings = () => {
    if (!setBody) return;
    const keep = setBody.scrollTop;
    setBody.textContent = '';
    for (const g of ST.groupInputs(inputsMeta)) {
      const sec = node('section', 'set__group');
      sec.appendChild(node('h3', 'set__h', g.name));
      for (const meta of g.items) sec.appendChild(settingRow(meta));
      setBody.appendChild(sec);
    }
    const n = changedCount();
    if (setTitle) setTitle.textContent = inputsMeta.length + (inputsMeta.length === 1 ? ' input' : ' inputs') + (n ? ' · ' + n + ' changed' : '');
    if (setReset) setReset.hidden = n === 0;
    setBody.scrollTop = keep;
  };

  /* A value changed: remember it, and — when this exact script is what the last Run put on the chart —
     apply it. Otherwise say it is kept and what to press. */
  const inputsChanged = () => {
    paintGear();
    const n = changedCount();
    if (setTitle) setTitle.textContent = inputsMeta.length + (inputsMeta.length === 1 ? ' input' : ' inputs') + (n ? ' · ' + n + ' changed' : '');
    if (setReset) setReset.hidden = n === 0;
    saveDraft();
    clearTimeout(applyTimer);
    if (lastRunSource !== null && lastRunSource === srcBox.value) {
      applyTimer = setTimeout(() => doRun(), 350);
    } else {
      setStatus('idle', 'Inputs kept · press Run to apply');
    }
  };
  if (setReset) setReset.addEventListener('click', () => { inputStore = {}; inputsChanged(); renderSettings(); });
  if (gearBtn) gearBtn.addEventListener('click', () => setSettingsOpen(!settingsOpen));

  const applyMeta = (metas) => {
    inputsMeta = metas;
    const declared = ST.declaredName(srcBox.value);
    if (declared !== storeFor) { inputStore = {}; storeFor = declared; }
    inputStore = ST.reconcile(metas, inputStore);
    paintGear();
    if (settingsOpen) { if (!metas.length) setSettingsOpen(false); else renderSettings(); }
  };
  const scan = async () => {
    clearTimeout(scanTimer);
    const seq = ++scanSeq;
    const src = srcBox.value;
    const r = (src.trim() && window.PineTSRunner && window.PineTSRunner.scanInputs)
      ? await window.PineTSRunner.scanInputs(src) : { ok: true, inputs: [] };
    if (seq !== scanSeq) return;               // a newer edit superseded this scan
    scanDirty = false;
    /* A source that does not parse (mid-edit) has no inputs to offer, but it must not cost the operator
       the values they set: the store is only reconciled by a scan that succeeded. */
    if (r.ok) applyMeta(r.inputs || []); else { inputsMeta = []; paintGear(); if (settingsOpen) setSettingsOpen(false); }
  };
  const scheduleScan = (ms) => { scanDirty = true; clearTimeout(scanTimer); scanTimer = setTimeout(scan, ms == null ? 600 : ms); };

  if (gutter) {
    srcBox.addEventListener('input', paintGutter);
    srcBox.addEventListener('scroll', () => { gutter.scrollTop = srcBox.scrollTop; paintMarks(); });
    window.addEventListener('resize', paintGutter);
  }
  for (const ev of ['keyup', 'click', 'focus', 'blur', 'select']) srcBox.addEventListener(ev, () => { syncCaret(); paintMarks(); });
  srcBox.addEventListener('input', () => { clearError(); syncCaret(); checkBreaks(); scheduleScan(); });
  try {
    const draft = JSON.parse(localStorage.getItem('luxalgo-web:script') || 'null');
    if (draft && typeof draft === 'object') {
      if (typeof draft.src === 'string') srcBox.value = draft.src;
      if (typeof draft.name === 'string' && draft.name.trim()) nameBox.value = draft.name;
      if (draft.inputs && typeof draft.inputs === 'object') {
        for (const k of Object.keys(draft.inputs)) {
          const v = draft.inputs[k];
          if (['string', 'number', 'boolean'].includes(typeof v)) inputStore[k] = v;
        }
        storeFor = typeof draft.inputsFor === 'string' ? draft.inputsFor : '';
      }
    }
  } catch { /* private mode */ }
  paintGutter();
  checkBreaks();
  if (srcBox.value.trim()) scheduleScan(400);
  let draftTimer;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem('luxalgo-web:script', JSON.stringify({ src: srcBox.value, name: nameBox.value, inputs: inputStore, inputsFor: storeFor }));
      } catch { /* private mode */ }
    }, 400);
  }
  srcBox.addEventListener('input', saveDraft);
  nameBox.addEventListener('input', saveDraft);
  $('#script-close').addEventListener('click', () => setPanel('script', false));
  /* Escape: see escapeKeydown — the one handler. The draft is saved as you type (saveDraft), so hiding
     the pane with Escape from inside the editor loses nothing. */
  window.closeScriptLayerIfOpen = () => { if (!settingsOpen) return false; setSettingsOpen(false); return true; };

  /* ── Run ─────────────────────────────────────────────────────────────────────────────────────── */
  let running = false, runQueued = false;
  const doRun = async () => {
    if (running) { runQueued = true; return; }          // a change made mid-run is applied once, after it
    running = true;
    const source = srcBox.value;
    const label = nameBox.value.trim() || 'Untitled script';
    runBtn.disabled = true;
    clearError();
    setStatus('busy', `Running “${label}”…`);
    try {
      await chartReady;
      /* The engine's input ids are positions, so a Run straight after an edit waits for the scan that
         re-reads them (only when there are values to translate). */
      if (Object.keys(inputStore).length && scanDirty) await scan();
      const overrides = ST.overridesFor(inputsMeta, inputStore);
      const changed = ST.changedNote(Object.keys(overrides).length);
      const r = await window.TraderRun.run(source, label, { inputs: overrides });
      if (!r.ok) {
        lastRunSource = null;
        const err = r.error || null;
        const loc = ST.locateError(source, err || r.reason);
        const msg = ST.cleanMessage((err && err.message) || r.reason);
        const where = loc ? (loc.approx ? `likely line ${loc.line}` : `line ${loc.line}${loc.col ? ', col ' + loc.col : ''}`) : '';
        const what = err && err.code === 'SYNTAX_ERROR' ? 'Syntax error' : '';
        if (loc) showErrorAt(loc.line);
        setStatus('fail', 'Failed · ' + [where, msg].filter(Boolean).join(' · '));
        addRun({ ok: false, label, line: loc ? loc.line : 0,
                 facts: [what, where && where.charAt(0).toUpperCase() + where.slice(1), msg].filter(Boolean).join(' · '),
                 detail: [r.reason !== msg ? String(r.reason) : '', err && err.hint ? String(err.hint) : ''].filter(Boolean).join('\n\n') });
        toast('Pine: ' + r.reason, true);
      } else {
        lastRunSource = source;
        log(`“${label}” ran in ${r.ms} ms`);
        /* F3 (25 Sep): say where the paint went, and point at it — the operator's recording showed
           a run finishing with nothing visibly changing, because the chart behind the pane was
           blank. A pulse on the chart closes that loop. */
        const n = Array.isArray(r.series) ? r.series.length : (r.series || 0);
        toast(`“${label}” ran in ${r.ms} ms · ${n} series · the paint is on the chart`);
        noteActivity(`ran “${label}” · ${n} series · ${r.ms} ms`, 'chart_apply_pine');
        const drew = drewWords(r.drew);
        const facts = `${n} series${drew ? ' · ' + drew : ''} · ${r.bars} bars · ${r.ms} ms${changed ? ' · ' + changed : ''}`;
        const notes = Array.isArray(r.warnings) ? r.warnings.map(String) : [];
        setStatus(notes.length ? 'warn' : 'ok', `Ran · ${facts}${notes.length ? ' · ⚠ ' + notes.length : ''}`);
        addRun({ ok: true, label, facts, notes, detail: window.TraderRun.summarize(r) });
        nudgeChart();
        flashChart();
      }
    } catch (err) {
      lastRunSource = null;
      setStatus('fail', 'Failed · ' + err.message);
      addRun({ ok: false, label, facts: String(err.message) });
      toast('Run failed: ' + err.message, true);
    } finally {
      running = false;
      runBtn.disabled = false;
      if (runQueued) { runQueued = false; doRun(); }
    }
  };
  runBtn.addEventListener('click', () => doRun());
  /* Ctrl/Cmd+Enter runs from anywhere in the pane: the editor, the name, a Settings control. */
  if (paneEl) {
    paneEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey) {
        ev.preventDefault();
        if (!runBtn.disabled) runBtn.click();
      }
    });
    runBtn.title = 'Run this script on the chart (' + (/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+') + 'Enter)';
  }

  // Theme: one button, two systems (our palette + the chart's own theme)
  $('#theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });
  document.documentElement.dataset.theme = currentTheme();

  /* Full screen (27 Sep). See the CSS header: our chrome goes so the chart owns this page, and the
     page asks for real fullscreen so it can take the whole display. Both are idempotent — the door
     may call this as often as it likes. */
  if (el.focusExit) {
    el.focusExit.addEventListener('click', () => setChartFullscreen(false));
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && isChartFullscreen()) setChartFullscreen(false);
  });
  /* Esc in NATIVE fullscreen exits it without reaching the keydown above. The browser's own event is
     then the only thing that knows, and the operator's Esc means "out of full screen" — so the page
     half goes down with it. (Guarded by `nativeFullscreenWasOn`: a refused `requestFullscreen()`
     never fires this, and the page-only mode must survive that.) */
  document.addEventListener('fullscreenchange', () => {
    const native = Boolean(document.fullscreenElement);
    if (nativeFullscreenWasOn && !native && document.body.classList.contains('chart-focus')) {
      nativeFullscreenWasOn = native;
      setChartFullscreen(false);
      return;
    }
    nativeFullscreenWasOn = native;
    paintChartFocus(isChartFullscreen());
  });

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
  /* Bring back the script that was on the chart last session (Vela restores its own natives). */
  if (window.TraderRun && typeof window.TraderRun.restore === 'function') {
    window.TraderRun.restore().then((r) => {
      if (r && r.ok) noteActivity('restored from last session · ' + window.TraderRun.summarize(r), 'restore');
    }).catch((err) => console.warn('[restore]', err));
  }


  // Exposed for scripted checks (browser automation, console experiments).
  window.__app = {
    get chart() { return chart; }, mountIndicator, queueMount, api,
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
