// Loader hook used only by tools/verify-plugin.mjs, registered via `module.register()` so Node's OWN
// resolver decides what the plugin imports — no regex guesses at JS syntax.
//
// Rule (round 5, issue 2): decide by the IMPORTER. Whatever the plugin entry imports must be one of
// the three stub URLs the harness rewrote its allowed specifiers to; a bare specifier, an absolute
// path, a `file:` URL or a relative path that is anything else is refused. Imports made by the stubs
// themselves are not the plugin's own and pass through.
//
// What this hook CANNOT see: an import on a code path the render never executes. The harness's
// source scan (literal AND non-literal `import()`, comments blanked) covers that.
let entryUrl = ''
let stubUrls = []
let allowed = []

const bare = (u) => String(u).split('?')[0].split('#')[0]

export function initialize(data) {
  entryUrl = bare((data && data.entryUrl) || '')
  stubUrls = ((data && data.stubUrls) || []).map(bare)
  allowed = (data && data.allowed) || []
}

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && bare(context.parentURL) === entryUrl) {
    if (!stubUrls.includes(bare(specifier))) {
      throw new Error(`imports outside the allowed three (${allowed.join(', ')}): ${specifier}`)
    }
  }
  return nextResolve(specifier, context)
}
