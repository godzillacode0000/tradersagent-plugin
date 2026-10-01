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

// src/merge-machine-props.ts
var merge_machine_props_exports = {};
__export(merge_machine_props_exports, {
  mergeMachineProps: () => mergeMachineProps
});
module.exports = __toCommonJS(merge_machine_props_exports);
var import_utils = require("@zag-js/utils");
function mergeMachineProps(prev, next) {
  if (!(0, import_utils.isPlainObject)(prev) || !(0, import_utils.isPlainObject)(next)) {
    return next === void 0 ? prev : next;
  }
  const result = { ...prev };
  for (const key of Object.keys(next)) {
    const nextValue = next[key];
    const prevValue = prev[key];
    if (nextValue === void 0) {
      continue;
    }
    if ((0, import_utils.isPlainObject)(prevValue) && (0, import_utils.isPlainObject)(nextValue)) {
      result[key] = mergeMachineProps(prevValue, nextValue);
    } else {
      result[key] = nextValue;
    }
  }
  return result;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mergeMachineProps
});
