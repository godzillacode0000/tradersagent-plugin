"""The script pane redesign (5 Oct), after the operator's screenshot and Hermes' critique. Pinned as source
shape; the behaviour was driven in Chromium at 771x603, 1150x900 and 740x603, dark and light, including a
real (space-taking) scrollbar:

  * one action bar — name, ▶ Run, ✕ — and nothing else in it;
  * the editor does not wrap, so the line numbers cannot drift off their lines (they did: a wrapped
    license line pushed "// © LuxAlgo", line 2, down to row 6);
  * the Logs chip, the static "Pine v6" pill and the three-line hint paragraph are gone; one status
    line says what the last Run did and opens a run list built with textContent only;
  * a one-line script (lost line breaks) is said out loud, because its first `//` hides the rest.
"""

import re
import unittest
from pathlib import Path

FRONT = Path(__file__).resolve().parents[3] / "console" / "frontend"
HTML = (FRONT / "index.html").read_text(encoding="utf-8")
CSS = (FRONT / "styles.css").read_text(encoding="utf-8")
APP = (FRONT / "app.js").read_text(encoding="utf-8")

HTML_CODE = re.sub(r"<!--.*?-->", "", HTML, flags=re.S)
PANE = HTML.split('id="view-script"', 1)[1].split("<!-- The picked result", 1)[0]
BLOCK = APP.split("// Script pane (restored 23 Sep)", 1)[1].split("// Theme: one button", 1)[0]


def rule(selector: str) -> str:
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", CSS)
    assert m, selector
    return m.group(1)


class ActionBar(unittest.TestCase):
    def test_the_bar_holds_the_name_saved_scripts_inputs_run_and_close_only(self):
        """The inputs button is in the bar but hidden until the script declares input.*() values; the saved-scripts
        button is always there (5 Oct)."""
        bar = PANE.split('class="script__bar"', 1)[1].split("</div>", 1)[0]
        self.assertEqual(re.findall(r'id="([\w-]+)"', bar), ["script-name", "script-lib-btn", "script-gear", "script-run", "script-close"])
        self.assertRegex(bar, r'id="script-gear"[^>]*\bhidden\b')

    def test_the_old_noise_is_gone(self):
        for gone in ('id="script-logs"', 'id="script-pine"', 'id="script-hint"', "Pine v6", "script__hint"):
            self.assertNotIn(gone, HTML_CODE)
        self.assertNotIn(".script__hint", CSS)
        self.assertNotIn("script__pill", CSS)

    def test_run_follows_the_theme_from_tokens(self):
        for sel in (".btn--run", ".btn--run:hover"):
            body = rule(sel)
            self.assertNotRegex(body, r"#[0-9a-fA-F]{3,8}\b", f"{sel} uses raw hex")
            self.assertIn("var(--lx-fg)", body)
        self.assertNotIn(':root[data-theme="light"] .btn--run', CSS)

    def test_hover_keeps_runs_colour(self):
        """`.btn:hover` paints a surface colour; without its own background the Run button turned grey
        under the pointer, which reads as disabled (caught in the browser check)."""
        self.assertIn("background", rule(".btn--run:hover"))


class Gutter(unittest.TestCase):
    def test_the_editor_does_not_wrap(self):
        self.assertIn('wrap="off"', PANE)
        # white-space is shared with the coloured copy under the textarea (script-highlight.js), which must not wrap either
        self.assertIn("white-space: pre", rule(".script__hl, .script__src"))
        self.assertIn("resize: none", rule(".script__src"))

    def test_the_gutter_makes_room_for_a_horizontal_scrollbar(self):
        paint = BLOCK.split("const paintGutter = () => {", 1)[1].split("\n  };", 1)[0]
        self.assertIn("srcBox.offsetHeight - srcBox.clientHeight", paint)
        self.assertIn("paddingBottom", paint)


class StatusAndRuns(unittest.TestCase):
    def test_one_status_line_opens_the_run_list(self):
        self.assertIn('id="script-status"', PANE)
        self.assertIn('aria-controls="script-out"', PANE)
        self.assertIn('id="script-out"', PANE)
        self.assertIn("setRunsOpen(", BLOCK)
        self.assertIn(".script__runs.is-folded .script__out", CSS)

    def test_the_state_is_said_in_words_not_only_a_dot(self):
        for word in ("`Ran · ", "'Failed · ", "Running “"):
            self.assertIn(word, BLOCK)

    def test_a_stacked_pane_starts_with_the_list_folded(self):
        self.assertIn("setRunsOpen(window.innerWidth >= DOCK_MIN)", BLOCK)

    def test_run_entries_never_go_through_innerHTML(self):
        code = re.sub(r"/\*.*?\*/", "", BLOCK, flags=re.S)
        self.assertNotIn("innerHTML", code)
        self.assertIn("textContent", BLOCK.split("const node = ", 1)[1].split("};", 1)[0])

    def test_the_list_is_capped(self):
        self.assertRegex(BLOCK, r"RUNS_MAX = \d+")
        self.assertIn("outBox.childElementCount > RUNS_MAX", BLOCK)

    def test_every_run_still_goes_through_the_one_summary(self):
        self.assertIn("window.TraderRun.summarize(r)", BLOCK)


class LostLineBreaks(unittest.TestCase):
    """The decision itself (which scripts, what the fix is) is executed in test_script_tools.py; these pin
    that the pane asks it and only rewrites on a press."""

    def test_the_pane_asks_diagnoseBreaks_and_rewrites_only_when_the_button_is_pressed(self):
        body = BLOCK.split("const checkBreaks = () => {", 1)[1].split("\n  };", 1)[0]
        self.assertIn("ST.diagnoseBreaks(srcBox.value)", body)
        self.assertIn("Restore line breaks", body)
        self.assertIn("b.addEventListener('click'", body)
        self.assertIn("srcBox.value = d.fixed;", body.split("b.addEventListener('click'", 1)[1])
        self.assertIn("srcBox.dispatchEvent(new Event('input'", body)   # the gutter and draft follow
        self.assertRegex(BLOCK, r"srcBox\.addEventListener\('input', \(\) => \{[^}]*checkBreaks\(\)")

    def test_the_old_inline_heuristic_is_gone(self):
        """It gated on length > 80 (so a 69-character collapsed script was never flagged) and looked for a
        backslash-n anywhere, even inside a string."""
        body = BLOCK.split("const checkBreaks = () => {", 1)[1].split("\n  };", 1)[0]
        self.assertNotIn("length > 80", body)
        self.assertNotIn("/\\\\n/.test(src)", body)


if __name__ == "__main__":
    unittest.main()
