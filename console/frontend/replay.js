/* Replay — Vela's own replay engine behind one control strip (Phase 6, 3 Oct; restyled 4 Oct).

   The operator's calls: the strip lives IN the chart ("jalur kawalan dalam chart") and is started
   from the replay button in Vela's own row (◀◀) or the ⋯ menu's fallback row; the chart stays whole
   otherwise — nothing is on screen until replay is on.
   On 4 Oct he pointed at Vela's v0.8.0 "Bar replay" release graphic — "Amend replay button to look
   like this" — and the strip took that composition: ⏮ Start bar · ▶ · ⏭ | 1× ⌄ | the cursor time |
   N bars left | ✕, with a scrubber over the row. Asked for the rest of the graphic ("Nak"): the
   timestamp opens a CALENDAR (month nav + day grid, a date/time footer) that seeks to a picked day,
   and the row carries a drag handle (⠿) so the strip can be moved out of the way — the spot
   persists across reloads. Vela ships the ENGINE and no such strip (no "Start bar" string anywhere
   in the vendored dist), so the design is ours to paint; the glyphs are inline SVGs because the row
   is rebuilt from a string.
   While replay is on, every paper fill uses the REPLAY cursor price: this file pushes it to the
   server (/api/broker/replay — page-only, the agent cannot set it) and the broker reads it back at
   approval. That is what makes replay practice an honest manual backtest.

   Vela's engine does the actual rewinding (`ws.replay`: start / step / play / pause / stop); this
   file only paints the strip, forwards the buttons, and keeps the server's replay price in step.
   Updates arrive as `ta-replay` (chart-bridge re-dispatches Vela's own replay:* bus), and the strip
   reads `ws.replay.state` after every action of its own. */
(function () {
  'use strict';

  const SPEEDS = [0.5, 1, 2, 4];          // multiples of 1 bar / second
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const state = { active: false, playing: false, cursorTime: null, remaining: 0 };
  let speed = 1;
  let origin = null;                      // the earliest cursor of this replay — where "Start bar" lands
  let el = null, label = null, left = null, playBtn = null, speedBtn = null, speedText = null;
  let timeBtn = null, dragBtn = null, dragPos = null;
  let range = null, startLabel = null, endLabel = null, speedsMenu = null;
  let calPop = null, calMonth = null, calTitle = null, calGrid = null, calDate = null, calTime = null;
  let lastPush = '';
  let queued = false;

  const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const fmtDay = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric' });
  const fmtClock = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

  /* The row is built from a string, so the glyphs ride in it — Vela's icon registry paints ITS row,
     not ours. Shapes follow the release graphic: a 2×3 dot grip, skip-to-start (bar + left
     triangle), play, pause, skip-forward (right triangle + bar), month chevrons, a chevron on the
     speed control, a thin ✕. */
  const GLYPH = {
    grip: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.6" cy="4" r="1.15"/><circle cx="10.4" cy="4" r="1.15"/><circle cx="5.6" cy="8" r="1.15"/><circle cx="10.4" cy="8" r="1.15"/><circle cx="5.6" cy="12" r="1.15"/><circle cx="10.4" cy="12" r="1.15"/></svg>',
    start: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 3h1.5v10H3.4zM12.6 3.4v9.2L6.2 8z"/></svg>',
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.8 3.2v9.6L12.6 8z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.4 3.2h2.5v9.6H4.4zM9.1 3.2h2.5v9.6H9.1z"/></svg>',
    step: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.1 3h1.5v10h-1.5zM3.4 3.4v9.2L9.8 8z"/></svg>',
    chev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.4 6.4 8 10l3.6-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.8 3.8 5.6 8l4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 3.8 10.4 8l-4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.3 4.3l7.4 7.4M11.7 4.3l-7.4 7.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };

  function engine() {
    const ws = (window.__wsApp || {}).ws;
    return (ws && ws.replay) || null;
  }

  /* The token bootstrap broker.js uses: the page lives in an iframe where the SameSite cookie is
     dropped, so every POST carries X-Trader-Token from /api/session. */
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

  async function post(path, body) {
    const headers = { 'content-type': 'application/json' };
    const t = await token();
    if (t) headers['X-Trader-Token'] = t;
    const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
    const payload = await res.json().catch(() => ({ ok: false, error: `bad JSON (HTTP ${res.status})` }));
    if (!payload.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    return payload.data;
  }

  /* The price a fill at the cursor would use: the close of the last bar the replay has revealed.
     chartBars() carries the loaded history (hidden bars included while replaying), so the cursor
     time picks the bar — never simply the last row of the array. */
  const barT = (b) => { const t = b && (b.time != null ? b.time : b.openTime); return typeof t === 'number' ? (t > 1e12 ? t : t * 1000) : null; };
  const barC = (b) => { const c = b && (b.close != null ? b.close : b.c); return typeof c === 'number' ? c : null; };
  async function priceAtCursor(ms) {
    try {
      if (typeof window.chartBars !== 'function' || ms == null) return null;
      const bars = await window.chartBars();
      let px = null;
      for (const b of bars || []) {
        const t = barT(b);
        if (t == null) continue;
        if (t > ms) break;
        const c = barC(b);
        if (c != null) px = c;
      }
      return px;
    } catch (err) { return null; }
  }

  /* Keep the server's replay price in step. Only a CHANGE is posted; while replay is off one final
     {active:false} clears whatever was left over (a reload mid-replay, a killed page). */
  async function push(px) {
    if (state.active && px == null) return;              // nothing to price the fills with yet
    let sym = null;
    try { const m = typeof window.chartMarket === 'function' ? window.chartMarket() : null; sym = (m && m.symbol) || null; } catch (err) { sym = null; }
    const body = { active: !!state.active, price: state.active ? px : null, time: state.active ? state.cursorTime : null, symbol: state.active ? sym : null };
    const key = JSON.stringify(body);
    if (key === lastPush) return;
    try { await post('/api/broker/replay', body); lastPush = key; }
    catch (err) { lastPush = ''; /* retry on the next update */ }
  }

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'ta-replay';
    el.hidden = true;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Replay controls');
    el.innerHTML = `
      <div class="ta-replay__scrub">
        <input type="range" class="ta-replay__range" data-scrub min="0" max="1" step="1" aria-label="Replay position">
        <div class="ta-replay__ends"><span class="ta-replay__end" data-start-time>—</span><span class="ta-replay__end" data-end-time>—</span></div>
      </div>
      <div class="ta-replay__row">
        <button type="button" class="ta-replay__drag" data-drag title="Drag the strip out of the way"
          aria-label="Drag the strip">${GLYPH.grip}</button>
        <button type="button" class="ta-replay__btn ta-replay__btn--start" data-act="start"
          title="Back to the bar this replay started on">${GLYPH.start}<span>Start bar</span></button>
        <button type="button" class="ta-replay__btn" data-act="play" title="Play / pause">${GLYPH.play}</button>
        <button type="button" class="ta-replay__btn" data-act="step" title="Reveal the next bar">${GLYPH.step}</button>
        <span class="ta-replay__sep" aria-hidden="true"></span>
        <button type="button" class="ta-replay__btn ta-replay__btn--speed" data-act="speed"
          title="Playback speed" aria-haspopup="menu"><span data-speed>1×</span>${GLYPH.chev}</button>
        <span class="ta-replay__sep" aria-hidden="true"></span>
        <button type="button" class="ta-replay__btn ta-replay__btn--time" data-act="time"
          title="Jump to a date"><span class="ta-replay__label" data-label>—</span></button>
        <span class="ta-replay__left" data-left></span>
        <button type="button" class="ta-replay__btn ta-replay__btn--x" data-act="exit" title="Leave replay">${GLYPH.close}</button>
      </div>`;
    el.addEventListener('click', onClick);
    range = el.querySelector('[data-scrub]');
    range.addEventListener('change', onSeek);
    dragBtn = el.querySelector('[data-drag]');
    dragBtn.addEventListener('pointerdown', onDragDown);
    document.body.appendChild(el);
    label = el.querySelector('[data-label]');
    left = el.querySelector('[data-left]');
    playBtn = el.querySelector('[data-act="play"]');
    speedBtn = el.querySelector('[data-act="speed"]');
    speedText = el.querySelector('[data-speed]');
    timeBtn = el.querySelector('[data-act="time"]');
    startLabel = el.querySelector('[data-start-time]');
    endLabel = el.querySelector('[data-end-time]');
    /* A dragged spot persists; clamp it to what the window can show (the pane can be smaller). */
    try {
      const p = JSON.parse(localStorage.getItem('ta-replay-pos') || 'null');
      if (p && isFinite(p.x) && isFinite(p.y)) {
        el.classList.add('ta-replay--free');
        el.style.left = Math.max(4, Math.min(window.innerWidth - 120, p.x)) + 'px';
        el.style.top = Math.max(4, Math.min(window.innerHeight - 40, p.y)) + 'px';
      }
    } catch (err) { /* no saved spot */ }
    return el;
  }

  /* The scrubber spans `replay.bounds` — what a replay can start from — with the cursor marked on
     it. The filled part rides a CSS variable: a range input's track cannot be styled from its
     value, so the percentage is computed here and painted by the rule. */
  function syncScrub(r) {
    let b = null;
    try { b = (r && r.bounds) || null; } catch (err) { b = null; }
    if (!b || b.first == null || b.last == null || b.last <= b.first) { el.classList.add('ta-replay--flat'); return; }
    el.classList.remove('ta-replay--flat');
    range.min = String(b.first);
    range.max = String(b.last);
    const at = state.cursorTime != null ? state.cursorTime : b.last;
    if (document.activeElement !== range) range.value = String(at);
    const pct = Math.max(0, Math.min(100, ((at - b.first) / (b.last - b.first)) * 100));
    range.style.setProperty('--ta-fill', pct.toFixed(1) + '%');
    startLabel.textContent = fmtTime(b.first);
    endLabel.textContent = fmtTime(b.last);
  }

  async function sync() {
    const r = engine();
    if (!r) return;
    try { Object.assign(state, r.state || {}); } catch (err) { /* older engine: keep the last read */ }
    ensure();
    if (!state.active) {
      el.hidden = true;
      origin = null;
      closeSpeeds();
      closeCal();
      await push(null);
      return;
    }
    el.hidden = false;
    /* The earliest cursor this replay has shown is where it began — "Start bar" seeks back to it
       (`start({from})` again; the changelog's own rule: calling start() while replaying jumps). */
    if (state.cursorTime != null && (origin === null || state.cursorTime < origin)) origin = state.cursorTime;
    const px = await priceAtCursor(state.cursorTime);
    label.textContent = fmtTime(state.cursorTime);
    label.title = (px != null ? 'Cursor price ' + money(px) + ' — ' : '') + 'the bar a paper fill right now would use';
    left.textContent = state.remaining === 1 ? '1 bar left' : state.remaining + ' bars left';
    playBtn.innerHTML = state.playing ? GLYPH.pause : GLYPH.play;
    playBtn.title = state.playing ? 'Pause' : 'Play';
    speedText.textContent = speed + '×';
    syncScrub(r);
    if (calPop) calMark();
    await push(px);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(async () => { queued = false; await sync(); }, 120);
  }

  /* The scrubber seeks on RELEASE (change), not on every input event: a drag fires dozens of inputs
     and each start() rewinds the chart — on this laptop that is a stall per pixel. A seek inside the
     loaded bars is immediate; the engine clamps anything older to what it can serve. */
  async function onSeek() {
    const r = engine();
    if (!r || !state.active || !range) return;
    const from = Number(range.value);
    if (!isFinite(from)) return;
    try { await r.start({ from }); } catch (err) {
      if (typeof window.taToast === 'function') window.taToast(String(err.message || err), true);
    }
    await sync();
  }

  /* Anchored popups (the speed menu, the calendar) open upward from the strip, kept inside it. */
  function positionPop(pop, anchor, width) {
    const w = el.getBoundingClientRect().width || 420;
    pop.style.left = Math.max(4, Math.min(anchor - 8, w - width - 4)) + 'px';
  }

  /* ── The calendar: the timestamp is a door to a month grid; picking a day seeks to that day at the
     time in the footer chip (the cursor's own time by default), clamped to `replay.bounds`. ─────── */
  const calAway = (ev) => { if (el && !el.contains(ev.target)) closeCal(); };
  const calKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); closeCal(); } };
  function closeCal() {
    if (!calPop) return;
    calPop.remove();
    calPop = null;
    calTitle = calGrid = calDate = calTime = null;
    document.removeEventListener('pointerdown', calAway, true);
    document.removeEventListener('keydown', calKey, true);
  }
  function toggleCal() {
    if (calPop) { closeCal(); return; }
    closeSpeeds();
    calPop = document.createElement('div');
    calPop.className = 'ta-replay__cal';
    calPop.setAttribute('role', 'dialog');
    calPop.setAttribute('aria-label', 'Jump to a date');
    calPop.innerHTML = `
      <div class="ta-replay__cal-head">
        <button type="button" class="ta-replay__nav" data-nav="-1" title="Previous month">${GLYPH.prev}</button>
        <span data-cal-title>—</span>
        <button type="button" class="ta-replay__nav" data-nav="1" title="Next month">${GLYPH.next}</button>
      </div>
      <div class="ta-replay__cal-week">${DAYS.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="ta-replay__cal-grid" data-cal-grid></div>
      <div class="ta-replay__cal-foot">
        <span class="ta-replay__chip" data-cal-date>—</span>
        <input type="time" class="ta-replay__chip ta-replay__time" data-cal-time value="00:00" aria-label="Time of day">
      </div>`;
    calPop.addEventListener('click', onCalClick);
    el.appendChild(calPop);
    calTitle = calPop.querySelector('[data-cal-title]');
    calGrid = calPop.querySelector('[data-cal-grid]');
    calDate = calPop.querySelector('[data-cal-date]');
    calTime = calPop.querySelector('[data-cal-time]');
    positionPop(calPop, timeBtn.offsetLeft, 236);
    calMonth = new Date(state.cursorTime != null ? state.cursorTime : Date.now());
    calTime.value = state.cursorTime != null ? fmtClock(state.cursorTime) : '00:00';
    document.addEventListener('pointerdown', calAway, true);
    document.addEventListener('keydown', calKey, true);
    renderCal();
  }
  function renderCal() {
    if (!calPop || !calGrid) return;
    const base = calMonth || new Date(state.cursorTime != null ? state.cursorTime : Date.now());
    const y = base.getFullYear(), m = base.getMonth();
    calTitle.textContent = MONTHS[m] + ' ' + y;
    let b = null;
    try { const r = engine(); b = r && r.bounds; } catch (err) { b = null; }
    const lead = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    calGrid.replaceChildren();
    for (let i = 0; i < lead; i++) calGrid.appendChild(document.createElement('span'));
    for (let d = 1; d <= days; d++) {
      const t = new Date(y, m, d).getTime();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-replay__day';
      btn.textContent = String(d);
      btn.dataset.day = String(t);
      /* A day the replay cannot reach (older than bounds.first, or beyond bounds.last) is disabled —
         an honest dead end beats a seek that silently clamps somewhere else. */
      if (b && (t > b.last || t + 86399999 < b.first)) { btn.disabled = true; btn.classList.add('is-dim'); }
      calGrid.appendChild(btn);
    }
    calMark();
  }
  function calMark() {
    if (!calPop || !calGrid) return;
    const curDay = state.cursorTime != null ? dayStart(state.cursorTime) : null;
    for (const c of calGrid.children) {
      if (c.dataset && c.dataset.day) c.classList.toggle('is-on', Number(c.dataset.day) === curDay);
    }
    if (state.cursorTime != null) calDate.textContent = fmtDay(state.cursorTime);
  }
  async function calPick(dayMs) {
    const r = engine();
    if (!r || !state.active) return;
    const bits = String((calTime && calTime.value) || '00:00').split(':').map(Number);
    let from = dayMs + ((bits[0] || 0) * 60 + (bits[1] || 0)) * 60000;
    let b = null;
    try { b = r.bounds; } catch (err) { b = null; }
    if (b) from = Math.max(b.first, Math.min(b.last, from));
    try { await r.start({ from }); } catch (err) {
      if (typeof window.taToast === 'function') window.taToast(String(err.message || err), true);
    }
    await sync();
  }
  function onCalClick(ev) {
    const nav = ev.target.closest('[data-nav]');
    if (nav) {
      const base = calMonth || new Date(state.cursorTime != null ? state.cursorTime : Date.now());
      calMonth = new Date(base.getFullYear(), base.getMonth() + Number(nav.dataset.nav), 1);
      renderCal();
      return;
    }
    const day = ev.target.closest('[data-day]');
    if (day && !day.disabled) calPick(Number(day.dataset.day));
  }

  /* ── The drag handle: the strip leaves its bottom-centre berth for wherever it is dropped, and
     the spot persists (clamped to the pane, so a smaller window cannot strand it off-screen). ───── */
  function onDragDown(ev) {
    if (ev.button) return;
    const r0 = el.getBoundingClientRect();
    dragPos = { dx: ev.clientX - r0.left, dy: ev.clientY - r0.top };
    ev.preventDefault();
    try { dragBtn.setPointerCapture(ev.pointerId); } catch (err) { /* no capture: still moves */ }
    dragBtn.addEventListener('pointermove', onDragMove);
    dragBtn.addEventListener('pointerup', onDragUp);
    dragBtn.addEventListener('pointercancel', onDragUp);
  }
  function onDragMove(ev) {
    if (!dragPos) return;
    const w = el.offsetWidth || 420, h = el.offsetHeight || 64;
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, ev.clientX - dragPos.dx));
    const y = Math.max(4, Math.min(window.innerHeight - h - 4, ev.clientY - dragPos.dy));
    el.classList.add('ta-replay--free');
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
  function onDragUp() {
    if (!dragPos) return;
    dragBtn.removeEventListener('pointermove', onDragMove);
    dragBtn.removeEventListener('pointerup', onDragUp);
    dragBtn.removeEventListener('pointercancel', onDragUp);
    dragPos = null;
    try {
      const r0 = el.getBoundingClientRect();
      localStorage.setItem('ta-replay-pos', JSON.stringify({ x: Math.round(r0.left), y: Math.round(r0.top) }));
    } catch (err) { /* private mode: the drag still holds for this session */ }
  }

  /* The speed control: a small menu (the release graphic's chevron), not a blind cycle. */
  const speedsAway = (ev) => { if (el && !el.contains(ev.target)) closeSpeeds(); };
  const speedsKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); closeSpeeds(); } };
  function closeSpeeds() {
    if (!speedsMenu) return;
    speedsMenu.remove();
    speedsMenu = null;
    document.removeEventListener('pointerdown', speedsAway, true);
    document.removeEventListener('keydown', speedsKey, true);
  }
  function toggleSpeeds() {
    if (speedsMenu) { closeSpeeds(); return; }
    closeCal();
    speedsMenu = document.createElement('div');
    speedsMenu.className = 'ta-replay__speeds';
    speedsMenu.setAttribute('role', 'menu');
    for (const s of SPEEDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.className = 'ta-replay__speed' + (s === speed ? ' is-on' : '');
      b.textContent = s + '×';
      b.addEventListener('click', () => {
        speed = s;
        const r = engine();
        if (r && state.playing) r.play(Math.round(1000 / speed));
        closeSpeeds();
        sync();
      });
      speedsMenu.appendChild(b);
    }
    el.appendChild(speedsMenu);
    positionPop(speedsMenu, speedBtn.offsetLeft, 64);
    document.addEventListener('pointerdown', speedsAway, true);
    document.addEventListener('keydown', speedsKey, true);
  }

  async function onClick(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const r = engine();
    if (!r) return;
    const act = b.dataset.act;
    if (act === 'speed') { toggleSpeeds(); return; }
    if (act === 'time') { toggleCal(); return; }
    try {
      if (act === 'start') { if (origin != null) await r.start({ from: origin }); }
      else if (act === 'play') { if (state.playing) r.pause(); else r.play(Math.round(1000 / speed)); }
      else if (act === 'step') { r.step(); }
      else if (act === 'exit') { r.stop(); }
    } catch (err) {
      if (typeof window.taToast === 'function') window.taToast(String(err.message || err), true);
    }
    await sync();
  }

  /* Start / stop for the ⋯ menu. `bars` back from the end of the loaded history is the default
     start; the engine deepens the history itself when the start is older than what it has. */
  async function start(opts) {
    const r = engine();
    if (!r) throw new Error('no replay engine on this page');
    if (state.active) return Object.assign({}, state);
    const b = r.bounds;
    if (!b) throw new Error('no bars loaded yet — nothing to replay');
    const bars = Math.max(1, Number((opts && opts.bars) || 100));
    const tf = (() => { try { const m = window.chartMarket ? window.chartMarket() : null; return (m && m.interval) || ''; } catch (err) { return ''; } })();
    const mm = /^(\d+(?:\.\d+)?)([mhdwM]?)$/.exec(tf);
    /* The display timeframe writes minutes with a capital M ("1M", "30M" — app.js normalises it
       for the venue) and this UI has no month timeframe; M counts as minutes (see the bridge's
       replay case for the measured cost of reading it as months). */
    const mins = mm ? (mm[2].toLowerCase() === 'h' ? +mm[1] * 60 : mm[2].toLowerCase() === 'd' ? +mm[1] * 1440 : mm[2].toLowerCase() === 'w' ? +mm[1] * 10080 : +mm[1]) : 15;
    const from = Math.max(b.first, b.last - bars * Math.max(1, mins) * 60000);
    await r.start({ from });
    await sync();
    return Object.assign({}, state);
  }
  async function stop() {
    const r = engine();
    if (r) r.stop();
    await sync();
  }

  function hook() {
    const r = engine();
    if (!r || typeof r.on !== 'function' || r.__taHooked) return !!r;
    try { r.__taHooked = true; } catch (err) { /* a frozen handle: schedule() still covers it */ }
    for (const ev of ['replay:start', 'replay:play', 'replay:pause', 'replay:step', 'replay:tick', 'replay:end']) {
      try { r.on(ev, schedule); } catch (err) { /* an older engine: the strip still syncs on actions */ }
    }
    return true;
  }

  window.addEventListener('ta-replay', schedule);
  window.addEventListener('ws-ready', () => { hook(); schedule(); });
  window.taReplay = { start, stop, sync, state: () => Object.assign({}, state), el: () => ensure() };
  hook();
  schedule();
})();
