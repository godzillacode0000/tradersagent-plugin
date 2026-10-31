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

  /* Finer colours for the editor themes (31 Oct): an editor theme (One Dark Pro, Dracula, GitHub) colours a call,
     a type, a constant and an operator apart, the way the operator's other editors do. refine() takes tokenize()'s
     classes and splits them further. It only re-labels tokens and cuts plain runs into pieces, so the texts still
     join back to the line. tokenize() is unchanged, and its own table in test_script_highlight.py still holds.
       t type word (int float bool string color series simple const)   l literal (true false na)
       f a call: a name or a built-in followed by `(` (or `<` for a typed one like array.new<float>)
       v a built-in series (close, high, bar_index…)                    p a built-in constant (color.red, size.small)
       a a named argument (`title =` after `(` or `,`)                  o an operator */
  const TYPES = set('int float bool string color series simple const');
  const LITERALS = set('true false na');
  const OPS = /(:=|=>|==|!=|<=|>=|\+=|-=|\*=|\/=|[-+*/%<>?:=])/;

  function refine(toks) {
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      let [cls, t] = toks[i];
      const next = i + 1 < toks.length ? toks[i + 1][1] : '';
      const prev = out.length ? out[out.length - 1][1] : '';
      const word = /^[A-Za-z_]/.test(t);
      const dotted = t.indexOf('.') > 0;
      /* a typed call, `array.new<float>(`: `<`, a type word, then `>` (so `syminfo.mintick < x` stays a comparison) */
      const typed = dotted && next === '<' && i + 3 < toks.length && /^[A-Za-z_]/.test(toks[i + 2][1]) && /^>/.test(toks[i + 3][1]);
      const call = /^\s*\(/.test(next) || typed;
      if (cls === 'k') {
        if (TYPES.has(t) && !call) cls = 't';
        else if (LITERALS.has(t) && !call) cls = 'l';
      } else if (cls === 'b') {
        if (call) cls = 'f';
        else if (dotted) cls = 'p';
        else if (!NS_CORE.has(t)) cls = 'v';
      } else if (cls === '' && word) {
        if (call) cls = 'f';
        else if (/^\s*=(?![=>])/.test(next) && /[(,]\s*$/.test(prev)) cls = 'a';
      } else if (cls === '' && t) {
        /* a plain run between tokens: cut out the operators */
        for (const piece of t.split(OPS)) if (piece) out.push([OPS.test(piece) && piece.length <= 2 && /^[-+*/%<>?:=!]+$/.test(piece) ? 'o' : '', piece]);
        continue;
      }
      out.push([cls, t]);
    }
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
        for (const [cls, s] of refine(tokenize(lines[i]))) {
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

  return { tokenize, refine, classify, windowFor, attach, MAX_CHARS, MAX_LINE, MARGIN, HYSTERESIS, KEYWORDS, NS_CORE, NS_DOTTED, BUILTIN };
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
    if (ta && edit) footer(ta, edit);
  };

  /* The editor's footer (31 Oct): theme, code size, caret position, Pine version. Both choices are this viewer's
     own, kept in this browser (and harmless when storage is off). The code size keeps the operator's 6.25px
     (6 Oct) as its first step; A+ walks up from there. "Console" is the editor as it was before themes. */
  const THEMES = ['onedark', 'dracula', 'github', 'console'];
  const SIZES = [6.25, 8, 9.5, 11, 12.5, 14];
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (err) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (err) { /* private mode */ } };

  function footer(ta, edit) {
    const foot = document.getElementById('script-foot');
    const sel = document.getElementById('script-theme');
    const pos = document.getElementById('script-pos');
    const lang = document.getElementById('script-lang');
    const zin = document.getElementById('script-zoom-in');
    const zout = document.getElementById('script-zoom-out');
    const repaint = () => {
      ta.dispatchEvent(new Event('scroll'));                       // the gutter and the line tints re-measure
      window.dispatchEvent(new Event('scriptpane:painted'));       // the coloured copy re-places itself
    };
    const setTheme = (t) => {
      const theme = THEMES.indexOf(t) >= 0 ? t : 'onedark';
      for (const el of [edit, foot]) {
        if (!el) continue;
        if (theme === 'console') delete el.dataset.codeTheme; else el.dataset.codeTheme = theme;
      }
      if (sel) sel.value = theme;
      write('ta-code-theme', theme);
    };
    let size = Number(read('ta-code-size', SIZES[0]));
    const setSize = (px) => {
      size = SIZES.indexOf(px) >= 0 ? px : SIZES[0];
      edit.style.setProperty('--code-size', size + 'px');
      if (zout) zout.disabled = size === SIZES[0];
      if (zin) zin.disabled = size === SIZES[SIZES.length - 1];
      write('ta-code-size', size);
      repaint();
    };
    const step = (d) => setSize(SIZES[Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(size) + d))]);
    const where = () => {
      if (!pos) return;
      const v = ta.value, at = ta.selectionStart || 0;
      const before = v.slice(0, at);
      const line = before.split('\n').length;
      const col = at - before.lastIndexOf('\n');
      const n = Math.abs((ta.selectionEnd || 0) - at);
      pos.textContent = `Ln ${line}, Col ${col}` + (n ? ` (${n} selected)` : '');
    };
    const version = () => {
      if (!lang) return;
      const m = /^[ \t]*\/\/[ \t]*@version[ \t]*=[ \t]*(\d+)/m.exec(ta.value.slice(0, 4000));
      lang.textContent = m ? 'Pine v' + m[1] : 'Pine';
    };
    if (sel) sel.addEventListener('change', () => setTheme(sel.value));
    if (zin) zin.addEventListener('click', () => step(1));
    if (zout) zout.addEventListener('click', () => step(-1));
    for (const ev of ['keyup', 'click', 'select', 'input', 'focus']) ta.addEventListener(ev, where);
    ta.addEventListener('input', version);
    window.addEventListener('scriptpane:painted', () => { version(); where(); });
    setTheme(read('ta-code-theme', 'onedark'));
    setSize(size);
    version();
    where();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
}());
