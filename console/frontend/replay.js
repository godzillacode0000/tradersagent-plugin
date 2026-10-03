/* Replay — Vela's own replay engine behind one control strip (Phase 6, 3 Oct).

   The operator's calls: the strip lives IN the chart ("jalur kawalan dalam chart") and is started
   from the replay button in Vela's own row (◀◀ — the icon Vela paints in its replay watermark; the
   ⋯ menu keeps a fallback row); the chart stays whole otherwise — nothing is on screen until replay
   is on.
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
  const state = { active: false, playing: false, cursorTime: null, remaining: 0 };
  let speed = 1;
  let el = null, label = null, playBtn = null, speedBtn = null;
  let lastPush = '';
  let queued = false;

  const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

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
    const body = { active: !!state.active, price: state.active ? px : null, time: state.active ? state.cursorTime : null };
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
      <span class="ta-replay__tag">REPLAY</span>
      <span class="ta-replay__label" data-label>—</span>
      <button type="button" class="ta-replay__btn" data-act="play" title="Play / pause">▶</button>
      <button type="button" class="ta-replay__btn" data-act="step" title="Reveal the next bar">»</button>
      <button type="button" class="ta-replay__btn" data-act="speed" title="Playback speed">1×</button>
      <button type="button" class="ta-replay__btn ta-replay__btn--x" data-act="exit" title="Leave replay">✕</button>`;
    el.addEventListener('click', onClick);
    document.body.appendChild(el);
    label = el.querySelector('[data-label]');
    playBtn = el.querySelector('[data-act="play"]');
    speedBtn = el.querySelector('[data-act="speed"]');
    return el;
  }

  async function sync() {
    const r = engine();
    if (!r) return;
    try { Object.assign(state, r.state || {}); } catch (err) { /* older engine: keep the last read */ }
    ensure();
    if (!state.active) {
      el.hidden = true;
      await push(null);
      return;
    }
    el.hidden = false;
    const px = await priceAtCursor(state.cursorTime);
    label.textContent = fmtTime(state.cursorTime) + ' · ' + (px != null ? money(px) : '—') + ' · ' + state.remaining + ' left';
    playBtn.textContent = state.playing ? '‖' : '▶';
    playBtn.title = state.playing ? 'Pause' : 'Play';
    speedBtn.textContent = speed + '×';
    await push(px);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(async () => { queued = false; await sync(); }, 120);
  }

  async function onClick(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const r = engine();
    if (!r) return;
    const act = b.dataset.act;
    try {
      if (act === 'play') { if (state.playing) r.pause(); else r.play(Math.round(1000 / speed)); }
      else if (act === 'step') { r.step(); }
      else if (act === 'speed') {
        speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
        if (state.playing) r.play(Math.round(1000 / speed));
      } else if (act === 'exit') { r.stop(); }
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
    const mins = mm ? (mm[2].toLowerCase() === 'h' ? +mm[1] * 60 : mm[2].toLowerCase() === 'd' ? +mm[1] * 1440 : mm[2].toLowerCase() === 'w' ? +mm[1] * 10080 : mm[2] === 'M' ? +mm[1] * 43200 : +mm[1]) : 15;
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
