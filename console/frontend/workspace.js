/* ----------------------------------------------------------------------------
 * The FULL Vela application, not the bare chart.
 *
 * `@luxalgo/vela/workspace` is the multi-chart shell: one shared data feed, one
 * shared chrome — topbar (symbol / timeframe / style / layout / indicator
 * picker / alerts), the drawing toolbar, object tree, data window, bottom bar
 * (session, timezone clock, range), context menus, settings dialog, the `?`
 * shortcut panel, PNG export and mobile chrome.
 *
 * The grid is ON, at 2 side by side (operator's call, 26 Sep). `layout` takes a Vela preset —
 * `'1' | '2h' | '2v' | '4' | '8'`, or a custom `g<cols>x<rows>` up to 4x4. **`layout: false` is
 * not just "one chart": it sets `monoLayout`, which pins the grid AND makes `ws.setLayout()` a
 * no-op for the life of the page** — so a preset here is the only way in at boot, and the
 * `layout` bridge action (chart-bridge.js) is the way in afterwards. Measured on
 * @luxalgo/vela 0.7.3: `layout` omitted entirely defaults to `'4'`, and a layout already stored
 * in this page's state **wins over this constructor value** (`resolveLayout(s?.layout ?? …)`) —
 * so a grid change made from chat survives a reload, which is the behaviour we want.
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

/* The grid this console boots with: a Vela preset, never `false` (see the header — `false` means
   monoLayout, which also makes the `layout` bridge action a no-op). `'2h'` is 2 side by side;
   `'1' | '2v' | '4' | '8'` and `g<cols>x<rows>` are the rest. */
const LAYOUT = '2h';

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

  // Park the palette the workspace is about to load, before Vela can replace it: this is the only
  // moment the operator's own colours are still readable (see chart-palette.js).
  if (window.ChartPalette?.parkStored?.()) {
    console.info('[workspace] chart palette parked — switching the console to light restores it');
  }

  const ws = new VelaWorkspace('#chart', {
    layout: LAYOUT,                                  // Vela grid preset — see LAYOUT above
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
