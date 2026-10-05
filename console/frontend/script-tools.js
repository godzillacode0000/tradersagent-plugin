/* Pure helpers for the script pane — no DOM, no engine — so each rule can be run under Node and pinned
   (test_script_tools.py). The pane (app.js) owns the elements; this file owns the decisions:

     * where in the source an error is (the engine quotes `at 3:7` for a syntax error; a runtime error
       names only a variable or a function, and the first line that uses that name is the best honest guess);
     * which of a script's `input.*()` values the operator changed, and what to hand the engine for them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScriptTools = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── errors ─────────────────────────────────────────────────────────────────────────────────── */

  /** The engine's own words, without the plumbing: "Failed to transpile Pine Script version 6: Unexpected
   *  character '@' at 3:7" -> "Unexpected character '@'". The position is shown on its own. */
  function cleanMessage(msg) {
    return String(msg == null ? '' : msg)
      .replace(/^PineTS error:\s*/i, '')
      .replace(/^Failed to transpile Pine Script version \d+:\s*/i, '')
      .replace(/\s+at \d+:\d+\s*$/, '')
      .trim();
  }

  const lineOf = (text) => String(text).split('\n');

  /** A line with its `//` comment and its string literals taken out, so a name inside either never matches. */
  function codeOnly(line) {
    return String(line)
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
      .replace(/\/\/.*$/, '');
  }

  /** Where the failure is. `error` is the runner's classified error ({ code, message, line, col, method }) or
   *  a bare message. -> { line, col, approx } with 1-based numbers, or null when nothing can be said.
   *  `approx` is true when the position is a guess: the first line that uses the name the error complains
   *  about. A guess is always labelled as one. */
  function locateError(source, error) {
    const err = typeof error === 'string' ? { message: error } : (error || {});
    const text = String(err.message || '');
    const rows = lineOf(source);
    const clamp = (n) => Math.min(Math.max(1, n), Math.max(1, rows.length));

    let m = text.match(/\bat (\d+):(\d+)\b/);
    if (m) return { line: clamp(Number(m[1])), col: Number(m[2]), approx: false };
    if (Number.isFinite(err.line) && err.line > 0) {
      return { line: clamp(err.line), col: Number.isFinite(err.col) ? err.col : null, approx: false };
    }

    m = text.match(/^(?:PineTS error:\s*)?([A-Za-z_$][\w$.]*) is not (?:defined|a function)/);
    const name = (m && m[1]) || (err.method ? String(err.method) : '');
    if (!name) return null;
    const re = new RegExp('(^|[^\\w.$])(' + name.replace(/[.$]/g, '\\$&') + ')(?![\\w$])');
    for (let i = 0; i < rows.length; i++) {
      const hit = re.exec(codeOnly(rows[i]));
      if (hit) return { line: i + 1, col: hit.index + hit[1].length + 1, approx: true };
    }
    return null;
  }

  /* ── inputs ─────────────────────────────────────────────────────────────────────────────────── */

  /** A stable handle for one input across edits. The engine's ids (`in_0`, `in_1`) are positions, so adding
   *  an input above shifts them all; the variable it is assigned to, its label and its type do not move. */
  function inputKey(meta) {
    return [meta.varId || '', meta.title || meta.name || '', meta.type || ''].join('|');
  }

  const NUMERIC = new Set(['int', 'float', 'price']);

  /** The operator's raw value -> what the engine should get, or { ok:false } when it is not usable (the
   *  caller then falls back to the default). Numbers are clamped to the input's own min / max and an
   *  integer is rounded; a choice must be one of its options. */
  function coerce(meta, raw) {
    const t = meta.type;
    if (t === 'bool') return { ok: true, value: raw === true || raw === 'true' || raw === 1 };
    if (NUMERIC.has(t) || t === 'time') {
      if (raw === '' || raw == null) return { ok: false };
      let n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false };
      if (t === 'int') n = Math.round(n);
      if (Number.isFinite(meta.minval)) n = Math.max(meta.minval, n);
      if (Number.isFinite(meta.maxval)) n = Math.min(meta.maxval, n);
      if (Array.isArray(meta.options) && meta.options.length && !meta.options.includes(n)) return { ok: false };
      return { ok: true, value: n };
    }
    if (raw == null) return { ok: false };
    const s = String(raw);
    if (t === 'color') return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s) ? { ok: true, value: s.toUpperCase() } : { ok: false };
    if (Array.isArray(meta.options) && meta.options.length && !meta.options.includes(s)) return { ok: false };
    return { ok: true, value: s };
  }

  const same = (a, b) => (typeof a === 'string' && typeof b === 'string') ? a.toUpperCase() === b.toUpperCase() : a === b;

  /** The inputs the operator has changed, as the engine takes them: { [meta.id]: value }. `store` maps
   *  inputKey -> raw value; anything equal to the default, or not usable, is left out — so an untouched
   *  script runs exactly as it always did. */
  function overridesFor(metas, store) {
    const out = {};
    for (const meta of metas || []) {
      const key = inputKey(meta);
      if (!store || !Object.prototype.hasOwnProperty.call(store, key)) continue;
      const c = coerce(meta, store[key]);
      if (c.ok && !same(c.value, meta.defval)) out[meta.id] = c.value;
    }
    return out;
  }

  /** After the source changes: keep the values whose input is still there (same variable, label and type),
   *  drop the rest, and drop what has become equal to a default. */
  function reconcile(metas, store) {
    const out = {};
    for (const meta of metas || []) {
      const key = inputKey(meta);
      if (!store || !Object.prototype.hasOwnProperty.call(store, key)) continue;
      const c = coerce(meta, store[key]);
      if (c.ok && !same(c.value, meta.defval)) out[key] = c.value;
    }
    return out;
  }

  /** Inputs in the order the script declares them, grouped by their `group` (first appearance); inputs with
   *  no group share one called "Inputs". */
  function groupInputs(metas) {
    const order = [];
    const byName = new Map();
    for (const meta of metas || []) {
      const name = meta.group ? String(meta.group) : 'Inputs';
      if (!byName.has(name)) { byName.set(name, []); order.push(name); }
      byName.get(name).push(meta);
    }
    return order.map((name) => ({ name, items: byName.get(name) }));
  }

  /** The title a script declares for itself: indicator('Smart Money Concepts', …). Changed values belong to
   *  that script — a different script that happens to have an input called "Length" must not inherit them. */
  function declaredName(source) {
    const m = String(source || '').replace(/\/\/[^\n]*/g, '').match(/\b(?:indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?(['"])((?:(?!\1).)*)\1/);
    return m ? m[2].trim() : '';
  }

  /** "2 inputs changed" — the run list says which kind of run it was. */
  function changedNote(count) {
    return count > 0 ? count + (count === 1 ? ' input' : ' inputs') + ' changed' : '';
  }

  /* ── a script that lost its line breaks ───────────────────────────────────────────────────────────
     A script pasted from somewhere that ate the newlines (or sent with a literal "\n") is ONE line, and in
     Pine the first `//` then comments out everything after it: Run draws nothing and says nothing. */

  /** Put back breaks that arrived as the two characters backslash-n (and \r\n, \t) — but only where Pine
   *  cannot have meant them: outside a string literal, which keeps its escapes as written. A `//` comment ends
   *  at the first one (that is what the line break was), so a quote mark inside a comment cannot swallow the
   *  rest. -> { text, count }, count = how many breaks were restored. */
  function restoreBreaks(source) {
    const s = String(source == null ? '' : source);
    let out = '';
    let count = 0;
    let quote = null;
    let comment = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      const n = s[i + 1];
      if (quote) {
        out += c;
        if (c === '\\' && n !== undefined) { out += n; i++; }
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '\\' && n === 'r' && s[i + 2] === '\\' && s[i + 3] === 'n') { out += '\n'; count++; comment = false; i += 3; continue; }
      if (c === '\\' && n === 'n') { out += '\n'; count++; comment = false; i++; continue; }
      if (c === '\\' && n === 't') { out += '\t'; i++; continue; }
      if (comment) { out += c; continue; }
      if (c === '/' && n === '/') comment = true;
      else if (c === '"' || c === "'") quote = c;
      out += c;
    }
    return { text: out, count };
  }

  /** Is this source a script that lost its line breaks? -> { kind: 'escaped', fixed } when the breaks are
   *  there as backslash-n and can be put back; { kind: 'swallowed' } when it is one real line whose first
   *  `//` hides the rest; { kind: null } otherwise. Anything with a real line break is left alone. */
  function diagnoseBreaks(source) {
    const src = String(source == null ? '' : source);
    if (!src.trim() || src.includes('\n')) return { kind: null };
    const r = restoreBreaks(src);
    if (r.count > 0) return { kind: 'escaped', fixed: r.text };
    const head = src.trimStart();
    if (src.length > 80 && head.startsWith('//') && /\/\/\s*@version|\b(?:indicator|strategy|library)\s*\(/.test(head.slice(2))) {
      return { kind: 'swallowed' };
    }
    return { kind: null };
  }

  return { cleanMessage, codeOnly, locateError, inputKey, coerce, overridesFor, reconcile, groupInputs, declaredName, changedNote, restoreBreaks, diagnoseBreaks };
}));
