import { ledgerCryptoIconUrl, baseOf } from '../chunk-W4EJWLEO.js';

// src/data/providers/coinbase/RequestGate.ts
var REAL_CLOCK = {
  now: () => Date.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};
var RequestGate = class {
  constructor(maxConcurrent, minIntervalMs, clock = REAL_CLOCK) {
    this.maxConcurrent = maxConcurrent;
    this.minIntervalMs = minIntervalMs;
    this.clock = clock;
    this.active = 0;
    this.waiters = [];
    /** Earliest time the next request may START (min-spacing reservation). */
    this.nextStartAt = 0;
    /** Backoff deadline set by a 429 — new starts wait until then. */
    this.pausedUntil = 0;
  }
  /** Acquire a slot, wait for the spacing/pause turn, run `fn`, release. */
  async run(fn) {
    await this.acquire();
    try {
      await this.waitForTurn();
      return await fn();
    } finally {
      this.release();
    }
  }
  /** Pause new starts for `ms` (a 429 Retry-After / exponential backoff). */
  pauseFor(ms) {
    if (ms > 0) this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + ms);
  }
  /** Block until the spacing window opens and any pause has elapsed, then reserve the next slot. */
  async waitForTurn() {
    for (; ; ) {
      const now = this.clock.now();
      const wait = Math.max(this.pausedUntil - now, this.nextStartAt - now);
      if (wait <= 0) break;
      await this.clock.delay(wait);
    }
    this.nextStartAt = Math.max(this.clock.now(), this.nextStartAt) + this.minIntervalMs;
  }
  acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }
  release() {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
};

// src/data/providers/coinbase/CoinbaseProvider.ts
var REST_BASE = "https://api.exchange.coinbase.com";
var WS_URL = "wss://ws-feed.exchange.coinbase.com";
var REQ_HEADERS = { Accept: "application/json" };
var STREAM_STALL_MS = 15e3;
var STREAM_RECONNECT_MS = 2e3;
var LIVE_RESEED_MS = 5e3;
var MAX_CANDLES_PER_REQ = 300;
var REST_CONCURRENCY = 4;
var REST_MIN_INTERVAL_MS = 120;
var REQUEST_MAX_RETRIES = 4;
var BACKOFF_BASE_MS = 600;
var BACKOFF_JITTER_MS = 400;
function retryAfterMs(res, fallbackMs) {
  const sec = Number(res.headers.get("retry-after"));
  return Number.isFinite(sec) && sec > 0 ? sec * 1e3 : fallbackMs;
}
var TF_TO_GRAN = {
  "1": 60,
  "5": 300,
  "15": 900,
  "60": 3600,
  "360": 21600,
  D: 86400
};
var TF_NORMALIZE = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "45m": "45",
  "1h": "60",
  "2h": "120",
  "3h": "180",
  "4h": "240",
  "6h": "360",
  "8h": "480",
  "12h": "720",
  "1d": "D",
  "1w": "W",
  "1mo": "M",
  "1D": "D",
  "1W": "W",
  "4H": "240",
  D: "D",
  W: "W",
  M: "M"
};
var NATIVE_MINUTES = [1, 5, 15, 60, 360, 1440];
var MIN_TO_GRAN = { 1: 60, 5: 300, 15: 900, 60: 3600, 360: 21600, 1440: 86400 };
var SUPPORTED_TIMEFRAMES = ["1", "3", "5", "15", "30", "45", "60", "120", "180", "240", "360", "480", "720", "D", "W", "M"];
var MS_PER_DAY = 864e5;
function normalizeTf(tf) {
  return TF_NORMALIZE[tf] ?? TF_NORMALIZE[tf.toLowerCase()] ?? tf;
}
function parseProductId(ticker) {
  return ticker.trim().toUpperCase();
}
function candleRowToOHLCV(r) {
  return { time: Number(r[0]) * 1e3, open: Number(r[3]), high: Number(r[2]), low: Number(r[1]), close: Number(r[4]), volume: Number(r[5]) };
}
function dedupeSorted(bars) {
  const byTime = /* @__PURE__ */ new Map();
  for (const b of bars) byTime.set(b.time, b);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
function aggregate(sub, bucketMs) {
  return aggregateBy(sub, (t) => Math.floor(t / bucketMs) * bucketMs);
}
function aggregateCalendar(sub, unit) {
  return aggregateBy(sub, unit === "W" ? weekStartUTC : monthStartUTC);
}
function aggregateBy(sub, keyMs) {
  const buckets = /* @__PURE__ */ new Map();
  for (const b of sub) {
    const key = keyMs(b.time);
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, { time: key, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 });
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume = (cur.volume ?? 0) + (b.volume ?? 0);
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
function weekStartUTC(ms) {
  const d = new Date(ms);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday);
}
function monthStartUTC(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
function selectSubTf(targetMin) {
  return NATIVE_MINUTES.filter((m) => m < targetMin && targetMin % m === 0).sort((a, b) => b - a)[0] ?? null;
}
function clampLimit(bars, limit) {
  return limit != null && bars.length > limit ? bars.slice(-limit) : bars;
}
var CoinbaseProvider = class {
  constructor() {
    /** Cached symbol enumeration (the products list is large; fetch once). */
    this.symbolsPromise = null;
    /** Shared request gate: caps concurrency, spaces request starts, honors 429 backoff. */
    this.gate = new RequestGate(REST_CONCURRENCY, REST_MIN_INTERVAL_MS);
  }
  info() {
    return {
      name: "coinbase",
      displayName: "Coinbase",
      requiresApiKey: false,
      supportedTimeframes: SUPPORTED_TIMEFRAMES,
      capabilities: { enumerate: true, stream: true, symbolInfo: true }
    };
  }
  async getBars(ticker, timeframe, range) {
    try {
      const product = parseProductId(ticker);
      const tf = normalizeTf(timeframe);
      const gran = TF_TO_GRAN[tf];
      if (gran) return dedupeSorted(await this.fetchCandles(product, gran, range));
      if (tf === "W" || tf === "M") {
        const span = tf === "W" ? 7 * MS_PER_DAY : 31 * MS_PER_DAY;
        const subRange2 = range.from != null ? range : { ...range, limit: range.limit != null ? Math.ceil(range.limit * span / MS_PER_DAY) + 31 : void 0 };
        const sub2 = await this.fetchCandles(product, 86400, subRange2);
        return clampLimit(aggregateCalendar(sub2, tf), range.limit);
      }
      const targetMin = /^\d+$/.test(tf) ? parseInt(tf, 10) : null;
      const subMin = targetMin != null ? selectSubTf(targetMin) : null;
      if (targetMin == null || subMin == null) {
        console.warn(`[vela] Coinbase: timeframe "${timeframe}" is not supported and cannot be aggregated.`);
        return [];
      }
      const ratio = targetMin / subMin;
      const subRange = { ...range, limit: range.limit != null ? range.limit * ratio + ratio : void 0 };
      const sub = await this.fetchCandles(product, MIN_TO_GRAN[subMin], subRange);
      return clampLimit(aggregate(sub, targetMin * 6e4), range.limit);
    } catch (e) {
      console.warn(`[vela] Coinbase: failed to fetch ${ticker} ${timeframe} \u2014 ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }
  async getSymbolInfo(ticker) {
    const product = parseProductId(ticker);
    const p = await this.json(`${REST_BASE}/products/${product}`).catch(() => null);
    if (!p || !p.id) return void 0;
    const tickSize = p.quote_increment != null ? parseFloat(p.quote_increment) : 0.01;
    const mintick = tickSize > 0 ? tickSize : 0.01;
    return {
      ticker,
      // keep the original ticker (as Pine Script expects)
      tickerid: `COINBASE:${ticker}`,
      prefix: "COINBASE",
      description: `${p.base_currency} / ${p.quote_currency}`,
      type: "crypto",
      basecurrency: p.base_currency,
      currency: p.quote_currency,
      mintick,
      pricescale: Math.round(1 / mintick),
      timezone: "Etc/UTC",
      session: "24x7"
    };
  }
  listSymbols() {
    if (!this.symbolsPromise) {
      this.symbolsPromise = this.fetchProducts().then((products) => products.filter((p) => p.status === "online" && !p.trading_disabled).map((p) => ({ ticker: p.id, description: `${p.base_currency} / ${p.quote_currency}`, type: "crypto" }))).catch(() => []);
    }
    return this.symbolsPromise;
  }
  /** Predefined icon source for a crypto venue: the Ledger crypto-icon CDN, keyed by
   *  the BASE asset (the description's first segment, else the de-suffixed ticker). */
  resolveSymbolIcon(symbol) {
    return ledgerCryptoIconUrl(baseOf(symbol));
  }
  subscribe(ticker, timeframe, onBar) {
    const gran = TF_TO_GRAN[normalizeTf(timeframe)];
    if (gran && typeof WebSocket !== "undefined") return this.streamTicker(ticker, timeframe, gran, onBar);
    return this.pollBars(ticker, timeframe, onBar);
  }
  // ── internals ────────────────────────────────────────────────────────
  async fetchProducts() {
    const data = await this.json(`${REST_BASE}/products`);
    return Array.isArray(data) ? data : [];
  }
  /**
   * Fetch candles for a count (most-recent `limit`) or a `[from, to]` range, paginating past the
   * 300-bucket cap. Returns ascending OHLCV (newest-first rows from the API are sorted on the way out).
   */
  async fetchCandles(product, granSec, range) {
    if (range.from != null) return this.paginateForward(product, granSec, range.from, range.to ?? Date.now(), range.limit);
    return this.paginateBackward(product, granSec, range.limit ?? 500, range.to ?? Date.now());
  }
  /** Assemble the most-recent `limit` bars, walking backward in ≤300-bucket windows. */
  async paginateBackward(product, granSec, limit, endMs) {
    const granMs = granSec * 1e3;
    let out = [];
    let remaining = limit;
    let cursorEnd = endMs;
    let guard = Math.ceil(limit / MAX_CANDLES_PER_REQ) + 4;
    while (remaining > 0 && guard-- > 0) {
      const size = Math.min(remaining, MAX_CANDLES_PER_REQ);
      const startMs = cursorEnd - size * granMs;
      const rows = await this.candlesChunk(product, granSec, startMs, cursorEnd);
      if (rows.length === 0) break;
      out = rows.concat(out);
      remaining -= rows.length;
      cursorEnd = rows[0].time - 1;
      if (rows.length < size) break;
    }
    return clampLimit(dedupeSorted(out), limit);
  }
  /** Walk `[from, to]` forward in ≤300-bucket windows (ranged/tail fetches). */
  async paginateForward(product, granSec, fromMs, toMs, limit) {
    const granMs = granSec * 1e3;
    const out = [];
    let cursor = fromMs;
    let guard = Math.ceil((toMs - fromMs) / (MAX_CANDLES_PER_REQ * granMs)) + 4;
    while (cursor < toMs && guard-- > 0) {
      const windowEnd = Math.min(cursor + MAX_CANDLES_PER_REQ * granMs, toMs);
      const rows = await this.candlesChunk(product, granSec, cursor, windowEnd);
      if (rows.length > 0) out.push(...rows);
      cursor = windowEnd;
      if (limit != null && out.length >= limit) break;
    }
    const sorted = dedupeSorted(out);
    return limit != null ? sorted.slice(0, limit) : sorted;
  }
  /** One candles request over `[startMs, endMs]` → ascending OHLCV (the API returns newest-first). */
  async candlesChunk(product, granSec, startMs, endMs) {
    const url = new URL(`${REST_BASE}/products/${product}/candles`);
    url.searchParams.set("granularity", String(granSec));
    url.searchParams.set("start", String(Math.floor(startMs / 1e3)));
    url.searchParams.set("end", String(Math.floor(endMs / 1e3)));
    const data = await this.json(url.toString());
    if (!Array.isArray(data) || data.length > 0 && !Array.isArray(data[0])) return [];
    return data.map(candleRowToOHLCV).sort((a, b) => a.time - b.time);
  }
  /**
   * Build a forming candle from the Coinbase `ticker` channel (Coinbase has no native kline stream):
   * the stream supplies a smooth live price/high/low, while a periodic REST re-seed fixes the
   * authoritative open + volume and corrects any drift. A stall watchdog falls back to polling if the
   * socket opens but never delivers a price; reconnects on an unexpected close until unsubscribed.
   */
  streamTicker(ticker, timeframe, granSec, onBar) {
    const product = parseProductId(ticker);
    const granMs = granSec * 1e3;
    const align = (ms) => Math.floor(ms / granMs) * granMs;
    let closed = false;
    let ws = null;
    let reconnect = null;
    let stall = null;
    let reseedTimer = null;
    let polling = null;
    let current = null;
    const clearStall = () => {
      if (stall) {
        clearTimeout(stall);
        stall = null;
      }
    };
    const clearReseed = () => {
      if (reseedTimer) {
        clearInterval(reseedTimer);
        reseedTimer = null;
      }
    };
    const emit = () => {
      if (current) onBar({ ...current });
    };
    const reseed = async (emitClosed) => {
      try {
        const bars = await this.getBars(ticker, timeframe, { limit: 2 });
        if (closed || bars.length === 0) return;
        if (emitClosed && bars.length >= 2) ;
        const last = bars[bars.length - 1];
        current = current && current.time === last.time ? { ...last, high: Math.max(last.high, current.high), low: Math.min(last.low, current.low), close: current.close } : { ...last };
        emit();
      } catch {
      }
    };
    const onTick = (priceStr, tMs) => {
      const price = Number(priceStr);
      if (!Number.isFinite(price)) return;
      const barStart = align(tMs);
      if (!current || barStart > current.time) {
        current = { time: barStart, open: price, high: price, low: price, close: price, volume: 0 };
        emit();
        void reseed(false);
      } else if (barStart === current.time) {
        current = { ...current, close: price, high: Math.max(current.high, price), low: Math.min(current.low, price) };
        emit();
      }
    };
    const fallToPolling = () => {
      if (closed || polling) return;
      clearStall();
      clearReseed();
      if (reconnect) {
        clearTimeout(reconnect);
        reconnect = null;
      }
      try {
        ws?.close();
      } catch {
      }
      ws = null;
      console.warn(`[vela] Coinbase: ${ticker} ${timeframe} stream delivered no data; falling back to polling.`);
      polling = this.pollBars(ticker, timeframe, onBar);
    };
    const open = () => {
      if (closed || polling) return;
      ws = new WebSocket(WS_URL);
      stall = setTimeout(fallToPolling, STREAM_STALL_MS);
      ws.onopen = () => {
        try {
          ws?.send(JSON.stringify({ type: "subscribe", product_ids: [product], channels: ["ticker"] }));
        } catch {
        }
        void reseed(false);
        reseedTimer = setInterval(() => void reseed(false), LIVE_RESEED_MS);
      };
      ws.onmessage = (ev) => {
        if (closed || polling) return;
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "ticker" && msg.product_id === product && msg.price != null) {
            clearStall();
            onTick(msg.price, msg.time ? Date.parse(msg.time) : Date.now());
          }
        } catch {
        }
      };
      ws.onclose = () => {
        clearReseed();
        if (!closed && !polling) reconnect = setTimeout(open, STREAM_RECONNECT_MS);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
        }
      };
    };
    open();
    return () => {
      closed = true;
      clearStall();
      clearReseed();
      if (reconnect) clearTimeout(reconnect);
      polling?.();
      try {
        ws?.close();
      } catch {
      }
    };
  }
  /** Poll the forming candle (aggregated/W/M timeframes, or environments without WebSocket). */
  pollBars(ticker, timeframe, onBar) {
    let stopped = false;
    let timer = null;
    const poll = async () => {
      if (stopped) return;
      try {
        const bars = await this.getBars(ticker, timeframe, { limit: 2 });
        for (const b of bars) onBar(b);
      } catch {
      }
      if (!stopped) timer = setTimeout(() => void poll(), 3e3);
    };
    timer = setTimeout(() => void poll(), 3e3);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
  /** GET → parsed JSON, through the rate gate with 429 backoff. */
  async json(url) {
    const res = await this.request(url);
    return res.json();
  }
  /**
   * Issue one GET through the shared {@link gate} (concurrency + spacing), retrying after a 429
   * (honoring `Retry-After`, else exponential backoff + jitter). Returns the `Response` so callers
   * can read pagination headers (`cb-after`) before consuming the body.
   */
  async request(url) {
    for (let attempt = 0; ; attempt += 1) {
      const res = await this.gate.run(() => fetch(url, { headers: REQ_HEADERS }));
      if (res.status === 429 && attempt < REQUEST_MAX_RETRIES) {
        const backoff = BACKOFF_BASE_MS * 2 ** attempt + Math.random() * BACKOFF_JITTER_MS;
        this.gate.pauseFor(Math.max(retryAfterMs(res, 0), backoff));
        continue;
      }
      if (!res.ok) throw new Error(`Coinbase HTTP ${res.status} for ${url}`);
      return res;
    }
  }
};

export { CoinbaseProvider };
