/**
 * chart-bridge — the page's half of the agent <-> chart handshake.
 *
 * There is no way for the agent's process to reach into this tab, so both sides meet in the console's
 * HTTP backend (backend/chart_bridge.py):
 *
 *   here  --POST /api/chart/state---->   what this chart is showing (every 4s, tiny payload)
 *   here  --GET  /api/chart/commands-->  what the agent asked for, then execute it on the live chart
 *   here  --POST /api/chart/result--->   what actually happened, in plain words
 *
 * A picture is only captured when the agent explicitly asks (a `shot` command) — this box has 8 GB of
 * RAM and the Vela workspace to carry, so a heartbeat must stay cheap.
 *
 * Nothing here is a UI: the composer the operator types into is Hermes's own.
 */
(function () {
  'use strict';

  const STATE_EVERY = 4000;
  const COMMAND_EVERY = 2000;
  const POLL_FAST = COMMAND_EVERY;   // no push channel: keep asking on the original schedule
  const POLL_SLOW = 15000;           // push channel is live: polling is only a safety net
  let lastCommandId = 0;
  let seeded = false;
  let stream = null;                 // the EventSource behind the push channel
  let pollDelay = POLL_FAST;
  const seen = new Set();            // ids already executed (a pushed command must not re-run on poll)

  const api = async (path, body) => {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'GET' });
    if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
    const payload = await res.json();
    if (payload && payload.ok === false) throw new Error(path + ' → ' + (payload.error || 'error'));
    // the console answers {ok, data}: the caller wants `data`, and reading the envelope instead
    // silently produced "no commands" forever — which is exactly how this failed the first time.
    return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
  };

  function chart() {
    return window.__consoleChart || null;
  }

  /** Vela does not expose the market as a plain object on every build, so read the pickers. */
  function marketFromDom() {
    const host = document.getElementById('chart') || document.body;
    const texts = [];
    host.querySelectorAll('button, span, div').forEach((el) => {
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (t && t.length <= 16) texts.push(t);
    });
    return {
      symbol: texts.find((t) => /^[A-Z0-9]{4,14}$/.test(t) && /(USDT|USD|USDC|BTC|ETH)$/.test(t)) || null,
      timeframe: texts.find((t) => /^\d{1,3}[mhdwM]$/.test(t)) || null,
    };
  }

  async function capture() {
    try {
      if (window.__wsApp && typeof window.__wsApp.screenshot === 'function') {
        return await window.__wsApp.screenshot();
      }
      const c = chart();
      if (c && typeof c.screenshot === 'function') return await c.screenshot();
    } catch (err) {
      /* fall through: a missing picture is reported, never faked */
    }
    return null;
  }

  function inspect() {
    const c = chart();
    if (!c || typeof c.inspect !== 'function') return {};
    try {
      const info = c.inspect() || {};
      return { series: (info.totals || {}).series, drawings: (info.totals || {}).drawings };
    } catch (err) {
      return {};
    }
  }

  async function heartbeat() {
    try {
      const c = chart();
      const market = marketFromDom();
      let last = null;
      if (typeof window.chartBars === 'function') {
        const bars = await window.chartBars();
        if (bars && bars.length) last = bars[bars.length - 1].close;
      }
      // chart.market.timeframe is stale in this build (says 4h on a 15m chart), so the heartbeat
      // reports the timeframe the bars actually have; the raw field rides along for diagnostics.
      const barsList = typeof window.chartBars === 'function' ? await window.chartBars() : [];
      const inferred = (window.PineTSRunner && window.PineTSRunner.marketContext)
        ? window.PineTSRunner.marketContext(barsList) : null;
      await api('/api/chart/state', {
        symbol: market.symbol,
        timeframe: inferred ? inferred.timeframe : market.timeframe,
        timeframe_reported: market.timeframe,
        last: last,
        natives: c && typeof c.presentNativeIndicators === 'function' ? c.presentNativeIndicators() : [],
        series: inspect().series,
        drawings: inspect().drawings,
        bars: barsList.length || null,
        layout: 'workspace',
      });
    } catch (err) {
      /* a failed heartbeat means "no chart open" on the agent's side, which is the truth */
    }
  }

  /** One command from the agent. Every outcome is reported, including "I did not do that". */
  async function run(command) {
    const c = chart();
    const out = { id: command.id, ok: false, detail: '' };
    try {
      switch (command.action) {
        case 'apply': {
          const pine = String(command.pine || '');
          if (!pine.trim()) throw new Error('no Pine source in the command');
          if (!c || typeof window.chartBars !== 'function') throw new Error('no chart on this page');
          const bars = await window.chartBars();
          const res = await window.PineTSRunner.run(pine, bars, { name: 'agent' });
          if (!res.ok) { out.detail = 'not runnable: ' + (res.reason || 'unknown'); break; }
          const paint = await window.PineTSPaint.paintNative(pine);
          const partial = paint.added && res.series.length > 1
            ? ' · ' + (res.series.length - 1) + ' other plot(s) not drawn (no exact Vela native)'
            : '';
          out.ok = true;
          out.series = res.series.length;
          out.added = paint.added ? paint.added.title : null;
          out.ms = res.ms;
          out.strategy = res.strategy || null;          // a strategy() script's own metrics
          out.ctor = res.ctor || null;                  // which PineTS constructor ran (context matters)
          const s = res.strategy;
          const strat = s
            ? ' · strategy: net ' + s.netprofit + ' over ' + s.closedtrades + ' closed trades (' +
              s.wintrades + 'W/' + s.losstrades + 'L), max DD ' + s.max_drawdown +
              ', Sharpe ' + s.sharpe + ', CAGR ' + s.cagr + (s.truncated ? ' [partial]' : '')
            : '';
          const drawParts = (res.drawings || []).map((d) => d.replace(/__/g, ''));
          const drawable = drawParts.length
            ? ' · script drew ' + drawParts.join('/') + ' (no render surface in this build — overlay needed)'
            : '';
          out.detail = 'ran in ' + res.ms + ' ms over ' + bars.length + ' bars · ' +
            res.series.length + ' series · ' + (paint.added
              ? 'drawn with Vela native "' + paint.added.title + '"' + partial
              : 'not drawn: ' + paint.reason) + strat + drawable +
            (res.ctor ? ' · engine context: ' + res.ctor + (res.context ? ' (' + res.context + ')' : '') : '');
          break;
        }
        case 'add': {
          if (!c || typeof c.addNativeIndicator !== 'function') throw new Error('no chart on this page');
          c.addNativeIndicator(command.native);
          out.ok = true;
          out.added = command.native;
          out.detail = 'added Vela native "' + command.native + '"';
          break;
        }
        case 'draw': {
          // Run a Library script and paint the geometry it BUILT (boxes/lines/labels) on our overlay.
          const pine = String(command.pine || '');
          if (!pine.trim()) throw new Error('no Pine source in the command');
          if (!window.ChartOverlay) throw new Error('no overlay on this page — reload the console');
          const bars = await window.chartBars();
          const res = await window.PineTSRunner.run(pine, bars, { name: 'agent-draw' });
          if (!res.ok) { out.detail = 'not runnable: ' + (res.reason || 'unknown'); break; }
          const plots = (res.raw && res.raw.plots) || {};
          const flatten = (key) => {
            const node = plots[key];
            const rows = node && Array.isArray(node.data) ? node.data : [];
            const vals = [];
            for (const row of rows) {
              const v = row && row.value;
              if (Array.isArray(v)) vals.push(...v);
            }
            return vals.filter((x) => x && typeof x === 'object' && !x._deleted);
          };
          const boxes = flatten('__boxes__').filter((b) => b.xloc !== 'bt');
          const lines = flatten('__lines__');
          const labels = flatten('__labels__');
          if (!boxes.length && !lines.length && !labels.length) {
            out.detail = 'ran in ' + res.ms + ' ms but the script built no boxes/lines/labels to draw';
            break;
          }
          const drawn = await window.ChartOverlay.apply({ boxes, lines, labels }, command.opts || {});
          out.ok = !!drawn.ok;
          out.detail = 'ran in ' + res.ms + ' ms · overlay drew ' + (drawn.boxes || 0) + ' box(es), ' +
            (drawn.lines || 0) + ' line(s), ' + (drawn.labels || 0) + ' label(s)' +
            (drawn.reason ? ' · ' + drawn.reason : '') +
            (drawn.mapping ? ' · window bars ' + drawn.mapping.i0 + '+' + drawn.mapping.n + ' of ' + drawn.mapping.bars +
              ', price ' + Math.round(drawn.mapping.lo) + '-' + Math.round(drawn.mapping.hi) : '');
          break;
        }
        case 'clear': {
          const n = window.ChartOverlay ? window.ChartOverlay.clear() : 0;
          const removed = (window.PineTSPaint && window.PineTSPaint.clear) ? window.PineTSPaint.clear() : 0;
          out.ok = true;
          out.detail = 'overlay cleared (' + n + ') · painted natives removed: ' + removed;
          break;
        }
        case 'probe': {
          // Diagnostics only: what this page can actually see and what the handles expose.
          const c = chart();
          const names = (o) => {
            if (!o) return null;
            const out2 = new Set();
            try { Object.keys(o).forEach((k) => out2.add(k)); } catch { /* ignore */ }
            try { Object.getOwnPropertyNames(Object.getPrototypeOf(o)).forEach((k) => out2.add(k)); } catch { /* ignore */ }
            return Array.from(out2).sort();
          };
          const domSample = [];
          const host = document.getElementById('chart') || document.body;
          host.querySelectorAll('button, span, div').forEach((el) => {
            if (el.children.length) return;
            const t = (el.textContent || '').trim();
            if (t && t.length <= 16) domSample.push(t);
          });
          out.ok = true;
          out.detail = JSON.stringify({
            market: marketFromDom(),
            chartNames: names(c),
            wsNames: window.__ws ? names(window.__ws) : null,
            appKeys: window.__wsApp ? Object.keys(window.__wsApp) : null,
            hasChartBars: typeof window.chartBars === 'function',
            domSample: domSample.slice(0, 70),
          });
          break;
        }
        case 'market': {
          if (!c || typeof c.setMarket !== 'function') throw new Error('this chart cannot switch market');
          await c.setMarket({ symbol: command.symbol, timeframe: command.timeframe });
          out.ok = true;
          out.detail = 'switched to ' + command.symbol + ' ' + (command.timeframe || '');
          break;
        }
        case 'shot': {
          const dataUrl = await capture();
          if (!dataUrl) { out.detail = 'the chart did not give a picture'; break; }
          out.ok = true;
          out.shot = dataUrl;
          out.detail = 'captured ' + Math.round(dataUrl.length / 1024) + ' KB';
          break;
        }
        default:
          out.detail = 'unknown action "' + command.action + '" — nothing done';
      }
    } catch (err) {
      out.detail = String((err && err.message) || err);
    }
    try {
      await api('/api/chart/result', out);
    } catch (err) {
      /* if the report cannot be delivered the command will be re-read and retried */
    }
    return out;
  }

  /* Polling is the fallback now: it seeds past the backlog on load and catches anything a dropped
     stream missed. While the push channel is healthy it only ticks every 15s. */
  async function poll() {
    try {
      if (!seeded) {
        // A page that has just opened must not replay whatever was queued while it was closed:
        // seed past the backlog, then only execute what arrives from here on. The CLI still times
        // out (exit 1) if it asked while no chart was open, which is the honest answer.
        const initial = await api('/api/chart/commands?since=0');
        const backlog = initial.commands || [];
        if (backlog.length) lastCommandId = Number(backlog[backlog.length - 1].id) || 0;
        seeded = true;
        return;
      }
      const data = await api('/api/chart/commands?since=' + lastCommandId);
      for (const command of data.commands || []) {
        const id = Number(command.id) || 0;
        lastCommandId = Math.max(lastCommandId, id);
        if (seen.has(id)) continue;
        seen.add(id);
        await run(command);
      }
    } catch (err) {
      /* the console is restarting; the next tick retries */
    }
  }

  /* The push channel: the backend holds this response open and sends each command the moment it is
     queued, so an agent command no longer waits for a poll tick (the 1-2s that used to be pure
     overhead). If the stream drops, EventSource reconnects by itself and polling speeds back up. */
  function connectStream() {
    try {
      stream = new EventSource('/api/chart/stream');
    } catch (err) {
      return;                        // no EventSource: the poll path still does the job
    }
    stream.onopen = () => {
      pollDelay = POLL_SLOW;
      if (window.ChartBridge) window.ChartBridge.pushed = true;
    };
    stream.onerror = () => {
      pollDelay = POLL_FAST;
      if (window.ChartBridge) window.ChartBridge.pushed = false;
    };
    stream.onmessage = async (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (!payload || payload.type !== 'command' || !payload.command) return;
      const id = Number(payload.command.id) || 0;
      if (seen.has(id)) return;
      seen.add(id);
      lastCommandId = Math.max(lastCommandId, id);
      await run(payload.command);
    };
  }

  heartbeat();
  setInterval(heartbeat, STATE_EVERY);
  async function tick() {
    await poll();
    setTimeout(tick, pollDelay);
  }
  setTimeout(tick, POLL_FAST);
  connectStream();
  window.ChartBridge = {
    run, capture, heartbeat, poll,
    streamState: () => ({
      connected: !!stream && stream.readyState === 1,
      pollDelay, lastId: lastCommandId
    })
  };
})();
