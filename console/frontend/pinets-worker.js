/* pinets-worker.js — run PineTS OFF the page's thread.
 *
 * Why this file exists (28 Sep, measured): a heavy indicator holds the console's only JS thread for
 * the whole run, and a 20-second run ticked a 250 ms interval ZERO times. A `Promise.race` deadline
 * therefore cannot fire — no timer runs while the thread is held, no queued bridge command is
 * answered, and the pane reads as dead while it is working. The catalogue's slowest script measured
 * 301 s. The only thing that can interrupt a run like that is `worker.terminate()`.
 *
 * The worker computes and posts back a JSON-safe projection; the main thread paints from it, exactly
 * as it did from a live context.
 */
let modPromise = null;

async function engine(engineUrl) {
  if (!modPromise) modPromise = import(engineUrl);
  return modPromise;
}

/** Bars arrive as plain objects; the engine needs the symbol-info hook to fill `syminfo` (fix #3). */
function attachSymbolInfo(bars, symbol, mintick) {
  const sym = String(symbol || 'BTCUSDT').toUpperCase();
  const m = /^(.*?)(USDT|USDC|BUSD|FDUSD|TUSD|USD|BTC|ETH|BNB)$/.exec(sym);
  const base = (m && m[1]) || sym;
  const quote = (m && m[2]) || 'USDT';
  const tick = Number(mintick) > 0 ? Number(mintick) : 1e-8;
  try {
    bars.getSymbolInfo = () => Promise.resolve({
      ticker: sym,
      tickerid: 'BINANCE:' + sym,
      prefix: 'BINANCE',
      root: base,
      description: base + ' / ' + quote,
      type: 'crypto',
      main_tickerid: 'BINANCE:' + sym,
      current_contract: '',
      isin: '',
      basecurrency: base,
      currency: quote,
      timezone: 'UTC',
      country: '',
      mintick: tick,
      pricescale: Math.round(1 / tick),
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
    });
  } catch (err) {
    /* a frozen array still runs; it just has no syminfo */
  }
  return bars;
}

/** Copy only what survives structured clone: numbers, colours, times. */
function projectPlots(plots) {
  const out = {};
  for (const [key, value] of Object.entries(plots || {})) {
    const arr = Array.isArray(value) ? value : (value && Array.isArray(value.data) ? value.data : null);
    if (!arr) continue;
    out[key] = arr.map((p) => {
      if (typeof p === 'number') return isFinite(p) ? p : null;
      if (!p || typeof p !== 'object') return null;
      const v = typeof p.value === 'number' && isFinite(p.value) ? p.value : null;
      const color = (p.options && p.options.color) || null;
      const time = p.time != null ? p.time : (p.openTime != null ? p.openTime : null);
      return { value: v, options: { color: color }, time: time };
    });
  }
  return out;
}

function projectStrategy(s) {
  if (!s || typeof s !== 'object') return null;
  const trades = Array.isArray(s.closedtrades) ? s.closedtrades.map((t) => {
    if (!t || typeof t !== 'object') return { value: t };
    const o = {};
    for (const [k, v] of Object.entries(t)) {
      if (v == null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') o[k] = v;
    }
    return o;
  }) : [];
  return {
    netprofit: s.netprofit,
    wintrades: s.wintrades,
    losstrades: s.losstrades,
    max_drawdown: s.max_drawdown,
    sharpe_ratio: s.sharpe_ratio,
    cagr: s.cagr,
    closedtrades: trades,
    opentrades: Array.isArray(s.opentrades) ? s.opentrades.length : null,
  };
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const started = Date.now();
  try {
    const mod = await engine(msg.engineUrl);
    const bars = attachSymbolInfo(msg.bars, msg.symbol, msg.mintick);
    const engineInstance = new mod.PineTS(bars, msg.symbol, msg.timeframe, Math.max(30, bars.length));
    const out = await engineInstance.run(msg.source);
    const ms = Date.now() - started;
    const plots = projectPlots(out && out.plots);
    const strategy = projectStrategy(out && out.strategy);
    let payload;
    try {
      payload = { ok: true, ms: ms, plots: plots, strategy: strategy,
                  drawings: Object.keys(plots).filter((k) => k.startsWith('__')) };
    } catch (err) {
      payload = { ok: true, ms: ms, plots: {}, strategy: strategy, drawings: [] };
    }
    self.postMessage(payload);
  } catch (err) {
    self.postMessage({ ok: false, ms: Date.now() - started,
                       reason: String((err && err.message) || err), phase: 'run' });
  }
};
