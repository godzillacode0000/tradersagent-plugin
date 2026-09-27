/**
 * Paint a PineTS result on the workspace chart.
 *
 * What works in this build, and what does not — all measured, not assumed:
 *
 *   renderer layers   `registerRendererLayer` on `window.Vela` registers into the GLOBAL
 *                     build's registry, while the workspace chart comes from the package's
 *                     ES-module build — a second copy. The layer registers fine and is
 *                     never mounted (nothing paints).
 *   drawings          `chart.drawings.add('polyline'/'trendline', …)` creates a real
 *                     core-owned drawing (it shows up in `drawings.all()`), but the
 *                     renderer never paints it — verified on both a bare chart and the
 *                     workspace cell, with the toolbar shown and after pan/resize.
 *   native indicators `chart.addNativeIndicator(type, options)` DOES paint: adding `ema`
 *                     took `chart.inspect().totals.series` from 0 to 1 and
 *                     `presentNativeIndicators()` from ["volume"] to ["volume","ema"].
 *                     This build ships ~80 of them (ema, sma, rsi, macd, supertrend,
 *                     bollinger-bands, donchian-channels, atr, adx, zigzag, vwap…).
 *
 * So the honest wiring is: **PineTS computes and reports; Vela's own native indicator of
 * the same family draws it.** When a script has no native equivalent here, this module
 * says so instead of drawing something that merely looks plausible.
 *
 * Classic script.
 */
(function () {
  'use strict';

  /* Pine construct → Vela native type. Only used when the live catalog confirms the type. */
  const MAP = [
    [/\bta\.supertrend\s*\(|supertrend/i, 'supertrend', 'SuperTrend'],
    [/\bta\.bb\s*\(|bollinger/i, 'bollinger-bands', 'Bollinger Bands'],
    [/\bta\.kc\b|keltner/i, 'keltner-channels', 'Keltner Channels'],
    [/\bta\.dc\b|donchian/i, 'donchian-channels', 'Donchian Channels'],
    [/\bta\.linreg\s*\(/, 'linear-regression', 'Linear Regression Curve'],
    [/\bta\.ema\s*\(/, 'ema', 'Exponential Moving Average'],
    [/\bta\.sma\s*\(/, 'sma', 'Simple Moving Average'],
    [/\bta\.rma\s*\(/, 'rma', 'Smoothed Moving Average'],
    [/\bta\.zlema\s*\(/, 'zlema', 'Zero-Lag EMA'],
    [/\bta\.rsi\s*\(/, 'rsi', 'Relative Strength Index'],
    [/\bta\.stoch\s*\(/, 'stochastic', 'Stochastic'],
    [/\bta\.macd\s*\(/, 'macd', 'MACD'],
    [/\bta\.atr\s*\(/, 'average-true-range', 'Average True Range'],
    [/\bta\.adx\s*\(|\bta\.dmi\s*\(/, 'average-directional-index', 'Average Directional Index'],
    [/\bta\.stdev\s*\(/, 'standard-deviation', 'Standard Deviation'],
    [/\bta\.wpr\s*\(|williams\s*%r/i, 'williams-percent-r', 'Williams %R'],
    [/\bta\.cci\s*\(/, 'commodity-channel-index', 'Commodity Channel Index'],
    [/\bta\.vwap\b|\bvwap\b/, 'vwap', 'Volume Weighted Average Price'],
    [/\bta\.sar\b|parabolic\s*sar/i, 'parabolic-sar', 'Parabolic SAR'],
    [/\bpivot\s*points?\b/i, 'pivot-points', 'Pivot Points'],
    [/\bta\.mfi\s*\(/, 'money-flow-index', 'Money Flow Index'],
    [/\bta\.obv\b/, 'on-balance-volume', 'On Balance Volume'],
    [/\bta\.cmo\s*\(/, 'chande-momentum-oscillator', 'Chande Momentum Oscillator'],
    [/\bta\.trix\s*\(/, 'trix', 'TRIX'],
    [/\bta\.ao\b|awesome\s*oscillator/i, 'awesome-oscillator', 'Awesome Oscillator'],
    [/\bta\.crossover|\bta\.crossunder/, 'ema', 'Exponential Moving Average']  // cross systems draw on MAs
  ];

  /* The script's OWN name, per native — the signal that does not lie. `ta.atr(` appears in scripts
     that merely *use* ATR (a reversal threshold, a stop distance), and matching the source alone put
     an Average True Range pane on a Wyckoff dashboard (27 Sep: five stacked ATR panes on one chart).
     A script called "…ATR…" is an ATR; a script called "Wyckoff Wave & Volume Studies" is not. */
  const NAMES = {
    supertrend: /supertrend/i,
    'bollinger-bands': /bollinger/i,
    'keltner-channels': /keltner/i,
    'donchian-channels': /donchian/i,
    'linear-regression': /linear\s*regression/i,
    ema: /\bema\b|exponential\s+moving\s+average/i,
    sma: /\bsma\b|simple\s+moving\s+average/i,
    rma: /\brma\b|smoothed\s+moving\s+average/i,
    zlema: /\bzlema\b|zero[-\s]?lag/i,
    rsi: /\brsi\b|relative\s+strength/i,
    stochastic: /stochastic|\bstoch\b/i,
    macd: /\bmacd\b/i,
    'average-true-range': /\batr\b|average\s+true\s+range/i,
    'average-directional-index': /\badx\b|\bdmi\b|directional\s+(?:movement|index)/i,
    'standard-deviation': /\bstdev\b|standard\s+deviation/i,
    'williams-percent-r': /williams\s*%?\s*r/i,
    'commodity-channel-index': /\bcci\b|commodity\s+channel/i,
    vwap: /\bvwap\b/i,
    'parabolic-sar': /parabolic\s*sar/i,
    'pivot-points': /pivot\s*points?/i,
    'money-flow-index': /\bmfi\b|money\s+flow/i,
    'on-balance-volume': /\bobv\b|on[-\s]?balance/i,
    'chande-momentum-oscillator': /\bcmo\b|chande/i,
    trix: /\btrix\b/i,
    'awesome-oscillator': /\bao\b|awesome\s+oscillator/i
  };

  /** What the script calls itself: `indicator("…", shorttitle="…")` → "title · shorttitle". */
  function scriptTitle(source) {
    const text = String(source || '');
    const title = text.match(/indicator\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/i);
    const short = text.match(/shorttitle\s*=\s*["']([^"']+)["']/i);
    return [title && title[1], short && short[1]].filter(Boolean).join(' · ');
  }

  let catalogPromise = null;

  function chartHandle() { return window.__consoleChart || null; }

  /** The live catalog of natives this chart offers (cached; it is stable per build). */
  async function catalog() {
    if (!catalogPromise) {
      const c = chartHandle();
      catalogPromise = (c && typeof c.availableNativeIndicators === 'function')
        ? c.availableNativeIndicators().then((list) => (list || []).map((n) => ({ type: n.type, title: n.title || n.name || n.type })))
            .catch(() => [])
        : Promise.resolve([]);
    }
    return catalogPromise;
  }

  /** Optional length argument of the matched construct (ema/rsi/sma length…). */
  function lengthFor(source, type) {
    const base = type.split('-')[0];
    const m = source.match(new RegExp(`ta\\.(?:${base}|sma|ema|rma|rsi|atr|stdev|cmo|trix|cci)\\s*\\(\\s*[^,)]*,\\s*(\\d+)`, 'i'));
    return m ? Number(m[1]) : null;
  }

  /** Which Vela native (if any) expresses what this script computes. */
  async function nativeFor(source, opts) {
    if (!source) return null;
    const O = opts || {};
    const types = await catalog();
    const known = new Set(types.map((t) => t.type));
    const labelOf = (type) => (types.find((t) => t.type === type) || {}).title || type;
    /* 1. The script's own name. It beats a source scan, and it is the only signal that survives a
          script which merely USES one of these — an ATR-based threshold, an EMA-smoothed signal. */
    const name = scriptTitle(source);
    if (name) {
      for (const [type, re] of Object.entries(NAMES)) {
        if (!known.has(type) || !re.test(name)) continue;
        return { type, title: labelOf(type), length: lengthFor(source, type),
                 why: 'the script names it: "' + name + '"' };
      }
    }
    /* 2. A dashboard is not a native. A script that builds tables/boxes/lines, or plots a family of
          its own series, is not expressed by one Vela indicator — say so instead of picking one. */
    if (O.containers) return null;
    if (typeof O.series === 'number' && O.series > 2) return null;
    for (const [re, type, label] of MAP) {
      if (!re.test(source)) continue;
      if (!known.has(type)) continue;
      return { type, title: labelOf(type) || label, length: lengthFor(source, type),
               why: 'the script computes it (source scan)' };
    }
    return null;
  }

  /** Handles we added, so a second run replaces instead of stacking. */
  let added = [];

  function clear() {
    let removed = 0;
    added.forEach((h) => { try { h.remove(); removed += 1; } catch { /* already gone */ } });
    added = [];
    return removed;
  }

  /**
   * Paint the native equivalent of `source` on the chart.
   * Returns a result that is safe to show verbatim in the UI.
   */
  async function paintNative(source, opts) {
    const c = chartHandle();
    if (!c || typeof c.addNativeIndicator !== 'function') {
      return { added: null, reason: 'this chart exposes no addNativeIndicator' };
    }
    const match = await nativeFor(source, opts);
    if (!match) {
      const why = (opts && opts.containers)
        ? 'this script paints its own dashboard (tables / boxes / lines) — one Vela native would '
          + 'misrepresent it, so nothing was added; PineTS still ran it and reported the values'
        : 'no Vela native in this build expresses what this script computes — PineTS still ran it and reported the values';
      return { added: null, reason: why };
    }
    /* One pane per indicator. A native of this type already on the chart is left alone: re-running a
       script — or running it again after a reload, when the old handle is gone — used to stack a
       second pane (five Average True Range panes ended up on one chart, 27 Sep). */
    const already = (() => { try { return c.presentNativeIndicators(); } catch { return null; } })();
    if (Array.isArray(already) && already.includes(match.type)) {
      return { added: null, present: already,
               reason: 'this chart already carries ' + match.title + ' (' + match.type + ') — not stacking a second pane' };
    }
    try {
      clear();
      const handle = c.addNativeIndicator(match.type, match.length ? { length: match.length } : undefined);
      if (!handle) return { added: null, reason: `Vela created no ${match.type} indicator` };
      added.push(handle);
      let totals = null;
      try { totals = c.inspect().totals; } catch { /* snapshot is a nicety */ }
      return {
        added: { id: handle.id, title: handle.title, type: match.type, length: match.length },
        why: match.why,
        present: (() => { try { return c.presentNativeIndicators(); } catch { return null; } })(),
        series: totals ? totals.series : null
      };
    } catch (err) {
      return { added: null, reason: `Vela refused the ${match.type} indicator: ${(err && err.message) || err}` };
    }
  }

  window.PineTSPaint = { paintNative, nativeFor, clear, catalog, get added() { return added.slice(); } };
  console.log('[pinets-paint] ready — paints through Vela native indicators (verified via inspect()/presentNativeIndicators)');
})();
