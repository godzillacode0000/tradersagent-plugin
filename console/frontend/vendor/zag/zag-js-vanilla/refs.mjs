import "./chunk-QZ7TP4HQ.mjs";

// src/refs.ts
function createRefs(refs) {
  const ref = { current: refs };
  return {
    get(key) {
      return ref.current[key];
    },
    set(key, value) {
      ref.current[key] = value;
    }
  };
}
export {
  createRefs
};
