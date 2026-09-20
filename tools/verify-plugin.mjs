#!/usr/bin/env node
/**
 * Stub-host harness for a Hermes Desktop plugin.
 *
 *   node verify-plugin.mjs /path/to/plugin.js
 *
 * Why: the app's loader isolates renderer errors, so a plugin that registers the wrong thing (or
 * nothing) simply never draws. This runs the plugin in plain Node against stubs of the only three
 * modules a plugin may import, records what register() contributed, and renders each contribution
 * the way React would.
 *
 * Prints one block per contribution with the rendered text. Exits non-zero when nothing registered,
 * when a contribution lacks an area/id/render, when the source contains a colour literal, or when the
 * plugin imports anything outside the allowed three.
 *
 * If it fails with "does not provide an export named X", the plugin wants an SDK symbol the stub
 * lacks — add it to the sdk stub below, having first confirmed it is a real export of
 * apps/desktop/src/sdk/ in the app tree.
 *
 * GENERIC vs PLUGIN-SPECIFIC: everything in this file must hold for EVERY plugin. Expectations that
 * name one plugin's areas or rendered strings belong in `plugin.expect.json` beside that plugin -
 * `{ "id": "x", "areas": ["sidebarNav"], "renders": [{ "area": "routes", "contains": ["..."] }] }`.
 * Hardcoding them here reports every OTHER plugin as broken, which reads as a real regression and
 * sends you debugging a healthy file.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const pluginPath = process.argv[2]
if (!pluginPath) {
  console.error('usage: verify-plugin.mjs <plugin.js>')
  process.exit(2)
}
const source = fs.readFileSync(pluginPath, 'utf8')
const failures = []

// ── only the three allowed specifiers resolve ────────────────────────────────
const ALLOWED = ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime']
const found = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
const foreign = found.filter((s) => !ALLOWED.includes(s))
if (foreign.length) failures.push(`imports outside the allowed three: ${[...new Set(foreign)].join(', ')}`)

const colour = source.match(/#[0-9a-fA-F]{3,8}\b/)
if (colour) failures.push(`hardcoded colour ${colour[0]} — use var(--ui-*) theme tokens`)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-verify-'))
const url = (f) => pathToFileURL(path.join(tmp, f)).href

fs.writeFileSync(path.join(tmp, 'react.mjs'), `
export const useEffect = () => {}
export const useLayoutEffect = () => {}
export const useState = (v) => [typeof v === 'function' ? v() : v, () => {}]
export const useMemo = (fn) => fn()
export const useRef = (v) => ({ current: v })
export const useCallback = (fn) => fn
export default { useEffect, useLayoutEffect, useState, useMemo, useRef, useCallback }
`)

fs.writeFileSync(path.join(tmp, 'jsx-runtime.mjs'), `
export const jsx = (type, props, key) => ({ type, props: props || {}, key })
export const jsxs = jsx
export const Fragment = Symbol.for('react.fragment')
export default { jsx, jsxs, Fragment }
`)

fs.writeFileSync(path.join(tmp, 'sdk.mjs'), `
const makeAtom = (initial) => {
  let value = initial
  const subs = new Set()
  return {
    get: () => value,
    set: (next) => { value = next; subs.forEach((fn) => fn(value)) },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) },
  }
}
export const atom = makeAtom
export const computed = (stores, fn) => ({
  get: () => fn(...(Array.isArray(stores) ? stores : [stores]).map((s) => (s && s.get ? s.get() : undefined))),
})
export const useValue = (store) => (store && store.get ? store.get() : undefined)
/* A pane API, so a plugin's pane-aware branches are actually exercised: paneVisibility(id) is read
   during render, and the harness flips the flag per render check (paneHidden: true). Default: the
   pane is on screen, which is the state a working install reports. */
export const host = {
  paneVisibility: (id) => makeAtom(globalThis.__hermesPaneVisible !== false),
  undismissPane: (id) => { globalThis.__hermesPaneCalls = (globalThis.__hermesPaneCalls || []).concat(['undismiss', id]) },
  revealPane: (id) => { globalThis.__hermesPaneCalls = (globalThis.__hermesPaneCalls || []).concat(['reveal', id]) },
  state: {},
  notify: (m) => console.log('      host.notify:', typeof m === 'string' ? m : JSON.stringify(m)),
  navigate: () => {}, onEvent: () => () => {}, logs: () => [], restartGateway: async () => {},
}
export const haptic = () => {}
export const Switch = (props) => ({ type: 'Switch', props })
export const PANES_AREA = 'panes'
export const ROUTES_AREA = 'routes'
export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' }
export const TITLEBAR_AREAS = { left: 'titleBar.left', center: 'titleBar.center', right: 'titleBar.right' }
export const PALETTE_AREA = 'palette'
export const KEYBINDS_AREA = 'keybinds'
export const THEMES_AREA = 'themes'
export const COMPOSER_AREAS = { left: 'composer.left', right: 'composer.right' }
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const TRANSCRIPT_DIRECTIVE_AREA = 'transcriptDirective'
export default { atom, computed, useValue, host, haptic, Switch, PANES_AREA, ROUTES_AREA,
  STATUSBAR_AREAS, TITLEBAR_AREAS, PALETTE_AREA, KEYBINDS_AREA, THEMES_AREA, COMPOSER_AREAS,
  SIDEBAR_NAV_AREA, TRANSCRIPT_DIRECTIVE_AREA }
`)

const rewritten = source
  .replace(/from\s+['"]react\/jsx-runtime['"]/g, `from '${url('jsx-runtime.mjs')}'`)
  .replace(/from\s+['"]react['"]/g, `from '${url('react.mjs')}'`)
  .replace(/from\s+['"]@hermes\/plugin-sdk['"]/g, `from '${url('sdk.mjs')}'`)

const entry = path.join(tmp, 'plugin.mjs')
fs.writeFileSync(entry, rewritten)

// ── register against a recording context ─────────────────────────────────────
const registrations = []
const ctx = {
  register: (c) => { registrations.push(c); return c },
  // registerMany is the documented way to register a page + its sidebar row + a palette command in
  // one call (the app's own Kanban plugin uses it). Without it here, a correct plugin reports
  // "contributed nothing" and the harness cries wolf.
  registerMany: (list) => { (list || []).forEach((c) => registrations.push(c)); return list },
  storage: { get: () => undefined, set: () => {}, delete: () => {} },
  os: {
    notify: () => {}, clipboard: { write: () => {} },
    openExternal: async () => true,
    writeClipboard: async () => true,
    revealPath: async () => true,
  },
  registerTool: () => {}, registerHook: () => {}, registerCommand: () => {},
  onDispose: () => {},
  llm: { complete: async () => '' },
}

let plugin
try {
  const mod = await import(`${pathToFileURL(entry).href}?t=${Date.now()}`)
  plugin = mod.default
} catch (err) {
  console.error('FAIL: plugin module did not load\n  ', err.message)
  process.exit(1)
}

console.log(`plugin manifest : id=${plugin?.id ?? '(none)'}  name=${plugin?.name ?? '(none)'}`)
if (!plugin || typeof plugin.register !== 'function') {
  console.error('FAIL: default export has no register(ctx)')
  process.exit(1)
}

try {
  plugin.register(ctx)
} catch (err) {
  console.error('FAIL: register(ctx) threw\n  ', err.message)
  process.exit(1)
}

if (!registrations.length) failures.push('register()/registerMany() contributed nothing')

// ── render each contribution the way React does ──────────────────────────────
const text = (node) => {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node === 'object') {
    if (typeof node.type === 'function') return text(node.type(node.props || {}))
    return text(node.props?.children)
  }
  return ''
}

console.log(`\n${registrations.length} contribution(s):`)
for (const reg of registrations) {
  const where = reg?.area ?? '(no area)'
  console.log(`  • area=${JSON.stringify(where)} id=${reg?.id ?? '(none)'} order=${reg?.order ?? '-'}`)
  if (!reg?.area || !reg?.id) failures.push(`contribution ${reg?.id ?? '(unnamed)'} is missing area or id`)
  // Data-only areas carry a payload instead of a component: nav rows are
  // {codicon,label,path} (app: apps/desktop/src/app/routes.ts:118-124) and
  // status/title-bar items are plain descriptors. Only component areas must
  // supply render() or an actionable data.run — demanding one of them from a
  // nav row reported every correct plugin as broken.
  const DATA_ONLY_AREAS = new Set(['sidebar.nav', 'keybinds', 'themes', 'transcriptDirective', 'layouts'])
  const isDataOnly = (r) =>
    DATA_ONLY_AREAS.has(r?.area) || /^(statusBar|titleBar|composer)\./.test(r?.area ?? '')
  if (typeof reg?.render !== 'function') {
    if (!reg?.data?.run && !isDataOnly(reg)) {
      failures.push(`contribution ${reg?.id ?? '(unnamed)'} has no render() and no data.run`)
    }
    continue
  }
  try {
    const rendered = text({ type: reg.render, props: {} })
    console.log(`      renders: ${rendered.slice(0, 200) || '(empty)'}`)
  } catch (err) {
    failures.push(`${reg.id} render() threw: ${err.message}`)
  }
}

// ── this plugin's own expectations, if it declares any ───────────────────────
const expectPath = path.join(path.dirname(path.resolve(pluginPath)), 'plugin.expect.json')
if (fs.existsSync(expectPath)) {
  const expected = JSON.parse(fs.readFileSync(expectPath, 'utf8'))
  if (expected.id && plugin.id !== expected.id) {
    failures.push(`id ${plugin.id} does not match plugin.expect.json (${expected.id})`)
  }
  for (const area of expected.areas || []) {
    if (!registrations.some((r) => r.area === area)) failures.push(`expected area ${area} was not registered`)
  }
  for (const want of expected.renders || []) {
    /* A check may state the pane state it is about: `paneHidden: true` renders with a pane API that
       reports the pane as not on screen, which is the branch that decides whether the operator sees a
       chart or an explanation. Anything else renders with the pane visible. */
    globalThis.__hermesPaneVisible = want.paneHidden !== true
    const reg = registrations.find((r) => r.area === want.area)
    if (!reg || typeof reg.render !== 'function') {
      failures.push(`expected a render on area ${want.area}`)
      continue
    }
    const rendered = text({ type: reg.render, props: {} })
    for (const needle of want.contains || []) {
      if (!rendered.includes(needle)) failures.push(`area ${want.area} does not render "${needle}"`)
    }
  }
  console.log(`\nchecked plugin.expect.json: ${expected.areas?.length ?? 0} area(s), ${expected.renders?.length ?? 0} render check(s)`)
} else {
  console.log('\n(no plugin.expect.json beside the plugin - generic contract only)')
}

console.log('')
if (failures.length) {
  console.error('FAIL')
  for (const f of failures) console.error('  -', f)
  process.exit(1)
}
console.log('OK — registrations and renders look sane. Enabling it in the app is a separate step.')

// Exit deterministically. Falling off the end is not enough: a plugin's own
// setInterval (a live chip, a ticking clock) keeps Node alive forever, so the
// process never returns and a caller reading the exit code sees a killed
// process (124 under `timeout`) instead of a pass. Exit codes are how
// check-all.sh and CI decide, so the verdict must own the exit.
process.exit(0)
