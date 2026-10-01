import { ledgerCryptoIconUrl, baseOf } from '../chunk-W4EJWLEO.js';

// src/data/providers/hyperliquid/HyperliquidProvider.ts
var INFO_URL = "https://api.hyperliquid.xyz/info";
var WS_URL = "wss://api.hyperliquid.xyz/ws";
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
var NATIVE_MINUTES = [1, 3, 5, 15, 30, 60, 120, 240, 480, 720];
var MIN_TO_INTERVAL = {
  1: "1m",
  3: "3m",
  5: "5m",
  15: "15m",
  30: "30m",
  60: "1h",
  120: "2h",
  240: "4h",
  480: "8h",
  720: "12h"
};
var SUPPORTED_TIMEFRAMES = ["1", "3", "5", "15", "30", "45", "60", "120", "180", "240", "360", "480", "720", "D", "W", "M"];
var TF_MS = {
  D: 864e5,
  W: 6048e5,
  M: 2592e6
  // month ≈ 30d (windowing only; not bar alignment)
};
function tfMs(tf) {
  if (TF_MS[tf]) return TF_MS[tf];
  const min = parseInt(tf, 10);
  return Number.isFinite(min) && min > 0 ? min * 6e4 : 36e5;
}
function normalizeTf(tf) {
  return TF_NORMALIZE[tf] ?? TF_NORMALIZE[tf.toLowerCase()] ?? tf;
}
function parseCoin(ticker) {
  const t = ticker.trim();
  return t.includes("/") ? t : t.toUpperCase();
}
function candleToOHLCV(k) {
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
var HyperliquidProvider = class {
  constructor() {
    /** Cached perp `meta` (universe is large; fetch once). */
    this.metaPromise = null;
    /** Cached `spotMeta`. */
    this.spotMetaPromise = null;
    /** Cached symbol enumeration. */
    this.symbolsPromise = null;
  }
  info() {
    return {
      name: "hyperliquid",
      displayName: "Hyperliquid",
      requiresApiKey: false,
      supportedTimeframes: SUPPORTED_TIMEFRAMES,
      capabilities: { enumerate: true, stream: true, symbolInfo: true }
    };
  }
  async getBars(ticker, timeframe, range) {
    try {
      const coin = parseCoin(ticker);
      const tf = normalizeTf(timeframe);
      const nativeInterval = TF_TO_INTERVAL[tf];
      if (nativeInterval) {
        return dedupeSorted((await this.fetchCandles(coin, nativeInterval, tfMs(tf), range)).map(candleToOHLCV));
      }
      const targetMin = /^\d+$/.test(tf) ? parseInt(tf, 10) : null;
      const subMin = targetMin != null ? selectSubTf(targetMin) : null;
      if (targetMin == null || subMin == null) {
        console.warn(`[vela] Hyperliquid: timeframe "${timeframe}" is not supported and cannot be aggregated.`);
        return [];
      }
      const ratio = targetMin / subMin;
      const subRange = { ...range, limit: range.limit != null ? range.limit * ratio + ratio : void 0 };
      const sub = (await this.fetchCandles(coin, MIN_TO_INTERVAL[subMin], subMin * 6e4, subRange)).map(candleToOHLCV);
      const agg = aggregate(sub, targetMin * 6e4);
      return range.limit != null && agg.length > range.limit ? agg.slice(-range.limit) : agg;
    } catch (e) {
      console.warn(`[vela] Hyperliquid: failed to fetch ${ticker} ${timeframe} \u2014 ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }
  async getSymbolInfo(ticker) {
    const coin = parseCoin(ticker);
    const meta = await this.fetchMeta().catch(() => null);
    const perp = meta?.universe?.find((u) => u.name === coin);
    if (perp) {
      const mintick = decimalsToTick(Math.max(0, 6 - (perp.szDecimals ?? 2)));
      return symbolInfo(ticker, coin, "USD", "futures", `${coin} / USD Perpetual`, mintick);
    }
    if (coin.includes("/")) {
      const spot = await this.fetchSpotMeta().catch(() => null);
      const entry = spot?.universe?.find((u) => u.name === coin);
      const baseTok = entry && spot?.tokens ? spot.tokens[entry.tokens?.[0] ?? -1] : void 0;
      const [base = coin, quote = "USDC"] = coin.split("/");
      const mintick = decimalsToTick(Math.max(0, 8 - (baseTok?.szDecimals ?? 2)));
      return symbolInfo(ticker, base, quote, "crypto", `${base} / ${quote}`, mintick);
    }
    return void 0;
  }
  listSymbols() {
    if (!this.symbolsPromise) {
      this.symbolsPromise = Promise.all([
        this.listPerps().catch(() => []),
        this.listSpot().catch(() => [])
      ]).then(([perps, spot]) => [...perps, ...spot]);
    }
    return this.symbolsPromise;
  }
  /** Predefined icon source for a crypto venue: the Ledger crypto-icon CDN, keyed by
   *  the BASE asset (the description's first segment, else the de-suffixed ticker). */
  resolveSymbolIcon(symbol) {
    return ledgerCryptoIconUrl(baseOf(symbol));
  }
  subscribe(ticker, timeframe, onBar) {
    const coin = parseCoin(ticker);
    const interval = TF_TO_INTERVAL[normalizeTf(timeframe)];
    if (interval && typeof WebSocket !== "undefined") return this.streamCandles(ticker, timeframe, coin, interval, onBar);
    return this.pollBars(ticker, timeframe, onBar);
  }
  // ── internals ────────────────────────────────────────────────────────
  async listPerps() {
    const meta = await this.fetchMeta();
    return (meta.universe ?? []).filter((u) => !u.isDelisted).map((u) => ({ ticker: u.name, description: `${u.name} / USD Perpetual`, type: "futures" }));
  }
  async listSpot() {
    const meta = await this.fetchSpotMeta();
    const tokens = meta.tokens ?? [];
    const nameOf = (i) => i != null ? tokens[i]?.name ?? null : null;
    return (meta.universe ?? []).map((u) => {
      const base = nameOf(u.tokens?.[0]);
      const quote = nameOf(u.tokens?.[1]);
      const description = base && quote ? `${base} / ${quote}` : u.name;
      return { ticker: u.name, description, type: "crypto" };
    });
  }
  /**
   * Fetch candles for a time window. Hyperliquid's `candleSnapshot` has no count
   * parameter — it returns candles in `[startTime, endTime]` (capped to the most
   * recent ~5000). We translate a bar `limit` into a start offset; a `from` range
   * (the cache's tail refresh) is used directly. The newest candle is the forming one.
   */
  async fetchCandles(coin, interval, intervalMs, range) {
    const end = range.to ?? Date.now();
    const start = range.from != null ? range.from : end - ((range.limit ?? 500) + 2) * intervalMs;
    const candles = await this.candleSnapshot(coin, interval, start, end);
    if (range.from == null && range.limit != null && candles.length > range.limit) return candles.slice(-range.limit);
    return candles;
  }
  async candleSnapshot(coin, interval, startTime, endTime) {
    const data = await this.post({ type: "candleSnapshot", req: { coin, interval, startTime: Math.floor(startTime), endTime: Math.floor(endTime) } });
    return Array.isArray(data) ? data : [];
  }
  /**
   * Open a WebSocket candle stream; reconnects on unexpected close until unsubscribed.
   * A stall watchdog falls the subscription back to polling if the socket opens but
   * never delivers a candle (a blocked/silent stream) — so live updates never go
   * silently dead. Mirrors the Binance provider's streaming resilience.
   */
  streamCandles(ticker, timeframe, coin, interval, onBar) {
    let closed = false;
    let ws = null;
    let ping = null;
    let reconnect = null;
    let stall = null;
    let polling = null;
    const clearStall = () => {
      if (stall) {
        clearTimeout(stall);
        stall = null;
      }
    };
    const clearPing = () => {
      if (ping) {
        clearInterval(ping);
        ping = null;
      }
    };
    const fallToPolling = () => {
      if (closed || polling) return;
      clearStall();
      clearPing();
      if (reconnect) {
        clearTimeout(reconnect);
        reconnect = null;
      }
      try {
        ws?.close();
      } catch {
      }
      ws = null;
      console.warn(`[vela] Hyperliquid: ${ticker} ${timeframe} stream delivered no data; falling back to polling.`);
      polling = this.pollBars(ticker, timeframe, onBar);
    };
    const open = () => {
      if (closed || polling) return;
      ws = new WebSocket(WS_URL);
      stall = setTimeout(fallToPolling, STREAM_STALL_MS);
      ws.onopen = () => {
        try {
          ws?.send(JSON.stringify({ method: "subscribe", subscription: { type: "candle", coin, interval } }));
        } catch {
        }
        ping = setInterval(() => {
          try {
            ws?.send(JSON.stringify({ method: "ping" }));
          } catch {
          }
        }, 3e4);
      };
      ws.onmessage = (ev) => {
        if (closed || polling) return;
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.channel === "candle" && msg.data && msg.data.s === coin) {
            clearStall();
            onBar(candleToOHLCV(msg.data));
          }
        } catch {
        }
      };
      ws.onclose = () => {
        clearPing();
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
      clearPing();
      if (reconnect) clearTimeout(reconnect);
      polling?.();
      try {
        ws?.close();
      } catch {
      }
    };
  }
  /** Poll the forming candle (for aggregated timeframes / environments without WebSocket). */
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
  fetchMeta() {
    return this.metaPromise ?? (this.metaPromise = this.post({ type: "meta" }).then((d) => d));
  }
  fetchSpotMeta() {
    return this.spotMetaPromise ?? (this.spotMetaPromise = this.post({ type: "spotMeta" }).then((d) => d));
  }
  async post(body) {
    const res = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);
    return res.json();
  }
};
function symbolInfo(ticker, basecurrency, currency, type, description, mintick) {
  return {
    ticker,
    // keep the original ticker (as Pine Script expects)
    tickerid: `HYPERLIQUID:${ticker}`,
    prefix: "HYPERLIQUID",
    description,
    type,
    basecurrency,
    currency,
    mintick,
    pricescale: Math.round(1 / mintick),
    timezone: "Etc/UTC",
    session: "24x7"
  };
}
function decimalsToTick(decimals) {
  return Math.pow(10, -decimals);
}

export { HyperliquidProvider };
