// src/replace-tracker.ts
function createReplaceTracker() {
  const newest = /* @__PURE__ */ new Map();
  return {
    claim(key) {
      const token = Symbol(key);
      newest.set(key, token);
      return token;
    },
    isReplaced(key, token) {
      return newest.get(key) !== token;
    }
  };
}
export {
  createReplaceTracker
};
