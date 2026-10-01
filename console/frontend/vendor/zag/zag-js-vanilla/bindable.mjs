import "./chunk-QZ7TP4HQ.mjs";

// src/bindable.ts
import { proxy } from "@zag-js/store";
import { isFunction } from "@zag-js/utils";
function bindable(props) {
  const initial = props().value ?? props().defaultValue;
  if (props().debug) {
    console.log(`[bindable > ${props().debug}] initial`, initial);
  }
  const eq = props().isEqual ?? Object.is;
  const store = proxy({ value: initial });
  const controlled = () => props().value !== void 0;
  return {
    initial,
    ref: store,
    get() {
      return controlled() ? props().value : store.value;
    },
    set(nextValue) {
      const prev = controlled() ? props().value : store.value;
      const next = isFunction(nextValue) ? nextValue(prev) : nextValue;
      if (props().debug) {
        console.log(`[bindable > ${props().debug}] setValue`, { next, prev });
      }
      if (!controlled()) store.value = next;
      if (!eq(next, prev)) {
        props().onChange?.(next, prev);
      }
    },
    invoke(nextValue, prevValue) {
      props().onChange?.(nextValue, prevValue);
    },
    hash(value) {
      return props().hash?.(value) ?? String(value);
    }
  };
}
bindable.cleanup = (_fn) => {
};
bindable.ref = (defaultValue) => {
  let value = defaultValue;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    }
  };
};
export {
  bindable
};
