/* Phase 7 (3 Oct): the Vela features that only a hand could reach, as agent doors.
   Phase 8 (13 Oct): the Object tree and the Data window — the rail's two panels — join them.

     TaVela.drawing(cmd)     Vela's own drawing tools (76 types: trend line, channel, fib, Gann, Elliott,
                             XABCD, pitchfork, box, text …) — real objects the operator can drag afterwards
     TaVela.view(cmd)        chart type, price scale, countdown, time zone, session, watermark, status line,
                             grid sync, the ? shortcuts panel, the alerts inbox
     TaVela.marks(cmd)       event marks on the time axis, in one named group
     TaVela.objects(cmd)     the Object tree: what is ON the chart (drawings, then indicators) — list,
                             select, show/hide, lock, front/back, duplicate, delete, a drawing's popup
     TaVela.datawindow(cmd)  the Data window: the chart's own readout at the cursor (or the latest bar) —
                             time, OHLC + volume, one section per indicator

   The bridge (chart-bridge.js) only hands the command over; the logic lives here so the bridge stays
   small. This module paints nothing of its own and keeps no timers: a door that changes the chart goes
   through Vela's own setters, then READS THE VALUE BACK — a write is never reported blind (the Phase 1
   lesson: Vela returns a half-made drawing for one anchor on a trend line, and it paints nothing).

   Honest limits: Vela has no call that CREATES a price alert — its inbox only collects the alerts an
   indicator raises with alertcondition(), and the `alerts` setting reads and clears that inbox. The
   Data window describes the cursor's bar, so an arbitrary-bar read is not offered. */
(function () {
  'use strict';

  /* Anchors per drawing type: [min, max]. Read off the live Vela 0.8.1 toolbar (76 types) with a probe
     that adds each type and asks the instance for its anchorSchema(). test_vela_doors.py compares every
     class the bundle states against this table, so a Vela upgrade that changes one fails loudly. */
  const ANCHORS = {
    trendline: [2, 2], hline: [1, 1], ray: [2, 2], extendedline: [2, 2], vline: [1, 1],
    hray: [1, 1], crossline: [1, 1], infoline: [2, 2], trendangle: [2, 2], parallelchannel: [3, 3],
    disjointchannel: [4, 4], flattopbottom: [3, 3], regressionchannel: [2, 2], pitchfork: [3, 3],
    schiffpitchfork: [3, 3], modifiedschiffpitchfork: [3, 3], insidepitchfork: [3, 3],
    fibretracement: [2, 2], fibextension: [2, 2], fibextensiontrend: [3, 3], fibfan: [2, 2],
    fibtimezones: [2, 2], fibchannel: [3, 3], fibspeedfan: [2, 2], trendfibtime: [3, 3],
    fibcircles: [2, 2], fibarcs: [2, 2], fibwedge: [3, 3], fibspiral: [2, 2], gannfan: [2, 2],
    gannbox: [2, 2], gannsquare: [2, 2], dedekind: [2, 2], sonic: [2, 2], supersonic: [2, 2],
    goldensonic: [2, 2], goldensupersonic: [2, 2], xabcd: [5, 5], abcd: [4, 4],
    headshoulders: [7, 7], elliottimpulse: [5, 5], elliottcorrection: [3, 3], gartley: [5, 5],
    bat: [5, 5], butterfly: [5, 5], crab: [5, 5], shark: [5, 5], cypher: [5, 5], position: [2, 2],
    datepricerange: [2, 2], magnifier: [2, 2], anchoredvwap: [1, 1], fixedrangevp: [2, 2],
    freehand: [2, 512], highlighter: [2, 512], arrow: [2, 2], arrowmarkup: [1, 1],
    arrowmarkdown: [1, 1], box: [2, 2], ellipse: [2, 2], triangle: [3, 3], polyline: [2, 512],
    circle: [2, 2], rotatedrect: [3, 3], path: [2, 512], arc: [3, 3], curve: [3, 3], text: [1, 1],
    callout: [2, 2], note: [1, 1], pricenote: [2, 2], comment: [2, 2], pricelabel: [1, 1],
    signpost: [2, 2], flagmark: [1, 1], iconstamp: [1, 1],
  };

  /* What a trader says → what Vela calls it. Only words that mean ONE type; "long"/"short" are left out
     on purpose (a position tool needs its own targets). */
  const ALIASES = {
    fib: 'fibretracement', fibonacci: 'fibretracement', retracement: 'fibretracement',
    'fib retracement': 'fibretracement', 'fib extension': 'fibextension', 'fib channel': 'fibchannel',
    'fib fan': 'fibfan', 'fib circles': 'fibcircles', 'fib spiral': 'fibspiral',
    'fib time zones': 'fibtimezones', 'fib arcs': 'fibarcs',
    trend: 'trendline', 'trend line': 'trendline', line: 'trendline',
    horizontal: 'hline', 'horizontal line': 'hline', support: 'hline', resistance: 'hline', level: 'hline',
    vertical: 'vline', 'vertical line': 'vline', 'horizontal ray': 'hray', 'extended line': 'extendedline',
    'cross line': 'crossline', channel: 'parallelchannel', 'parallel channel': 'parallelchannel',
    regression: 'regressionchannel', rectangle: 'box', rect: 'box', zone: 'box',
    gann: 'gannfan', 'gann fan': 'gannfan', 'gann box': 'gannbox', 'gann square': 'gannsquare',
    elliott: 'elliottimpulse', 'elliott impulse': 'elliottimpulse', 'elliott correction': 'elliottcorrection',
    'head and shoulders': 'headshoulders', 'head & shoulders': 'headshoulders', hs: 'headshoulders',
    harmonic: 'xabcd', 'andrews pitchfork': 'pitchfork', measure: 'datepricerange', ruler: 'datepricerange',
    'price range': 'datepricerange', 'date range': 'datepricerange', vwap: 'anchoredvwap',
    'anchored vwap': 'anchoredvwap', 'volume profile': 'fixedrangevp', label: 'text', brush: 'freehand',
    pen: 'freehand', marker: 'highlighter',
  };

  const GROUP = { id: 'trader-agent', label: "Trader's Agent" };
  const CHART_TYPES = ['candles', 'bars', 'line', 'area', 'baseline', 'heikinashi'];
  const SCALE_MODES = ['price', 'percent', 'indexed'];
  const MARK_SHAPES = ['circle', 'square', 'diamond', 'pin'];

  /* Vela's time-zone list has Singapore (UTC+8, no daylight saving) and no Kuala Lumpur, so the
     Malaysian words map to the zone the picker really shows — same clock, and the picker ticks it. */
  const ZONES = {
    utc: 'Etc/UTC', gmt: 'Etc/UTC', exchange: 'exchange',
    'kuala lumpur': 'Asia/Singapore', kl: 'Asia/Singapore', malaysia: 'Asia/Singapore',
    myt: 'Asia/Singapore', singapore: 'Asia/Singapore', sgt: 'Asia/Singapore',
    'new york': 'America/New_York', ny: 'America/New_York', chicago: 'America/Chicago',
    'los angeles': 'America/Los_Angeles', london: 'Europe/London', paris: 'Europe/Paris',
    berlin: 'Europe/Berlin', dubai: 'Asia/Dubai', mumbai: 'Asia/Kolkata', 'hong kong': 'Asia/Hong_Kong',
    shanghai: 'Asia/Shanghai', tokyo: 'Asia/Tokyo', sydney: 'Australia/Sydney',
  };

  const fail = (detail, data) => ({ ok: false, detail, data: data || null });
  const key = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/[_\s]+/g, ' ');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function activeChart() {
    const app = window.__wsApp || {};
    return (typeof app.activeChart === 'function' ? app.activeChart() : null) || window.__consoleChart || null;
  }

  function ctx() {
    const app = window.__wsApp || {};
    const ws = app.ws;
    const chart = activeChart();
    if (!ws || !chart) throw new Error('this page has no workspace shell (bare chart) — nothing to configure');
    const cell = ws.cellsById && ws.cellsById.get(ws.activeId);
    if (!cell) throw new Error('no active chart cell yet — open a chart first');
    return { ws, chart, cell };
  }

  async function barList() {
    if (typeof window.chartBars !== 'function') throw new Error('this page cannot read bars (older frontend)');
    const b = await window.chartBars();
    if (!b || !b.length) throw new Error('the chart has no bars yet');
    return b;
  }

  /* epoch-seconds (< 1e11) become ms; an ISO string is parsed; anything else is refused. */
  function toMs(v) {
    if (typeof v === 'string' && v.trim() && !/^[0-9.]+$/.test(v.trim())) {
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : null;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e11 ? n * 1000 : n;
  }

  /* One time reference: an exact `time` (ms, s or ISO) or `bars_ago` (0 = the latest bar). */
  function timeOf(ref, bars, what) {
    if (ref.bars_ago != null && ref.bars_ago !== '') {
      const n = Number(ref.bars_ago);
      if (!Number.isInteger(n) || n < 0) throw new Error(what + ': bars_ago must be a whole number ≥ 0 (0 = the latest bar)');
      if (n > bars.length - 1) throw new Error(what + ': bars_ago ' + n + ' is older than the ' + bars.length + ' bars loaded');
      return bars[bars.length - 1 - n].time;
    }
    if (ref.time != null && ref.time !== '') {
      const t = toMs(ref.time);
      if (t == null) throw new Error(what + ': time must be epoch ms / seconds or an ISO date, got ' + JSON.stringify(ref.time));
      return t;
    }
    throw new Error(what + ': give `time` or `bars_ago`');
  }

  function resolveType(raw) {
    const k = key(raw);
    if (!k) return null;
    const flat = k.replace(/ /g, '');
    if (ANCHORS[flat]) return flat;
    return ALIASES[k] || ALIASES[flat] || null;
  }

  function suggest(raw) {
    const flat = key(raw).replace(/ /g, '');
    if (!flat) return [];
    return Object.keys(ANCHORS).filter((t) => t.includes(flat) || flat.includes(t)).slice(0, 6);
  }

  const shape = (d) => ({
    id: d.id, type: d.type,
    anchors: (d.anchors || []).map((a) => ({ time: a.time, price: a.price })),
    style: d.style || null, text: d.text || null, locked: !!d.locked, visible: d.visible !== false,
  });

  /* ── door 1: drawings ───────────────────────────────────────────────────────────────────────── */
  async function drawing(command) {
    const c = activeChart();
    const D = c && c.drawings;
    if (!D) throw new Error('no chart on this page');
    const op = String(command.op || 'list').toLowerCase();

    if (op === 'types') {
      const rows = Object.keys(ANCHORS).map((t) => t + '(' + (ANCHORS[t][0] === ANCHORS[t][1] ? ANCHORS[t][0] : ANCHORS[t][0] + '+') + ')');
      return { ok: true, detail: Object.keys(ANCHORS).length + ' drawing types — name(anchors needed): ' + rows.join(' '),
        data: { types: ANCHORS, aliases: Object.keys(ALIASES) } };
    }

    if (op === 'list') {
      const all = (D.all() || []).map(shape);
      return { ok: true, detail: all.length ? all.length + ' drawing(s): ' + all.map((d) => d.id + ' ' + d.type).join(' · ') : 'no drawings on the chart',
        data: { drawings: all } };
    }

    if (op === 'remove') {
      /* `id` is reserved: the backend stamps the command's own number there, so a drawing's id
         travels as `drawing_id` (found live: `remove --id dw-1` was told "not found: 2788"). */
      const ids = [].concat(command.ids || command.drawing_id || []).map(String).filter(Boolean);
      if (!ids.length) return fail('remove needs `id` (or `ids`) — `list` shows them');
      const have = new Set((D.all() || []).map((d) => d.id));
      const missing = ids.filter((i) => !have.has(i));
      const go = ids.filter((i) => have.has(i));
      if (go.length) D.removeMany(go);
      const left = new Set((D.all() || []).map((d) => d.id));
      const gone = go.filter((i) => !left.has(i));
      return { ok: gone.length === go.length && go.length > 0,
        detail: (gone.length ? 'removed ' + gone.join(', ') : 'nothing removed') + (missing.length ? ' · not found: ' + missing.join(', ') : ''),
        data: { removed: gone, missing } };
    }

    if (op === 'clear') {
      /* Everything on the chart, the operator's hand-drawn lines too — so it must be asked for. */
      if (command.all !== true) return fail('clear removes EVERY drawing, including the ones the operator drew by hand — pass all=true to confirm, or remove specific ids');
      const ids = (D.all() || []).map((d) => d.id);
      if (!ids.length) return { ok: true, detail: 'no drawings to clear', data: { removed: [] } };
      D.removeMany(ids);                       // one undo step
      const left = (D.all() || []).length;
      return { ok: left === 0, detail: left === 0 ? 'cleared ' + ids.length + ' drawing(s) (one undo step brings them back)' : left + ' drawing(s) are still there', data: { removed: ids } };
    }

    if (op === 'update') {
      const id = String(command.drawing_id || '');
      if (!id) return fail('update needs `id` (sent as drawing_id) — `list` shows the ids');
      const cur = (D.all() || []).find((d) => d.id === id);
      if (!cur) return fail('no drawing ' + id + ' — `list` shows them');
      const patch = {};
      if (command.style && typeof command.style === 'object') patch.style = Object.assign({}, cur.style || {}, command.style);
      if (command.text != null) patch.text = typeof command.text === 'object' ? command.text : { value: String(command.text) };
      if (command.locked != null) patch.locked = !!command.locked;
      if (command.visible != null) patch.visible = !!command.visible;
      if (command.props && typeof command.props === 'object') patch.props = command.props;
      if (Array.isArray(command.anchors) && command.anchors.length) {
        const bars = await barList();
        const need = ANCHORS[cur.type];
        if (need && (command.anchors.length < need[0] || command.anchors.length > need[1])) {
          return fail(cur.type + ' takes ' + (need[0] === need[1] ? need[0] : need[0] + '–' + need[1]) + ' anchor(s), got ' + command.anchors.length);
        }
        patch.anchors = command.anchors.map((a, i) => ({ time: timeOf(a, bars, 'anchor ' + (i + 1)), price: Number(a.price) }));
        if (patch.anchors.some((a) => !Number.isFinite(a.price))) return fail('every anchor needs a numeric price');
      }
      if (!Object.keys(patch).length) return fail('nothing to change — give anchors, style, text, locked, visible or props');
      D.update(id, patch);
      const now = (D.all() || []).find((d) => d.id === id);
      return { ok: !!now, detail: now ? 'updated ' + id + ' (' + Object.keys(patch).join(', ') + ')' : 'the drawing vanished after the update', data: now ? shape(now) : null };
    }

    if (op !== 'add') return fail("unknown drawing op '" + op + "' — add, list, update, remove, clear or types");

    const type = resolveType(command.type);
    if (!type) {
      const near = suggest(command.type);
      return fail('unknown drawing type ' + JSON.stringify(command.type || '') + (near.length ? ' — did you mean ' + near.join(', ') + '?' : ' — op=types lists the ' + Object.keys(ANCHORS).length + ' types'));
    }
    const need = ANCHORS[type];
    const given = Array.isArray(command.anchors) ? command.anchors : [];
    if (given.length < need[0] || given.length > need[1]) {
      return fail(type + ' needs ' + (need[0] === need[1] ? need[0] : need[0] + '–' + need[1]) + ' anchor(s) (each a time or bars_ago, plus a price) — got ' + given.length +
        '. Vela would accept fewer and paint nothing, so nothing was drawn.');
    }
    const bars = await barList();
    const lastClose = Number(bars[bars.length - 1].close);
    const anchors = [];
    for (let i = 0; i < given.length; i++) {
      const a = given[i] || {};
      let price = a.price;
      if ((price == null || price === '') && type === 'vline') price = lastClose;   // a vertical line has no price
      price = Number(price);
      if (!Number.isFinite(price)) return fail('anchor ' + (i + 1) + ': price must be a number');
      let time;
      try { time = timeOf(a, bars, 'anchor ' + (i + 1)); } catch (err) { return fail(String(err.message || err)); }
      anchors.push({ time, price });
    }
    const init = { anchors };
    if (command.style && typeof command.style === 'object') init.style = command.style;
    if (command.text != null && command.text !== '') init.text = typeof command.text === 'object' ? command.text : { value: String(command.text) };
    if (command.props && typeof command.props === 'object') init.props = command.props;

    const d = D.add(type, init);
    if (!d) return fail('Vela refused the drawing (drawings are off on this renderer, or the type is unavailable)');
    const made = (D.all() || []).find((x) => x.id === d.id);
    if (!made) return fail('Vela accepted the drawing but it is not in the chart — nothing is shown');
    if ((made.anchors || []).length < need[0]) {
      D.remove(d.id);
      return fail(type + ' came back with ' + (made.anchors || []).length + ' anchor(s) — removed it rather than leave an invisible drawing');
    }
    return { ok: true, detail: 'drew ' + type + ' ' + made.id + ' · ' + made.anchors.length + ' anchor(s) · drag it by hand to adjust', data: shape(made) };
  }

  /* ── door 2: view settings ──────────────────────────────────────────────────────────────────── */
  const asBool = (v) => {
    if (typeof v === 'boolean') return v;
    const s = key(v);
    if (['true', 'on', 'yes', '1', 'show', 'enable', 'enabled'].includes(s)) return true;
    if (['false', 'off', 'no', '0', 'hide', 'disable', 'disabled'].includes(s)) return false;
    return null;
  };

  const rset = (x, name, v) => {
    x.chart.renderer.set(name, v);
    if (typeof x.ws.markStateDirty === 'function') x.ws.markStateDirty();
  };
  const part = (name) => ({
    bool: true,
    get: (x) => { const p = x.cell.statusPrefs().parts; return p ? !!p[name] : null; },
    set: (x, v) => x.cell.setStatuslinePart(name, v),
  });
  const syncKind = (name) => ({
    bool: true,
    get: (x) => x.ws.syncOpts[name] === true,
    set: (x, v) => x.ws.applySyncSetting(name, v ? true : undefined, true),
  });
  const ALERT_LIMIT = "Vela cannot create a price alert — its inbox only collects the alerts an indicator raises with alertcondition(). " +
    'This reads and clears that inbox.';

  const SETTINGS = {
    chart_type: { values: CHART_TYPES, get: (x) => x.cell.priceStyle, set: (x, v) => x.cell.setPriceStyle(v) },
    log: { bool: true, get: (x) => !!x.chart.renderer.get('logScale'), set: (x, v) => rset(x, 'logScale', v) },
    invert: { bool: true, get: (x) => !!x.chart.renderer.get('invertScale'), set: (x, v) => rset(x, 'invertScale', v) },
    auto_scale: { bool: true, get: (x) => !!x.chart.renderer.get('autoScale'), set: (x, v) => rset(x, 'autoScale', v) },
    scale_mode: { values: SCALE_MODES, get: (x) => x.chart.renderer.get('scaleMode'), set: (x, v) => rset(x, 'scaleMode', v) },
    countdown: { bool: true, get: (x) => !!x.chart.renderer.get('countdown'), set: (x, v) => rset(x, 'countdown', v) },
    /* Gridlines (17 Oct): Vela's renderer carries them as `gridlines` (get → scene.showGrid), the
       same word the settings tab wears. The workspace's own saved rendererConfig does NOT carry it
       (measured: a reload brought the grid back), so the console keeps the pref itself — the setter
       writes `luxalgo-web:gridlines`, the boot in workspace.js applies it. */
    grid: { bool: true, get: (x) => !!x.chart.renderer.get('gridlines'),
            set: (x, v) => { rset(x, 'gridlines', v); try { localStorage.setItem('luxalgo-web:gridlines', v ? '1' : '0'); } catch (err) { /* private mode */ } } },
    timezone: { free: true, get: (x) => x.ws.timezone, set: (x, v) => x.ws.setTimezone(v) },
    session: {
      values: ['regular', 'extended'],
      guard: (x) => (x.cell.sessionAvailableFlag ? null : 'no extended session on this symbol — crypto trades around the clock; sessions exist for stocks'),
      get: (x) => x.cell.session, set: (x, v) => x.cell.setSession(v),
    },
    watermark: { bool: true, get: (x) => !!x.cell.watermarkOn, set: (x, v) => x.cell.setWatermarkVisible(v) },
    indicator_titles: { bool: true, get: (x) => !!x.cell.indicatorTitlesOn, set: (x, v) => x.cell.setIndicatorTitlesVisible(v) },
    indicator_values: { bool: true, get: (x) => !!x.cell.indicatorValuesOn, set: (x, v) => x.cell.setIndicatorValuesVisible(v) },
    statusline_logo: part('logo'), statusline_name: part('name'), statusline_market: part('market'),
    statusline_ohlc: part('ohlc'), statusline_change: part('change'),
    sync_symbol: syncKind('symbol'), sync_timeframe: syncKind('timeframe'),
    sync_crosshair: syncKind('crosshair'), sync_style: syncKind('style'),
    shortcuts: {
      bool: true,
      get: (x) => {
        const h = x.ws.shortcutsHelp;
        const p = h && h.dialog && h.dialog.panel;
        return !!(p && p.isConnected && p.getClientRects().length > 0);
      },
      set: (x, v) => {
        if (v) {
          if (!x.ws.shortcutsHelp) {
            /* Vela builds the panel lazily, on the ? key — press it the way a hand would. */
            (x.ws.root || document).dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }));
          }
          if (x.ws.shortcutsHelp) x.ws.shortcutsHelp.open();
        } else if (x.ws.shortcutsHelp) x.ws.shortcutsHelp.close();
      },
    },
    alerts: {
      values: ['read', 'clear'],
      get: (x) => x.ws.alerts.length,
      set: (x, v) => { if (v === 'clear') { x.ws.alerts.length = 0; x.ws.topbar.setAlertCount(0); } },
      check: (now, v) => (v === 'clear' ? now === 0 : true),
    },
  };

  function readBack(name, x) {
    try { return SETTINGS[name].get(x); } catch (err) { return null; }
  }

  function zoneOf(v) {
    const k = key(v);
    if (ZONES[k]) return ZONES[k];
    const raw = String(v || '').trim();
    try { new Intl.DateTimeFormat('en', { timeZone: raw }); return raw; } catch (err) { return null; }
  }

  function everything(x) {
    const out = {};
    for (const name of Object.keys(SETTINGS)) out[name] = readBack(name, x);
    out.alerts_in_inbox = out.alerts;
    delete out.alerts;
    return out;
  }

  async function view(command) {
    const x = ctx();
    const name = key(command.setting).replace(/ /g, '_');
    if (!name || name === 'state') {
      const state = everything(x);
      return { ok: true, detail: 'view · ' + Object.keys(state).map((k) => k + '=' + state[k]).join(' · '), data: state };
    }
    const def = SETTINGS[name];
    if (!def) return fail("unknown setting '" + name + "' — one of: " + Object.keys(SETTINGS).join(', '));
    const given = command.value;
    const asked = given === undefined || given === null || given === '';
    if (name === 'alerts') {
      const list = (x.ws.alerts || []).slice(0, 20).map((a) => ({ source: a.source, title: a.title, message: a.message, time: a.time }));
      if (!asked && key(given) === 'clear') def.set(x, 'clear');
      const now = readBack(name, x);
      const okAlerts = def.check(now, asked ? 'read' : key(given));
      return { ok: okAlerts, detail: now + ' alert(s) in the inbox. ' + ALERT_LIMIT, data: { count: now, alerts: asked || key(given) !== 'clear' ? list : [] } };
    }
    if (asked) return { ok: true, detail: name + ' = ' + readBack(name, x), data: { setting: name, value: readBack(name, x) } };

    let v;
    if (def.bool) {
      v = asBool(given);
      if (v === null) return fail(name + ' takes on/off (true/false), got ' + JSON.stringify(given));
    } else if (def.values) {
      v = key(given).replace(/ /g, '');
      if (name === 'chart_type') v = ({ heikin: 'heikinashi', 'heikin-ashi': 'heikinashi', ha: 'heikinashi', candle: 'candles', candlestick: 'candles' })[v] || v;
      if (!def.values.includes(v)) return fail(name + ' takes one of: ' + def.values.join(', ') + ' — got ' + JSON.stringify(given));
    } else {
      v = zoneOf(given);
      if (!v) return fail('time zone ' + JSON.stringify(given) + ' is not one I know — try utc, exchange, kuala lumpur, new york, london, tokyo, or an IANA name like Asia/Tokyo');
    }
    const blocked = def.guard ? def.guard(x) : null;
    if (blocked) return fail(blocked, { setting: name });
    def.set(x, v);
    await wait(80);                                            // the async setters (session, zone) settle
    const now = readBack(name, x);
    const ok = def.check ? def.check(now, v) : (now === v);
    const note = name === 'timezone' && key(given) !== key(v) && ZONES[key(given)] ? ' (Vela lists ' + v + ' — the same clock)' : '';
    return { ok, detail: ok ? name + ' → ' + now + note : name + ' did not take: asked for ' + v + ', the chart reports ' + now, data: { setting: name, value: now } };
  }

  /* ── door 3: event marks ────────────────────────────────────────────────────────────────────── */
  let seq = 0;

  async function marks(command) {
    const c = activeChart();
    const M = c && c.marks;
    if (!M) throw new Error('no chart on this page');
    if (!M.supported) return fail("this renderer does not paint timeline marks (Vela's `timelineMarks` capability is off)");
    const op = String(command.op || 'list').toLowerCase();
    const mine = () => (M.all() || []).filter((m) => m.group === GROUP.id);

    if (op === 'list') {
      const list = mine().map((m) => ({ id: m.id, time: m.time, title: m.title || '', content: m.content || '', glyph: m.glyph }));
      return { ok: true, detail: list.length ? list.length + ' mark(s): ' + list.map((m) => m.id + ' ' + (m.title || '')).join(' · ') : 'no agent marks on the chart', data: { marks: list } };
    }
    if (op === 'remove') {
      const id = String(command.mark_id || '');
      if (!id) return fail('remove needs `id` (sent as mark_id) — `list` shows them');
      if (!mine().some((m) => m.id === id)) return fail('no agent mark ' + id);
      M.remove(id);
      const gone = !mine().some((m) => m.id === id);
      return { ok: gone, detail: gone ? 'removed ' + id : id + ' is still there', data: { id } };
    }
    if (op === 'clear') {
      /* Only the agent's own group — marks other code supplied are not ours to wipe. */
      const ids = mine().map((m) => m.id);
      ids.forEach((id) => M.remove(id));
      const left = mine().length;
      return { ok: left === 0, detail: left === 0 ? 'cleared ' + ids.length + ' agent mark(s)' : left + ' mark(s) are still there', data: { removed: ids } };
    }
    if (op !== 'add') return fail("unknown marks op '" + op + "' — add, list, remove or clear");

    const bars = await barList();
    let time;
    try { time = timeOf(command, bars, 'mark'); } catch (err) { return fail(String(err.message || err)); }
    const shapeName = command.shape ? key(command.shape) : 'circle';
    if (!MARK_SHAPES.includes(shapeName)) return fail('shape takes one of: ' + MARK_SHAPES.join(', '));
    const color = String(command.color || '#f5a623');
    if (!/^#[0-9a-f]{3,8}$/i.test(color) && !/^(rgb|hsl)a?\(/i.test(color)) return fail('color must be a hex like #f5a623 or an rgb()/hsl() value');
    const title = String(command.title || '');
    const glyph = { color, shape: shapeName };
    const letter = String(command.letter || title.trim().charAt(0) || '').slice(0, 2);
    if (letter) glyph.letter = letter.toUpperCase();
    const id = String(command.mark_id || 'ta-mark-' + Date.now().toString(36) + '-' + (++seq));
    M.defineGroup({ id: GROUP.id, label: GROUP.label });      // idempotent: the settings dialog's Events tab lists it
    M.add({ id, time, glyph, title, content: String(command.content || ''), group: GROUP.id });
    const made = mine().find((m) => m.id === id);
    return { ok: !!made, detail: made ? 'mark ' + id + ' placed · it is data, so it clears when the symbol or timeframe changes' : 'Vela did not keep the mark', data: made ? { id, time, glyph } : null };
  }

  /* ── door 4: objects — Vela's Object tree, as a door ───────────────────────────────────────────
     The rail's Object tree lists what is ON the chart — the operator's drawings in paint order, then
     the indicators — and can hide, lock, reorder, duplicate and delete a row. The agent had no door
     to any of it, and acting blind here is worse than not acting: Vela returns cleanly from calls
     that remove nothing (the same class of silent no-op that cost a cycle on indicators), so every
     op below READS THE STACK BACK and reports what the chart holds afterwards. */

  const OBJECT_OPS = ['list', 'select', 'show', 'hide', 'lock', 'unlock', 'front', 'back',
                      'duplicate', 'delete', 'settings', 'price'];

  function drawingRows(c) {
    return (c.drawings.all() || []).map((d) => ({
      id: d.id,
      type: d.type,
      label: (d.text && d.text.value) ? String(d.text.value) : '',
      visible: d.visible !== false,
      locked: !!d.locked,
      z: typeof d.zIndex === 'number' ? d.zIndex : null,
      pane: d.paneId == null ? null : d.paneId,
      anchors: (d.anchors || []).length,
    }));
  }

  function objectLine(r) {
    const bits = [r.id, r.type];
    if (r.label) bits.push('"' + r.label.slice(0, 24) + '"');
    if (!r.visible) bits.push('hidden');
    if (r.locked) bits.push('locked');
    bits.push(r.anchors + ' anchor' + (r.anchors === 1 ? '' : 's'));
    return bits.join(' ');
  }

  /* Which drawings an op acts on: `type` (any of the 76, by name or alias), `ids` (a comma list or
     an array), or neither for everything. An id that is not on the chart is REFUSED rather than
     ignored — a typo that silently does nothing reads as success. A single id travels as
     `drawing_id`, never `id`: the backend stamps the command's own number into `id`. */
  function objectTargets(c, command) {
    const rows = drawingRows(c);
    let want = rows;
    if (command.type != null && String(command.type).trim() !== '') {
      const type = resolveType(command.type);
      if (!type) throw new Error("unknown drawing type '" + command.type + "' — " + (suggest(command.type).join(', ') || 'see `objects list`'));
      want = want.filter((r) => r.type === type);
    }
    const raw = (command.ids != null && command.ids !== '') ? command.ids
      : ((command.drawing_id != null && command.drawing_id !== '') ? command.drawing_id : '');
    const listed = (Array.isArray(raw) ? raw : String(raw).split(',')).map((s) => String(s).trim()).filter(Boolean);
    if (listed.length) {
      const known = new Set(rows.map((r) => r.id));
      const missing = listed.filter((i) => !known.has(i));
      if (missing.length) throw new Error('no drawing ' + missing.join(', ') + ' on the chart — `objects list` shows the ids');
      want = want.filter((r) => listed.includes(r.id));
    }
    return { rows, want };
  }

  async function objects(command) {
    const c = activeChart();
    if (!c) throw new Error('no chart on this page');
    const D = c.drawings;
    if (!D || !D.supported) return fail("this renderer keeps no drawings (Vela's `drawings` capability is off)");
    const op = String(command.op || 'list').toLowerCase();
    if (!OBJECT_OPS.includes(op)) return fail("unknown objects op '" + op + "' — " + OBJECT_OPS.join(', '));

    const priceShown = () => c.renderer.get('candleVisible') !== false;
    let rows, want;
    try { ({ rows, want } = objectTargets(c, command)); } catch (err) { return fail(String(err.message || err)); }

    if (op === 'list') {
      const handles = (typeof c.indicators === 'function' ? c.indicators() : null) || [];
      const head = rows.length
        ? rows.length + ' drawing(s), back to front: ' + rows.slice(0, 20).map(objectLine).join(' · ') +
          (rows.length > 20 ? ' … ' + (rows.length - 20) + ' more' : '')
        : 'no drawings on the chart';
      const ind = handles.length
        ? ' | ' + handles.length + ' indicator(s) (chart_studies reads those): ' +
          handles.slice(0, 10).map((h) => h.title || h.nativeType || h.id).join(', ')
        : ' | no indicators mounted';
      return {
        ok: true,
        detail: head + ind + ' | price series ' + (priceShown() ? 'visible' : 'hidden'),
        data: { drawings: rows, indicators: handles.map((h) => ({ id: h.id, title: h.title || null, nativeType: h.nativeType || null, visible: h.visible !== false })), price_visible: priceShown() },
      };
    }

    /* `price` is the object tree's eye on the candles themselves: hide the base series and every
       overlay keeps drawing (the pane rescales to them). */
    if (op === 'price') {
      if (typeof c.renderer.set !== 'function') return fail('this renderer has no price-series switch');
      const asked = asBool(command.value);
      const v = asked === null ? !priceShown() : asked;
      c.renderer.set('candleVisible', v);
      const now = priceShown();
      const ws = (window.__wsApp || {}).ws;
      if (ws && typeof ws.markStateDirty === 'function') ws.markStateDirty();
      return { ok: now === v, detail: 'price series → ' + (now ? 'shown' : 'hidden') + (now === v ? '' : ' (the chart still reports ' + (now ? 'visible' : 'hidden') + ')'), data: { visible: now } };
    }

    if (!want.length) {
      return fail((command.type || command.ids ? 'nothing matches that filter — ' : 'nothing matches — ') +
                  rows.length + ' drawing(s) on the chart');
    }
    const ids = want.map((r) => r.id);

    if (op === 'select') {
      D.select(ids);
      return { ok: true, detail: 'selected ' + ids.length + ' drawing(s): ' + ids.join(', ') + ' — Vela highlights them and shows their toolbar', data: { selected: ids } };
    }

    if (op === 'settings') {
      if (ids.length !== 1) return fail('settings opens ONE drawing\'s popup — give one id (got ' + ids.length + ')');
      if (typeof D.openSettings !== 'function') return fail('this Vela build has no openSettings call');
      D.openSettings(ids[0]);
      return { ok: true, detail: 'opened the settings popup of ' + ids[0] + ' — the operator edits it there', data: { id: ids[0] } };
    }

    if (op === 'show' || op === 'hide') {
      const visible = op === 'show';
      for (const id of ids) D.show(id, visible);
      const after = drawingRows(c).filter((r) => ids.includes(r.id));
      const stuck = after.filter((r) => r.visible !== visible).map((r) => r.id);
      return {
        ok: stuck.length === 0,
        detail: stuck.length ? stuck.join(', ') + ' did not take: ' + after.map(objectLine).join(' · ')
                             : ids.length + ' drawing(s) → ' + (visible ? 'shown' : 'hidden'),
        data: { ids, visible },
      };
    }

    if (op === 'lock' || op === 'unlock') {
      const locked = op === 'lock';
      for (const id of ids) D.lock(id, locked);
      const after = drawingRows(c).filter((r) => ids.includes(r.id));
      const stuck = after.filter((r) => r.locked !== locked).map((r) => r.id);
      return {
        ok: stuck.length === 0,
        detail: stuck.length ? stuck.join(', ') + ' did not take: ' + after.map(objectLine).join(' · ')
                             : ids.length + ' drawing(s) ' + (locked ? 'locked (Vela no longer drags them)' : 'unlocked'),
        data: { ids, locked },
      };
    }

    if (op === 'front' || op === 'back') {
      for (const id of ids) { if (op === 'front') D.bringToFront(id); else D.sendToBack(id); }
      const after = drawingRows(c);
      const mine = after.filter((r) => ids.includes(r.id));
      const others = after.filter((r) => !ids.includes(r.id));
      const edge = op === 'front' ? Math.max(0, ...others.map((r) => r.z == null ? -Infinity : r.z)) : Math.min(Infinity, ...others.map((r) => r.z == null ? Infinity : r.z));
      const ok = mine.every((r) => r.z != null && (op === 'front' ? r.z >= edge : r.z <= edge));
      return {
        ok,
        detail: ids.length + ' drawing(s) sent ' + (op === 'front' ? 'in front of every other drawing and the candles' : 'behind the candles and the indicators') +
                ' · z now ' + mine.map((r) => r.z).join(', '),
        data: { ids, z: mine.map((r) => r.z) },
      };
    }

    if (op === 'duplicate') {
      const before = new Set(rows.map((r) => r.id));
      const made = [];
      for (const id of ids) {
        D.clone(id);
        const fresh = drawingRows(c).filter((r) => !before.has(r.id));
        fresh.forEach((r) => { before.add(r.id); made.push(r.id); });
      }
      return {
        ok: made.length === ids.length,
        detail: made.length ? 'duplicated ' + made.length + ' drawing(s): ' + made.join(', ') +
                (made.length < ids.length ? ' (Vela kept only ' + made.length + ' of ' + ids.length + ')' : '')
                             : 'Vela duplicated nothing — the originals are unchanged',
        data: { ids, copies: made },
      };
    }

    /* delete — `all` takes the whole stack, hand-drawn too, so it must be asked for; either way
       one undo step (removeMany), and the answer is the ids that are gone. */
    if (op === 'delete') {
      const whole = command.all === true || String(command.all).toLowerCase() === 'true' || String(command.all) === '1';
      const targets = whole ? rows.map((r) => r.id) : ids;
      if (targets.length === 1) D.remove(targets[0]); else D.removeMany(targets);
      const left = drawingRows(c).map((r) => r.id);
      const gone = targets.filter((id) => !left.includes(id));
      const stuck = targets.filter((id) => left.includes(id));
      return {
        ok: stuck.length === 0,
        detail: stuck.length ? 'removed ' + gone.length + ' of ' + targets.length + ' — still on the chart: ' + stuck.join(', ')
                             : 'removed ' + gone.length + ' drawing(s) · ' + left.length + ' left on the chart' +
                               (gone.length && !left.length ? ' (one undo restores them)' : ''),
        data: { removed: gone, remaining: left },
      };
    }

    return fail("unknown objects op '" + op + "' — " + OBJECT_OPS.join(', '));   // unreachable: OBJECT_OPS vets `op` first
  }

  /* ── door 5: the Data window ───────────────────────────────────────────────────────────────────
     Vela's Data window panel reads the renderer once per repaint and prints Time, then Price
     (O/H/L/C + volume), then one section per indicator. `renderer.dataWindowReadout()` IS that
     readout, so this door hands the agent the chart's own numbers — nothing here recomputes a
     value. Vela's rule for WHICH bar: the one under the cursor, or the latest bar when the cursor
     is off the plot; the Time section names the bar either way, so the answer never guesses. */

  const DW_LABELS = { o: 'Open', h: 'High', l: 'Low', c: 'Close', vol: 'Volume' };

  function readoutSections(r) {
    const out = [];
    if (r.date || r.time) {
      out.push({ title: 'Time', lines: [{ label: 'Date', value: r.date || '' }, { label: 'Time', value: r.time || '' }] });
    }
    const o = r.ohlc;
    if (o) {
      const lines = ['o', 'h', 'l', 'c'].map((k) => ({ label: DW_LABELS[k], value: o[k] }));
      if (o.vol !== undefined && o.vol !== null) lines.push({ label: DW_LABELS.vol, value: o.vol });
      out.push({ title: 'Price', lines, up: o.up !== false });
    }
    for (const g of (r.groups || [])) {
      out.push({ title: g.name, lines: (g.rows || []).map((x) => ({ label: x.label, value: x.value, color: x.color || '' })) });
    }
    return out;
  }

  async function datawindow(command) {
    const c = activeChart();
    if (!c) throw new Error('no chart on this page');
    const R = c.renderer;
    if (!R || typeof R.dataWindowReadout !== 'function') throw new Error('this page has no renderer readout (older Vela) — reload the chart');
    const op = String(command.op || 'now').toLowerCase();
    if (op !== 'now' && op !== 'read') return fail("unknown datawindow op '" + op + "' — now (the bar under the cursor, or the latest bar)");

    const readout = R.dataWindowReadout();
    if (!readout || (!readout.ohlc && !(readout.groups || []).length && !readout.date)) {
      return fail('the renderer has no readout yet — the chart may still be loading its bars');
    }
    const sections = readoutSections(readout);
    const stamp = [readout.date, readout.time].filter(Boolean).join(' ');
    const line = (s) => s.title + ': ' + s.lines.map((l) => l.label + ' ' + l.value).join(' · ');
    return {
      ok: true,
      detail: 'Data window' + (stamp ? ' · ' + stamp : '') + ' | ' + sections.map(line).join(' | ') +
              ' | Vela reads the bar under the cursor, or the latest bar when the cursor is off the plot',
      data: { date: readout.date || '', time: readout.time || '', ohlc: readout.ohlc || null, sections },
    };
  }

  window.TaVela = { drawing, view, marks, objects, datawindow, ANCHORS, SETTINGS: Object.keys(SETTINGS), GROUP };
})();
