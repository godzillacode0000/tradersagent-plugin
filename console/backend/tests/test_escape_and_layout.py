"""Pins for the 25 Sep bugs the operator reported: Escape must close the PineTS/Detail pane,
the Library column must survive that pane opening, and a pane drag must repaint the chart.

The three defects, each visible in his stills:

1. Escape did nothing outside the family popover — only ``conceptsKeydown`` handled it, so the
   script/detail pane (his "opened PineTS") could only be closed with the ✕ button.
2. ``.main[data-detail="on"]`` forced ONE grid column, so opening the pane took the Library's
   column away: the panel stretched full width and the chart dropped underneath it.
3. The only ``resize`` listeners were ``setPaneTop`` and the bars read-out — dragging the app's
   split changed the console's size without ever nudging Vela, so the chart kept its old canvas
   box and overflowed the panel (measured live: ``#chart`` 360px inside a 295px ``.panel--chart``).

Same convention as test_ui_polish.py: source-shape unittest pins, because there is no JS runner.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")
APP = os.path.join(ROOT, "console", "frontend", "app.js")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def rule(css: str, selector: str) -> str:
    """Declaration block of the FIRST rule for `selector` (pass the selector without its brace)."""
    match = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return match.group(1) if match else ""


class EscapeClosesThePane(unittest.TestCase):
    def test_escape_has_its_own_handler_that_closes_the_detail_pane(self):
        app = read(APP)
        self.assertIn("function escapeKeydown", app, "no document-level Escape handler exists")
        body = app.split("function escapeKeydown", 1)[1]
        self.assertIn("e.key !== 'Escape'", body[:400], "the handler does not test for Escape")
        self.assertIn("el.main.dataset.detail === 'on'", body[:800],
                      "the handler does not ask whether the pane is open")
        self.assertIn("setPanel('detail', false)", body[:800],
                      "Escape does not close the pane")

    def test_escape_is_bound_before_the_popover_handler_so_only_one_surface_closes(self):
        app = read(APP)
        esc = app.find("addEventListener('keydown', escapeKeydown)")
        pop = app.find("addEventListener('keydown', conceptsKeydown)")
        self.assertNotEqual(esc, -1, "escapeKeydown is never bound")
        self.assertNotEqual(pop, -1, "conceptsKeydown is never bound")
        self.assertLess(esc, pop,
                        "bound after the popover handler — Escape would close the popover AND the pane")
        # the popover keeps ownership while it is open
        i = app.find("function escapeKeydown")
        self.assertIn("familyConceptState.open", app[i:i + 800],
                      "the handler does not stand down while the family popover is open")

    def test_script_and_library_have_a_way_out_from_the_keyboard_too(self):
        app = read(APP)
        body = app.split("function escapeKeydown", 1)[1]
        self.assertIn("setPanel('library', false)", body[:1200],
                      "Escape never closes the Library panel")


class OpeningThePaneKeepsTheLayout(unittest.TestCase):
    def test_library_and_detail_do_not_collapse_to_one_column(self):
        css = read(CSS)
        block = rule(css, '.main[data-library="on"][data-detail="on"]')
        if not block:
            # the two selectors may be listed together on one rule
            block = rule(css, '.main[data-detail="on"]:not([data-library="on"])')
        self.assertIn("grid-template-columns", block, "no rule owns that state")
        self.assertIn("300px", block,
                      "opening the detail pane hands the Library's column away: " + block.strip())

    def test_detail_without_library_is_still_one_full_width_column(self):
        css = read(CSS)
        block = rule(css, '.main[data-detail="on"]:not([data-library="on"])')
        self.assertIn("minmax(0, 1fr)", block,
                      "the chart is not the only column when the Library is closed: " + block.strip())


class APaneDragRepaintsTheChart(unittest.TestCase):
    def test_window_resize_nudges_the_chart(self):
        app = read(APP)
        self.assertIn("addEventListener('resize', onWindowResize)", app,
                      "a window resize (the app's split being dragged) never nudges Vela")
        self.assertRegex(app, re.escape("function onWindowResize()"),
                         "the debounced resize handler does not exist")

    def test_the_nudge_debounces_so_a_drag_does_not_thrash_vela(self):
        app = read(APP)
        m = re.search(r"function\s+(\w*[Rr]esize\w*)\s*\(", app)
        self.assertIsNotNone(m, "no resize handler function exists")
        if m is None:  # pragma: no cover - the assert above already failed
            return
        body = app[m.end():]
        self.assertRegex(body[:1500], r"(clearTimeout|requestAnimationFrame)",
                         "the resize handler is not debounced — every drag frame would hammer Vela")
        self.assertIn("nudgeChart()", body[:1500], "the resize handler does not nudge the chart")


if __name__ == "__main__":
    unittest.main()
