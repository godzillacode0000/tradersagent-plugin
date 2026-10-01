import { ledgerCryptoIconUrl, baseOf } from '../chunk-W4EJWLEO.js';

// src/data/providers/binance/BinanceProvider.ts
var SPOT_BASE = "https://api.binance.com/api/v3";
var SPOT_BASE_US = "https://api.binance.us/api/v3";
var FUTURES_BASE = "https://fapi.binance.com/fapi/v1";
var SPOT_WS = "wss://stream.binance.com:9443";
var SPOT_WS_US = "wss://stream.binance.us:9443";
var FUTURES_WS = "wss://fstream.binance.com";
var STREAM_STALL_MS = 15e3;
var STREAM_RECONNECT_MS = 2e3;
var TF_TO_INTERVAL = {
  "1": "1m",
  "3": "3m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "2h",
  "240": "4h",
  "360": "6h",
  "480": "8h",
  "720": "12h",
  D: "1d",
  W: "1w",
  M: "1M"
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
var NATIVE_MINUTES = [1, 3, 5, 15, 30, 60, 120, 240, 360, 480, 720];
var MIN_TO_INTERVAL = {
  1: "1m",
  3: "3m",
  5: "5m",
  15: "15m",
  30: "30m",
  60: "1h",
  120: "2h",
  240: "4h",
  360: "6h",
  480: "8h",
  720: "12h"
};
var SUPPORTED_TIMEFRAMES = ["1", "3", "5", "15", "30", "45", "60", "120", "180", "240", "D", "W", "M"];
function normalizeTf(tf) {
  return TF_NORMALIZE[tf] ?? TF_NORMALIZE[tf.toLowerCase()] ?? tf;
}
function parseTicker(ticker) {
  const t = ticker.trim().toUpperCase();
  if (t.endsWith(".P")) return { apiSymbol: t.slice(0, -2), isFutures: true };
  return { apiSymbol: t, isFutures: false };
}
function klinesToOHLCV(raw) {
  return raw.map((k) => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5])
  }));
}
function klineEventToOHLCV(k) {
  return { time: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) };
}
function dedupeSorted(bars) {
  const byTime = /* @__PURE__ */ new Map();
  for (const b of bars) byTime.set(b.time, b);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
function aggregate(sub, bucketMs) {
  const buckets = /* @__PURE__ */ new Map();
  for (const b of sub) {
    const key = Math.floor(b.time / bucketMs) * bucketMs;
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
function selectSubTf(targetMin) {
  return NATIVE_MINUTES.filter((m) => m < targetMin && targetMin % m === 0).sort((a, b) => b - a)[0] ?? null;
}
var BinanceProvider = class {
  constructor() {
    /** The spot endpoint confirmed reachable (cached after the first probe). */
    this.spotBaseUrl = null;
    /** The in-flight endpoint probe, shared so concurrent first calls don't each ping. */
    this.spotBaseProbe = null;
    /** Cached symbol enumeration (exchangeInfo is large; fetch once). */
    this.symbolsPromise = null;
  }
  info() {
    return {
      name: "binance",
      displayName: "Binance",
      requiresApiKey: false,
      supportedTimeframes: SUPPORTED_TIMEFRAMES,
      capabilities: { enumerate: true, stream: true, symbolInfo: true }
    };
  }
  async getBars(ticker, timeframe, range) {
    try {
      const { apiSymbol, isFutures } = parseTicker(ticker);
      const base = isFutures ? FUTURES_BASE : await this.spotBase();
      const tf = normalizeTf(timeframe);
      const nativeInterval = TF_TO_INTERVAL[tf];
      if (nativeInterval) {
        return dedupeSorted(klinesToOHLCV(await this.fetchKlines(base, apiSymbol, nativeInterval, range)));
      }
      const targetMin = /^\d+$/.test(tf) ? parseInt(tf, 10) : null;
      const subMin = targetMin != null ? selectSubTf(targetMin) : null;
      if (targetMin == null || subMin == null) {
        console.warn(`[vela] Binance: timeframe "${timeframe}" is not supported and cannot be aggregated.`);
        return [];
      }
      const ratio = targetMin / subMin;
      const subRange = { ...range, limit: range.limit != null ? range.limit * ratio + ratio : void 0 };
      const sub = klinesToOHLCV(await this.fetchKlines(base, apiSymbol, MIN_TO_INTERVAL[subMin], subRange));
      const agg = aggregate(sub, targetMin * 6e4);
      return range.limit != null && agg.length > range.limit ? agg.slice(-range.limit) : agg;
    } catch (e) {
      console.warn(`[vela] Binance: failed to fetch ${ticker} ${timeframe} \u2014 ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }
  async getSymbolInfo(ticker) {
    const { apiSymbol, isFutures } = parseTicker(ticker);
    const base = isFutures ? FUTURES_BASE : await this.spotBase();
    const url = isFutures ? `${base}/exchangeInfo` : `${base}/exchangeInfo?symbol=${apiSymbol}`;
    const data = await this.json(url).catch(() => null);
    const symbols = data?.symbols ?? [];
    const s = isFutures ? symbols.find((x) => x.symbol === apiSymbol) : symbols[0];
    if (!s) return void 0;
    const priceFilter = s.filters?.find((f) => f.filterType === "PRICE_FILTER");
    const tickSize = priceFilter ? parseFloat(priceFilter.tickSize ?? "0.01") : 0.01;
    return {
      ticker,
      // keep the original, incl. any .P (as Pine Script expects)
      tickerid: `BINANCE:${ticker}`,
      prefix: "BINANCE",
      description: `${s.baseAsset} / ${s.quoteAsset}${isFutures ? " Perpetual" : ""}`,
      type: isFutures ? "futures" : "crypto",
      basecurrency: s.baseAsset,
      currency: s.quoteAsset,
      mintick: tickSize,
      pricescale: Math.round(1 / tickSize),
      timezone: "Etc/UTC",
      session: "24x7"
    };
  }
  listSymbols() {
    if (!this.symbolsPromise) {
      this.symbolsPromise = Promise.all([
        this.listSpot().catch(() => []),
        this.listFutures().catch(() => [])
      ]).then(([spot, futures]) => [...spot, ...futures]);
    }
    return this.symbolsPromise;
  }
  /** Predefined icon source for a crypto venue: the Ledger crypto-icon CDN, keyed by
   *  the BASE asset (the description's first segment, else the de-suffixed ticker). */
  resolveSymbolIcon(symbol) {
    return ledgerCryptoIconUrl(baseOf(symbol));
  }
  subscribe(ticker, timeframe, onBar) {
    const { apiSymbol, isFutures } = parseTicker(ticker);
    const interval = TF_TO_INTERVAL[normalizeTf(timeframe)];
    if (interval && typeof WebSocket !== "undefined") return this.streamKlines(ticker, timeframe, apiSymbol, isFutures, interval, onBar);
    return this.pollBars(ticker, timeframe, onBar);
  }
  // ── internals ────────────────────────────────────────────────────────
  /**
   * Open a Binance kline WebSocket (single-stream URL form — the stream is in the
   * path, so no subscribe frame is sent). Perpetuals use `fstream`; spot uses the
   * host matching the resolved REST endpoint (`.com`/`.us`). Reconnects on an
   * unexpected close until unsubscribed; the browser auto-answers Binance's
   * protocol-level pings, so no manual keepalive is needed.
   *
   * A stall watchdog falls the subscription back to polling if the socket opens but
   * never delivers a candle — so a blocked/silent stream (e.g. geo-restricted
   * futures) still yields live updates instead of a silently-dead feed.
   */
  streamKlines(ticker, timeframe, apiSymbol, isFutures, interval, onBar) {
    let closed = false;
    let ws = null;
    let reconnect = null;
    let stall = null;
    let polling = null;
    const stream = `${apiSymbol.toLowerCase()}@kline_${interval}`;
    const clearStall = () => {
      if (stall) {
        clearTimeout(stall);
        stall = null;
      }
    };
    const fallToPolling = () => {
      if (closed || polling) return;
      clearStall();
      if (reconnect) {
        clearTimeout(reconnect);
        reconnect = null;
      }
      try {
        ws?.close();
      } catch {
      }
      ws = null;
      console.warn(`[vela] Binance: ${ticker} ${timeframe} stream delivered no data; falling back to polling.`);
      polling = this.pollBars(ticker, timeframe, onBar);
    };
    const open = async () => {
      if (closed) return;
      const base = isFutures ? FUTURES_WS : await this.spotWsBase();
      if (closed) return;
      ws = new WebSocket(`${base}/ws/${stream}`);
      stall = setTimeout(fallToPolling, STREAM_STALL_MS);
      ws.onmessage = (ev) => {
        if (closed || polling) return;
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.k) {
            clearStall();
            onBar(klineEventToOHLCV(msg.k));
          }
        } catch {
        }
      };
      ws.onclose = () => {
        if (!closed && !polling) reconnect = setTimeout(() => void open(), STREAM_RECONNECT_MS);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
        }
      };
    };
    void open();
    return () => {
      closed = true;
      clearStall();
      if (reconnect) clearTimeout(reconnect);
      polling?.();
      try {
        ws?.close();
      } catch {
      }
    };
  }
  /** WebSocket host matching the resolved REST spot endpoint (`.com` default, else `.us`). */
  async spotWsBase() {
    const base = await this.spotBase();
    return base.includes("binance.us") ? SPOT_WS_US : SPOT_WS;
  }
  /** Poll the forming candle (for aggregated timeframes Binance has no native kline stream for). */
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
  async listSpot() {
    const base = await this.spotBase();
    const data = await this.json(`${base}/exchangeInfo`);
    return (data.symbols ?? []).filter((s) => s.status === "TRADING").map((s) => ({ ticker: s.symbol, description: `${s.baseAsset} / ${s.quoteAsset}`, type: "crypto" }));
  }
  async listFutures() {
    const data = await this.json(`${FUTURES_BASE}/exchangeInfo`);
    return (data.symbols ?? []).filter((s) => s.contractType === "PERPETUAL" && s.status === "TRADING").map((s) => ({ ticker: `${s.symbol}.P`, description: `${s.baseAsset} / ${s.quoteAsset} Perpetual`, type: "futures" }));
  }
  /** Fetch klines, paginating past Binance's 1000-row cap. */
  async fetchKlines(base, symbol, interval, range) {
    if (range.from != null) return this.paginateForward(base, symbol, interval, range.from, range.to ?? Date.now(), range.limit);
    const limit = range.limit ?? 500;
    if (limit > 1e3) return this.paginateBackward(base, symbol, interval, limit, range.to);
    return this.klinesChunk(base, { symbol, interval, limit, endTime: range.to });
  }
  /** Forward pagination from `from` to `to` (used by ranged/tail fetches). */
  async paginateForward(base, symbol, interval, from, to, limit) {
    const out = [];
    let cursor = from;
    while (cursor < to) {
      const chunk = await this.klinesChunk(base, { symbol, interval, limit: 1e3, startTime: cursor, endTime: to });
      if (chunk.length === 0) break;
      out.push(...chunk);
      cursor = Number(chunk[chunk.length - 1][6]) + 1;
      if (chunk.length < 1e3) break;
      if (limit && out.length >= limit) break;
    }
    return limit ? out.slice(0, limit) : out;
  }
  /** Backward pagination to assemble the most-recent `limit` bars. */
  async paginateBackward(base, symbol, interval, limit, endTime) {
    let out = [];
    let remaining = limit;
    let cursor = endTime;
    let guard = Math.ceil(limit / 1e3) + 5;
    while (remaining > 0 && guard-- > 0) {
      const size = Math.min(remaining, 1e3);
      const chunk = await this.klinesChunk(base, { symbol, interval, limit: size, endTime: cursor });
      if (chunk.length === 0) break;
      out = chunk.concat(out);
      remaining -= chunk.length;
      cursor = Number(chunk[0][0]) - 1;
      if (chunk.length < size) break;
    }
    return out;
  }
  async klinesChunk(base, params) {
    const url = new URL(`${base}/klines`);
    url.searchParams.set("symbol", params.symbol);
    url.searchParams.set("interval", params.interval);
    if (params.limit) url.searchParams.set("limit", String(Math.min(params.limit, 1e3)));
    if (params.startTime != null) url.searchParams.set("startTime", String(params.startTime));
    if (params.endTime != null) url.searchParams.set("endTime", String(params.endTime));
    const data = await this.json(url.toString());
    if (!Array.isArray(data)) return [];
    if (data.length > 0 && !Array.isArray(data[0])) return [];
    return data;
  }
  /**
   * Resolve the reachable spot endpoint (default, else the US mirror). The in-flight
   * probe is shared, so a burst of concurrent first calls issues ONE ping pair, not one
   * per call. A confirmed endpoint is cached permanently; a total failure clears the
   * probe so a later call can retry.
   */
  spotBase() {
    if (this.spotBaseUrl) return Promise.resolve(this.spotBaseUrl);
    if (!this.spotBaseProbe) {
      this.spotBaseProbe = (async () => {
        try {
          for (const url of [SPOT_BASE, SPOT_BASE_US]) {
            try {
              const res = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(5e3) });
              if (res.ok) return this.spotBaseUrl = url;
            } catch {
            }
          }
          return SPOT_BASE;
        } finally {
          this.spotBaseProbe = null;
        }
      })();
    }
    return this.spotBaseProbe;
  }
  async json(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status} for ${url}`);
    return res.json();
  }
};

export { BinanceProvider };
