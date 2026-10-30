/* The Strategy tester (19 Oct 2026).
 *
 * LuxAlgo rebuilt their broker emulator on an intrabar model (Vela 0.8.5 / vela-pinets 0.2.17 /
 * PineTS 0.12.0) — fills and exits are resolved inside the bar, with commission, slippage, margin
 * and trailing stops, instead of "the close of the signal bar". A strategy() script therefore
 * returns a real ledger: round trips with entry/exit fills, per-trade commission and excursions,
 * plus gross profit/loss and a drawdown measured on the equity path.
 *
 * This strip is the reader for that ledger — the same five numbers Vela's own tester shows
 * (NET PROFIT · TRADES · WIN RATE · MAX DRAWDOWN · PROFIT FACTOR), a curve of the closed-trade
 * equity, and the round trips themselves. It computes only what the engine does not hand over
 * (profit factor, win rate, the cumulative curve) and prints `—` for a rate with no sample and
 * `∞` for a profit factor with no losing trade — missing data must look missing.
 *
 * It is a reader, like the desk sheet: the only writes are "expand" and "close". No door out.
 */
(function () {
  'use strict';

  /* Every engine- or script-sourced string goes through here before it touches innerHTML.
     `strategy("…")` is written by whoever authored the script — a Library paste, a shared file, an
     agent — so it is untrusted text. Measured 20 Oct: a title of `Breakout <img src=x onerror=…>`
     executed in the console's origin, where the paper-broker approve door lives. desk.js escaped
     every field from day one; this file was the sink that forgot. */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const money = (v, cur) => {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    const sign = n < 0 ? '−' : '';
    return sign + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) +
      (cur && cur !== 'NONE' ? ' ' + esc(cur) : '');
  };
  const compact = (v) => {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Number(v), a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };
  const pct = (v, d) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d == null ? 2 : d) + '%');
  const when = (t) => {
    if (t == null) return '—';
    const n = Number(t);
    if (!Number.isFinite(n)) return String(t);
    return new Date(n).toISOString().replace('T', ' ').slice(0, 16);
  };

  /** The engine's ledger → the five numbers a tester shows, plus what each one is missing. */
  function read(st) {
    const trades = Array.isArray(st.trades) ? st.trades : [];
    const wins = Number(st.wintrades) || 0;
    const losses = Number(st.losstrades) || 0;
    const decided = wins + losses;
    /* The worker engine reports the round trips but not the account totals (a smaller postMessage),
       so gross/loss come from the ledger when the engine did not hand them over — and the note says
       which, because "profit factor 13.57" means something different if a position is still open. */
    const book = trades.reduce((acc, t) => {
      const p = Number(t.profit);
      if (Number.isFinite(p)) { if (p >= 0) acc.up += p; else acc.down += p; }
      const c = Number(t.commission);
      if (Number.isFinite(c)) acc.fees += c;
      return acc;
    }, { up: 0, down: 0, fees: 0 });
    const engineGross = Number(st.grossprofit), engineLoss = Number(st.grossloss);
    const fromEngine = Number.isFinite(engineGross) && Number.isFinite(engineLoss);
    const gross = fromEngine ? engineGross : (trades.length ? book.up : null);
    const loss = fromEngine ? engineLoss : (trades.length ? book.down : null);
    let pf = null;
    if (gross != null && loss != null) {
      /* PineTS reports `grossloss` as a POSITIVE magnitude, while a ledger sum is negative — so the
         denominator is |loss| either way. Reading only `loss < 0` made a 6-loss strategy print
         "∞" (measured 20 Oct on the NY-AM strategy: gross 144.07 / loss 62.62 → PF 2.30). */
      const denom = Math.abs(loss);
      if (denom > 0) pf = gross / denom;
      else if (gross > 0) pf = Infinity;          // no losing trade: not a number, a fact
    }
    const closed = Array.isArray(st.trades) ? trades.length : (Number(st.closedtrades) || 0);
    return {
      net: st.netprofit, closed, wins, losses, decided,
      winRate: decided ? (wins / decided) * 100 : null,
      pf, pfFrom: fromEngine ? 'engine' : 'ledger', gross, loss,
      dd: st.max_drawdown, ddp: st.max_drawdown_pct, runup: st.max_runup,
      equity: st.equity, initial: st.initial_capital, currency: st.currency || '',
      open: st.open_trades || 0, trades,
      commission: (st.commission && st.commission.value != null) ? st.commission : null,
      feesPaid: book.fees,
    };
  }

  /** Cumulative closed-trade P&L: the honest curve of what the emulator booked (it is a ledger,
   *  not an intra-bar equity path — say so in the caption rather than imply more). */
  function curve(m) {
    const pts = [];
    let sum = 0;
    m.trades.forEach((t, i) => {
      const p = Number(t.profit);
      if (!Number.isFinite(p)) return;
      sum += p;
      pts.push({ x: Number(t.exit_time) || i, y: sum });
    });
    return pts;
  }

  function spark(pts, colour) {
    const c = document.createElement('canvas');
    c.className = 'tester__canvas';
    c.width = 220; c.height = 40;
    const g = c.getContext('2d');
    if (!g) return c;
    g.clearRect(0, 0, c.width, c.height);
    if (pts.length < 2) return c;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
    const y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys);
    const X = (x) => 2 + ((x - x0) / (x1 - x0 || 1)) * (c.width - 4);
    const Y = (y) => c.height - 3 - ((y - y0) / (y1 - y0 || 1)) * (c.height - 6);
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(2, Y(0)); g.lineTo(c.width - 2, Y(0)); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = colour;
    g.lineWidth = 1.5;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
    g.stroke();
    return c;
  }

  let root = null;
  let open = false;
  let current = null;

  function ensure() {
    if (root && document.body.contains(root)) return root;
    root = document.createElement('section');
    root.className = 'tester';
    root.setAttribute('aria-label', 'Strategy tester');
    root.hidden = true;
    document.body.appendChild(root);
    root.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-tester-close]')) { hide(); return; }
      if (ev.target.closest('[data-tester-more]')) { open = !open; render(); }
    });
    return root;
  }

  function render() {
    if (!root) return;
    const st = current;
    if (!st) { root.hidden = true; return; }
    const m = read(st);
    /* What the declaration said, or — when the worker's summary dropped the config — what the fills
       actually paid. Never "none" for a run that paid commission. */
    const cfg = m.commission
      ? (m.commission.type === 'percent' ? m.commission.value + '%' : m.commission.type + ' ' + m.commission.value)
      : (m.feesPaid > 0 ? money(m.feesPaid, m.currency) + ' paid (from the fills)' : 'none');
    const up = (m.net || 0) >= 0;
    const colour = up ? 'var(--up, #2ecc71)' : 'var(--down, #ff5c5c)';
    const rows = m.trades.map((t, i) => {
      const side = Number(t.size) < 0 || /short/i.test(String(t.entry_id || '')) ? 'short' : 'long';
      const p = Number(t.profit);
      return `<tr>
        <td>${i + 1}</td>
        <td class="tester__side tester__side--${side}">${side}</td>
        <td>${compact(Math.abs(Number(t.size)))}</td>
        <td>${when(t.entry_time)} @ ${compact(t.entry_price)}</td>
        <td>${t.exit_time != null ? when(t.exit_time) + ' @ ' + compact(t.exit_price) : 'open'}</td>
        <td>${money(t.commission, m.currency)}</td>
        <td class="${Number.isFinite(p) ? (p >= 0 ? 'is-up' : 'is-down') : ''}">${Number.isFinite(p) ? money(p, m.currency) : '—'}</td>
        <td class="tester__dim">${t.max_drawdown != null ? money(-Math.abs(Number(t.max_drawdown)), m.currency) : '—'} / ${t.max_runup != null ? money(Number(t.max_runup), m.currency) : '—'}</td>
      </tr>`;
    }).join('');

    root.hidden = false;
    root.innerHTML = `
      <div class="tester__bar">
        <div class="tester__name" title="${esc(st.title || 'strategy')}">
          <span class="tester__dot" style="background:${colour}"></span>
          <b>${esc(st.title || 'strategy')}</b>
          <small>intrabar fills</small>
        </div>
        <dl class="tester__stats">
          <div><dt>Net profit</dt><dd class="${up ? 'is-up' : 'is-down'}">${money(m.net, m.currency)}</dd></div>
          <div><dt>Trades</dt><dd>${m.closed}${m.open ? ' <small>+' + m.open + ' open</small>' : ''}</dd></div>
          <div><dt>Win rate</dt><dd>${m.winRate == null ? '—' : pct(m.winRate, 1)} <small>${m.decided ? 'n=' + m.decided : 'no sample'}</small></dd></div>
          <div><dt>Max drawdown</dt><dd class="is-down">${m.dd == null ? '—' : money(Math.abs(m.dd), m.currency)} <small>${m.ddp == null ? '' : pct(m.ddp)}</small></dd></div>
          <div><dt>Profit factor</dt><dd>${m.pf == null ? '—' : (m.pf === Infinity ? '∞' : m.pf.toFixed(2))}</dd></div>
        </dl>
        <div class="tester__spark" aria-hidden="true"></div>
        <div class="tester__acts">
          <button type="button" class="tester__more" data-tester-more>${open ? 'Hide trades' : 'Trades'}</button>
          <button type="button" class="tester__x" data-tester-close aria-label="Close the tester">×</button>
        </div>
      </div>
      <p class="tester__foot">Broker emulator: fills and exits resolved inside the bar, commission ${cfg}${
        st.slippage != null ? ', slippage ' + st.slippage : ''}${st.margin_long != null ? ', margin ' + st.margin_long + '%/' + st.margin_short + '%' : ''
      } · ${st.currency || 'USD'} · curve is cumulative closed-trade P&amp;L, not an intra-bar equity path.</p>
      ${open ? `<div class="tester__sheet">
        <table class="tester__table">
          <thead><tr><th>#</th><th>side</th><th>qty</th><th>entry</th><th>exit</th><th>commission</th><th>P&amp;L</th><th>excursion (DD / runup)</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8">no round trips — the script never closed a position</td></tr>'}</tbody>
        </table>
        <p class="tester__note">${m.closed} closed${m.open ? ' · ' + m.open + ' still open' : ''} · gross ${money(m.gross, m.currency)} / loss ${money(m.loss, m.currency)}${m.pfFrom === 'ledger' ? ' (from the closed trades)' : ''} · final equity ${money(m.equity, m.currency)} from ${money(m.initial, m.currency)}. Every row is the engine's own ledger.</p>
      </div>` : ''}`;
    const host = root.querySelector('.tester__spark');
    if (host) host.appendChild(spark(curve(m), up ? '#2ecc71' : '#ff5c5c'));
  }

  function show(st) {
    if (!st || typeof st !== 'object') return;
    current = st;
    open = false;
    ensure();
    render();
  }
  function hide() {
    current = null;
    if (root) root.hidden = true;
  }

  window.TraderTester = { show, hide, read };
})();
