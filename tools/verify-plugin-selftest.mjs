#!/usr/bin/env node
// Regression pins for tools/verify-plugin.mjs — the crafted copies the audits used, kept as a test.
//
// The harness is the one thing that decides "is this plugin's import surface acceptable". Round 4
// and round 5 of the external audit each defeated it with a crafted copy (a regex literal before the
// evasion desynced the scanner; a comment tripped a false positive), and those defeats were only
// ever reproduced by hand. This file makes every shape permanent, in BOTH directions:
//
//   * an evasion MUST fail — a dynamic import on a path the render never runs, with the literal
//     written in each quoting/spacing shape JS allows, and behind each lexical trap (regex literal,
//     division, comment) that could desync the scan;
//   * a lookalike MUST pass — prose in a comment, prose inside a string, a regex pattern that spells
//     an import, a `.import(` method call — because a check that fails honest code is its own defect.
//
// Run: node tools/verify-plugin-selftest.mjs   (CI runs it right after the real-plugin check)

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.join(here, '..', 'plugin')
const realPlugin = path.join(pluginDir, 'plugin.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-plugin-selftest-'))

const runHarness = (entry) => {
  try {
    const out = execFileSync(process.execPath, [path.join(here, 'verify-plugin.mjs'), entry],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` }
  }
}

// `prepend` is one line put above the real plugin, exactly how the audits built their copies.
const CASES = [
  // ── evasions: each MUST fail, with the reason the harness intends ──
  { name: 'dynamic import on a never-run path', prepend: "const later = () => import('node:child_process')", fail: 'outside the allowed three' },
  { name: 'same, behind a quote-carrying regex literal', prepend: "const re = /['\"]/; const later = () => import('node:child_process')", fail: 'outside the allowed three' },
  { name: 'same, behind a `return /…/` regex', prepend: "function g() { return /['\"{}]/ } const f = () => import('node:child_process')", fail: 'outside the allowed three' },
  { name: 'same, after a division (regex must NOT be assumed)', prepend: "function d(a, b) { return a / b } const f = () => import('node:child_process')", fail: 'outside the allowed three' },
  { name: 'non-literal dynamic import', prepend: "const f = () => import('node:' + 'child_process')", fail: 'non-literal' },
  { name: 'absolute path import', prepend: "import ev from '/tmp/local-evil.mjs'", fail: 'outside the allowed three' },
  { name: 'file: URL import', prepend: "import ev from 'file:///tmp/local-evil.mjs'", fail: 'outside the allowed three' },
  { name: 'no-space import syntax', prepend: "import{readFileSync}from'node:fs'", fail: 'outside the allowed three' },
  { name: 'template-quoted dynamic import (executes)', prepend: 'const m = await import(`node:fs`)', fail: 'outside the allowed three' },

  // ── lookalikes: each MUST pass, or the check punishes honest code ──
  { name: 'comment prose mentioning import(docs)', prepend: '// see import(docs) for details' },
  { name: 'string prose mentioning an import call', prepend: 'const s = "call import(\'node:fs\') in docs"' },
  { name: 'a regex pattern that spells an import', prepend: "const re2 = /import\\('node:fs'\\)/" },
  { name: '.import( method call on an object', prepend: "const o = { import: (x) => x }; const z = o.import('node:fs')" },
  { name: 'allowed literal on a never-run path', prepend: "const f = () => import('react')" },
]

let failed = 0

// 0 — the real plugin passes its own harness.
{
  const r = runHarness(realPlugin)
  const ok = r.code === 0 && r.out.includes('OK —')
  console.log(`${ok ? '  ok  ' : '  FAIL'}  real plugin (must pass)`)
  if (!ok) { failed += 1; console.log(r.out.trim().split('\n').slice(0, 4).map((l) => `        ${l}`).join('\n')) }
}

// 1..n — crafted copies.
for (const c of CASES) {
  const dest = fs.mkdtempSync(path.join(tmp, 'case-'))
  fs.cpSync(pluginDir, dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'plugin.js'), `${c.prepend}\n${fs.readFileSync(realPlugin, 'utf8')}`)
  const r = runHarness(path.join(dest, 'plugin.js'))
  const expectedFail = Boolean(c.fail)
  const pass = expectedFail ? (r.code !== 0 && r.out.includes(c.fail)) : r.code === 0
  console.log(`${pass ? '  ok  ' : '  FAIL'}  ${c.name} (must ${expectedFail ? 'fail' : 'pass'})`)
  if (!pass) {
    failed += 1
    console.log(`        exit=${r.code} out=${r.out.trim().split('\n').slice(0, 3).join(' | ').slice(0, 200)}`)
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
if (failed) {
  console.error(`\nverify-plugin selftest: ${failed} case(s) wrong`)
  process.exit(1)
}
console.log('\nverify-plugin selftest: all cases behave as intended')
