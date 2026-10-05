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
     Keep this list honest in BOTH directions: a wrong "runnable" here is reported to the user as
     success, and a wrong refusal hides a script that would have worked.

     `while` and `for … in` were refused here for months and they both RUN. Measured 28 Sep 2026 with
     the offline battery (`scripts/pinets-engine-battery.mjs`), on pinets 0.10.0 AND 0.9.33 (our
     floor): a `while` probe and a `for … in` probe each return OK, and a real Library script that
     carries a `while` (eqh-eql-fvg-breakouts, 17,917 characters) runs and returns 2 series. The
     engine's own source has `WhileStatement` in the parser and the codegen, and its AGENTS.md
     documents `whl<n>_` while-loop scopes. The refusal was ours, and it sat in front of roughly half
     the catalogue — 450 of 806 indicators were refused by this regex, not by the engine.

     Before adding an entry here, PROVE the refusal with a run: put the construct in a tiny script and
     run it through the battery. A guard is a claim about the engine and it decays. */
  const GAPS = [
    [/^\s*import\s/m, '`import` (LuxAlgo libraries) is unimplemented in PineTS']
  ];

  /** Strip comments so a construct NAMED in prose never blocks a file that does not use it. */
  function stripComments(source) {
    return String(source)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');       // line comments (leave URLs alone)
  }

  /** '' when the source looks runnable, otherwise the reason it cannot run. */
  function runnable(source) {
    if (!source || !source.trim()) return 'empty source';
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
          /* Expose the PATCHED namespace globally: app.js's bare-chart fallback and anything else on
             the page that reaches for an engine should be able to find the fork's build (the audit's
             #17: only this path used it, while Vela's own workspace ran vela-pinets' bundled copy). */
          window.PineTS = mod;
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

  /** The bar's open time, whichever key the chart's own bars use. */
  function barTime(b) {
    const t = b && (b.openTime != null ? b.openTime : (b.time != null ? b.time : b.t));
    return t == null ? null : Number(t);
  }

  /**
   * The chart's own bars, in the shape PineTS's candle objects actually use.
   *
   * PineTS keys candles `openTime`/`closeTime`; Vela's bars (and the Binance fallback in
   * app.js) carry `time`. A run built on `time` bars still executes — but every `time(...)`
   * and session call reads `undefined` bar times and quietly answers na, so session-gated
   * scripts silently do nothing. Measured 24 Sep on the AMD POC setup script: 0 of 500 bars
   * "in session" with `time` bars, 185 of 500 with `openTime` bars, same candles.
   */
  function normalizeBars(bars) {
    const list = Array.isArray(bars) ? bars : [];
    const gaps = [];
    for (let i = 1; i < list.length && gaps.length < 60; i++) {
      const a = barTime(list[i - 1]);
      const b = barTime(list[i]);
      if (a != null && b != null && b > a) gaps.push(b - a);
    }
    gaps.sort((x, y) => x - y);
    const step = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    return list.map((b) => {
      const t = barTime(b);
      return Object.assign({}, b, {
        openTime: t != null ? t : b.openTime,
        closeTime: b.closeTime != null ? Number(b.closeTime) : (t != null ? t + step : undefined),
        volume: b.volume != null ? b.volume : 0,
      });
    });
  }

  /**
   * PineTS has TWO documented constructors:
   *   new PineTS(Provider.Binance, symbol, timeframe, limit)   // market context present
   *   new PineTS(candles, symbol, timeframe, limit)            // your own OHLCV, context still passed
   * Only a context defines syminfo/tickerid — and, less obviously, `timeframe.*`: PineTS's
   * timeframe helper slices `context.timeframe`, so a bars-only engine throws
   * "Cannot read properties of undefined (reading 'slice')" the moment a script touches
   * `timeframe.period` or `timeframe.in_seconds()`. Measured 24 Sep: the AMD POC setup script's
   * chart-bars retry died on exactly that line, and the same script with the context passed ran
   * to completion. So the custom-bars form carries the same ctx as the provider form, and the
   * bars are normalised first.
   */
  function newEngine(mod, bars, forceBars) {
    const ctx = marketContext(bars);
    const Provider = mod.Provider || {};
    /* `forceBars` (23 Sep) skips the provider: its clean return can lie — a run over the
       provider's own fetch drew NOTHING while the chart's own bars sat right there. */
    if (!forceBars && Provider.Binance) {
      try {
        const engine = new mod.PineTS(Provider.Binance, ctx.symbol, ctx.timeframe, Math.max(30, bars.length));
        return { engine, ctor: 'provider', context: ctx.symbol + '@' + ctx.timeframe };
      } catch (err) {
        /* fall through to custom bars */
      }
    }
    return {
      engine: new mod.PineTS(withSymbolInfo(bars, ctx), ctx.symbol, ctx.timeframe, Math.max(30, bars.length)),
      ctor: 'custom-bars', context: ctx.symbol + '@' + ctx.timeframe,
    };
  }

  /**
   * Fix #3 (28 Sep): a bars-only engine has NO syminfo.
   *
   * Measured over every indicator the LuxAlgo MCP serves (797 sources run through this engine):
   * 203 crash, and 146 of those (71%) die reading `syminfo` — tickerid 77, mintick 52, ticker 11,
   * timezone 3, basecurrency 3. The console feeds the chart's own bars, so no market-data provider
   * is involved, and PineTS fills `_syminfo` ONLY when the source it was handed exposes
   * `getSymbolInfo` (PineTS.class.ts: `if (source && source.getSymbolInfo)`). An array carrying that
   * method takes the same path — `Array.isArray` stays true, so `loadMarketData` still returns our
   * bars — which is why this hangs the info off the array instead of inventing a provider.
   *
   * mintick is derived from the bars themselves (the most decimal places any price carries), not
   * assumed: a wrong tick size silently changes rounding in scripts that use it.
   */
  function withSymbolInfo(bars, ctx) {
    const arr = normalizeBars(bars);
    const symbol = String(ctx.symbol || 'BTCUSDT').toUpperCase();
    const m = /^(.*?)(USDT|USDC|BUSD|FDUSD|TUSD|USD|BTC|ETH|BNB)$/.exec(symbol);
    const base = (m && m[1]) || symbol;
    const quote = (m && m[2]) || 'USDT';
    const mintick = inferMintick(arr);
    const info = {
      ticker: symbol,
      tickerid: 'BINANCE:' + symbol,
      prefix: 'BINANCE',
      root: base,
      description: base + ' / ' + quote,
      type: 'crypto',
      main_tickerid: 'BINANCE:' + symbol,
      current_contract: '',
      isin: '',
      basecurrency: base,
      currency: quote,
      timezone: 'UTC',
      country: '',
      mintick: mintick,
      pricescale: Math.round(1 / mintick),
      minmove: 1,
      pointvalue: 1,
      mincontract: 0,
      session: '24x7',
      volumetype: 'base',
      expiration_date: 0,
      employees: 0,
      industry: '',
      sector: '',
      shareholders: 0,
      shares_outstanding: 0,
      source: 'chart-bars',
    };
    try {
      arr.getSymbolInfo = () => Promise.resolve(info);
    } catch (err) {
      /* a frozen array would throw; the caller still gets usable bars */
    }
    return arr;
  }

  /** The bars' own precision, so a tick size is derived rather than assumed. */
  function inferMintick(arr) {
    let decimals = 0;
    for (let i = Math.max(0, arr.length - 60); i < arr.length; i += 1) {
      const c = String(arr[i] && arr[i].close);
      const dot = c.indexOf('.');
      if (dot > 0) decimals = Math.max(decimals, Math.min(8, c.length - dot - 1));
    }
    return decimals > 0 ? Math.pow(10, -decimals) : 1e-8;
  }

  /**
   * Fix #2 (28 Sep, measured): run the engine in a Worker, because a slow script freezes the console.
   *
   * A 20-second run ticked a 250 ms interval ZERO times, so no timer fires while the engine works:
   * `withTimeout` cannot rescue a blocking run, and every queued bridge command waits behind it. The
   * catalogue's slowest script measured 301 s. `worker.terminate()` is the only way to interrupt one.
   *
   * The worker imports PineTS by URL resolved from the page's import map — import maps do not reach
   * workers, and the page's own entry is a bare specifier (`pinets`).
   */
  function engineUrl() {
    try {
      const el = document.querySelector('script[type="importmap"]');
      const map = JSON.parse((el && el.textContent) || '{}');
      const url = map && map.imports && map.imports[PINETS_SPECIFIER];
      if (url) return url;
    } catch (err) {
      /* fall through to the specifier itself */
    }
    return /^https?:/.test(PINETS_SPECIFIER) ? PINETS_SPECIFIER : null;
  }

  function workerRun(source, bars, ctx, timeoutMs, label, inputs) {
    return new Promise((resolve) => {
      const url = engineUrl();
      if (typeof Worker === 'undefined' || !url) {
        resolve({ unavailable: true });
        return;
      }
      let worker;
      try {
        worker = new Worker('pinets-worker.js', { type: 'module' });
      } catch (err) {
        resolve({ unavailable: true });
        return;
      }
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        try { worker.terminate(); } catch (err) { /* already gone */ }
        resolve(value);
      };
      const deadline = setTimeout(() => finish({
        ok: false,
        reason: `${label} did not finish within ${timeoutMs / 1000}s — cancelled (a running script cannot `
          + 'be interrupted, so its worker was terminated and the pane kept working)',
        error: classify('did not finish within'),
      }), timeoutMs);
      worker.onmessage = (ev) => {
        const d = (ev && ev.data) || {};
        if (!d.ok) {
          const error = classify(d.reason);
          if (d.method) error.method = d.method;
          finish({ ok: false, reason: 'PineTS error: ' + d.reason, error });
          return;
        }
        finish({ ok: true, ms: d.ms, plots: d.plots || {}, strategy: d.strategy || null,
                 drawings: d.drawings || [], mtf: d.mtf || null });
      };
      worker.onerror = (ev) => {
        const why = (ev && ev.message) || 'worker failed to start';
        finish({ ok: false, workerFailed: true, reason: 'worker failed: ' + why });
      };
      const list = Array.isArray(bars) ? bars : [];
      worker.postMessage({
        engineUrl: url,
        source: source,
        inputs: inputs || null,
        bars: normalizeBars(list),
        symbol: ctx.symbol,
        timeframe: ctx.timeframe,
        mintick: inferMintick(list),
      });
    });
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
    /* The trades themselves, not only their count (26 Sep): the backtest engine needs the events,
       and a summary cannot be replayed. Each row keeps its original fields and gains normalized
       aliases, because PineTS's own key names are the engine's business to absorb. */
    const trades = closed.map((t) => {
      const o = (t && typeof t === 'object') ? t : { value: t };
      return Object.assign({}, o, {
        entry_time: o.entry_time ?? o.entryTime ?? o.entryDate ?? o.entry_bar_index ?? null,
        exit_time: o.exit_time ?? o.exitTime ?? o.exitDate ?? o.exit_bar_index ?? null,
        entry_price: o.entry_price ?? o.entryPrice ?? null,
        exit_price: o.exit_price ?? o.exitPrice ?? null,
        size: o.size ?? o.qty ?? null,
        profit: o.profit ?? o.netprofit ?? null,
      });
    });
    return {
      netprofit: s.netprofit,
      closedtrades: closed.length,
      trades: trades,
      wintrades: s.wintrades,
      losstrades: s.losstrades,
      max_drawdown: s.max_drawdown,
      sharpe: s.sharpe_ratio,
      cagr: s.cagr,
      open_trades: Array.isArray(s.opentrades) ? s.opentrades.length : null
    };
  }

  /**
   * Every failure carries a stable code, not just prose.
   *
   * A caller (the CLI, the MCP tool, the agent reading the README) should be able to branch on
   * `code` instead of regex-matching a sentence — and the README can then document the closed set.
   * `reason` stays for humans; `error` is the contract. Codes:
   *
   *   NOT_RUNNABLE       the engine cannot execute this construct (feature: while | for-in | import)
   *   RUNTIME_CRASH      PineTS threw while running (kind: pinets-get_v | pinets-ticker | pinets-runtime)
   *   TOO_FEW_BARS       the chart has too little history loaded
   *   ENGINE_UNAVAILABLE the PineTS module could not be fetched
   *   TIMEOUT            the run exceeded the time budget
   */
  const ERROR_HINTS = {
    NOT_RUNNABLE: 'PineTS cannot run this construct — it needs a full TradingView engine.',
    RUNTIME_CRASH: 'PineTS threw mid-run; the engine (not the call) is at fault. Try a simpler script.',
    TOO_FEW_BARS: 'Not enough history on the chart; widen the range or scroll back, then retry.',
    ENGINE_UNAVAILABLE: 'PineTS could not be fetched (offline/CDN). Retry when online.',
    TIMEOUT: 'The run exceeded its time budget. Retry, or run it on a shorter history.',
    NO_SOURCE: 'Pass the script source: a LuxAlgo Library slug or a .pine file.',
    SYNTAX_ERROR: 'Pine could not parse the script. Fix the line named (an unclosed bracket is often reported at the end of the file).',
  };

  /** Which construct the engine refused, named the way the docs name it. */
  function refusedFeature(msg) {
    if (/while/i.test(msg)) return 'while';
    if (/import/i.test(msg)) return 'import';
    if (/for\s*(\u2026|\.\.|in)/i.test(msg)) return 'for-in';
    return null;
  }

  /** `… at line 42 …` / `line 42` in an engine error → the line number when one is quoted. A syntax error
   *  says `at 3:7` (line:column) instead — see quotedCol. */
  function quotedLine(msg) {
    const at = String(msg).match(/\bat ([0-9]{1,6}):[0-9]{1,6}\b/);
    if (at) return Number(at[1]);
    const m = String(msg).match(/line[^0-9]{0,4}([0-9]{1,6})/i);
    return m ? Number(m[1]) : null;
  }

  function quotedCol(msg) {
    const at = String(msg).match(/\bat [0-9]{1,6}:([0-9]{1,6})\b/);
    return at ? Number(at[1]) : null;
  }

  function classify(msg, fallbackCode) {
    const text = String(msg || '');
    if (/did not finish within/i.test(text)) {
      return { code: 'TIMEOUT', message: text, retryable: true, hint: ERROR_HINTS.TIMEOUT };
    }
    const feature = /unimplemented|not supported|unsupported/i.test(text) ? refusedFeature(text) : null;
    if (feature) {
      return { code: 'NOT_RUNNABLE', feature, message: text, retryable: false, hint: ERROR_HINTS.NOT_RUNNABLE };
    }
    if (/TOO_FEW_BARS|only [0-9]+ bars/i.test(text)) {
      return { code: 'TOO_FEW_BARS', message: text, retryable: true, hint: ERROR_HINTS.TOO_FEW_BARS };
    }
    if (/PineTS unavailable/i.test(text)) {
      return { code: 'ENGINE_UNAVAILABLE', message: text, retryable: true, hint: ERROR_HINTS.ENGINE_UNAVAILABLE };
    }
    if (/Failed to transpile|Unexpected (token|character)|Unterminated/i.test(text)) {
      return { code: 'SYNTAX_ERROR', message: text, line: quotedLine(text), col: quotedCol(text), retryable: false,
               hint: ERROR_HINTS.SYNTAX_ERROR };
    }
    if (/is not defined|Cannot read propert|undefined \(reading/i.test(text)) {
      const kind = /get_v/.test(text) ? 'pinets-get_v'
        : (/ticker|syminfo/i.test(text) ? 'pinets-ticker' : 'pinets-runtime');
      return { code: 'RUNTIME_CRASH', kind, message: text, line: quotedLine(text), retryable: false,
               hint: ERROR_HINTS.RUNTIME_CRASH };
    }
    const code = fallbackCode || 'RUNTIME_CRASH';
    return { code, message: text, line: quotedLine(text), retryable: false, hint: ERROR_HINTS[code] || null };
  }

  /**
   * Run `source` over `bars` with PineTS.
   * Resolves `{ ok: true, ms, series, strategy }` or `{ ok: false, reason }` —
   * never throws, so the caller can always render something truthful.
   */
  async function run(source, bars, options) {
    const opts = options || {};
    if (!String(source || '').trim()) {
      return { ok: false, reason: 'no Pine source given', error: classify('no Pine source given', 'NO_SOURCE') };
    }
    const reason = runnable(source);
    if (reason) return { ok: false, reason: 'not runnable: ' + reason, error: classify(reason) };

    const count = Array.isArray(bars) ? bars.length : 0;
    if (count < 30) {
      const why = `only ${count} bars available (need at least 30)`;
      return { ok: false, reason: 'not runnable: ' + why, error: classify(why, 'TOO_FEW_BARS') };
    }

    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    const t0 = performance.now();
    const label = 'PineTS' + (opts.name ? ` (${opts.name})` : '');
    const ctx = marketContext(bars);

    /* Worker first (fix #2). A run that overruns is terminated, not waited on — the pane stays usable,
       which is the whole point: the bridge's earlier "page is dead" reports were runs, not crashes. */
    const viaWorker = await workerRun(source, bars, ctx, timeoutMs, label, opts.inputs);
    if (!viaWorker.unavailable) {
      const ms = Math.round(performance.now() - t0);
      const context = ctx.symbol + '@' + ctx.timeframe;
      if (!viaWorker.ok && !viaWorker.workerFailed) {
        return { ok: false, reason: viaWorker.reason, error: viaWorker.error,
                 ctor: 'worker', context: context };
      }
      if (viaWorker.ok) {
        /* `raw` must carry the same shape the main-thread path returns, because flatten() and
         * engineRows() read `raw.plots`. Without it every worker run painted nothing at all — the
         * drawings and the script's own series were computed and then dropped on the floor. */
        return { ok: true, ms: ms, series: toSeries({ plots: viaWorker.plots }),
                 raw: { plots: viaWorker.plots, strategy: viaWorker.strategy },
                 strategy: toStrategy({ strategy: viaWorker.strategy }),
                 drawings: viaWorker.drawings, mtf: viaWorker.mtf || null, ctor: 'worker', context: context };
      }
      /* a worker that could not start falls through to the old main-thread path */
    }

    let mod;
    try {
      mod = await loadPineTS();
    } catch (err) {
      const why = 'PineTS unavailable: ' + ((err && err.message) || err);
      return { ok: false, reason: why, error: classify(why, 'ENGINE_UNAVAILABLE') };
    }

    let built = newEngine(mod, bars, opts.forceBars);
    /* Changed inputs ride in on an Indicator, as in the worker; an untouched script runs from its source. */
    const target = opts.inputs && Object.keys(opts.inputs).length && typeof mod.Indicator === 'function'
      ? new mod.Indicator(source, opts.inputs) : source;
    try {
      let out;
      try {
        out = await withTimeout(built.engine.run(target), timeoutMs, label);
      } catch (err) {
        // A script that needs market context fails on custom bars with the ticker/syminfo error.
        // Retry the documented provider form before reporting a failure.
        const msg = String((err && err.message) || err);
        if (built.ctor === 'custom-bars' || !/ticker|syminfo/i.test(msg)) throw err;
        built = newEngine(mod, bars, true);
        out = await withTimeout(built.engine.run(target), timeoutMs, label);
      }
      const ms = Math.round(performance.now() - t0);
      return { ok: true, ms, series: toSeries(out), strategy: toStrategy(out),
               drawings: out && out.plots ? Object.keys(out.plots).filter((k) => k.startsWith('__')) : [],
               ctor: built.ctor, context: built.context, raw: out };
    } catch (err) {
      const why = String((err && err.message) || err);
      return { ok: false, reason: 'PineTS error: ' + why, error: classify(why),
               ctor: built.ctor, context: built.context };
    }
  }

  /**
   * The script's input.*() declarations, read by the engine without running it: [{ id, type, title, defval,
   * group, minval, maxval, step, options, tooltip, varId }]. A one-shot worker (like a run), so a big
   * source never costs the page a frame, with a short deadline. Resolves { ok, inputs } or { ok:false }.
   */
  function scanInputs(source) {
    return new Promise((resolve) => {
      const url = engineUrl();
      if (typeof Worker === 'undefined' || !url || !String(source || '').trim()) { resolve({ ok: false, reason: 'no engine' }); return; }
      let worker;
      try { worker = new Worker('pinets-worker.js', { type: 'module' }); } catch (err) { resolve({ ok: false, reason: 'no worker' }); return; }
      let done = false;
      const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { worker.terminate(); } catch (err) { /* gone */ } resolve(v); };
      const timer = setTimeout(() => finish({ ok: false, reason: 'scan timed out' }), 8000);
      worker.onmessage = (ev) => {
        const d = (ev && ev.data) || {};
        finish(d.ok ? { ok: true, inputs: Array.isArray(d.inputs) ? d.inputs : [] } : { ok: false, reason: d.reason || 'scan failed' });
      };
      worker.onerror = () => finish({ ok: false, reason: 'worker failed' });
      worker.postMessage({ type: 'inputs', engineUrl: url, source: String(source) });
    });
  }

  window.PineTSRunner = { run, runnable, loadPineTS, toSeries, marketContext, newEngine, normalizeBars, scanInputs };
  console.log('[pinets-runner] ready — PineTS loads on first run (independent of Vela’s Pine engine)');
})();
