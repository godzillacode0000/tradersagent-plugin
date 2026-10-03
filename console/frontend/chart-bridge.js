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
                   'mode', 'script', 'palette', 'browse', 'open', 'rect', 'drawer',
    'bars',
                   'signals',
                   'layout',
                   'natives',
                   'studies',
                   'indicators',
                   'fullscreen',
                   'theme',
                   'overlay',];

  /* The console mints a token and requires it on POSTs. This page usually lives in an IFRAME on
     another origin, where the SameSite cookie the server also sets is dropped by third-party-cookie
     blocking — so bootstrap the token over a same-origin GET (a cross-site page can send that
     request but cannot READ the answer: no CORS for its origin) and send it as a header. */
  let TOKEN = null;
  const token = async () => {
    if (TOKEN !== null) return TOKEN;
    try {
      const res = await fetch('/api/session', { cache: 'no-store' });
      const payload = await res.json();
      TOKEN = (payload && payload.data && payload.data.token) || '';
    } catch (err) {
      TOKEN = '';
    }
    return TOKEN;
  };

  const api = async (path, body) => {
    const headers = body ? { 'content-type': 'application/json' } : {};
    if (body) {
      const t = await token();
      if (t) headers['X-Trader-Token'] = t;
    }
    const res = await fetch(path, body
      ? { method: 'POST', headers, body: JSON.stringify(body) }
      : { method: 'GET', headers });
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

  /* The active cell of the workspace — where Vela keeps the real removal doors (`removeFromChart`,
     `removeNative`, `removeInstance`, `onChartRows`). `ws.active` is the object in this build; the
     other two names are tried because the bundle grew them at different times. */
  function activeCell() {
    try {
      const ws = (window.__wsApp || {}).ws;
      if (!ws) return null;
      for (const name of ['activeCell', 'active', 'cell']) {
        try {
          const v = typeof ws[name] === 'function' ? ws[name]() : ws[name];
          if (v && typeof v === 'object') return v;
        } catch (err) { /* opaque */ }
      }
      const cells = typeof ws.cells === 'function' ? ws.cells() : ws.cells;
      return (Array.isArray(cells) ? cells[0] : null) || null;
    } catch (err) { return null; }
  }

  /* What is actually ON the chart — read from every place it can be, each row labelled with the
     reader that saw it.

     The bridge's ledger only knows the natives IT added and `presentNativeIndicators()` only knows
     Vela's own names, so a script mounted from the Library (Run PineTS / Add to chart) sat on screen
     while `chart_state` said `series 0 · natives none` — and "clear all indicators" reported a clean
     chart the operator could see was not clean (measured 26 Sep 2026: the pane showed CRT boxes and
     "Manipulation" labels, the console showed nothing). A single reader is a single blind spot, so
     the answer names its sources instead of flattening them into one hopeful list. */
  function paneStudies() {
    const rows = [];
    const byName = new Map();
    const add = (name, source) => {
      const label = String(name == null ? '' : name).trim();
      if (!label || /^vol(ume)?$/i.test(label)) return;
      const key = label.toLowerCase();
      const seen = byName.get(key);
      if (seen) {
        /* One EMA is one indicator, however many readers can see it: the count has to agree with
           the chip's ("1 indicator"), so the name is the key and the readers are listed under it. */
        if (!seen.sources.includes(source)) seen.sources.push(source);
        seen.source = seen.sources[0];
        return;
      }
      const row = { name: label, source, sources: [source] };
      byName.set(key, row);
      rows.push(row);
    };
    const c = chart();
    try {
      const info = (c && typeof c.inspect === 'function') ? (c.inspect() || {}) : {};
      const list = Array.isArray(info.indicators) ? info.indicators : [];
      for (const i of list) add(i && (i.title || i.id || i.type || i.name), 'study');
    } catch (err) { /* opaque */ }
    try {
      const cell = activeCell();
      const onChart = (cell && typeof cell.onChartRows === 'function') ? (cell.onChartRows() || []) : [];
      for (const r of onChart) add(r && (r.title || r.name || r.id || r.slug || r.type), 'cell');
    } catch (err) { /* opaque */ }
    try {
      for (const n of ((window.TraderRun && window.TraderRun.list) ? window.TraderRun.list() : [])) add(n, 'overlay');
    } catch (err) { /* opaque */ }
    try {
      for (const n of ((window.PineTSPaint && window.PineTSPaint.added) || [])) add(n, 'paint');
    } catch (err) { /* opaque */ }
    try {
      const natives = (c && typeof c.presentNativeIndicators === 'function')
        ? (c.presentNativeIndicators() || []) : [];
      for (const n of natives) add(n, 'native');
    } catch (err) { /* opaque */ }
    return rows;
  }

  /* One study, one row: `EMA (study/native/cell)` reads as one indicator seen three ways. */
  const studyTag = (r) => r.name + ' (' +
    ((r.sources && r.sources.length ? r.sources : [r.source]).join('/')) + ')';

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
        /* The whole truth about "what is on the chart", not only Vela's names — the pane's own chip
           counts all three readers, so a heartbeat that reports one of them is how "clear all
           indicators" came back clean while the operator looked at CRT boxes (26 Sep). */
        studies: paneStudies(),
        series: inspect().series,
        drawings: inspect().drawings,
        bars: barsList.length || null,
        actions: ACTIONS,          // what this page can actually do (see ACTIONS above)
        layout: 'workspace',
        build: BUILD,              // the frontend files this frame loaded (see /api/build)
        viewer: VIEWER,            // which console instance this is — a stale frame says so
        /* Why the heartbeat reads what it reads: after the workspace swap a page can fall back to the
           bare chart and still look healthy (the pane paints, the bridge says "—"), so the reason is
           part of the state instead of a guess. */
        diag: (() => {
          try {
            const app = window.__wsApp || {};
            const ws = app.ws || null;
            const cells = ws && typeof ws.cells === 'function' ? ws.cells() : null;
            return {
              wsReady: !!ws,
              wsError: app.error ? String((app.error && app.error.message) || app.error).slice(0, 160) : null,
              cells: cells ? cells.length : null,
              activeChart: !!(app.activeChart && app.activeChart()),
              consoleChart: !!window.__consoleChart,
              /* WHICH Pine engine this page runs. vela-pinets bundles its own unpatched copy of the
                 fork's engine, so "the patches are in the bundle" is not the same claim as "the chart
                 runs them" (the audit's #17). Reported, not asserted. */
              engine: app.engineSource || null,
            };
          } catch (err) { return { diagErr: String(err && err.message || err).slice(0, 120) }; }
        })(),
      });
    } catch (err) {
      /* a failed heartbeat means "no chart open" on the agent's side, which is the truth */
    }
  }

  /** Did anything actually LAND on the canvas? "The engine ran" is a different question, and the
   *  two were conflated until the audit's follow-up (#55 and its review): a series-only script whose
   *  paths the overlay painted was reported as "nothing landed", because the test summed the
   *  container counts and state() has no polyline count. The honest read-back is the overlay's own
   *  `has`/`ink` — pixels actually painted, which counts paths and polylines — with the container
   *  counts (and the draw pass's own tally) as fallbacks for an older build or an unreadable canvas.
   *
   *  `paintedDetail` is the ONE implementation; every door that runs a script asks it. Round 3's
   *  check found `apply` carrying its own copy without the draw-pass fallback — a real oversight,
   *  not a deliberate split — so the same script could answer differently depending on which door
   *  ran it. There is exactly one rule now. */
  function paintedDetail(r) {
    const detail = { ok: false, overlay: false, native: false, series: 0 };
    if (!r || !r.ok) return detail;
    detail.series = (r.series || []).length;
    detail.native = !!(r.paint && r.paint.added);
    const v = r.verified || null;
    const drew = r.drew || null;
    detail.overlay = !!(
      (v && (v.has === true || (typeof v.ink === 'number' && v.ink > 0) ||
        (v.boxes + v.lines + v.labels + (v.tablesVisible === true ? (v.tables || 0) : 0)) > 0)) ||
      // `drew` is the run's own count, before anything is on screen — keep only the shapes the
      // overlay canvas paints (a count of tables here was the second false-success path: round 6).
      (drew && (drew.boxes + drew.lines + drew.labels + (drew.polylines || 0)) > 0));
    detail.ok = detail.overlay || detail.native;
    return detail;
  }
  const paintedAnything = (r) => paintedDetail(r).ok;
  /* A strategy() script with nothing to draw is a different kind of success (metrics ran). One rule,
     shared by apply, draw and script, so the same script reads the same through every door. */
  const metricsOnly = (r) => !paintedDetail(r).ok && !!r.strategy;

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
          /* `ok` means the chart now shows something — the same read-back rule as `draw` and `add`,
             through the one shared implementation (`paintedDetail`). The run can succeed and still
             paint nothing (its conditions never fired, or the overlay refused), and an agent that
             read ok:true went looking for a picture that was not there (the audit's #55).
             A strategy() script with no plot is a different kind of success — its metrics ran, there
             is just nothing to draw — so `result: 'metrics'` marks that instead of reading as a
             failure (round 3's question #1; answered in round 4). */
          const pd = paintedDetail(r);
          out.ok = pd.ok;
          out.ran = true;
          out.painted = pd;
          out.series = pd.series;
          out.added = pd.native ? r.paint.added.title : null;
          out.ms = r.ms;
          out.strategy = r.strategy || null;          // a strategy() script's own metrics
          out.ctor = r.ctor || null;                  // which PineTS constructor ran (context matters)
          out.onCanvas = r.verified || null;
          if (metricsOnly(r)) {
            out.result = 'metrics';
            out.detail = '◆ ran, metrics only (no plot/overlay) · ' + window.TraderRun.summarize(r);
          } else {
            out.detail = out.ok
              ? window.TraderRun.summarize(r)
              : 'ran, but nothing landed on the chart · ' + window.TraderRun.summarize(r);
          }
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
          out.ok = paintedAnything(r);
          out.ms = r.ms;
          out.series = r.series.length;
          out.added = r.paint && r.paint.added ? r.paint.added.title : null;
          out.onCanvas = v || null;
          if (metricsOnly(r)) {
            out.result = 'metrics';
            out.detail = '◆ ran, metrics only (no plot/overlay) · ' + window.TraderRun.summarize(r);
          } else out.detail = window.TraderRun.summarize(r);
          break;
        }
        case 'clear': {
          if (window.ChartOverlay) window.ChartOverlay.clear();
          if (window.TraderRun) window.TraderRun.reset();   // legend + badge forget with the overlay
          const removed = (window.PineTSPaint && window.PineTSPaint.clear) ? window.PineTSPaint.clear() : 0;
          /* Same rule as every other mutation: report the state after the call, not the intent. */
          const left = window.ChartOverlay && window.ChartOverlay.state ? window.ChartOverlay.state() : null;
          const stillPainted = (window.PineTSPaint && window.PineTSPaint.added) ? window.PineTSPaint.added : [];
          const onChart = paneStudies();
          out.ok = onChart.length === 0;
          out.natives = (c && typeof c.presentNativeIndicators === 'function') ? c.presentNativeIndicators() : null;
          out.studies = onChart;
          out.detail = 'painted natives removed: ' + removed +
            ' · overlay now: ' + (left ? left.boxes + '/' + left.lines + '/' + left.labels : 'unknown') +
            // `clear` removes the overlay + what OUR paint layer added — an indicator the agent added
            // with `add` (or the operator added by hand) is not ours to remove, and the answer says so.
            // The list is the PANE's truth, not `presentNativeIndicators()` alone: a script mounted
            // from the Library is not a Vela name, and reporting natives-only called a chart clean
            // while CRT boxes were on it (26 Sep).
            ' · chart still carries: ' + (onChart.length
              ? onChart.map(studyTag).join(', ')
              : 'nothing');
          break;
        }
        case 'remove': {
          /* Remove what is on the chart: `native` names one, `all: true` takes everything off.
             `clear` deliberately leaves operator-added studies alone, so this is the door for "take
             them off" — and Vela's own indicators control is the only thing that can. Which removal
             method that control exposes is not documented in this build, so the doors are tried in
             order and the report names the one that worked, read back from the chart.

             The bookkeeping here is the PANE's truth (`paneStudies()`), not `presentNativeIndicators()`
             alone: a script mounted from the Library is not a Vela native name, and a report that
             only counts natives says "nothing removed" about boxes the operator can see. */
          const c = chart();
          const read = () => (c && typeof c.presentNativeIndicators === 'function')
            ? (c.presentNativeIndicators() || []) : [];
          const before = read();
          const beforeAll = paneStudies();
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

          /* `all` means ALL. A script mounted from the Library (Run PineTS / Add to chart) is not in
             the ledger and not a Vela native name — its boxes and labels live on the console's own
             overlay / paint layer, and the layer is all-or-nothing (`ChartOverlay` exposes
             apply/clear/state, no per-item removal). So the layer is wiped here, after the studies,
             and the report says it happened: the operator asked for a clean chart and a wipe he did
             not hear about is worse than one he did. */
          let overlayWiped = null;
          if (command.all) {
            const layer = (window.ChartOverlay && window.ChartOverlay.state) ? window.ChartOverlay.state() : null;
            const runs = (window.TraderRun && window.TraderRun.list) ? window.TraderRun.list() : [];
            const painted = (window.PineTSPaint && window.PineTSPaint.added) || [];
            if ((layer && (layer.boxes + layer.lines + layer.labels) > 0) || runs.length || painted.length) {
              try { if (window.ChartOverlay && window.ChartOverlay.clear) window.ChartOverlay.clear(); } catch (err) { tried.push('overlay ✗ ' + (err && err.message)); }
              try { if (window.TraderRun && window.TraderRun.reset) window.TraderRun.reset(); } catch (err) { tried.push('runs ✗ ' + (err && err.message)); }
              try { if (window.PineTSPaint && window.PineTSPaint.clear) window.PineTSPaint.clear(); } catch (err) { tried.push('paint ✗ ' + (err && err.message)); }
              overlayWiped = {
                boxes: layer ? layer.boxes : 0, lines: layer ? layer.lines : 0, labels: layer ? layer.labels : 0,
                runs: runs, painted: painted,
              };
              await new Promise((r) => setTimeout(r, 400));
            }
          }
          after = paneStudies();
          const afterNames = after.map((r) => r.name);
          out.studies = after;
          out.ok = after.length < beforeAll.length;

          /* The answer a person (or the agent) reads first: what actually came off, and what the chart
             carries now. The door-by-door trace is only worth showing when nothing was removed. */
          const gone = beforeAll.filter((r) => !afterNames.includes(r.name));
          out.detail = (gone.length ? 'removed ' + gone.map(studyTag).join(', ')
                                    : 'nothing removed') +
                       (overlayWiped ? ' · overlay cleared: ' + overlayWiped.boxes + '/' + overlayWiped.lines + '/' +
                         overlayWiped.labels + ' + ' + (overlayWiped.runs.length + overlayWiped.painted.length) +
                         ' run(s)' : '') +
                       ' · chart now carries: ' + (afterNames.join(', ') || 'nothing') +
                       (out.ok ? '' : ' · tried: ' + (tried.join(', ') || 'nothing'));
          /* A name that IS on the chart but is not a native (a Library run, say) must not read as
             "nothing removed" with no reason: that is the case the operator hit on 26 Sep. */
          const wanted = String(want || '').toLowerCase();
          const hint = !out.ok && wanted
            ? beforeAll.filter((r) => r.name.toLowerCase().includes(wanted) && r.source !== 'native')
            : [];
          if (hint.length) {
            out.detail += ' · "' + hint[0].name + '" rides the ' + hint[0].source +
              ' layer (a script, not a Vela study): that layer is all-or-nothing — `all: true` or ' +
              '`clear` takes it off';
          }
          break;
        }
        /* The bars the chart is showing, for anyone who needs the same series the eye sees —
           the backtest engine above all. This is why there is no fourth klines client: the chart
           already holds the truth, so the agent asks the chart instead of Binance. */
        case 'bars': {
          if (!c || typeof window.chartBars !== 'function') throw new Error('no chart on this page');
          const all = await window.chartBars();
          if (!all || !all.length) throw new Error('the chart has no bars yet');
          const want = Math.max(1, Math.min(5000, Number(command.count) || all.length));
          const bars = all.slice(-want).map((b) => ({
            time: b.time != null ? b.time : (b.t != null ? b.t : null),
            open: b.open, high: b.high, low: b.low, close: b.close,
            volume: b.volume != null ? b.volume : 0,
          }));
          out.ok = true;
          out.bars = bars;
          out.count = bars.length;
          const m = marketFromDom();
          out.symbol = m.symbol || null;
          out.timeframe = m.timeframe || null;
          out.detail = `read ${bars.length} bars off the chart`;
          break;
        }

        /* What OUR layer holds right now. A pan cannot be judged by eye — two readings of the same
           screenshot disagreed by 35 px (3 Oct) — so the follow loop counts its own repaints and this
           read-only door hands the count back: read it, drag the chart, read it again. */
        case 'overlay': {
          const st = (window.ChartOverlay && window.ChartOverlay.state) ? window.ChartOverlay.state() : null;
          out.ok = !!st;
          out.overlay = st;
          out.detail = st
            ? ('overlay: ' + st.boxes + ' box / ' + st.lines + ' line / ' + st.labels + ' label · repaints ' +
               st.repaints + ' · ink ' + st.ink + ' · has ' + st.has)
            : 'no ChartOverlay on this page';
          break;
        }

        /* A Pine script's own events, for the backtest engine. PineTS already computes the
           strategy's summary; this op hands over the trades behind it so VectorBT can price them
           properly (fees, sizing, equity) instead of trusting a summary. */
        case 'signals': {
          const pine = String(command.pine || '');
          if (!pine.trim()) throw new Error('no Pine source in the command');
          if (!c || typeof window.chartBars !== 'function') throw new Error('no chart on this page');
          const r = await window.TraderRun.run(pine, 'agent');
          if (!r.ok) {
            out.detail = r.reason || 'not runnable: unknown';
            out.error = r.error || null;
            break;
          }
          const st = r.strategy || null;
          out.ok = true;
          out.strategy = st;
          out.trades = (st && st.trades) || [];
          out.count = out.trades.length;
          out.bars = r.bars;
          const m = marketFromDom();
          out.symbol = m.symbol || null;
          out.timeframe = m.timeframe || null;
          out.detail = 'ran ' + r.bars + ' bars · ' + out.trades.length + ' closed trades off the script';
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
        case 'layout': {
          /* The grid. Vela's own layout picker writes through ws.setLayout(), so this door is the
             same call — and once the page is up it is the ONLY way in: `layout: false` at boot sets
             monoLayout, which pins the grid for the life of the page (see workspace.js). The preset
             is validated HERE, before the call, because setLayout() throws on an unknown id. */
          const wsa = window.__wsApp;
          const ws = wsa && wsa.ws;
          if (!ws || typeof ws.setLayout !== 'function') {
            out.detail = 'this page has no workspace shell (bare chart) — the grid lives in the ' +
              'workspace, so there is nothing to lay out';
            break;
          }
          if (ws.monoLayout) {
            out.detail = 'this page booted with layout:false (monoLayout) — setLayout() is a no-op ' +
              'in this frame; workspace.js must boot with a preset before the grid can change';
            break;
          }
          const readLayout = () => {
            try {
              const def = ws.layout || null;
              const cells = (typeof ws.cells === 'function' ? ws.cells() : []) || [];
              return {
                id: (def && def.id) || null,
                label: (def && def.label) || null,
                cells: cells.map((c) => ({ id: c && c.id, symbol: (c && c.symbol) || null,
                                           timeframe: (c && c.timeframe) || null })),
              };
            } catch (err) { return null; }
          };
          const want = String(command.layout == null ? '' : command.layout).trim().toLowerCase();
          const PRESETS = ['1', '2h', '2v', '4', '8'];
          if (!want) {
            /* No preset = read the grid, don't touch it (a read must never be a write). */
            const now = readLayout();
            if (!now) { out.detail = 'the workspace did not answer'; break; }
            out.ok = true;
            out.layout = now.id;
            out.cells = now.cells.length;
            const cur = now.cells.map((c) => (c.symbol || '?') + ' ' + (c.timeframe || '?')).join(' · ');
            out.detail = 'layout ' + now.id + (now.label ? ' (' + now.label + ')' : '') + ' · ' +
              now.cells.length + ' cell(s)' + (cur ? ': ' + cur : ' — none built yet');
            break;
          }
          if (!PRESETS.includes(want) && !/^g[1-4]x[1-4]$/.test(want)) {
            out.detail = 'unknown layout "' + want + '" — use ' + PRESETS.join(', ') +
              ', or a custom grid g<cols>x<rows> (1–4 each)';
            break;
          }
          const before = readLayout();
          ws.setLayout(want);
          /* Cells build on a bars fetch, so the grid answers a beat later — and the cell's own
             symbol/timeframe getters are the evidence, not the id we asked for. */
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          let after = readLayout();
          for (let i = 0; i < 12 && after && after.cells.length === 0; i++) { await wait(150); after = readLayout(); }
          if (!after) { out.detail = 'the workspace did not answer after setLayout(' + want + ')'; break; }
          out.ok = true;
          out.layout = after.id;
          out.cells = after.cells.length;
          const shown = after.cells.map((c) => (c.symbol || '?') + ' ' + (c.timeframe || '?')).join(' · ');
          out.detail = 'layout ' + (before && before.id ? before.id + ' → ' : '') + after.id +
            (after.label ? ' (' + after.label + ')' : '') + ' · ' + after.cells.length + ' cell(s)' +
            (shown ? ': ' + shown : ' — none built yet');
          break;
        }
        /* What the pane is carrying right now — every reader, labelled with the one that saw it, plus
           the removal doors the active cell actually exposes. Read-only, and the door the agent
           should ask BEFORE saying a chart is clean or after saying it cleared something. */
        case 'studies': {
          const rows = paneStudies();
          const cell = activeCell();
          const doors = [];
          for (const name of ['removeFromChart', 'removeNative', 'removeInstance', 'dropInstance',
                               'onChartRows', 'libraryRows', 'addToChart']) {
            const has = cell && (typeof cell[name] === 'function');
            if (has) doors.push(name + '()');
          }
          out.ok = true;
          out.studies = rows;
          out.count = rows.length;
          out.doors = doors;
          const bySource = {};
          for (const r of rows) bySource[r.source] = (bySource[r.source] || 0) + 1;
          out.detail = rows.length
            ? rows.length + ' row(s) on the chart: ' + rows.map(studyTag).join(' · ')
            : 'nothing on the chart — no study, no overlay run, no painted native';
          out.detail += doors.length ? ' · cell doors: ' + doors.join(' ') : ' · the cell exposes no removal door';
          break;
        }

        /* Full screen for the chart (27 Sep): press the same button the operator has, from here.
           `fullscreen: true` gives the chart the page (and the display, where the host allows it);
           `false` brings the console's chrome back. The answer says which half landed. */
        case 'fullscreen': {
          const want = command.on !== false && command.fullscreen !== false;
          if (typeof window.setChartFullscreen !== 'function') {
            out.detail = 'this build has no full-screen control (older frontend)';
            break;
          }
          const state = window.setChartFullscreen(want);
          out.ok = true;
          out.fullscreen = state;
          out.detail = 'Chart ' + (state.fullscreen ? 'full screen' : 'back in the pane')
            + (state.fullscreen ? (state.native ? ' · the console took the display' : ' · page only (the host refused native fullscreen)') : '')
            + ' · ✓ ' + (state.fullscreen ? 'Esc or the ✕ comes back' : 'the console chrome is back');
          break;
        }

        case 'theme': {
          /* The console's ◐ switch, reachable from the agent's side. One call moves both systems —
             our --lx-* palette, Vela's chrome and the chart's parked colours — because it runs the
             SAME applyTheme the operator's toggle runs (window.__app.applyTheme), so a theme set here
             cannot drift from one set by hand. No argument reports what is worn now. */
          const app = window.__app || {};
          if (typeof app.applyTheme !== 'function') {
            out.detail = 'this build has no theme control (older frontend)';
            break;
          }
          const want = String(command.theme || '').trim().toLowerCase();
          const worn = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
          if (want && want !== 'light' && want !== 'dark') {
            out.detail = "theme must be 'light' or 'dark' (got " + JSON.stringify(command.theme) + ')';
            break;
          }
          const was = worn();
          if (want) {
            app.applyTheme(want);
            await new Promise((r) => setTimeout(r, 350));   // let the palette + chrome land
          }
          const theme = worn();
          let stored = 'unset';
          try { stored = localStorage.getItem('luxalgo-web:theme') || 'unset'; } catch (err) { stored = 'unreadable'; }
          /* What "light" restores: the operator's own parked palette, if one was found at boot. Worth
             reporting — "the console is light" and "the chart is light" are two different claims. */
          let parked = null;
          try {
            const p = window.ChartPalette?.parked?.();
            if (p) parked = { background: p.layout?.background || null, up: p.candles?.upColor || null,
                              down: p.candles?.downColor || null };
          } catch (err) { parked = null; }
          out.ok = true;
          out.theme = { theme, was, stored, changed: theme !== was, set: !!want, parked };
          out.detail = (theme === 'light' ? 'Light theme' : 'Dark theme')
            + (was !== theme ? ' · was ' + was : '')
            + (want ? ' · stored ' + stored : ' · wearing it now')
            + (parked ? ' · light restores the parked palette (bg ' + parked.background + ')' : '');
          break;
        }

        case 'natives': {
          /* What this build can put on the chart from its own side — Vela's natives for THIS market.
             Read-only, and the copy the console's Indicators panel shows (BUILT-INS) comes from the
             same call, so the panel and this answer cannot drift. */
          const nc = chart() || (window.__wsApp && window.__wsApp.activeChart && window.__wsApp.activeChart());
          if (!nc || typeof nc.availableNativeIndicators !== 'function') {
            out.detail = 'this page has no native catalogue — the frame is on an older frontend build';
            break;
          }
          let cats = [];
          try { cats = (await nc.availableNativeIndicators()) || []; }
          catch (err) { out.detail = 'the native catalogue failed: ' + ((err && err.message) || err); break; }
          const onChart = (typeof nc.presentNativeIndicators === 'function') ? nc.presentNativeIndicators() : [];
          out.ok = true;
          out.count = cats.length;
          out.natives = onChart;
          out.catalog = cats.map((r) => ({ type: r.type, title: r.title || r.type,
                                           supported: r.supported !== false, present: Boolean(r.present),
                                           beta: Boolean(r.beta) }));
          out.detail = cats.length + ' built-in(s) in this build · on the chart: ' +
            (onChart.join(', ') || 'none');
          break;
        }
        case 'indicators': {
          /* The Indicators surface — ONE surface now (3 Oct, the operator's doc §1): the drawer holds
             ★ favourites, Built-ins 76 and the Library 807, and Vela's own button is the door. The ⌗
             modal is deleted, so this action drives the DRAWER through its own API (window.libDrawer)
             and reports what the list actually holds — a drawer that opened is not a drawer that
             filled. */
          const ld = window.libDrawer;
          if (!ld || typeof ld.open !== 'function') {
            out.detail = 'this page has no drawer — reload the console to pick up the newer frontend files';
            break;
          }
          const pause = (ms) => new Promise((r) => setTimeout(r, ms));
          if (command.show === false) {
            ld.open(false);
            out.ok = true;
            out.detail = 'Indicators surface closed';
            break;
          }
          ld.open(true);
          /* The old section names keep working: favourites/builtins narrow the list to that half,
             anything else shows the whole catalogue. They are the drawer's chips. */
          const section = String(command.section || '').trim().toLowerCase();
          if (section === 'favorites' || section === 'favourites') ld.family('__fav');
          else if (section === 'builtins' || section === 'built-ins') ld.family('__builtin');
          else if (section) ld.family('');
          if (command.q != null) ld.search(command.q);
          /* `family: "smc-ict"` narrows to one family of the catalogue; `""` (or "all") shows every
             row again. */
          if (command.family != null) ld.family(command.family);
          /* Star / unstar from this side: `star: "library:slug"`. The operator's ☆ and this are one
             list, so what the agent keeps is what the drawer shows. */
          let starred = null;
          const starSpec = String(command.star || command.unstar || '').trim();
          if (starSpec) starred = ld.star(starSpec, !command.unstar) || null;
          /* Mount a built-in straight from the surface when asked: `mount: "native:supertrend"` is
             the SAME mountNative a click on its row runs, so the door cannot pass while the click
             path is broken. Library rows are not mounted this way — they keep the Details view with
             its Run PineTS / Add to chart buttons. */
          let mounted = null;
          const mountSpec = String(command.mount || '').trim();
          if (mountSpec) {
            const cut = mountSpec.indexOf(':');
            const kind = cut > 0 ? mountSpec.slice(0, cut).toLowerCase() : 'native';
            const id = cut > 0 ? mountSpec.slice(cut + 1) : mountSpec;
            if (kind === 'library') {
              out.detail = 'library rows mount through the Details view (open "' + id + '"), not ' +
                'through this door — they carry Pine that PineTS must run';
              break;
            }
            if (typeof window.mountNative !== 'function') {
              out.detail = 'this build cannot mount from the surface (older frontend)';
              break;
            }
            const row = ld.rows().find((r) => r.slug === id);
            mounted = window.mountNative(id, (row && row.name) || id);
            out.added = mounted ? id : null;
          }
          /* The catalogue walk is a real network wait the first time on a machine (~25 s), so give a
             loading catalogue up to 45 s to answer instead of 6 — the alternative is reporting
             "0 rows" for a list that is about to fill. */
          let seen = ld.state();
          const deadline = Date.now() + (seen.catalogue === 'loading' ? 45000 : 6000);
          while (seen.catalogue === 'loading' && Date.now() < deadline) {
            await pause(150);
            seen = ld.state();
          }
          const rows = ld.rows();
          out.ok = true;
          out.indicators = {
            open: seen.open,
            detail: seen.detail,
            section: section || 'library',
            query: seen.q,
            family: seen.family || '',
            families: seen.families || 0,
            rows: rows.slice(0, 60).map((r) => ({
              kind: r.__native ? 'native' : 'library',
              id: r.slug,
              label: String(r.name || r.slug).trim(),
              family: r.family || '',
              /* The reading the ⌗ modal's cards used to unfold — the catalogue's own description. */
              reading: r.description || '',
              onChart: Boolean(r.present),
              starred: Boolean(r.starred),
              /* The catalogue's own preview URL — the door proves a picture EXISTS for this row
                 (the ⌗ modal read this off the rendered card; the drawer keeps no <img> for rows it
                 has not painted, so the data is the honest read here). */
              shot: Boolean(r.image_url),
            })),
            builtins: seen.builtins,
            catalogueTotal: seen.total,
            favourites: seen.favourites,
            starred: starred,
            mounted: mounted ? { id: mountSpec } : null,
            stillLoading: seen.catalogue === 'loading',
          };
          out.detail = 'Indicators · ' + (seen.detail ? 'detail view' : (section || 'library')) +
            ' · ' + seen.rows + ' row(s) · built-ins ' + seen.builtins + ' · catalogue ' + seen.total +
            ' · starred ' + seen.favourites +
            (starred ? ' · ' + (starred.starred ? 'starred ' : 'unstarred ') + starred.slug : '') +
            (mounted ? ' · mounted ' + mountSpec : '') +
            ' · ' + (seen.open ? 'open' : 'closed');
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
          if (command.theme === 'light' || command.theme === 'dark') {
            /* One verb, both systems — the same call the operator's ◐ toggle makes, so a theme set
               from the agent's side cannot drift from one set by hand. */
            if (window.__app && typeof window.__app.applyTheme === 'function') {
              window.__app.applyTheme(command.theme);
            } else {
              document.documentElement.dataset.theme = command.theme;
              try { localStorage.setItem('luxalgo-web:theme', command.theme); } catch (err) { /* private mode */ }
              try { const ws = window.__wsApp; if (ws && ws.setTheme) ws.setTheme(command.theme); } catch (err) { /* bare chart */ }
              if (window.ChartPalette && window.ChartPalette.apply) window.ChartPalette.apply(command.theme);
            }
            await new Promise((r) => setTimeout(r, 350));
            after = read() || before;
            note = ' · [theme set to ' + command.theme + ' → bg ' + after.background +
                   ' · stored ' + (localStorage.getItem('luxalgo-web:theme') || 'unset') + ']';
          } else if (command.try) {
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
          /* The `<>` control is a Vela widget action now (3 Oct): there is no button in the DOM for
             this door to click, so it goes through the page's own control surface and reports the
             pane's real state instead of assuming a click landed. */
          const sp = window.scriptPane;
          if (!sp || typeof sp.state !== 'function') {
            out.detail = 'this page has no script pane control — reload the console to pick up the ' +
              'newer frontend files';
            break;
          }
          /* The bridge could open the editor but never close it (23 Sep pane audit). `close: true`
             makes the door symmetric: the state says whether the pane is up. */
          if (command.close) {
            if (sp.state().open) sp.close();
            out.ok = true;
            out.detail = 'script pane closed';
            break;
          }
          if (!sp.state().open) sp.open();
          /* The CLI speaks `source` (bin/trader-chart), the MCP tools speak `pine`: read both, or
             `trader-chart script show --pine FILE` silently opened an empty editor. `mode: show`
             loads the editor and stops there — running is `draw`/`native`/no mode at all. */
          const pine = String(command.pine || command.source || '');
          const mode = String(command.mode || '');
          if (!pine.trim()) {
            out.ok = true;
            out.detail = 'script pane opened — paste Pine and press Run, or send ' +
              '{"action":"script","pine":"…"} to run it right away';
            break;
          }
          if (mode === 'show') {
            const box = document.getElementById('script-src');
            if (!box) {
              out.ok = false;
              out.detail = 'no editor on this page — the script pane did not open';
              break;
            }
            box.value = pine;
            box.dispatchEvent(new Event('input', { bubbles: true }));
            out.ok = true;
            out.lines = pine.split('\n').length;
            out.detail = 'loaded ' + out.lines + ' line(s) into the editor — press Run to execute';
            break;
          }
          const r = await window.TraderRun.run(pine, String(command.name || 'agent-script'));
          out.ok = paintedAnything(r);         // the same read-back rule as `apply` and `draw`
          out.ms = r.ms || null;
          out.series = r.ok ? r.series.length : 0;
          out.onCanvas = r.ok ? (r.verified || null) : null;
          if (r.ok && metricsOnly(r)) out.result = 'metrics';
          out.detail = r.ok
            ? (out.ok ? window.TraderRun.summarize(r)
              : metricsOnly(r) ? '◆ ran, metrics only (no plot/overlay) · ' + window.TraderRun.summarize(r)
              : 'ran, but nothing landed on the chart · ' + window.TraderRun.summarize(r))
            : r.reason;
          if (!r.ok) out.error = r.error || null;
          break;
        }
        case 'rect': {
          /* Read-only geometry for the agent: where does a selector sit on screen? Clicks are real
             (ydotool), so they need real coordinates — OCR guesses land on the wrong element when
             the layout shifts (Vela's row hides its cluster while the Details column is open).
             Page CSS pixels map 1:1 to logical screen pixels here: the console fills the window. */
          const sel = String(command.selector || '').trim();
          const node = sel ? document.querySelector(sel) : null;
          if (!node) {
            out.ok = false;
            out.detail = 'no node for ' + (sel || '(empty selector)');
            break;
          }
          const r = node.getBoundingClientRect();
          /* This console can sit inside the app shell's frame: add the frame's own offset so the
             numbers are SCREEN pixels, not just this document's. Cross-origin frames stay at 0. */
          let ox = 0, oy = 0;
          try {
            const fe = window.frameElement;
            if (fe) { const f = fe.getBoundingClientRect(); ox = f.x; oy = f.y; }
          } catch (err) { ox = 0; oy = 0; }
          out.ok = true;
          out.rect = {
            x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height),
            cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
            sx: Math.round(r.x + ox), sy: Math.round(r.y + oy),
            scx: Math.round(r.x + r.width / 2 + ox), scy: Math.round(r.y + r.height / 2 + oy),
            frame: [Math.round(ox), Math.round(oy)],
            hidden: !(r.width && r.height) || getComputedStyle(node).visibility === 'hidden',
          };
          out.detail = sel + ' at ' + out.rect.x + ',' + out.rect.y +
            ' ' + out.rect.w + 'x' + out.rect.h + ' · screen ' + out.rect.scx + ',' + out.rect.scy +
            ' · frame ' + out.rect.frame.join(',');
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
            if (typeof window.openLibraryBrowse === 'function') window.openLibraryBrowse();
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
        case 'drawer': {
          /* Read-only state of the operator's ONE surface (3 Oct). `indicators` reports the modal;
             the drawer is the surface he actually uses, so the agent reads it the same way. The
             drawer's own rect is NOT the truth while the page is occluded — its slide is a CSS
             transition the compositor freezes at the old position — so report the class list and
             the API's state, not getBoundingClientRect. */
          const dEl = document.getElementById('lib-drawer');
          const ds = window.libDrawer && window.libDrawer.state ? window.libDrawer.state() : null;
          out.ok = true;
          out.detail = ds
            ? 'drawer ' + (ds.open ? 'open' : 'closed') + ' · ' + (ds.detail ? 'detail view' : 'list view') +
              ' · rows ' + ds.rows + '/' + ds.total + ' · catalogue ' + ds.catalogue +
              ' · builtins ' + ds.builtins + ' · classes: ' + (dEl ? dEl.className : 'NO ELEMENT')
            : 'no drawer API on this page';
          out.drawer = ds;
          break;
        }
        case 'mode': {
          out.ok = true;
          out.detail = 'the console is chart-first: Vela\'s own Indicators button opens the drawer ' +
            '(the one surface for the catalogue and the built-ins), the <> Script control and full ' +
            'screen are Vela widget actions (plain fallbacks on the bare-chart path), and every ' +
            'door runs the same landasan (window.TraderRun)';
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
    /* Phase 1.3 — the two counts the stale-legend banner compares. `series` is what the chart says
       it is drawing; `natives` is what the API can name. The chart carrying more than the API can
       name means the legend describes a frame the console no longer agrees with. */
    studyCounts: () => {
      const c = chart();
      const series = (inspect() || {}).series || 0;
      let natives = 0;
      try { natives = (c && typeof c.presentNativeIndicators === 'function')
        ? (c.presentNativeIndicators() || []).length : 0; } catch (err) { natives = 0; }
      return { series, natives, mismatch: series > natives };
    },
    streamState: () => ({
      connected: !!stream && stream.readyState === 1,
      pollDelay, lastId: lastCommandId
    })
  };
})();
