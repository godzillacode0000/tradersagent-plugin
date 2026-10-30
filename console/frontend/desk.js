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
    ['data', 'Data'],
  ];
  const SUB = {
    paper: 'Binance spot · simulated · every fill waits for your approval',
    journal: 'closed trades only — what the account actually did',
    propfirms: 'the directory and what is on offer — data, not a ranking',
    data: 'where the bars come from — the local tick store first, nothing substituted',
  };
  const FIRMS_SHOWN = 30;                       // long lists slow this machine down; the count says what is cut

  const S = {
    tab: 'paper', open: false, busy: false,
    account: null, accountErr: null,
    firms: null, offers: null, propErr: null, propBusy: false, propAsked: false, firmsNote: '',
    data: { status: null, err: null, busy: false, asked: false },
    sim: {                                        // the prop-firm simulator (19 Oct)
      stats: { winrate: 48, avg_win: 1.6, avg_loss: 1, risk: 1, trades_per_day: 4, paths: 10000, seed: 42 },
      status: null, busy: false, err: null, result: null, target: null,
    },
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
  const pct1 = (v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
  const ci = (pair) => (pair && pair.low != null ? `95% CI ${pct1(pair.low)}–${pct1(pair.high)}` : '');
  const money0 = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

  function simFormHtml() {
    const st = S.sim.status;
    if (st && !st.installed) {
      return `<p class="desk__bad">${esc(st.problem === 'no_node' || st.problem === 'old_node'
        ? 'The simulator needs Node.js 20 or newer.'
        : 'The prop-firm simulator is not installed yet.')}</p>
        <p class="desk__note">${esc(st.fix || 'run ./install.sh --with-prop')}</p>`;
    }
    const s = S.sim.stats;
    const field = (key, label, step) =>
      `<label class="desk__field"><span>${label}</span>
         <input type="number" step="${step}" value="${s[key]}" data-simstat="${key}" /></label>`;
    return `<div class="desk__form">
        ${field('winrate', 'Win rate %', '0.1')}${field('avg_win', 'Avg win (R)', '0.1')}
        ${field('avg_loss', 'Avg loss (R)', '0.1')}${field('risk', 'Risk %/trade', '0.1')}
        ${field('trades_per_day', 'Trades/day', '0.5')}${field('paths', 'Paths', '500')}
        ${field('seed', 'Seed', '1')}
      </div>
      <p class="desk__note">Press <b>▶ Simulate</b> on any challenge below — the engine plays
        ${esc(String(s.paths))} journeys through that firm's exact ruleset. Every number
        comes from LuxAlgo's engine; the card carries its assumptions.</p>`;
  }

  function verdictHtml() {
    const sim = S.sim;
    if (sim.err) return `<p class="desk__bad">${esc(sim.err)}</p>`;
    if (sim.busy) return `<p class="desk__empty">Playing ${esc(String(sim.stats.paths))} journeys through
      ${esc(sim.target ? sim.target.label : 'the challenge')}… (about a second)</p>`;
    const r = sim.result && sim.result.result;
    if (!r) return '';
    const a = r.perAttempt || {}, j = r.journey || {}, f = r.funded || {}, ev = r.ev || {};
    const specSteps = (r.assumptions && r.assumptions.spec && r.assumptions.spec.steps) || [];
    const failsOf = (breakdown) => esc(Object.entries(breakdown || {}).filter(([, n]) => n)
      .map(([k, n]) => k + ' ' + money0(n)).join(' · ') || '—');
    const steps = (a.steps || []).map((step) => {
      const idx = Number(step.index || 0);
      const meta = specSteps[idx] || {};
      const name = meta.name || `Step ${idx + 1}`;
      const target = meta.profitTargetPct != null ? ` · +${meta.profitTargetPct}%` : '';
      const minDays = meta.minTradingDays != null ? ` · min ${meta.minTradingDays}d` : '';
      return `<li class="desk__row">
        <span>${esc(name)}${esc(target)}
          <small>${money0(step.reached)} reached${esc(minDays)} · fails ${failsOf(step.failureBreakdown)}</small></span>
        <b>${pct1(step.passProbability)}</b></li>`;
    }).join('');
    const fails = Object.entries(a.failureBreakdown || {}).filter(([, n]) => n)
      .map(([k, n]) => `${esc(k)} ${money0(n)}`).join(' · ') || '—';
    const t = sim.target || {};
    return `<div class="desk__verdict">
        <header class="desk__row"><span><b>${esc(t.label || '')}</b>
          <small>${esc(r.assumptions && r.assumptions.spec ? (r.assumptions.spec.productType || '') : '')}
          · engine ${esc(String(r.engineVersion || ''))} · ${esc(String((r.meta || {}).paths || sim.stats.paths))} paths · seed ${esc(String((r.meta || {}).seed ?? sim.stats.seed))}</small></span>
          <b class="${(a.passProbability || 0) >= 0.5 ? 'is-up' : 'is-down'}">${pct1(a.passProbability)}</b></header>
        <p class="desk__note">Pass probability per attempt · ${ci(a.passProbabilityCi)} · avg
          ${Number(a.avgDaysWhenPassed || 0).toFixed(1)} days when passed. Failures: ${fails}.</p>
        ${steps ? `<ul class="desk__rows">${steps}</ul>` : ''}
        <ul class="desk__rows">
          <li class="desk__row"><span>Funded within ${esc(String(j.attemptCap || 25))} attempts <small>mean</small></span>
            <b>${pct1(j.fundedProbability)}</b></li>
          <li class="desk__row"><span>Attempts until funded <small>mean ${Number((j.attempts || {}).mean || 0).toFixed(2)} · p90 ${(j.attempts || {}).p90 ?? '—'}</small></span>
            <b>${(j.attempts || {}).p50 ?? '—'}</b></li>
          <li class="desk__row"><span>Total cost <small>mean ${money0((j.cost || {}).mean)} · p95 ${money0((j.cost || {}).p95)}</small></span>
            <b>${money0((j.cost || {}).p50)}</b></li>
          <li class="desk__row"><span>Days to funded <small>p50</small></span>
            <b>${(j.daysToFunded || {}).p50 ?? '—'}</b></li>
          <li class="desk__row"><span>Payout if funded <small>p50 of ${Number(f.horizonTradingDays || 90)} funded days</small></span>
            <b class="is-up">${money0((f.payoutTotal || {}).p50)}</b></li>
          <li class="desk__row"><span>Payout probability · blown <small>P(EV &gt; 0) ${pct1(ev.pPositive)}</small></span>
            <b>${pct1(f.payoutProbability)} · ${pct1(f.blownProbability)}</b></li>
          <li class="desk__row"><span>EV total <small>± ${money0(ev.evStandardError)} (95% CI)</small></span>
            <b class="${(ev.evTotal || 0) >= 0 ? 'is-up' : 'is-down'}">${money0(ev.evTotal)}</b></li>
        </ul>
        <p class="desk__note">${esc((r.assumptions || {}).disclaimer || '')}</p>
        ${(r.assumptions && (r.assumptions.flags || []).length)
          ? `<details class="desk__more"><summary>${r.assumptions.flags.length} simplification flag(s) the engine lists</summary>
             <ul>${r.assumptions.flags.map((fl) => `<li>${esc(String(fl))}</li>`).join('')}</ul></details>` : ''}
        <p class="desk__note">Simulated locally in ${esc(String(sim.result.elapsed_ms))} ms${sim.result.cached ? ' (cached)' : ''}.</p>
      </div>`;
  }

  function propHtml() {
    if (S.propBusy && !S.firms) return '<p class="desk__empty">Reading the directory…</p>';
    if (S.propErr && !S.firms) return `<p class="desk__bad">${esc(S.propErr)}</p><p class="desk__note"><button type="button" class="desk__btn" data-retry>Try again</button></p>`;
    if (!S.firms) return '<p class="desk__empty">Reading the directory…</p>';

    const firms = S.firms.slice(0, FIRMS_SHOWN);
    const rows = firms.length ? firms.map((f) => {
      const chips = (f.challenges || []).slice(0, 6).map((c) => {
        // The size label usually carries its own symbol ("$100,000"); printing the ISO code again reads
        // as a mistake. Only the labels that do not carry one get the code. Each chip is also the
        // Simulate button for that challenge (19 Oct): the engine's verdict is one press away.
        const cur = /[$€£¥]/.test(String(c.sizeLabel || '')) ? '' : (c.currency || '');
        const label = `${f.name} · ${c.sizeLabel || c.name || c.id}`;
        const off = S.sim.busy && S.sim.target && S.sim.target.challenge === c.id;
        return `<button type="button" class="desk__chip desk__chip--go${off ? ' is-off' : ''}"${off ? ' disabled' : ''}
           data-sim="${esc(f.slug)}" data-challenge="${esc(c.id)}" data-label="${esc(label)}"
           title="Simulate this challenge through the firm's exact ruleset">▶ <b>${esc(c.sizeLabel || c.name || c.id)}</b>${c.price ? ' · ' + esc(cur) + money(c.price) : ''}</button>`;
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

    return `<h3>Simulator</h3>
      ${simFormHtml()}
      ${verdictHtml()}
      <h3>Directory · ${S.firms.length} firm${S.firms.length === 1 ? '' : 's'}</h3>
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

  /* ── the data card: what actually feeds the chart ─────────────────────────────────────────── */
  const int = (n) => (Number(n) || 0).toLocaleString('en-US');
  const size = (b) => {
    const n = Number(b) || 0;
    return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
  };

  function dataHtml() {
    const d = S.data;
    if (d.err) return `<p class="desk__bad">${esc(d.err)}</p>`;
    const st = (d.status && d.status.ticks) || null;
    if (!st) return '<p class="desk__empty">Reading the tick store…</p>';
    const rows = Object.entries(st.symbols || {}).sort((a, b) => a[0].localeCompare(b[0]));
    if (!rows.length) return '<p class="desk__empty">No ticks on disk yet. Run: python3 tools/fx-fetch.py --years 2</p>';
    return `
      <p class="desk__note"><b>Dukascopy ticks</b> on disk · ${int(st.hours)} instrument-hours · ${size(st.bytes)} ·
        mid-price bars with real volume and median spread · <b>Yahoo off</b>, nothing substituted</p>
      <table class="desk__table">
        <thead><tr><th scope="col">Symbol</th><th scope="col">Hours</th><th scope="col">From</th>
          <th scope="col">To</th><th scope="col">Size</th></tr></thead>
        <tbody>${rows.map(([sym, v]) => `<tr><td>${esc(sym)}</td><td>${int(v.hours)}</td>
          <td>${esc(v.from)}</td><td>${esc(v.to)}</td><td>${size(v.bytes)}</td></tr>`).join('')}</tbody>
      </table>`;
  }

  async function pullData() {
    if (S.data.busy) return;
    S.data.busy = true;
    S.data.err = null;
    render();
    try {
      S.data.status = await call('/api/fx/status');
    } catch (err) {
      S.data.err = `The tick store could not be read: ${err.message}`;
    } finally {
      S.data.busy = false;
      render();
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
    else if (S.tab === 'data') html = dataHtml();
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
    if (!S.sim.status) {
      try {
        S.sim.status = await call('/api/propfirmsim/status');
      } catch (err) {
        S.sim.status = { installed: false, problem: 'unreachable', fix: String(err.message || err) };
      }
    }
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

  /* ── the simulator run (19 Oct) ───────────────────────────────────────────────────────────────── */
  function readSimStats() {
    const inputs = document.querySelectorAll('[data-simstat]');
    inputs.forEach((el) => {
      const key = el.getAttribute('data-simstat');
      const value = Number(el.value);
      if (Number.isFinite(value) && el.value !== '') S.sim.stats[key] = value;
    });
    return S.sim.stats;
  }

  async function runSim(firm, challenge, label) {
    if (S.sim.busy) return;
    const s = readSimStats();
    S.sim.busy = true;
    S.sim.err = null;
    S.sim.result = null;
    S.sim.target = { firm, challenge, label };
    render();
    const qs = new URLSearchParams({
      firm, challenge,
      winrate: String(s.winrate / 100),                  // the form is percent; the engine wants a fraction
      avg_win: String(s.avg_win), avg_loss: String(s.avg_loss),
      trades_per_day: String(s.trades_per_day), risk: String(s.risk),
      paths: String(Math.round(s.paths)), seed: String(s.seed),
    });
    try {
      S.sim.result = await call('/api/propfirmsim/simulate?' + qs.toString());
    } catch (err) {
      S.sim.err = String(err.message || err);
    } finally {
      S.sim.busy = false;
      render();
      const card = document.querySelector('.desk__verdict');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
    }
  }

  function show(tab) {
    if (TABS.some(([id]) => id === tab)) S.tab = tab;
    render();
    if (S.tab === 'propfirms' && !S.propAsked) { S.propAsked = true; pullPropFirms(); }
    if (S.tab === 'data' && !S.data.asked) { S.data.asked = true; pullData(); }
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
    const simBtn = ev.target.closest('[data-sim]');
    if (simBtn) {
      runSim(simBtn.dataset.sim, simBtn.dataset.challenge, simBtn.dataset.label || '');
      return;
    }
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
