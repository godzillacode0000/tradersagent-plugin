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
  /* This page's identity for the execute-once claim: two consoles must not both run `add ema`. */
  const VIEWER = 'v' + Math.random().toString(36).slice(2, 10);
  /* The build this frame loaded. A renderer keeps its last painted frame while it is occluded, so a
     pane can sit on hours-old code and never act on the console's own reload command — with the
     stamp in the heartbeat, "this view runs build X, the server serves Y" is visible from the
     agent's side instead of looking like a broken feature. */
  let BUILD = 'pending';
  const POLL_FAST = COMMAND_EVERY;   // no push channel: keep asking on the original schedule
  const POLL_SLOW = 15000;           // push channel is live: polling is only a safety net
  let lastCommandId = 0;
  let seeded = false;
  let stream = null;                 // the EventSource behind the push channel
  let pollDelay = POLL_FAST;
  const seen = new Set();            // ids already executed (a pushed command must not re-run on poll)

  /* What THIS page can execute. The server keeps its own whitelist, and the two drifted apart once
     already (an action passed the server, reached the page, and came back "unknown action" — HTTP
     200 with nothing done). So the page publishes its real list in every heartbeat and the server
     validates against that instead of trusting a constant. */
  const ACTIONS = ['apply', 'add', 'draw', 'clear', 'probe', 'market', 'shot', 'reload', 'mode',
                   'script', 'palette'];

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

  /* After `api` exists: reading the build stamp BEFORE the helper was defined killed the whole
     bridge with a TDZ ReferenceError (no heartbeat, no poll — the agent saw "no chart open" while
     the chart was right there on screen). */
  api('/api/build').then((info) => { if (info && info.build) BUILD = String(info.build); })
    .catch(() => { BUILD = 'unknown'; });

  function chart() {
    return window.__consoleChart || null;
  }

  /** Vela does not expose the market as a plain object on every build, so read the pickers.
   *  app.js owns the reading now (`window.chartMarket`) and the bars accessor uses the same one —
   *  two scrapes drifted once already (the heartbeat said 30m, the bars said 1h, and a stale copy
   *  reported another market's price). The local scan stays only for an older page build. */
  function marketFromDom() {
    if (typeof window.chartMarket === 'function') {
      try {
        const m = window.chartMarket();
        if (m && (m.symbol || m.timeframe || m.interval)) {
          return { symbol: m.symbol || null, timeframe: m.interval || m.timeframe || null };
        }
      } catch (err) { /* fall through to the local scan */ }
    }
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
        actions: ACTIONS,          // what this page can actually do (see ACTIONS above)
        layout: 'workspace',
        build: BUILD,              // the frontend files this frame loaded (see /api/build)
        viewer: VIEWER,            // which console instance this is — a stale frame says so
      });
    } catch (err) {
      /* a failed heartbeat means "no chart open" on the agent's side, which is the truth */
    }
  }

  /** One command from the agent. Every outcome is reported, including "I did not do that". */
  async function run(command) {
    const c = chart();
    const out = { id: command.id, ok: false, detail: '' };

    /* Several consoles can be alive at once (the Hermes pane, the HUD's pane, a browser tab), and
       they all receive the same push — so one of them must win the right to run it. A refused claim
       means another view is already doing the work: report nothing, because that view owns the
       result. A claim that cannot be asked for (backend restarting, older build) must not block the
       one honest view, hence the fail-open catch. */
    try {
      const claim = await api('/api/chart/claim', { id: command.id, viewer: VIEWER });
      if (claim && claim.claimed === false) {
        return { id: command.id, ok: false, skipped: 'another view is running it' };
      }
    } catch (err) {
      /* fail open: this view runs it rather than nothing running it */
    }

    try {
      switch (command.action) {
        case 'apply': {
          const pine = String(command.pine || '');
          if (!pine.trim()) throw new Error('no Pine source in the command');
          if (!c || typeof window.chartBars !== 'function') throw new Error('no chart on this page');
          const bars = await window.chartBars();
          const res = await window.PineTSRunner.run(pine, bars, { name: 'agent' });
          if (!res.ok) {
            out.detail = res.reason || 'not runnable: unknown';
            out.error = res.error || null;             // stable code + hint, not just prose
            break;
          }
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
          const before = (typeof c.presentNativeIndicators === 'function') ? c.presentNativeIndicators() : [];
          c.addNativeIndicator(command.native);
          /* Read the chart back instead of echoing the request: the handle accepts the call even
             when the study never lands, and "ok" from a request is not evidence of a painted pane. */
          const after = (typeof c.presentNativeIndicators === 'function') ? c.presentNativeIndicators() : [];
          const gained = after.filter((n) => !before.includes(n));
          out.ok = gained.length > 0 || after.includes(command.native);
          out.added = out.ok ? command.native : null;
          out.natives = after;
          out.detail = out.ok
            ? 'added Vela native "' + command.native + '" · chart now carries: ' + (after.join(', ') || 'none')
            : 'asked for "' + command.native + '" but the chart still carries: ' + (after.join(', ') || 'none');
          break;
        }
        case 'draw': {
          // Run a Library script and paint the geometry it BUILT (boxes/lines/labels) on our overlay.
          const pine = String(command.pine || '');
          if (!pine.trim()) throw new Error('no Pine source in the command');
          if (!window.ChartOverlay) throw new Error('no overlay on this page — reload the console');
          const bars = await window.chartBars();
          const res = await window.PineTSRunner.run(pine, bars, { name: 'agent-draw' });
          if (!res.ok) {
            out.detail = res.reason || 'not runnable: unknown';
            out.error = res.error || null;             // same contract as `apply`
            break;
          }
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
          /* A backtester's whole output is a dashboard `table`; the overlay renders it as a DOM layer. */
          const tables = flatten('__tables__');
          if (!boxes.length && !lines.length && !labels.length && !tables.length) {
            out.detail = 'ran in ' + res.ms + ' ms but the script built no boxes/lines/labels/tables to draw';
            break;
          }
          const drawn = await window.ChartOverlay.apply({ boxes, lines, labels, tables }, command.opts || {});
          /* What is on the canvas NOW, not what the script asked for. apply() may drop objects it
             cannot map, and a silent drop reads to the operator as an empty chart. */
          const onCanvas = (window.ChartOverlay.state ? window.ChartOverlay.state() : null);
          out.ok = !!drawn.ok && !!onCanvas &&
            (onCanvas.boxes + onCanvas.lines + onCanvas.labels + (onCanvas.tables || 0)) > 0;
          out.onCanvas = onCanvas;
          out.detail = 'ran in ' + res.ms + ' ms · overlay drew ' + (drawn.boxes || 0) + ' box(es), ' +
            (drawn.lines || 0) + ' line(s), ' + (drawn.labels || 0) + ' label(s), ' +
            (drawn.tables || 0) + ' table(s)' +
            (onCanvas ? ' · verified: ' + onCanvas.boxes + ' box / ' + onCanvas.lines + ' line / ' +
              onCanvas.labels + ' label / ' + (onCanvas.tables || 0) + ' table on screen' : '') +
            (drawn.reason ? ' · ' + drawn.reason : '') +
            (drawn.mapping ? ' · window bars ' + drawn.mapping.i0 + '+' + drawn.mapping.n + ' of ' + drawn.mapping.bars +
              ', price ' + Math.round(drawn.mapping.lo) + '-' + Math.round(drawn.mapping.hi) : '');
          break;
        }
        case 'clear': {
          if (window.ChartOverlay) window.ChartOverlay.clear();
          const removed = (window.PineTSPaint && window.PineTSPaint.clear) ? window.PineTSPaint.clear() : 0;
          /* Same rule as every other mutation: report the state after the call, not the intent. */
          const left = window.ChartOverlay && window.ChartOverlay.state ? window.ChartOverlay.state() : null;
          const stillPainted = (window.PineTSPaint && window.PineTSPaint.added) ? window.PineTSPaint.added : [];
          const onChart = (c && typeof c.presentNativeIndicators === 'function') ? c.presentNativeIndicators() : null;
          out.ok = (!left || (left.boxes + left.lines + left.labels) === 0) && stillPainted.length === 0;
          out.natives = onChart;
          out.detail = 'painted natives removed: ' + removed +
            ' · overlay now: ' + (left ? left.boxes + '/' + left.lines + '/' + left.labels : 'unknown') +
            // `clear` removes the overlay + what OUR paint layer added — an indicator the agent added
            // with `add` (or the operator added by hand) is not ours to remove, and the answer says so.
            ' · chart still carries: ' + (onChart ? (onChart.join(', ') || 'nothing') : 'unknown');
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
        case 'palette': {
          /* What colours the chart is actually wearing. Read-only, and the honest answer to a
             question that cost an hour once: the console's theme string does not rewrite a renderer
             config that already holds explicit colours, so "is the frame wearing our palette?" has to
             be answered by the frame, not inferred from a screenshot.
             With `try: true` it also *attempts* the console's palette and reports what the renderer
             said and what the config reads afterwards — because "apply() returned ok" and "the pane
             is dark" are two different claims and only the second one matters. */
          const rc = window.__consoleChart?.rendererControl;
          const read = () => {
            const cfg = rc && typeof rc.getConfig === 'function' ? rc.getConfig() : null;
            if (!cfg || !cfg.layout) return null;
            return { background: cfg.layout.background, text: cfg.layout.textColor,
                     grid: cfg.grid?.horzLines?.color, up: cfg.candles?.upColor,
                     down: cfg.candles?.downColor };
          };
          const before = read();
          if (!before) { out.detail = 'this page has no renderer config'; break; }
          const parked = !!(window.ChartPalette && window.ChartPalette.parked && window.ChartPalette.parked());
          const theme = document.documentElement.dataset.theme || '';
          let attempt = null;
          let after = before;
          let note = '';
          if (command.try) {
            // What the console *thinks* its theme is, what our dark palette wants, whether the live
            // config is judged to match, and what an explicit apply leaves behind — the whole chain,
            // because "enforced and skipped" reading as "already dark" is only true if the target
            // really is our dark palette.
            const cp = window.ChartPalette;
            const want = (cp && cp.PALETTES && cp.PALETTES.dark) || {};
            const parkedCfg = (cp && cp.parked && cp.parked()) || null;
            attempt = cp ? cp.enforce(theme || 'dark') : 'no ChartPalette here';
            await new Promise((r) => setTimeout(r, 300));
            after = read() || before;
            const matchesDark = cp && cp.matches ? cp.matches('dark') : 'n/a';
            const direct = cp && cp.apply ? cp.apply('dark') : 'n/a';
            await new Promise((r) => setTimeout(r, 300));
            const afterDirect = read() || before;
            note = ' · [theme=' + (theme || 'unset') + ' · wantBg=' + (want.background || '?') +
                   ' · wantUp=' + (want.up || '?') + ' · matchesDark=' + matchesDark +
                   ' · enforce=' + JSON.stringify(attempt) + ' · afterEnforce=' + after.background +
                   ' · applyDark=' + JSON.stringify(direct) + ' · afterApply=' + afterDirect.background +
                   ' · parkedBg=' + ((parkedCfg && parkedCfg.layout && parkedCfg.layout.background) || 'none') +
                   ' · pageBg=' + getComputedStyle(document.body).backgroundColor +
                   ' · storedTheme=' + (localStorage.getItem('luxalgo-web:theme') || 'unset') +
                   ' · topRowBg=' + (document.querySelector('.topbar, .top, header') ?
                                     getComputedStyle(document.querySelector('.topbar, .top, header')).backgroundColor : 'n/a') +
                   // Vela's own chrome is a second, separate theme: ours hands it the same string, so
                   // a light console should mean light chrome. Reported, not assumed.
                   ' · velaTheme=' + (() => {
                     try {
                       const api = (window.__wsApp || {}).ws || null;
                       if (!api) return 'no ws handle';
                       if (typeof api.getTheme === 'function') return String(api.getTheme());
                       return 'prop:' + String(api.theme);
                     } catch (err) { return 'err'; }
                   })() +
                   ' · velaChromeBg=' + (() => {
                     const el = document.querySelector('[class*="toolbar"], [class*="Toolbar"], [class*="header"]');
                     return el ? getComputedStyle(el).backgroundColor : 'no chrome found';
                   })() + ']';
          }
          out.ok = true;
          out.palette = { before, after, attempt, parked, theme,
                          hasChartPalette: !!window.ChartPalette,
                          hasRendererControl: !!rc,
                          canApply: typeof rc?.applyConfig === 'function' };
          out.detail = 'background ' + after.background + ' · up ' + after.up + ' · down ' + after.down +
                       (command.try ? ' · enforced (' + JSON.stringify(attempt) + ')' : '') +
                       (parked ? ' · a hand-made palette is parked (light restores it)' : '') + note;
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
        case 'script': {
          /* The Pine editor surface was removed on the operator's call (17 Sep): this build has no
             script panel, so the command answers honestly instead of pretending to load it. Scripts
             still run through `apply` (PineTS over the live bars) — that is the path to use. */
          out.detail = 'this build has no script panel (the Pine editor was removed, 17 Sep) — ' +
            'send {\"action\":\"apply\",\"pine\":\"…\"} to run a script over the chart instead';
          break;
        }
        case 'mode': {
          /* Likewise gone with the editor: the console only has the chart surface now. */
          out.detail = 'this build has no script panel (the Pine editor was removed, 17 Sep) — ' +
            'the console shows the chart, the Library and the detail panel';
          break;
        }
        case 'reload': {
          /* The console's static files are served `no-cache`, so a document reload really does pick up
             a changed overlay.js/chart-bridge.js. This is the op that makes a frontend change live
             without restarting the app (the only other way needs a fresh iframe stamp). */
          if (window.ChartOverlay) window.ChartOverlay.clear();
          out.ok = true;
          out.reloading = true;
          out.detail = 'reloading the console page to pick up changed frontend files';
          // Report first — but a failed report must NOT cancel the reload: that is the whole point
          // of this op, and an unreported reload still lands the new frontend files.
          try { await api('/api/chart/result', out); } catch (err) { /* reload anyway */ }
          setTimeout(() => location.reload(), 300);
          return out;
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
