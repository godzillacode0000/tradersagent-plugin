/**
 * PineTS standalone runner — the honest way to execute a Library indicator here.
 *
 * Why this exists: Vela's own Pine engine (vela-pinets → PineWorkerEngine) is wired
 * and registered, but on a live chart it often never executes a script — measured at
 * 90 s / 112 s / 40 s / 75 s of silence, with `historyComplete()` and `runIndicator()`
 * returning promises that never settle (see README → "Pine engine"). PineTS run
 * standalone over the same bars computes the same source in a few hundred ms and
 * hands back plain arrays, which the chart can then paint as native series.
 *
 * Nothing from LuxAlgo is copied here: `pinets` is imported from their published
 * build at runtime, and the script source arrives from the LuxAlgo MCP per request.
 * PineTS is AGPL-3.0-only — this console is a local/dev tool, never a shipped build.
 *
 * Classic script: `import()` inside a classic script still resolves through the
 * page's import map, so no bundler is needed on this box.
 */
(function () {
  'use strict';

  const PINETS_SPECIFIER = 'pinets';          // resolved via the page's import map
  const DEFAULT_TIMEOUT_MS = 20000;

  let ctorPromise = null;

  /* What PineTS genuinely cannot run today, each with the exact reason the UI shows.
     Keep this list honest: a wrong "runnable" here is reported to the user as success. */
  const GAPS = [
    [/^\s*import\s/m, 'not runnable: `import` (LuxAlgo libraries) is unimplemented in PineTS'],
    [/\bwhile\b/, 'not runnable: `while` loops are unimplemented in PineTS'],
    [/\bfor\s+\w+\s+in\b/, 'not runnable: `for … in` is unimplemented in PineTS']
  ];

  /** Strip comments so a construct NAMED in prose never blocks a file that does not use it. */
  function stripComments(source) {
    return String(source)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');       // line comments (leave URLs alone)
  }

  /** '' when the source looks runnable, otherwise the reason it cannot run. */
  function runnable(source) {
    if (!source || !source.trim()) return 'not runnable: empty source';
    const code = stripComments(source);
    for (const [re, reason] of GAPS) if (re.test(code)) return reason;
    return '';
  }

  function loadPineTS() {
    if (!ctorPromise) {
      ctorPromise = import(PINETS_SPECIFIER)
        .then((mod) => {
          const Ctor = mod.PineTS || (mod.default && mod.default.PineTS);
          if (typeof Ctor !== 'function') {
            throw new Error('the pinets build exposes no PineTS export — check the CDN entry');
          }
          return Object.assign({}, mod, { PineTS: Ctor });      // keep Provider too
        })
        .catch((err) => { ctorPromise = null; throw err; });   // allow a retry
    }
    return ctorPromise;
  }

  const INTERVALS = [[60000, '1m'], [180000, '3m'], [300000, '5m'], [900000, '15m'], [1800000, '30m'],
                     [3600000, '1h'], [7200000, '2h'], [14400000, '4h'], [28800000, '8h'], [86400000, '1d']];

  /**
   * The VISIBLE timeframe, taken from the bars themselves.
   *
   * `chart.market.timeframe` is not trustworthy here: on the live pane it reported "4h" while the
   * chart was rendering 15m, and the provider then fetched 4h candles — so every price the script
   * computed belonged to a different series than the one on screen. The median gap between the
   * chart's own bars cannot lie about what is drawn.
   */
  function timeframeFromBars(bars) {
    if (!Array.isArray(bars) || bars.length < 3) return null;
    const gaps = [];
    for (let i = 1; i < bars.length && gaps.length < 60; i++) {
      const a = bars[i - 1].time != null ? bars[i - 1].time : bars[i - 1].openTime;
      const b = bars[i].time != null ? bars[i].time : bars[i].openTime;
      if (a == null || b == null) continue;
      const d = Number(b) - Number(a);
      if (d > 0) gaps.push(d);
    }
    if (!gaps.length) return null;
    gaps.sort((x, y) => x - y);
    const med = gaps[Math.floor(gaps.length / 2)];
    let best = null;
    for (const [ms, name] of INTERVALS) if (!best || Math.abs(ms - med) < Math.abs(best[0] - med)) best = [ms, name];
    return best ? best[1] : null;
  }

  /** The chart's own market, so scripts that read syminfo/tickerid have somewhere to read it from. */
  function marketContext(bars) {
    const m = (window.__consoleChart && window.__consoleChart.market) || {};
    const symbol = m.symbol || 'BTCUSDT';
    const fromBars = timeframeFromBars(bars);
    let tf = fromBars || m.timeframe || '15';
    if (/^\d+$/.test(String(tf))) tf = String(tf);
    return { symbol: symbol, timeframe: tf, source: fromBars ? 'bars' : 'market',
             reported: m.timeframe ? String(m.timeframe) : null };
  }

  /**
   * PineTS has TWO documented constructors:
   *   new PineTS(Provider.Binance, symbol, timeframe, limit)   // market context present
   *   new PineTS(candles)                                      // your own OHLCV, NO context
   * Only the first defines syminfo/tickerid, so any Library script that touches them throws
   * "Cannot read properties of undefined (reading 'ticker')" on the second — measured on
   * buyside-sellside-liquidity and liquidity-swings. The provider form returns the same bars
   * from the same exchange (verified: 500 bars, last close within 4 cents of the chart's), so
   * it is the default and custom bars stay as the offline fallback.
   */
  function newEngine(mod, bars) {
    const ctx = marketContext(bars);
    const Provider = mod.Provider || {};
    if (Provider.Binance) {
      try {
        const engine = new mod.PineTS(Provider.Binance, ctx.symbol, ctx.timeframe, Math.max(30, bars.length));
        return { engine, ctor: 'provider', context: ctx.symbol + '@' + ctx.timeframe };
      } catch (err) {
        /* fall through to custom bars */
      }
    }
    return { engine: new mod.PineTS(bars), ctor: 'custom-bars', context: null };
  }

  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms / 1000}s`)), ms);
      })
    ]);
  }

  /** Pine plot points arrive as `{ title, value, options }`, not bare numbers. */
  function pointValue(p) {
    if (typeof p === 'number') return isFinite(p) ? p : null;
    if (p && typeof p.value === 'number') return isFinite(p.value) ? p.value : null;
    return null;
  }

  function pointColor(p) {
    return (p && p.options && p.options.color) || null;
  }

  /** Normalise whatever shape a run returns into `[{ name, values, color }]`. */
  function toSeries(out) {
    const series = [];
    const plots = out && out.plots;
    if (plots && typeof plots === 'object') {
      for (const [name, plot] of Object.entries(plots)) {
        if (name.startsWith('__')) continue;                 // drawing container, not a line
        const raw = Array.isArray(plot) ? plot : (plot && Array.isArray(plot.data) ? plot.data : null);
        if (!raw || !raw.length) continue;
        const values = raw.map(pointValue);
        const first = raw.find((p) => pointValue(p) != null);
        if (values.some((v) => v != null)) {
          series.push({ name, values, color: pointColor(first) });
        }
      }
    }
    if (!series.length && out && Array.isArray(out.series)) {
      out.series.forEach((s, i) => {
        const raw = Array.isArray(s) ? s : (s && Array.isArray(s.values) ? s.values : null);
        if (!raw || !raw.length) return;
        const values = raw.map(pointValue);
        if (values.some((v) => v != null)) {
          series.push({ name: (s && s.name) || `series ${i + 1}`, values, color: null });
        }
      });
    }
    return series;
  }

  function toStrategy(out) {
    const s = out && out.strategy;
    if (!s) return null;
    const closed = Array.isArray(s.closedtrades) ? s.closedtrades : [];
    return {
      netprofit: s.netprofit,
      closedtrades: closed.length,
      wintrades: s.wintrades,
      losstrades: s.losstrades,
      max_drawdown: s.max_drawdown,
      sharpe: s.sharpe_ratio,
      cagr: s.cagr,
      open_trades: Array.isArray(s.opentrades) ? s.opentrades.length : null
    };
  }

  /**
   * Run `source` over `bars` with PineTS.
   * Resolves `{ ok: true, ms, series, strategy }` or `{ ok: false, reason }` —
   * never throws, so the caller can always render something truthful.
   */
  async function run(source, bars, options) {
    const opts = options || {};
    const reason = runnable(source);
    if (reason) return { ok: false, reason };

    const count = Array.isArray(bars) ? bars.length : 0;
    if (count < 30) {
      return { ok: false, reason: `not runnable: only ${count} bars available (need at least 30)` };
    }

    let mod;
    try {
      mod = await loadPineTS();
    } catch (err) {
      return { ok: false, reason: 'PineTS unavailable: ' + ((err && err.message) || err) };
    }

    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    const t0 = performance.now();
    const label = 'PineTS' + (opts.name ? ` (${opts.name})` : '');
    let built = newEngine(mod, bars);
    try {
      let out;
      try {
        out = await withTimeout(built.engine.run(source), timeoutMs, label);
      } catch (err) {
        // A script that needs market context fails on custom bars with the ticker/syminfo error.
        // Retry the documented provider form before reporting a failure.
        const msg = String((err && err.message) || err);
        if (built.ctor === 'custom-bars' || !/ticker|syminfo/i.test(msg)) throw err;
        built = { engine: new mod.PineTS(bars), ctor: 'custom-bars', context: null };
        out = await withTimeout(built.engine.run(source), timeoutMs, label);
      }
      const ms = Math.round(performance.now() - t0);
      return { ok: true, ms, series: toSeries(out), strategy: toStrategy(out),
               drawings: out && out.plots ? Object.keys(out.plots).filter((k) => k.startsWith('__')) : [],
               ctor: built.ctor, context: built.context, raw: out };
    } catch (err) {
      return { ok: false, reason: 'PineTS error: ' + ((err && err.message) || err),
               ctor: built.ctor, context: built.context };
    }
  }

  window.PineTSRunner = { run, runnable, loadPineTS, toSeries, marketContext, newEngine };
  console.log('[pinets-runner] ready — PineTS loads on first run (independent of Vela’s Pine engine)');
})();
