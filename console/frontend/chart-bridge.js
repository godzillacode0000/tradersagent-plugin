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
  const ACTIONS = ['apply', 'add', 'remove', 'draw', 'clear', 'probe', 'market', 'shot', 'reload',
                   'mode', 'script', 'palette', 'browse', 'open'];

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
          /* One landasan (unified.js): geometry to the overlay, plot series to a native — the
             same run the script editor and the Library's Run PineTS perform. */
          const r = await window.TraderRun.run(pine, 'agent');
          if (!r.ok) {
            out.detail = r.reason || 'not runnable: unknown';
            out.error = r.error || null;             // stable code + hint, not just prose
            break;
          }
          out.ok = true;
          out.series = r.series.length;
          out.added = r.paint && r.paint.added ? r.paint.added.title : null;
          out.ms = r.ms;
          out.strategy = r.strategy || null;          // a strategy() script's own metrics
          out.ctor = r.ctor || null;                  // which PineTS constructor ran (context matters)
          out.onCanvas = r.verified || null;
          out.detail = window.TraderRun.summarize(r);
          break;
        }
        case 'add': {
          if (!c || typeof c.addNativeIndicator !== 'function') throw new Error('no chart on this page');
          const name = String(command.native || '').trim();
          const before = (typeof c.presentNativeIndicators === 'function') ? c.presentNativeIndicators() : [];

          /* Vela stacks a second study instead of replacing the one already there, so asking twice
             drew two overlapping EMAs — and the old `after.includes(name)` check called that a
             success, because the name was present either way. Read the chart first: if this study is
             already on it, say so and change nothing, so a repeat call is idempotent instead of
             silently doubling the pane. */
          const already = before.filter((n) => n === name).length;
          if (already > 0) {
            const dupes = already > 1 ? ' (it is on the chart ' + already + ' times)' : '';
            out.ok = true;
            out.added = null;
            out.alreadyPresent = true;
            out.natives = before;
            out.detail = 'the chart already carries Vela native "' + name + '"' + dupes +
              ' · nothing added · chart carries: ' + (before.join(', ') || 'none');
            break;
          }

          c.addNativeIndicator(name);
          /* Read the chart back instead of echoing the request: the handle accepts the call even
             when the study never lands, and "ok" from a request is not evidence of a painted pane. */
          const after = (typeof c.presentNativeIndicators === 'function') ? c.presentNativeIndicators() : [];
          const gained = after.filter((n) => !before.includes(n));
          out.ok = gained.length > 0;
          out.added = out.ok ? name : null;
          out.natives = after;
          out.detail = out.ok
            ? 'added Vela native "' + name + '" · chart now carries: ' + (after.join(', ') || 'none')
            : 'asked for "' + name + '" but the chart still carries: ' + (after.join(', ') || 'none');
          break;
        }
        case 'draw': {
          /* One landasan (unified.js): the geometry goes to our overlay, read back from state();
             any plot series lands as a native too — same run as `apply`, the editor, the Library. */
          const pine = String(command.pine || '');
          if (!pine.trim()) throw new Error('no Pine source in the command');
          if (!window.ChartOverlay) throw new Error('no overlay on this page — reload the console');
          const r = await window.TraderRun.run(pine, 'agent-draw', command.opts || {});
          if (!r.ok) {
            out.detail = r.reason || 'not runnable: unknown';
            out.error = r.error || null;             // same contract as `apply`
            break;
          }
          const v = r.verified;
          out.ok = r.containers
            ? !!v && (v.boxes + v.lines + v.labels + (v.tables || 0)) > 0
            : Boolean(r.paint && r.paint.added);
          out.ms = r.ms;
          out.series = r.series.length;
          out.added = r.paint && r.paint.added ? r.paint.added.title : null;
          out.onCanvas = v || null;
          out.detail = window.TraderRun.summarize(r);
          break;
        }
        case 'clear': {
          if (window.ChartOverlay) window.ChartOverlay.clear();
          if (window.TraderRun) window.TraderRun.reset();   // legend + badge forget with the overlay
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
        case 'remove': {
          /* Remove indicators: `native` names one, `all: true` clears the chart's studies.
             `clear` deliberately leaves operator-added studies alone, so this is the door for "take
             them off" — and Vela's own indicators control is the only thing that can. Which removal
             method that control exposes is not documented in this build, so the doors are tried in
             order and the report names the one that worked, read back from the chart. */
          const c = chart();
          const read = () => (c && typeof c.presentNativeIndicators === 'function')
            ? (c.presentNativeIndicators() || []) : [];
          const before = read();
          const ctl = c && c.indicators;
          let names = [];
          if (ctl) {
            try { names = names.concat(Object.keys(ctl)); } catch (err) { /* opaque */ }
            try { names = names.concat(Object.getOwnPropertyNames(Object.getPrototypeOf(ctl) || {})); } catch (err) { /* opaque */ }
          }
          names = Array.from(new Set(names)).filter((n) => n !== 'constructor').sort();
          const tried = [];
          const attempt = (obj, name, ...args) => {
            try {
              if (!obj || typeof obj[name] !== 'function') return false;
              obj[name](...args);
              tried.push(name + '()');
              return true;
            } catch (err) {
              tried.push(name + ' ✗ ' + (err && err.message));
              return false;
            }
          };
          const want = command.native ? String(command.native) : null;
          if (command.all) {
            for (const door of ['removeAll', 'clear', 'reset', 'disposeAll', 'removeAllIndicators']) {
              if (attempt(ctl, door)) break;
            }
          } else if (want) {
            for (const door of ['remove', 'removeIndicator', 'delete', 'dispose', 'removeByName']) {
              if (attempt(ctl, door, want)) break;
            }
          } else {
            out.detail = 'remove needs `native` (one name) or `all: true`';
            break;
          }
          await new Promise((r) => setTimeout(r, 400));
          let after = read();
          out.natives = after;
          out.ok = after.length < before.length;

          /* The door that actually exists in this build: the chart's own indicator ledger —
             `chart.indicators()` returns entries whose prototype carries remove/moveTo/setVisible.
             This used to be reached only when `window.__wsApp` was present, so on a bare-chart page
             (no workspace) every removal silently did nothing and the tool reported "nothing removed"
             while the studies stayed. The ledger is read off the chart handle itself now. */
          if (!out.ok) {
            const ledgerOf = () => {
              try {
                const l = (typeof c.indicators === 'function') ? c.indicators() : c.indicators;
                if (Array.isArray(l)) return l;
                if (l && Array.isArray(l.indicators)) return l.indicators;
              } catch (err) { tried.push('ledger \u2717 ' + (err && err.message)); }
              return [];
            };
            const rowMatches = (entry, wanted) => {
              const fields = [entry && entry.nativeType, entry && entry.name, entry && entry.title,
                              entry && entry.id]
                .filter(Boolean).map((v) => String(v).toLowerCase());
              return fields.some((f) => f === wanted || f.includes(wanted));
            };
            tried.push('ledger: ' + JSON.stringify(ledgerOf().map((e) => e && e.nativeType || e && e.name)).slice(0, 160));

            /* The door that works in this build, measured: the ledger entry's own remove() —
               `chart.indicators()` returns entries whose prototype carries remove/moveTo/setVisible.
               The cell doors (removeInstance/removeFromChart/removeNative) rejected ids and names
               alike, and each pass re-reads the ledger because the list shifts as studies come off.
               `all` therefore actually means all: passes until the chart is empty or nothing lands. */
            let passes = 0;
            const maxPasses = command.all ? 6 : 1;
            while (passes < maxPasses) {
              passes += 1;
              const entries = ledgerOf();
              if (!entries.length) break;
              let acted = false;
              for (const entry of entries) {
                if (!command.all && !rowMatches(entry, String(want || '').toLowerCase())) continue;
                const shapes = [
                  ['entry.remove()', entry],
                  ['entry.controller.remove()', entry && entry.controller],
                  ['entry.controller.renderer.remove()', entry && entry.controller && entry.controller.renderer],
                ];
                for (const pair of shapes) {
                  const label = pair[0];
                  const obj = pair[1];
                  if (!obj || typeof obj.remove !== 'function') continue;
                  try {
                    obj.remove();
                    tried.push(label);
                    acted = true;
                  } catch (err) {
                    tried.push(label + ' \u2717 ' + (err && err.message));
                  }
                  if (acted) break;
                }
                if (acted) {
                  await new Promise((r) => setTimeout(r, 500));
                  if (!command.all) break;
                }
              }
              await new Promise((r) => setTimeout(r, 400));
              if (!command.all) break;
              if (!acted) break;
              if (read().length === 0) break;
            }
            after = read();
            out.natives = after;
            out.ok = after.length < before.length;
          }

          /* The answer a person (or the agent) reads first: what actually came off, and what the chart
             carries now. The door-by-door trace is only worth showing when nothing was removed. */
          const removed = before.filter((n) => !after.includes(n));
          out.detail = (removed.length ? 'removed ' + removed.join(', ') : 'nothing removed') +
                       ' · chart now carries: ' + (after.join(', ') || 'nothing') +
                       (out.ok ? '' : ' · tried: ' + (tried.join(', ') || 'nothing'));
          break;
        }
        case 'probe': {
          // Diagnostics only: what this page can actually see and what the handles expose.
          const c = chart();
          /* Which door removes an indicator? Guessing cost a cycle already (`indicators` is a method,
             not a control). So every handle is described by its *methods*, which is the map I actually
             need when a new action has to do something the bridge has never done before. */
          const describe = (obj, depth = 0) => {
            const out2 = {};
            let keys = [];
            try { keys = keys.concat(Object.keys(obj)); } catch (err) { /* opaque */ }
            try { keys = keys.concat(Object.getOwnPropertyNames(Object.getPrototypeOf(obj) || {})); } catch (err) { /* opaque */ }
            for (const key of Array.from(new Set(keys)).sort()) {
              if (depth > 0 || out2[key] !== undefined) continue;
              let value;
              try { value = obj[key]; } catch (err) { continue; }
              const type = typeof value;
              if (type === 'function') { out2[key] = 'fn/' + (value.length || 0); continue; }
              if (type === 'object' && value && depth === 0) {
                const methods = [];
                try { Object.keys(value).forEach((k) => { if (typeof value[k] === 'function') methods.push(k); }); } catch (err) { /* opaque */ }
                try {
                  Object.getOwnPropertyNames(Object.getPrototypeOf(value) || {}).forEach((k) => {
                    if (typeof value[k] === 'function') methods.push(k);
                  });
                } catch (err) { /* opaque */ }
                out2[key] = Array.from(new Set(methods)).sort().slice(0, 24);
              }
            }
            return out2;
          };
          const handleMap = { chart: describe(c) };
          try {
            const ws = (window.__wsApp || {}).ws;
            if (ws) {
              handleMap.workspace = describe(ws);
              for (const key of ['activeCell', 'cell', 'active']) {
                try { if (ws[key]) handleMap['ws.' + key] = describe(ws[key]); } catch (err) { /* opaque */ }
              }
              try {
                const cells = ws.cells && (typeof ws.cells === 'function' ? ws.cells() : ws.cells);
                const first = Array.isArray(cells) ? cells[0] : (cells && cells[0]);
                if (first) handleMap['ws.cells[0]'] = describe(first);
              } catch (err) { /* opaque */ }
            }
          } catch (err) { /* opaque */ }
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
            handles: handleMap,
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
          /* setMarket fetches bars from the workspace provider. When that provider has never heard of
             the symbol (this Vela workspace registers Binance only), the promise neither resolves nor
             rejects — so without a deadline this op never answers and the caller waits out its whole
             window with no idea why. Measured: `market XAUUSD 5m` sat there for 30 s and left the
             chart on BTCUSDT. Race it, then say plainly which markets this workspace can serve. */
          /* Must be SHORTER than the caller's inline wait (LUXALGO_CHART_INLINE_WAIT, 8 s by default)
             or the caller times out first and reports a generic "chart had not answered" instead of
             this refusal — which is the whole point of the guard. */
          const SWITCH_DEADLINE_MS = 6000;
          let timer = null;
          const guard = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('__switch_timeout__')), SWITCH_DEADLINE_MS);
          });
          try {
            await Promise.race([
              c.setMarket({ symbol: command.symbol, timeframe: command.timeframe }),
              guard,
            ]);
          } catch (err) {
            if (String((err && err.message) || err) === '__switch_timeout__') {
              /* Same shape the Pine runner publishes: a stable code plus a hint, so the caller can
                 branch and a human knows the next move (see out.error above and the MCP reader in
                 console/mcp/server.py, which prints code[feature] and the hint). */
              out.error = {
                code: 'SYMBOL_NOT_SERVED',
                feature: String(command.symbol || '?'),
                message: String(command.symbol || '?') + ' did not load — the workspace provider ' +
                  'never answered within ' + (SWITCH_DEADLINE_MS / 1000) + 's.',
                hint: 'This console is wired to the Binance feed only, so a crypto pair works ' +
                  '(BTCUSDT, ETHUSDT, SOLUSDT…). XAUUSD/NAS100/forex are not served here yet; the ' +
                  'chart is unchanged.',
              };
              out.detail = 'refused: ' + command.symbol + ' is not a market this console can load';
              break;
            }
            throw err;
          } finally {
            if (timer) clearTimeout(timer);
          }
          /* Read the chart back in this same result so the agent does not need a second chart_state
             call (~the whole perceived delay last time). setMarket has already fetched the bars. */
          let last = null;
          let nBars = null;
          try {
            if (typeof window.chartBars === 'function') {
              const bars = await window.chartBars();
              if (bars && bars.length) {
                last = bars[bars.length - 1].close;
                nBars = bars.length;
              }
            }
          } catch (err) { /* bars not ready — detail still names the market */ }
          const seen = marketFromDom();
          const symbol = (seen && seen.symbol) || command.symbol;
          const timeframe = (seen && seen.timeframe) || command.timeframe || '';
          out.ok = true;
          out.last = last;
          out.bars = nBars;
          out.symbol = symbol;
          out.timeframe = timeframe;
          out.detail = 'switched to ' + symbol + ' ' + timeframe +
            (last != null ? ' · last ' + last : '') +
            (nBars != null ? ' · bars ' + nBars : '');
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
          /* The editor is back (23 Sep, operator's call): open the pane for real, and if the
             command carried Pine, run it on the same landasan every other door uses.
             The guard reads the COLUMN too, not just the view: a reload can leave the
             rightview pref with view-script visible while data-detail is still off, and a
             view--hidden-only check then skipped the click and reported success anyway. */
          const openBtn = document.getElementById('script-open');
          const pane = document.getElementById('view-script');
          const track = document.querySelector('.main');
          const colOff = !track || track.dataset.detail !== 'on';
          const closed = colOff || (pane && pane.classList.contains('view--hidden'));
          /* The bridge could open the editor but never close it (23 Sep pane audit). `close: true`
             makes the door symmetric: the button toggles, so clicking an open pane closes it. */
          if (command.close) {
            if (openBtn && pane && !closed) openBtn.click();
            out.ok = true;
            out.detail = 'script pane closed';
            break;
          }
          if (openBtn && pane && closed) openBtn.click();
          const pine = String(command.pine || '');
          if (!pine.trim()) {
            out.ok = true;
            out.detail = 'script pane opened — paste Pine and press Run, or send ' +
              '{"action":"script","pine":"…"} to run it right away';
            break;
          }
          const r = await window.TraderRun.run(pine, String(command.name || 'agent-script'));
          out.ok = Boolean(r.ok);
          out.ms = r.ms || null;
          out.series = r.ok ? r.series.length : 0;
          out.onCanvas = r.ok ? (r.verified || null) : null;
          out.detail = r.ok ? window.TraderRun.summarize(r) : r.reason;
          if (!r.ok) out.error = r.error || null;
          break;
        }
        case 'browse': {
          /* Family bubbles disclose concept lists; the separate "Browse all" button holds indicator
             scripts. Empty `family` means the all-concepts bubble. Keep the agent readout aligned with
             the exact list visible in the pane rather than counting the hidden indicator list. */
          const body = document.getElementById('browse-body');
          const indicatorList = document.getElementById('browse-list');
          const conceptsList = document.getElementById('browse-concepts-list');
          if (!body || !indicatorList || !conceptsList) {
            out.detail = 'this build has no catalogue list — the Library search is the door';
            break;
          }
          const conceptMode = command.family !== undefined;
          const want = String(command.family || '');
          if (conceptMode) {
            // Family bubbles are built from /api/families on first open; wait for that fetch before
            // looking up the requested key so a first-use browse cannot silently select nothing.
            if (typeof toggleBrowse === 'function' && !document.querySelector('.browse__fam')) {
              toggleBrowse(true);
              for (let i = 0; i < 20 && !document.querySelector('.browse__fam'); i++) {
                await new Promise((rr) => setTimeout(rr, 150));
              }
            }
            const chip = Array.from(document.querySelectorAll('.browse__fam'))
              .find((button) => button.dataset.family === want);
            if (!chip) {
              out.detail = 'no Library family bubble for "' + want + '"';
              break;
            }
            const alreadyOpen = typeof familyConceptState !== 'undefined' &&
              familyConceptState.open && familyConceptState.family === want;
            if (!alreadyOpen) chip.click();
          }
          if (command.show) {
            const openButton = document.getElementById('lib-open');
            if (openButton) openButton.click();
            else if (typeof toggleBrowse === 'function') toggleBrowse(true);
          }
          const list = conceptMode ? conceptsList : indicatorList;
          const state = conceptMode ? familyConceptState : browseState;
          // Paging is a door too: page the same list the operator can see, never its hidden sibling.
          if (command.more) {
            const more = document.getElementById(conceptMode ? 'browse-concepts-more' : 'browse-more');
            if (more && !more.disabled && !more.parentElement.classList.contains('is-done')) more.click();
            else out.noMore = true;
          }
          const count = () => list.querySelectorAll('.row').length;
          let last = count();
          let sawChange = false;
          for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 150));
            const now = count();
            if (now !== last) { sawChange = true; last = now; continue; }
            if (state.loading || state.queued) continue;
            if (now > 0) break;
            if (sawChange || i >= 12) break;
          }
          out.ok = true;
          const family = conceptMode ? familyConceptState.family : browseState.family;
          const open = !body.classList.contains('view--hidden') &&
            (!conceptMode || familyConceptState.open);
          out.detail = (conceptMode ? 'library concepts: ' : 'indicator catalogue: ') + count() +
            (conceptMode ? ' concept(s) on screen' : ' indicator(s) on screen') +
            (family ? ' · family ' + family : ' · all families') + (open ? ' · open' : ' · closed');
          out.browse = {
            kind: conceptMode ? 'concepts' : 'indicators', rows: count(), family: family || '', open,
          };
          break;
        }
        case 'open': {
          /* Open one Library row's detail pane — the agent's version of clicking a result. Reading
             only: nothing is run, mounted or ordered, and the pane's action buttons stay untouched. */
          const kind = command.kind === 'indicator' ? 'indicator' : 'concept';
          if (typeof toggleBrowse === 'function') toggleBrowse(true);
          if (kind === 'concept') {
            for (let i = 0; i < 20 && !document.querySelector('.browse__fam'); i++) {
              await new Promise((r) => setTimeout(r, 150));
            }
            const want = String(command.family || '');
            const chip = Array.from(document.querySelectorAll('.browse__fam'))
              .find((button) => button.dataset.family === want);
            const alreadyOpen = typeof familyConceptState !== 'undefined' &&
              familyConceptState.open && familyConceptState.family === want;
            if (chip && !alreadyOpen) chip.click();
          }
          const scope = kind === 'concept' ? '#browse-concepts-list' : '#browse-list';
          let row = null;
          for (let i = 0; i < 40 && !row; i++) {
            await new Promise((r) => setTimeout(r, 150));
            row = Array.from(document.querySelectorAll(scope + ' .row'))
              .find((button) => button.dataset.slug === command.slug);
          }
          if (!row) {
            out.detail = 'no ' + kind + ' row for "' + command.slug + '" is on screen';
            break;
          }
          row.click();
          const detail = document.getElementById('detail');
          const titleOf = () => ((detail && detail.querySelector('.detail__title')) || {}).textContent || '';
          for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 150));
            if (titleOf() && !/Loading…/.test(titleOf())) break;
          }
          out.ok = true;
          out.detail = 'opened ' + kind + ' “' + titleOf() + '” in the detail pane';
          out.opened = { slug: command.slug, kind, title: titleOf() };
          break;
        }
        case 'mode': {
          out.ok = true;
          out.detail = 'the console is chart-first: the <> control rides Vela\'s own toolbar ' +
            '(resting in the topbar on the bare-chart path), the Library and Details open from ' +
            'the topbar, and every door runs the same landasan (window.TraderRun)';
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
