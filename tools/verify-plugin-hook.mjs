// Loader hook used only by tools/verify-plugin.mjs. Registered via `module.register()` so Node's OWN
// parser decides what counts as an import — no regex can see every spacing/quoting/line-wrap shape a
// JS import can take, and round 4 of the audit proved it (four crafted copies evaded the regex; a
// fifth was a false positive on a comment). `resolve` sees exactly what the ESM loader resolves,
// whatever the source formatting, including every multi-line and differently-quoted static import.
//
// What this hook CANNOT see: a dynamic `import(expr)` whose argument is not a string literal, and any
// import on a code path the render never executes. Those stay out of scope for a static check; the
// harness's render pass (loading the module and calling register()) covers what actually runs.
let allowed = [];

export function initialize(data) {
  allowed = (data && data.allowed) || [];
}

export async function resolve(specifier, context, nextResolve) {
  // Skip Node's own loader bookkeeping and relative specifiers resolved from the allowed stubs
  // (react.mjs's own internal resolution, if any) — only bare package specifiers are the plugin's
  // own declared imports.
  const isBare = !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:');
  if (isBare && !allowed.includes(specifier)) {
    throw new Error(`imports outside the allowed three: ${specifier}`);
  }
  return nextResolve(specifier, context);
}
