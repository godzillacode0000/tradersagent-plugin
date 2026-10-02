"""Pins for 3 Oct: a long activity sentence must never make the page wider than its pane.

Measured live (rect action, 3 Oct): ``body`` 868px, but ``.topbar`` / ``.main`` / ``#chart`` /
``.statusbar`` all 2286px, and ``#last-action`` 2250px. The status bar is a grid item of ``.app``;
``.app`` declared no column, so its implicit ``auto`` column took the status bar's min-content width,
and the status bar's min-content was the whole ``white-space: nowrap`` sentence ("ran in 143 ms over
500 bars · … · engine context: worker …"). Vela then laid the chart out at 2286px inside an 868px
pane: the price axis and the last candles sat off-screen, and every overlay was positioned on a
chart nobody could see.

The cure is the standard grid one — a ``minmax(0, 1fr)`` column and ``min-width: 0`` on the item —
plus a cap on the sentence itself, so the footer never has to ellipsize a paragraph.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FRONTEND = os.path.join(ROOT, "console", "frontend")
CSS = os.path.join(FRONTEND, "styles.css")
APP = os.path.join(FRONTEND, "app.js")
UNIFIED = os.path.join(FRONTEND, "unified.js")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def rule(css: str, selector: str) -> str:
    """Declaration block of the FIRST rule whose selector is exactly `selector`."""
    match = re.search(r"(?:^|\})\s*" + re.escape(selector) + r"\s*\{([^}]*)\}", css, re.M)
    return match.group(1) if match else ""


class TheShellHasOneColumnThatCannotGrow(unittest.TestCase):
    def test_app_declares_a_zero_min_column(self):
        css = read(CSS)
        block = rule(css, ".app")
        self.assertIn("grid-template-columns: minmax(0, 1fr)", block,
                      "an implicit auto column takes the widest nowrap child's min-content")

    def test_the_status_bar_may_shrink_below_its_sentence(self):
        css = read(CSS)
        self.assertIn("min-width: 0", rule(css, ".statusbar"))

    def test_the_measurement_is_written_down(self):
        self.assertTrue("2286px" in read(CSS), "the old reading belongs next to the rule that fixes it")


class TheActivitySentenceIsShort(unittest.TestCase):
    def test_note_activity_caps_the_visible_text_and_keeps_the_rest_in_the_tooltip(self):
        app = read(APP)
        body = app.split("function noteActivity(", 1)[1].split("\n}\n", 1)[0]
        self.assertTrue("ACTIVITY_MAX" in app, "the cap needs a name")
        self.assertIn("line.title", body, "the full sentence stays one hover away")
        self.assertRegex(body, r"slice\(0,\s*ACTIVITY_MAX")

    def test_the_summary_does_not_carry_the_debug_dump(self):
        self.assertFalse("mapping.diag" in read(UNIFIED),
                         "diagnostics belong in state(), not in the sentence the operator reads")


if __name__ == "__main__":
    unittest.main()
