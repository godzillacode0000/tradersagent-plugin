/* Edge Stats — the sheet (4 Oct).

   "How often did this setup actually work?" — answered by LuxAlgo's open-source engine
   (github.com/LuxAlgo/edge-stats, MIT) running on THIS machine over bars you downloaded yourself. Every
   result carries its sample size and a Wilson 95% interval; below the engine's floors the estimate is
   withheld and this sheet shows the counts instead — there is no code path here that prints a percentage
   without its N. The numbers are the engine's, never computed in this file.

   The sheet slides over the chart from the right (transform + opacity only: the box is a 2016 laptop), so
   opening it never resizes Vela. Views, one at a time:

     home     ask a question (the engine's query language, with suggestions) or pick a report
     result   the answer: estimate + interval, do the halves agree, recent vs all, per year, the
              distribution, the groups, and the sessions behind it
     session  one matched session's bars on a small Vela chart, with the levels the engine derived
     data     where the bars come from — install state, download (free sources first), the job

   Source of truth is the server (/api/edgestats/*). A machine without Node, or without data yet, is a
   normal first-run state with its own card — never an error. The session view is adapted from edge-stats'
   own dashboard (MIT, packages/web/src/components/session-view.tsx) onto the plugin's vendored Vela. */
(function () {
  'use strict';

  const API = '/api/edgestats';
  const KEY_SYMBOL = 'luxalgo-web:edge-symbol';
  const KEY_DETAIL = 'luxalgo-web:edge-detail';
  const FALLBACK_QUESTION = 'gapFill WHERE dayOfWeek = Tue';

  const $ = (id) => document.getElementById(id);
  const sheet = $('edge-sheet');
  const scrim = $('edge-scrim');
  const bar = $('edge-bar');
  const body = $('edge-body');
  const headSub = $('edge-sub');
  const dataBtn = $('edge-data');
  if (!sheet || !body || !bar) return;

  /* ── small helpers ─────────────────────────────────────────────────────────────────────────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 0) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const pctNum = (v, d = 1) => (v * 100).toFixed(d);
  const pct = (v, d = 1) => (isNum(v) ? pctNum(v, d) + '%' : '–');
  const say = (message, bad) => { if (typeof window.taToast === 'function') window.taToast(message, bad); };
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many || one + 's')}`;
  const readStore = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const writeStore = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB',
      { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function fmtMinutes(v) {
    const m = Math.round(v);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  function fmtValue(v, unit) {
    if (!isNum(v)) return '';
    if (unit === 'minutes') return fmtMinutes(v);
    if (unit === '%') return v.toFixed(2) + '%';
    if (unit === 'r') return v.toFixed(2) + ' R';
    return String(+v.toFixed(3));
  }
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const BUCKETS = ['xs', 's', 'm', 'l', 'xl'];
  function groupSort(a, b) {
    const x = String(a.group), y = String(b.group);
    const order = (list) => (list.includes(x) && list.includes(y) ? list.indexOf(x) - list.indexOf(y) : null);
    for (const list of [WEEKDAYS, BUCKETS, ['false', 'true']]) { const o = order(list); if (o !== null) return o; }
    if (x === 'NULL') return 1;
    if (y === 'NULL') return -1;
    if (/^-?\d+$/.test(x) && /^-?\d+$/.test(y)) return +x - +y;
    return x.localeCompare(y);
  }

  const ICON = {
    back: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>',
    go: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg>',
    down: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 5 5 5-5"/></svg>',
    db: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="8" cy="3.8" rx="5" ry="2"/><path d="M3 3.8v8.4c0 1.1 2.2 2 5 2s5-.9 5-2V3.8"/><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/></svg>',
    warn: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2 1.5 13.5h13L8 2Z"/><path d="M8 6.5v3.2"/><circle cx="8" cy="11.6" r=".4" fill="currentColor"/></svg>',
    info: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6"/><circle cx="8" cy="5.2" r=".4" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>',
    edit: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="m11 2.5 2.5 2.5L5.5 13H3v-2.5L11 2.5Z"/></svg>',
    copy: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  };

  /* ── talking to the console ────────────────────────────────────────────────────────────────── */
  /* The page lives in an iframe where the SameSite cookie is dropped, so POSTs carry the token from
     /api/session as a header — the same bootstrap broker.js and replay.js use. */
  let TOKEN = null;
  async function token() {
    if (TOKEN) return TOKEN;
    try {
      const res = await fetch('/api/session', { cache: 'no-store' });
      const p = await res.json();
      TOKEN = (p && p.data && p.data.token) || null;
    } catch (err) { TOKEN = null; }
    return TOKEN || '';
  }

  class EdgeFail extends Error {
    constructor(message, code, hint, detail) { super(message); this.code = code || ''; this.hint = hint || ''; this.detail = detail || null; }
  }

  async function call(path, bodyObj, signal) {
    const init = { cache: 'no-store', signal };
    if (bodyObj !== undefined) {
      const headers = { 'content-type': 'application/json' };
      const t = await token();
      if (t) headers['X-Trader-Token'] = t;
      Object.assign(init, { method: 'POST', headers, body: JSON.stringify(bodyObj) });
    }
    let res;
    try { res = await fetch(API + path, init); }
    catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new EdgeFail('the console did not answer', 'console_down', 'Is the Trader’s Agent console still running?');
    }
    const payload = await res.json().catch(() => ({ ok: false, error: `bad JSON (HTTP ${res.status})` }));
    if (!payload.ok) {
      const d = payload.detail || {};
      throw new EdgeFail(payload.error || `HTTP ${res.status}`, payload.code, d.hint, d.detail);
    }
    return payload.data;
  }

  /* ── state ─────────────────────────────────────────────────────────────────────────────────── */
  const S = {
    open: false, view: 'home', back: [],
    ov: null, ovLoading: false, ovError: null,
    symbol: readStore(KEY_SYMBOL),
    cat: 'all', q: '',
    ask: '', askErr: null, askBusy: false,
    registry: null, regLoading: false,
    result: null, abort: null,
    refine: false, filters: { since: '', until: '', groupBy: '', params: {} },
    /* Summary is the default: the rate, whether it holds up, the breakdown, the days behind it. Detailed adds
       the evidence (halves, recent, years, timing) — a choice the trader makes once and keeps. */
    detail: readStore(KEY_DETAIL) === 'detailed' ? 'detailed' : 'summary',
    sess: { id: '', data: null, loading: false, error: null }, sessShown: 10, sessAll: false,
    setup: { src: '', bSymbol: 'BTCUSDT', bYears: 3, archive: false, dSymbol: 'XAUUSD', dYears: 1 },
    job: null, logOpen: false, poll: null,
    sugg: { items: [], index: -1 },
    lastFocus: null,
  };

  const symbols = () => (S.ov && S.ov.symbols) || [];
  const presets = () => (S.ov && S.ov.presets) || [];
  function currentSymbol() {
    const known = symbols().map((s) => s.symbol);
    if (known.includes(S.symbol)) return S.symbol;
    return known[0] || '';
  }
  /* A finished job is news for ten minutes, then clutter: the Data view must not show last week's
     "Updating the data ✓ done" every time it opens. Running ones always show. */
  const RECENT_S = 600;
  const jobShown = () => (S.job && (S.job.status === 'running' || S.job.status === 'cancelling'
    || !S.job.finished || (Date.now() / 1000 - S.job.finished) < RECENT_S) ? S.job : null);
  const jobRunning = () => !!(S.job && (S.job.status === 'running' || S.job.status === 'cancelling'));

  /* ── overview: what is installed, what is stored, what can be asked ────────────────────────── */
  let ovPromise = null;
  function loadOverview(opts) {
    if (!ovPromise) ovPromise = fetchOverview(opts).finally(() => { ovPromise = null; });
    return ovPromise;
  }
  async function fetchOverview(opts) {
    const soft = opts && opts.soft;
    S.ovLoading = true;
    if (!soft) { S.ovError = null; render(); }
    try {
      S.ov = await call('/overview');
      S.ovError = null;
      S.job = S.ov.job || null;
      if (!currentSymbol()) S.symbol = '';
      else S.symbol = currentSymbol();
      if (S.ov.ready && !S.registry) loadRegistry();
    } catch (err) {
      if (err.name === 'AbortError') return S.ov;
      S.ovError = err;
    } finally {
      S.ovLoading = false;
    }
    syncPolling();
    render();
    return S.ov;
  }

  async function loadRegistry() {
    if (S.registry || S.regLoading) return;
    S.regLoading = true;
    try {
      const data = await call('/registry');
      S.registry = data.entries || [];
      if (S.view === 'home') render({ keepFocus: true });
    } catch (err) { S.registry = null; }
    finally { S.regLoading = false; }
  }

  /* ── running a question ────────────────────────────────────────────────────────────────────── */
  function baseRequest() {
    const f = S.filters;
    const req = { symbol: currentSymbol(), sessionsLimit: 25 };
    if (f.since) req.since = f.since;
    if (f.until) req.until = f.until;
    if (f.groupBy) req.groupBy = f.groupBy;
    return req;
  }

  async function execute(kind, payload, meta) {
    if (S.abort) S.abort.abort();
    const ctl = new AbortController();
    S.abort = ctl;
    const before = { view: S.view, back: S.back.slice(), result: S.result };
    S.result = { kind, req: payload, loading: true, error: null, data: null, ...meta };
    setView('result');
    try {
      const data = await call(kind === 'query' ? '/query' : '/preset', payload, ctl.signal);
      if (S.abort !== ctl) return null;
      S.result.data = data;
      S.result.loading = false;
      S.sessShown = 10; S.sessAll = false;
      render();
      return data;
    } catch (err) {
      if (err.name === 'AbortError' || S.abort !== ctl) return null;
      if (kind === 'query') {                       // a mistyped question belongs in the ask box, not a result page
        S.result = before.result; S.view = before.view; S.back = before.back;
        throw err;
      }
      S.result.loading = false;
      S.result.error = err;
      render();
      throw err;
    }
  }

  async function runQuery(dsl, opts) {
    const text = String(dsl || '').trim();
    if (!text) { S.askErr = new EdgeFail('Write a question first — for example: ' + FALLBACK_QUESTION, 'bad_request'); render({ keepFocus: true }); return null; }
    if (!(opts && opts.keepFilters)) { S.filters = { since: '', until: '', groupBy: '', params: {} }; S.refine = false; }
    const payload = { dsl: text, ...baseRequest() };
    S.ask = text; S.askErr = null; S.askBusy = true;
    updateAskBusy();
    try {
      return await execute('query', payload, { title: 'Your question', preset: null });
    } catch (err) {
      S.askErr = err;
      S.askBusy = false;
      render({ keepFocus: true });
      return null;
    } finally { S.askBusy = false; updateAskBusy(); }
  }

  async function runPreset(preset, opts) {
    const p = typeof preset === 'string' ? presets().find((x) => x.id === preset) : preset;
    if (!p) throw new EdgeFail(`There is no report called '${preset}'`, 'bad_request');
    if (!(opts && opts.keepFilters)) { S.filters = { since: '', until: '', groupBy: '', params: (opts && opts.params) || {} }; S.refine = false; }
    else if (opts && opts.params) S.filters.params = opts.params;
    const payload = { presetId: p.id, ...baseRequest() };
    const params = cleanParams(p, S.filters.params);
    if (Object.keys(params).length) payload.params = params;
    try {
      return await execute('preset', payload, { title: p.title, preset: p });
    } catch (err) { return null; }
  }

  function cleanParams(p, raw) {
    const out = {};
    for (const spec of p.params || []) {
      let v = raw && raw[spec.name];
      if (v === undefined || v === '' || v === null) continue;
      if (spec.type === 'number' || spec.type === 'duration') {
        v = Number(v);
        if (!Number.isFinite(v)) continue;
      }
      out[spec.name] = v;
    }
    return out;
  }

  function rerunWithFilters() {
    const r = S.result;
    if (!r) return;
    if (r.kind === 'query') runQuery(r.req.dsl, { keepFilters: true });
    else runPreset(r.preset, { keepFilters: true });
  }

  /* ── sessions ──────────────────────────────────────────────────────────────────────────────── */
  async function openSession(id) {
    S.sess = { id, data: null, loading: true, error: null };
    setView('session');
    try {
      const data = await call('/session?id=' + encodeURIComponent(id) + '&context=30');
      if (S.sess.id !== id) return null;
      S.sess = { id, data, loading: false, error: null };
    } catch (err) {
      if (S.sess.id !== id) return null;
      S.sess = { id, data: null, loading: false, error: err };
    }
    render();
    return S.sess.data;
  }

  /* ── views & navigation ────────────────────────────────────────────────────────────────────── */
  function setView(view) {
    if (view === S.view) { render(); return; }
    if (view === 'home') S.back = [];
    else if (S.view !== 'home' || view === 'result' || view === 'data') {
      if (S.back[S.back.length - 1] !== S.view) S.back.push(S.view);
    }
    S.view = view;
    render();
    body.scrollTop = 0;
  }
  function goBack() {
    destroyChart();
    const prev = S.back.pop() || 'home';
    S.view = prev;
    render();
    body.scrollTop = 0;
  }

  function open(view) {
    if (!S.open) {
      S.open = true;
      S.lastFocus = document.activeElement;
      sheet.classList.add('is-open');
      scrim.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
      scrim.setAttribute('aria-hidden', 'true');
      if (window.taModal) window.taModal.enter(sheet);
    }
    if (view && view !== S.view) { if (view === 'home') S.back = []; S.view = view; }
    render();
    loadOverview({ soft: !!S.ov });
    setTimeout(() => {
      const t = body.querySelector('#edge-ask');
      if (t && S.view === 'home') t.focus({ preventScroll: true });
    }, 200);
    return true;
  }

  function close() {
    if (!S.open) return false;
    S.open = false;
    sheet.classList.remove('is-open');
    scrim.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    if (window.taModal) window.taModal.leave(sheet);
    destroyChart();
    stopPolling();
    const back = S.lastFocus;
    S.lastFocus = null;
    if (sheet.contains(document.activeElement) && back && back.focus) back.focus({ preventScroll: true });
    return true;
  }

  /* ── rendering ─────────────────────────────────────────────────────────────────────────────── */
  /* Home with nothing to ask (no data yet, or a download running) IS the data view. */
  function normaliseView() {
    if (S.view === 'home' && S.ov && !S.ov.ready && (S.ov.reason === 'edge_no_data' || S.ov.reason === 'edge_busy')) S.view = 'data';
  }
  const atRoot = () => S.view === 'home' || (S.view === 'data' && !(S.ov && S.ov.ready));

  function render(opts) {
    if (!S.open && !(opts && opts.force)) return;
    normaliseView();
    const keep = opts && opts.keepFocus ? captureFocus() : null;
    renderBar();
    destroyChartIfLeaving();
    let html;
    switch (S.view) {
      case 'result': html = renderResult(); break;
      case 'session': html = renderSession(); break;
      case 'data': html = renderData(); break;
      default: html = renderHome();
    }
    /* Cards rise in once per view (and once more when an answer replaces its skeleton); a background
       refresh of the same view must not replay them. */
    const key = S.view + (S.view === 'result' && S.result && S.result.loading ? ':loading' : '');
    const changed = body.dataset.view !== key;
    body.classList.toggle('is-still', !changed);
    body.dataset.view = key;
    body.innerHTML = html;
    if (keep) restoreFocus(keep);
    /* A new view replaces the node that had focus; keep it inside the sheet so Tab and the arrow keys
       carry on from here instead of from the top of the page. */
    else if (changed && (!document.activeElement || document.activeElement === document.body || !sheet.contains(document.activeElement))) {
      body.setAttribute('tabindex', '-1');
      body.focus({ preventScroll: true });
    }
    afterRender();
  }

  function focusSelector(a) {
    if (a.id) return '#' + a.id;
    for (const attr of ['data-cat', 'data-bsym']) if (a.hasAttribute(attr)) return `[${attr}="${CSS.escape(a.getAttribute(attr))}"]`;
    return '';
  }
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !body.contains(a)) return null;
    const sel = focusSelector(a);
    return sel ? { sel, start: a.selectionStart, end: a.selectionEnd } : null;
  }
  function restoreFocus(k) {
    const n = body.querySelector(k.sel);
    if (!n) return;
    n.focus({ preventScroll: true });
    try { if (k.start != null) n.setSelectionRange(k.start, k.end); } catch (e) { /* not a text field */ }
  }

  function detailSwitch() {
    const on = (v) => (S.detail === v ? 'true' : 'false');
    return `<div class="e-seg" role="group" aria-label="How much detail"><button type="button" data-detail="summary" aria-pressed="${on('summary')}">Summary</button><button type="button" data-detail="detailed" aria-pressed="${on('detailed')}">Detailed</button></div>`;
  }

  function renderBar() {
    const online = S.ov && S.ov.ready;
    let sub = '';
    let html = '';
    if (S.view === 'home') {
      sub = online ? 'How often did it actually happen?' : 'Conditional frequencies, on your own data';
      if (online && symbols().length) {
        const cur = currentSymbol();
        const row = symbols().find((s) => s.symbol === cur) || {};
        html = `<select class="edge__sym" id="edge-symbol" aria-label="Symbol">${symbols().map((s) =>
          `<option value="${esc(s.symbol)}"${s.symbol === cur ? ' selected' : ''}>${esc(s.symbol)}</option>`).join('')}</select>
          <span class="edge__fresh">${row.lastBar ? 'data to ' + esc(fmtDate(row.lastBar)) : esc(row.adapter || '')}</span>`;
      }
    } else {
      const label = S.view === 'session' ? 'Results' : (S.view === 'result' ? 'Reports' : 'Back');
      html = atRoot() ? '' : `<button type="button" class="edge__back" data-act="back">${ICON.back}${label}</button>`;
      if (html) {
        if (S.view === 'result') {
          html += `<span class="edge__fresh">${esc(currentSymbol())}${S.result && S.result.data && S.result.data.query ? ' · ' + esc(S.result.data.query.sessionKey) + ' session' : ''}</span>`;
          if (S.result && S.result.data && !S.result.error) html += detailSwitch();
        }
        if (S.view === 'session') html += `<span class="edge__fresh">${esc(currentSymbol())}</span>`;
        if (S.view === 'data') html += `<span class="edge__fresh">Where the bars come from</span>`;
      }
      sub = S.view === 'data' ? 'Data' : S.view === 'session' ? 'One day, with its levels' : 'The answer';
    }
    bar.innerHTML = html;
    bar.hidden = !html;
    if (headSub) headSub.textContent = sub;
    if (dataBtn) dataBtn.classList.toggle('is-on', S.view === 'data');
  }

  /* — blocked states: a first run is a card, not an error — */
  function copyCmd(cmd) {
    return `<div class="edge-cmd"><code>${esc(cmd)}</code><button type="button" class="edge-btn edge-btn--ghost edge-btn--sm" data-copy="${esc(cmd)}" aria-label="Copy the command">${ICON.copy}Copy</button></div>`;
  }

  function renderNotInstalled() {
    const ov = S.ov;
    const prob = ov.install && ov.install.problem;
    const title = prob === 'no_node' ? 'Edge Stats needs Node.js'
      : prob === 'old_node' ? 'Your Node.js is too old'
        : 'Edge Stats isn’t installed yet';
    const fix = (ov.install && ov.install.fix) || ov.hint || '';
    return `<section class="edge-card edge-hero" style="--i:0">
      <p class="edge-cap">LuxAlgo · open source</p>
      <h2>${esc(title)}</h2>
      <p class="edge-note">Edge Stats answers “how often did this actually happen?” — gap fills, opening-range breaks, weekday effects — with the <b>sample size and a 95% confidence interval on every number</b>. It runs entirely on this machine, on bars you download yourself. It installs once (about 300 MB) and needs Node.js 20 or newer.</p>
      ${prob === 'not_installed' || !prob ? copyCmd('./install.sh --with-edge') : ''}
      <p class="edge-note">${prob === 'not_installed' || !prob ? 'Run it once from the plugin folder (it needs the network), then press <b>Check again</b>.' : esc(fix) + ' Then press <b>Check again</b>.'}</p>
      <button type="button" class="edge-btn" data-act="recheck">Check again</button>
    </section>
    <p class="edge-foot">Engine: <b>LuxAlgo/edge-stats</b> (MIT). Nothing is sent anywhere; the store lives in your home folder.</p>`;
  }

  function renderBroken(err) {
    const e = err || {};
    const log = e.detail && e.detail.log;
    return `<section class="edge-card edge-hero" style="--i:0">
      <p class="edge-cap">Edge Stats</p>
      <h2>${esc(e.message || (S.ov && S.ov.error) || 'Edge Stats did not start')}</h2>
      <p class="edge-note">${esc(e.hint || (S.ov && S.ov.hint) || 'Try again in a moment.')}</p>
      ${log ? `<pre class="edge-log">${esc(log)}</pre>` : ''}
      <button type="button" class="edge-btn" data-act="recheck">Try again</button>
    </section>`;
  }

  function skeletonHome() {
    return `<section class="edge-card"><div class="edge-skel" style="width:40%"></div><div class="edge-skel" style="height:38px"></div></section>
      <section class="edge-card"><div class="edge-skel" style="width:30%"></div>${'<div class="edge-skel" style="height:34px"></div>'.repeat(4)}</section>`;
  }

  /* — home — */
  function exampleChips() {
    const out = [];
    const reg = (S.registry || []).filter((e) => e.kind === 'outcome');
    for (const e of reg) {
      const ex = (e.examples || []).find((x) => / WHERE /.test(x)) || (e.examples || [])[0];
      if (ex && !out.includes(ex)) out.push(ex);
      if (out.length >= 6) break;
    }
    /* two short ones: this is a hint that the language exists, not a menu */
    return (out.length ? out : [FALLBACK_QUESTION]).sort((a, b) => a.length - b.length).slice(0, 2);
  }

  /* What a trader asks first — plain questions over the engine's own reports (the engine's long
     descriptions stay on the report itself). An id the engine does not have is simply skipped. */
  const START_HERE = [
    ['gap-fill', 'Does price come back to yesterday\u2019s close?'],
    ['orb', 'Does the opening range break \u2014 and which way?'],
    ['day-of-week', 'Which weekdays close green most often?'],
    ['high-time', 'When does the day\u2019s high usually form?'],
    ['inside-day', 'What happens the day after an inside day?'],
    ['month-of-year', 'Which months are strongest?'],
  ];

  function categories() {
    const map = new Map();
    for (const p of presets()) map.set(p.category, (map.get(p.category) || 0) + 1);
    return [...map.entries()].sort((a, b) => catRank(a[0]) - catRank(b[0]) || a[0].localeCompare(b[0]));
  }
  const CAT_NAMES = { fvg: 'FVG', 'opening-range': 'Opening range', 'initial-balance': 'Initial balance', 'time-of-day': 'Time of day', 'session-shape': 'Session shape' };
  const catLabel = (c) => CAT_NAMES[c] || c.replace(/-/g, ' ').replace(/^./, (m) => m.toUpperCase());
  /* The catalogue is alphabetical; a trader's first question is a gap or an opening range, so those lead. */
  const CAT_ORDER = ['gaps', 'opening-range', 'levels', 'time-of-day', 'initial-balance', 'session-shape', 'seasonality', 'streaks', 'volatility', 'fvg', 'events'];
  const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };

  function filteredPresets() {
    const q = S.q.trim().toLowerCase();
    return presets().filter((p) => (S.cat === 'all' || p.category === S.cat)
      && (!q || (p.title + ' ' + p.summary + ' ' + p.category + ' ' + p.id).toLowerCase().includes(q)))
      .map((p, i) => ({ p, i })).sort((a, b) => catRank(a.p.category) - catRank(b.p.category) || a.i - b.i).map((x) => x.p);
  }

  function askErrorHtml(err, dsl) {
    if (!err) return '';
    const pos = err.detail && Number.isInteger(err.detail.position) ? err.detail.position : null;
    const len = err.detail && Number.isInteger(err.detail.length) ? Math.max(1, err.detail.length) : 1;
    let marked = '';
    if (pos !== null && dsl) {
      const a = dsl.slice(0, pos), b = dsl.slice(pos, pos + len) || ' ', c = dsl.slice(pos + len);
      marked = `<code>${esc(a)}<mark>${esc(b)}</mark>${esc(c)}</code>`;
    }
    return `<p class="edge-err" role="alert">${esc(err.message)}${marked}${err.hint ? `<small>${esc(err.hint)}</small>` : ''}</p>`;
  }

  function renderHome() {
    if (!S.ov && !S.ovError) return skeletonHome();
    if (S.ovError) return renderBroken(S.ovError);
    const ov = S.ov;
    if (!ov.ready) {
      if (ov.reason === 'edge_not_installed') return renderNotInstalled();
      if (ov.reason === 'edge_no_data' || ov.reason === 'edge_busy') return renderData();
      return renderBroken(null);
    }
    const chips = exampleChips();
    const cats = categories();
    const list = filteredPresets();
    const total = presets().length;
    const start = START_HERE.map(([id, q]) => ({ p: presets().find((x) => x.id === id), q })).filter((x) => x.p);
    return `<section class="e-sec" style="--i:0">
        <form class="edge-ask" id="edge-form" autocomplete="off" novalidate>
          <input class="edge-ask__input${S.askErr ? ' is-bad' : ''}" id="edge-ask" type="text" spellcheck="false" autocapitalize="off" autocorrect="off"
                 role="combobox" aria-expanded="false" aria-controls="edge-sugg" aria-autocomplete="list"
                 placeholder="Ask, e.g. ${esc(chips[0])}" value="${esc(S.ask)}" aria-label="Question in the Edge Stats query language">
          <button type="submit" class="edge-btn" id="edge-run"${S.askBusy ? ' disabled' : ''}>${S.askBusy ? '<span class="edge-spin"></span>' : 'Ask'}</button>
          <ul class="edge-sugg" id="edge-sugg" role="listbox" hidden></ul>
        </form>
        <div id="edge-ask-err">${askErrorHtml(S.askErr, S.ask)}</div>
        <p class="e-try">Try ${chips.map((c) => `<button type="button" class="edge-chip edge-chip--mono" data-example="${esc(c)}" title="${esc(c)}"><span class="t">${esc(c)}</span></button>`).join('')}</p>
      </section>
      ${start.length && S.cat === 'all' ? `<section class="e-sec" style="--i:1"><h3 class="e-h3">Start here</h3>
        <div class="e-tiles">${start.map(({ p, q }) => `<button type="button" class="e-tile" data-preset="${esc(p.id)}"><b>${esc(p.title)}</b><span>${esc(q)}</span></button>`).join('')}</div></section>` : ''}
      <section class="e-sec" style="--i:2">
        <h3 class="e-h3">All reports <span class="e-aside">${num(total)}</span></h3>
        <input type="search" class="edge-search" id="edge-q" placeholder="Search — gap, opening range, FOMC…" value="${esc(S.q)}" aria-label="Search reports" autocomplete="off">
        <div class="edge-chips edge-chips--scroll" role="toolbar" aria-label="Report categories">
          <button type="button" class="edge-chip${S.cat === 'all' ? ' is-on' : ''}" data-cat="all" aria-pressed="${S.cat === 'all'}">All<span>${num(total)}</span></button>
          ${cats.map(([c, n]) => `<button type="button" class="edge-chip${S.cat === c ? ' is-on' : ''}" data-cat="${esc(c)}" aria-pressed="${S.cat === c}">${esc(catLabel(c))}<span>${n}</span></button>`).join('')}
        </div>
        <ul class="edge-reports" id="edge-reports">${reportRows(list)}</ul>
      </section>
      <p class="edge-foot"><b>Historical frequencies, not predictions or advice.</b><small>Engine: LuxAlgo/edge-stats (MIT), running on this machine. Calendar data from Edge Stats by LuxAlgo (github.com/LuxAlgo/edge-stats), CC BY 4.0.</small></p>`;
  }

  /* One long flat list was a wall: with no search and no category chosen it is grouped under category
     headings, so the heading carries what each row's tag used to repeat. */
  function reportRows(list) {
    if (!list.length) return `<li class="edge-empty">No report matches \u201c${esc(S.q)}\u201d.</li>`;
    const grouped = S.cat === 'all' && !S.q.trim();
    const tagged = S.cat === 'all' && !!S.q.trim();
    let last = null;
    let out = '';
    for (const p of list) {
      if (grouped && p.category !== last) { out += `<li class="e-grouphead">${esc(catLabel(p.category))}</li>`; last = p.category; }
      out += `<li><button type="button" class="edge-report" data-preset="${esc(p.id)}" title="${esc(p.summary)}">
        <span class="edge-report__main"><span class="edge-report__name">${esc(p.title)}</span><span class="edge-report__sum">${esc(p.summary)}</span></span>
        ${tagged ? `<span class="edge-report__tag">${esc(catLabel(p.category))}</span>` : ''}<span class="edge-report__go">${ICON.go}</span></button></li>`;
    }
    return out;
  }

  /* — the answer — */
  function ciBar(est, lo, hi, small) {
    const l = Math.max(0, Math.min(1, lo)), h = Math.max(l, Math.min(1, hi));
    const label = `95% interval ${pct(lo)} to ${pct(hi)}${isNum(est) ? ', estimate ' + pct(est) : ''}`;
    return `<div class="ci${small ? ' ci--sm' : ''}" role="img" aria-label="${esc(label)}">
      <div class="ci__track"><div class="ci__range" style="left:${(l * 100).toFixed(2)}%;width:${Math.max(0.8, (h - l) * 100).toFixed(2)}%"></div>
      ${isNum(est) ? `<div class="ci__est" style="left:${(Math.max(0, Math.min(1, est)) * 100).toFixed(2)}%"></div>` : ''}</div>
      <div class="ci__scale"><span>0%</span><span>50%</span><span>100%</span></div></div>`;
  }

  function flag(text, kind) {
    return `<p class="edge-flag${kind === 'info' ? ' edge-flag--info' : ''}" role="note">${kind === 'info' ? ICON.info : ICON.warn}<span>${text}</span></p>`;
  }

  function resultRefine(r, d) {
    const p = r.preset;
    const f = S.filters;
    const groupable = groupOptions();
    const params = (p && p.params) || [];
    const cur = (name, dflt) => (f.params && f.params[name] !== undefined ? f.params[name] : (dflt === undefined ? '' : dflt));
    const paramField = (s) => {
      const label = `<span title="${esc(s.doc || '')}">${esc(humanise(s.name))}</span>`;
      const v = cur(s.name, s.default);
      if (s.type === 'enum') {
        return `<label>${label}<select data-param="${esc(s.name)}">${s.default === undefined ? '<option value="">any</option>' : ''}${(s.values || []).map((o) => `<option value="${esc(o)}"${String(v) === String(o) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
      }
      const t = s.type === 'string' ? 'text' : 'number';
      return `<label>${label.replace('</span>', (s.type === 'duration' ? ' (min)' : '') + '</span>')}<input data-param="${esc(s.name)}" type="${t}" ${t === 'number' ? 'step="any"' : ''} value="${esc(v)}" placeholder="${s.default === undefined ? 'optional' : ''}"></label>`;
    };
    return `<section class="e-sec" style="--i:6">
      <button type="button" class="edge-disclose" data-act="refine" aria-expanded="${S.refine}"><span class="e-h3">Adjust<span class="e-aside">split by, dates, settings</span></span>${ICON.down}</button>
      ${S.refine ? `<div class="edge-refine">
        ${params.map(paramField).join('')}
        <div class="full edge-refine edge-refine--pair"><label>From<input id="edge-since" type="date" value="${esc(f.since)}"></label>
        <label>To<input id="edge-until" type="date" value="${esc(f.until)}"></label></div>
        <label class="full">Split the result by<select id="edge-group"><option value="">Nothing</option>${groupable.map((g) =>
          `<option value="${esc(g.name)}"${f.groupBy === g.name ? ' selected' : ''}>${esc(g.title)}</option>`).join('')}</select></label>
        <div class="full"><button type="button" class="edge-btn edge-btn--sm" data-act="apply">Apply</button></div>
      </div>` : ''}
    </section>`;
  }

  /* minGapPct → "Min gap %": parameter names are camelCase identifiers, never labels. */
  const humanise = (name) => {
    const t = String(name).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/\bpct\b/g, '%');
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const fieldTitle = (name) => {
    const f = (S.registry || []).find((e) => e.kind === 'field' && e.name === name);
    return (f && f.title) || humanise(name);
  };

  function groupOptions() {
    const fields = (S.registry || []).filter((e) => e.kind === 'field' && (e.valueType === 'enum' || e.valueType === 'boolean' || e.name === 'month' || e.name === 'year'));
    return fields.map((e) => ({ name: e.name, title: e.title || e.name }));
  }

  /* The answer, in the order a trader reads it. SUMMARY is the hero (the rate), the verdict chips, the
     breakdown when there is one, and the days behind it. DETAILED adds the evidence behind the chips.
     Nothing here computes a number: every figure is the engine's, and none is shown without its N. */
  function renderResult() {
    const r = S.result;
    if (!r) return renderHome();
    if (r.loading) {
      return `<section class="e-hero"><div class="edge-skel" style="width:46%"></div><div class="edge-skel edge-skel--big"></div><div class="edge-skel edge-skel--bar"></div></section>
        <section class="e-sec"><div class="edge-skel" style="width:30%"></div><div class="edge-skel" style="height:54px"></div></section>`;
    }
    if (r.error) {
      return `<section class="edge-card edge-hero"><p class="edge-cap">${esc(r.title || 'Result')}</p>${askErrorHtml(r.error, r.req && r.req.dsl)}
        <button type="button" class="edge-btn edge-btn--ghost" data-act="back">Back</button></section>`;
    }
    const d = r.data;
    const detailed = S.detail === 'detailed';
    const refused = d.guards && d.guards.refused;
    const low = d.guards && d.guards.lowSample && !refused;
    const dsl = d.query && d.query.dsl;
    const unit = (d.distribution && d.distribution.unit) || '';
    let i = 0;
    const out = [];

    /* — the hero: what was asked, the rate, how sure we are — */
    const head = `<h2 class="e-title">${esc(r.title)}</h2>
      ${r.preset ? `<p class="edge-note edge-clamp" title="${esc(r.preset.summary)}">${esc(r.preset.summary)}</p>` : ''}
      <div class="e-qline"><code class="e-q" title="${esc(dsl)}">${esc(dsl)}</code>
        <button type="button" class="e-iconbtn" data-copy="${esc(dsl)}" aria-label="Copy the question" title="Copy the question">${ICON.copy}</button>
        ${r.kind === 'query' ? `<button type="button" class="e-iconbtn" data-act="edit" aria-label="Edit this question" title="Edit this question">${ICON.edit}</button>` : ''}</div>`;
    if (refused) {
      out.push(`<section class="e-hero" style="--i:${i++}">${head}
        <div class="e-rate e-rate--none"><span class="e-rate__n">Not enough sessions to give a rate</span></div>
        <p class="e-facts"><span><b>${num(d.n)}</b> ${d.n === 1 ? 'session' : 'sessions'} matched</span><span><b>${num(d.successes)}</b> ${d.successes === 1 ? 'hit' : 'hits'}</span></p>
        ${flag(`Below the engine’s minimum of <b>${num(d.guards.refuseFloor)}</b> sessions, so no estimate is shown — a percentage from this few cases would look precise and mean nothing. Loosen a condition, or widen the date range.`)}</section>`);
    } else if (isNum(d.estimate) && Array.isArray(d.ci95)) {
      const [lo, hi] = d.ci95;
      const chips = [];
      if (d.stability) {
        chips.push(`<button type="button" class="e-verdict ${d.stability.agree ? 'e-verdict--ok' : 'e-verdict--warn'}${detailed ? ' is-static' : ''}" data-act="jump" data-target="e-stable" title="First half of history vs second half">${d.stability.agree ? ICON.check : ICON.warn}${d.stability.agree ? 'Stable over time' : 'Changed over time'}</button>`);
      }
      if (d.recency) {
        chips.push(`<button type="button" class="e-verdict ${d.recency.diverges ? 'e-verdict--warn' : 'e-verdict--ok'}${detailed ? ' is-static' : ''}" data-act="jump" data-target="e-recent" title="Last ${num(d.recency.window)} sessions vs all of history">${d.recency.diverges ? ICON.warn : ICON.check}${d.recency.diverges ? 'Recent sessions differ' : 'Matches recent sessions'}</button>`);
      }
      out.push(`<section class="e-hero" style="--i:${i++}">${head}
        <div class="e-rate" aria-label="${esc(pctNum(d.estimate) + ' percent')}"><span class="e-rate__n">${pctNum(d.estimate)}</span><span class="e-rate__u">%</span></div>
        <p class="e-facts"><span><b>${num(d.successes)}</b> of <b>${num(d.n)}</b> sessions</span><span title="Where the true rate probably sits (Wilson 95% interval)">95% range <b>${pct(lo)} – ${pct(hi)}</b></span></p>
        ${ciBar(d.estimate, lo, hi)}
        ${low ? flag(`<b>Low sample</b> — only ${num(d.n)} sessions (the engine warns below ${num(d.guards.warnFloor)}). Treat this as a hint, not a rate.`) : ''}
        ${chips.length ? `<div class="e-verdicts">${chips.join('')}</div>` : ''}
      </section>`);
    }

    /* — the breakdown: it IS the answer when the question was split, so it leads in both modes — */
    if (!refused && d.groups && d.groups.length) {
      const groups = d.groups.slice().sort(groupSort);
      out.push(`<section class="e-sec" style="--i:${i++}"><h3 class="e-h3">By ${esc(fieldTitle(S.filters.groupBy || 'group').toLowerCase())}<span class="e-aside">bar = 95% range</span></h3><div class="edge-groups">${groups.map((g) => `
        <div class="edge-group${g.lowSample || !isNum(g.estimate) ? ' is-low' : ''}"><span class="edge-group__name" title="${esc(g.group)}">${esc(g.group)}</span>
          ${isNum(g.estimate) && Array.isArray(g.ci95) ? ciBar(g.estimate, g.ci95[0], g.ci95[1], true) : '<span class="edge-note">no estimate</span>'}
          <span class="edge-group__num"><b>${pct(g.estimate)}</b><small>n ${num(g.n)}</small></span></div>`).join('')}</div></section>`);
    }

    /* — the evidence, only on request — */
    if (detailed) {
      if (!refused && d.stability) {
        const a = d.stability.firstHalf, b = d.stability.secondHalf;
        const row = (label, h) => `<div class="edge-row"><div class="edge-row__lab">${label}<b>${pct(h.estimate)}</b><small>n ${num(h.n)}</small></div>${isNum(h.estimate) && h.ci95 ? ciBar(h.estimate, h.ci95[0], h.ci95[1], true) : ''}</div>`;
        const agree = d.stability.agree;
        out.push(`<section class="e-sec" id="e-stable" style="--i:${i++}"><h3 class="e-h3">Is it stable?<span class="e-aside">${agree ? 'the halves agree' : 'the halves disagree'}</span></h3><div class="edge-rows">${row('First half', a)}${row('Second half', b)}</div>
          ${agree ? '' : '<p class="edge-note">The earlier and later sessions give clearly different rates \u2014 the pattern may have changed over time.</p>'}</section>`);
      }

      if (!refused && d.recency) {
        const rc = d.recency;
        out.push(`<section class="e-sec" id="e-recent" style="--i:${i++}"><h3 class="e-h3">Recent vs all history<span class="e-aside">${rc.diverges ? 'recent differs' : 'recent matches'}</span></h3><div class="edge-rows">
          <div class="edge-row"><div class="edge-row__lab">Last ${num(rc.window)}<b>${pct(rc.estimate)}</b><small>n ${num(rc.n)}</small></div>${isNum(rc.estimate) && rc.ci95 ? ciBar(rc.estimate, rc.ci95[0], rc.ci95[1], true) : ''}</div>
          <div class="edge-row"><div class="edge-row__lab">All<b>${pct(d.estimate)}</b><small>n ${num(d.n)}</small></div>${isNum(d.estimate) && d.ci95 ? ciBar(d.estimate, d.ci95[0], d.ci95[1], true) : ''}</div></div></section>`);
      }

      if (!refused && d.perYear && d.perYear.length) {
        out.push(`<section class="e-sec" style="--i:${i++}"><h3 class="e-h3">Year by year</h3><ul class="edge-years">${d.perYear.map((y) => `
          <li><b>${pct(y.estimate, 0)}</b><div class="col" role="img" aria-label="${esc(y.year + ': ' + pct(y.estimate) + ' of ' + y.n + ' sessions')}"><i style="--v:${isNum(y.estimate) ? y.estimate.toFixed(3) : 0}"></i></div><span>${esc(y.year)}</span><small>n ${num(y.n)}</small></li>`).join('')}</ul></section>`);
      }

      if (!refused && d.distribution && d.distribution.count > 0) {
        const ds = d.distribution;
        const max = ds.max > ds.min ? ds.max : ds.min + 1;
        const at = (v) => Math.max(0, Math.min(100, ((v - ds.min) / (max - ds.min)) * 100));
        out.push(`<section class="e-sec" style="--i:${i++}"><h3 class="e-h3">How long it took<span class="e-aside">${esc(unit)} \u00b7 ${plural(ds.count, 'session')}</span></h3><div class="edge-dist">
          <div class="edge-dist__axis" role="img" aria-label="Distribution: median ${esc(fmtValue(ds.median, unit))}, middle half ${esc(fmtValue(ds.p25, unit))} to ${esc(fmtValue(ds.p75, unit))}, 90th percentile ${esc(fmtValue(ds.p90, unit))}">
            <div class="edge-dist__line"></div>
            <div class="edge-dist__whisk" style="left:${at(ds.p75).toFixed(2)}%;width:${Math.max(0, at(ds.p90) - at(ds.p75)).toFixed(2)}%"></div>
            <div class="edge-dist__box" style="left:${at(ds.p25).toFixed(2)}%;width:${Math.max(0.6, at(ds.p75) - at(ds.p25)).toFixed(2)}%"></div>
            <div class="edge-dist__med" style="left:${at(ds.median).toFixed(2)}%"></div></div>
          <div class="edge-dist__scale"><span>${esc(fmtValue(ds.min, unit))}</span><span>${esc(fmtValue(ds.max, unit))}</span></div>
          <dl class="edge-facts"><div><dt>Median</dt><dd>${esc(fmtValue(ds.median, unit))}</dd></div><div><dt>Middle half</dt><dd>${esc(fmtValue(ds.p25, unit))} – ${esc(fmtValue(ds.p75, unit))}</dd></div><div><dt>90% by</dt><dd>${esc(fmtValue(ds.p90, unit))}</dd></div><div><dt>Mean</dt><dd>${esc(fmtValue(ds.mean, unit))}</dd></div></dl></div>
          <p class="edge-note">Among the ${num(ds.count)} sessions where it happened: the box is the middle half, the bar reaches the 90th percentile.</p></section>`);
      }

      if (r.preset && r.preset.summary) {
        out.push(`<section class="e-sec" style="--i:${i++}"><h3 class="e-h3">What this measures</h3><p class="e-disclose-body">${esc(r.preset.summary)}</p></section>`);
      }
    }

    /* — the days behind it: the way back to the chart, so it stays in the Summary — */
    if (d.sessions && d.sessions.length) {
      const cap = (detailed || S.sessAll) ? S.sessShown : Math.min(5, S.sessShown);
      const shown = d.sessions.slice(0, cap);
      out.push(`<section class="e-sec" style="--i:${i++}"><h3 class="e-h3">Days behind it<span class="e-aside">${num(shown.length)} of ${num(d.n)} \u00b7 newest first</span></h3>
        <ul class="edge-sessions">${shown.map((s) => `<li><button type="button" class="edge-session" data-session="${esc(s.sessionId)}">
          <span class="edge-session__date">${esc(fmtDate(s.tradeDate))}</span><span class="edge-session__val">${isNum(s.value) ? esc(fmtValue(s.value, unit)) : ''}</span>
          <span class="${s.success ? 'edge-hit' : 'edge-miss'}">${s.success ? 'hit' : 'miss'}</span>${ICON.go}</button></li>`).join('')}</ul>
        ${d.sessions.length > shown.length ? `<button type="button" class="edge-btn edge-btn--ghost edge-btn--sm" data-act="more" style="align-self:flex-start">Show more</button>` : ''}</section>`);
    }

    out.push(resultRefine(r, d));

    out.push(`<p class="edge-foot"><b>${esc(d.disclaimer || 'Historical conditional frequencies with sample sizes. Not predictions, not advice.')}</b>${detailed ? `<small>engine ${esc((d.engine && d.engine.version) || '')} · store ${esc(((d.engine && d.engine.storeFingerprint) || '').slice(0, 8))}</small>` : ''}</p>`);
    return out.join('');
  }

  /* — one session — */
  let chart = null;
  let chartKey = '';
  function destroyChart() {
    if (!chart) return;
    try { chart.dispose(); } catch (e) { /* already gone */ }
    chart = null;
    chartKey = '';
  }
  function destroyChartIfLeaving() { if (S.view !== 'session') destroyChart(); }

  function sessionPosition() {
    const list = (S.result && S.result.data && S.result.data.sessions) || [];
    const i = list.findIndex((s) => s.sessionId === S.sess.id);
    return { list, i };
  }

  /* Which of the engine's levels sit within reach of the day's own candles. A level far outside (a prior
     high 3% above a quiet day) stretches the chart's price scale until the candles are a sliver at the
     bottom — it is listed in the legend as off-chart instead of drawn. */
  function levelsInReach(view) {
    const bars = [...((view.context && view.context.bars) || []), ...(view.bars || [])];
    const lv = view.levels || {};
    if (!bars.length) return () => true;
    let lo = Infinity, hi = -Infinity;
    for (const b of bars) { if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high; }
    const pad = Math.max((hi - lo) * 0.6, Math.abs(hi) * 0.0005);
    const ok = (v) => isNum(v) && v >= lo - pad && v <= hi + pad;
    return ok;
  }

  function renderSession() {
    const s = S.sess;
    const { list, i } = sessionPosition();
    const ref = i >= 0 ? list[i] : null;
    const unit = (S.result && S.result.data && S.result.data.distribution && S.result.data.distribution.unit) || '';
    const head = (title, sub, badges) => `<section class="e-sesshead" style="--i:0"><div><h2 class="e-title">${esc(title)}</h2>${sub ? `<p class="e-sub">${esc(sub)}</p>` : ''}</div>${badges || ''}</section>`;
    if (s.loading) {
      return head(s.id.split('|')[0], 'Loading the day…', '') + `<div class="edge-chart"><div class="edge-chart__msg"><span class="edge-spin"></span></div></div>`;
    }
    if (s.error) {
      return head(s.id, '', '') + `<p class="edge-err" role="alert">${esc(s.error.message)}${s.error.hint ? `<small>${esc(s.error.hint)}</small>` : ''}</p>`;
    }
    const d = s.data;
    const lv = d.levels || {};
    /* the outcome and the numbers a trader checks first; the engine's bookkeeping goes under the chart */
    const badges = [];
    if (ref) badges.push(`<span class="${ref.success ? 'edge-hit' : 'edge-miss'}">${ref.success ? 'hit' : 'miss'}</span>`);
    if (ref && isNum(ref.value)) {
      /* "filled in 15 min" says what the number is; a bare "15 min" made the reader guess */
      const what = outcomeInfo(S.result, d);
      const shown = fmtValue(ref.value, unit);
      badges.push(`<span class="edge-badge">${esc(what && what.verb && unit === 'minutes' ? `${what.verb} in ${shown}` : shown)}</span>`);
    }
    if (isNum(lv.gapPct) && lv.gapDir && lv.gapDir !== 'none') badges.push(`<span class="edge-badge">gap ${lv.gapPct > 0 ? '+' : ''}${lv.gapPct.toFixed(2)}%</span>`);
    if (d.isHalfDay) badges.push('<span class="edge-badge edge-badge--warn">half day</span>');
    if (d.isRollDay) badges.push('<span class="edge-badge edge-badge--warn">roll day</span>');
    if (!d.complete) badges.push('<span class="edge-badge edge-badge--warn">incomplete session</span>');
    const older = i >= 0 ? list[i + 1] : null, newer = i > 0 ? list[i - 1] : null;
    const legend = legendItems(d);
    const fine = [`${esc(String(d.sessionKey || '').toUpperCase())} session`, `${esc(d.tf)} bars`, (d.context && d.context.bars && d.context.bars.length) ? `${num(d.context.bars.length)} bars of context before the open` : ''].filter(Boolean).join(' \u00b7 ');
    return `${head(fmtDate(d.tradeDate), d.symbol, `<div class="edge-badges">${badges.join('')}</div>`)}
      <div class="edge-chart" id="edge-chart" role="img" aria-label="${esc(d.symbol + ' ' + d.tradeDate + ' session bars with the query’s levels')}"><div class="edge-chart__msg"><span class="edge-spin"></span></div></div>
      ${i >= 0 ? `<div class="edge-nav"><button type="button" class="edge-btn edge-btn--ghost edge-btn--sm" data-session="${esc(older ? older.sessionId : '')}"${older ? '' : ' disabled'} title="Older matched session (←)">${ICON.back}Older</button>
        <span class="edge-nav__pos">${i + 1} of ${num(list.length)} listed</span>
        <button type="button" class="edge-btn edge-btn--ghost edge-btn--sm" data-session="${esc(newer ? newer.sessionId : '')}"${newer ? '' : ' disabled'} title="Newer matched session (→)">Newer<span style="display:inline-flex;transform:scaleX(-1)">${ICON.back}</span></button></div>` : ''}
      ${legend}
      <p class="edge-foot">${esc((d.context && d.context.note) ? d.context.note + ' ' : '')}These are the engine\u2019s own measurements for this one day \u2014 a way to check a statistic against a real session, not a signal.<small>${fine} \u00b7 chart by Vela</small></p>`;
  }

  function legendItems(d) {
    const lv = d.levels || {};
    const reach = levelsInReach(d);
    const p = (v) => (isNum(v) ? `<b>${esc(v.toFixed(2))}</b>${reach(v) ? '' : ` <small>${v > (d.levels.open || v) ? '\u2191' : '\u2193'} off chart</small>`}` : '');
    const items = [];
    if (isNum(lv.prevHigh)) items.push(`<li style="color:var(--lx-fg-faint)"><i class="dashed"></i><span>Prior high ${p(lv.prevHigh)}</span></li>`);
    if (isNum(lv.prevLow)) items.push(`<li style="color:var(--lx-fg-faint)"><i class="dashed"></i><span>Prior low ${p(lv.prevLow)}</span></li>`);
    if (isNum(lv.prevClose)) items.push(`<li style="color:var(--lx-fg-muted)"><i></i><span>Prior close ${p(lv.prevClose)}</span></li>`);
    if (isNum(lv.open)) items.push(`<li style="color:var(--lx-fg)"><i class="dotted"></i><span>Open ${p(lv.open)}</span></li>`);
    if (isNum(lv.prevClose) && isNum(lv.open) && lv.open !== lv.prevClose) items.push(`<li style="color:var(--lx-fg-muted)"><i class="band"></i><span>Gap</span></li>`);
    return items.length ? `<ul class="edge-legend">${items.join('')}</ul>` : '';
  }

  /* — data — */
  /* The three sources behind one switch: a trader adds data once, so the page shows the one source being
     added rather than three forms stacked. The server's long notes stay one tap away. */
  const SOURCE_BLURB = {
    binance: 'Crypto \u00b7 free, no key \u00b7 1-minute history',
    dukascopy: 'Forex, metals, indices \u00b7 free, no key \u00b7 the first download is slow',
    demo: 'Synthetic bars to try everything in seconds \u2014 not market data',
  };
  const SOURCE_NAME = { binance: 'Binance', dukascopy: 'Dukascopy', demo: 'Demo' };

  function sourceCard(sources, i) {
    const busy = jobRunning() || (S.ov && S.ov.install && S.ov.install.external);
    const have = new Set(symbols().map((x) => x.symbol));
    const byId = Object.fromEntries(sources.map((x) => [x.id, x]));
    const ids = ['binance', 'dukascopy', 'demo'].filter((id) => byId[id]);
    if (!ids.length) return '';
    const cur = ids.includes(S.setup.src) ? S.setup.src : (symbols().length ? ids[0] : (ids.includes('demo') ? 'demo' : ids[0]));
    const src = byId[cur];
    let panel = '';
    if (cur === 'demo') {
      const both = src.symbols.every((x) => have.has(x));
      panel = `<div class="edge-src__row"><button type="button" class="edge-btn edge-btn--sm" data-setup="demo"${busy || both ? ' disabled' : ''}>${both ? 'Demo data loaded' : 'Load the demo data'}</button><span class="edge-note">${both ? '' : 'about 10 seconds'}</span></div>`;
    } else if (cur === 'binance') {
      const yrs = [1, 2, 3, 5, 10];
      panel = `<div class="edge-chips">${src.symbols.map((x) => `<button type="button" class="edge-chip${S.setup.bSymbol === x ? ' is-on' : ''}" data-bsym="${esc(x)}">${esc(x)}${have.has(x) ? '<span>\u2713</span>' : ''}</button>`).join('')}</div>
        <div class="edge-src__row"><input class="edge-field grow" id="edge-bsym" value="${esc(S.setup.bSymbol)}" aria-label="Binance spot symbol" spellcheck="false" autocapitalize="characters" placeholder="BTCUSDT">
          <select class="edge-field" id="edge-byears" aria-label="How far back">${yrs.map((y) => `<option value="${y}"${S.setup.bYears === y ? ' selected' : ''}>${y} ${y === 1 ? 'year' : 'years'}</option>`).join('')}</select>
          <button type="button" class="edge-btn edge-btn--sm" data-setup="binance"${busy ? ' disabled' : ''}>${have.has(S.setup.bSymbol) ? 'Update' : 'Download'}</button></div>
        <details class="e-adv"><summary>Advanced</summary>
          <label class="edge-check"><input type="checkbox" id="edge-archive"${S.setup.archive ? ' checked' : ''}><span>Use the public archive only \u2014 for when Binance\u2019s live API is blocked on this network (history then ends about a day behind).</span></label></details>`;
    } else {
      const yrs = [1, 2, 3, 5];
      panel = `<div class="edge-src__row"><select class="edge-field grow" id="edge-dsym" aria-label="Instrument">${src.symbols.map((x) => `<option value="${esc(x)}"${S.setup.dSymbol === x ? ' selected' : ''}>${esc(x)}${have.has(x) ? ' \u2713' : ''}</option>`).join('')}</select>
        <select class="edge-field" id="edge-dyears" aria-label="How far back">${yrs.map((y) => `<option value="${y}"${S.setup.dYears === y ? ' selected' : ''}>${y} ${y === 1 ? 'year' : 'years'}</option>`).join('')}</select>
        <button type="button" class="edge-btn edge-btn--sm" data-setup="dukascopy"${busy ? ' disabled' : ''}>${have.has(S.setup.dSymbol) ? 'Update' : 'Download'}</button></div>`;
    }
    return `<section class="e-sec edge-src" style="--i:${i}"><h3 class="e-h3">Add data</h3>
      <div class="e-seg" role="group" aria-label="Data source">${ids.map((id) => `<button type="button" data-src="${id}" aria-pressed="${id === cur}">${SOURCE_NAME[id]}</button>`).join('')}</div>
      <p class="edge-note">${esc(SOURCE_BLURB[cur] || src.note || '')}</p>
      ${panel}
      <details class="e-adv"><summary>About this source</summary><p class="e-disclose-body">${esc(src.note || '')}</p></details></section>`;
  }

  function jobCard(job) {
    if (!job) return '';
    const status = job.status;
    const running = status === 'running' || status === 'cancelling';
    const last = (job.tail && job.tail[job.tail.length - 1]) || '';
    const stateText = status === 'running' ? `<span class="edge-spin"></span> ${esc(job.step || 'working')}`
      : status === 'cancelling' ? '<span class="edge-spin"></span> stopping…'
        : status === 'done' ? `${ICON.check} done`
          : status === 'cancelled' ? 'cancelled' : 'failed';
    const secs = Math.max(0, Math.round(((job.finished || Date.now() / 1000) - job.started)));
    return `<section class="edge-card edge-job" id="edge-job" style="--i:0">
      <div class="edge-job__top"><strong>${esc(job.label)}</strong><span class="edge-job__state is-${esc(status)}">${stateText}</span></div>
      ${running ? '<div class="edge-job__bar" role="progressbar" aria-label="Working"><i></i></div>' : ''}
      ${job.error ? `<p class="edge-err" role="alert">${esc(job.error)}</p>` : ''}
      ${last ? `<p class="edge-job__line" title="${esc(last)}">${esc(last)}</p>` : ''}
      <div class="edge-src__row"><span class="edge-note">${secs}s${running ? ' · questions are paused while the store is updated' : ''}</span>
        <span style="flex:1"></span>
        ${job.lines ? `<button type="button" class="edge-chip" data-act="log" aria-pressed="${S.logOpen}">${S.logOpen ? 'Hide' : 'Show'} log</button>` : ''}
        ${running && status !== 'cancelling' ? '<button type="button" class="edge-btn edge-btn--danger edge-btn--sm" data-act="cancel">Cancel</button>' : ''}
        ${status === 'done' && S.ov && S.ov.ready ? '<button type="button" class="edge-btn edge-btn--sm" data-act="home">Ask a question</button>' : ''}</div>
      ${S.logOpen && job.tail ? `<pre class="edge-log">${esc(job.tail.join('\n'))}</pre>` : ''}
    </section>`;
  }

  function renderData() {
    if (!S.ov && !S.ovError) return skeletonHome();
    const ov = S.ov;
    if (!ov) return renderBroken(S.ovError);
    if (ov.reason === 'edge_not_installed') return renderNotInstalled();
    const out = [];
    let i = 0;
    if (jobShown()) out.push(jobCard(jobShown()));
    if (!symbols().length && !jobShown()) {
      out.push(`<section class="edge-card edge-hero" style="--i:${i++}"><h2>Add some bars to start</h2>
        <p class="edge-note">Edge Stats measures 1-minute bars stored on your own disk. Try the demo data first (synthetic, about ten seconds), or download real history from a free source below.</p></section>`);
    }
    if (symbols().length) {
      out.push(`<section class="e-sec" style="--i:${i++}"><h3 class="e-h3">In your store<span class="e-aside">${ov.store_mb ? num(ov.store_mb, 1) + ' MB' : ''}</span></h3>
        <table class="edge-table"><thead><tr><th>Symbol</th><th>Source</th><th class="r">Data to</th></tr></thead><tbody>${symbols().map((s) =>
          `<tr><td>${esc(s.symbol)}</td><td>${esc(s.adapter)}</td><td class="r">${s.lastBar ? esc(fmtDate(s.lastBar)) : '\u2013'}</td></tr>`).join('')}</tbody></table>
        <div class="edge-src__row"><button type="button" class="edge-btn edge-btn--ghost edge-btn--sm" data-setup="refresh"${jobRunning() || (ov.install && ov.install.external) ? ' disabled' : ''}>Update all</button>
          <span class="edge-note">${ov.install && ov.install.external ? 'This console uses an engine it did not start, so it cannot download.' : 'Fetches everything new since the last bar.'}</span></div></section>`);
    }
    out.push(sourceCard(ov.sources || [], i++));
    out.push(`<p class="edge-foot"><b>Your data stays on this machine.</b> Free sources are public archives (Binance, Dukascopy) fetched with no account or key; their terms still apply \u2014 don\u2019t redistribute what you download.<small>Engine: LuxAlgo/edge-stats (MIT). Calendar data from Edge Stats by LuxAlgo (github.com/LuxAlgo/edge-stats), CC BY 4.0.</small></p>`);
    return out.join('');
  }

  /* ── after-render wiring ───────────────────────────────────────────────────────────────────── */
  function afterRender() {
    if (S.view === 'session' && S.sess.data && !S.sess.loading) mountChart();
  }

  function updateAskBusy() {
    const b = $('edge-run');
    if (!b) return;
    b.disabled = S.askBusy;
    b.innerHTML = S.askBusy ? '<span class="edge-spin"></span>' : 'Ask';
  }

  /* ── the session chart (Vela, loaded on first use) ─────────────────────────────────────────── */
  const tfMs = (tf) => {
    const m = /^(\d+)(m|h|d)$/.exec(tf || '');
    if (!m) return 60000;
    return +m[1] * (m[2] === 'm' ? 60000 : m[2] === 'h' ? 3600000 : 86400000);
  };
  const velaTf = (tf) => {
    const m = /^(\d+)(m|h|d)$/.exec(tf || '');
    if (!m) return '1';
    return m[2] === 'm' ? m[1] : m[2] === 'h' ? String(+m[1] * 60) : m[1] + 'D';
  };

  function ink() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, f) => (cs.getPropertyValue(n) || '').trim() || f;
    return { fg: v('--lx-fg', '#f4f4f4'), muted: v('--lx-fg-muted', '#9c9ca6'), faint: v('--lx-fg-faint', '#82828b'),
      accent: v('--lx-accent', '#1197e2'), plate: v('--lx-surface-3', '#1b1b20') };
  }

  function outcomeInfo(result, view) {
    const ast = result && result.data && result.data.query && result.data.query.ast;
    if (!ast || !ast.outcome) return null;
    const name = ast.outcome.name;
    const { levels, times } = view;
    const dur = (a) => (a && a.t === 'num' && typeof a.v === 'number' ? (a.unit === 'h' ? a.v * 60 : a.v) : null);
    if (name === 'gapFill' || name === 'gapReversal' || name === 'gapHold') {
      if (!isNum(levels.prevClose) || (levels.gapDir !== 'up' && levels.gapDir !== 'down')) return null;
      return { level: levels.prevClose, min: times.gapFillMin, verb: 'filled', never: 'not filled', side: levels.gapDir === 'down' ? 'above' : 'below' };
    }
    if (name === 'touchPrevHigh' || name === 'breakHoldPrevHigh') return isNum(levels.prevHigh) ? { level: levels.prevHigh, min: times.touchPrevHighMin, verb: 'touched', never: 'not touched', side: 'above' } : null;
    if (name === 'touchPrevLow' || name === 'breakHoldPrevLow') return isNum(levels.prevLow) ? { level: levels.prevLow, min: times.touchPrevLowMin, verb: 'touched', never: 'not touched', side: 'below' } : null;
    let win = null;
    if (name === 'orbBreak' || name === 'orbFalseBreak' || name === 'orbTargetHit') win = dur(ast.outcome.args[0]);
    if (name === 'ibExtension') win = levels.ibWindow;
    if (win !== null) {
      const or = (levels.openingRanges || []).find((o) => o.window === win);
      if (!or || !isNum(or.high) || !isNum(or.low)) return null;
      if (or.firstBreak === 'up') return { level: or.high, min: or.breakMin, verb: 'broke up', never: '', side: 'above', or };
      if (or.firstBreak === 'down') return { level: or.low, min: or.breakMin, verb: 'broke down', never: '', side: 'below', or };
      return { level: or.high, min: null, verb: '', never: 'range held', side: 'above', or };
    }
    if (name === 'timeOfHighBefore' && isNum(levels.high)) return { level: levels.high, min: times.highTimeMin, verb: 'high', never: '', side: 'above' };
    if (name === 'timeOfLowBefore' && isNum(levels.low)) return { level: levels.low, min: times.lowTimeMin, verb: 'low', never: '', side: 'below' };
    return null;
  }

  function clockAt(ms, tz) {
    try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(ms)); }
    catch (e) { return new Date(ms).toISOString().slice(11, 16); }
  }

  /* Everything drawn over the candles for one session. Pure: the same view gives the same overlay. */
  function buildOverlay(view, result) {
    const C = ink();
    const lv = view.levels || {};
    const ms = tfMs(view.tf);
    const startTs = view.startTs;
    const lastTs = view.bars.length ? view.bars[view.bars.length - 1].ts : view.endTs - ms;
    const edgeTs = lastTs + 5 * ms;
    const lines = [], labels = [], boxes = [], backgrounds = [];
    const PANE = 'price';
    const line = (id, y, color, style, width = 1) => ({ id, paneId: PANE, xloc: 'bar_time', x1: startTs, y1: y, x2: lastTs, y2: y, extend: 'none', color, invisible: false, width, style, arrowLeft: false, arrowRight: false, overlay: true });
    const tag = (id, x, y, text, style, color, textColor) => ({ id, paneId: PANE, xloc: 'bar_time', x, y, yloc: 'price', text, style, color, textColor: textColor || C.fg, size: 'small', textAlign: 'left', fontFamily: 'default', overlay: true });
    const px = (v) => v.toFixed(2);
    const reach = levelsInReach(view);
    const ctxFirst = view.context && view.context.bars && view.context.bars[0];
    if (ctxFirst) backgrounds.push({ id: 'context', paneId: PANE, from: ctxFirst.ts, to: startTs, color: 'rgba(128,128,140,0.10)', overlay: true });
    for (const [name, y] of [['prior high', lv.prevHigh], ['prior low', lv.prevLow]]) {
      if (!isNum(y) || !reach(y)) continue;
      const id = name.replace(' ', '-');
      lines.push(line(id, y, C.faint, 'dashed'));
      labels.push(tag(id + '-label', edgeTs, y, `${name} ${px(y)}`, 'label_right', C.plate, C.muted));
    }
    if (isNum(lv.prevClose) && reach(lv.prevClose)) {
      lines.push(line('prior-close', lv.prevClose, C.muted, 'solid'));
      labels.push(tag('prior-close-label', edgeTs, lv.prevClose, `prior close ${px(lv.prevClose)}`, 'label_right', C.plate, C.fg));
    }
    if (isNum(lv.open) && reach(lv.open)) {
      lines.push(line('open', lv.open, C.fg, 'dotted'));
      labels.push(tag('open-label', ctxFirst ? ctxFirst.ts : startTs, lv.open, `open ${px(lv.open)}`, 'label_left', C.plate));
    }
    if (isNum(lv.prevClose) && isNum(lv.open) && lv.open !== lv.prevClose && reach(lv.prevClose) && reach(lv.open)) {
      const fill = view.times && isNum(view.times.gapFillMin) ? Math.min(lastTs, startTs + view.times.gapFillMin * 60000) : lastTs;
      boxes.push({ id: 'gap', paneId: PANE, xloc: 'bar_time', left: startTs, top: Math.max(lv.prevClose, lv.open), right: Math.max(fill, startTs + ms),
        bottom: Math.min(lv.prevClose, lv.open), extend: 'none', bgColor: 'rgba(128,128,140,0.22)', borderWidth: 0, borderStyle: 'solid', textSize: 'small',
        hAlign: 'left', vAlign: 'center', wrap: false, fontFamily: 'default', bold: false, italic: false, overlay: true });
    }
    const info = outcomeInfo(result, view);
    if (info && info.or) {
      const or = info.or;
      boxes.push({ id: 'opening-range', paneId: PANE, xloc: 'bar_time', left: startTs, top: or.high, right: startTs + or.window * 60000 - ms, bottom: or.low, extend: 'none',
        bgColor: 'rgba(17,151,226,0.14)', borderColor: C.accent, borderWidth: 1, borderStyle: 'solid', textSize: 'small', hAlign: 'left', vAlign: 'top', wrap: false,
        fontFamily: 'default', bold: false, italic: false, overlay: true });
      lines.push(line('or-high', or.high, C.accent, 'dashed'), line('or-low', or.low, C.accent, 'dashed'));
      labels.push(tag('or-high-label', edgeTs, or.high, `OR high ${px(or.high)}`, 'label_right', C.plate, C.accent), tag('or-low-label', edgeTs, or.low, `OR low ${px(or.low)}`, 'label_right', C.plate, C.accent));
    }
    if (info && reach(info.level)) {
      if (isNum(info.min)) {
        const x = Math.min(lastTs, startTs + info.min * 60000);
        labels.push(tag('outcome', x, info.level, `${info.verb} ${clockAt(x, view.tz)}`, info.side === 'above' ? 'label_down' : 'label_up', C.accent, '#ffffff'));
      } else if (info.never) {
        labels.push({ id: 'outcome-never', paneId: PANE, xloc: 'bar_time', x: startTs + Math.floor((lastTs - startTs) / 2), y: info.level, yloc: 'price', text: info.never, style: 'none',
          textColor: C.muted, size: 'small', textAlign: 'center', fontFamily: 'default', noFill: true, overlay: true });
      }
    }
    return { lines, labels, boxes, backgrounds };
  }

  let chartSeq = 0;
  async function mountChart() {
    const host = $('edge-chart');
    const d = S.sess.data;
    if (!host || !d) return;
    const key = d.sessionId + '|' + (document.documentElement.dataset.theme || '');
    if (chart && chartKey === key && host.firstElementChild && host.firstElementChild.classList.contains('chart')) return;
    destroyChart();
    const mine = ++chartSeq;
    try {
      const mod = await import('@luxalgo/vela');
      if (mine !== chartSeq || S.view !== 'session' || !$('edge-chart')) return;
      const { Vela, registerNativeIndicator, unregisterNativeIndicator } = mod;
      const view = d;
      const overlay = buildOverlay(view, S.result);
      const type = `edge-session-levels-${mine}`;
      registerNativeIndicator({
        type, title: 'Session levels', shortTitle: 'levels', paneHint: 'price', overlay: true,
        inputsSchema: () => [], defaultInputs: () => ({}),
        create: () => ({
          start(ctx) { ctx.emit(overlay); ctx.setStatus('idle'); },
          onBars() {}, onViewport() {}, setInputs() {}, suspend() {}, resume() {}, stop() {},
        }),
      });
      const bars = [...(view.context.bars || []), ...view.bars];
      const ms = tfMs(view.tf);
      const first = bars.length ? bars[0].ts : view.startTs;
      const last = bars.length ? bars[bars.length - 1].ts : view.endTs - ms;
      host.innerHTML = '<div class="chart"></div>';
      const mount = host.firstElementChild;
      const light = document.documentElement.dataset.theme === 'light';
      const c = new Vela(mount, {
        data: bars.map((b) => ({ time: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
        timeframe: velaTf(view.tf), visibleRange: { from: first - 6 * ms, to: last + 5 * ms },
        theme: light ? 'light' : 'dark', live: false, drawings: false, volume: false, currentPriceLine: false, animations: false,
      });
      try { c.renderer.set({ timezone: view.tz, priceLabel: false, countdown: false }); } catch (e) { /* older build */ }
      c.addNativeIndicator(type);
      chart = { dispose() { try { c.destroy(); } finally { unregisterNativeIndicator(type); } } };
      chartKey = key;
    } catch (err) {
      console.warn('[edge] session chart failed:', err);
      if (mine === chartSeq && $('edge-chart')) {
        $('edge-chart').innerHTML = `<div class="edge-chart__msg">The chart could not be drawn here (${esc(err && err.message ? err.message : err)}). The levels are listed below.</div>`;
      }
    }
  }

  /* ── autocomplete ──────────────────────────────────────────────────────────────────────────── */
  function currentToken(input) {
    const pos = input.selectionStart == null ? input.value.length : input.selectionStart;
    const before = input.value.slice(0, pos);
    const m = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
    return m ? { text: m[1], start: pos - m[1].length, end: pos, atStart: before.slice(0, pos - m[1].length).trim() === '' } : null;
  }

  function computeSuggestions(input) {
    const tok = currentToken(input);
    if (!tok || !S.registry) return [];
    const q = tok.text.toLowerCase();
    const kindRank = (e) => (tok.atStart ? (e.kind === 'outcome' ? 0 : 2) : (e.kind === 'outcome' ? 2 : e.kind === 'predicate' ? 0 : 1));
    return S.registry
      .filter((e) => e.name.toLowerCase().includes(q) && e.name.toLowerCase() !== q)
      .map((e) => ({ e, s: (e.name.toLowerCase().startsWith(q) ? 0 : 10) + kindRank(e) }))
      .sort((a, b) => a.s - b.s || a.e.name.length - b.e.name.length)
      .slice(0, 6).map((x) => x.e);
  }

  function paintSuggestions(input) {
    const ul = $('edge-sugg');
    if (!ul) return;
    S.sugg.items = computeSuggestions(input);
    if (S.sugg.index >= S.sugg.items.length) S.sugg.index = -1;
    ul.hidden = S.sugg.items.length === 0;
    input.setAttribute('aria-expanded', String(!ul.hidden));
    ul.innerHTML = S.sugg.items.map((e, i) => `<li role="option" id="edge-opt-${i}" data-sugg="${i}" aria-selected="${i === S.sugg.index}"><b>${esc(e.name)}</b><span>${esc(e.title || '')}</span><em>${esc(e.kind)}</em></li>`).join('');
  }

  function acceptSuggestion(input, index) {
    const e = S.sugg.items[index];
    const tok = currentToken(input);
    if (!e || !tok) return false;
    const takesArgs = (e.args || []).length > 0;
    const insert = e.name + (takesArgs ? '(' : ' ');
    input.value = input.value.slice(0, tok.start) + insert + input.value.slice(tok.end);
    const pos = tok.start + insert.length;
    input.setSelectionRange(pos, pos);
    S.ask = input.value;
    S.sugg = { items: [], index: -1 };
    paintSuggestions(input);
    return true;
  }
  function closeSuggestions(input) {
    S.sugg = { items: [], index: -1 };
    const ul = $('edge-sugg');
    if (ul) { ul.hidden = true; ul.innerHTML = ''; }
    if (input) input.setAttribute('aria-expanded', 'false');
  }

  /* ── events ────────────────────────────────────────────────────────────────────────────────── */
  body.addEventListener('submit', (ev) => {
    if (ev.target && ev.target.id === 'edge-form') {
      ev.preventDefault();
      const input = $('edge-ask');
      closeSuggestions(input);
      runQuery(input ? input.value : S.ask);
    }
  });

  body.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'edge-ask') {
      S.ask = t.value;
      if (S.askErr) { S.askErr = null; t.classList.remove('is-bad'); const slot = $('edge-ask-err'); if (slot) slot.innerHTML = ''; }
      S.sugg.index = -1;
      paintSuggestions(t);
    } else if (t.id === 'edge-q') {
      S.q = t.value;
      const ul = $('edge-reports');
      if (ul) ul.innerHTML = reportRows(filteredPresets());
    } else if (t.id === 'edge-bsym') {
      S.setup.bSymbol = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      t.value = S.setup.bSymbol;
    } else if (t.id === 'edge-since') S.filters.since = t.value;
    else if (t.id === 'edge-until') S.filters.until = t.value;
    else if (t.dataset && t.dataset.param) S.filters.params[t.dataset.param] = t.value;
  });

  body.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'edge-byears') S.setup.bYears = +t.value;
    else if (t.id === 'edge-dyears') S.setup.dYears = +t.value;
    else if (t.id === 'edge-dsym') { S.setup.dSymbol = t.value; render({ keepFocus: true }); }
    else if (t.id === 'edge-archive') S.setup.archive = t.checked;
    else if (t.id === 'edge-group') S.filters.groupBy = t.value;
    else if (t.dataset && t.dataset.param) S.filters.params[t.dataset.param] = t.value;
  });

  body.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (t.id === 'edge-ask') {
      const n = S.sugg.items.length;
      if (ev.key === 'ArrowDown' && n) { ev.preventDefault(); S.sugg.index = (S.sugg.index + 1) % n; paintSuggestions(t); }
      else if (ev.key === 'ArrowUp' && n) { ev.preventDefault(); S.sugg.index = (S.sugg.index - 1 + n) % n; paintSuggestions(t); }
      else if ((ev.key === 'Tab' || ev.key === 'Enter') && n && S.sugg.index >= 0) { ev.preventDefault(); acceptSuggestion(t, S.sugg.index); }
      else if (ev.key === 'Tab' && n) { ev.preventDefault(); acceptSuggestion(t, 0); }
    }
  });

  body.addEventListener('focusout', (ev) => {
    if (ev.target && ev.target.id === 'edge-ask') setTimeout(() => { if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#edge-sugg')) return; closeSuggestions(ev.target); }, 120);
  });

  body.addEventListener('pointerdown', (ev) => {
    const li = ev.target.closest && ev.target.closest('[data-sugg]');
    if (li) { ev.preventDefault(); acceptSuggestion($('edge-ask'), +li.dataset.sugg); $('edge-ask').focus(); }
  });

  body.addEventListener('click', async (ev) => {
    const t = ev.target.closest && ev.target.closest('button, [data-example]');
    if (!t) return;
    if (t.dataset.example) { S.ask = t.dataset.example; runQuery(t.dataset.example); return; }
    if (t.dataset.preset) { runPreset(t.dataset.preset); return; }
    if (t.dataset.cat) { S.cat = t.dataset.cat; render({ keepFocus: true }); return; }
    if (t.dataset.session) { if (t.dataset.session) openSession(t.dataset.session); return; }
    if (t.dataset.bsym) { S.setup.bSymbol = t.dataset.bsym; render({ keepFocus: true }); return; }
    if (t.dataset.src) { S.setup.src = t.dataset.src; render({ keepFocus: true }); return; }
    if (t.dataset.detail) { setDetail(t.dataset.detail); return; }
    if (t.dataset.copy) {
      try { await navigator.clipboard.writeText(t.dataset.copy); say('Copied'); } catch (e) { say('Could not copy — select it and press Ctrl+C', true); }
      return;
    }
    if (t.dataset.setup) { startSetup(t.dataset.setup); return; }
    switch (t.dataset.act) {
      case 'back': goBack(); break;
      case 'home': S.back = []; S.view = 'home'; S.job = null; render(); setTimeout(() => { const i = $('edge-ask'); if (i) i.focus({ preventScroll: true }); }, 30); break;
      case 'recheck': S.ov = null; S.ovError = null; loadOverview(); break;
      case 'refine': S.refine = !S.refine; render(); break;
      case 'more':
        /* the Summary lists five days; the first tap opens the full list, later taps add more */
        if (S.detail !== 'detailed' && !S.sessAll) S.sessAll = true; else S.sessShown += 15;
        render({ keepFocus: true }); break;
      case 'jump': {
        /* a verdict chip is a door to its evidence: Summary opens the Detailed view and scrolls to it */
        const target = t.dataset.target;
        if (S.detail !== 'detailed') setDetail('detailed');
        const el = target && document.getElementById(target);
        if (el) el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        break;
      }
      case 'apply': rerunWithFilters(); break;
      case 'edit': S.ask = (S.result && S.result.req && S.result.req.dsl) || S.ask; S.back = []; S.view = 'home'; render(); setTimeout(() => { const i = $('edge-ask'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 30); break;
      case 'log': S.logOpen = !S.logOpen; paintJob(); break;
      case 'cancel': try { S.job = await call('/cancel', {}); paintJob(); } catch (err) { say(err.message, true); } break;
      default: break;
    }
  });

  function setDetail(v) {
    S.detail = v === 'detailed' ? 'detailed' : 'summary';
    writeStore(KEY_DETAIL, S.detail);
    render();
  }
  bar.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-act="back"]');
    if (b) { goBack(); return; }
    const d = ev.target.closest && ev.target.closest('[data-detail]');
    if (d) setDetail(d.dataset.detail);
  });
  bar.addEventListener('change', (ev) => {
    if (ev.target.id === 'edge-symbol') {
      S.symbol = ev.target.value;
      writeStore(KEY_SYMBOL, S.symbol);
      render();
    }
  });

  /* Theme: the sheet's own switch presses the app's one theme button, so the chart, the console chrome
     and this sheet always change together (one code path: app.js applyTheme). */
  const themeBtn = $('edge-theme');
  function paintTheme() {
    if (!themeBtn) return;
    const light = document.documentElement.dataset.theme === 'light';
    const label = light ? 'Switch to the dark theme' : 'Switch to the light theme';
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const app = $('theme-toggle');
      if (app) app.click();
      else { /* a page without the drawer's button: set the attribute and remember it, as app.js does */
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        writeStore('luxalgo-web:theme', next);
      }
    });
    paintTheme();
  }
  if (dataBtn) dataBtn.addEventListener('click', () => { if (S.view === 'data') goBack(); else setView('data'); });
  $('edge-close').addEventListener('click', () => close());
  scrim.addEventListener('click', () => close());

  /* Escape closes ONE layer: the suggestions, then a view, then the sheet. app.js's own Escape handler
     skips anything already handled (defaultPrevented), so one press never closes two surfaces. */
  document.addEventListener('keydown', (ev) => {
    if (!S.open) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      if (S.sugg.items.length) { closeSuggestions($('edge-ask')); return; }
      if (!atRoot()) { goBack(); return; }
      close();
    } else if (S.view === 'session' && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && !/^(INPUT|SELECT|TEXTAREA)$/.test((ev.target || {}).tagName || '')) {
      const { list, i } = sessionPosition();
      const next = ev.key === 'ArrowLeft' ? list[i + 1] : list[i - 1];
      if (i >= 0 && next) { ev.preventDefault(); openSession(next.sessionId); }
    }
  }, true);

  window.closeEdgeIfOpen = () => close();

  /* A theme switch while a session is on screen: the chart's colours were read at mount. */
  new MutationObserver(() => { paintTheme(); if (S.open && S.view === 'session') mountChart(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ── data jobs ─────────────────────────────────────────────────────────────────────────────── */
  async function startSetup(which) {
    let bodyObj;
    if (which === 'demo') bodyObj = { source: 'demo' };
    else if (which === 'binance') bodyObj = { source: 'binance', symbol: S.setup.bSymbol, years: S.setup.bYears, archive_only: S.setup.archive };
    else if (which === 'dukascopy') bodyObj = { source: 'dukascopy', symbol: S.setup.dSymbol, years: S.setup.dYears };
    else bodyObj = {};
    try {
      S.job = await call('/setup', bodyObj);
      S.logOpen = false;
      S.view = 'data';
      render();
      syncPolling();
    } catch (err) {
      say(err.message + (err.hint ? ' — ' + err.hint : ''), true);
    }
  }

  function paintJob() {
    const node = $('edge-job');
    if (!node || !S.job) { render(); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = jobCard(S.job);
    const fresh = tmp.firstElementChild;
    fresh.style.animation = 'none';
    node.replaceWith(fresh);
  }

  function stopPolling() { if (S.poll) { clearInterval(S.poll); S.poll = null; } }
  function syncPolling() {
    if (!S.open || !jobRunning()) { stopPolling(); return; }
    if (S.poll) return;
    S.poll = setInterval(async () => {
      try {
        const st = await call('/status');
        const was = S.job;
        S.job = st.job;
        if (!jobRunning()) {
          stopPolling();
          const ok = S.job && S.job.status === 'done';
          if (ok) say('Edge Stats data is ready');
          await loadOverview({ soft: true });
          return;
        }
        if (!was || was.lines !== S.job.lines || was.status !== S.job.status || was.step !== S.job.step) paintJob();
        else tickElapsed();
      } catch (err) { /* the console blinked; the next tick retries */ }
    }, 1200);
  }
  function tickElapsed() {
    const note = document.querySelector('#edge-job .edge-src__row .edge-note');
    if (note && S.job) note.textContent = `${Math.max(0, Math.round(Date.now() / 1000 - S.job.started))}s · questions are paused while the store is updated`;
  }

  /* ── the agent's door ──────────────────────────────────────────────────────────────────────── */
  /* The bridge's `edge` command drives these; each returns what the pane actually shows, so the agent
     is told what happened and not what was asked. */
  function describe() {
    const r = S.result && S.result.data;
    return {
      open: S.open, view: S.view, symbol: currentSymbol(), ready: !!(S.ov && S.ov.ready),
      reason: S.ov && S.ov.reason ? S.ov.reason : null, job: S.job ? { status: S.job.status, label: S.job.label } : null,
      result: r ? { dsl: r.query && r.query.dsl, n: r.n, successes: r.successes, estimate: r.estimate, refused: !!(r.guards && r.guards.refused) } : null,
      session: S.sess.data ? S.sess.data.sessionId : null,
    };
  }

  async function ensureReady() {
    open();
    if (!S.ov || !S.ov.ready) await loadOverview({ soft: !!S.ov });
    return !!(S.ov && S.ov.ready);
  }

  window.edgeSheet = {
    open, close, isOpen: () => S.open, describe,
    /* open() returns at once (the menu wants that); the agent wants the truth, so wait for the engine. */
    async show() { open(); if (!S.ov || !S.ov.ready) await loadOverview({ soft: !!S.ov }); return describe(); },
    async data() { open('data'); setView('data'); await loadOverview({ soft: true }); return describe(); },
    async ask(dsl, o) {
      if (!(await ensureReady())) return { ...describe(), ok: false };
      if (o && o.symbol && symbols().some((s) => s.symbol === o.symbol)) { S.symbol = o.symbol; writeStore(KEY_SYMBOL, S.symbol); }
      S.filters = { since: (o && o.since) || '', until: (o && o.until) || '', groupBy: (o && o.group_by) || '', params: {} };
      const data = await runQuery(dsl, { keepFilters: true });
      return { ...describe(), ok: !!data, error: data ? null : (S.askErr && S.askErr.message) || 'a newer question replaced this one', hint: data ? null : (S.askErr && S.askErr.hint) || null };
    },
    async report(id, o) {
      if (!(await ensureReady())) return { ...describe(), ok: false };
      if (o && o.symbol && symbols().some((s) => s.symbol === o.symbol)) { S.symbol = o.symbol; writeStore(KEY_SYMBOL, S.symbol); }
      S.filters = { since: (o && o.since) || '', until: (o && o.until) || '', groupBy: (o && o.group_by) || '', params: (o && o.params) || {} };
      const data = await runPreset(id, { keepFilters: true });
      const err = S.result && S.result.error;
      return { ...describe(), ok: !!data, error: data ? null : (err && err.message) || 'a newer question replaced this one', hint: data ? null : (err && err.hint) || null };
    },
    async session(id) {
      if (!(await ensureReady())) return { ...describe(), ok: false };
      const data = await openSession(id);
      return { ...describe(), ok: !!data, error: data ? null : (S.sess.error && S.sess.error.message) || null, hint: data ? null : (S.sess.error && S.sess.error.hint) || null };
    },
  };

  /* ── boot ──────────────────────────────────────────────────────────────────────────────────── */
  const fallback = $('edge-fallback');
  if (fallback) fallback.addEventListener('click', () => open());
  function showFallbackIfNeeded() {
    /* Only a MISSING row needs this door. In compact mode (a 0-width row) Vela's bottom sheet has a
       "More" item that opens the ⋯ menu, whose first entry is Edge Stats — so a fourth floating button
       there only printed over the chart (measured at 620 px, 4 Oct). */
    if (fallback) fallback.hidden = !!document.querySelector('.vela-widget-topbar');
  }
  window.addEventListener('ws-failed', showFallbackIfNeeded);
  window.addEventListener('resize', showFallbackIfNeeded);
  setTimeout(showFallbackIfNeeded, 8000);
})();
