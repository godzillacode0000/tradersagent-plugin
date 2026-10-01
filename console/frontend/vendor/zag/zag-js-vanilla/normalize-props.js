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

// src/normalize-props.ts
var normalize_props_exports = {};
__export(normalize_props_exports, {
  normalizeProps: () => normalizeProps,
  propMap: () => propMap,
  toStyleString: () => toStyleString
});
module.exports = __toCommonJS(normalize_props_exports);
var import_types = require("@zag-js/types");
var propMap = {
  onFocus: "onFocusin",
  onBlur: "onFocusout",
  onChange: "onInput",
  onDoubleClick: "onDblclick",
  htmlFor: "for",
  className: "class",
  defaultValue: "value",
  defaultChecked: "checked"
};
var caseSensitiveSvgAttrs = /* @__PURE__ */ new Set(["viewBox", "preserveAspectRatio"]);
var toStyleString = (style) => {
  let string = "";
  for (let key in style) {
    const value = style[key];
    if (value === null || value === void 0) continue;
    if (!key.startsWith("--")) key = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    string += `${key}:${value};`;
  }
  return string;
};
var normalizeProps = (0, import_types.createNormalizer)((props) => {
  return Object.entries(props).reduce((acc, [key, value]) => {
    if (value === void 0) return acc;
    if (key in propMap) {
      key = propMap[key];
    }
    const normalizedKey = caseSensitiveSvgAttrs.has(key) ? key : key.toLowerCase();
    acc[normalizedKey] = value;
    return acc;
  }, {});
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  normalizeProps,
  propMap,
  toStyleString
});
