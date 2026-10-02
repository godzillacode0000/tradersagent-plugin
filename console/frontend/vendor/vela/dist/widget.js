import { VelaWorkspace } from './chunk-DBDXKZUF.js';
export { Bottombar, ChartContextMenu, DataWindow, IndicatorPicker, ObjectTree, PanelDock, RANGE_PRESETS, ShortcutsHelp, Statusline, SymbolPicker, TimeframeQuick, Topbar, Watermark, dataWindowSections, decimalsFor, decodeState, encodeState, filterSymbols, fmtChange, fmtPrice, localStorageAdapter, parseTimeframe, priceStyleLabel, resolveIndicators, sanitizeState, timeframeLabel, timeframeMs } from './chunk-DBDXKZUF.js';
export { TIMEZONES, normalizeTimezone, tzButtonLabel, tzMenuLabel, tzOffset } from './chunk-ATGTCWHJ.js';
export { DEFAULT_PANEL_MAX_WIDTH, DEFAULT_PANEL_MIN_WIDTH, DEFAULT_PANEL_ORDER, DEFAULT_PANEL_WIDTH, OVERRIDABLE_TOPBAR_IDS, SidePanel, TOPBAR_BUILTIN_IDS, TOPBAR_DEFAULT_LEFT, TOPBAR_DEFAULT_RIGHT, clampPanelWidth, pinnedTopbarActionIds, registerSidePanel, registerStatePersistence, registerSymbolRanking, registerWidgetAction, registerWidgetAttachment, resolveTopbarComposition, sidePanels, statePersistenceHandlers, symbolRanking, topbarActionOverride, topbarHas, unregisterSidePanel, unregisterStatePersistence, unregisterWidgetAction, unregisterWidgetAttachment, widgetActions, widgetAttachments } from './chunk-EZ5FWVLA.js';
import './chunk-LMBYEGUR.js';
import './chunk-NELQJCGK.js';
import './chunk-BZQM2XO7.js';
import './chunk-W4EJWLEO.js';

// src/widget/VelaWidget.ts
var deprecationWarned = false;
var VelaWidget = class {
  constructor(container, opts) {
    if (!deprecationWarned) {
      deprecationWarned = true;
      console.warn(
        "[vela] VelaWidget is deprecated and will be removed in a future release. Use `new VelaWorkspace(container, { ...options, layout: false })` \u2014 pass `persist: 'vela-widget'` to keep the same stored state. " + (opts.urlState ? "The `urlState` option is no longer supported and was ignored." : "")
      );
    }
    const { urlState: _urlState, height: _height, persist, ...rest } = opts;
    this.ws = new VelaWorkspace(container, {
      ...rest,
      layout: false,
      // The widget's historical storage key — existing persisted state restores.
      persist: persist === true ? "vela-widget" : persist
    });
  }
  /** The shell root element (the workspace root; carries `vela-widget` as an alias). */
  get root() {
    this.ws.root.classList.add("vela-widget");
    return this.ws.root;
  }
  get keymap() {
    return this.ws.keymap;
  }
  /** The chart's unified undo timeline — resolve it fresh, never cache it. */
  get history() {
    return this.ws.active.history;
  }
  /** The inner headless chart. */
  get chart() {
    return this.ws.chart;
  }
  /** A fresh contribution context (the workspace's is a superset of the widget's). */
  context() {
    return this.ws.context();
  }
  refreshActions() {
    this.ws.refreshActions();
  }
  setSymbol(symbol) {
    this.ws.active.setSymbol(symbol);
  }
  setTimeframe(timeframe) {
    this.ws.active.setTimeframe(timeframe);
  }
  setSession(session) {
    this.ws.active.setSession(session);
  }
  setPriceStyle(style) {
    this.ws.active.setPriceStyle(style);
  }
  setWatermarkVisible(visible) {
    this.ws.active.setWatermarkVisible(visible);
  }
  setIndicatorTitlesVisible(visible) {
    this.ws.active.setIndicatorTitlesVisible(visible);
  }
  setIndicatorValuesVisible(visible) {
    this.ws.active.setIndicatorValuesVisible(visible);
  }
  setTheme(theme) {
    this.ws.setTheme(theme);
  }
  setTimezone(zone) {
    this.ws.setTimezone(zone);
  }
  applyRange(preset) {
    this.ws.active.applyRange(preset);
  }
  /** The unified state document (`layout: '1'`, one cell). */
  getState() {
    return this.ws.getState();
  }
  /** Restore a state document IN PLACE — the chart instance survives. */
  applyState(state) {
    this.ws.applyState(state);
  }
  /** Subscribe to `state:changed` (the only widget event — unknown names no-op). */
  on(event, handler) {
    if (event !== "state:changed") return () => void 0;
    return this.ws.on("state:changed", handler);
  }
  destroy() {
    this.ws.destroy();
  }
};

export { VelaWidget };
