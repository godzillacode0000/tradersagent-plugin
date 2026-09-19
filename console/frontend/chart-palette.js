/**
 * chart-palette — one place that knows the chart's colours, and that keeps whatever the operator
 * chose before anything of ours overwrites it.
 *
 * Why this exists: Vela persists its own renderer config (background, grid, candles…) inside
 * `localStorage['vela-workspace']`, and a theme *string* does not touch a config that already holds
 * explicit colours. On this machine that meant a hand-made white-background / black-and-orange
 * palette survived every attempt to match the console's dark theme — the chart looked light inside a
 * dark app.
 *
 * Rules:
 *   1. The console's palette is applied explicitly (rendererControl.applyConfig), never by string.
 *   2. A hand-made palette is parked BEFORE the workspace is constructed, because Vela replaces the
 *      config during creation — parking after that point has nothing to save.
 *   3. Switching the console to light restores the parked palette exactly, so one click is a round
 *      trip rather than a loss.
 *
 * Loaded before workspace.js (which builds the chart) and before app.js (which drives the toggle).
 */
(function () {
  'use strict';

  const KEY = 'luxalgo-web:chart-palette-parked';

  const PALETTES = {
    dark: { background: '#151619', text: '#b2b5be', grid: '#20222c', border: '#2a2b30',
            crosshair: '#9aa0ad', up: '#089981', down: '#f23645' },
    light: { background: '#ffffff', text: '#131722', grid: '#e0e3eb', border: '#e0e3eb',
             crosshair: '#9598a1', up: '#089981', down: '#f23645' },
  };

  /* Both palettes use green/red candles, so any other up-colour was picked by hand. */
  const KNOWN_UP = ['#089981', '#26a69a', '#f23645', '#ef5350', ''];

  function parked() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function isHandMade(config) {
    const up = String(config?.candles?.upColor || '').toLowerCase();
    return !KNOWN_UP.includes(up);
  }

  /** Park the config the workspace will load — call this BEFORE constructing the workspace. */
  function parkStored() {
    try {
      if (localStorage.getItem(KEY)) return false;
      const state = JSON.parse(localStorage.getItem('vela-workspace') || 'null');
      const config = state?.charts?.[0]?.rendererConfig;
      if (!config || !isHandMade(config)) return false;
      localStorage.setItem(KEY, JSON.stringify(config));
      return true;
    } catch (err) {
      return false;      // private mode: nothing to park, nothing to lose
    }
  }

  /** Paint one of our palettes over the live config, or restore the parked one. Returns a truthy
   *  report so the caller can log what actually happened instead of assuming. */
  function apply(theme) {
    const rc = window.__consoleChart?.rendererControl;
    if (!rc || typeof rc.getConfig !== 'function' || typeof rc.applyConfig !== 'function') {
      return { ok: false, why: 'no renderer control on this page' };
    }

    if (theme === 'light') {
      const saved = parked();
      if (saved) {
        try { rc.applyConfig(saved); return { ok: true, restored: true }; } catch (err) {
          return { ok: false, why: 'restore failed: ' + (err && err.message) };
        }
      }
    }

    const p = PALETTES[theme] || PALETTES.dark;
    let config;
    try { config = rc.getConfig(); } catch (err) { return { ok: false, why: 'getConfig failed' }; }
    if (!config || !config.layout) return { ok: false, why: 'config has no layout' };

    if (!parked() && isHandMade(config)) {
      try { localStorage.setItem(KEY, JSON.stringify(config)); } catch (err) { /* private mode */ }
    }

    config.layout.background = p.background;
    config.layout.textColor = p.text;
    if (config.grid?.vertLines) config.grid.vertLines.color = p.grid;
    if (config.grid?.horzLines) config.grid.horzLines.color = p.grid;
    if (config.priceScale) config.priceScale.borderColor = p.border;
    if (config.panes) config.panes.separatorColor = p.border;
    if (config.crosshair) config.crosshair.color = p.crosshair;
    for (const key of ['candles', 'bars']) {
      const style = config[key];
      if (!style) continue;
      if ('upColor' in style) style.upColor = p.up;
      if ('downColor' in style) style.downColor = p.down;
      if ('borderUpColor' in style) style.borderUpColor = p.up;
      if ('borderDownColor' in style) style.borderDownColor = p.down;
      if ('wickUpColor' in style) style.wickUpColor = p.up;
      if ('wickDownColor' in style) style.wickDownColor = p.down;
    }
    try { rc.applyConfig(config); return { ok: true, theme }; } catch (err) {
      return { ok: false, why: 'applyConfig failed: ' + (err && err.message) };
    }
  }

  window.ChartPalette = { KEY, PALETTES, KNOWN_UP, parked, isHandMade, parkStored, apply };

  /* Park right here, at script load: Vela rewrites its stored state while its modules are being
   * imported, so this is the last moment the operator's own palette is still readable. A second
   * attempt from workspace.js is harmless — parkStored() is idempotent. */
  if (parkStored()) {
    console.info('[chart-palette] hand-made chart palette parked — the console theme can be flipped back to it');
  }
})();
