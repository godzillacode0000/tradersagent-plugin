/* The chart row's right-hand menus (31 Oct): the `⋯` menu and the status popover.
 *
 * The operator asked for every control in that corner to be checked and for the ⋯ menu to look
 * like the replay capsule: one frosted-glass sheet. What the check found, and what this file does:
 *
 *  - The ⋯ menu was seven bare text rows. It is now grouped (Trade, Chart), each row has an icon,
 *    and a row says its state: "On" beside an open Data window, Object tree or a running replay,
 *    the alert count beside Alerts. ↑ ↓ Home End move, → opens Alerts, ← goes back, Esc closes.
 *  - Alerts went through Vela's openAlertsMenu(anchor), which reads anchor.getBoundingClientRect()
 *    with no guard. In a narrow pane (the Hermes default, 620 px) the ⋯ is reached from Vela's own
 *    bottom sheet, there is no anchor, and Alerts threw: nothing opened. The list is now drawn here
 *    from the same `ws.alerts` Vela keeps (newest first), and a row focuses the chart that fired it
 *    with Vela's own setActiveCell(). The empty state says where alerts come from.
 *  - The status pill said "Agent: offline · not connected". It was never the agent: it is the
 *    console's link to the LuxAlgo Library (and whether bars are live). It now says
 *    "Library offline" in two words, and a click opens a popover with both connections, what still
 *    works without the Library, and "Check again". It used to flash a toast.
 *
 * Every action still calls the method its old row called (dock.toggle, downloadScreenshot, the
 * desk, Edge Stats, replay), so nothing is re-implemented. Classic script; app.js publishes
 * window.taStatus and window.taCheckHealth, workspace.js calls window.taTopMenus.
 */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    desk: svg('<rect x="2" y="3" width="12" height="9.5" rx="1.6"/><path d="M2 6.2h12M5.5 14.5h5M8 12.5v2"/>'),
    edge: svg('<path d="M2.5 13.5h11"/><rect x="3.5" y="8" width="2" height="4" rx=".5"/><rect x="7" y="5" width="2" height="7" rx=".5"/><rect x="10.5" y="2.5" width="2" height="9.5" rx=".5"/>'),
    replay: svg('<path d="M7.5 4 3 8l4.5 4V4zM13 4 8.5 8 13 12V4z"/>'),
    alerts: svg('<path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1 1.2H3l1-1.2zM6.6 14a1.5 1.5 0 0 0 2.8 0"/>'),
    data: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.6"/><path d="M2.5 6.2h11M2.5 9.8h11M6.4 6.2v7.3"/>'),
    tree: svg('<path d="M3 3h4M5 3v9.5h3M5 7.5h3"/><rect x="8.5" y="6" width="5" height="3" rx=".8"/><rect x="8.5" y="11" width="5" height="3" rx=".8"/>'),
    shot: svg('<path d="M2.5 5.5a1 1 0 0 1 1-1h1.8l1-1.5h3.4l1 1.5h1.8a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><circle cx="8" cy="8.6" r="2.3"/>'),
    chev: svg('<path d="m6 3.5 4.5 4.5L6 12.5"/>'),
    back: svg('<path d="M10 3.5 5.5 8l4.5 4.5"/>'),
    retry: svg('<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.6h-2.6"/>'),
  };

  /* "60" → "1h", "D" → "1D": a cell's timeframe can be either a value or a label. */
  const tfLabel = (tf) => {
    const t = String(tf || '');
    if (/^\d+$/.test(t)) { const n = Number(t); return n % 60 === 0 ? n / 60 + 'h' : n + 'm'; }
    return /^[DWM]$/.test(t) ? '1' + t : t;
  };

  let current = null;   /* the open sheet's close(), so a second open replaces it cleanly */

  /* One frosted sheet, placed under its anchor (or top-right when there is none), with the
     outside-click, Esc and focus-return every popover here needs. */
  function sheet(cls, anchor, label) {
    if (current) current(false);
    const el = document.createElement('div');
    el.className = 'ta-glass ' + cls;
    el.setAttribute('role', cls === 'ta-more' ? 'menu' : 'dialog');
    el.setAttribute('aria-label', label);
    const opener = document.activeElement;
    let onKey = null;
    const away = (ev) => { if (!el.contains(ev.target) && !(anchor && anchor.contains(ev.target))) close(false); };
    const key = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(true); return; }
      if (onKey) onKey(ev);
    };
    function close(restore) {
      if (!el.isConnected) return;
      const inside = el.contains(document.activeElement);
      el.remove();
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', onResize);
      if (current === close) current = null;
      /* Esc used to drop focus on <body> (audit 8 Oct, G6): give it back to what opened the sheet. */
      if (restore && inside) {
        const back = (opener && opener !== document.body && document.contains(opener)) ? opener : anchor;
        try { if (back && back.focus) back.focus({ preventScroll: true }); } catch (err) { /* nothing to focus */ }
      }
    }
    const place = () => {
      const r = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : { right: innerWidth - 8, bottom: 40 };
      el.style.top = Math.round(r.bottom + 6) + 'px';
      el.style.right = Math.max(8, Math.round(innerWidth - r.right)) + 'px';
      el.style.maxHeight = Math.max(160, innerHeight - r.bottom - 18) + 'px';
    };
    const onResize = () => place();
    document.body.appendChild(el);
    place();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', onResize);
    current = close;
    return { el, close, setKeys: (fn) => { onKey = fn; } };
  }

  /* Arrow keys over the sheet's buttons, wrapping; the sheet's own keys come first. */
  function roving(el, ev, extra) {
    const items = Array.from(el.querySelectorAll('[data-nav]:not([disabled])'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    let next = -1;
    if (ev.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % items.length;
    else if (ev.key === 'ArrowUp') next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = items.length - 1;
    else if (extra) { extra(ev, items[i]); return; }
    if (next >= 0) { ev.preventDefault(); items[next].focus(); }
  }

  /* ------------------------------------------------------------------ the ⋯ menu */
  function openMore(anchor, ws, opts) {
    if (!ws) return null;
    if (anchor && anchor.getBoundingClientRect().width === 0) anchor = null;
    const o = opts || {};
    const replayOn = typeof o.replayOn === 'function' ? Boolean(o.replayOn()) : false;
    const dockOpen = (id) => { try { return ws.dock && ws.dock.openId === id; } catch (err) { return false; } };
    const alerts = () => { try { return Array.isArray(ws.alerts) ? ws.alerts : []; } catch (err) { return []; } };
    const toast = (t, bad) => { if (window.taToast) window.taToast(t, bad); };

    const groups = [
      ['Trade', [
        { id: 'desk', label: "Trader's desk", tip: 'Paper account, orders and the journal', icon: ICON.desk,
          go: () => { if (window.taDesk) window.taDesk.open('paper'); else if (window.taBroker) window.taBroker.open(); } },
        { id: 'edge', label: 'Edge Stats', tip: 'How a setup has really played out, by session', icon: ICON.edge,
          go: () => { if (window.edgeSheet) window.edgeSheet.open(); } },
        { id: 'replay', label: replayOn ? 'Exit replay' : 'Replay', tip: 'Practice on older bars, one at a time', icon: ICON.replay,
          on: replayOn,
          go: () => {
            if (!window.taReplay) return;
            const p = replayOn ? window.taReplay.stop() : window.taReplay.start();
            if (p && p.catch) p.catch((err) => toast(String(err.message || err), true));
          } },
      ]],
      ['Chart', [
        { id: 'alerts', label: 'Alerts', tip: 'Alerts your scripts have fired', icon: ICON.alerts, sub: true, count: alerts().length },
        { id: 'data', label: 'Data window', tip: 'Every value under the crosshair', icon: ICON.data, on: dockOpen('dataWindow'),
          go: () => ws.dock.toggle('dataWindow') },
        { id: 'tree', label: 'Object tree', tip: 'Everything drawn and plotted on the chart', icon: ICON.tree, on: dockOpen('objects'),
          go: () => ws.dock.toggle('objects') },
        { id: 'shot', label: 'Download screenshot', tip: 'A PNG of the whole layout', icon: ICON.shot,
          go: () => ws.downloadScreenshot() },
      ]],
    ];
    const byId = {};
    groups.forEach(([, items]) => items.forEach((x) => { byId[x.id] = x; }));

    const s = sheet('ta-more', anchor, 'More');
    const row = (x) => `
      <button type="button" class="ta-more__item" role="menuitem" data-nav data-id="${x.id}" title="${esc(x.tip)}"
              ${x.sub ? 'aria-haspopup="true"' : ''}>
        <span class="ta-more__ic">${x.icon}</span>
        <span class="ta-more__lbl">${esc(x.label)}</span>
        ${x.on ? '<span class="ta-more__on"><i aria-hidden="true"></i>On</span>' : ''}
        ${x.sub ? `${x.count ? `<span class="ta-more__count">${x.count}</span>` : ''}<span class="ta-more__chev">${ICON.chev}</span>` : ''}
      </button>`;

    function paintMain(focusId) {
      s.el.classList.remove('is-sub');
      s.el.innerHTML = groups.map(([name, items], gi) =>
        `${gi ? '<div class="ta-more__sep" role="separator"></div>' : ''}
         <div class="ta-more__grp" role="presentation">${name}</div>
         ${items.map(row).join('')}`).join('');
      const f = s.el.querySelector(`[data-id="${focusId || ''}"]`) || s.el.querySelector('[data-nav]');
      if (f) f.focus({ preventScroll: true });
    }

    function paintAlerts() {
      const list = alerts();
      s.el.classList.add('is-sub');
      const when = (t) => { try { return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (err) { return ''; } };
      s.el.innerHTML = `
        <div class="ta-more__head">
          <button type="button" class="ta-more__back" data-nav data-back aria-label="Back to the menu">${ICON.back}</button>
          <b>Alerts</b>${list.length ? `<span class="ta-more__count">${list.length}</span>` : ''}
        </div>
        ${list.length ? `<div class="ta-more__alerts">${list.map((a, i) => `
          <button type="button" class="ta-alert" role="menuitem" data-nav data-alert="${i}" title="Show the chart it fired on">
            <span class="ta-alert__top"><b>${esc(a.title || 'Alert')}</b><time>${esc(when(a.time))}</time></span>
            ${a.message ? `<span class="ta-alert__msg">${esc(a.message)}</span>` : ''}
            <span class="ta-alert__src">${esc(a.source || '')}</span>
          </button>`).join('')}</div>`
        : `<div class="ta-more__empty">
            <span class="ta-more__emptyic">${ICON.alerts}</span>
            <b>No alerts yet</b>
            <span>When a script on the chart fires an alert (<code>alert()</code> or <code>alertcondition()</code>),
              it lands here, newest first, and as a toast.</span>
          </div>`}`;
      const f = s.el.querySelector('[data-alert]') || s.el.querySelector('[data-back]');
      if (f) f.focus({ preventScroll: true });
    }

    s.el.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-back]')) { paintMain('alerts'); return; }
      const al = ev.target.closest('[data-alert]');
      if (al) {
        const a = alerts()[Number(al.dataset.alert)];
        s.close(false);
        try { if (a && ws.cellsById && ws.cellsById.has(a.cellId)) ws.setActiveCell(a.cellId); } catch (err) { /* the cell is gone */ }
        return;
      }
      const b = ev.target.closest('[data-id]');
      if (!b) return;
      const x = byId[b.dataset.id];
      if (!x) return;
      if (x.sub) { paintAlerts(); return; }
      s.close(false);
      try { x.go(); } catch (err) { console.warn('[menu] item failed:', x.label, err); toast(x.label + ' did not open: ' + (err.message || err), true); }
    });
    s.setKeys((ev) => roving(s.el, ev, (e, cur) => {
      if (e.key === 'ArrowRight' && cur && cur.dataset.id === 'alerts') { e.preventDefault(); paintAlerts(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && s.el.classList.contains('is-sub')) { e.preventDefault(); paintMain('alerts'); }
    }));
    paintMain();
    return s.el;
  }

  /* ------------------------------------------------------------ the status popover */
  function openStatus(anchor) {
    if (anchor && anchor.getBoundingClientRect().width === 0) anchor = null;
    const s = sheet('ta-statuspop', anchor, 'Connections');
    const paint = (busy) => {
      const st = window.taStatus || {};
      const m = st.mcp, b = st.bars;
      const tone = (x) => (!x ? 'wait' : x.ok === true ? 'ok' : x.ok === false ? 'bad' : 'wait');
      /* Plain words, not the log's: "Live · BTCUSDT 1h", "Not connected". The raw text stays in the
         row's tooltip for whoever is debugging. */
      let market = '';
      try { const c = window.__ws && window.__ws.active; if (c) market = [String(c.symbol || '').split(':').pop(), tfLabel(c.timeframe)].filter(Boolean).join(' '); } catch (err) { /* no chart yet */ }
      const barsText = !b ? 'Waiting for the first bars…'
        : b.ok === true ? 'Live' + (market ? ' · ' + market : '')
        : b.ok === false ? 'Offline — the chart is showing practice bars'
        : 'Loading…';
      const reason = m ? String(m.text || '').replace(/^Library:\s*(offline)?\s*[·—-]?\s*/i, '').trim() : '';
      const libText = !m ? 'Checking…'
        : m.ok ? 'Connected' + (reason && !/^(connected|ready)$/i.test(reason) ? ' · ' + reason : '')
        : 'Not connected' + (reason && !/^not connected$/i.test(reason) ? ' — ' + reason : '');
      const libOk = tone(m) === 'ok';
      s.el.innerHTML = `
        <div class="ta-statuspop__title">Connections</div>
        <div class="ta-conn">
          <span class="ta-conn__dot is-${tone(b)}" aria-hidden="true"></span>
          <span class="ta-conn__body"><b>Chart data</b><span>${esc(barsText)}</span></span>
        </div>
        <div class="ta-conn">
          <span class="ta-conn__dot is-${tone(m)}" aria-hidden="true"></span>
          <span class="ta-conn__body"><b>LuxAlgo Library</b><span>${esc(libText)}</span></span>
        </div>
        <p class="ta-statuspop__note">${libOk
          ? 'Library scripts, their pictures and write-ups load from LuxAlgo.'
          : 'Built-in indicators, your own Pine scripts, drawing, replay and the paper desk all work without it. Only LuxAlgo Library scripts need it.'}</p>
        <button type="button" class="ta-statuspop__retry" data-nav data-retry ${busy ? 'disabled' : ''}>
          ${ICON.retry}<span>${busy ? 'Checking…' : 'Check again'}</span></button>`;
    };
    paint(false);
    s.el.addEventListener('click', async (ev) => {
      if (!ev.target.closest('[data-retry]') || !window.taCheckHealth) return;
      paint(true);
      try { await window.taCheckHealth({ quiet: true }); } catch (err) { /* the popover shows the state */ }
      if (s.el.isConnected) { paint(false); const r = s.el.querySelector('[data-retry]'); if (r) r.focus({ preventScroll: true }); }
    });
    s.setKeys((ev) => roving(s.el, ev));
    const r = s.el.querySelector('[data-retry]');
    if (r) r.focus({ preventScroll: true });
    return s.el;
  }

  /* Vela's timeframe list does not mark the one in use; mark it, so the open list answers "where am I". */
  function markTimeframe() {
    const menu = document.querySelector('.vela-menu[aria-labelledby="vela-topbar-tf"]:not([hidden])');
    if (!menu) return;
    let tf = '';
    /* The active cell's timeframe is a label ("1h") on this Vela, a value ("60") on others: match either. */
    try { const ws = window.__ws; tf = String((ws && ws.active && ws.active.timeframe) || ''); } catch (err) { /* no chart yet */ }
    menu.querySelectorAll('.vela-menu-item').forEach((li) => {
      const lbl = li.querySelector('.vela-menu-label');
      const on = Boolean(tf) && (li.dataset.value === tf || (lbl && lbl.textContent.trim() === tf));
      li.classList.toggle('ta-is-current', on);
      if (on) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
    });
  }
  document.addEventListener('click', (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest('#vela-topbar-tf')) setTimeout(markTimeframe, 0);
  });

  const isOpen = (cls) => Boolean(document.querySelector('.ta-glass.' + cls));
  window.taTopMenus = {
    more: (anchor, ws, opts) => (isOpen('ta-more') && current ? (current(true), null) : openMore(anchor, ws, opts)),
    status: (anchor) => (isOpen('ta-statuspop') && current ? (current(true), null) : openStatus(anchor)),
    close: () => { if (current) current(true); },
    markTimeframe,
  };
})();
