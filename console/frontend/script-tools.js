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
  /* A timeframe as Pine spells it: "" (the chart's own), minutes as a number ("15", "240"), or a count and a unit
     ("1D", "4H", "3M", "30S"), or a bare unit ("D", "W", "M"). */
  const TIMEFRAME = /^(?:\d+[sSdDwWmMhH]?|[dDwWmM])?$/;

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
    if (t === 'timeframe') return TIMEFRAME.test(s.trim()) ? { ok: true, value: s.trim() } : { ok: false };
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

  /* ── inputs sent by the agent ─────────────────────────────────────────────────────────────────────
     The agent names an input the way the script does — by its label ("Length", "Show upper band") — and
     the engine wants its id (`in_0`). The pane's own values already go through coerce(); these go through
     the same door, with a stricter reading of what an agent may mean, and every refusal comes back with a
     reason and the names the script does have, so the agent can fix its call instead of guessing. */

  const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  const lower = (s) => norm(s).toLowerCase();

  /** One input, as the agent is told about it. */
  function inputSummary(meta) {
    const out = { name: meta.title || meta.name || meta.varId || meta.id, variable: meta.varId || null, id: meta.id,
                  type: meta.type, default: meta.defval };
    if (meta.group) out.group = meta.group;
    if (Number.isFinite(meta.minval)) out.min = meta.minval;
    if (Number.isFinite(meta.maxval)) out.max = meta.maxval;
    if (Number.isFinite(meta.step)) out.step = meta.step;
    if (Array.isArray(meta.options) && meta.options.length) out.options = meta.options.slice();
    if (meta.tooltip) out.tooltip = String(meta.tooltip);
    return out;
  }

  /** "Length (int, default 20, 2-200)" — one input in a sentence. */
  function describeInput(meta) {
    const bits = [meta.type, 'default ' + (typeof meta.defval === 'string' ? JSON.stringify(meta.defval) : String(meta.defval))];
    const lo = Number.isFinite(meta.minval);
    const hi = Number.isFinite(meta.maxval);
    if (lo && hi) bits.push(meta.minval + '-' + meta.maxval);
    else if (lo) bits.push('min ' + meta.minval);
    else if (hi) bits.push('max ' + meta.maxval);
    if (Array.isArray(meta.options) && meta.options.length) bits.push('one of ' + meta.options.join('/'));
    return (meta.title || meta.name || meta.varId || meta.id) + ' (' + bits.join(', ') + ')';
  }

  /** The input an agent's name refers to: exact label, then the label ignoring case and spacing, then the
   *  variable it is assigned to, then the engine's own id. -> { meta } | { ambiguous: [meta...] } | {} */
  function findInput(metas, name) {
    const want = norm(name);
    const tiers = [
      (m) => norm(m.title) === want,
      (m) => lower(m.title) === lower(want),
      (m) => (m.varId || '') === want,
      (m) => lower(m.varId) === lower(want),
      (m) => m.id === want,
    ];
    for (const test of tiers) {
      const hits = (metas || []).filter(test);
      if (hits.length === 1) return { meta: hits[0] };
      if (hits.length > 1) return { ambiguous: hits };
    }
    return {};
  }

  /** How many single-character edits turn `a` into `b` (insert, delete, change, swap neighbours). */
  function editDistance(a, b) {
    const x = lower(a);
    const y = lower(b);
    const d = [];
    for (let i = 0; i <= x.length; i++) { d[i] = [i]; }
    for (let j = 0; j <= y.length; j++) d[0][j] = j;
    for (let i = 1; i <= x.length; i++) {
      for (let j = 1; j <= y.length; j++) {
        const cost = x[i - 1] === y[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[x.length][y.length];
  }

  /** The label the agent most likely meant by a name that matched nothing — within a couple of edits (a
   *  transposition counts as one), or one that contains / is contained by it. null when nothing is close. */
  function nearestInput(metas, name) {
    const want = norm(name);
    if (want.length < 3) return null;
    let best = null;
    let bestScore = Infinity;
    for (const m of metas || []) {
      for (const cand of [m.title, m.varId]) {
        if (!cand) continue;
        const c = norm(cand);
        let score = editDistance(want, c);
        const near = lower(c).includes(lower(want)) || lower(want).includes(lower(c));
        if (near && Math.min(want.length, c.length) >= 4) score = Math.min(score, 1);
        if (score < bestScore) { bestScore = score; best = m; }
      }
    }
    return best && bestScore <= Math.max(1, Math.min(3, Math.floor(want.length / 4))) ? best : null;
  }

  /** Why a value cannot be used for this input, in a sentence the agent can act on. */
  function whyNot(meta, raw) {
    const t = meta.type;
    if (t === 'bool') return 'must be true or false';
    if (Array.isArray(meta.options) && meta.options.length) return 'must be one of: ' + meta.options.join(', ');
    if (NUMERIC.has(t) || t === 'time') return 'must be a number' + (t === 'int' ? ' (whole)' : '');
    if (t === 'color') return 'must be a colour like #2962FF or #2962FF80';
    if (t === 'timeframe') return 'must be a timeframe like 15, 60, 240, D, W or M (or empty for the chart\u2019s own)';
    return 'is not a usable value (' + JSON.stringify(raw) + ')';
  }

  const alphaOf = (meta) => { const d = String(meta.defval || ''); return d.length >= 9 ? d.slice(7, 9).toUpperCase() : 'FF'; };

  /** What the agent sent ({ "Length": 50, "Show upper band": false }) against the script's declarations.
   *  -> { overrides, keyed, applied, ignored, available }
   *     overrides  { in_N: value }         only what differs from a default — what the engine is given
   *     keyed      { inputKey: value }     the same, keyed for the pane's own store
   *     applied    [{ name, id, value, note? }]   everything that matched and was usable
   *     ignored    [{ name, reason }]      everything that did not, and why
   *     available  [inputSummary]          every input the script declares
   *  A null value puts the input back to its default. Nothing is guessed: a value that cannot be used is
   *  refused, never coerced into something else (a string "yes" is not a boolean here). */
  function resolveInputs(metas, given) {
    const out = { overrides: {}, keyed: {}, applied: [], ignored: [], available: (metas || []).map(inputSummary) };
    const seen = new Map();                 // engine id -> the name it was first set by
    for (const name of Object.keys(given || {})) {
      const found = findInput(metas, name);
      if (found.ambiguous) {
        out.ignored.push({ name, reason: found.ambiguous.length + ' inputs are called that — use the variable name (' +
          found.ambiguous.map((m) => m.varId || m.id).join(', ') + ') or the id (' + found.ambiguous.map((m) => m.id).join(', ') + ')' });
        continue;
      }
      if (!found.meta) {
        const near = nearestInput(metas, name);
        out.ignored.push({ name, reason: 'this script has no input called that' + (near ? ' \u2014 did you mean ' + JSON.stringify(near.title || near.name || near.varId) + '?' : '') });
        continue;
      }
      const meta = found.meta;
      if (seen.has(meta.id)) { out.ignored.push({ name, reason: 'is the same input as ' + JSON.stringify(seen.get(meta.id)) + ', which was already set' }); continue; }
      seen.set(meta.id, name);
      let raw = given[name];
      const entry = { name: meta.title || meta.name || name, id: meta.id };
      if (raw === null) { entry.value = meta.defval; entry.note = 'back to the default'; out.applied.push(entry); continue; }
      if (meta.type === 'bool') {
        const word = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
        if (word === true || word === 'true' || word === 1) raw = true;
        else if (word === false || word === 'false' || word === 0) raw = false;
        else { out.ignored.push({ name, reason: whyNot(meta, raw) }); continue; }
      }
      if (meta.type === 'color' && typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.trim())) raw = raw.trim() + alphaOf(meta);
      if (typeof raw === 'string' && NUMERIC.has(meta.type)) raw = raw.trim();
      if (typeof raw === 'object' || typeof raw === 'function') { out.ignored.push({ name, reason: whyNot(meta, raw) }); continue; }
      const c = coerce(meta, raw);
      if (!c.ok) { out.ignored.push({ name, reason: whyNot(meta, raw) }); continue; }
      entry.value = c.value;
      if (NUMERIC.has(meta.type) && Number(raw) !== c.value) {
        entry.note = (meta.type === 'int' && Number(raw) !== Math.round(Number(raw)) && Math.round(Number(raw)) === c.value)
          ? 'rounded from ' + Number(raw)
          : 'asked for ' + Number(raw) + ', limited to ' + c.value + ' by the input\'s own range';
      }
      out.applied.push(entry);
      if (!same(c.value, meta.defval)) { out.overrides[meta.id] = c.value; out.keyed[inputKey(meta)] = c.value; }
    }
    return out;
  }

  /** "Length=50, Show upper band=false" — what was applied, for a one-line reply. */
  function appliedLine(applied) {
    return (applied || []).map((a) => a.name + '=' + (typeof a.value === 'string' ? JSON.stringify(a.value) : String(a.value))).join(', ');
  }

  /** The agent's reply when something was not used: each reason, then what the script does have. */
  function ignoredLine(ignored, available) {
    if (!ignored || !ignored.length) return '';
    const names = (available || []).map((a) => a.name + ' (' + a.type + ', default ' + (typeof a.default === 'string' ? JSON.stringify(a.default) : a.default) + ')');
    return ignored.map((i) => JSON.stringify(i.name) + ': ' + i.reason).join('; ') +
      (names.length ? ' — this script has: ' + names.join(', ') : ' — this script declares no inputs');
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

  return { cleanMessage, codeOnly, locateError, inputKey, coerce, overridesFor, reconcile, groupInputs, declaredName, changedNote, restoreBreaks, diagnoseBreaks, inputSummary, describeInput, findInput, nearestInput, editDistance, resolveInputs, appliedLine, ignoredLine };
}));
