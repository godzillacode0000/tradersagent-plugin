/* The ☰ drawer — every LuxAlgo Library script one click from the chart (3 Oct).
 *
 * The operator: "chart area tu dekat atas ada hamburger menu or something untuk click". The drawer
 * slides in from the left OVER the chart (transform + opacity only: the box is a 2016 Pavilion), so
 * opening it never resizes Vela. It reuses what app.js already owns — the one-call catalogue
 * (`loadCatalogue`/`indState.cat`), the favourites list (`toggleFavourite`), the preview cache
 * (`thumbUrl`) — and Run goes through `window.TraderRun`, the one landasan every door ends in, so a
 * run from here is remembered across a reload like any other.
 *
 * One study at a time: Run clears what OUR layer painted before the new script lands.
 * Loaded after app.js (classic script), so app.js's top-level names are in scope.
 */
(function () {
  'use strict';

  const SLICE = 60;                       /* rows painted at once; search still sees all 800 */
  const st = {
    open: false, q: '', family: '', shown: SLICE, focus: -1,
    detail: false,                        /* the drawer's second view: the picked result (3 Oct) */
    busy: '',                             /* slug currently running */
    result: {},                           /* slug → {ok, text} of its last run here */
  };

  const $id = (id) => document.getElementById(id);
  const drawer = $id('lib-drawer');
  const scrim = $id('drawer-scrim');
  const fallback = $id('drawer-fallback');   /* bare-chart only; Vela's own Indicators button is the door */
  const box = $id('drawer-q');
  const fams = $id('drawer-fams');
  const list = $id('drawer-list');
  const detailBox = $id('drawer-detail');
  const back = $id('drawer-detail-back');
  const count = $id('drawer-count');
  if (!drawer) return;

  /* Name hits first: "order block" must lead with the scripts CALLED that, not the ones whose
     write-up merely mentions it. */
  function score(r, q) {
    const name = (r.name || '').toLowerCase();
    if (name.includes(q)) return name.startsWith(q) ? 0 : 1;
    if (r.slug.includes(q.replace(/\s+/g, '-'))) return 2;
    if (((r.family || '') + ' ' + (r.cluster || '')).toLowerCase().includes(q)) return 3;
    return 4;
  }

  function matches(r, q) {
    if (!q) return true;
    return ((r.name || '') + ' ' + r.slug + ' ' + (r.family || '') + ' ' + (r.cluster || '') + ' '
      + (r.description || '')).toLowerCase().includes(q);
  }

  /* BUILT-INS: Vela's own studies for this market, read from the frame. Shaped like a catalogue row so
     one list paints both halves; `__native` marks the ones that mount through mountNative(). */
  function nativeRows() {
    return (indState.natives || []).map((n) => ({
      slug: n.type, name: n.title, family: '__builtin', cluster: n.supported === false ? 'not supported here' : (n.present ? 'on chart' : ''),
      __native: true, present: n.present, supported: n.supported !== false,
    }));
  }

  function rows() {
    const q = st.q.trim().toLowerCase();
    if (st.family === '__builtin') {
      return nativeRows().filter((r) => !q || (r.name + ' ' + r.slug).toLowerCase().includes(q));
    }
    const all = (indState.cat.rows || []);
    return all.filter((r) => {
      if (st.family === '__fav') { if (!isFavourite('library', r.slug)) return false; }
      else if (st.family && (r.family || 'unfiled') !== st.family) return false;
      return matches(r, q);
    }).map((r, i) => ({ r, i, s: q ? score(r, q) : 0 }))
      .sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.r);
  }

  function famLabel(key) {
    const g = (indState.cat.groups || []).find((x) => x.key === key);
    return g ? g.name : key;
  }

  function paintFamilies() {
    const groups = indState.cat.groups || [];
    const q = st.q.trim().toLowerCase();
    const hits = (indState.cat.rows || []).filter((r) => matches(r, q));
    const n = (key) => hits.filter((r) => (r.family || 'unfiled') === key).length;
    const favN = hits.filter((r) => isFavourite('library', r.slug)).length;
    const chip = (key, label, n) => `<button type="button" class="dchip${st.family === key ? ' is-on' : ''}"
        data-fam="${esc(key)}" aria-pressed="${st.family === key}">${esc(label)}<span>${n}</span></button>`;
    /* Counts follow the search; a family with no hit steps aside unless it is the one picked. */
    fams.innerHTML = chip('', 'All', hits.length)
      + chip('__builtin', 'Built-ins', (indState.natives || []).length)
      + chip('__fav', '★ Favourites', favN)
      + groups.filter((g) => !q || n(g.key) > 0 || st.family === g.key)
        .map((g) => chip(g.key, g.name, q ? n(g.key) : g.count)).join('');
    markMore();
  }

  /* What is on the chart, by name — the landasan's own list. The row that matches says so and its
     button reads Remove (the doc's §2a: "so no separate strip is needed"). */
  function onNames() {
    const names = (window.TraderRun && window.TraderRun.list) ? window.TraderRun.list() : [];
    return names.map((n) => String(n).trim().toLowerCase());
  }

  const ti = () => window.taIndicators || {};
  const toneOf = (key) => (ti().tone ? ti().tone(key) : 'var(--lx-fg-muted)');
  const mark = (text) => (ti().highlight ? ti().highlight(text, st.q) : esc(text));

  function rowHtml(r, i, on) {
    const starred = !r.__native && isFavourite('library', r.slug);
    const res = st.result[r.slug];
    const running = st.busy === r.slug;
    const isOn = !r.__native && on.includes(String(r.name || r.slug).trim().toLowerCase());
    /* The family is a coloured tag (the same hue in both views); the cluster stays plain text. */
    const tag = r.__native
      ? '<span class="ta-tag" style="--t:var(--lx-fg-muted)">Built-in</span>'
      : `<span class="ta-tag" style="--t:${toneOf(r.family || 'unfiled')}">${esc(famLabel(r.family || 'unfiled'))}</span>`;
    const meta = [r.cluster].filter(Boolean).join(' · ');
    /* 160 is not a taste: it is the width the boot warmer caches (server.py WARM_WIDTH), and
       test_preview_cache pins the two numbers together. A mismatch is not a smaller picture — it is
       every open paying S3 for all sixty rows (measured 15 Oct: 2.7 s to fill the first screen). */
    return `<li class="drow${running ? ' is-busy' : ''}${isOn ? ' is-on' : ''}" style="--i:${Math.min(i, 18)}" data-slug="${esc(r.slug)}"${r.__native ? ' data-builtin="1"' : ''}>
      ${r.__native ? '<span class="drow__shot drow__shot--native" aria-hidden="true">ƒ</span>'
        : `<img class="drow__shot" src="${esc(thumbUrl(r.slug, r.image_url, 160))}" loading="lazy" decoding="async" alt="">`}
      <button type="button" class="drow__main" ${r.__native ? 'data-native="1" title="Add to the chart"' : 'data-open="1" title="Open the source and write-up"'}>
        <span class="drow__name">${isOn ? '<span class="drawer__dot" aria-hidden="true"></span>' : ''}${mark((r.name || r.slug).trim())}</span>
        <span class="drow__meta">${tag}${meta ? `<span>${esc(meta)}</span>` : ''}</span>
        ${res ? `<span class="drow__res ${res.ok ? 'is-ok' : 'is-bad'}">${esc(res.text)}</span>` : ''}
      </button>
      ${r.__native ? '' : `<button type="button" class="drow__star${starred ? ' is-starred' : ''}" data-star="1"
              aria-pressed="${starred}" aria-label="Favourite">${starred ? '★' : '☆'}</button>`}
      ${isOn
        ? `<button type="button" class="drow__run is-remove" data-remove="1" aria-label="Take it off the chart">✕<span>Remove</span></button>`
        : `<button type="button" class="drow__run" data-run="1" ${running || (r.__native && !r.supported) ? 'disabled' : ''}
              aria-label="${r.__native ? 'Add to the chart' : 'Run on the chart'}">${running ? '<span class="spin" aria-hidden="true"></span>' : (r.__native ? '+' : '▶')}<span>${r.__native ? 'Add' : 'Run'}</span></button>`}
    </li>`;
  }

  function paint() {
    if (!st.open) return;
    const cat = indState.cat;
    if (cat.state !== 'ready') {
      fams.innerHTML = '';
      list.innerHTML = cat.state === 'error'
        ? `<li class="drawer__empty">The catalogue did not answer: ${esc(cat.error)}</li>`
        : Array.from({ length: 8 }, () => '<li class="drow drow--skel"><span></span><span></span></li>').join('');
      count.textContent = cat.state === 'error' ? '' : 'loading…';
      return;
    }
    paintFamilies();
    const all = rows();
    count.textContent = all.length + ' script' + (all.length === 1 ? '' : 's');
    const on = onNames();
    const sec = (label) => `<li class="dsec" role="presentation">${esc(label)}</li>`;
    let head = '', rest = all;
    /* Browsing everything (no search, no family): what is ON the chart first, then what you used lately,
       then the whole library — the operator's two most common moves are one glance away (31 Oct). */
    if (!st.q.trim() && !st.family) {
      const isOn = (r) => on.includes(String(r.name || r.slug).trim().toLowerCase());
      const onRows = all.filter(isOn);
      const rec = (ti().recent ? ti().recent() : []).map((id) => all.find((r) => r.slug === id)).filter((r) => r && !isOn(r));
      const pinned = new Set([...onRows, ...rec]);
      rest = all.filter((r) => !pinned.has(r));
      head = (onRows.length ? sec('On chart · ' + onRows.length) + onRows.map((r, i) => rowHtml(r, i, on)).join('') : '')
        + (rec.length ? sec('Recently used') + rec.map((r, i) => rowHtml(r, i, on)).join('') : '')
        + (head || onRows.length || rec.length ? sec('All scripts') : '');
    } else if (st.q.trim()) {
      head = sec(all.length + (all.length === 1 ? ' result' : ' results'));
    }
    const shown = rest.slice(0, st.shown);
    list.innerHTML = all.length
      ? head + shown.map((r, i) => rowHtml(r, i, on)).join('') + (rest.length > shown.length
        ? `<li class="drawer__more"><button type="button" data-more="1">Show ${Math.min(SLICE, rest.length - shown.length)} more</button></li>` : '')
      : `<li class="drawer__empty">${st.family === '__fav' ? 'No favourites yet — tap ☆ on a script.' : 'Nothing matches “' + esc(st.q) + '”.'}</li>`;
    if (st.focus >= 0) setFocus(st.focus, false);
  }

  /* Keyboard: ↑/↓ move a highlight through the rows, Enter runs it, → opens its write-up. The box keeps
     the caret, so typing never stops working (31 Oct). */
  function rowEls() { return Array.from(list.querySelectorAll('.drow[data-slug]')); }
  function setFocus(i, scroll) {
    const els = rowEls();
    if (!els.length) { st.focus = -1; return; }
    st.focus = Math.max(0, Math.min(els.length - 1, i));
    els.forEach((li, n) => li.classList.toggle('is-focus', n === st.focus));
    if (scroll) els[st.focus].scrollIntoView({ block: 'nearest' });
  }

    /* One small helper for both slide-over sheets (this drawer and the Edge Stats sheet). They look modal (a scrim covers the
     chart) but were not: Tab walked into the toolbar behind the scrim and a screen reader could browse the chart while the
     sheet was "open". While one is open everything else in the app is inert; closing restores exactly what it changed. */
  if (!window.taModal) {
    const MODAL_IDS = ['lib-drawer', 'drawer-scrim', 'edge-sheet', 'edge-scrim', 'toast'];
    const changed = new Map();               // panel -> elements this call made inert
    window.taModal = {
      enter(panel) {
        const root = document.querySelector('.app');
        if (!root || changed.has(panel)) return;
        const mine = [];
        for (const child of Array.from(root.children)) {
          if (MODAL_IDS.includes(child.id) || child.contains(panel) || child.inert) continue;
          child.inert = true;
          mine.push(child);
        }
        changed.set(panel, mine);
      },
      leave(panel) {
        for (const n of changed.get(panel) || []) n.inert = false;
        changed.delete(panel);
      },
    };
  }

function setOpen(on) {
    st.open = Boolean(on);
    drawer.classList.toggle('is-open', st.open);
    scrim.classList.toggle('is-open', st.open);
    drawer.setAttribute('aria-hidden', String(!st.open));
    if (fallback) { fallback.setAttribute('aria-expanded', String(st.open)); fallback.classList.toggle('is-on', st.open); }
    if (st.open) {
      st.focus = -1;
      st.opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      if (window.taModal) window.taModal.enter(drawer);
      if (indState.cat.state === 'idle' || indState.cat.state === 'error') {
        loadCatalogue().then(paint);
      }
      if (indState.natives === null) loadNatives().then(paint);
      paint();
      setTimeout(() => { if (!st.detail) box.focus({ preventScroll: true }); }, 180);
    } else {
      showDetail(false);                       /* reopening shows the catalogue, not a stale pick */
      const hadFocus = drawer.contains(document.activeElement);
      if (window.taModal) window.taModal.leave(drawer);
      if (hadFocus) {
        /* Back to whatever opened the drawer (it used to be the Agent button: the selector's fallback matched the wrong
           widget). Falls back to Vela's Indicators button, then the plain-chart button. */
        const back = (st.opener && document.contains(st.opener) ? st.opener : null)
          || document.querySelector('.vela-widget-action-left') || fallback || document.body;
        back.focus?.({ preventScroll: true });
      }
      st.opener = null;
    }
  }

  /* The drawer's second view (3 Oct): a picked result. "Back" returns to the list, and closing the
     drawer resets to it too. app.js reaches this through window.libDrawer.detail(true). */
  function showDetail(on) {
    st.detail = Boolean(on);
    if (detailBox) detailBox.hidden = !st.detail;
    drawer.classList.toggle('is-detail', st.detail);
  }
  if (back) back.addEventListener('click', () => {
    showDetail(false);
    box.focus({ preventScroll: true });
  });

  async function run(slug, opts) {
    if (st.busy) return;
    const nat = (indState.natives || []).find((n) => n.type === slug);
    if (nat && ((opts && opts.native) || st.family === '__builtin')) {
      if (mountNative(nat.type, nat.title) !== false && ti().noteRecent) ti().noteRecent('builtin:' + nat.type);
      loadNatives().then(paint);               /* toasts + counts itself; asks the chart, so re-read */
      return;
    }
    const row = (indState.cat.rows || []).find((r) => r.slug === slug) || { slug, name: slug };
    const label = (row.name || slug).trim();
    st.busy = slug;
    delete st.result[slug];
    paint();
    try {
      const data = await api('/api/source', { slug });
      if (!data.source) throw new Error('no Pine source for this script');
      await chartReady;
      /* One study at a time: take OUR previous run off before this one lands — the CANVAS, that is.
         The stored run keeps until the new one actually lands (unified.js reset { keep: true }): a
         click on a script that fails to run must not cost the operator the indicator they had. */
      if (window.ChartOverlay) window.ChartOverlay.clear();
      if (window.PineTSPaint && window.PineTSPaint.clear) window.PineTSPaint.clear();
      if (window.TraderRun.reset) window.TraderRun.reset({ keep: true });
      const r = await window.TraderRun.run(data.source, label);
      if (!r.ok) {
        st.result[slug] = { ok: false, text: String(r.reason || 'did not run').slice(0, 90) };
        toast('“' + label + '”: ' + r.reason, true);
      } else {
        const d = r.drew || {};
        const ink = (d.boxes || 0) + (d.lines || 0) + (d.labels || 0) + (d.polylines || 0) + (d.tables || 0);
        const painted = ink > 0 || (r.paint && r.paint.added);
        st.result[slug] = painted
          ? { ok: true, text: 'on chart · ' + r.ms + ' ms' }
          : { ok: false, text: 'ran, but nothing to draw on this market' };
        toast(painted ? '“' + label + '” is on the chart' : '“' + label + '” ran — nothing landed', !painted);
        if (ti().noteRecent) ti().noteRecent(slug);
        if (painted) {
          if (typeof flashChart === 'function') flashChart();
          noteActivity('ran “' + label + '” from the drawer', 'drawer');
        }
      }
    } catch (err) {
      st.result[slug] = { ok: false, text: String(err.message || err).slice(0, 90) };
      toast('“' + label + '”: ' + err.message, true);
    } finally {
      st.busy = '';
      paint();
    }
  }

  /* A row whose picture the catalogue does not carry answers 404 (and offline, every row does). The
     <img> becomes a tile with the name's first letter: no picture is a fact, a broken icon looks like a
     bug (the ⌗ modal's lesson, 26 Sep). It is swapped, never deleted: deleting it shifted the row's
     grid and squeezed the name into the 52 px picture slot ("Indic…", 31 Oct). Capture phase: `error`
     from an <img> does not bubble. */
  list.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!img || img.tagName !== 'IMG') return;
    const tile = document.createElement('span');
    tile.className = 'drow__shot drow__shot--none';
    tile.setAttribute('aria-hidden', 'true');
    const name = img.closest('.drow')?.querySelector('.drow__name');
    tile.textContent = ((name && name.textContent.trim()) || '·').charAt(0).toUpperCase();
    img.replaceWith(tile);
  }, true);

  /* The family chips scroll sideways; a fade on the side that has more says so (31 Oct: they were cut
     at the edge, "Mom", with nothing to show there was more). A mouse wheel scrolls them too. */
  function markMore() {
    const max = fams.scrollWidth - fams.clientWidth;
    fams.dataset.more = max <= 1 ? '' : fams.scrollLeft <= 1 ? 'right' : fams.scrollLeft >= max - 1 ? 'left' : 'both';
  }
  fams.addEventListener('scroll', markMore, { passive: true });
  fams.addEventListener('wheel', (ev) => {
    if (fams.scrollWidth <= fams.clientWidth || Math.abs(ev.deltaX) >= Math.abs(ev.deltaY)) return;
    fams.scrollLeft += ev.deltaY;
    ev.preventDefault();
  }, { passive: false });
  window.addEventListener('resize', markMore);

  /* The narrow pane's Scripts button opens whichever view the operator chose, like Vela's Indicators. */
  if (fallback) fallback.addEventListener('click', () => {
    if (window.taIndicators && window.taIndicators.toggle) window.taIndicators.toggle(); else setOpen(!st.open);
  });
  const viewSwitch = drawer.querySelector('.ta-viewswitch');
  if (viewSwitch) viewSwitch.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-view]');
    if (!b || b.dataset.view !== 'quick' || !window.taIndicators) return;
    window.taIndicators.setView('quick');
    setOpen(false);
    window.taIndicators.open();
  });
  scrim.addEventListener('click', () => setOpen(false));
  $id('drawer-close').addEventListener('click', () => setOpen(false));

  let debounce = null;
  box.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { st.q = box.value; st.shown = SLICE; st.focus = st.q.trim() ? 0 : -1; paint(); list.scrollTop = 0; }, 120);
  });
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setFocus(st.focus + 1, true); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); setFocus(st.focus - 1, true); return; }
    if (ev.key === 'Enter') {
      const li = rowEls()[st.focus >= 0 ? st.focus : 0];
      if (li) run(li.dataset.slug, { native: li.dataset.builtin === '1' });
      return;
    }
    if (ev.key === 'ArrowRight' && box.selectionStart === box.value.length && st.focus >= 0) {
      const li = rowEls()[st.focus];
      const open = li && li.querySelector('[data-open]');
      if (open) { ev.preventDefault(); open.click(); }
    }
  });

  fams.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-fam]');
    if (!b) return;
    st.family = b.dataset.fam;
    st.shown = SLICE;
    paint();
    list.scrollTop = 0;
  });

  /* ONE clear for every door (3 Oct): the chip's ✕ in Vela's row and a row's Remove both land here,
     so taking the indicator off cannot mean two different things. */
  function clearChart() {
    if (window.ChartOverlay) window.ChartOverlay.clear();
    if (window.PineTSPaint && window.PineTSPaint.clear) window.PineTSPaint.clear();
    if (window.TraderRun && window.TraderRun.reset) window.TraderRun.reset();
    st.result = {};
    toast('Chart cleared');
    paint();
  }

  /* The chip's name opens the drawer AT its row: the list narrows to that name, so the row (with
     its ● on chart and Remove) is the first thing on screen. */
  function reveal(name) {
    const want = String(name || '').trim();
    setOpen(true);
    showDetail(false);
    st.family = '';
    st.q = want;
    st.shown = SLICE;
    if (box) box.value = want;
    paint();
    list.scrollTop = 0;
  }

  /* What is on changed (a run landed, a clear) — repaint the ● on chart marker while the list is up. */
  window.addEventListener('ta-onchart', () => paint());

  list.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-more]')) { st.shown += SLICE; paint(); return; }
    const li = ev.target.closest('.drow');
    if (!li || !li.dataset.slug) return;
    const slug = li.dataset.slug;
    if (ev.target.closest('[data-remove]')) { clearChart(); return; }
    if (ev.target.closest('[data-native]')) { run(slug, { native: true }); return; }
    const row = (indState.cat.rows || []).find((r) => r.slug === slug) || { slug, name: slug };
    if (ev.target.closest('[data-run]')) { run(slug, { native: li.dataset.builtin === '1' }); return; }
    if (ev.target.closest('[data-star]')) {
      toggleFavourite('library', slug, (row.name || slug).trim(), row.image_url);
      paint();
      return;
    }
    if (ev.target.closest('[data-open]')) {
      /* The picked result IS this drawer's second view now (3 Oct) — no close-then-reopen. */
      openResult({ ...row, kind: 'indicator' }, li);
    }
  });

  /* Escape: app.js's single keydown handler asks this first (one Escape, one surface). */
  window.closeDrawerIfOpen = function () {
    if (!st.open) return false;
    setOpen(false);
    return true;
  };
  /* Read-back for the agent and for scripted checks: what the drawer actually PAINTED. */
  /* Normally Vela's own Indicators button is the door (workspace.js). With no workspace row — the bare
     chart, or a build that refused the override — a plain button stands in so the drawer is never
     unreachable. */
  function showFallbackIfNeeded() {
    /* A 0-width row is Vela's compact mode — the desktop row is hidden, so the door is gone with it. */
    const row = document.querySelector('.vela-widget-topbar');
    const usable = !!(row && row.getBoundingClientRect().width > 0);
    if (fallback) fallback.hidden = usable;
  }
  window.addEventListener('ws-failed', showFallbackIfNeeded);
  window.addEventListener('resize', showFallbackIfNeeded);
  setTimeout(showFallbackIfNeeded, 8000);

  /* The agent's side of the one surface (3 Oct): the bridge's `indicators` door drives THIS — the ⌗
     modal is deleted and this drawer holds all three halves. Search and family are the same state the
     box and the chips write, so what the agent asks for is what the operator sees. */
  function star(spec, on) {
    const cut = String(spec || '').indexOf(':');
    const kind = cut > 0 ? spec.slice(0, cut).toLowerCase() : 'library';
    const id = (cut > 0 ? spec.slice(cut + 1) : String(spec || '')).trim();
    if (!id || kind !== 'library') return null;   /* built-ins carry no ☆ in this list */
    const row = (indState.cat.rows || []).find((r) => r.slug === id) || { slug: id, name: id };
    if (isFavourite('library', id) !== Boolean(on)) {
      toggleFavourite('library', id, (row.name || id).trim(), row.image_url);
    }
    paint();
    return { slug: id, starred: isFavourite('library', id), favourites: readFavourites().length };
  }

  /* Every row both views can show, in one shape: the LuxAlgo catalogue, then the chart's built-ins. */
  function items() {
    const on = onNames();
    const lib = (indState.cat.rows || []).map((r) => {
      const name = String(r.name || r.slug).trim();
      return { id: r.slug, slug: r.slug, name, family: r.family || 'unfiled', famLabel: famLabel(r.family || 'unfiled'),
               cluster: r.cluster || '', description: r.description || '', image_url: r.image_url,
               native: false, supported: true, on: on.includes(name.toLowerCase()), starred: isFavourite('library', r.slug) };
    });
    const nat = nativeRows().map((r) => ({ id: 'builtin:' + r.slug, slug: r.slug, name: r.name, family: '__builtin',
               famLabel: 'Built-in', cluster: '', description: '', native: true, supported: r.supported,
               on: Boolean(r.present), starred: false }));
    return lib.concat(nat);
  }

  /* The dropdown's actions, through the same paths the panel's own buttons take. */
  function act(item, what) {
    if (!item) return;
    if (what === 'remove') { clearChart(); return; }
    if (what === 'run') { run(item.slug, { native: item.native }); return; }
    if (what === 'star' && !item.native) { star('library:' + item.slug, !isFavourite('library', item.slug)); return; }
    if (what === 'details' && !item.native) {
      const row = (indState.cat.rows || []).find((r) => r.slug === item.slug) || { slug: item.slug, name: item.name };
      openResult({ ...row, kind: 'indicator' }, null);
    }
  }

  window.libDrawer = {
    open: setOpen, toggle: () => setOpen(!st.open), run, star, reveal, clear: clearChart, items, act,
    detail: (on) => { if (on !== false) setOpen(true); showDetail(on !== false); },
    search: (q) => {
      st.q = String(q == null ? '' : q).trim();
      st.shown = SLICE;
      if (box) box.value = st.q;
      paint();
      list.scrollTop = 0;
      return st.q;
    },
    family: (f) => {
      const want = String(f == null ? '' : f).trim();
      st.family = (want === 'all' || want === 'everything' || want === 'any') ? '' : want;
      st.shown = SLICE;
      paint();
      list.scrollTop = 0;
      return st.family;
    },
    /* Every row the current search/family matches (not just the painted slice), each carrying the
       same ☆ the operator sees — the door reports what the LIST holds, `state()` what it painted. */
    rows: () => rows().map((r) => ({ ...r, starred: r.__native ? false : isFavourite('library', r.slug) })),
    refresh: () => paint(),
    state: () => ({ open: st.open, detail: st.detail, q: st.q, family: st.family, busy: st.busy,
                    rows: list.querySelectorAll('.drow[data-slug]').length,
                    total: (indState.cat.rows || []).length,
                    catalogue: indState.cat.state,
                    builtins: (indState.natives || []).length,
                    families: (indState.cat.groups || []).length,
                    favourites: readFavourites().length }),
  };
})();
