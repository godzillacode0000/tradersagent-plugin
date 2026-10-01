import "./chunk-QZ7TP4HQ.mjs";

// src/normalize-props.ts
import { createNormalizer } from "@zag-js/types";
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
var normalizeProps = createNormalizer((props) => {
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
export {
  normalizeProps,
  propMap,
  toStyleString
};
