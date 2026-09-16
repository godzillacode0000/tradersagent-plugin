/* ----------------------------------------------------------------------------
 * The FULL Vela application, not the bare chart.
 *
 * `@luxalgo/vela/workspace` is the multi-chart shell: one shared data feed, one
 * shared chrome — topbar (symbol / timeframe / style / layout / indicator
 * picker / alerts), the drawing toolbar, object tree, data window, bottom bar
 * (session, timezone clock, range), context menus, settings dialog, the `?`
 * shortcut panel, PNG export and mobile chrome. `layout: false` pins it to a
 * single chart, which is what this app wants.
 *
 * Loaded as an ES module through an import map because the workspace is NOT in
 * the root global build (`window.Vela.VelaWorkspace` is undefined) — verified,
 * and jsDelivr's `+esm` entry points are the no-bundler route:
 *   @luxalgo/vela/workspace          1,004,761 bytes
 *   @luxalgo/vela                      750,816 bytes
 *
 * This file only builds the shell and hands it to app.js. If anything here
 * fails, app.js still boots a bare Vela chart — the app must never be worse
 * than it was.
 * ------------------------------------------------------------------------- */

const state = { ready: null, ws: null, error: null };
window.__wsApp = {
  get ws() { return state.ws; },
  get error() { return state.error; },
  get ready() { return state.ready; },
  activeChart() {
    try {
      const cells = state.ws && state.ws.cells ? state.ws.cells() : [];
      const active = state.ws.activeCell ? state.ws.activeCell() : null;
      const cell = active || cells[0];
      return (cell && cell.chart) || null;
    } catch { return null; }
  },
  setTheme(t) {
    try { state.ws && state.ws.setTheme && state.ws.setTheme(t); return true; } catch (err) { console.warn('[ws] setTheme failed:', err); return false; }
  },
  screenshot() {
    try { return state.ws && state.ws.screenshot ? state.ws.screenshot() : null; } catch (err) { console.warn('[ws] screenshot failed:', err); return null; }
  },
  download(getName) {
    try { state.ws && state.ws.downloadScreenshot && state.ws.downloadScreenshot(getName); return true; } catch (err) { return false; }
  },
  toggles: null,
  pineRegistered: false,
};

function readTheme() {
  try { return localStorage.getItem('luxalgo-web:theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

state.ready = (async () => {
  const host = document.getElementById('chart');
  if (!host) throw new Error('#chart host missing');
  const [{ VelaWorkspace }, { BinanceProvider }, pinets] = await Promise.all([
    import('@luxalgo/vela/workspace'),
    import('@luxalgo/vela/providers/binance'),
    import('@luxalgo/vela-pinets'),
  ]);
  const Engine = pinets.PineWorkerEngine || pinets.PineEngine;
  window.__wsApp.pineRegistered = typeof Engine === 'function';

  const ws = new VelaWorkspace('#chart', {
    layout: false,                                   // single chart, no layout picker
    symbol: 'BTCUSDT',
    timeframe: '60',
    providers: { binance: () => new BinanceProvider() },
    engines: Engine ? { pine: () => new Engine() } : undefined,
    live: true,
    theme: readTheme(),
    persist: true,                                   // restore drawings/indicators from localStorage
    drawings: true,
  });
  state.ws = ws;
  window.__ws = ws;                                  // console access, as documented

  // No ws.ready() exists on this build — wait for the shell to report state.
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try { ws.on('state:changed', finish); ws.on('cell:created', finish); } catch {}
    setTimeout(finish, 15000);
  });

  window.dispatchEvent(new CustomEvent('ws-ready', { detail: { ws } }));
  return ws;
})().catch((err) => {
  state.error = err;
  console.error('[ws] full workspace failed to load — app will use the bare chart:', err);
  window.dispatchEvent(new CustomEvent('ws-failed', { detail: { error: err } }));
  return null;
});
