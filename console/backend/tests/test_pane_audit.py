"""Pins for the three defects the 23 Sep pane audit found — all quiet, all operator-visible.

Why source-reading tests: this repo has no JS test runner, and each defect was a *shape* — a
selector that did not match the input's type, a width guess that missed the real pane, a door with
no close path. Every one of them looked fine to a smoke test and wrong to the operator, which is
exactly what these checks exist to stop coming back.

1. The script-name input (type="text") never matched the field styling written for
   input[type="search"] — it rendered as the browser's default white box in a dark bar.
2. The bars pill chose its long form from window.innerWidth and then let the CSS cap cut a word in
   half ("bars: live · wo…"). It must measure its own overflow instead of guessing.
3. The bridge could open the script editor but not close it.
"""

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")
APP = os.path.join(ROOT, "console", "frontend", "app.js")
BRIDGE = os.path.join(ROOT, "console", "frontend", "chart-bridge.js")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheNameFieldIsDressed(unittest.TestCase):
    """A default-white input inside a dark bar reads as broken chrome, not as a field."""

    def test_text_inputs_match_the_search_field_dressing(self):
        css = read(CSS)
        self.assertIn('input[type="text"]', css,
                      "the script-name input is type=text; without its own rule it falls back to "
                      "the browser's default white box")
        rule = css.split('input[type="text"]', 1)[1].split("}", 1)[0]
        for var in ("--lx-field-bg", "--lx-fg", "--lx-border"):
            self.assertIn(var, rule, f"the text-input rule must carry {var}")


class TheBarsPillMeasuresInsteadOfGuessing(unittest.TestCase):
    def test_the_pill_measures_its_own_overflow(self):
        app = read(APP)
        block = app.split("function setBars", 1)[1].split("\n}", 1)[0]
        self.assertIn("scrollWidth", block)
        self.assertIn("clientWidth", block)

    def test_the_window_width_guess_is_gone(self):
        # The guess is what produced "bars: live · wo…": innerWidth said wide, the CSS cap said
        # narrow, and the ellipsis cut the word. A regression to guessing must fail here.
        self.assertNotIn("innerWidth <= 780", read(APP))

    def test_a_resize_re_measures(self):
        self.assertIn("addEventListener('resize'", read(APP))


class TheEditorDoorClosesToo(unittest.TestCase):
    def test_the_script_door_has_a_close_path(self):
        bridge = read(BRIDGE)
        self.assertIn("command.close", bridge)
        self.assertIn("script pane closed", bridge)


if __name__ == "__main__":
    unittest.main()
