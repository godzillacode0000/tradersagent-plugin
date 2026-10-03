/* Paper broker — the Approve / Reject card (Phase 5).

   The agent PROPOSES an order; this card is the only place it can be approved. Closed by default:
   nothing is on screen until an order is waiting, so the chart stays whole. The account (cash,
   positions, history) is a small popover opened from the ⋯ menu — never a permanent pane.

   Source of truth is the server (/api/broker). The card paints from it on load and again on every
   `ta-broker` event the page stream delivers, so a reload or a second tab shows the same orders. */
(function () {
  'use strict';

  const state = { pending: [], account: null, busy: new Set(), open: false };
  let stack = null;
  let panel = null;

  const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qty = (n) => String(+Number(n).toFixed(8));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function say(message, bad) {
    if (typeof window.taToast === 'function') window.taToast(message, bad);
  }

  const PATH = { approve: '/api/broker/approve', reject: '/api/broker/reject' };

  /* The page lives in an iframe, where the SameSite cookie is dropped — so the token comes over a
     same-origin GET and rides every POST as a header (same bootstrap as chart-bridge.js). */
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

  async function call(path, body) {
    const init = { cache: 'no-store' };
    if (body !== undefined) {
      const headers = { 'content-type': 'application/json' };
      const t = await token();
      if (t) headers['X-Trader-Token'] = t;
      Object.assign(init, { method: 'POST', headers, body: JSON.stringify(body) });
    }
    const res = await fetch(path, init);
    const payload = await res.json().catch(() => ({ ok: false, error: `bad JSON (HTTP ${res.status})` }));
    if (!payload.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    return payload.data;
  }

  /* ── the cards ───────────────────────────────────────────────────────────────────────────────── */
  function ensureStack() {
    if (stack) return stack;
    stack = document.createElement('div');
    stack.className = 'ta-orders';
    stack.hidden = true;
    stack.setAttribute('role', 'region');
    stack.setAttribute('aria-label', 'Orders waiting for your approval');
    stack.addEventListener('click', onCardClick);
    document.body.appendChild(stack);
    return stack;
  }

  function cardHtml(o) {
    const busy = state.busy.has(o.id);
    return `<article class="ta-order ta-order--${o.side}" data-id="${o.id}">
      <header class="ta-order__head">
        <span class="ta-order__tag">PAPER</span>
        <span class="ta-order__side">${esc(o.side)}</span>
        <strong class="ta-order__qty">${esc(qty(o.qty))} ${esc(o.symbol)}</strong>
      </header>
      ${o.note ? `<p class="ta-order__note">${esc(o.note)}</p>` : ''}
      <p class="ta-order__hint">Fills at the live price when you approve. Nothing has traded yet.</p>
      <p class="ta-order__err" role="alert" hidden></p>
      <footer class="ta-order__actions">
        <button type="button" class="ta-order__btn ta-order__btn--no" data-reject ${busy ? 'disabled' : ''}>Reject</button>
        <button type="button" class="ta-order__btn ta-order__btn--yes" data-approve ${busy ? 'disabled' : ''}>Approve</button>
      </footer>
    </article>`;
  }

  function paintCards() {
    const s = ensureStack();
    const have = new Map([...s.children].map((n) => [Number(n.dataset.id), n]));
    const want = new Set(state.pending.map((o) => o.id));
    have.forEach((node, id) => { if (!want.has(id)) node.remove(); });
    state.pending.forEach((o) => {
      const html = cardHtml(o);
      const node = have.get(o.id);
      if (!node) {
        const t = document.createElement('div');
        t.innerHTML = html;
        s.appendChild(t.firstElementChild);
      } else {                                           // keep the card (and its error) — only the buttons change
        node.querySelectorAll('button').forEach((b) => { b.disabled = state.busy.has(o.id); });
      }
    });
    s.hidden = state.pending.length === 0;
  }

  function cardError(id, message) {
    const node = stack && stack.querySelector(`[data-id="${id}"] .ta-order__err`);
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
  }

  async function decide(id, verb) {
    if (state.busy.has(id)) return;
    state.busy.add(id);
    paintCards();
    try {
      const out = await call(PATH[verb], { id });
      const o = out.order;
      if (verb === 'approve') say(`Paper ${o.side} ${qty(o.qty)} ${o.symbol} filled at ${money(o.price)}`);
      else say(`Rejected: ${o.side} ${qty(o.qty)} ${o.symbol}`);
    } catch (err) {                                      // a refused fill keeps the card and says why
      cardError(id, err.message);
      say(err.message, true);
    } finally {
      state.busy.delete(id);
      await refresh();
    }
  }

  function onCardClick(ev) {
    const btn = ev.target.closest('button');
    const card = ev.target.closest('.ta-order');
    if (!btn || !card) return;
    const id = Number(card.dataset.id);
    if (btn.hasAttribute('data-approve')) decide(id, 'approve');
    else if (btn.hasAttribute('data-reject')) decide(id, 'reject');
  }

  /* ── the account popover (opened from ⋯) ─────────────────────────────────────────────────────── */
  function accountHtml(a) {
    const pos = a.positions.length
      ? a.positions.map((p) => `<li><span>${esc(p.symbol)} <small>${esc(qty(p.qty))} @ ${money(p.avg)}</small></span>
          <b class="${p.unrealized >= 0 ? 'is-up' : 'is-down'}">${p.unrealized >= 0 ? '+' : ''}${money(p.unrealized)}</b></li>`).join('')
      : '<li class="ta-acct__none">No open positions</li>';
    const hist = a.history.slice(0, 6).map((o) => `<li><span>${esc(o.side)} ${esc(qty(o.qty))} ${esc(o.symbol)}</span>
          <small>${o.status === 'filled' ? 'at ' + money(o.price) : esc(o.status)}</small></li>`).join('');
    return `<header class="ta-acct__head"><strong>Paper account</strong><span class="ta-order__tag">PAPER</span></header>
      <dl class="ta-acct__nums">
        <div><dt>Cash</dt><dd>${money(a.cash)}</dd></div>
        <div><dt>Equity</dt><dd>${money(a.equity)}</dd></div>
        <div><dt>Realised</dt><dd class="${a.realized >= 0 ? 'is-up' : 'is-down'}">${a.realized >= 0 ? '+' : ''}${money(a.realized)}</dd></div>
      </dl>
      <h4>Positions</h4><ul class="ta-acct__list">${pos}</ul>
      ${hist ? `<h4>Recent</h4><ul class="ta-acct__list">${hist}</ul>` : ''}
      <footer class="ta-acct__foot">
        <small>Simulated Binance spot · 0.1% fee · start ${money(a.start_cash)}</small>
        <button type="button" class="ta-order__btn ta-order__btn--no" data-reset>Reset</button>
      </footer>`;
  }

  function closePanel() {
    if (panel) { panel.remove(); panel = null; }
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', key, true);
    state.open = false;
  }
  function away(ev) { if (panel && !panel.contains(ev.target)) closePanel(); }
  function key(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); closePanel(); } }

  function paintPanel() {
    if (!panel || !state.account) return;
    panel.innerHTML = accountHtml(state.account);
  }

  async function open() {
    if (panel) { closePanel(); return; }
    await refresh();
    if (!state.account) return;
    panel = document.createElement('div');
    panel.className = 'ta-acct';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Paper account');
    panel.addEventListener('click', async (ev) => {
      if (!ev.target.closest('[data-reset]')) return;
      if (!window.confirm('Reset the paper account to its starting cash? Positions and history are cleared.')) return;
      try { await call('/api/broker/reset', {}); say('Paper account reset'); } catch (err) { say(err.message, true); }
      await refresh();
    });
    document.body.appendChild(panel);
    paintPanel();
    state.open = true;
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
  }

  /* ── sync ────────────────────────────────────────────────────────────────────────────────────── */
  async function refresh() {
    try {
      const a = await call('/api/broker');
      state.account = a;
      state.pending = a.pending || [];
      paintCards();
      paintPanel();
    } catch (err) {
      /* server down: leave the cards as they are — a stale card still can't fill without the server */
    }
  }

  window.addEventListener('ta-broker', (ev) => {
    const d = ev.detail || {};
    if (d.event === 'proposed' && d.order) say(`Order waiting: ${d.order.side} ${qty(d.order.qty)} ${d.order.symbol}`);
    refresh();
  });

  window.taBroker = { open, refresh, state: () => ({ pending: state.pending.length, open: state.open }) };
  refresh();
})();
