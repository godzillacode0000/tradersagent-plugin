import "./chunk-QZ7TP4HQ.mjs";

// src/merge-machine-props.ts
import { isPlainObject } from "@zag-js/utils";
function mergeMachineProps(prev, next) {
  if (!isPlainObject(prev) || !isPlainObject(next)) {
    return next === void 0 ? prev : next;
  }
  const result = { ...prev };
  for (const key of Object.keys(next)) {
    const nextValue = next[key];
    const prevValue = prev[key];
    if (nextValue === void 0) {
      continue;
    }
    if (isPlainObject(prevValue) && isPlainObject(nextValue)) {
      result[key] = mergeMachineProps(prevValue, nextValue);
    } else {
      result[key] = nextValue;
    }
  }
  return result;
}
export {
  mergeMachineProps
};
