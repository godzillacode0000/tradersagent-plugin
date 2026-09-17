/**
 * script-panel — the console's Script mode (the surface Quant has as well).
 *
 * Until now PineTS was driven entirely from outside the page: the agent (or bin/trader-chart) handed
 * a script to `PineTSRunner`, and the chart either took a matching Vela native or the script's own
 * geometry landed on the overlay. The SOURCE was never visible in the app, so "what is actually
 * running on this chart?" could not be answered from the page.
 *
 * Script mode fixes exactly that, and stays honest about the engine:
 *   - the editor holds the exact text handed to PineTS — nothing rewrites it on the way in;
 *   - the report underneath is the engine's own answer (series count, painted native, the overlay's
 *     verified counts, or the typed failure code NOT_RUNNABLE[while] / RUNTIME_CRASH[pinets-get_v] …);
 *   - a Library script can be loaded by name and its source is fetched verbatim from /api/source.
 *
 * It runs scripts the way an agent does — by queueing the same command the CLI queues — so there is
 * one execution path and the backend's one-view delivery guard still applies.
 */
(function () {
  'use strict';

  const LS_SRC = 'lx.script.src';
  const LS_MODE = 'lx.script.mode';
  const el = (id) => document.getElementById(id);

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'GET' });
    return res.json();
  }

  function mainEl() { return document.querySelector('.main'); }

  function setMode(mode) {
    const main = mainEl();
    if (!main) return;
    if (mode === 'script') main.setAttribute('data-mode', 'script');
    else main.removeAttribute('data-mode');
    const chart = el('mode-chart');
    const script = el('mode-script');
    if (chart) { chart.classList.toggle('is-on', mode !== 'script'); chart.setAttribute('aria-pressed', String(mode !== 'script')); }
    if (script) { script.classList.toggle('is-on', mode === 'script'); script.setAttribute('aria-pressed', String(mode === 'script')); }
    try { localStorage.setItem(LS_MODE, mode); } catch (err) { /* private mode */ }
  }

  function say(text, kind) {
    const out = el('scr-out');
    if (!out) return;
    const line = document.createElement('div');
    line.className = 'scr__line' + (kind ? ' scr__line--' + kind : '');
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }

  function report(result) {
    if (!result) { say('the page never reported back — is the chart still attached?', 'err'); return; }
    say((result.ok ? 'ok · ' : 'not ok · ') + (result.detail || 'no detail'), result.ok ? 'ok' : 'err');
    const err = result.error;
    if (err && err.code) {
      say('code: ' + err.code + (err.feature ? '[' + err.feature + ']' : '') +
          (err.retryable ? ' · retryable' : '') + (err.line ? ' · line ' + err.line : ''));
      if (err.hint) say('hint: ' + err.hint);
    }
    const oc = result.onCanvas;
    if (oc) say('on screen: ' + oc.boxes + ' box / ' + oc.lines + ' line / ' + oc.labels +
                ' label / ' + (oc.tables || 0) + ' table');
    if (result.natives) say('chart carries: ' + (result.natives.join(', ') || 'nothing'));
  }

  /** Queue one command and wait for the page's own report — the same path the CLI uses. */
  async function run(action, pine) {
    const queued = await api('/api/chart/command', { action: action, pine: pine, wait: 0 });
    if (!queued || !queued.ok) {
      say('could not queue the command: ' + ((queued && queued.error) || 'unknown'), 'err');
      return;
    }
    if (queued.data && queued.data.pushed === false) {
      say('nothing is attached to the chart — open the console pane, then run again', 'err');
      return;
    }
    const id = queued.data && queued.data.command && queued.data.command.id;
    if (!id) { say('the console queued nothing back', 'err'); return; }
    say(action === 'draw' ? 'queued draw #' + id + ' — waiting for the chart…'
                          : 'queued ' + action + ' #' + id + ' — waiting for the chart…');
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 600));
      const got = await api('/api/chart/result?id=' + id);
      const data = got && got.data;
      // The console reports a result as a flat record with `pending: false` once the page has
      // reported back — there is no nested `result` key (that assumption left the panel silent).
      if (data && data.pending === false) {
        report(data);
        if (action === 'draw' && !data.ok && /no boxes\/lines\/labels\/tables/.test(String(data.detail))) {
          say('this script only plots values — use "Run as native" so the closest Vela study is mounted.', 'warn');
        }
        return;
      }
    }
    say('no report within 90s — the pane may have closed mid-run', 'err');
  }

  async function search() {
    const q = (el('scr-query') || {}).value || '';
    const hits = el('scr-hits');
    if (!hits) return;
    if (!q.trim()) { hits.innerHTML = ''; return; }
    const res = await api('/api/search?q=' + encodeURIComponent(q) + '&type=indicators');
    const list = (res && res.data && res.data.results) || [];
    const only = list.filter((r) => r.kind === 'indicator').slice(0, 12);
    hits.innerHTML = '';
    if (!only.length) { hits.textContent = 'nothing in the Library matched that'; return; }
    for (const hit of only) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = hit.name + '  ·  ' + hit.slug;
      b.addEventListener('click', () => void loadSource(hit.slug, hit.name));
      hits.appendChild(b);
    }
  }

  async function loadSource(slug, name) {
    say('loading ' + slug + ' …');
    const res = await api('/api/source?slug=' + encodeURIComponent(slug));
    const src = (res && res.data && res.data.source) || '';
    if (!src) { say('the Library lists ' + slug + ' with no source (a platform page)', 'err'); return; }
    const box = el('scr-source');
    box.value = src;
    try { localStorage.setItem(LS_SRC + ':' + slug, src); } catch (err) { /* ignore */ }
    say('loaded ' + (name || slug) + ' — ' + src.split('\n').length + ' lines, verbatim from the Library');
  }

  function init() {
    const chart = el('mode-chart');
    const script = el('mode-script');
    if (!chart || !script) return;

    chart.addEventListener('click', () => setMode('chart'));
    script.addEventListener('click', () => setMode('script'));

    let saved = 'chart';
    try { saved = localStorage.getItem(LS_MODE) || 'chart'; } catch (err) { /* ignore */ }
    setMode(saved);

    const box = el('scr-source');
    try { box.value = localStorage.getItem(LS_SRC) || ''; } catch (err) { /* ignore */ }
    box.addEventListener('input', () => {
      try { localStorage.setItem(LS_SRC, box.value); } catch (err) { /* ignore */ }
    });

    const load = el('scr-load');
    if (load) load.addEventListener('click', () => void search());
    const query = el('scr-query');
    if (query) query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void search(); }
    });

    const runBtn = el('scr-run');
    if (runBtn) runBtn.addEventListener('click', () => {
      const pine = box.value;
      if (!pine.trim()) { say('nothing to run — paste Pine, or load one from the Library', 'err'); return; }
      void run('draw', pine);
    });

    const nativeBtn = el('scr-native');
    if (nativeBtn) nativeBtn.addEventListener('click', () => {
      const pine = box.value;
      if (!pine.trim()) { say('nothing to run — paste Pine, or load one from the Library', 'err'); return; }
      void run('apply', pine);
    });

    const clearBtn = el('scr-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => void run('clear', null));

    say('Run on chart = the engine runs it and the overlay draws what it built. ' +
        'Run as native = the engine runs it and the closest Vela study is mounted instead. ' +
        'Both report the engine\'s own answer below.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.ScriptPanel = {
    setMode, run,
    /** What the editor holds right now — the exact text the engine would be given. */
    getSource: () => {
      const box = el('scr-source');
      return box ? box.value : '';
    },
    /** Put a script in the editor (the agent asks for it, nobody hunts for a text field). */
    setSource: (text) => {
      const box = el('scr-source');
      if (!box) return false;
      box.value = String(text == null ? '' : text);
      try { localStorage.setItem(LS_SRC, box.value); } catch (err) { /* ignore */ }
      setMode('script');
      return true;
    },
    /** Run what the editor holds, the same way the Run buttons do. */
    runNow: (action) => run(action || 'draw', (el('scr-source') || {}).value || '')
  };
  console.log('[script-panel] ready — Script mode writes the Pine the engine is given');
})();
