import './chunk-JU4CWEBF.js';
export { BarStore, CachingDataFeed, DARK_THEME, DataControl, DrawingStore, DrawingToolbar, DrawingsControl, LIGHT_THEME, MarksControl, MultiProviderFeed, NativeRenderer, RendererControl, ReplayControl, SecondClock, TypedEventBus, Vela, buildToolbar, defaultToolbar, resolveTheme, sharedBarStore, timeframeToMs } from './chunk-ATGTCWHJ.js';
export { DEFAULT_PANEL_MAX_WIDTH, DEFAULT_PANEL_MIN_WIDTH, DEFAULT_PANEL_WIDTH, Drawing, OVERRIDABLE_TOPBAR_IDS, chartType, chartTypes, clampPanelWidth, createDrawing, deserializeDrawing, drawingTypes, getDrawingType, getNativeIndicator, inputDeltas, inputVisible, legendActions, legendCallouts, nativeIndicatorDescriptors, nativeIndicatorTypes, normalizeSettingsRow, registerChartType, registerDefaultEngine, registerDrawingType, registerLegendAction, registerLegendCallout, registerNativeIndicator, registerRendererDefaults, registerRendererLayer, registerSidePanel, registerStatePersistence, registerSymbolRanking, registerWidgetAction, registerWidgetAttachment, rendererDefaults, rendererLayers, resolveEngines, seriesInScale, seriesShownOn, settingsRowValueKeys, sidePanels, stableSeriesId, statePersistenceHandlers, symbolRanking, tickerModifierIds, topbarActionOverride, unregisterChartType, unregisterDefaultEngine, unregisterLegendAction, unregisterLegendCallout, unregisterNativeIndicator, unregisterRendererDefaults, unregisterRendererLayer, unregisterSidePanel, unregisterStatePersistence, unregisterWidgetAction, unregisterWidgetAttachment, widgetActions, widgetAttachments } from './chunk-EZ5FWVLA.js';
import './chunk-NELQJCGK.js';
export { ACCENT, ACCENT_BRIGHT, BEARISH, BULLISH, CATEGORICAL, CHIP_PLATE, CROSSHAIR, HIGHLIGHT, INFO, INVALID, MARKER, NEUTRAL, SERIES_LINE, SESSION_OFF, SESSION_POST, SESSION_PRE, SLATE, SLATE_DEEP, TRADE_EXIT, TRADE_LONG, TRADE_SHORT, VALID, WARNING, categoricalColor, iconMarkup, registerIcon } from './chunk-BZQM2XO7.js';

// src/core/replayTicks.ts
function lowerTimeframeTicks(chart, timeframe) {
  return async (bar, { end, signal }) => {
    const { symbol, session } = chart.market;
    const resolved = symbol ? chart.data.resolve(symbol) : null;
    const provider = resolved ? chart.data.providerInstance(resolved.provider) : void 0;
    if (!resolved || !provider) return [];
    const bars = await provider.getBars(resolved.ticker, timeframe, { from: bar.time, to: end - 1, ...session ? { session } : {} });
    if (signal.aborted) return [];
    return barsToTicks(bars.filter((b) => b.time >= bar.time && b.time < end));
  };
}
function barsToTicks(bars) {
  return bars.map((b) => ({
    price: b.close,
    open: b.open,
    high: b.high,
    low: b.low,
    ...b.volume === void 0 ? {} : { volume: b.volume }
  }));
}

export { barsToTicks, lowerTimeframeTicks };
