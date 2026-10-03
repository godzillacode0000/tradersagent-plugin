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
    open: false, q: '', family: '', shown: SLICE,
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
  const now = $id('drawer-now');
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
  }

  function paintNow() {
    const names = (window.TraderRun && window.TraderRun.list) ? window.TraderRun.list() : [];
    now.hidden = !names.length;
    now.innerHTML = names.length
      ? `<span class="drawer__dot" aria-hidden="true"></span><span class="drawer__nowname">On chart: ${esc(names.join(' · '))}</span>
         <button type="button" class="drawer__clear" data-clear="1">Clear</button>`
      : '';
  }

  function rowHtml(r, i) {
    const starred = !r.__native && isFavourite('library', r.slug);
    const res = st.result[r.slug];
    const running = st.busy === r.slug;
    const meta = r.__native ? ['built-in', r.cluster].filter(Boolean).join(' · ')
      : [famLabel(r.family || 'unfiled'), r.cluster].filter(Boolean).join(' · ');
    return `<li class="drow${running ? ' is-busy' : ''}" style="--i:${Math.min(i, 18)}" data-slug="${esc(r.slug)}">
      ${r.__native ? '<span class="drow__shot drow__shot--native" aria-hidden="true">ƒ</span>'
        : `<img class="drow__shot" src="${esc(thumbUrl(r.slug, r.image_url, 160))}" loading="lazy" decoding="async" alt="">`}
      <button type="button" class="drow__main" ${r.__native ? 'data-native="1" title="Add to the chart"' : 'data-open="1" title="Open the source and write-up"'}>
        <span class="drow__name">${esc((r.name || r.slug).trim())}</span>
        <span class="drow__meta">${esc(meta)}</span>
        ${res ? `<span class="drow__res ${res.ok ? 'is-ok' : 'is-bad'}">${esc(res.text)}</span>` : ''}
      </button>
      ${r.__native ? '' : `<button type="button" class="drow__star${starred ? ' is-starred' : ''}" data-star="1"
              aria-pressed="${starred}" aria-label="Favourite">${starred ? '★' : '☆'}</button>`}
      <button type="button" class="drow__run" data-run="1" ${running || (r.__native && !r.supported) ? 'disabled' : ''}
              aria-label="${r.__native ? 'Add to the chart' : 'Run on the chart'}">${running ? '<span class="spin" aria-hidden="true"></span>' : '▶'}<span>Run</span></button>
    </li>`;
  }

  function paint() {
    if (!st.open) return;
    paintNow();
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
    const shown = all.slice(0, st.shown);
    list.innerHTML = shown.length
      ? shown.map(rowHtml).join('') + (all.length > shown.length
        ? `<li class="drawer__more"><button type="button" data-more="1">Show ${Math.min(SLICE, all.length - shown.length)} more</button></li>` : '')
      : `<li class="drawer__empty">${st.family === '__fav' ? 'No favourites yet — tap ☆ on a script.' : 'Nothing matches “' + esc(st.q) + '”.'}</li>`;
  }

  function setOpen(on) {
    st.open = Boolean(on);
    drawer.classList.toggle('is-open', st.open);
    scrim.classList.toggle('is-open', st.open);
    drawer.setAttribute('aria-hidden', String(!st.open));
    if (fallback) { fallback.setAttribute('aria-expanded', String(st.open)); fallback.classList.toggle('is-on', st.open); }
    if (st.open) {
      if (indState.cat.state === 'idle' || indState.cat.state === 'error') {
        loadCatalogue().then(paint);
      }
      if (indState.natives === null) loadNatives().then(paint);
      paint();
      setTimeout(() => { if (!st.detail) box.focus({ preventScroll: true }); }, 180);
    } else {
      showDetail(false);                       /* reopening shows the catalogue, not a stale pick */
      if (drawer.contains(document.activeElement)) {
        (document.querySelector('.vela-widget-indicators, .vela-widget-action') || fallback || document.body).focus?.({ preventScroll: true });
      }
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

  async function run(slug) {
    if (st.busy) return;
    const nat = (indState.natives || []).find((n) => n.type === slug);
    if (st.family === '__builtin' && nat) {
      mountNative(nat.type, nat.title);        /* toasts + counts itself; asks the chart, so re-read below */
      loadNatives().then(paint);
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
      /* One study at a time: take OUR previous run off before this one lands. */
      if (window.ChartOverlay) window.ChartOverlay.clear();
      if (window.PineTSPaint && window.PineTSPaint.clear) window.PineTSPaint.clear();
      if (window.TraderRun.reset) window.TraderRun.reset();
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
        if (painted) {
          if (typeof flashChart === 'function') flashChart();
          noteActivity('ran “' + label + '” from the drawer', 'drawer');
        }
        refreshIndicatorCount();
      }
    } catch (err) {
      st.result[slug] = { ok: false, text: String(err.message || err).slice(0, 90) };
      toast('“' + label + '”: ' + err.message, true);
    } finally {
      st.busy = '';
      paint();
    }
  }

  if (fallback) fallback.addEventListener('click', () => setOpen(!st.open));
  scrim.addEventListener('click', () => setOpen(false));
  $id('drawer-close').addEventListener('click', () => setOpen(false));

  let debounce = null;
  box.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { st.q = box.value; st.shown = SLICE; paint(); list.scrollTop = 0; }, 120);
  });
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const first = list.querySelector('.drow');
      if (first) run(first.dataset.slug);
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

  now.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-clear]')) return;
    if (window.ChartOverlay) window.ChartOverlay.clear();
    if (window.PineTSPaint && window.PineTSPaint.clear) window.PineTSPaint.clear();
    if (window.TraderRun && window.TraderRun.reset) window.TraderRun.reset();
    st.result = {};
    refreshIndicatorCount();
    toast('Chart cleared');
    paint();
  });

  list.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-more]')) { st.shown += SLICE; paint(); return; }
    const li = ev.target.closest('.drow');
    if (!li || !li.dataset.slug) return;
    const slug = li.dataset.slug;
    if (ev.target.closest('[data-native]')) { run(slug); return; }
    const row = (indState.cat.rows || []).find((r) => r.slug === slug) || { slug, name: slug };
    if (ev.target.closest('[data-run]')) { run(slug); return; }
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

  window.libDrawer = {
    open: setOpen, toggle: () => setOpen(!st.open), run,
    detail: (on) => { if (on !== false) setOpen(true); showDetail(on !== false); },
    state: () => ({ open: st.open, detail: st.detail, q: st.q, family: st.family, busy: st.busy,
                    rows: list.querySelectorAll('.drow[data-slug]').length,
                    total: (indState.cat.rows || []).length, catalogue: indState.cat.state,
                    builtins: (indState.natives || []).length }),
  };
})();
