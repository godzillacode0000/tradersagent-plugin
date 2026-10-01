// src/core/palette.ts
var ACCENT = "#2962ff";
var ACCENT_BRIGHT = "#38c0fd";
var BULLISH = "#089981";
var BEARISH = "#f23645";
var NEUTRAL = "#787b86";
var HIGHLIGHT = "#e0b400";
var WARNING = "#ff9800";
var INFO = "#5b9cf6";
var MARKER = "#ff5d00";
var VALID = "#0ecb81";
var INVALID = "#f6465d";
var SESSION_PRE = "#f97316";
var SESSION_POST = "#0ea5e9";
var SESSION_OFF = "#9ca3af";
var SERIES_LINE = "#3b82f6";
var CROSSHAIR = "#9aa0ad";
var SLATE_DEEP = "#1e293b";
var SLATE = "#475569";
var CHIP_PLATE = "#595959";
var TRADE_LONG = ACCENT;
var TRADE_SHORT = BEARISH;
var TRADE_EXIT = "#d500f9";
var CATEGORICAL = [ACCENT, BULLISH, BEARISH, WARNING, "#7e57c2", "#26a69a", INFO, "#e573b5"];
function categoricalColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = h * 31 + key.charCodeAt(i) >>> 0;
  return CATEGORICAL[h % CATEGORICAL.length];
}

// src/core/icons.ts
var registry = /* @__PURE__ */ new Map();
function registerIcon(id, svg) {
  registry.set(id, svg);
}
function iconMarkup(id) {
  return registry.get(id) ?? null;
}
function icon(id) {
  return registry.get(id) ?? "";
}
function iconAt(id, px) {
  return icon(id).replace("<svg ", `<svg width="${px}" height="${px}" `);
}
function svg16(body, extra = "") {
  return `<svg viewBox="0 0 16 16" width="1em" height="1em" ${extra ? extra + " " : ""}fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
function svg24(body, extra = "") {
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" ${extra ? extra + " " : ""}fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
function svg24Solid(body) {
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none">${body}</svg>`;
}
var S = svg16;
registerIcon(
  "style-candles",
  S('<path d="M4.5 2v2M4.5 12v2M11.5 2v1.5M11.5 11v3"/><rect x="2.8" y="4" width="3.4" height="8" rx="0.6" fill="currentColor" fill-opacity="0.25"/><rect x="9.8" y="3.5" width="3.4" height="7.5" rx="0.6" fill="currentColor"/>')
);
registerIcon(
  "style-bars",
  S('<path d="M4.5 2.5v11M2.5 5h2M4.5 11h2"/><path d="M11.5 2.5v11M9.5 4.5h2M11.5 10.5h2"/>')
);
registerIcon("style-line", S('<path d="M1.5 11.5 5.5 7l3 2.5 5-6"/>'));
registerIcon(
  "style-area",
  S('<path d="M1.5 11.5 5.5 7l3 2.5 5-6"/><path d="M1.5 11.5 5.5 7l3 2.5 5-6V13.5h-12z" fill="currentColor" fill-opacity="0.25" stroke="none"/>')
);
registerIcon(
  "style-baseline",
  S('<path d="M1.5 8h13" stroke-dasharray="2 2"/><path d="M2.5 8 5.25 4.5 8 8h-5.5z" fill="currentColor" fill-opacity="0.25" stroke="none"/><path d="M2.5 8 5.25 4.5 8 8"/><path d="M8 8l2.75 3.5L13.5 8h-5.5z" fill="currentColor" fill-opacity="0.25" stroke="none"/><path d="M8 8l2.75 3.5L13.5 8"/>')
);
registerIcon(
  "style-heikinashi",
  S('<path d="M4.5 12v2M11.5 2v2"/><rect x="2.8" y="5" width="3.4" height="7" rx="0.6" fill="currentColor" fill-opacity="0.25"/><rect x="9.8" y="4" width="3.4" height="7" rx="0.6" fill="currentColor"/>')
);
registerIcon("indicators", S('<path d="M1.5 12.5 5 7l2.5 3.5L11 4l3.5 5"/><circle cx="11" cy="4" r="1.4" fill="currentColor" stroke="none"/>'));
registerIcon("undo", S('<path d="M6.2 9.5 2.7 6l3.5-3.5"/><path d="M2.7 6h6.8a3.65 3.65 0 0 1 0 7.3H7.5"/>'));
registerIcon("redo", S('<path d="M9.8 9.5 13.3 6 9.8 2.5"/><path d="M13.3 6H6.5a3.65 3.65 0 0 0 0 7.3h2"/>'));
registerIcon(
  "objects",
  S('<path d="M8 1.8 14 5 8 8.2 2 5z"/><path d="M2 8l6 3.2L14 8" opacity="0.7"/><path d="M2 11l6 3.2 6-3.2" opacity="0.4"/>')
);
registerIcon("clock", S('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8V8l2.4 1.6"/>'));
registerIcon(
  "calendar",
  S('<rect x="2.2" y="3.2" width="11.6" height="10.6" rx="1.4"/><path d="M5.2 1.8v2.8M10.8 1.8v2.8M2.2 6.8h11.6"/>')
);
registerIcon("datawindow", S('<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.5"/><path d="M4.5 5.5h4M4.5 8h7M4.5 10.5h5.5"/>'));
registerIcon("camera", S('<path d="M5.5 4 6.5 2.5h3L10.5 4h3A1 1 0 0 1 14.5 5v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><circle cx="8" cy="8.5" r="2.6"/>'));
registerIcon(
  "gear",
  S('<path d="M6.55 1.4h2.9l.32 1.72c.48.14.92.38 1.3.7l1.66-.55 1.45 2.5-1.35 1.1c.08.34.12.7.12 1.07s-.04.73-.12 1.07l1.35 1.1-1.45 2.5-1.66-.55a4.3 4.3 0 0 1-1.3.7L9.45 14.6h-2.9l-.32-1.72a4.3 4.3 0 0 1-1.3-.7l-1.66.55-1.45-2.5 1.35-1.1A4.4 4.4 0 0 1 3.05 7.94c0-.37.04-.73.12-1.07l-1.35-1.1 1.45-2.5 1.66.55c.38-.32.82-.56 1.3-.7L6.55 1.4z"/><circle cx="8" cy="8" r="2.2"/>')
);
registerIcon("search", S('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>'));
registerIcon("bell", S('<path d="M8 2a4 4 0 0 0-4 4v2.5L2.5 11v1h11v-1L12 8.5V6a4 4 0 0 0-4-4z"/><path d="M6.5 13.5a1.5 1.5 0 0 0 3 0"/>'));
registerIcon(
  "market-open",
  svg24('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>')
);
registerIcon(
  "market-pre",
  svg24('<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>')
);
registerIcon(
  "market-post",
  svg24('<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 14-4 4-4-4"/><path d="M16 6a4 4 0 0 0-8 0"/>')
);
registerIcon(
  "market-extended",
  svg24('<path d="M22 22H2"/><path d="M12 3a5 5 0 0 0 7.5 7.5A7.5 7.5 0 1 1 12 3Z"/>')
);
registerIcon("market-closed", svg24('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'));
registerIcon(
  "market-holiday",
  svg24('<path d="m10 20-1.25-2.5L6 16"/><path d="M10 4 8.75 6.5 6 8"/><path d="m14 20 1.25-2.5L18 16"/><path d="m14 4 1.25 2.5L18 8"/><path d="m17 10-5 5-5-5"/><path d="M4 12h16"/>')
);
registerIcon("chevron-right", S('<path d="m6 3.5 4.5 4.5L6 12.5"/>'));
registerIcon("chevron-left", S('<path d="M10 3.5 5.5 8l4.5 4.5"/>'));
registerIcon("chevron-down", S('<path d="M3.5 6 8 10.5 12.5 6"/>'));
registerIcon("chevron-up", S('<path d="M3.5 10 8 5.5 12.5 10"/>'));
registerIcon("chevrons-right", S('<path d="m4 3.5 4.5 4.5L4 12.5"/><path d="m8.5 3.5 4.5 4.5-4.5 4.5"/>'));
registerIcon("chevrons-left", S('<path d="M12 3.5 7.5 8l4.5 4.5"/><path d="M7.5 3.5 3 8l4.5 4.5"/>'));
registerIcon("check", S('<path d="m2.8 8.4 3.4 3.4 7-7.6"/>'));
registerIcon("close", S('<path d="m3.8 3.8 8.4 8.4M12.2 3.8l-8.4 8.4"/>'));
registerIcon("pin", S('<path d="M5.6 2.5h4.8M6.4 2.5v3.6L4.4 8.4v.9h7.2v-.9L9.6 6.1V2.5M8 9.3v4.2"/>'));
registerIcon("pin-filled", S('<path d="M5.6 2.5h4.8M6.4 2.5v3.6L4.4 8.4v.9h7.2v-.9L9.6 6.1V2.5M8 9.3v4.2"/><path d="M6.4 2.5h3.2v3.6l2 2.3v.9H4.4v-.9l2-2.3z" fill="currentColor" stroke="none"/>'));
registerIcon("eye", S('<path d="M1.5 8s2.5-5.4 6.5-5.4S14.5 8 14.5 8 12 13.4 8 13.4 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>'));
registerIcon("eye-off", S('<path d="M1.5 8s2.5-5.4 6.5-5.4S14.5 8 14.5 8 12 13.4 8 13.4 1.5 8 1.5 8z" opacity="0.45"/><path d="m3 13 10-10"/>'));
registerIcon("lock", S('<rect x="3.2" y="7" width="9.6" height="6.6" rx="1.2"/><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7"/>'));
registerIcon("unlock", S('<rect x="3.2" y="7" width="9.6" height="6.6" rx="1.2"/><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.7-.7"/>'));
registerIcon("trash", S('<path d="M2.5 4.3h11M6.2 4.3V3.1a1 1 0 0 1 1-1h1.6a1 1 0 0 1 1 1v1.2M4.2 4.3l.5 9.1a1.15 1.15 0 0 0 1.15 1.1h4.3a1.15 1.15 0 0 0 1.15-1.1l.5-9.1M6.5 7v4.5M9.5 7v4.5"/>'));
registerIcon("group", S('<path d="M1.8 4.5V2.4a.6.6 0 0 1 .6-.6h2.1M11.5 1.8h2.1a.6.6 0 0 1 .6.6v2.1M14.2 11.5v2.1a.6.6 0 0 1-.6.6h-2.1M4.5 14.2H2.4a.6.6 0 0 1-.6-.6v-2.1"/><rect x="4" y="4" width="4.2" height="4.2" rx="0.7"/><rect x="7.8" y="7.8" width="4.2" height="4.2" rx="0.7"/>'));
registerIcon("ungroup", S('<rect x="1.6" y="1.6" width="6.2" height="6.2" rx="0.9"/><rect x="8.2" y="8.2" width="6.2" height="6.2" rx="0.9" stroke-dasharray="2 1.5"/>'));
registerIcon("clone", S('<rect x="5.5" y="5.5" width="9" height="9" rx="1.2"/><path d="M11 5.5v-3a1 1 0 0 0-1-1H2.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1h3"/>'));
registerIcon("arrow-up", S('<path d="M8 13.2V3M4.2 6.8 8 3l3.8 3.8"/>'));
registerIcon("arrow-down", S('<path d="M8 2.8V13M4.2 9.2 8 13l3.8-3.8"/>'));
registerIcon("move-vertical", S('<path d="M8 2.5v11M5 5.5 8 2.5l3 3M5 10.5l3 3 3-3"/>'));
registerIcon("move", S('<path d="M8 1.8v12.4M1.8 8h12.4M5.6 4.2 8 1.8l2.4 2.4M5.6 11.8 8 14.2l2.4-2.4M4.2 5.6 1.8 8l2.4 2.4M11.8 5.6 14.2 8l-2.4 2.4"/>'));
registerIcon("pen", S('<path d="m10.8 2.2 3 3-8 8-3.6.6.6-3.6z"/><path d="m9.2 3.8 3 3"/>'));
registerIcon("wave", S('<path d="M1.5 10.4c1.6 0 1.9-4.8 3.4-4.8s1.8 4.8 3.4 4.8 1.8-4.8 3.4-4.8 1.6 4.8 2.8 4.8"/>'));
registerIcon("folder-plus", S('<path d="M1.6 4.4a1 1 0 0 1 1-1h2.7l1.3 1.7h6.8a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.8a1 1 0 0 1-1-1z"/><path d="M8 7.6v3.6M6.2 9.4h3.6"/>'));
registerIcon("folder-minus", S('<path d="M1.6 4.4a1 1 0 0 1 1-1h2.7l1.3 1.7h6.8a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.8a1 1 0 0 1-1-1z"/><path d="M6.2 9.4h3.6"/>'));
registerIcon("collapse", S('<path d="M3 8h10"/>'));
registerIcon("expand", S('<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4"/><path d="M8 5.4v5.2M5.4 8h5.2"/>'));
registerIcon("plus", S('<path d="M8 2.8v10.4M2.8 8h10.4"/>'));
registerIcon("minus", S('<path d="M2.8 8h10.4"/>'));
registerIcon("maximize", S('<path d="M2.5 6V3a.5.5 0 0 1 .5-.5h3M10 2.5h3a.5.5 0 0 1 .5.5v3M13.5 10v3a.5.5 0 0 1-.5.5h-3M6 13.5H3a.5.5 0 0 1-.5-.5v-3"/>'));
registerIcon("restore", S('<path d="M6.2 2.5v3.7H2.5M9.8 13.5V9.8h3.7M13.5 6.2H9.8V2.5M2.5 9.8h3.7v3.7"/>'));
registerIcon("star", S('<path d="M8 2.2l1.75 3.55 3.9.55-2.8 2.75.65 3.9L8 11.1l-3.5 1.85.65-3.9-2.8-2.75 3.9-.55z"/>'));
registerIcon("star-filled", S('<path d="M8 2.2l1.75 3.55 3.9.55-2.8 2.75.65 3.9L8 11.1l-3.5 1.85.65-3.9-2.8-2.75 3.9-.55z"/>', 'fill="currentColor"'));
registerIcon("grip", S('<circle cx="6" cy="3.5" r="1"/><circle cx="10" cy="3.5" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12.5" r="1"/><circle cx="10" cy="12.5" r="1"/>', 'fill="currentColor" stroke="none"'));
registerIcon("kebab", S('<circle cx="8" cy="3.2" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="8" cy="12.8" r="1.2"/>', 'fill="currentColor" stroke="none"'));
registerIcon("burger", S('<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>'));
registerIcon("info", S('<path d="M8 7.4v4.4"/><circle cx="8" cy="4.6" r="0.9" fill="currentColor" stroke="none"/>'));
registerIcon("reset", S('<path d="M2 8a6 6 0 1 0 6-6 6.5 6.5 0 0 0-4.5 1.83L2 5.33"/><path d="M2 2v3.33h3.33"/>'));
registerIcon("pane-collapse", S('<path d="M2.6 9.4h4v4M13.4 6.6h-4v-4"/><path d="m9.4 6.6 4.2-4.2M2.4 13.6l4.2-4.2"/>'));
registerIcon("pane-expand", S('<path d="M9.8 2.4h3.8v3.8M6.2 13.6H2.4V9.8"/><path d="m13.6 2.4-4.4 4.4M2.4 13.6l4.4-4.4"/>'));
registerIcon("cursor", svg24('<path d="M5 3l6 16 2-6 6-2z"/>', 'fill="currentColor" stroke="none"'));
registerIcon(
  "ruler",
  svg24('<path d="M21.3 15.3 8.7 2.7a1 1 0 0 0-1.4 0L2.7 7.3a1 1 0 0 0 0 1.4l12.6 12.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/>')
);
registerIcon(
  "magnet",
  svg24('<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>')
);
registerIcon(
  "eraser",
  svg24('<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4L13 5a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L12 20"/><path d="M22 21H7"/><path d="m5 11 9 9"/>')
);
registerIcon(
  "pen-lock",
  svg24('<path d="M13.8 4.2a2.1 2.1 0 0 1 3 3L8.5 15.5l-3.5 1 1-3.5Z"/><rect x="13" y="14.5" width="8" height="6" rx="1.2"/><path d="M15 14.5v-1.6a2 2 0 0 1 4 0v1.6"/>')
);
registerIcon(
  "pen-sync",
  // Pen + two stacked panes — drawing onto every linked chart at once.
  svg24('<path d="M13.8 4.2a2.1 2.1 0 0 1 3 3L8.5 15.5l-3.5 1 1-3.5Z"/><rect x="12.5" y="13.5" width="6" height="4.8" rx="1"/><path d="M15.5 18.3v1a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.8a1 1 0 0 0-1-1h-1"/>')
);
registerIcon("brush", svg24('<path d="M9.5 12 17 4.5a2.12 2.12 0 0 1 3 3L12.5 15"/><path d="M7 14a3 3 0 0 0-3 3c0 1.3-1.2 1.5-1.5 2 .8.9 2 1.5 3.5 1.5a3.5 3.5 0 0 0 3.5-3.5 3 3 0 0 0-2.5-3Z"/>'));
registerIcon(
  "bucket",
  svg24('<path d="m18.5 11.5-7-7L4 12a1.8 1.8 0 0 0 0 2.5l5 5a1.8 1.8 0 0 0 2.5 0Z"/><path d="m5 5 4 4"/><path d="M3.5 13.5h13"/><path d="M21 17.5c0 1.1-.9 2-2 2s-2-.9-2-2c0-1 1.2-1.7 2-3 .8 1.3 2 2 2 3Z"/>')
);
registerIcon("type", svg24('<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9.5 19.5h5"/>'));
registerIcon("bold", svg24('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7Z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7Z"/>', 'stroke-width="2.4"'));
registerIcon("italic", svg24('<path d="M15 5h-5M14 19H9M14.5 5 10 19"/>', 'stroke-width="2.2"'));
registerIcon("price-delta", svg24('<path d="M12 4v16"/><path d="M8 8l4-4 4 4"/><path d="M8 16l4 4 4-4"/>'));
registerIcon("date-delta", svg24('<path d="M4 12h16"/><path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/>'));
registerIcon("bring-front", svg24('<rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/><path d="M4.5 10.5V6a1.5 1.5 0 0 1 1.5-1.5h4.5"/><path d="M19.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-4.5"/>'));
registerIcon(
  "send-back",
  svg24('<rect x="8.5" y="8.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity="0.35"/><path d="M4.5 10.5V6a1.5 1.5 0 0 1 1.5-1.5h4.5"/><path d="M19.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-4.5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/>')
);
registerIcon("r-squared", '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none"><text x="2.5" y="17.5" font-size="14" font-family="serif">R\xB2</text></svg>');
registerIcon("bands", svg24('<path d="M3 6h18"/><path d="M3 18h18"/><path d="M3 12h18" stroke-dasharray="3 3"/>'));
registerIcon("dedekind", svg24('<path d="M2 20h20"/><path d="M4 20a8 8 0 0 1 16 0"/><path d="M8 20a4 4 0 0 1 8 0"/><path d="M12 4v16"/>'));
registerIcon("sonic", svg24('<circle cx="15" cy="12" r="4"/><circle cx="12" cy="12" r="2.5"/><path d="M8 5v14"/>'));
registerIcon("supersonic", svg24('<circle cx="16" cy="12" r="3.5"/><path d="M6 12 15 6M6 12 15 18"/>'));

// src/core/color.ts
function parseRgb(color) {
  const s = color.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16)
    };
  }
  m = /^#([0-9a-f]{6})[0-9a-f]{0,2}$/i.exec(s);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
  if (rgb) {
    return { r: parseFloat(rgb[1]), g: parseFloat(rgb[2]), b: parseFloat(rgb[3]) };
  }
  return null;
}
function withAlpha(color, alpha) {
  const c = parseRgb(color);
  if (!c) return color;
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}
function mix(base, top, alpha) {
  const b = parseRgb(base);
  const t = parseRgb(top);
  if (!b || !t) return base;
  const c = (x, y) => Math.round(x + (y - x) * alpha);
  return `rgb(${c(b.r, t.r)},${c(b.g, t.g)},${c(b.b, t.b)})`;
}
function isDarkColor(color) {
  const c = parseRgb(color);
  if (!c) return true;
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 128;
}

// src/ui/styles.ts
function overlayScrollbarCss(selector, width = 8) {
  return `${selector}::-webkit-scrollbar{width:${width}px;height:${width}px;}${selector}::-webkit-scrollbar-thumb{background:var(--vela-scroll);border-radius:4px;border:2px solid transparent;background-clip:padding-box;}${selector}::-webkit-scrollbar-track{background:transparent;}${selector}::-webkit-scrollbar-button{display:none;width:0;height:0;}`;
}
var FIELD_FOCUS_CSS = "outline:none;transition:border-color .12s ease,box-shadow .12s ease;";
var FIELD_FOCUS_RING = "border-color:var(--vela-focus);box-shadow:0 0 0 3px var(--vela-focus-soft);";
function injectStyles(id, css, root = document) {
  if (typeof document === "undefined") return;
  const host = root instanceof Document ? root.head : root;
  if (root.getElementById?.(id) ?? host.querySelector(`#${CSS.escape(id)}`)) return;
  const s = document.createElement("style");
  s.id = id;
  s.textContent = css;
  host.appendChild(s);
}

// src/ui/icons.ts
function iconEl(id, doc = document) {
  const span = doc.createElement("span");
  span.className = "vela-icon";
  span.setAttribute("aria-hidden", "true");
  const svg = iconMarkup(id);
  if (svg) span.innerHTML = svg;
  return span;
}

export { ACCENT, ACCENT_BRIGHT, BEARISH, BULLISH, CATEGORICAL, CHIP_PLATE, CROSSHAIR, FIELD_FOCUS_CSS, FIELD_FOCUS_RING, HIGHLIGHT, INFO, INVALID, MARKER, NEUTRAL, SERIES_LINE, SESSION_OFF, SESSION_POST, SESSION_PRE, SLATE, SLATE_DEEP, TRADE_EXIT, TRADE_LONG, TRADE_SHORT, VALID, WARNING, categoricalColor, icon, iconAt, iconEl, iconMarkup, injectStyles, isDarkColor, mix, overlayScrollbarCss, registerIcon, svg16, svg24, svg24Solid, withAlpha };
