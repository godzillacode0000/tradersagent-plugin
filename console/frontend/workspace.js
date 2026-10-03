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
  /* Vela's own shot covers ITS canvases only: the overlay draws on a canvas of its own
     (`#chart-overlay`, sitting above the chart), so every picture the agent took of a Library script
     read as empty even while the boxes were on screen (measured 29 Sep: the bridge reported
     "5 box(es) verified on screen" and the same run's PNG showed nothing). Composite instead — the
     chart's PNG as the base, then the overlay canvas at its own measured offset and scale. The
     tables host is a DOM element, not a canvas, so dashboard tables still do not appear in a
     picture; the bridge's own state carries their counts instead. */
  async screenshot() {
    let base = null;
    try { base = state.ws && state.ws.screenshot ? await state.ws.screenshot() : null; } catch (err) {
      console.warn('[ws] screenshot failed:', err); return null;
    }
    const overlay = document.querySelector('#chart-overlay');
    if (!base || !overlay) return base;
    try {
      const img = new Image();
      img.src = String(base);
      await img.decode();
      const host = document.getElementById('chart');
      const hostRect = host ? host.getBoundingClientRect() : { left: 0, top: 0, width: img.naturalWidth };
      const s = hostRect.width ? img.naturalWidth / hostRect.width : (window.devicePixelRatio || 1);
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const r = overlay.getBoundingClientRect();
      if (r.width && r.height) {
        ctx.drawImage(overlay, (r.left - hostRect.left) * s, (r.top - hostRect.top) * s, r.width * s, r.height * s);
      }
      const out = cv.toDataURL('image/png');
      return out || base;
    } catch (err) {
      // A composite that fails must not cost the picture the operator already had.
      console.warn('[ws] overlay composite failed, returning the bare chart shot:', err);
      return base;
    }
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
  const [{ VelaWorkspace }, { BinanceProvider }, velaPinets] = await Promise.all([
    import('@luxalgo/vela/workspace'),
    import('@luxalgo/vela/providers/binance'),
    import('@luxalgo/vela-pinets'),
  ]);
  /* TWO engines are on offer here and they differ in a way that matters:
       - PineEngine runs on THIS thread and is built on vela-pinets' own `import { PineTS } from
         'pinets'`, which the page's import map resolves to ./vendor/pinets — our PATCHED fork.
       - PineWorkerEngine runs off-thread, but its worker is an engine copy INLINED into
         vela-pinets' dist (unpatched): a script our patches fixed fails on that path — the audit's
         #17. `opts.createWorker`/`opts.workerUrl` do exist, but the worker also carries the model
         builder, so a replacement would mean rebuilding vela-pinets rather than pointing it here.

     The patched one is the default, and that has a cost the audit's follow-up named: a Pine run on
     the main thread blocks the page (heartbeat, commands, painting) for its whole duration, and
     nothing can interrupt it — the coverage doc measured a 20 s run that ticked a 250 ms timer zero
     times, and a 301 s worst case. So the engine is a choice the operator can flip per browser:
     `?engine=worker` on the console URL, or localStorage `luxalgo-web:pine-engine` = "worker" |
     "main". Default: the patched main-thread engine, because a script that runs is the point. */
  const wantWorker = (() => {
    try {
      if (new URLSearchParams(location.search).get('engine') === 'worker') return true;
      return localStorage.getItem('luxalgo-web:pine-engine') === 'worker';
    } catch (err) { return false; }
  })();
  const Engine = wantWorker
    ? (velaPinets.PineWorkerEngine || velaPinets.PineEngine)
    : (velaPinets.PineEngine || velaPinets.PineWorkerEngine);
  window.__wsApp.pineRegistered = typeof Engine === 'function';
  window.__wsApp.engineSource = typeof Engine !== 'function' ? null
    : (Engine === velaPinets.PineEngine
      ? 'PineEngine (main thread) → pinets from vendor/pinets (patched fork)'
      : 'PineWorkerEngine (worker carries its own unpatched engine copy)');
  if (Engine === velaPinets.PineWorkerEngine) {
    console.warn('[workspace] running on vela-pinets\' bundled engine — the fork\'s patches are not in effect here');
  }

  // The docs' other wiring — `registerDefaultEngine('pine', () => new PineWorkerEngine())`, "register
  // once, app-wide" — so any chart this app builds later (even one that skips the factory above) can
  // run Pine. Separate import and try/catch: a plugin subpath that fails must not cost us the shell.
  try {
    const { registerDefaultEngine } = await import('@luxalgo/vela/plugin');
    if (typeof registerDefaultEngine === 'function' && typeof Engine === 'function') {
      registerDefaultEngine('pine', () => new Engine());
      console.info('[workspace] default Pine engine registered app-wide — ' + window.__wsApp.engineSource);
    }
  } catch (err) {
    console.warn('[workspace] registerDefaultEngine unavailable — per-cell engines still wired:', err);
  }

  // Park the palette the workspace is about to load, before Vela can replace it: this is the only
  // moment the operator's own colours are still readable (see chart-palette.js).
  if (window.ChartPalette?.parkStored?.()) {
    console.info('[workspace] chart palette parked — switching the console to light restores it');
  }

  // Vela's own "Indicators" button is the door to the drawer. `registerWidgetAction` is Vela's official
  // override for exactly two slots ("indicators", "screenshot"), and Vela reads it in the VelaWorkspace
  // CONSTRUCTOR (`this.indicatorsOverride = topbarActionOverride("indicators")`) — registered later it does
  // nothing and Vela keeps its own picker. The drawer holds both halves (BUILT-INS and the LuxAlgo
  // catalogue), so overriding the button costs the operator nothing. A failure here must not cost the chart.
  try {
    const { registerWidgetAction } = await import('@luxalgo/vela/plugin');
    if (typeof registerWidgetAction === 'function') {
      registerWidgetAction({
        id: 'indicators', target: 'topbar', label: 'Indicators', icon: 'indicators',
        run: () => { if (window.libDrawer) window.libDrawer.toggle(); },
      });
      /* `<>` Script and full screen ride Vela's own row as REAL widget actions (3 Oct) instead of the
         old DOM docking: Vela renders, styles and maintains them itself, so there is no re-dock timer
         and nothing to jump between rows. Both are icon-only (the labels are the tooltips) — the row
         is 868 px wide, and full labels push Vela's own camera off its edge. */
      registerWidgetAction({
        id: 'ta-script', target: 'topbar', icon: 'pen', iconOnly: true, order: 20,
        label: 'Script — write or paste Pine, then Run it on this chart',
        run: () => { if (window.scriptPane) window.scriptPane.toggle(); },
      });
      registerWidgetAction({
        id: 'ta-fullscreen', target: 'topbar', icon: 'maximize', iconOnly: true, order: 30,
        label: 'Full screen — the chart takes the whole pane (Esc comes back)',
        run: () => {
          if (window.setChartFullscreen) {
            window.setChartFullscreen(!(window.isChartFullscreen && window.isChartFullscreen()));
          }
        },
      });
    }
  } catch (err) {
    console.warn('[workspace] could not take over the Indicators button — the fallback button stays visible:', err);
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
