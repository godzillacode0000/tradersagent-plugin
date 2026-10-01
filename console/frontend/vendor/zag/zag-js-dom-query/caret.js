"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/caret.ts
var caret_exports = {};
__export(caret_exports, {
  getCaretPosition: () => getCaretPosition,
  isCaretAtStart: () => isCaretAtStart,
  setCaretToEnd: () => setCaretToEnd
});
module.exports = __toCommonJS(caret_exports);
var import_computed_style = require("./computed-style.js");
var import_platform = require("./platform.js");
var MIRROR_PROPERTIES = [
  "direction",
  "box-sizing",
  "width",
  "height",
  "overflow-x",
  "overflow-y",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-style",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "font-size-adjust",
  "line-height",
  "font-family",
  "text-align",
  "text-transform",
  "text-indent",
  "text-decoration",
  "letter-spacing",
  "word-spacing",
  "tab-size",
  "-moz-tab-size"
];
function getInputLineHeight(computed) {
  if (computed.boxSizing !== "border-box") return computed.height;
  const height = parseFloat(computed.height);
  const outerHeight = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom) + parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth);
  const targetHeight = outerHeight + parseFloat(computed.lineHeight);
  if (Number.isNaN(targetHeight)) return computed.height;
  if (height > targetHeight) return `${height - outerHeight}px`;
  if (height === targetHeight) return computed.lineHeight;
  return "0";
}
function getMirrorStyle(element, computed, isInput) {
  const style = [];
  for (const prop of MIRROR_PROPERTIES) {
    const value = isInput && prop === "line-height" ? getInputLineHeight(computed) : computed.getPropertyValue(prop);
    style.push(`${prop}:${value}`);
  }
  style.push("position:absolute", "visibility:hidden", "white-space:pre-wrap");
  if (!isInput) style.push("word-wrap:break-word");
  if ((0, import_platform.isFirefox)()) {
    if (element.scrollHeight > parseFloat(computed.height)) style.push("overflow-y:scroll");
  } else {
    style.push("overflow:hidden");
  }
  return style.join(";");
}
var mirrorCache = /* @__PURE__ */ new WeakMap();
function getMirrorEntry(doc) {
  let entry = mirrorCache.get(doc);
  if (!entry) {
    const mirror = doc.createElement("div");
    const textNode = doc.createTextNode("");
    const marker = doc.createElement("span");
    mirror.append(textNode, marker);
    entry = { mirror, textNode, marker };
    mirrorCache.set(doc, entry);
  }
  return entry;
}
function getCaretPosition(element, options = {}) {
  const { position = element.selectionStart ?? element.value.length } = options;
  const doc = element.ownerDocument;
  const computed = (0, import_computed_style.getComputedStyle)(element);
  const isInput = element.localName === "input";
  const { mirror, textNode, marker } = getMirrorEntry(doc);
  mirror.style.cssText = getMirrorStyle(element, computed, isInput);
  let textBeforeCaret = element.value.substring(0, position);
  if (isInput) textBeforeCaret = textBeforeCaret.replace(/\s/g, "\xA0");
  textNode.data = textBeforeCaret;
  marker.textContent = element.value.substring(position) || ".";
  doc.body.appendChild(mirror);
  const top = marker.offsetTop + parseFloat(computed.borderTopWidth) - element.scrollTop;
  const left = marker.offsetLeft + parseFloat(computed.borderLeftWidth) - element.scrollLeft;
  const height = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.2;
  mirror.remove();
  textNode.data = "";
  marker.textContent = "";
  return { top, left, height };
}
function isCaretAtStart(input) {
  if (!input) return false;
  try {
    return input.selectionStart === 0 && input.selectionEnd === 0;
  } catch {
    return input.value === "";
  }
}
function setCaretToEnd(input) {
  if (!input) return;
  try {
    if (input.ownerDocument.activeElement !== input) return;
    const len = input.value.length;
    input.setSelectionRange(len, len);
  } catch {
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getCaretPosition,
  isCaretAtStart,
  setCaretToEnd
});
