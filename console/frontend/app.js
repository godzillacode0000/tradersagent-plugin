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

function setPanel(name, on) {
  const btn = name === 'library' ? el.libraryOpen : el.detailOpen;
  el.main.dataset[name] = on ? 'on' : 'off';
  if (btn) btn.setAttribute('aria-pressed', String(Boolean(on)));
  try { localStorage.setItem(PANELS_KEY, JSON.stringify({ ...readPanelPrefs(), [name]: Boolean(on) })); } catch { /* private mode */ }
}

function togglePanel(name) {
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

/* ------------------------------------------------------------------ helpers */
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
   at that width the row has almost no slack left. So at narrow widths the pill shows its short form
   and the detail moves into the tooltip; wide windows keep the full sentence. Everything the pill
   knows is still in `title`, so nothing is actually lost. */
function setBars(text, detail) {
  const full = detail ? text + ' · ' + detail : text;
  const narrow = typeof window !== 'undefined' && window.innerWidth <= 780;
  el.bars.textContent = narrow && detail ? text : full;
  el.bars.title = full;
}

async function bootChart() {
  const host = $('#chart');
  el.bars.textContent = 'bars: loading…';
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
        unblockPineEngine();
        markChartReady(); exposeChart();
        /* The chart's stored palette is not the console's (Vela restores whatever it last saved, and
           a theme string does not rewrite explicit colours), so the console's palette is asserted
           here and once more a beat later, after Vela's own restore has run. Switching the console
           to light restores the chart's original palette from the parked copy. */
        syncChartPalette(currentTheme());
        setTimeout(() => syncChartPalette(currentTheme()), 1500);
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
  el.bars.textContent = 'bars: offline synthetic';
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
 * The bars PineTS runs over. Vela does not document one public bars getter across
 * builds, so try each accessor that exists and fall back to the venue's own public
 * endpoint — the same market the chart is showing, so the series line up by time.
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
    const b = pick(typeof d?.bars === 'function' ? d.bars() : d?.bars);
    if (b) return b;
  } catch {}
  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=500');
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
  const n = names.length;
  el.count.textContent = n + (n === 1 ? ' indicator' : ' indicators');
  el.count.title = n
    ? 'On the chart now, per Vela’s own inspect(): ' + names.join(' · ')
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

/* ---------------------------------------------------------------- library UI */
function skeletons(n = 4) {
  el.results.innerHTML = Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
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
    button.innerHTML = `
      <div class="row__top">
        <span class="row__name">${esc(row.name || row.slug)}</span>
        <span class="row__kind row__kind--${esc(row.kind)}">${esc(row.kind)}</span>
      </div>
      ${row.description ? `<div class="row__desc">${esc(row.description)}</div>` : ''}
      <div class="row__meta">${esc(row.family || '')}${row.family ? ' · ' : ''}${esc(row.slug)}</div>`;
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
  } catch (err) {
    el.results.innerHTML = `<div class="empty"><p>Search failed.</p><p class="muted">${esc(err.message)}</p>
      <p class="muted">Is the backend running? <code>…/venv/bin/python backend/mvp_server.py</code></p></div>`;
    toast('Search failed: ' + err.message, true);
  }
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
        <h2 class="detail__title">${esc(data.name || row.slug)}</h2>
        <div class="detail__meta">
          <span class="badge badge--ok">source: public</span>
          <span class="badge">${source.length.toLocaleString()} chars</span>
          ${lic ? `<span class="badge badge--lic">${esc(lic)}</span>` : '<span class="badge badge--lic">no licence header</span>'}
          <a class="badge" href="${esc(row.url || '#')}" target="_blank" rel="noreferrer">Library page</a>
        </div>
        <div class="detail__actions">
          <button class="btn btn--primary" id="run-pinets">Run PineTS</button>
          <button class="btn btn--ghost" id="mount">Add to chart</button>
          <button class="btn btn--ghost" id="copy">Copy Pine</button>
        </div>
        <div class="muted" id="pine-headline">PineTS executes the script over this chart's bars and
        paints the result as native series; “Add to chart” additionally asks Vela's own Pine engine,
        which stays silent on many scripts in this build.</div>
        <pre>${esc(source.slice(0, 12000))}${source.length > 12000 ? '\n… truncated in preview …' : ''}</pre>`;
      $('#mount').addEventListener('click', async () => {
        const label = data.name || row.slug;
        toast(`Mounting “${label}”… waiting for the engine`);
        try {
          await queueMount(source, label);
          toast(`“${label}” is running on the chart`);
        } catch (err) { toast('Not mounted: ' + err.message, true); }
      });
      $('#run-pinets').addEventListener('click', async () => {
        const label = data.name || row.slug;
        const headline = $('#pine-headline');
        headline.textContent = `Running “${label}” through PineTS… (loading the runtime on first use)`;
        try {
          await chartReady;
          const bars = await chartBars();
          const res = await window.PineTSRunner.run(source, bars, { name: label });
          if (!res.ok) {
            headline.textContent = res.reason;
            toast('PineTS: ' + res.reason, true);
            return;
          }
          const paint = await window.PineTSPaint.paintNative(source);
          const names = res.series.slice(0, 3).map((s) => s.name).join(', ');
          const seriesText = res.series.length
            ? `${res.series.length} series computed (${names}${res.series.length > 3 ? ', …' : ''})`
            : 'ran, but this script plots nothing';
          const strat = res.strategy
            ? ` · strategy: net ${res.strategy.netprofit} over ${res.strategy.closedtrades} closed trades`
            : '';
          const drawn = paint.added
            ? ` · drawn with Vela native “${paint.added.title}”${paint.added.length ? `(${paint.added.length})` : ''} · chart series: ${paint.series}`
            : ` · not drawn: ${paint.reason}`;
          headline.textContent = `ran in ${res.ms} ms over ${bars.length} bars · ${seriesText}${strat}${drawn}`;
          log(`PineTS ran “${label}” in ${res.ms} ms${paint.added ? ` — Vela native “${paint.added.title}” on the chart` : ' — nothing drawn (' + paint.reason + ')'}`);
          toast(`PineTS: “${label}” ran in ${res.ms} ms`);
        } catch (err) {
          headline.textContent = 'PineTS failed: ' + err.message;
          toast('PineTS failed: ' + err.message, true);
        }
      });
      $('#copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(source); toast('Pine source copied'); }
        catch { toast('Clipboard blocked by the browser', true); }
      });
      return;
    }

    const data = await api('/api/concept', { slug: row.slug });
    const body = data.body_markdown || data.raw || 'No write-up returned.';
    el.detail.innerHTML = `
      <h2 class="detail__title">${esc(data.name || row.slug)}</h2>
      <div class="detail__meta">
        <span class="badge">concept</span>
        <span class="badge">${esc(data.family || row.family || '')}</span>
        <a class="badge" href="${esc(row.url || '#')}" target="_blank" rel="noreferrer">Library page</a>
      </div>
      <div class="detail__text">${esc(body.slice(0, 14000))}</div>`;
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
    el.mcp.textContent = ready ? `MCP: ${label}` : 'MCP: offline';
    el.mcp.className = 'pill ' + (ready ? 'pill--ok' : 'pill--bad');
    el.mcp.title = ready
      ? (data.mcp_url || (data.mcp && data.mcp.url) || 'connected')
      : ((data.mcp_error || (data.mcp && data.mcp.last_error)) || 'not connected');
    if (!ready) toast('LuxAlgo MCP is not connected — see backend log', true);
  } catch (err) {
    el.mcp.textContent = 'MCP: no backend';
    el.mcp.className = 'pill pill--bad';
    el.mcp.title = err.message;
    toast('Backend unreachable — start backend/mvp_server.py first', true);
  }
}

async function main() {
  /* Chart-first: the LIBRARY starts where he left it. The DETAIL panel deliberately never restores
     open: nothing is selected at load time, so it would paint an empty "Nothing selected" column
     over the chart — the operator's complaint of 17 Sep. It opens when a result is picked, or from
     the toggle if he asks for it. (setPanel persists, so a stale `detail: true` is cleaned up here.) */
  const panelPrefs = readPanelPrefs();
  setPanel('library', panelPrefs.library === true);
  setPanel('detail', false);
  el.libraryOpen.addEventListener('click', () => togglePanel('library'));
  el.detailOpen.addEventListener('click', () => togglePanel('detail'));

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

  await checkHealth();
  try { await bootChart(); }
  catch (err) { console.error(err); log('Chart failed to boot: ' + err.message); toast('Chart failed: ' + err.message, true); }

  if (new URLSearchParams(location.search).get('q')) {
    el.q.value = new URLSearchParams(location.search).get('q');
    runSearch();
  }

  // Exposed for scripted checks (browser automation, console experiments).
  window.__app = {
    get chart() { return chart; }, mountIndicator, queueMount, runSearch, api,
    showView,
    get mounted() { return mounted.slice(); },
    get pineReady() { return pineReady; },
  };
  // Silent: this is the app's own self-report, kept in the DOM for scripts — not a line to park
  // under the chart (operator's call, 16 Sep).
  log('Ready. Vela: ' + (chart ? 'mounted' : 'failed') + ' · Pine engine: ' + (pineReady ? 'registered (execution verified per mount)' : 'missing'), true);
}

window.addEventListener('DOMContentLoaded', main);
