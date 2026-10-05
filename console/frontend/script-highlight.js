/* Syntax colouring for the script editor — no library, no CDN, offline.

   The editor stays a plain <textarea> (so the gutter, the row marks, Ctrl+Enter, Escape, undo, IME, selection and
   every key work exactly as before). While the colours are on, its text is transparent and a coloured copy of the
   SAME text is drawn under it — same font, same line height, same scroll offsets: the textarea owns the caret and
   the selection, this file owns the colours.

   Pine has no multi-line comments or strings, so every line can be coloured on its own — which is what makes this
   cheap: only the lines on screen (plus a margin) are ever tokenised, so a 100 000-character script costs the same
   as a 100-line one. Two parts:

     * ScriptHighlight.tokenize(line)  — pure, run under Node (test_script_highlight.py): [[class, text], …] whose
       texts always join back to the line, whatever the line holds;
     * the attach() half — the DOM: the copy, the scroll sync, the window of rendered lines. It switches itself
       off (the textarea shows its own text again) for a script over MAX_CHARS, while the operator composes text with
       an input method, in forced-colours mode, and if anything in it throws. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScriptHighlight = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_CHARS = 300000;       // above this the layer is off: a script this size is not being read, it is being pasted
  const MAX_LINE = 2000;          // a longer line (minified code) is drawn plain rather than tokenised
  const MARGIN = 40;              // lines rendered above and below the visible ones
  const HYSTERESIS = 10;          // the window is only moved once the view is this close to its edge

  const set = (s) => new Set(s.split(/\s+/).filter(Boolean));

  /* Control flow, declarations, constants and type words. */
  const KEYWORDS = set(`if else for to by in while switch var varip break continue return import export as type method
    enum and or not true false na int float bool string color series simple const`);

  /* Namespaces coloured wherever they appear (a bare `array<float>` or `table t` is a type; `ta.sma` is a call). */
  const NS_CORE = set(`ta math str array matrix map color input strategy request ticker syminfo timeframe barstate chart
    line label box table linefill polyline runtime log`);

  /* Generic words that are namespaces only when a member follows (`size.small`, `position.top_right`,
     `text.align_center`, `plot.style_line`) — a variable called `size` or `text` stays plain. */
  const NS_DOTTED = set(`size position text font format currency shape location display xloc yloc extend scale order
    session plot hline dividends earnings splits adjustment backadjustment settlement_as_close dayofweek alert`);

  /* Built-in functions and series, coloured bare. */
  const BUILTIN = set(`indicator strategy library plot plotshape plotchar plotarrow plotbar plotcandle hline fill bgcolor
    barcolor alert alertcondition nz fixnan timestamp year month dayofmonth dayofweek hour minute second weekofyear
    open high low close volume hl2 hlc3 ohlc4 hlcc4 time time_close time_tradingday bar_index last_bar_index
    max_bars_back timenow`);

  /* comment | string (an unterminated one runs to the end of the line) | colour literal | number | identifier path |
     a word that starts with a digit but is not a number (`1x`, `2157f3ff1`) — taken whole, plain, so a long run of
     digits that fails the number rule is scanned once, not once per digit. */
  const TOKEN = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?(?![0-9A-Za-z_]))|((?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?![A-Za-z0-9_]))|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|(\d[A-Za-z0-9_]*)/g;

  /** One identifier path -> a class: 'k' keyword, 'b' built-in, '' plain. */
  function classify(word) {
    const dot = word.indexOf('.');
    if (dot < 0) {
      if (KEYWORDS.has(word)) return 'k';
      if (NS_CORE.has(word) || BUILTIN.has(word)) return 'b';
      return '';
    }
    const head = word.slice(0, dot);
    return NS_CORE.has(head) || NS_DOTTED.has(head) ? 'b' : '';
  }

  /** One line -> [[class, text], …]. Classes: 'c' comment, 'd' `//@directive`, 's' string, 'n' number or colour
   *  literal, 'k' keyword, 'b' built-in, '' plain. The texts always join back to `line`. */
  function tokenize(line) {
    const text = String(line == null ? '' : line);
    if (text.length > MAX_LINE) return [['', text]];
    const out = [];
    let at = 0;
    TOKEN.lastIndex = 0;
    let m;
    while ((m = TOKEN.exec(text)) !== null) {
      if (m.index > at) out.push(['', text.slice(at, m.index)]);
      if (m[1] !== undefined) {
        const d = /^(\/\/\s*)(@\w+)/.exec(m[1]);
        if (d) {
          out.push(['c', d[1]], ['d', d[2]]);
          if (m[1].length > d[0].length) out.push(['c', m[1].slice(d[0].length)]);
        } else out.push(['c', m[1]]);
      } else if (m[2] !== undefined) out.push(['s', m[2]]);
      else if (m[3] !== undefined || m[4] !== undefined) out.push(['n', m[3] !== undefined ? m[3] : m[4]]);
      else if (m[6] !== undefined) out.push(['', m[6]]);
      else {
        let cls = classify(m[5]);
        /* A name followed by `=` is a variable or a named argument — `plot(x, color = red)`, `timeframe = "D"` —
           not the keyword or built-in it happens to share a spelling with. (`==` and `=>` are not assignments.) */
        if (cls && m[5].indexOf('.') < 0 && /^\s*=(?![=>])/.test(text.slice(m.index + m[0].length, m.index + m[0].length + 8))) cls = '';
        out.push([cls, m[5]]);
      }
      at = m.index + m[0].length;
      if (m[0].length === 0) TOKEN.lastIndex++;          // never loop on an empty match
    }
    if (at < text.length) out.push(['', text.slice(at)]);
    return out;
  }

  /** Which lines to draw: [first, last], the lines on screen plus a margin. `prev` is the window drawn now
   *  ({ first, last } or null); it is kept while the view stays clear of its edges, so scrolling is not a rebuild
   *  per frame. Pure, so the one promise that matters — every line in view is inside the window, because the
   *  textarea's own text is transparent — is tested under Node for any script length, height and scroll. */
  function windowFor(prev, count, scrollTop, viewHeight, lh) {
    const n = Math.max(1, Math.floor(count) || 1);
    const row = lh > 0 ? lh : 19;
    const top = Math.max(0, Number(scrollTop) || 0);
    const seeFrom = Math.min(n - 1, Math.floor(top / row));
    const seeTo = Math.max(seeFrom, Math.min(n - 1, Math.ceil((top + Math.max(0, Number(viewHeight) || 0)) / row)));
    const keep = !!prev && prev.first >= 0 && prev.last <= n - 1
      && seeFrom >= prev.first && seeTo <= prev.last
      && (seeFrom >= prev.first + HYSTERESIS || prev.first === 0)
      && (seeTo <= prev.last - HYSTERESIS || prev.last >= n - 1);
    if (keep) return { first: prev.first, last: prev.last, rebuild: false };
    return { first: Math.max(0, seeFrom - MARGIN), last: Math.min(n - 1, seeTo + MARGIN), rebuild: true };
  }

  /* ── the DOM half ───────────────────────────────────────────────────────────────────────────────── */

  function attach(textarea, wrap, layer, edit) {
    if (!textarea || !wrap || !layer || !edit || typeof document === 'undefined') return null;
    let lines = [];
    let text = null;                  // the value `lines` was cut from
    let first = -1;
    let last = -1;                    // the rendered window, inclusive
    let off = false;
    let composing = false;

    const metrics = () => ({ lh: parseFloat(getComputedStyle(textarea).lineHeight) || 19 });

    const turnOff = () => {
      off = true;
      edit.classList.remove('is-hl');
      layer.textContent = '';
      text = null;                    // what was drawn is gone: the next paint cuts and draws the lines again,
      first = last = -1;              // even if the text comes back exactly as it was (a big paste, then undo)
    };

    function build(from, to) {
      const frag = document.createDocumentFragment();
      for (let i = from; i <= to; i++) {
        for (const [cls, s] of tokenize(lines[i])) {
          if (!cls) { frag.appendChild(document.createTextNode(s)); continue; }
          const span = document.createElement('span');
          span.className = 'hl-' + cls;
          span.textContent = s;
          frag.appendChild(span);
        }
        if (i < to) frag.appendChild(document.createTextNode('\n'));
      }
      layer.replaceChildren(frag);
    }

    /* The copy is a scroller shaped like the textarea (see .script__clip in styles.css): the same padding, the same
       client area, the same scroll offsets. The lines that are not drawn are two spacers, so its scroll height is
       the text's; the slack keeps the last row reachable. All the reads come first so the page lays out once. */
    function place(n) {
      const { lh } = metrics();
      const clip = layer.parentElement;
      const bar = { x: Math.max(0, textarea.offsetWidth - textarea.clientWidth), y: Math.max(0, textarea.offsetHeight - textarea.clientHeight) };
      const wide = textarea.scrollWidth;
      const at = { x: textarea.scrollLeft, y: textarea.scrollTop };
      clip.style.right = bar.x + 'px';
      clip.style.bottom = bar.y + 'px';
      layer.style.paddingTop = (first * lh) + 'px';
      layer.style.paddingBottom = ((n - 1 - last) * lh + 3 * lh) + 'px';
      layer.style.minWidth = wide + 'px';
      clip.scrollLeft = at.x;
      clip.scrollTop = at.y;
    }

    function paint() {
      if (composing) return;
      try {
        const value = textarea.value;
        if (value.length > MAX_CHARS) { turnOff(); return; }
        off = false;
        const changed = value !== text || (value !== '' && !layer.firstChild);      // an empty copy of a script with text is never kept
        if (changed) { text = value; lines = value.split('\n'); first = last = -1; }
        const { lh } = metrics();
        const n = lines.length;
        /* A hidden editor has no height: draw a screenful anyway; the observer below repaints once it has one. */
        const win = windowFor(first >= 0 ? { first, last } : null, n, textarea.scrollTop, textarea.clientHeight || 60 * lh, lh);
        if (win.rebuild) {
          first = win.first;
          last = win.last;
          build(first, last);
        }
        place(n);
        edit.classList.add('is-hl');
      } catch (err) {
        turnOff();                    // the textarea shows its own text again; never a script you cannot read
      }
    }

    /* The pane announces every repaint of its editor (input, a script loaded, the editor shown again, a resize) as
       `scriptpane:painted`, so there is one trigger for all of them; scrolling is the only thing it does not see. */
    window.addEventListener('scriptpane:painted', paint);
    textarea.addEventListener('scroll', paint);
    /* The editor's own size is the other thing the lines on screen depend on: the pane opening, a view switching
       back, the window or the status area changing height. */
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => paint()).observe(textarea);
    textarea.addEventListener('compositionstart', () => { composing = true; edit.classList.remove('is-hl'); });
    textarea.addEventListener('compositionend', () => { composing = false; paint(); });
    paint();
    return { paint, off: () => off };
  }

  return { tokenize, classify, windowFor, attach, MAX_CHARS, MAX_LINE, MARGIN, HYSTERESIS, KEYWORDS, NS_CORE, NS_DOTTED, BUILTIN };
}));

/* Wire it to the pane's editor once the page has it. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof window === 'undefined' || !window.ScriptHighlight) return;
  const go = () => {
    const ta = document.getElementById('script-src');
    const wrap = document.getElementById('script-code');
    const layer = document.getElementById('script-hl');
    const edit = wrap && wrap.parentElement;
    if (ta && wrap && layer && edit) window.ScriptHighlight.attach(ta, wrap, layer, edit);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
}());
