/* A PineTS market-data source for FX, fed by the console's own loader.
 *
 * The pane's chart is a Binance crypto feed, so `new PineTS(Provider.Binance, …)` has no GBPUSD — and
 * `request.security("EURUSD", …)` silently comes back as the chart's own series (measured 20 Oct:
 * BTC 68778 for an "ETH" request on custom bars). This provider is the missing half: PineTS asks it
 * for bars, it asks the console (`/api/fx/bars`), which builds them from Dukascopy's free tick files
 * (console/backend/fxdata.py). The same object serves the main symbol AND request.security's
 * secondary symbols, so an SMT pair is real data, not a duplicate of the chart.
 *
 * Bars are cached per URL for the life of the page: a 30m backtest asks for one series, and the
 * secondary symbol asks for another — neither should hit the disk twice.
 */
(function () {
  'use strict';

  const TF = { '1': '1', '5': '5', '15': '15', '30': '30', '60': '60', '120': '120', '240': '240', 'D': 'D', '1D': 'D' };
  const cache = new Map();

  function pairOf(ticker) {
    return String(ticker || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
  }

  async function bars(ticker, timeframe, limit) {
    const pair = pairOf(ticker);
    if (pair.length !== 6) throw new Error('not an FX pair: ' + ticker);
    const tf = TF[String(timeframe || '30').toUpperCase()] || '30';
    const url = `/api/fx/bars?pair=${pair}&timeframe=${tf}&limit=${Math.max(1, Math.min(Number(limit) || 500, 20000))}`;
    if (cache.has(url)) return cache.get(url);
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!body || body.ok !== true) {
      throw new Error((body && (body.error || (body.data && body.data.error))) || `FX bars failed (${res.status})`);
    }
    const rows = (body.data.bars || []).map((b) => ({
      openTime: b.openTime, closeTime: b.closeTime, open: b.open, high: b.high,
      low: b.low, close: b.close, volume: b.volume == null ? 0 : b.volume,
    }));
    if (!rows.length) throw new Error(`no ${pair} bars came back — is the feed reachable?`);
    cache.set(url, rows);
    return rows;
  }

  async function info(ticker) {
    const pair = pairOf(ticker);
    const jpy = pair.endsWith('JPY');
    const mintick = jpy ? 0.001 : 0.00001;
    return {
      ticker: pair, tickerid: 'FX:' + pair, prefix: 'FX', root: pair,
      description: pair.slice(0, 3) + ' / ' + pair.slice(3), type: 'forex',
      main_tickerid: 'FX:' + pair, current_contract: '', isin: '',
      basecurrency: pair.slice(0, 3), currency: pair.slice(3), timezone: 'Etc/UTC',
      country: '', mintick: mintick, pricescale: Math.round(1 / mintick), minmove: 1,
      pointvalue: 1, mincontract: 0.01, session: '24x5', volumetype: 'base',
      expiration_date: 0, employees: 0, industry: '', sector: '', shareholders: 0,
      shares_outstanding: 0, source: 'dukascopy',
    };
  }

  window.TraderFXProvider = {
    getMarketData: (ticker, timeframe, limit) => bars(ticker, timeframe, limit),
    getSymbolInfo: (ticker) => info(ticker),
    bars,
    info,
    clear() { cache.clear(); },
    /* The pairs the loader knows; a script's `//@fx` must be one of these (or any six letters the
       feed serves — the list is a guardrail, not a whitelist). */
    pairs: ['GBPUSD', 'EURUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'],
  };
})();
