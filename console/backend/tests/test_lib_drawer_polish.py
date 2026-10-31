"""The scripts list behind Indicators: six faults found in a screenshot review (31 Oct).

1. a row whose preview picture failed collapsed: the <img> was deleted, the row's grid shifted one
   column left, the name landed in the 52 px picture slot ("Indic…") and the ☆ got the name's room;
2. built-in rows: the ƒ sat in the corner of its tile, and Run sat 12 px left of every other Run
   (no ☆ in those rows, so Run took the ☆'s column);
3. the detail view said only "Failed / No live MCP session" — no reason in words, no way to retry;
4. the search box always said "Search 800 scripts" (the header said 120, or 77);
5. the family chips were cut at the edge ("Mom") with nothing saying they scroll;
6. the theme switch in the footer was a tiny dim ◐ that read as a broken glyph.
"""

import re
import unittest
from pathlib import Path

FRONT = Path(__file__).resolve().parents[2] / "frontend"
CSS = (FRONT / "styles.css").read_text(encoding="utf-8")
JS = (FRONT / "drawer.js").read_text(encoding="utf-8")
APP = (FRONT / "app.js").read_text(encoding="utf-8")
HTML = (FRONT / "index.html").read_text(encoding="utf-8")


def rule(selector: str) -> str:
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", CSS)
    assert m, f"no CSS rule for {selector}"
    return m.group(1)


class ARowKeepsItsShape(unittest.TestCase):
    def test_each_part_owns_its_column(self):
        # a missing tile or a missing ☆ can no longer move what comes after it
        for sel, col in ((".drow > .drow__main", "2"), (".drow > .drow__star", "3"), (".drow > .drow__run", "4")):
            self.assertRegex(rule(sel), rf"grid-column:\s*{col}\b", sel)

    def test_a_failed_picture_becomes_a_tile_not_a_hole(self):
        self.assertIn("img.replaceWith(", JS)
        self.assertIn("drow__shot--none", JS)
        self.assertNotIn("img.remove()", JS)

    def test_placeholder_tiles_centre_their_glyph(self):
        r = rule(".drow__shot--native,\n.drow__shot--none")
        self.assertIn("place-items: center", r)


class TheDetailSaysWhatWentWrong(unittest.TestCase):
    def test_api_errors_carry_their_code(self):
        self.assertIn("err.code = payload.code", APP)

    def test_an_offline_library_is_said_in_words_with_a_retry(self):
        self.assertIn("mcp_unavailable", APP)
        self.assertIn("The LuxAlgo Library isn't connected", APP)
        self.assertIn("data-detail-retry", APP)
        self.assertNotIn('<h2 class="detail__title">Failed</h2>', APP)


class TheSearchDoesNotMakeUpACount(unittest.TestCase):
    def test_no_fixed_number_in_the_placeholder(self):
        self.assertNotRegex(HTML, r'placeholder="Search \d+ scripts')


class TheChipsSayTheyScroll(unittest.TestCase):
    def test_overflow_is_marked_and_faded(self):
        self.assertIn("dataset.more", JS)
        self.assertIn('.drawer__fams[data-more', CSS)
        self.assertIn("mask-image", CSS.split(".drawer__fams[data-more", 1)[1][:400])


class TheThemeSwitchIsAnIcon(unittest.TestCase):
    def test_sun_and_moon_not_a_glyph(self):
        btn = HTML[HTML.index('id="theme-toggle"') - 80: HTML.index('id="theme-toggle"') + 900]
        self.assertIn("i-sun", btn)
        self.assertIn("i-moon", btn)
        self.assertNotIn(">◐<", btn)

    def test_it_is_a_real_target(self):
        r = rule(".drawer__theme")
        self.assertRegex(r, r"width:\s*28px")
        self.assertRegex(r, r"height:\s*28px")


if __name__ == "__main__":
    unittest.main()
