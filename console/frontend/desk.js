/* Trader's desk — the sheet (16 Oct 2026).

   One sheet, three views on the paper account:
     paper     — what it holds now (equity, cash, realised, open P&L, positions, fills, Reset);
     journal   — what the closed trades did (net, win rate, profit factor, avg win/loss, the curve);
     propfirms — LuxAlgo's own directory + offers, read through /api/propfirms and /api/offers.

   It replaces the account popover broker.js used to paint from ⋯ — the popover could show a balance
   but had nowhere to say what the account DID. `window.taBroker.open()` is kept as a door: it now
   opens this sheet on the Paper view, so nothing that called it broke.

   Rules this file keeps (the console's own):
     * it is a READER — the only action it takes is Reset, and that one asks first;
     * no rate is painted without its sample size ("62.5% of 8"), and a rate with no sample prints —;
     * a profit factor with no losing trade prints ∞, which is not the same as a large number;
     * nothing here opens a browser or a link: the prop-firm offers are shown as text + code. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const sheet = $('desk-sheet');
  const scrim = $('desk-scrim');
  const body = $('desk-body');
  const tabsEl = $('desk-tabs');
  const subEl = $('desk-sub');
  const closeEl = $('desk-close');
  if (!sheet || !scrim || !body || !tabsEl) return;

  const TABS = [
    ['paper', 'Paper'],
    ['journal', 'Journal'],
    ['propfirms', 'Prop firms'],
  ];
  const SUB = {
    paper: 'Binance spot · simulated · every fill waits for your approval',
    journal: 'closed trades only — what the account actually did',
    propfirms: 'the directory and what is on offer — data, not a ranking',
  };
  const FIRMS_SHOWN = 30;                       // long lists slow this machine down; the count says what is cut

  const S = {
    tab: 'paper', open: false, busy: false,
    account: null, accountErr: null,
    firms: null, offers: null, propErr: null, propBusy: false, propAsked: false, firmsNote: '',
    back: null,
  };

  /* ── helpers ─────────────────────────────────────────────────────────────────────────────────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (n) => (Number(n) >= 0 ? '+' : '') + money(n);
  const cls = (n) => (Number(n) >= 0 ? 'is-up' : 'is-down');
  const qty = (n) => String(+Number(n).toFixed(8));
  const rate = (v, n) => (v == null ? '—' : (v * 100).toFixed(1) + '%' + (n != null ? `<small>of ${n}</small>` : ''));
  const say = (message, bad) => { if (typeof window.taToast === 'function') window.taToast(message, bad); };
  const clock = (ts) => {
    const d = new Date((Number(ts) || 0) * 1000);
    return isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };
  function profitFactor(st) {
    if (st.profit_factor != null) return st.profit_factor.toFixed(2);
    return st.wins > 0 ? '∞' : '—';             // ∞ = won everything so far; — = nothing closed yet
  }

  /* ── talking to the console (same bootstrap as broker.js) ────────────────────────────────────── */
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
  async function call(path, payload) {
    const init = { cache: 'no-store' };
    if (payload !== undefined) {
      const headers = { 'content-type': 'application/json' };
      const t = await token();
      if (t) headers['X-Trader-Token'] = t;
      Object.assign(init, { method: 'POST', headers, body: JSON.stringify(payload) });
    }
    const res = await fetch(path, init);
    const out = await res.json().catch(() => ({ ok: false, error: `bad JSON (HTTP ${res.status})` }));
    if (!out.ok) throw new Error(out.error || `HTTP ${res.status}`);
    return out.data;
  }

  /* ── rendering: Paper ───────────────────────────────────────────────────────────────────────── */
  function paperHtml(a) {
    const st = a.stats || {};
    const open = (a.positions || []).reduce((n, p) => n + (Number(p.unrealized) || 0), 0);
    const head = `<dl class="desk__kpis">
        <div class="desk__kpi"><dt>Equity</dt><dd>${money(a.equity)}<small>cash ${money(a.cash)}</small></dd></div>
        <div class="desk__kpi"><dt>Realised</dt><dd class="${cls(a.realized)}">${signed(a.realized)}<small>start ${money(a.start_cash)}</small></dd></div>
        <div class="desk__kpi"><dt>Open P&amp;L</dt><dd class="${cls(open)}">${signed(open)}<small>${(a.positions || []).length} position${(a.positions || []).length === 1 ? '' : 's'}</small></dd></div>
        <div class="desk__kpi"><dt>Closed trades</dt><dd>${st.closed || 0}<small>win rate ${st.win_rate == null ? '—' : (st.win_rate * 100).toFixed(0) + '%'}</small></dd></div>
      </dl>`;

    const pos = (a.positions || []).length
      ? `<ul class="desk__rows">${a.positions.map((p) => `<li class="desk__row">
          <span>${esc(p.symbol)} <small>${esc(qty(p.qty))} @ ${money(p.avg)} · mark ${money(p.mark)}</small></span>
          <b class="${cls(p.unrealized)}">${signed(p.unrealized)}</b></li>`).join('')}</ul>`
      : '<p class="desk__empty">No open positions.</p>';

    const hist = (a.history || []).slice(0, 8);
    const fills = hist.length
      ? `<ul class="desk__rows">${hist.map((o) => `<li class="desk__row">
          <span>${esc(o.side)} ${esc(qty(o.qty))} ${esc(o.symbol)} <small>${o.status === 'filled' ? 'at ' + money(o.price) + ' · ' + clock(o.closed || o.ts) : esc(o.status)}</small></span>
          <b class="${o.pnl == null ? '' : cls(o.pnl)}">${o.pnl == null ? '' : signed(o.pnl)}</b></li>`).join('')}</ul>`
      : '<p class="desk__empty">Nothing filled yet. Orders land on the chart as cards — approve one there.</p>';

    const pend = (a.pending || []).length;
    const pendNote = pend
      ? `<p class="desk__note">${pend} order${pend === 1 ? '' : 's'} waiting on the chart for your approval.</p>` : '';

    return `${head}${pendNote}
      <h3>Positions</h3>${pos}
      <h3>Recent fills</h3>${fills}
      <div class="desk__foot">
        <small>Simulated Binance spot · 0.1% fee${a.replay && a.replay.active ? ' · replay pricing' : ''} · every fill needs your approval</small>
        <button type="button" class="desk__btn" data-reset>Reset</button>
      </div>`;
  }

  /* ── rendering: Journal ─────────────────────────────────────────────────────────────────────── */
  function journalHtml(a) {
    const st = a.stats || {};
    const kpis = `<dl class="desk__kpis">
        <div class="desk__kpi"><dt>Net P&amp;L</dt><dd class="${cls(st.net)}">${signed(st.net || 0)}<small>closed trades only</small></dd></div>
        <div class="desk__kpi"><dt>Win rate</dt><dd>${rate(st.win_rate, st.closed || 0)}<small>${st.wins || 0}W · ${st.losses || 0}L${st.breakeven ? ' · ' + st.breakeven + 'BE' : ''}</small></dd></div>
        <div class="desk__kpi"><dt>Profit factor</dt><dd>${profitFactor(st)}<small>gross ${money(st.gross_win || 0)} / ${money(st.gross_loss || 0)}</small></dd></div>
        <div class="desk__kpi"><dt>Avg win / loss</dt><dd>${st.avg_win == null ? '—' : money(st.avg_win)}<small>${st.avg_loss == null ? 'no loss yet' : 'loss ' + money(st.avg_loss)}</small></dd></div>
      </dl>`;

    const curve = `<figure class="desk__curve">
        <canvas id="desk-curve" aria-label="Realised equity after each closed trade"></canvas>
        <figcaption id="desk-curve-cap"></figcaption>
      </figure>`;

    const trades = (st.trades || []);
    const table = trades.length
      ? `<table class="desk__table"><thead><tr><th scope="col">Closed</th><th scope="col">Symbol</th><th scope="col">Qty</th><th scope="col">Exit</th><th scope="col">P&amp;L</th></tr></thead>
          <tbody>${trades.map((t) => `<tr>
            <td>${clock(t.at)}</td><td>${esc(t.symbol)}</td><td>${esc(qty(t.qty))}</td>
            <td>${money(t.exit)}</td><td class="${cls(t.pnl)}">${signed(t.pnl)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="desk__empty">No closed trades yet. A trade closes when a sell fills — until then there is no win rate to show, only a position.</p>';

    const foot = `<p class="desk__note">Per-trade P&amp;L carries both legs' fees. The curve is realised equity
      and moves only when a trade closes — an open position's P&amp;L is on the Paper view, not here.
      Best ${st.best == null ? '—' : signed(st.best)} · worst ${st.worst == null ? '—' : signed(st.worst)} ·
      ${st.fills_kept || 0} fills kept (old ones are trimmed).</p>`;

    return `${kpis}${curve}<h3>Trades</h3>${table}${foot}`;
  }

  /* ── rendering: Prop firms ──────────────────────────────────────────────────────────────────── */
  function propHtml() {
    if (S.propBusy && !S.firms) return '<p class="desk__empty">Reading the directory…</p>';
    if (S.propErr && !S.firms) return `<p class="desk__bad">${esc(S.propErr)}</p><p class="desk__note"><button type="button" class="desk__btn" data-retry>Try again</button></p>`;
    if (!S.firms) return '<p class="desk__empty">Reading the directory…</p>';

    const firms = S.firms.slice(0, FIRMS_SHOWN);
    const rows = firms.length ? firms.map((f) => {
      const chips = (f.challenges || []).slice(0, 6).map((c) => {
        // The size label usually carries its own symbol ("$100,000"); printing the ISO code again reads
        // as a mistake. Only the labels that do not carry one get the code.
        const cur = /[$€£¥]/.test(String(c.sizeLabel || '')) ? '' : (c.currency || '');
        return `<span class="desk__chip"><b>${esc(c.sizeLabel || c.name || c.id)}</b>${c.price ? ' · ' + esc(cur) + money(c.price) : ''}</span>`;
      }).join('');
      const more = (f.challenges || []).length > 6 ? `<span class="desk__chip">+${f.challenges.length - 6} more</span>` : '';
      const not = (f.notSimulatable || []).length ? ` <small>· ${f.notSimulatable.length} rule set(s) not simulatable</small>` : '';
      return `<article class="desk__firm">
          <header><strong>${esc(f.name)}</strong><small>${f.challengeCount} challenge${f.challengeCount === 1 ? '' : 's'}${not}</small></header>
          <div class="desk__chips">${chips}${more}</div></article>`;
    }).join('') : '<p class="desk__empty">The directory came back empty.</p>';

    const offers = (S.offers || []);
    const offerHtml = offers.length ? offers.map((o) => {
      const off = o.discountValue == null ? '' : (o.discountIsPercent ? '-' + o.discountValue + '%' : money(o.discountValue) + ' off');
      return `<div class="desk__offer">
          <span><strong>${esc(o.propfirmName || '')}</strong>${off ? ' · ' + esc(off) : ''}${o.promoCode ? ' · <span class="desk__code">' + esc(o.promoCode) + '</span>' : ''}</span>
          ${o.shortDescription ? `<p>${esc(o.shortDescription)}</p>` : ''}</div>`;
    }).join('') : '<p class="desk__empty">No offers in the feed right now.</p>';

    return `<h3>Directory · ${S.firms.length} firm${S.firms.length === 1 ? '' : 's'}</h3>
      ${rows}
      ${S.firms.length > firms.length ? `<p class="desk__note">Showing ${firms.length} of ${S.firms.length}.</p>` : ''}
      <h3>Offers right now · ${offers.length}</h3>
      ${offerHtml}
      <p class="desk__note">${esc((S.firmsNote || 'Directory data, not endorsement or ranking.'))}</p>`;
  }

  /* ── the curve ──────────────────────────────────────────────────────────────────────────────── */
  function drawCurve() {
    const cv = $('desk-curve');
    const cap = $('desk-curve-cap');
    if (!cv || !cap) return;
    const st = (S.account && S.account.stats) || {};
    const pts = (st.curve || []).map((p) => Number(p.equity)).filter((n) => Number.isFinite(n));
    const start = Number(st.start_cash) || 0;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(120, cv.clientWidth || 320);
    const h = Math.max(60, cv.clientHeight || 132);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const tok = (k, fb) => (css.getPropertyValue(k) || '').trim() || fb;
    const faint = tok('--lx-fg-faint', 'rgba(128,128,128,.5)');
    const line = pts.length && pts[pts.length - 1] >= start ? tok('--lx-profit', '#2ea043') : tok('--lx-loss', '#e5534b');
    const PADX = 8, PADY = 12, PADB = 12;

    const yOf = (v, lo, hi) => h - PADB - (h - PADY - PADB) * ((v - lo) / (hi - lo || 1));
    let lo = start, hi = start;
    for (const v of pts) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const spark = Math.max((hi - lo) * 0.15, 0.5);
    lo -= spark; hi += spark;

    // the baseline: starting cash, dashed — the only honest reference for "up" or "down"
    g.strokeStyle = faint; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(PADX, yOf(start, lo, hi)); g.lineTo(w - PADX, yOf(start, lo, hi)); g.stroke();
    g.setLineDash([]);

    if (pts.length) {
      const X = (i) => (pts.length === 1 ? w - PADX : PADX + (w - PADX * 2) * (i / (pts.length - 1)));
      const Y = (v) => yOf(v, lo, hi);
      g.beginPath(); g.moveTo(X(0), Y(pts[0]));
      for (let i = 1; i < pts.length; i++) g.lineTo(X(i), Y(pts[i]));
      g.lineTo(X(pts.length - 1), h - PADB); g.lineTo(X(0), h - PADB); g.closePath();
      g.globalAlpha = 0.12; g.fillStyle = line; g.fill(); g.globalAlpha = 1;
      g.beginPath(); g.moveTo(X(0), Y(pts[0]));
      for (let i = 1; i < pts.length; i++) g.lineTo(X(i), Y(pts[i]));
      g.strokeStyle = line; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
      g.beginPath(); g.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 3, 0, Math.PI * 2);
      g.fillStyle = line; g.fill();
      cap.textContent = `Realised equity after each closed trade · starts at ${money(start)} · currently ${money(pts[pts.length - 1])}`;
    } else {
      cap.textContent = `Realised equity · starts at ${money(start)} · the first closed trade puts a point here`;
    }
  }

  /* ── the sheet ──────────────────────────────────────────────────────────────────────────────── */
  function renderTabs() {
    tabsEl.innerHTML = TABS.map(([id, label]) => {
      const pend = id === 'paper' && S.account && (S.account.pending || []).length;
      return `<button type="button" class="desk__tab" role="tab" id="desk-tab-${id}" data-tab="${id}"
        aria-selected="${S.tab === id}" aria-controls="desk-body" tabindex="${S.tab === id ? '0' : '-1'}"
        >${label}${pend ? `<span class="desk__dot">${pend}</span>` : ''}</button>`;
    }).join('');
  }

  function render() {
    if (!S.open) return;
    renderTabs();
    if (subEl) subEl.textContent = SUB[S.tab] || '';
    let html;
    if (S.tab === 'propfirms') html = propHtml();
    else if (!S.account) html = S.accountErr
      ? `<p class="desk__bad">${esc(S.accountErr)}</p><p class="desk__note"><button type="button" class="desk__btn" data-retry>Try again</button></p>`
      : '<p class="desk__empty">Reading the paper account…</p>';
    else html = S.tab === 'journal' ? journalHtml(S.account) : paperHtml(S.account);
    body.innerHTML = html;
    if (S.tab === 'journal' && S.account) drawCurve();
  }

  async function pull() {
    if (S.busy) return;
    S.busy = true;
    try {
      S.account = await call('/api/broker');
      S.accountErr = null;
    } catch (err) {
      S.accountErr = `The paper account could not be read: ${err.message}`;
    } finally {
      S.busy = false;
    }
    render();
  }

  async function pullPropFirms() {
    if (S.propBusy) return;
    S.propBusy = true;
    S.propErr = null;
    render();
    try {
      const [firms, offers] = await Promise.all([
        call('/api/propfirms'),
        // A GET, like the console's other reads: POSTs are the guarded path (token + Origin) and this
        // surface only reads. It asked for 27 offers, not for permission to do anything.
        call('/api/offers?limit=20').catch(() => ({ count: 0, offers: [] })),
      ]);
      S.firms = (firms && firms.firms) || [];
      S.firmsNote = (firms && firms.note) || '';
      S.offers = (offers && offers.offers) || [];
    } catch (err) {
      S.propErr = `The directory could not be read: ${err.message}`;
    } finally {
      S.propBusy = false;
      render();
    }
  }

  function show(tab) {
    if (TABS.some(([id]) => id === tab)) S.tab = tab;
    render();
    if (S.tab === 'propfirms' && !S.propAsked) { S.propAsked = true; pullPropFirms(); }
  }

  function open(tab) {
    if (!S.open) {
      S.back = document.activeElement;
      sheet.classList.add('is-open');
      scrim.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
      S.open = true;
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('pointerdown', onAway, true);
      window.addEventListener('resize', drawCurve);
    }
    show(tab || S.tab || 'paper');
    pull();
    const sel = $('desk-tab-' + S.tab);
    if (sel) sel.focus({ preventScroll: true });
  }

  function close() {
    if (!S.open) return;
    S.open = false;
    sheet.classList.remove('is-open');
    scrim.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onAway, true);
    window.removeEventListener('resize', drawCurve);
    const back = S.back;
    S.back = null;
    if (back && back.focus) { try { back.focus({ preventScroll: true }); } catch (err) { /* gone */ } }
  }

  function onKey(ev) {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); return; }
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      const i = TABS.findIndex(([id]) => id === S.tab);
      if (i < 0) return;
      const next = (i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      ev.preventDefault();
      show(TABS[next][0]);
      const sel = $('desk-tab-' + S.tab);
      if (sel) sel.focus({ preventScroll: true });
    }
  }
  function onAway(ev) { if (!sheet.contains(ev.target)) close(); }

  /* ── wiring ─────────────────────────────────────────────────────────────────────────────────── */
  tabsEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-tab]');
    if (btn) show(btn.dataset.tab);
  });

  body.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-retry]')) {
      if (S.tab === 'propfirms') pullPropFirms(); else pull();
      return;
    }
    if (!ev.target.closest('[data-reset]')) return;
    if (!window.confirm('Reset the paper account to its starting cash? Positions, history and the journal are cleared.')) return;
    try {
      await call('/api/broker/reset', {});
      say('Paper account reset');
    } catch (err) { say(err.message, true); }
    pull();
  });

  if (closeEl) closeEl.addEventListener('click', close);
  scrim.addEventListener('click', close);

  /* The cards and the sheet read the same server: an order proposed, approved or rejected anywhere
     repaints both. The sheet only repaints while it is open — a closed sheet does no work. */
  window.addEventListener('ta-broker', () => { if (S.open) pull(); });

  window.taDesk = {
    open,
    close,
    tab: (t) => show(t),
    state: () => ({ open: S.open, tab: S.tab, closed: S.account && S.account.stats ? S.account.stats.closed : null }),
  };
})();
