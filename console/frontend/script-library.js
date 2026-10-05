/* The saved-scripts list: the view in the script pane that keeps a script's name, code and the settings values
   you chose for it on this machine (localStorage), so "Hull Butterfly, tight" and "…, loose" can be switched
   between without re-pasting. What each action MEANS lives in script-store.js (pure, run under Node); this file
   is the view and the storage. It talks to the pane only through window.scriptPane — working() / settled() /
   load() / setName() / setView() — and two events: `scriptpane:changed` (the editor, the name or a setting
   moved) and `scriptpane:loaded` (a script was put in the editor, by us or by another door: the Library's
   "Edit a copy", the agent).

   Rules the operator can rely on:
     * Save writes the script that is open — only while the name is still its name; any other name is a new
       script, and a name that is taken becomes "Name (2)". Nothing is replaced by accident.
     * Opening or starting another script never throws work away: when the editor has changes that are saved
       nowhere, the list asks first (Save and open / Discard and open / Cancel), in the list itself.
     * Ctrl/Cmd+S saves, Ctrl/Cmd+Shift+S saves a copy.
     * Everything the view writes goes through textContent — names are typed by the operator. */
(function () {
  'use strict';

  const S = window.ScriptStore;
  const KEY = 'luxalgo-web:scripts';
  const el = (id) => document.getElementById(id);
  const btn = el('script-lib-btn'), box = el('script-lib'), list = el('script-lib-list'), title = el('script-lib-title');
  const now = el('script-lib-now'), bar = el('script-lib-bar'), pane = el('view-script');
  const bNew = el('script-lib-new'), bCopy = el('script-lib-copy'), bSave = el('script-lib-save');
  if (!S || !btn || !box || !list || !pane) return;

  const sp = () => window.scriptPane || {};
  const say = (message, bad) => { try { if (typeof window.taToast === 'function') window.taToast(message, Boolean(bad)); } catch (err) { /* no toast on this page */ } };
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const quote = (name) => '“' + name + '”';

  const read = () => { try { return S.parse(localStorage.getItem(KEY)); } catch (err) { return S.emptyStore(); } };
  let store = read();
  let pending = null;          // { kind: 'open' | 'new' | 'revert', id } — waiting on the unsaved-changes answer
  let renaming = null;         // { id, error } — the row being renamed
  let deleting = null;         // id — the row asking "Delete?"
  let message = null;          // { text, kind } — a refusal worth keeping on screen

  /** Swap in a new store and write it. A write the browser refuses (storage full, blocked) puts the old one
   *  back and says so: a list that looks saved and is not is the one failure this view must not have. */
  function commit(next) {
    const before = store;
    store = next;
    try {
      localStorage.setItem(KEY, S.serialize(store));
      return null;
    } catch (err) {
      store = before;
      return 'This browser would not store it (its storage is full or blocked) — nothing was saved.';
    }
  }

  /** Take in what another tab saved before a change is worked out from this tab's copy: the `storage` event
   *  usually has, but a write made in the same instant would otherwise replace theirs with a stale list. The
   *  script this tab has open stays attached if it still exists. */
  function fresh() {
    const mine = store.activeId;
    store = S.setActive(read(), mine);
  }

  const isOpen = () => typeof sp().view === 'function' && sp().view() === 'scripts';
  const working = () => (typeof sp().working === 'function' ? sp().working() : null);

  /* ── the button's dot and the header ─────────────────────────────────────────────────────────── */
  let paintQueued = false;
  function paintSoon() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; paintDot(); if (isOpen()) paintHead(); });
  }
  function paintDot() {
    const w = working();
    const dirty = Boolean(w) && S.isDirty(store, w);
    if (dirty) btn.dataset.dirty = '1'; else delete btn.dataset.dirty;
    btn.title = dirty ? 'Saved scripts — this one has unsaved changes (Ctrl+S saves)' : 'Saved scripts (Ctrl+S saves this one)';
  }
  function paintHead() {
    const items = S.sorted(store);
    title.textContent = items.length ? items.length + (items.length === 1 ? ' saved script' : ' saved scripts') : 'Saved scripts';
    const w = working();
    const open = S.active(store);
    if (open && w) {
      const dirty = S.isDirty(store, w);
      now.textContent = 'Editing ' + quote(open.name) + (dirty ? ' · unsaved changes' : ' · saved');
      now.dataset.state = dirty ? 'dirty' : '';
    } else if (w && S.hasContent(w)) {
      now.textContent = 'This script is not saved yet';
      now.dataset.state = 'dirty';
    } else {
      now.textContent = '';
      now.dataset.state = '';
    }
    bCopy.hidden = !open;
  }

  /* ── the unsaved-changes question, and refusals ──────────────────────────────────────────────── */
  function paintBar() {
    bar.textContent = '';
    if (pending) {
      const open = S.active(store);
      const w = working();
      let ask;
      let yes;
      if (pending.kind === 'revert') {
        ask = 'Discard your changes to ' + quote(open ? open.name : 'this script') + ' and go back to the saved version?';
        yes = 'Discard changes';
      } else {
        ask = open && w && S.isDirty(store, w) ? 'Unsaved changes in ' + quote(open.name) + '.' : 'This script is not saved.';
        yes = null;
      }
      bar.appendChild(node('span', null, ask));
      if (pending.kind === 'revert') {
        const go = node('button', 'btn btn--ghost sv__btn sv__yes', yes);
        go.type = 'button';
        go.addEventListener('click', () => proceed());
        bar.appendChild(go);
      } else {
        const label = pending.kind === 'new' ? 'start new' : 'open';
        const save = node('button', 'btn btn--ghost sv__btn', 'Save and ' + label);
        save.type = 'button';
        save.addEventListener('click', async () => { const r = await saveWorking(false); if (r && r.ok) proceed(); });
        const drop = node('button', 'btn btn--ghost sv__btn', 'Discard and ' + label);
        drop.type = 'button';
        drop.addEventListener('click', () => proceed());
        bar.append(save, drop);
      }
      const keep = node('button', 'btn btn--ghost sv__btn', 'Cancel');
      keep.type = 'button';
      keep.addEventListener('click', () => { pending = null; render(); });
      bar.appendChild(keep);
      bar.dataset.kind = 'ask';
      bar.hidden = false;
      return;
    }
    if (message) {
      bar.appendChild(node('span', null, message.text));
      bar.dataset.kind = message.kind || 'error';
      bar.hidden = false;
      return;
    }
    bar.hidden = true;
  }

  /* ── the list ────────────────────────────────────────────────────────────────────────────────── */
  const icon = (paths) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.appendChild(p); }
    return svg;
  };
  const actButton = (label, paths, onClick) => {
    const b = node('button', 'sv__act');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(icon(paths));
    b.addEventListener('click', onClick);
    return b;
  };

  function row(item) {
    const li = node('li', 'sv__row');
    li.dataset.id = item.id;
    if (store.activeId === item.id) li.setAttribute('aria-current', 'true');
    if (renaming && renaming.id === item.id) {
      const input = node('input', 'sv__rename');
      input.type = 'text';
      input.value = item.name;
      input.maxLength = S.MAX_NAME;
      input.setAttribute('aria-label', 'New name for ' + item.name);
      let done = false;
      const finish = (accept) => {
        if (done) return;
        if (!accept) { done = true; renaming = null; render(); return; }
        fresh();
        const r = S.rename(store, item.id, input.value);
        if (!r.ok) { renaming.error = r.error; render(true); return; }
        done = true;
        const wasOpen = store.activeId === item.id;
        const w = working();
        const err = commit(r.store);
        renaming = null;
        if (err) { message = { text: err, kind: 'error' }; render(); return; }
        if (wasOpen && w && S.cleanName(w.name) === item.name && typeof sp().setName === 'function') sp().setName(r.item.name);
        render();
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur', () => { if (!renaming || !renaming.error) finish(Boolean(input.value.trim()) && input.value.trim() !== item.name); });
      li.appendChild(input);
      if (renaming.error) li.appendChild(node('div', 'sv__fix', renaming.error));
      queueMicrotask(() => { input.focus(); input.select(); });
      return li;
    }
    if (deleting === item.id) {
      li.appendChild(node('span', 'sv__ask', 'Delete ' + quote(item.name) + '? This can’t be undone.'));
      const yes = node('button', 'btn btn--ghost sv__btn sv__yes', 'Delete script');
      yes.type = 'button';
      yes.addEventListener('click', () => {
        fresh();
        const r = S.remove(store, item.id);
        const err = commit(r.store);
        deleting = null;
        if (err) message = { text: err, kind: 'error' }; else say('Deleted ' + quote(item.name));
        render();
      });
      const no = node('button', 'btn btn--ghost sv__btn', 'Keep');
      no.type = 'button';
      no.addEventListener('click', () => { deleting = null; render(); });
      li.append(yes, no);
      return li;
    }
    const open = node('button', 'sv__open');
    open.type = 'button';
    open.setAttribute('aria-label', 'Open ' + item.name);
    open.appendChild(node('span', 'sv__name', item.name));
    open.appendChild(node('span', 'sv__meta', S.meta(item)));
    open.addEventListener('click', () => requestOpen(item.id));
    li.append(open,
      actButton('Rename ' + item.name, ['M3 13h2.5L13 5.5 10.5 3 3 10.5V13z', 'M9 4.5L11.5 7'], () => { renaming = { id: item.id, error: null }; deleting = null; pending = null; render(); }),
      actButton('Delete ' + item.name, ['M3 4.5h10', 'M6.5 4.5V3h3v1.5', 'M4.5 4.5l.5 8.5h6l.5-8.5', 'M7 7v4M9 7v4'], () => { deleting = item.id; renaming = null; pending = null; render(); }));
    return li;
  }

  function render(keepFocus) {
    paintHead();
    paintDot();
    paintBar();
    const items = S.sorted(store);
    const hadFocus = keepFocus ? document.activeElement : null;
    list.textContent = '';
    if (!items.length) list.appendChild(node('li', 'sv__empty', 'Nothing saved yet. Save the script in the editor to keep its code and its settings here.'));
    for (const item of items) list.appendChild(row(item));
    if (hadFocus && hadFocus.isConnected) hadFocus.focus();
  }

  /* ── actions ─────────────────────────────────────────────────────────────────────────────────── */
  async function saveWorking(asNew) {
    if (typeof sp().settled !== 'function') return { ok: false };
    const w = await sp().settled();
    fresh();
    const r = S.save(store, w, { asNew });
    if (!r.ok) { message = { text: r.error, kind: 'error' }; render(); say(r.error, true); return r; }
    const err = commit(r.store);
    if (err) { message = { text: err, kind: 'error' }; render(); say(err, true); return { ok: false, error: err }; }
    message = null;
    if (typeof sp().setName === 'function' && S.cleanName(w.name) !== r.item.name) sp().setName(r.item.name);
    say('Saved ' + quote(r.item.name) + (r.nameChanged ? ' (that name was taken)' : ''));
    render();
    return r;
  }

  function proceed() {
    const p = pending;
    pending = null;
    if (!p) return;
    if (p.kind === 'new') startNew(); else openItem(p.id);
  }

  function openItem(id) {
    const item = S.find(store, id);
    if (!item || typeof sp().load !== 'function') return;
    message = null;
    sp().load({ source: item.source, name: item.name, inputs: item.inputs, inputsFor: item.inputsFor }, item.id);
    const ed = el('script-src');
    if (ed) ed.focus();
  }

  function startNew() {
    if (typeof sp().load !== 'function') return;
    message = null;
    sp().load({ source: '', name: S.DEFAULT_NAME, inputs: {} }, null);
    const ed = el('script-src');
    if (ed) ed.focus();
  }

  function requestOpen(id) {
    const w = working();
    deleting = null; renaming = null; message = null;
    if (store.activeId === id) {
      if (w && S.isDirty(store, w)) { pending = { kind: 'revert', id }; render(); return; }
      sp().setView('editor');
      return;
    }
    if (w && S.needsSaving(store, w)) { pending = { kind: 'open', id }; render(); return; }
    openItem(id);
  }

  function requestNew() {
    const w = working();
    deleting = null; renaming = null; message = null;
    if (w && S.needsSaving(store, w)) { pending = { kind: 'new', id: null }; render(); return; }
    startNew();
  }

  /* ── wiring ──────────────────────────────────────────────────────────────────────────────────── */
  btn.addEventListener('click', () => { if (typeof sp().setView === 'function') sp().setView(isOpen() ? 'editor' : 'scripts'); });
  bSave.addEventListener('click', () => saveWorking(false));
  bCopy.addEventListener('click', () => saveWorking(true));
  bNew.addEventListener('click', requestNew);

  /* Ctrl/Cmd+S saves, Ctrl/Cmd+Shift+S saves a copy — from anywhere in the pane, so the browser's own
     "save page" never opens over the editor. */
  pane.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 's' || ev.key === 'S')) {
      ev.preventDefault();
      saveWorking(ev.shiftKey && Boolean(S.active(store)));
    }
  });

  window.addEventListener('scriptpane:view', (ev) => {
    if (!ev.detail || ev.detail.view !== 'scripts') return;
    store = read();                                           // another console view may have saved since
    pending = null; renaming = null; deleting = null; message = null;
    render();
    const first = list.querySelector('.sv__open') || bSave;
    if (first) first.focus();
  });
  window.addEventListener('scriptpane:changed', paintSoon);
  window.addEventListener('scriptpane:loaded', (ev) => {
    const attach = ev.detail && ev.detail.attachId;
    const next = S.setActive(store, attach || null);
    if (next.activeId !== store.activeId) commit(next);
    paintSoon();
    if (isOpen()) render();
  });
  window.addEventListener('storage', (ev) => {
    if (ev.key !== KEY) return;
    store = read();
    paintSoon();
    if (isOpen()) render();
  });

  /* The editor is restored from its draft before this file runs; the dot should be right from the first frame. */
  paintSoon();
  window.scriptLibrary = { state: () => ({ count: store.items.length, activeId: store.activeId, names: S.sorted(store).map((i) => i.name) }) };
})();
