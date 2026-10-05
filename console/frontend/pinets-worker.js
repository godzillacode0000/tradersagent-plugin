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
      const time = p.time != null ? p.time : (p.openTime != null ? p.openTime : null);
      /* Drawing containers (__boxes__, __lines__, __labels__, …) put the geometry in `value` as an
       * ARRAY of objects — box coords, colours, text. The old projection kept only numbers, so every
       * drawing row became `value: null` and the overlay had nothing to paint: the script ran, the
       * panel said "the engine stored NO rows", and the chart stayed empty. Carry the payload. */
      if (Array.isArray(p.value)) {
        return { value: p.value.map((v) => jsonSafe(v)), options: { style: (p.options && p.options.style) || null }, time: time };
      }
      const v = typeof p.value === 'number' && isFinite(p.value) ? p.value : null;
      const color = (p.options && p.options.color) || null;
      return { value: v, options: { color: color }, time: time };
    });
  }
  return out;
}

/** Structured clone accepts plain data; drop functions/cycles and bound the depth. */
function jsonSafe(value, depth) {
  const d = depth || 0;
  if (d > 6 || value == null) return value == null ? null : null;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 4096).map((v) => jsonSafe(v, d + 1));
  if (typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'function') continue;
      o[k] = jsonSafe(v, d + 1);
    }
    return o;
  }
  return null;
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

/* ── real multi-timeframe: a data source that can answer for ANY timeframe ─────────────────────────
   PineTS builds a second engine for `request.security` on the same data source it was given. A plain bar
   array has one timeframe, so every request came back as the chart's own bars (the daily close equalled
   the chart's close). A source object with getMarketData(symbol, timeframe, limit, from, to) is asked per
   request: the chart's own market is answered from the bars already in hand, anything else is fetched
   from the console's /api/bars (same origin, so no CORS). */
const MS = { m: 60000, h: 3600000, d: 86400000, w: 604800000 };

/** Pine / Vela / venue spellings -> { interval for /api/bars, milliseconds }. */
function venueInterval(tf) {
  const s = String(tf == null ? '' : tf).trim();
  let n, u;
  if (/^\d+$/.test(s)) { const m = Number(s); if (m % 1440 === 0) { n = m / 1440; u = 'd'; } else if (m % 60 === 0) { n = m / 60; u = 'h'; } else { n = m; u = 'm'; } }
  else {
    const m = s.match(/^(\d*)([mhdwMHDW])$/);
    if (!m) return { interval: s.toLowerCase(), ms: MS.h };
    n = Number(m[1] || 1);
    u = m[2] === 'M' ? 'M' : m[2].toLowerCase();
  }
  if (u === 'M') return { interval: n + 'M', ms: 30 * MS.d * n };
  return { interval: n + u, ms: MS[u] * n };
}

function makeSource(bars, msg, report) {
  const own = venueInterval(msg.timeframe).interval;
  const ownSym = String(msg.symbol || '').toUpperCase();
  const memo = new Map();
  return {
    async getMarketData(tickerId, timeframe, limit, from, to) {
      const sym = String(tickerId || ownSym).split(':').pop().toUpperCase();
      const iv = venueInterval(timeframe);
      if (iv.interval === own && sym === ownSym) return bars;      // the chart's own market, already in hand
      const end = to != null ? Number(to) : Date.now();
      const start = from != null ? Number(from) : end - 500 * iv.ms;
      const span = end - start;
      const want = Math.max(30, Math.min(5000, Math.ceil(span / iv.ms) + 3));
      const key = sym + '|' + iv.interval + '|' + want;
      if (!memo.has(key)) {
        memo.set(key, (async () => {
          const res = await fetch(self.location.origin + '/api/bars?symbol=' + encodeURIComponent(sym)
            + '&interval=' + encodeURIComponent(iv.interval) + '&limit=' + want);
          const body = await res.json();
          const rows = body && body.ok && body.data && Array.isArray(body.data.bars) ? body.data.bars : [];
          if (!rows.length) throw new Error((body && body.data && body.data.error) || 'no bars');
          return rows.map((r) => ({ openTime: r.time, closeTime: r.time + iv.ms - 1, open: r.open, high: r.high,
                                    low: r.low, close: r.close, volume: r.volume }));
        })());
      }
      try {
        const candles = await memo.get(key);
        if (!report.fetched.some((f) => f.key === key)) report.fetched.push({ key, symbol: sym, interval: iv.interval, bars: candles.length });
        return candles;
      } catch (err) {
        /* No higher-timeframe data: fall back to the chart's own bars (the old behaviour) and SAY so. */
        if (!report.failed.some((f) => f.key === key)) report.failed.push({ key, symbol: sym, interval: iv.interval, reason: String((err && err.message) || err) });
        return bars;
      }
    },
    getSymbolInfo: (t) => bars.getSymbolInfo(t),
  };
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const started = Date.now();
  /* `{ type: 'inputs' }` is not a run: it reads the script's input.*() declarations (the Settings panel's
     source of truth) and answers. The engine's Indicator scans the source without executing it. */
  if (msg.type === 'inputs') {
    try {
      const mod = await engine(msg.engineUrl);
      const meta = new mod.Indicator(String(msg.source || '')).getInputsMeta() || [];
      self.postMessage({ ok: true, inputs: JSON.parse(JSON.stringify(meta)) });
    } catch (err) {
      self.postMessage({ ok: false, reason: String((err && err.message) || err) });
    }
    return;
  }
  try {
    const mod = await engine(msg.engineUrl);
    const bars = attachSymbolInfo(msg.bars, msg.symbol, msg.mintick);
    const mtf = { fetched: [], failed: [] };
    const engineInstance = new mod.PineTS(makeSource(bars, msg, mtf), msg.symbol, msg.timeframe, Math.max(30, bars.length));
    /* Changed inputs ride in on an Indicator ({ in_N: value }); a script nobody touched is run from its
       source exactly as before, so this path only exists when the operator asked for it. */
    const changed = msg.inputs && typeof msg.inputs === 'object' && Object.keys(msg.inputs).length > 0;
    const out = await engineInstance.run(changed ? new mod.Indicator(msg.source, msg.inputs) : msg.source);
    const ms = Date.now() - started;
    const plots = projectPlots(out && out.plots);
    const strategy = projectStrategy(out && out.strategy);
    let payload;
    try {
      payload = { ok: true, ms: ms, plots: plots, strategy: strategy, mtf: mtf,
                  drawings: Object.keys(plots).filter((k) => k.startsWith('__')) };
    } catch (err) {
      payload = { ok: true, ms: ms, plots: {}, strategy: strategy, drawings: [] };
    }
    self.postMessage(payload);
  } catch (err) {
    /* `method` names the Pine function a PineRuntimeError came from ("array.get"): the pane uses it to
       point at the line when the message itself carries no position. */
    self.postMessage({ ok: false, ms: Date.now() - started,
                       reason: String((err && err.message) || err), phase: 'run',
                       method: err && err.method ? String(err.method) : undefined });
  }
};
