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
  async function nativeFor(source) {
    if (!source) return null;
    const types = await catalog();
    const known = new Set(types.map((t) => t.type));
    for (const [re, type, label] of MAP) {
      if (!re.test(source)) continue;
      if (!known.has(type)) continue;
      const title = (types.find((t) => t.type === type) || {}).title || label;
      return { type, title, length: lengthFor(source, type) };
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
  async function paintNative(source) {
    const c = chartHandle();
    if (!c || typeof c.addNativeIndicator !== 'function') {
      return { added: null, reason: 'this chart exposes no addNativeIndicator' };
    }
    const match = await nativeFor(source);
    if (!match) {
      return {
        added: null,
        reason: 'no Vela native in this build expresses what this script computes — PineTS still ran it and reported the values'
      };
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
