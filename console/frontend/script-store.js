/* The saved-scripts list, as pure decisions — no DOM, no storage — so every rule can be run under Node and
   pinned (test_script_store.py). script-library.js owns the view and localStorage; this file owns what a save,
   a rename, an open and a delete MEAN:

     * a script is { id, name, source, inputs, inputsFor, savedAt } — its code AND the settings values the
       operator chose for it ("Hull Butterfly, tight" and "…, loose" are one script with two sets of values);
     * the editor holds a WORKING COPY, attached to at most one saved script (`activeId`). Save overwrites the
       attached script only while the name is still its name; any other name is a NEW script, so a rename never
       silently replaces something and a script loaded from elsewhere never overwrites the one that was open;
     * nothing is ever lost on the way: the caller is told when the working copy has unsaved changes, and a
       store that cannot be read, or has odd entries, loads what is sound and drops the rest. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScriptStore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;
  const MAX_ITEMS = 50;
  const MAX_SOURCE = 400000;       // characters; the biggest LuxAlgo scripts are well under 100 000
  const MAX_NAME = 80;
  const DEFAULT_NAME = 'Untitled script';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const emptyStore = () => ({ v: VERSION, items: [], activeId: null });

  const normalizeSource = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n');

  /** A name as it is kept: spaces collapsed and trimmed, at most MAX_NAME characters. '' when nothing is left. */
  function cleanName(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  }

  /** Only flat { key: string | number | boolean } survives — the shape the pane's own store has. */
  function cleanInputs(o) {
    const out = {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof k === 'string' && k && ['string', 'number', 'boolean'].includes(typeof v) && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
    }
    return out;
  }

  function sameInputs(a, b) {
    const x = cleanInputs(a);
    const y = cleanInputs(b);
    const kx = Object.keys(x).sort();
    const ky = Object.keys(y).sort();
    return kx.length === ky.length && kx.every((k, i) => k === ky[i] && x[k] === y[k]);
  }

  /** What is read back from storage. Never throws: a broken blob is an empty list, a broken entry is skipped,
   *  and the list is cut to what the rest of the code allows. */
  function parse(raw) {
    const store = emptyStore();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (err) { data = null; }
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return store;
    const seen = new Set();
    for (const it of data.items) {
      if (!it || typeof it !== 'object') continue;
      const id = typeof it.id === 'string' && it.id ? it.id : '';
      const name = cleanName(it.name);
      const source = typeof it.source === 'string' ? normalizeSource(it.source) : null;
      if (!id || seen.has(id) || !name || source === null || source.length > MAX_SOURCE) continue;
      seen.add(id);
      store.items.push({
        id, name, source,
        inputs: cleanInputs(it.inputs),
        inputsFor: typeof it.inputsFor === 'string' ? it.inputsFor : '',
        savedAt: Number.isFinite(it.savedAt) ? it.savedAt : 0,
      });
      if (store.items.length >= MAX_ITEMS) break;
    }
    store.activeId = typeof data.activeId === 'string' && seen.has(data.activeId) ? data.activeId : null;
    return store;
  }

  const serialize = (store) => JSON.stringify({ v: VERSION, items: store.items, activeId: store.activeId });

  const indexOf = (store, id) => store.items.findIndex((i) => i.id === id);
  const find = (store, id) => store.items.find((i) => i.id === id) || null;
  const active = (store) => (store.activeId ? find(store, store.activeId) : null);

  /** `wanted`, or "wanted (2)", "(3)" … — the first one no OTHER script has (case-insensitive). */
  function uniqueName(items, wanted, exceptId) {
    const base = cleanName(wanted) || DEFAULT_NAME;
    const taken = new Set(items.filter((i) => i.id !== exceptId).map((i) => i.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; n < 1000; n++) {
      const tail = ' (' + n + ')';
      const candidate = base.slice(0, MAX_NAME - tail.length).trim() + tail;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return base;
  }

  const hasContent = (working) => normalizeSource(working && working.source).trim() !== '';

  /** Does the working copy differ from the saved script it is attached to? An unattached copy is never "dirty":
   *  it has nothing to differ from — see needsSaving for the question the Open / New prompt asks. */
  function isDirty(store, working) {
    const item = active(store);
    if (!item || !working) return false;
    return item.name !== (cleanName(working.name) || DEFAULT_NAME)
      || item.source !== normalizeSource(working.source)
      || !sameInputs(item.inputs, working.inputs);
  }

  /** Would opening another script (or starting a new one) throw something away? An attached copy with changes,
   *  or a copy with code that was never saved anywhere. */
  function needsSaving(store, working) {
    if (!working) return false;
    if (active(store)) return isDirty(store, working);
    return hasContent(working) && !store.items.some((i) => i.source === normalizeSource(working.source) && sameInputs(i.inputs, working.inputs));
  }

  function newId(now, rand) {
    const r = typeof rand === 'number' ? rand : Math.random();
    return 's' + Math.floor(now || Date.now()).toString(36) + Math.floor(r * 36 ** 4).toString(36).padStart(4, '0');
  }

  /** Save the working copy. -> { ok, store, item, created, nameChanged } or { ok: false, error }.
   *    default   overwrite the attached script while the name is still its name; otherwise a NEW script
   *    asNew     always a new script, named like the working copy with " (2)" when that is taken
   *  The name is made unique among the OTHER scripts, so nothing is ever replaced by accident; `nameChanged`
   *  carries the name actually used when it is not the one asked for. */
  function save(store, working, opts) {
    const o = opts || {};
    const now = o.now || Date.now();
    if (!working || !hasContent(working)) return { ok: false, error: 'There is nothing to save \u2014 the editor is empty.' };
    const source = normalizeSource(working.source);
    if (source.length > MAX_SOURCE) return { ok: false, error: 'This script is too long to save (' + source.length.toLocaleString('en-US') + ' characters; the limit is ' + MAX_SOURCE.toLocaleString('en-US') + ').' };
    const asked = cleanName(working.name) || DEFAULT_NAME;
    const attached = active(store);
    const overwrite = !o.asNew && attached && attached.name === asked;
    if (!overwrite && store.items.length >= MAX_ITEMS) {
      return { ok: false, error: MAX_ITEMS + ' scripts are saved already \u2014 delete one to save another.' };
    }
    const fields = { source, inputs: cleanInputs(working.inputs), inputsFor: typeof working.inputsFor === 'string' ? working.inputsFor : '', savedAt: now };
    const next = { v: VERSION, items: store.items.slice(), activeId: store.activeId };
    if (overwrite) {
      const i = indexOf(next, attached.id);
      next.items[i] = { ...attached, ...fields };
      return { ok: true, store: next, item: next.items[i], created: false, nameChanged: null };
    }
    const name = uniqueName(store.items, asked);
    const item = { id: o.id || newId(now), name, ...fields };
    next.items.push(item);
    next.activeId = item.id;
    return { ok: true, store: next, item, created: true, nameChanged: name !== asked ? name : null };
  }

  /** Rename a saved script. Refuses an empty name and one another script already has (an explicit rename that
   *  quietly became "Name (2)" would be a surprise). */
  function rename(store, id, name) {
    const i = indexOf(store, id);
    if (i < 0) return { ok: false, error: 'That script is gone.' };
    const clean = cleanName(name);
    if (!clean) return { ok: false, error: 'A script needs a name.' };
    if (store.items.some((it) => it.id !== id && it.name.toLowerCase() === clean.toLowerCase())) return { ok: false, error: 'Another script already has that name.' };
    const next = { v: VERSION, items: store.items.slice(), activeId: store.activeId };
    next.items[i] = { ...store.items[i], name: clean };
    return { ok: true, store: next, item: next.items[i] };
  }

  /** Delete one. If it was the attached one the working copy stays in the editor, attached to nothing. */
  function remove(store, id) {
    const i = indexOf(store, id);
    if (i < 0) return { store, removed: null };
    const next = { v: VERSION, items: store.items.filter((it) => it.id !== id), activeId: store.activeId === id ? null : store.activeId };
    return { store: next, removed: store.items[i] };
  }

  const setActive = (store, id) => ({ v: VERSION, items: store.items, activeId: id && find(store, id) ? id : null });

  /** Newest save first; the order the list shows. */
  const sorted = (store) => store.items.slice().sort((a, b) => (b.savedAt - a.savedAt) || a.name.localeCompare(b.name));

  /** "today", "yesterday", "3 Oct" — and the year once it is not this one. */
  function relativeWhen(ts, now) {
    const t = new Date(ts);
    const n = new Date(now == null ? Date.now() : now);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const day = (d) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    const diff = day(n) - day(t);
    if (diff === 0) return 'today';
    if (diff === 1) return 'yesterday';
    return t.getDate() + ' ' + MONTHS[t.getMonth()] + (t.getFullYear() !== n.getFullYear() ? ' ' + t.getFullYear() : '');
  }

  /** "124 lines · 2 inputs set · 3 Oct" — what a row says about a script beside its name. */
  function meta(item, now) {
    const lines = item.source ? item.source.split('\n').length : 0;
    const set = Object.keys(item.inputs || {}).length;
    const bits = [lines + (lines === 1 ? ' line' : ' lines')];
    if (set) bits.push(set + (set === 1 ? ' input set' : ' inputs set'));
    const when = relativeWhen(item.savedAt, now);
    if (when) bits.push(when);
    return bits.join(' · ');
  }

  return {
    VERSION, MAX_ITEMS, MAX_SOURCE, MAX_NAME, DEFAULT_NAME,
    emptyStore, parse, serialize, cleanName, cleanInputs, sameInputs, normalizeSource, find, active, uniqueName,
    hasContent, isDirty, needsSaving, newId, save, rename, remove, setActive, sorted, relativeWhen, meta,
  };
}));
