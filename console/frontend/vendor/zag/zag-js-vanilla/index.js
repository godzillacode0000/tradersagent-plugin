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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  VanillaMachine: () => import_machine.VanillaMachine,
  mergeProps: () => import_merge_props.mergeProps,
  normalizeProps: () => import_normalize_props.normalizeProps,
  spreadProps: () => import_spread_props.spreadProps,
  toStyleString: () => import_normalize_props.toStyleString
});
module.exports = __toCommonJS(index_exports);
var import_merge_props = require("./merge-props.js");
var import_normalize_props = require("./normalize-props.js");
var import_spread_props = require("./spread-props.js");
var import_machine = require("./machine.js");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VanillaMachine,
  mergeProps,
  normalizeProps,
  spreadProps,
  toStyleString
});
