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

  function flatten(raw) {
    const plots = (raw && raw.plots) || {};
    const rawRows = {};   // rows the ENGINE stored, before any filter — the honest denominator
    const rowsOf = (key) => {
      const node = plots[key];
      const rows = node && Array.isArray(node.data) ? node.data : [];
      rawRows[key.replace(/__/g, '')] = rows.length;
      const vals = [];
      for (const row of rows) {
        const v = row && row.value;
        if (Array.isArray(v)) vals.push(...v);
        else if (v && typeof v === 'object') vals.push(v);   // shape tolerance: value may be the object itself
      }
      return vals.filter((x) => x && typeof x === 'object' && !x._deleted);
    };
    return {
      boxes: rowsOf('__boxes__').filter((b) => b.xloc !== 'bt'),
      lines: rowsOf('__lines__'),
      labels: rowsOf('__labels__'),
      tables: rowsOf('__tables__'),
      rawRows,
    };
  }

  /* `drew` carries NUMBERS (what the overlay reports it drew); `flatten` carries ARRAYS (the
     objects themselves). Adding arrays with `+` stringifies them — that made `=== 0` permanently
     false and hid the provider guard for a whole afternoon (measured 23 Sep). Count by length. */
  const fieldN = (v) => (Array.isArray(v) ? v.length : (typeof v === 'number' ? v : (v ? 1 : 0)));
  const counts = (o) => (o ? fieldN(o.boxes) + fieldN(o.lines) + fieldN(o.labels) + fieldN(o.tables) : 0);

  /* Rows the engine actually stored across every drawing container — before filters, before shape. */
  function engineRows(raw) {
    const plots = (raw && raw.plots) || {};
    let n = 0;
    for (const k of Object.keys(plots)) {
      if (!k.startsWith('__')) continue;
      const rows = plots[k] && Array.isArray(plots[k].data) ? plots[k].data : [];
      n += rows.length;
    }
    return n;
  }

  function record(name, drew) {
    if (!name || counts(drew) === 0) return;
    if (!applied.includes(name)) applied.push(name);
    const legend = document.getElementById('script-legend');
    if (legend) {
      legend.textContent = applied.map((n) => n + ' · overlay').join('  ·  ');
      legend.title = applied.join(' · ');
      legend.hidden = false;
    }
  }

  async function run(pine, name, opts) {
    name = name || 'agent';
    if (!pine || !String(pine).trim()) return { ok: false, reason: 'no Pine source in the command' };
    if (typeof window.chartBars !== 'function') return { ok: false, reason: 'no chart on this page' };
    if (!window.PineTSRunner) return { ok: false, reason: 'Pine engine missing — indicators cannot be mounted' };

    const bars = await window.chartBars();
    let res = await window.PineTSRunner.run(String(pine), bars, { name });
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
      const again = await window.PineTSRunner.run(String(pine), bars, { name: name + '\u00b7bars', forceBars: true });
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
    const geo = flatten(res.raw);
    const engineN = engineRows(res.raw);
    const containers = counts(geo) > 0;
    let drew = null;
    let verified = null;
    let drawFail = null;
    if (containers) {
      if (!window.ChartOverlay) {
        drawFail = 'no overlay on this page — reload the console';
      } else {
        const spec = await window.ChartOverlay.apply(
          { boxes: geo.boxes, lines: geo.lines, labels: geo.labels, tables: geo.tables }, opts || {});
        if (spec && spec.ok) {
          drew = {
            boxes: spec.boxes || 0, lines: spec.lines || 0, labels: spec.labels || 0,
            tables: spec.tables || 0, reason: spec.reason || null, mapping: spec.mapping || null,
          };
          verified = window.ChartOverlay.state ? window.ChartOverlay.state() : null;
          record(label, drew);
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
      paint = await window.PineTSPaint.paintNative(String(pine));
    }

    return {
      ok: true, name, bars: bars.length, ms: res.ms,
      series: res.series || [], strategy: res.strategy || null,
      ctor: res.ctor ? (retried ? res.ctor + '->chart-bars' : res.ctor) : null,
      context: res.context || null,
      containers, drew, verified, drawFail, paint,
      drawingKeys: res.drawings || [],   // which __*__ containers the engine declared at all
      rawRows: geo.rawRows, engineN, retried, retryFail,
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
          s += ' · ' + (r.series.length - 1) + ' other plot(s) not drawn (no exact Vela native)';
        }
      } else {
        s += ' · not drawn: ' + ((r.paint && r.paint.reason) || 'paint layer missing');
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
        r.drew.labels + ' label(s), ' + (r.drew.tables || 0) + ' table(s)';
      const v = r.verified;
      if (v) {
        s += ' · verified: ' + v.boxes + ' box / ' + v.lines + ' line / ' +
          v.labels + ' label / ' + (v.tables || 0) + ' table on screen';
      }
      if (r.drew.reason) s += ' · ' + r.drew.reason;
      if (r.drew.mapping) {
        s += ' · window bars ' + r.drew.mapping.i0 + '+' + r.drew.mapping.n + ' of ' +
          r.drew.mapping.bars + ', price ' + Math.round(r.drew.mapping.lo) + '-' + Math.round(r.drew.mapping.hi);
      }
    } else if (r.containers) {
      s += ' \u00b7 overlay: ' + (r.drawFail || 'nothing landed');
    } else if (!r.series.length) {
      if (r.engineN) {
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
    if (r.ctor) s += ' \u00b7 engine context: ' + r.ctor + (r.context ? ' (' + r.context + ')' : '');
    return s;
  }

  /* chart_clear clears the overlay — the legend and the badge must forget with it. */
  function reset() {
    applied.length = 0;
    const legend = document.getElementById('script-legend');
    if (legend) { legend.hidden = true; legend.textContent = ''; legend.title = ''; }
  }

  return { run, summarize, flatten, reset, list: () => applied.slice() };
})();
