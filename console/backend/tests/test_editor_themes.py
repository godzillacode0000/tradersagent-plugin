"""The Pine editor's themes (31 Oct).

The operator asked for the script editor to look like a real code editor, using the most popular themes. One Dark
Pro, Dracula and GitHub top every list of the most installed VS Code themes, so the editor offers those three
(each with its light sibling in the console's light mode) plus "Console", the editor as it was.

A theme needs finer colours than the tokenizer's five, so refine() splits them further (call, type, literal,
built-in series, constant, named argument, operator). The promise the coloured copy lives by still holds: the
texts join back to the line, because the textarea's own text is invisible.
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


def run(body: str, data=None):
    script = (f"const H = require({json.dumps(str(FRONT / 'script-highlight.js'))});\n"
              f"const DATA = {json.dumps(data)};\n"
              f"const out = (() => {{ {body} }})();\n"
              "process.stdout.write(JSON.stringify(out === undefined ? null : out));")
    done = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    if done.returncode != 0:
        raise AssertionError(done.stderr[-2000:])
    return json.loads(done.stdout)


def refined(line: str):
    return [tuple(t) for t in run("return H.refine(H.tokenize(DATA)).filter((t) => t[0]);", line)]


CASES = [
    ('indicator("x", overlay = true)', [("f", "indicator"), ("s", '"x"'), ("a", "overlay"), ("o", "="), ("l", "true")]),
    ("float r = ta.rsi(close, 14)", [("t", "float"), ("o", "="), ("f", "ta.rsi"), ("v", "close"), ("n", "14")]),
    ("plot(r, color = color.new(#2962FF, 0))",
     [("f", "plot"), ("a", "color"), ("o", "="), ("f", "color.new"), ("n", "#2962FF"), ("n", "0")]),
    ("if barstate.islast", [("k", "if"), ("p", "barstate.islast")]),
    ("x := na", [("o", ":="), ("l", "na")]),
    ("f(x) => x * 2", [("f", "f"), ("o", "=>"), ("o", "*"), ("n", "2")]),
    ("a = array.new<float>()", [("o", "="), ("f", "array.new"), ("o", "<"), ("t", "float"), ("o", ">")]),
    ("ok = syminfo.mintick < x", [("o", "="), ("p", "syminfo.mintick"), ("o", "<")]),
    ("style = label.style_none", [("o", "="), ("p", "label.style_none")]),
    ("// ta.sma(close) in a comment", [("c", "// ta.sma(close) in a comment")]),
    ('"plot(x)" // s', [("s", '"plot(x)"'), ("c", "// s")]),
]


@unittest.skipUnless(NODE, "node is not installed")
class Refine(unittest.TestCase):
    def test_a_table_of_lines(self):
        for line, want in CASES:
            self.assertEqual(refined(line), want, line)

    def test_the_texts_still_join_back_to_the_line(self):
        pine = sorted(ROOT.glob("docs/studies/**/*.pine"))
        corpus = [line for f in pine for line in f.read_text().split("\n")]
        corpus += [line[:k] for line in list(corpus) for k in (1, len(line) // 2) if 0 < k < len(line)]
        corpus += ["", " ", "a:=b", "x+=1", "a ? b : c", "a<b>c", "f(", "(", "=>", "<", "x" * 5000,
                   "emoji 😀 \"😀\" // 😀", "array.new<", "array.new<float", "z = y.w<q>("]
        got = run("""
            const classes = new Set(['', 'c', 'd', 's', 'n', 'k', 'b', 't', 'l', 'f', 'v', 'p', 'a', 'o']);
            const bad = [];
            for (const line of DATA) {
              const toks = H.refine(H.tokenize(line));
              const ok = toks.map((t) => t[1]).join('') === line && toks.every((t) => classes.has(t[0]) && t[1].length > 0);
              if (!ok) bad.push(JSON.stringify(line.slice(0, 60)));
            }
            return { checked: DATA.length, bad };""", corpus)
        self.assertEqual(got["bad"], [])
        self.assertGreater(got["checked"], 50)

    def test_the_tokenizer_itself_is_unchanged(self):
        # refine() is a second pass: tokenize()'s own classes (and its table in test_script_highlight) stand
        self.assertIn("for (const [cls, s] of refine(tokenize(lines[i]))) {", HL)
        self.assertIn("return { tokenize, refine, classify,", HL)


class Themes(unittest.TestCase):
    def test_the_four_choices(self):
        for value, name in (("onedark", "One Dark Pro"), ("dracula", "Dracula"), ("github", "GitHub"), ("console", "Console")):
            self.assertIn(f'<option value="{value}">{name}</option>', HTML)
        self.assertIn("const THEMES = ['onedark', 'dracula', 'github', 'console'];", HL)
        self.assertIn("setTheme(read('ta-code-theme', 'onedark'))", HL, "One Dark Pro is the default")

    def test_each_theme_has_its_light_sibling(self):
        for t in ("onedark", "dracula", "github"):
            self.assertIn(f'[data-code-theme="{t}"] {{', CSS)
            self.assertIn(f':root[data-theme="light"] [data-code-theme="{t}"] {{', CSS)

    def test_published_palettes(self):
        one = re.search(r'\n\[data-code-theme="onedark"\] \{([^}]*)\}', CSS).group(1)
        for c in ("#282c34", "#abb2bf", "#c678dd", "#61afef", "#98c379", "#d19a66", "#e5c07b", "#e06c75", "#56b6c2"):
            self.assertIn(c, one)
        dra = re.search(r'\n\[data-code-theme="dracula"\] \{([^}]*)\}', CSS).group(1)
        for c in ("#282a36", "#f8f8f2", "#ff79c6", "#50fa7b", "#f1fa8c", "#bd93f9", "#8be9fd", "#ffb86c", "#6272a4"):
            self.assertIn(c, dra)
        gh = re.search(r'\n\[data-code-theme="github"\] \{([^}]*)\}', CSS).group(1)
        for c in ("#0d1117", "#e6edf3", "#ff7b72", "#d2a8ff", "#a5d6ff", "#79c0ff", "#ffa657", "#8b949e"):
            self.assertIn(c, gh)

    def test_console_is_the_editor_as_it_was(self):
        # no attribute, so none of the theme rules apply and the five console colours stand
        self.assertIn("if (theme === 'console') delete el.dataset.codeTheme;", HL)
        for cls, fallback in (("f", "--lx-syn-builtin"), ("t", "--lx-syn-keyword"), ("l", "--lx-syn-number")):
            self.assertRegex(CSS, r"\.hl-" + cls + r" \{ color: var\(--syn-\w+, var\(" + fallback + r"\)\); \}")

    def test_the_line_tint_and_the_selection_are_see_through(self):
        # both are drawn over the text: an opaque one hid the line number and the selected word
        self.assertIn(".script__edit[data-code-theme] .script__mark--cur { background: color-mix(in srgb, var(--lx-fg) 6%, transparent); }", CSS)
        self.assertEqual(len(re.findall(r"--code-sel: rgba\(", CSS)), 6)
        self.assertNotRegex(CSS, r"--code-sel: #")


class Footer(unittest.TestCase):
    def test_it_is_on_the_page(self):
        for part in ('id="script-foot"', 'id="script-lang"', 'id="script-pos"', 'id="script-zoom-in"', 'id="script-zoom-out"',
                     'id="script-theme"'):
            self.assertIn(part, HTML)
        self.assertIn(".script.is-settings .script__foot, .script.is-scripts .script__foot { display: none; }", CSS)

    def test_the_size_is_8px_by_default_and_shown_as_a_number(self):
        # 31 Oct, the operator: "make it changeable / inspectable for its size... for now default at 8px"
        self.assertIn("const SIZE_DEFAULT = 8, SIZE_MIN = 6, SIZE_MAX = 24;", HL)
        self.assertIn('<input type="number" id="script-size" min="6" max="24" step="0.25" value="8"', HTML)
        self.assertIn('aria-label="Code size in pixels"', HTML)
        self.assertIn("font-size: 8px; font-size: var(--code-size, 8px);", CSS)
        # the gutter scales with the code, so the numbers stay on their lines
        gutter = re.search(r"\.script__gutter \{([^}]*)\}", CSS).group(1)
        self.assertIn("var(--code-size, 8px)", gutter)

    def test_a_typed_size_is_kept_in_range(self):
        self.assertIn("if (!isFinite(n) || n <= 0) return SIZE_DEFAULT;", HL)
        self.assertIn("Math.round(Math.max(SIZE_MIN, Math.min(SIZE_MAX, n)) * 4) / 4", HL)

    def test_keys_from_the_editor(self):
        for key in ("ev.key === '='", "ev.key === '-'", "ev.key === '0'"):
            self.assertIn(key, HL)
        self.assertIn("setSize(SIZE_DEFAULT)", HL)

    def test_a_size_change_repaints_the_gutter_and_the_colours(self):
        self.assertIn("ta.dispatchEvent(new Event('scroll'));", HL)
        self.assertIn("window.dispatchEvent(new Event('scriptpane:painted'));", HL)

    def test_position_and_version(self):
        self.assertIn("pos.textContent = `Ln ${line}, Col ${col}`", HL)
        self.assertIn("lang.textContent = m ? 'Pine v' + m[1] : 'Pine';", HL)

    def test_storage_is_optional(self):
        self.assertIn("try { const v = localStorage.getItem(k);", HL)
        self.assertIn("try { localStorage.setItem(k, String(v)); } catch (err)", HL)


if __name__ == "__main__":
    unittest.main()
