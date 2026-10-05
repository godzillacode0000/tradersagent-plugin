"""script-highlight.js — the colours in the script editor.

The editor stays a plain <textarea>; while the colours are on, its text is transparent and a coloured copy of the
SAME text is drawn under it. Two halves of that are pure and run under Node here (there is no browser in this
suite): the tokenizer and the window arithmetic. The layer itself is DOM — pinned by source shape below, and
driven in Chromium (alignment to the pixel at 1x, 1.25x, 1.5x and 2x, scrolling, selection, both themes).

What is held to the letter:
  * the tokens always join back to the line — the copy is the same text, and the textarea's own is invisible, so
    a character the tokenizer dropped would be a character the operator cannot see;
  * every line in view is inside the rendered window, for any script length, height and scroll position — for the
    same reason: a gap in the copy is a gap in the script;
  * a hostile line costs linear time, and the copy is never built from markup (no innerHTML): pasted code is
    text, always;
  * the five colours are tokens, AA on the canvas and under the caret-line wash, in both themes.
"""

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FRONT = ROOT / "console" / "frontend"
NODE = shutil.which("node")

HL = (FRONT / "script-highlight.js").read_text()
CSS = (FRONT / "styles.css").read_text()
HTML = (FRONT / "index.html").read_text()
APP = (FRONT / "app.js").read_text()


def run(body: str, data=None):
    """Run `body` under Node with H = the module and DATA = `data`; the script goes in on stdin (a corpus does not
    fit in an argument list). The body's last statement is an expression whose JSON is returned."""
    script = (f"const H = require({json.dumps(str(FRONT / 'script-highlight.js'))});\n"
              f"const DATA = {json.dumps(data)};\n"
              f"const out = (() => {{ {body} }})();\n"
              "process.stdout.write(JSON.stringify(out === undefined ? null : out));")
    done = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    if done.returncode != 0:
        raise AssertionError(done.stderr[-2000:])
    return json.loads(done.stdout)


def classed(line: str):
    """The coloured tokens of a line as (class, text) pairs — the plain stretches between them left out."""
    return [tuple(t) for t in run("return H.tokenize(DATA).filter((t) => t[0]);", line)]


def rule(css: str, selector: str) -> str:
    """The declaration block of the rule whose selector list is exactly `selector`."""
    m = re.search(r"(?:^|\})\s*" + re.escape(selector) + r"\s*\{([^}]*)\}", css, re.M)
    assert m, f"no rule for {selector}"
    return m.group(1)


# ── the tokenizer ──────────────────────────────────────────────────────────────────────────────────────

# line -> the coloured tokens it holds (class, text); c comment, d //@directive, s string, n number or colour
# literal, k keyword or type, b built-in. Anything not listed is plain.
CASES = [
    ("// © LuxAlgo", [("c", "// © LuxAlgo")]),
    ("//@version=6", [("c", "//"), ("d", "@version"), ("c", "=6")]),
    ("// @variable  the thing", [("c", "// "), ("d", "@variable"), ("c", "  the thing")]),
    ("  //  @function", [("c", "//  "), ("d", "@function")]),
    ('indicator("x", overlay=true)', [("b", "indicator"), ("s", '"x"'), ("k", "true")]),
    ("x = ta.sma(close, 14) // note", [("b", "ta.sma"), ("b", "close"), ("n", "14"), ("c", "// note")]),
    ("if close > open", [("k", "if"), ("b", "close"), ("b", "open")]),
    ("for i = 0 to 10 by 2", [("k", "for"), ("n", "0"), ("k", "to"), ("n", "10"), ("k", "by"), ("n", "2")]),
    ("var int n = na", [("k", "var"), ("k", "int"), ("k", "na")]),
    ("if not na(x) and y or z", [("k", "if"), ("k", "not"), ("k", "na"), ("k", "and"), ("k", "or")]),
    ("color.new(#2157F3, 40)", [("b", "color.new"), ("n", "#2157F3"), ("n", "40")]),
    ("#2157F380", [("n", "#2157F380")]),
    ("str.tostring(x)", [("b", "str.tostring")]),
    ("syminfo.tickerid", [("b", "syminfo.tickerid")]),
    ("size.small", [("b", "size.small")]),
    ("float[] a = array.new<float>()", [("k", "float"), ("b", "array.new"), ("k", "float")]),
    ("high[1]", [("b", "high"), ("n", "1")]),
    ("1_000 1e5 .5 5. 3e+7", [("n", "1_000"), ("n", "1e5"), ("n", ".5"), ("n", "5."), ("n", "3e+7")]),
    # strings: either quote, an escaped quote stays inside, `//` inside one is not a comment, one that never
    # closes runs to the end of the line
    ("plot(close, title='a\\'b')", [("b", "plot"), ("b", "close"), ("s", "'a\\'b'")]),
    ('"http://x" // y', [("s", '"http://x"'), ("c", "// y")]),
    ('"abc', [("s", '"abc')]),
    ("// it's fine", [("c", "// it's fine")]),
    # a name followed by `=` is a variable or a named argument, not the built-in it is spelled like
    ("size = 3", [("n", "3")]),
    ("timeframe = \"D\"", [("s", '"D"')]),
    ("close=5", [("n", "5")]),
    ("plot(close, color = red)", [("b", "plot"), ("b", "close")]),
    ("a == b", []),
    ("x := x + 1", [("n", "1")]),
    # words that merely contain a keyword, a member of an unknown thing, a digit-led word
    ("iffy format forecast", []),
    ("myarr.push(x)", []),
    ("a.b.c", []),
    ("1x 2157f3ff1", []),
    ("ta.", [("b", "ta")]),
]


@unittest.skipUnless(NODE, "node is not installed")
class Tokenizer(unittest.TestCase):
    def test_a_table_of_lines(self):
        for line, want in CASES:
            self.assertEqual(classed(line), want, line)

    def test_the_tokens_always_join_back_to_the_line(self):
        pine = sorted(ROOT.glob("docs/studies/**/*.pine"))
        self.assertTrue(pine, "no Pine in the repo to read")
        corpus = [line for f in pine for line in f.read_text().split("\n")]
        corpus += ["", " ", "\t\t", " ", "é = 1 // ünï", "emoji 😀 \"😀\" // 😀", "nul \u0000 byte", "cr \r in the line",
                   '"', "'", "\\", "//", "///", "#", "#fff", "#12345", "#2157f3ff1", "@", "@@", "..", ".5.5", "1.2.3", "1e", "1e+",
                   '"\\', '"\\"', "'\\'", "x" * 5000, "ta." * 2000]
        got = run("""
            const classes = new Set(['', 'c', 'd', 's', 'n', 'k', 'b']);
            const bad = [];
            for (const line of DATA) {
              const toks = H.tokenize(line);
              const joined = toks.map((t) => t[1]).join('');
              const sound = toks.every((t) => classes.has(t[0]) && typeof t[1] === 'string' && t[1].length > 0);
              if (joined !== line || !sound) bad.push(JSON.stringify(line.slice(0, 60)));
            }
            return { checked: DATA.length, bad };""", corpus)
        self.assertEqual(got["bad"], [])
        self.assertGreater(got["checked"], 1000)

    def test_random_lines_join_back_too(self):
        got = run("""
            let seed = 20261005;
            const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
            const parts = ['//', '//@', '"', "'", '\\\\', '#', '#2157f3', '@', '1', '.', '_', 'e', 'e+', 'ta.', 'ta.sma', 'close', ' ', '  ',
              '=', '==', '=>', ':=', '\\t', 'é', '😀', '\\u0000', 'color', 'if', 'size.small', 'x1', '0', '9', '(', ')', ',', '[', ']'];
            const bad = [];
            for (let i = 0; i < 6000; i++) {
              let line = '';
              for (let j = 0, n = Math.floor(next() * 60); j < n; j++) line += parts[Math.floor(next() * parts.length)];
              const toks = H.tokenize(line);
              if (toks.map((t) => t[1]).join('') !== line || toks.some((t) => !t[1])) bad.push(JSON.stringify(line));
            }
            return bad.slice(0, 5);""")
        self.assertEqual(got, [])

    def test_a_line_past_the_limit_is_left_plain(self):
        got = run("""
            const long = 'a = 1 // c\\n'.replace('\\n', '') + 'x'.repeat(H.MAX_LINE);
            const edge = 'a '.repeat(H.MAX_LINE / 2);
            return { long: H.tokenize(long), edge: H.tokenize(edge).length, limit: H.MAX_LINE };""")
        self.assertEqual(len(got["long"]), 1)
        self.assertEqual(got["long"][0][0], "")
        self.assertGreater(got["edge"], 1, "a line AT the limit is still coloured")

    def test_a_hostile_line_costs_linear_time(self):
        """Every one of these is a line a regular-expression tokenizer can be made to spend seconds on."""
        got = run("""
            const n = H.MAX_LINE - 1;
            const lines = ['1'.repeat(n) + 'a', '1_'.repeat(n / 2) + 'a', 'a.'.repeat(n / 2) + 'a', '1.'.repeat(n / 2) + 'a',
              '"'.repeat(n), '"' + '\\\\'.repeat(n - 1), '#'.repeat(n), '#ffffff'.repeat(n / 7 | 0), '/'.repeat(n), '1e'.repeat(n / 2) + '5',
              'ab '.repeat(n / 3 | 0), "'" + 'x\\\\'.repeat(n / 2)];
            const t0 = process.hrtime.bigint();
            for (let k = 0; k < 20; k++) for (const l of lines) H.tokenize(l);
            return Number(process.hrtime.bigint() - t0) / 1e6;""")
        self.assertLess(got, 1500, f"{got:.0f} ms for 240 hostile lines")

    def test_classify(self):
        got = run("return ['if', 'na', 'ta', 'ta.sma', 'close', 'size', 'size.small', 'foo', 'foo.bar', 'text.align_center', 'plot'].map((w) => H.classify(w));")
        self.assertEqual(got, ["k", "k", "b", "b", "b", "", "b", "", "", "b", "b"])


# ── which lines are drawn ──────────────────────────────────────────────────────────────────────────────

@unittest.skipUnless(NODE, "node is not installed")
class Window(unittest.TestCase):
    def test_every_line_in_view_is_inside_the_window(self):
        got = run("""
            let seed = 7;
            const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
            const bad = [];
            for (let i = 0; i < 20000; i++) {
              const n = 1 + Math.floor(next() * 6000);
              const lh = [19.375, 19, 20.5, 15.5, 31][Math.floor(next() * 5)];
              const h = next() < 0.1 ? 0 : Math.floor(next() * 3000);
              const top = Math.floor(next() * n * lh * 1.02);
              const prev = next() < 0.3 ? null : (() => { const f = Math.floor(next() * n); return { first: f, last: Math.min(n - 1, f + Math.floor(next() * 200)) }; })();
              const w = H.windowFor(prev, n, top, h, lh);
              // the rows in view, as the arithmetic of a textarea has them
              const from = Math.min(n - 1, Math.floor(top / lh));
              const to = Math.min(n - 1, Math.max(from, Math.ceil((top + h) / lh) - 1));
              const fine = w.first >= 0 && w.last <= n - 1 && w.first <= from && w.last >= to && w.first <= w.last;
              const kept = !w.rebuild && prev && w.first === prev.first && w.last === prev.last;
              // a window that is KEPT keeps its margin: the view is HYSTERESIS rows clear of both edges (unless the edge is the script's own)
              const clear = w.rebuild || ((from - w.first >= H.HYSTERESIS || w.first === 0) && (w.last - to >= H.HYSTERESIS || w.last === n - 1));
              if (!fine || !clear || (!w.rebuild && !kept)) bad.push({ n, lh, h, top, prev, w });
              if (prev === null && !w.rebuild) bad.push({ why: 'no window yet but not rebuilt', n });
            }
            return bad.slice(0, 3);""")
        self.assertEqual(got, [])

    def test_scrolling_row_by_row_rebuilds_rarely(self):
        got = run("""
            const n = 3000, lh = 19.375, h = 750;
            let win = null, rebuilds = 0, gaps = 0;
            for (let top = 0; top <= n * lh - h; top += lh) {
              const w = H.windowFor(win, n, top, h, lh);
              if (w.rebuild) rebuilds++;
              win = { first: w.first, last: w.last };
              const from = Math.floor(top / lh), to = Math.min(n - 1, Math.ceil((top + h) / lh) - 1);
              if (win.first > from || win.last < to) gaps++;
            }
            return { rebuilds, gaps, margin: H.MARGIN, hysteresis: H.HYSTERESIS };""")
        self.assertEqual(got["gaps"], 0)
        # a rebuild every (margin - hysteresis) rows is the design; allow some slack, but not one per frame
        self.assertLess(got["rebuilds"], 3000 / (got["margin"] - got["hysteresis"]) + 10)

    def test_a_short_script_is_one_window(self):
        got = run("return H.windowFor(null, 12, 0, 750, 19.375);")
        self.assertEqual((got["first"], got["last"]), (0, 11))

    def test_a_height_of_nothing_still_draws_the_top(self):
        got = run("return H.windowFor(null, 500, 0, 0, 19.375);")
        self.assertEqual(got["first"], 0)
        self.assertGreaterEqual(got["last"], 0)


# ── the layer, driven: attach() against a minimal stand-in for the DOM ─────────────────────────────

# Enough of a document for attach(): text nodes and elements, a textarea with the scroll and size numbers the
# layer reads, a window that holds listeners, a ResizeObserver whose callback the test calls. `ok()` is THE
# invariant: while the colours are on, every row in view is in the copy, with exactly the textarea's text.
FAKE_DOM = r"""
const lh = 19.375;
function make(value) {
  const listeners = { window: {}, ta: {} };
  let resize = null;
  const el = (tag) => {
    const e = { kind: 'el', tag, className: '', children: [], style: {}, parentElement: null,
      appendChild(c) { this.children.push(c); return c; },
      replaceChildren(frag) { this.children = frag ? frag.children.slice() : []; },
      get firstChild() { return this.children[0] || null; } };
    Object.defineProperty(e, 'textContent', {
      get() { return this.children.map((c) => (c.kind === 'text' ? c.data : c.textContent)).join(''); },
      set(v) { this.children = v === '' ? [] : [{ kind: 'text', data: String(v) }]; } });
    return e;
  };
  global.window = { addEventListener: (t, f) => { (listeners.window[t] = listeners.window[t] || []).push(f); } };
  global.document = { createDocumentFragment: () => el('#frag'), createTextNode: (d) => ({ kind: 'text', data: String(d) }), createElement: el };
  global.getComputedStyle = () => ({ lineHeight: lh + 'px' });
  global.ResizeObserver = class { constructor(cb) { resize = cb; } observe() {} };
  const flags = new Set();
  const edit = { classList: { add: (c) => flags.add(c), remove: (c) => flags.delete(c), contains: (c) => flags.has(c) } };
  const clip = el('div'); const layer = el('pre'); layer.parentElement = clip; clip.children.push(layer);
  const ta = { _v: value, boom: false, scrollTop: 0, scrollLeft: 0, clientHeight: 750, clientWidth: 331, offsetWidth: 346, offsetHeight: 760, scrollWidth: 1200,
    get value() { if (this.boom) { this.boom = false; throw new Error('boom'); } return this._v; }, set value(v) { this._v = v; },
    addEventListener: (t, f) => { (listeners.ta[t] = listeners.ta[t] || []).push(f); } };
  const api = H.attach(ta, {}, layer, edit);
  const fire = (who, t) => (listeners[who][t] || []).forEach((f) => f({}));
  const on = () => flags.has('is-hl');
  const ok = () => {
    if (!on()) return true;
    const lines = ta._v.split('\n');
    const first = Math.round((parseFloat(layer.style.paddingTop) || 0) / lh);
    const shown = layer.textContent.split('\n');
    const from = Math.floor(ta.scrollTop / lh), to = Math.min(lines.length - 1, Math.max(from, Math.ceil((ta.scrollTop + ta.clientHeight) / lh) - 1));
    for (let r = from; r <= to; r++) if (shown[r - first] !== lines[r]) return false;
    return true;
  };
  return { ta, layer, clip, api, fire, on, ok, resize: () => resize && resize(), lines: () => layer.textContent.split('\n').length };
}
const script = (n) => Array.from({ length: n }, (_, i) => (i % 9 === 0 ? '// line ' + i : 'x' + i + ' = ta.sma(close, ' + i + ') + "s' + i + '"')).join('\n');
"""


def dom(body: str):
    """Run `body` with FAKE_DOM and `make(value)` in scope; the body returns something JSON-able."""
    return run(FAKE_DOM + "\n" + body)


@unittest.skipUnless(NODE, "node is not installed")
class LayerDriven(unittest.TestCase):
    def test_a_script_is_drawn_and_every_row_in_view_is_in_the_copy(self):
        got = dom("""
            const e = make(script(300));
            const first = { on: e.on(), ok: e.ok(), rows: e.lines(), pad: e.layer.style.paddingTop };
            e.ta.scrollTop = 4000; e.fire('ta', 'scroll');
            const scrolled = { on: e.on(), ok: e.ok(), pad: e.layer.style.paddingTop };
            e.ta.scrollTop = 0; e.fire('ta', 'scroll');
            return { first, scrolled, back: e.ok(), clip: [e.clip.style.right, e.clip.style.bottom] };""")
        self.assertTrue(got["first"]["on"] and got["first"]["ok"])
        self.assertEqual(got["first"]["pad"], "0px")
        self.assertTrue(got["scrolled"]["on"] and got["scrolled"]["ok"])
        self.assertNotEqual(got["scrolled"]["pad"], "0px", "the lines above the window are a spacer, not text")
        self.assertTrue(got["back"])
        self.assertEqual(got["clip"], ["15px", "10px"], "the copy ends where the textarea's text area does (scrollbars excluded)")

    def test_an_edit_redraws_the_copy_from_the_new_text(self):
        got = dom("""
            const e = make(script(120));
            e.ta.value = script(120).replace('x1 =', 'renamed =');
            e.fire('window', 'scriptpane:painted');
            return { ok: e.ok(), has: e.layer.textContent.includes('renamed ='), on: e.on() };""")
        self.assertEqual(got, {"ok": True, "has": True, "on": True})

    def test_a_script_past_the_limit_shows_its_own_text_and_comes_back_when_it_shrinks(self):
        got = dom("""
            const e = make('plot(close)\\nplot(open)\\n');
            const big = 'a = 1\\n'.repeat(60000);                  // 360 000 characters, over MAX_CHARS
            e.ta.value = big; e.fire('window', 'scriptpane:painted');
            const over = { on: e.on(), empty: e.layer.textContent === '' };
            e.ta.value = 'plot(close)\\nplot(open)\\n'; e.fire('window', 'scriptpane:painted');      // EXACTLY the text it had before
            return { over, back: { on: e.on(), ok: e.ok(), chars: e.layer.textContent.length } };""")
        self.assertEqual(got["over"], {"on": False, "empty": True})
        self.assertTrue(got["back"]["on"], "the colours come back")
        self.assertTrue(got["back"]["ok"], "…and the copy has the text: an empty copy under a transparent textarea is a script nobody can read")
        self.assertGreater(got["back"]["chars"], 0)

    def test_a_failure_inside_turns_the_colours_off_and_the_next_paint_recovers(self):
        got = dom("""
            const e = make(script(40));
            e.ta.boom = true; e.fire('window', 'scriptpane:painted');
            const failed = { on: e.on(), empty: e.layer.textContent === '' };
            e.fire('window', 'scriptpane:painted');
            return { failed, recovered: { on: e.on(), ok: e.ok() } };""")
        self.assertEqual(got["failed"], {"on": False, "empty": True})
        self.assertEqual(got["recovered"], {"on": True, "ok": True})

    def test_composing_text_is_never_painted_over(self):
        got = dom("""
            const e = make(script(30));
            const before = e.layer.textContent;
            e.fire('ta', 'compositionstart');
            e.ta.value = 'こんにちは\\n' + script(30); e.fire('window', 'scriptpane:painted'); e.fire('ta', 'scroll');
            const during = { on: e.on(), same: e.layer.textContent === before };
            e.fire('ta', 'compositionend');
            return { during, after: { on: e.on(), ok: e.ok(), has: e.layer.textContent.includes('こんにちは') } };""")
        self.assertEqual(got["during"], {"on": False, "same": True})
        self.assertEqual(got["after"], {"on": True, "ok": True, "has": True})

    def test_an_editor_that_was_hidden_is_drawn_when_it_gets_a_size(self):
        got = dom("""
            const e = make(script(400));
            e.ta.clientHeight = 0; e.ta.value = script(400) + '\\nplot(close)'; e.fire('window', 'scriptpane:painted');
            const hidden = { ok: e.ok(), rows: e.lines() };
            e.ta.clientHeight = 1600; e.resize();
            return { hidden, shown: { ok: e.ok(), rows: e.lines() } };""")
        self.assertTrue(got["hidden"]["ok"])
        self.assertGreaterEqual(got["hidden"]["rows"], 60, "a screenful even with no height to go by")
        self.assertTrue(got["shown"]["ok"])

    def test_after_any_sequence_of_edits_scrolls_and_resizes_nothing_in_view_is_missing(self):
        got = dom("""
            let seed = 99;
            const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
            const e = make(script(500));
            const bad = [];
            for (let step = 0; step < 3000; step++) {
              const r = next();
              if (r < 0.35) { e.ta.scrollTop = Math.floor(next() * Math.max(1, e.ta._v.split('\\n').length * lh)); e.fire('ta', 'scroll'); }
              else if (r < 0.6) { const n = 1 + Math.floor(next() * 900); e.ta.value = script(n); e.ta.scrollTop = Math.min(e.ta.scrollTop, n * lh); e.fire('window', 'scriptpane:painted'); }
              else if (r < 0.7) { e.ta.clientHeight = Math.floor(next() * 2200); e.resize(); }
              else if (r < 0.75) { e.ta.value = 'a = 1\\n'.repeat(next() < 0.5 ? 60000 : 5); e.fire('window', 'scriptpane:painted'); }
              else if (r < 0.8) { e.fire('ta', 'compositionstart'); e.fire('ta', 'compositionend'); }
              else if (r < 0.85) { e.ta.boom = true; e.fire('window', 'scriptpane:painted'); }
              else { e.ta.value = e.ta._v + '\\nplot(' + step + ')'; e.fire('window', 'scriptpane:painted'); }
              if (!e.ok()) bad.push({ step, on: e.on(), top: e.ta.scrollTop, rows: e.ta._v.split('\\n').length, pad: e.layer.style.paddingTop });
              if (e.on() && e.ta._v !== '' && e.layer.textContent === '') bad.push({ step, empty: true });
            }
            return bad.slice(0, 3);""")
        self.assertEqual(got, [])


# ── the layer: source shape ────────────────────────────────────────────────────────────────────────────

class Layer(unittest.TestCase):
    def test_the_copy_is_never_built_from_markup(self):
        code = re.sub(r"/\*.*?\*/", "", HL, flags=re.S)
        for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "DOMParser", "createContextualFragment"):
            self.assertNotIn(banned, code, f"{banned}: pasted code must only ever be text")
        self.assertIn("textContent", code)
        self.assertIn("createTextNode", code)

    def test_it_loads_after_the_pane_and_the_markup_has_its_three_parts(self):
        order = [HTML.index(f'src="./{name}"') for name in ("app.js", "script-library.js", "script-highlight.js")]
        self.assertEqual(order, sorted(order))
        m = re.search(r'<div class="script__code" id="script-code">\s*'
                      r'<div class="script__clip" aria-hidden="true"><pre class="script__hl" id="script-hl"></pre></div>\s*'
                      r'<textarea id="script-src"', HTML)
        self.assertTrue(m, "the textarea sits after its coloured copy, inside .script__code")

    def test_what_makes_it_repaint(self):
        for needle in ("'scriptpane:painted'", "textarea.addEventListener('scroll'", "ResizeObserver",
                       "'compositionstart'", "'compositionend'"):
            self.assertIn(needle, HL, needle)
        self.assertIn("new Event('scriptpane:painted')", APP)
        self.assertRegex(APP, r"(?s)paintGutter = \(\) => \{.*?scriptpane:painted.*?\n  \};", "the pane announces every repaint of its editor")

    def test_it_switches_itself_off_rather_than_show_nothing(self):
        self.assertRegex(HL, r"value\.length > MAX_CHARS\) \{ turnOff\(\); return; \}")
        self.assertRegex(HL, r"catch \(err\) \{\s*turnOff\(\);")
        self.assertRegex(HL, r"const turnOff = \(\) => \{[^}]*classList\.remove\('is-hl'\)")
        self.assertIn("composing", HL)

    def test_the_window_comes_from_the_pure_function(self):
        self.assertIn("windowFor(first >= 0 ? { first, last } : null, n, textarea.scrollTop", HL)

    def test_the_gutter_does_not_carry_a_pixel_width_hack_any_more(self):
        self.assertNotIn("gutter.style.width", APP)


class Styles(unittest.TestCase):
    def test_the_copy_is_a_scroller_shaped_like_the_textarea(self):
        clip = rule(CSS, ".script__clip")
        self.assertIn("overflow: auto", clip, "a scroll container, like the textarea: the browser snaps the two alike")
        self.assertIn("scrollbar-width: none", clip)
        self.assertNotIn("contain", clip, "paint containment makes the copy snap differently from the textarea")
        self.assertNotIn("overflow: hidden", clip)
        self.assertIn("pointer-events: none", clip)
        self.assertIn("padding: var(--lx-space-2) var(--lx-space-3)", clip)
        self.assertIn("padding: var(--lx-space-2) var(--lx-space-3)", rule(CSS, ".script__src"), "the same padding on both")
        self.assertIn(".script__clip::-webkit-scrollbar { display: none; }", CSS)

    def test_the_global_pre_card_is_undone_on_the_copy(self):
        """The global `pre` rule is a card: 60vh tall, scrolling. Left on the copy, every line past about the 28th
        has no colour — and no text at all, because the textarea's own is transparent."""
        hl = rule(CSS, ".script__hl")
        for decl in ("max-height: none", "overflow: visible", "border: 0", "background: none", "padding: 0", "margin: 0"):
            self.assertIn(decl, hl)

    def test_both_layers_set_every_glyph_property_alike(self):
        shared = rule(CSS, ".script__hl, .script__src")
        for decl in ("font-family: var(--lx-font-mono)", "font-size: 12.5px", "line-height: 1.55", "tab-size: 2",
                     "font-variant-ligatures: none", "letter-spacing: 0", "white-space: pre", "text-rendering: geometricPrecision"):
            self.assertIn(decl, shared)

    def test_the_textarea_keeps_the_caret_and_the_selection_and_loses_only_its_ink(self):
        self.assertRegex(CSS, r"\.script__edit\.is-hl \.script__src \{ color: transparent; -webkit-text-fill-color: transparent; caret-color: var\(--lx-fg\); \}")
        self.assertIn(".script__edit.is-hl .script__src::selection", CSS)
        self.assertIn(".script__src::placeholder { color: var(--lx-fg-faint); -webkit-text-fill-color: var(--lx-fg-faint); }", CSS)
        self.assertIn(".script__edit:not(.is-hl) .script__clip { visibility: hidden; }", CSS)

    def test_forced_colours_get_the_plain_textarea(self):
        m = re.search(r"@media \(forced-colors: active\) \{(.*?)\n\}", CSS, re.S)
        self.assertTrue(m)
        self.assertIn(".script__hl { display: none; }", m.group(1))
        self.assertIn("color: CanvasText", m.group(1))

    def test_the_token_classes_use_tokens_only(self):
        for cls in (".hl-k, .hl-d", ".hl-b", ".hl-s", ".hl-n", ".hl-c"):
            body = rule(CSS, cls)
            self.assertIn("var(--lx-syn-", body, cls)
            self.assertNotRegex(body, r"#[0-9a-fA-F]{3,8}\b|rgba?\(", f"{cls}: a raw colour")


# ── the colours ────────────────────────────────────────────────────────────────────────────────────────

def _block(css: str, opener: str) -> str:
    start = css.index(opener)
    return css[start:css.index("\n}", start)]


def _hex(block: str, name: str):
    m = re.search(re.escape(name) + r":\s*#([0-9a-fA-F]{6})\s*;", block)
    assert m, f"{name} not found"
    return tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4))


def _rgba(block: str, name: str):
    m = re.search(re.escape(name) + r":\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([.\d]+)\)", block)
    assert m, f"{name} not found"
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))), float(m.group(4))


def _lum(rgb):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a, b):
    hi, lo = sorted((_lum(a), _lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def _over(wash, bg):
    (rgb, alpha) = wash
    return tuple(round(rgb[i] * alpha + bg[i] * (1 - alpha)) for i in range(3))


class Colours(unittest.TestCase):
    ROLES = ("keyword", "builtin", "string", "number", "comment")

    def themes(self):
        return {"dark": _block(CSS, ":root {"), "light": _block(CSS, ':root[data-theme="light"] {')}

    def test_every_role_is_defined_in_both_themes(self):
        for name, block in self.themes().items():
            for role in self.ROLES:
                self.assertRegex(block, rf"--lx-syn-{role}:\s*#[0-9a-fA-F]{{6}};", f"{name}: {role}")

    def test_every_role_is_AA_on_the_canvas_and_under_the_caret_line_wash(self):
        """The editor sits on the canvas; the line the caret is on is that canvas under a translucent wash, and a
        line an error names is under the loss tint — those are the surfaces the text is read on."""
        for name, block in self.themes().items():
            canvas = _hex(block, "--lx-canvas")
            surfaces = {
                "canvas": canvas,
                "caret line": _over(_rgba(block, "--lx-bg-hover"), canvas),
                "error line": _over(_rgba(block, "--lx-loss-soft"), canvas),
            }
            for role in self.ROLES:
                ink = _hex(block, f"--lx-syn-{role}")
                for where, bg in surfaces.items():
                    ratio = _contrast(ink, bg)
                    self.assertGreaterEqual(ratio, 4.5, f"{name} {role} on the {where}: {ratio:.2f}:1")

    def test_the_roles_are_told_apart(self):
        """Five inks that are one ink are no colouring: no two roles within a visible distance of each other."""
        for name, block in self.themes().items():
            inks = {r: _hex(block, f"--lx-syn-{r}") for r in self.ROLES}
            for a in self.ROLES:
                for b in self.ROLES:
                    if a < b:
                        dist = sum((x - y) ** 2 for x, y in zip(inks[a], inks[b])) ** 0.5
                        self.assertGreater(dist, 60, f"{name}: {a} and {b} are too close ({dist:.0f})")


if __name__ == "__main__":
    unittest.main()
