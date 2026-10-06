/* The one landasan every door runs on — created 23 Sep.
 *
 * Three doors ask for Pine to run: the MCP tools behind chat (chart_apply_pine / chart_draw /
 * script), the Library detail panel's "Run PineTS", and this console's script editor (restored
 * 23 Sep). Each used to carry its own partial logic, and the differences showed as silent gaps:
 * a structure script (the SMC class) reported "no render surface … overlay needed" and drew
 * nothing, a 0-series source could resurrect a native the operator had just removed (a ta.atr(
 * anywhere in the source matched the paint heuristic), and the editor's refusal message outlived
 * the editor itself.
 *
 * One run, both outputs, coverage read back:
 *   boxes/lines/labels/tables -> ChartOverlay, then state() says what is really on screen,
 *   plot series               -> the native paint layer, and only when series actually exist.
 *
 * `summarize()` formats the same honest detail line for every caller, so no door can promise what
 * another door does not deliver.
 */
'use strict';
window.TraderRun = (function () {
  /* Names whose overlay output landed this session — feeds the badge and the chart legend. */
  const applied = [];
  /* One event whenever what is on the chart changes (3 Oct): the chip in Vela's row and the drawer's
     on-chart row both listen, so neither has to poll and neither can drift from the other. */
  function announce() {
    try { window.dispatchEvent(new CustomEvent('ta-onchart', { detail: { names: applied.slice() } })); }
    catch (err) { /* no CustomEvent: the chip just refreshes on its next render */ }
  }
  /* The overlay holds ONE script at a time (ChartOverlay.apply clears the canvas), so the last run
     that LANDED is the whole overlay. Kept so a reload / app restart / next morning paints it again. */
  const RUN_KEY = 'luxalgo-web:last-run';
  function remember(pine, name, opts) {
    try {
      localStorage.setItem(RUN_KEY, JSON.stringify({ pine: String(pine), name, opts: opts || null, at: Date.now() }));
    } catch (err) { /* private mode / quota: the run still stands, it just will not come back */ }
  }

  /* A drawing declared with `xloc = xloc.bar_time` carries ms timestamps, not bar indices — the
     overlay paints in bar-index space, so those rows were dropped outright and a whole indicator's
     zones went missing (27 Sep: Smart Money Concepts' internal order blocks and FVGs, which the
     LuxAlgo original shows as shaded boxes). Translate the times to the nearest bar at or before
     them; drop only what still cannot be placed. */
  function timeOf(v) {
    if (v && typeof v === 'object') {
      if (typeof v.time === 'number') return v.time;
      if (typeof v.value === 'number') return v.value;
      return null;
    }
    return typeof v === 'number' ? v : null;
  }

  function barAt(bars, t) {
    const list = Array.isArray(bars) ? bars : [];
    if (!list.length || typeof t !== 'number' || !isFinite(t)) return null;
    const at = (b) => (b && typeof b.time === 'number' ? b.time : (b && b.openTime) || 0);
    const last = list.length - 1;
    if (t <= at(list[0])) return 0;
    if (t >= at(list[last])) return last;
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (at(list[mid]) <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /** Bar-time row -> bar-index row (bar-index rows pass through untouched). */
  function toBarIndex(row, bars, xs) {
    if (!row || row.xloc !== 'bt') return row;
    const out = Object.assign({}, row);
    for (const k of xs) {
      const i = barAt(bars, timeOf(row[k]));
      if (i == null) return null;
      out[k] = i;
    }
    out.xloc = 'bi';
    return out;
  }

  function flatten(raw, bars) {
    const plots = (raw && raw.plots) || {};
    const rawRows = {};   // rows the ENGINE stored, before any filter — the honest denominator
    const rowsOf = (key) => {
      const node = plots[key];
      /* Two shapes reach here: the live engine's context keeps rows under `.data`, while the worker's
       * projection sends the row list as a plain array. Reading only `.data` made every worker run
       * report "the engine stored NO rows" and left the overlay empty. Accept both. */
      const rows = Array.isArray(node) ? node : (node && Array.isArray(node.data) ? node.data : []);
      rawRows[key.replace(/__/g, '')] = rows.length;
      const vals = [];
      for (const row of rows) {
        const v = row && row.value;
        if (Array.isArray(v)) vals.push(...v);
        else if (v && typeof v === 'object') vals.push(v);   // shape tolerance: value may be the object itself
      }
      return vals.filter((x) => x && typeof x === 'object' && !x._deleted);
    };
    /* polyline.new() stores points as {index, price} (or {time, price} when xloc is bar_time).
       The overlay paints {x, y} in bar-index space. Until this mapping existed, __polylines__
       was never read — series paths reused the name — so every volume-profile script computed
       a polyline and the chart showed none of it. */
    const pointXY = (p, xloc) => {
      if (!p || typeof p !== 'object') return null;
      const y = typeof p.price === 'number' ? p.price : (typeof p.y === 'number' ? p.y : null);
      if (y == null || !isFinite(y)) return null;
      let x = null;
      if ((xloc === 'bt' || xloc === 'bar_time') && typeof p.time === 'number') x = barAt(bars, p.time);
      else if (typeof p.index === 'number') x = p.index;
      else if (typeof p.x === 'number') x = p.x;
      else if (typeof p.time === 'number') x = barAt(bars, p.time);
      if (x == null || !isFinite(x)) return null;
      return { x: x, y: y };
    };
    const drawingPolylines = () => rowsOf('__polylines__').map((pl) => {
      const pts = (pl.points || []).map((p) => pointXY(p, pl.xloc)).filter(Boolean);
      if (pts.length < 2) return null;
      return {
        points: pts,
        color: pl.line_color || null,
        fill: pl.fill_color || null,
        width: pl.line_width || 1,
        style: pl.line_style || null,
        closed: !!pl.closed,
      };
    }).filter(Boolean);
    /* The engine's own series — every plot that is not a drawing container. Painting these as paths is
     * what makes a script with more than two plots actually appear: the "Vela native" mapper can only
     * express simple scripts, so a four-series indicator used to compute fine and paint nothing. */
    const seriesPaths = () => {
      const out = [];
      for (const [key, node] of Object.entries(plots)) {
        if (key.startsWith('__')) continue;
        const arr = Array.isArray(node) ? node : (node && Array.isArray(node.data) ? node.data : []);
        const pts = [];
        let color = null;
        let idx = 0;
        for (const row of arr) {
          const here = idx;
          idx += 1;
          /* The worker's projection sends a bare NUMBER for a simple plot and an object for a styled
           * one, so read both — the same tolerance `pointValue` gives the series list. Requiring an
           * object here is why every series-only indicator painted nothing. */
          if (row && typeof row === 'object' && !color && row.options && row.options.color) color = row.options.color;
          const val = (typeof row === 'number') ? row
            : (row && typeof row === 'object' && typeof row.value === 'number' ? row.value : null);
          if (val == null || !isFinite(val)) continue;
          /* Plot rows are one per bar in run order, but they do not always carry a timestamp. Map by
           * time when there is one, else fall back to the row's own index — the engine ran over the
           * same bars the chart is showing, so the index is the bar index. */
          const byTime = row && typeof row === 'object' ? barAt(bars, timeOf(row)) : null;
          const i = byTime != null ? byTime : here;
          if (i == null || i < 0) continue;
          pts.push({ x: i, y: val });
        }
        if (pts.length >= 2) out.push({ points: pts, color: color || null });
      }
      return out;
    };

    return {
      boxes: rowsOf('__boxes__').map((b) => toBarIndex(b, bars, ['left', 'right'])).filter(Boolean),
      lines: rowsOf('__lines__').map((l) => toBarIndex(l, bars, ['x1', 'x2'])).filter(Boolean),
      labels: rowsOf('__labels__').map((t) => toBarIndex(t, bars, ['x'])).filter(Boolean),
      polylines: drawingPolylines().concat(seriesPaths()),
      tables: rowsOf('__tables__'),
      rawRows,
    };
  }

  /* `drew` carries NUMBERS (what the overlay reports it drew); `flatten` carries ARRAYS (the
     objects themselves). Adding arrays with `+` stringifies them — that made `=== 0` permanently
     false and hid the provider guard for a whole afternoon (measured 23 Sep). Count by length. */
  const fieldN = (v) => (Array.isArray(v) ? v.length : (typeof v === 'number' ? v : (v ? 1 : 0)));
  const counts = (o) => (o ? fieldN(o.boxes) + fieldN(o.lines) + fieldN(o.labels) + fieldN(o.polylines) + fieldN(o.tables) : 0);
  /* Geometry only: `containers` still means "the script declares its own drawings", which is what tells
     the Vela-native mapper to stand aside. Series paths are ours to paint, not a reason to skip it. */
  const geometryOnly = (o) => (o ? fieldN(o.boxes) + fieldN(o.lines) + fieldN(o.labels) + fieldN(o.tables) : 0);

  /* Rows the engine actually stored across every drawing container — before filters, before
     shape — and how many of them came back EMPTY. A container that was constructed but never
     written to keeps one placeholder row whose `value` is an empty array; that is what a script
     whose own conditions never fired looks like, and it must not be reported as lost data
     (measured 24 Sep: the AMD POC setup script on ETHUSDT 1h — 6 containers, 6 placeholders). */
  function engineRows(raw) {
    const plots = (raw && raw.plots) || {};
    let n = 0;
    let empty = 0;
    for (const k of Object.keys(plots)) {
      if (!k.startsWith('__')) continue;
      /* Same two-shapes tolerance as `flatten`: the worker sends the row list as an array, the live
       * context keeps it under `.data`. Reading only `.data` reported 0 stored rows for every worker
       * run and produced the misleading "the data never reached the constructors" line. */
      const node = plots[k];
      const rows = Array.isArray(node) ? node : (node && Array.isArray(node.data) ? node.data : []);
      for (const row of rows) {
        n++;
        const v = row && row.value;
        if (Array.isArray(v) ? v.length === 0 : !(v && typeof v === 'object')) empty++;
      }
    }
    return { n, empty };
  }

  function record(name, drew, warnings) {
    if (!name || counts(drew) === 0) return;
    /* ChartOverlay.apply() clears the canvas, so a new script REPLACES the last: the legend and the chip
       name that one script, not every script ever run since the page loaded (4 Oct: "Object Flood ·
       Pivot Zones · Mini Volume Profile" over a canvas that held only the last). */
    applied.length = 0;
    applied.push(name);
    announce();
    const legend = document.getElementById('script-legend');
    if (legend) {
      const warned = warnings && warnings.length;
      legend.textContent = applied.map((n) => n + ' · overlay').join('  ·  ') + (warned ? '  \u00b7  \u26a0 see note' : '');
      legend.title = applied.join(' \u00b7 ') + (warned ? '\n\u26a0 ' + warnings.join('\n\u26a0 ') : '');
      legend.hidden = false;
    }
  }


  /* ── how much history a script needs, and what this engine cannot give it ───────────────────────
     Every run used to get the last 500 bars, whatever the script asked for. A lookback longer than the
     window does not give a slightly-off number, it gives NOTHING: on a 4h chart `ta.highest(high, 2184)`
     (a 52-week high) came back na on all 500 bars, and a 500-bar lookback produced one point (measured
     4 Oct). So the window follows the script: a quick read of its own source for the longest lookback,
     and the run fetches that much plus a warm-up. 500 stays the floor — a heavy script must not get
     slower just because the cap went up. */
  const BASE_BARS = 500;
  const MAX_BARS = 5000;      // the console's /api/bars ceiling (5 pages of 1000)
  const WARM_BARS = 300;

  function stripComments(src) {
    return String(src || '').replace(/\/\/[^\n]*/g, '').replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  }

  /** The longest lookback the source states outright — length arguments, `x[N]` history reads, input
   *  defaults, and variables named like a length. Heuristic and cheap; 0 when nothing is stated. */
  function lookbackNeeded(source) {
    const src = stripComments(source);
    let need = 0;
    const take = (n) => { n = Number(n); if (isFinite(n) && n >= 2 && n <= 20000 && n > need) need = n; };
    for (const m of src.matchAll(/\bta\.[a-z_0-9]+\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      for (const a of m[1].split(',')) { const t = a.trim(); if (/^\d{1,5}$/.test(t)) take(t); }
    }
    for (const m of src.matchAll(/\[\s*(\d{2,5})\s*\]/g)) take(m[1]);
    for (const m of src.matchAll(/\binput(?:\.int|\.float)?\s*\(\s*(?:defval\s*=\s*)?(\d{2,5})\b/g)) take(m[1]);
    for (const m of src.matchAll(/\b(?:len|length|lookback|period|bars?|window|lb)\w*\s*=\s*(\d{2,5})\b/gi)) take(m[1]);
    return need;
  }

  /** How many bars to fetch for a script: the floor, or what it needs plus a warm-up, up to the ceiling. */
  function depthFor(source) {
    const need = lookbackNeeded(source);
    return { need, limit: need > 0 ? Math.min(MAX_BARS, Math.max(BASE_BARS, need + WARM_BARS)) : BASE_BARS };
  }

  /* Vela / TradingView / venue spellings of a timeframe, as one comparable string. */
  function tfKey(tf) {
    const s = String(tf == null ? '' : tf).trim();
    if (/^\d+$/.test(s)) { const n = +s; return n % 1440 === 0 ? (n / 1440) + 'd' : n % 60 === 0 ? (n / 60) + 'h' : n + 'm'; }
    const m = s.match(/^(\d*)([mhdwMHDW])$/);
    if (!m) return s.toLowerCase();
    return (m[1] || '1') + (m[2] === 'M' ? 'M' : m[2].toLowerCase());
  }

  /** Things the reader of a run's numbers must be told. The first: `request.security` RUNS in this engine
   *  but ignores the timeframe — "D" close came back identical to the chart's own close and "W" high to
   *  its high (measured 4 Oct) — so a multi-timeframe indicator draws the chart's own levels and nothing
   *  says so. Only a request for the chart's own timeframe is honest. */
  function scriptNotes(source, interval) {
    const notes = [];
    const code = String(source || '').replace(/\/\/[^\n]*/g, '');
    const own = tfKey(interval);
    let other = 0;
    for (const m of code.matchAll(/\b(?:request\.)?security(?:_lower_tf)?\s*\(/g)) {
      /* The call's second argument: walk to the next top-level comma, minding parentheses and strings. */
      const args = [];
      let depth = 0, quote = null, cur = '';
      for (let i = m.index + m[0].length; i < code.length; i++) {
        const c = code[i];
        if (quote) { cur += c; if (c === quote && code[i - 1] !== '\\') quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; cur += c; continue; }
        if (c === '(' || c === '[') depth++;
        if (c === ')' || c === ']') { if (depth === 0) break; depth--; }
        if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; if (args.length >= 2) break; continue; }
        cur += c;
      }
      if (cur) args.push(cur.trim());
      const lit = (args[1] || '').match(/^["']([^"']*)["']$/);
      if (lit && tfKey(lit[1]) === own) continue;          // the chart's own timeframe: honest
      other++;
    }
    if (other > 0) {
      notes.push('request.security: on this run path the engine returns the chart\u2019s OWN timeframe for every request, so the '
        + 'higher-timeframe values from ' + other + ' call(s) equal this chart\u2019s bars, not the daily / weekly / '
        + 'other bars the script asked for');
    }
    return notes;
  }

  /** Plot lines that came back with no value on any bar — a lookback longer than the history (an input set
   *  higher than the bars allow), or a condition that never held. Boolean and object points count as values. */
  function emptyPlots(raw) {
    const plots = raw && raw.plots;
    if (!plots || typeof plots !== 'object') return [];
    const out = [];
    for (const [name, plot] of Object.entries(plots)) {
      if (name.startsWith('__')) continue;                         // drawing containers are not lines
      const data = Array.isArray(plot) ? plot : (plot && Array.isArray(plot.data) ? plot.data : null);
      if (!data || !data.length) continue;
      const has = data.some((p) => {
        const v = p && typeof p === 'object' && !Array.isArray(p) && 'value' in p ? p.value : p;
        return v !== null && v !== undefined && !(typeof v === 'number' && !Number.isFinite(v));
      });
      if (!has) out.push(name);
    }
    return out;
  }

  async function run(pine, name, opts) {
    name = name || 'agent';
    if (!pine || !String(pine).trim()) return { ok: false, reason: 'no Pine source in the command' };
    if (typeof window.chartBars !== 'function') return { ok: false, reason: 'no chart on this page' };
    if (!window.PineTSRunner) return { ok: false, reason: 'Pine engine missing — indicators cannot be mounted' };

    /* The window follows the script (see lookbackNeeded): the floor is 500 bars, a stated long lookback
       earns up to 5000. A deeper run gets a longer deadline in proportion — it is the same loops over
       more bars — instead of timing out at the 20 s a 500-bar run is allowed. */
    const depth = depthFor(pine);
    const bars = await window.chartBars({ limit: depth.limit });
    const runOpts = { name, timeoutMs: Math.min(90000, Math.round(20000 * Math.max(1, bars.length / BASE_BARS))),
                      inputs: (opts && opts.inputs) || null };
    let res = await window.PineTSRunner.run(String(pine), bars, runOpts);
    if (!res.ok) {
      return { ok: false, name, reason: res.reason || 'not runnable: unknown', error: res.error || null, ms: res.ms || null };
    }

    /* The provider's clean return can lie: it reported a healthy run while its data never
       reached the constructors (every container kept only its pre-created placeholder row),
       and the chart's own bars were sitting right there (measured 23 Sep). The guard is the
       OUTCOME, not the raw row count — placeholders count as rows. A run that plotted nothing
       AND left every drawing container empty gets exactly one retry over the visible bars. */
    let retried = false;
    let retryFail = null;
    const guard = { ctor: res.ctor, seriesN: res.series.length, survivors: counts(flatten(res.raw)) };
    if (guard.ctor === 'provider' && guard.seriesN === 0 && guard.survivors === 0) {
      const again = await window.PineTSRunner.run(String(pine), bars, Object.assign({}, runOpts, { name: name + '\u00b7bars', forceBars: true }));
      if (again.ok) {
        res = again;
        retried = true;
      } else {
        retryFail = (again.reason || 'unknown') + (again.error && again.error.code ? ' [' + again.error.code + ']' : '');
      }
    }

    /* A chat door calls itself 'agent' — the legend and the badge must name the SCRIPT, which
       Pine declares up front: indicator('Smart Money Concepts', …). A door given a real name
       (the editor's, the Library's) keeps it. Declared before surface 1: record() uses it. */
    const declared = String(pine).match(/\b(?:indicator|strategy)\s*\(\s*['"]([^'"]+)['"]/);
    const label = (name && !/^agent(-draw|-script)?$/.test(name))
      ? name
      : (declared ? declared[1] : name);

    /* ── surface 1: geometry -> our overlay, read back after drawing ── */
    const geo = flatten(res.raw, bars);
    const stored = engineRows(res.raw);
    /* Multi-timeframe: the worker serves other timeframes from /api/bars and reports what it fetched or
       could not. With that report the warning is exactly what failed; without one (the main-thread
       fallback, whose engine still gets only the chart's own bars) the static call-out stands. */
    const mtf = res.mtf || null;
    const warnings = mtf
      ? (mtf.failed || []).map((f) => 'higher-timeframe bars for ' + f.symbol + ' ' + f.interval + ' could not be fetched ('
          + f.reason + ') \u2014 the script was given this chart\u2019s own bars for it, so those values are not the ' + f.interval + ' ones')
      : scriptNotes(pine, window.chartMarket ? (window.chartMarket() || {}).interval : '');
    if (depth.need && bars.length < depth.need + 20) {
      warnings.push('the script looks back about ' + depth.need + ' bars but only ' + bars.length + ' are available'
        + (bars.length >= MAX_BARS ? ' (the ceiling is ' + MAX_BARS + ')' : ' on this market') + ' \u2014 its longest-lookback values will be empty');
    }
    const engineN = stored.n;
    const containers = geometryOnly(geo) > 0;
    let drew = null;
    let verified = null;
    let drawFail = null;
    /* A script can have something to paint without declaring a single drawing container: its own plot
     * series. Those are paths now, so gate on both — gating on `containers` alone meant every
     * series-only indicator computed correctly and painted nothing. */
    const hasPaths = !!(geo.polylines && geo.polylines.length);
    /* A run whose every line is empty and which drew nothing else looks like a normal "Ran · 0 series". Say why. */
    const empties = emptyPlots(res.raw);
    if (!containers && !hasPaths && !(res.series && res.series.length) && empties.length) {
      const shown = empties.slice(0, 3).map((n) => '\u201c' + n + '\u201d').join(', ') + (empties.length > 3 ? ' and ' + (empties.length - 3) + ' more' : '');
      warnings.push('nothing was plotted: ' + shown + (empties.length === 1 ? ' has' : ' have') + ' no value on any of these ' + bars.length
        + ' bars \u2014 a lookback longer than the history (an input set higher than the bars allow), or a condition that never held');
    }
    if (containers || hasPaths) {
      if (!window.ChartOverlay) {
        drawFail = 'no overlay on this page — reload the console';
      } else {
        /* the drawings' x is an index into the bars the script ran on — hand the overlay that list */
        const spec = await window.ChartOverlay.apply(
          { boxes: geo.boxes, lines: geo.lines, labels: geo.labels, polylines: geo.polylines,
            tables: geo.tables }, Object.assign({}, opts || {}, { bars }));
        if (spec && spec.ok) {
          drew = {
            boxes: spec.boxes || 0, lines: spec.lines || 0, labels: spec.labels || 0,
            polylines: spec.polylines || 0,
            tables: spec.tables || 0, reason: spec.reason || null, mapping: spec.mapping || null,
          };
          verified = window.ChartOverlay.state ? window.ChartOverlay.state() : null;
          record(label, drew, warnings);
          if (!(opts && opts.restoring)) remember(pine, name, opts);
        } else {
          drawFail = (spec && spec.reason) || 'overlay refused';
        }
      }
    }

    /* ── surface 2: plot series -> a matching Vela native, ONLY if the script really plots.
       The 0-series guard is the fix for the native that came back from the dead: SMC's source
       contains ta.atr(, matched the heuristic, and re-added the indicator just removed. ── */
    let paint = null;
    if (res.series && res.series.length > 0 && window.PineTSPaint) {
      /* `containers` and the series count go with the source: a script that draws its own dashboard,
         or plots a family of series, is not expressed by one Vela native (see pinets-layer.js). */
      paint = await window.PineTSPaint.paintNative(String(pine), { containers, series: res.series.length });
    }

    return {
      ok: true, name, bars: bars.length, ms: res.ms,
      series: res.series || [], strategy: res.strategy || null,
      ctor: res.ctor ? (retried ? res.ctor + '->chart-bars' : res.ctor) : null,
      context: res.context || null,
      containers, drew, verified, drawFail, paint, warnings, depth, mtf,
      drawingKeys: res.drawings || [],   // which __*__ containers the engine declared at all
      rawRows: geo.rawRows, engineN, emptyN: stored.empty, retried, retryFail,
    };
  }

  /* The honest detail line, identical for chat, the Library and the editor. */
  function summarize(r) {
    if (!r || !r.ok) return (r && r.reason) || 'failed';
    let s = 'ran in ' + r.ms + ' ms over ' + r.bars + ' bars · ' + r.series.length + ' series';

    if (r.series.length) {
      if (r.paint && r.paint.added) {
        s += ' · drawn with Vela native "' + r.paint.added.title + '"';
        if (r.series.length > 1) {
          s += ' · ' + (r.series.length - 1) + ' other plot(s) not drawn as a Vela native';
        }
      } else {
        s += ' · not drawn as a Vela native: ' + ((r.paint && r.paint.reason) || 'paint layer missing');
      }
    }

    const st = r.strategy;
    if (st) {
      s += ' · strategy: net ' + st.netprofit + ' over ' + st.closedtrades + ' closed trades (' +
        st.wintrades + 'W/' + st.losstrades + 'L), max DD ' + st.max_drawdown +
        ', Sharpe ' + st.sharpe + ', CAGR ' + st.cagr + (st.truncated ? ' [partial]' : '');
    }

    if (r.drew) {
      s += ' · overlay drew ' + r.drew.boxes + ' box(es), ' + r.drew.lines + ' line(s), ' +
        r.drew.labels + ' label(s), ' + (r.drew.tables || 0) + ' table(s)' +
        (r.drew.polylines ? ', ' + r.drew.polylines + ' series path(s)' : '');
      const v = r.verified;
      if (v) {
        s += ' · verified: ' + v.boxes + ' box / ' + v.lines + ' line / ' +
          v.labels + ' label / ' + (v.tables || 0) + ' table on screen';
        /* A table can be in the DOM and still off the pane, and a count alone reads as "you can see
           it" — which was not always true. Report where it sits, and whether it is inside the pane. */
        if (v.tables > 0 && v.tablesRect) {
          s += ' (table #1: ' + (v.tablesCells || 0) + ' cell(s) at ' + v.tablesRect.x + ',' +
            v.tablesRect.y + ' ' + v.tablesRect.w + 'x' + v.tablesRect.h +
            (v.tablesInPane === false ? ' — OUTSIDE the pane' : v.tablesInPane === true ? ' — in the pane' : '') +
            /* In the pane is not on screen: the pane can be wider than what is shown (the docked
               desk is 332px wide with a 1067px chart inside it), and a layer can sit on top. The
               page's own probe answers it — say the answer, in both directions (round 6). */
            (v.tablesVisible === true ? ' — the browser shows it'
              : v.tablesVisible === false ? ' — NOT visible where it sits (covered, or off the shown area)' : '') +
            (v.tablesText ? ' — "' + v.tablesText.slice(0, 60) + '"' : ' — no text') +
            (v.paneRect ? '; pane ' + v.paneRect.x + ',' + v.paneRect.y + ' ' + v.paneRect.w + 'x' + v.paneRect.h : '') +
            (v.viewport ? '; page ' + v.viewport : '') + ')';
        } else if (v.tables > 0 && v.tablesCells === 0) {
          s += ' (the table has no cells filled — the script filled it on a bar we do not have)';
        }
      }
      if (r.drew.reason) s += ' · ' + r.drew.reason;
      if (r.drew.mapping) {
        s += ' · window bars ' + r.drew.mapping.i0 + '+' + r.drew.mapping.n + ' of ' +
          r.drew.mapping.bars + ', price ' + Math.round(r.drew.mapping.lo) + '-' + Math.round(r.drew.mapping.hi);
      }
    } else if (r.containers) {
      s += ' \u00b7 overlay: ' + (r.drawFail || 'nothing landed');
    } else if (!r.series.length) {
      if (r.engineN && r.emptyN === r.engineN) {
        s += ' \u00b7 the script drew nothing: every one of its ' + r.engineN +
          ' drawing container(s) still holds an empty placeholder row \u2014 its own conditions' +
          ' never fired on these bars' + (r.retried ? ' (chart-bars retry: same)' : '');
      } else if (r.engineN) {
        s += ' \u00b7 engine stored ' + r.engineN + ' raw row(s) but none survived the filters' +
          ' (raw: ' + Object.entries(r.rawRows || {}).filter(([, n]) => n).map(([k, n]) => k + '=' + n).join(' ') + ')';
      } else if (r.drawingKeys && r.drawingKeys.length) {
        s += ' \u00b7 containers declared but the engine stored NO rows \u2014 the data never reached' +
          ' the constructors' + (r.retried ? ' (chart-bars retry also empty)' : '');
      } else {
        s += ' \u00b7 nothing drawn: the script declared no drawing containers at all (no plots, no geometry)';
      }
    }

    if (r.retryFail) s += ' \u00b7 chart-bars retry failed: ' + r.retryFail;
    if (r.mtf && r.mtf.fetched && r.mtf.fetched.length) {
      s += ' \u00b7 multi-timeframe: ' + r.mtf.fetched.map((x) => x.symbol + ' ' + x.interval + ' (' + x.bars + ' bars)').join(', ');
    }
    if (r.warnings && r.warnings.length) s += ' \u00b7 \u26a0 ' + r.warnings.join(' \u00b7 \u26a0 ');
    if (r.ctor) s += ' \u00b7 engine context: ' + r.ctor + (r.context ? ' (' + r.context + ')' : '');
    return s;
  }

  /* chart_clear clears the overlay — the legend and the badge must forget with it. */
  function reset() {
    applied.length = 0;
    announce();
    try { localStorage.removeItem(RUN_KEY); } catch (err) { /* nothing stored */ }
    const legend = document.getElementById('script-legend');
    if (legend) { legend.hidden = true; legend.textContent = ''; legend.title = ''; }
  }

  /* Re-paint yesterday's run. Waits for bars (the chart fetches history after boot), runs once, and
     never re-saves itself. A stored run that no longer lands is dropped so it cannot fail every boot. */
  async function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || !saved.pine) return { ok: false, reason: 'nothing to restore' };
    for (let i = 0; i < 40; i++) {
      const bars = (typeof window.chartBars === 'function') ? await window.chartBars() : [];
      if (bars && bars.length >= 30) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const r = await run(saved.pine, saved.name, Object.assign({}, saved.opts || {}, { restoring: true }));
    if (!r.ok) { try { localStorage.removeItem(RUN_KEY); } catch (err) { /* ignore */ } }
    return r;
  }

  /* The drawings are a picture of ONE run on ONE market. A built-in recomputes itself when the symbol or
     timeframe changes; the overlay does not, so after 1h -> 4h the 1h boxes floated over the 4h candles
     at prices that had nothing to do with them (measured 4 Oct). Re-run what is on the chart against the
     new market; if that fails, take the stale picture off rather than leave it lying. */
  let marketSig = null;
  let rerunning = false;
  async function rerun() {
    if (rerunning || !applied.length) return null;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || !saved.pine) return null;
    rerunning = true;
    try {
      const r = await run(saved.pine, saved.name, Object.assign({}, saved.opts || {}, { restoring: true }));
      if (!r.ok || !r.drew) {
        if (window.ChartOverlay) window.ChartOverlay.clear();
        applied.length = 0;
        announce();
        const legend = document.getElementById('script-legend');
        if (legend) { legend.hidden = true; legend.textContent = ''; legend.title = ''; }
        if (window.taToast) window.taToast('The script could not be re-run on this market, so its drawings were removed.', true);
      }
      return r;
    } finally { rerunning = false; }
  }
  function watchMarket() {
    const ws = window.__wsApp && window.__wsApp.ws;
    const sigNow = () => { const m = window.chartMarket ? window.chartMarket() : null; return m && m.symbol && m.interval ? m.symbol + '@' + m.interval : null; };
    marketSig = sigNow();
    let pendingSig = null;
    let timer = null;
    /* NOT a reset-on-every-event debounce: the workspace emits state:changed constantly, so a timer that
       restarts on each one never fires (measured 4 Oct — the re-run silently never happened). The wait
       starts when a NEW market is first seen and only restarts if the market changes again. */
    const check = () => {
      const now = sigNow();
      if (!now || now === marketSig || now === pendingSig) return;
      pendingSig = now;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        pendingSig = null;
        if (sigNow() !== now) { check(); return; }
        marketSig = now;
        /* The new bars load and Vela's visible window settles first: drawing against the old window put
           boxes at the wrong bars. A quick script gets a second pass after the chart has surely settled. */
        const t0 = Date.now();
        const r = await rerun();
        if (r && r.ok && Date.now() - t0 < 2000) setTimeout(() => { if (sigNow() === now) rerun(); }, 2500);
      }, 1500);
    };
    try { if (ws && typeof ws.on === 'function') { ws.on('state:changed', check); ws.on('cell:created', check); } } catch (err) { /* no events: the poll below covers it */ }
    setInterval(check, 1000);   // an older Vela without those events still gets the re-run, a moment later
  }
  window.addEventListener('ws-ready', watchMarket, { once: true });

  return { run, summarize, flatten, reset, restore, rerun, lookbackNeeded, depthFor, scriptNotes, emptyPlots, list: () => applied.slice() };
})();
