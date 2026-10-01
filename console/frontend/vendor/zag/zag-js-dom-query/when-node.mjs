import "./chunk-QZ7TP4HQ.mjs";

// src/when-node.ts
import { raf } from "./raf.mjs";
function whenNode(nodeOrFn, fn, options = {}) {
  const { defer, onMissing } = options;
  const getNode = () => typeof nodeOrFn === "function" ? nodeOrFn() : nodeOrFn;
  const cleanups = [];
  const setup = (node) => {
    if (!node) return onMissing?.();
    cleanups.push(fn(node));
  };
  if (!defer) {
    setup(getNode());
  } else {
    let cancelled = false;
    cleanups.push(() => {
      cancelled = true;
    });
    queueMicrotask(() => {
      if (cancelled) return;
      const committed = getNode();
      if (committed) {
        setup(committed);
        return;
      }
      cleanups.push(
        raf(() => {
          if (cancelled) return;
          setup(getNode());
        })
      );
    });
  }
  return () => {
    cleanups.forEach((fn2) => fn2?.());
  };
}
export {
  whenNode
};
