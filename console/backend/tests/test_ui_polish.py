"""Pins for the 25 Sep UI polish pass on the console's non-chart surfaces.

Same convention as test_pane_audit.py: this repo has no JS test runner, so each behaviour that
would otherwise only be visible by eye is pinned as a shape in the source. The defects these guard
are the quiet ones — a class rendered with no CSS rules behind it, a count that went stale
upstream, a popover that cannot be closed from the keyboard.

Scope (operator, 25 Sep — "I am talking part only"): the Library part of the pane — search block,
filter row, suggestion chips, "Browse all" bar, the family bubble row and the concept popover it
opens. Phases 4-5 of the plan (detail pane, global toast layer) are optional and not pinned here.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")
APP = os.path.join(ROOT, "console", "frontend", "app.js")
HTML = os.path.join(ROOT, "console", "frontend", "index.html")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def rule(css: str, selector: str) -> str:
    """Declaration block of the FIRST rule for `selector` (pass the selector without its brace)."""
    match = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return match.group(1) if match else ""


class TokensCarryThePolish(unittest.TestCase):
    def test_motion_and_elevation_tokens_exist(self):
        css = read(CSS)
        for token in ("--lx-ease-spring", "--lx-dur-pop", "--lx-shadow-pop",
                      "--lx-surface-glass", "--lx-radius-pop", "--lx-blur-pop"):
            self.assertIn(token, css, f"{token} is part of the polish pass")

    def test_light_theme_mirrors_them(self):
        light = read(CSS).split('[data-theme="light"]', 1)[1]
        for token in ("--lx-surface-glass", "--lx-shadow-pop"):
            self.assertIn(token, light, f"light theme must carry {token}")


class TheRowsHaveTheirAnatomy(unittest.TestCase):
    def test_row_is_a_column_with_styled_parts(self):
        css = read(CSS)
        row = rule(css, ".row")
        self.assertIn("flex-direction: column", row, "the row carries a name line and a meta line")
        for selector in (".row__top", ".row__desc", ".row__kind--concept"):
            self.assertIn(selector, css, f"{selector} is rendered by app.js and must be dressed")


class TheFamilyRowScrolls(unittest.TestCase):
    def test_the_chip_row_scrolls_sideways_with_a_fade(self):
        fams = rule(read(CSS), ".browse__families")
        self.assertIn("nowrap", fams)
        self.assertIn("mask-image", fams, "the fade is what tells the eye the row scrolls")

    def test_chips_carry_a_caret_that_turns(self):
        app = read(APP)
        self.assertIn("browse__fam-caret", app)
        self.assertIn('browse__fam[aria-expanded="true"] .browse__fam-caret', read(CSS))


class TheCountsAreHonest(unittest.TestCase):
    def test_the_all_chip_uses_the_live_concept_total(self):
        app = read(APP)
        self.assertNotIn("'all 805'", app, "the baked 805 went stale upstream (853 concepts now)")
        self.assertIn("api('/api/concepts', { page_size: 1 })", app)

    def test_no_stale_number_is_baked_into_the_chrome(self):
        self.assertNotIn("805", read(HTML), "the topbar label must not bake a count that drifts")
        self.assertNotIn("805 indicators", read(APP))


class TheListShowsItsShapeWhileLoading(unittest.TestCase):
    def test_browse_loading_uses_skeleton_rows(self):
        app = read(APP)
        self.assertIn("function skeletonRows", app)
        load = app.split("async function loadBrowse", 1)[1].split("browseState.loading = true", 1)[1]
        self.assertIn("skeletonRows", load[:800], "the reset branch paints row-shaped placeholders")

    def test_skeleton_rows_are_dressed(self):
        self.assertIn(".skeleton--row", read(CSS))


class TheSearchFieldIsDressed(unittest.TestCase):
    def test_search_input_carries_its_icon_and_hides_the_native_cancel(self):
        css = read(CSS)
        search = rule(css, 'input[type="search"]')
        self.assertIn("data:image/svg+xml", search, "a magnifier makes the field read as search")
        self.assertIn("-webkit-search-cancel-button", css, "the native black ✕ is wrong on dark")


class ThePopoverLooksLikeAPopover(unittest.TestCase):
    def test_surface_glass_and_entry_animation(self):
        css = read(CSS)
        pop = rule(css, ".browse__concepts")
        for needle in ("--lx-surface-glass", "backdrop-filter", "animation: pop-in", "--lx-shadow-pop"):
            self.assertIn(needle, pop, needle)
        self.assertIn("@keyframes pop-in", css)

    def test_it_has_a_close_button_and_a_hint(self):
        html = read(HTML)
        self.assertIn('id="browse-concepts-close"', html)
        self.assertIn("browse__concepts-hint", html)
        self.assertIn("browseConceptsClose", read(APP))


class ConceptsAreGroupedNotJustListed(unittest.TestCase):
    def test_group_headers_exist_and_are_not_rows(self):
        app = read(APP)
        self.assertIn("function appendConceptRows", app)
        self.assertIn(".browse__group", read(CSS))
        fn = app.split("function appendConceptRows", 1)[1].split("\n}", 1)[0]
        self.assertIn("browseConceptRow", fn)
        self.assertNotIn("className = 'row'", fn, "a header must never be counted as a concept row")

    def test_the_state_remembers_which_groups_were_painted(self):
        self.assertIn("clusters", read(APP))


class ThePopoverClosesTheWayPeopleExpect(unittest.TestCase):
    def test_escape_and_arrows_are_wired(self):
        app = read(APP)
        self.assertIn("function conceptsKeydown", app)
        for key in ("ArrowDown", "ArrowUp", "Escape", "Home", "End"):
            self.assertIn(key, app)

    def test_a_click_away_closes_it(self):
        app = read(APP)
        self.assertIn("onDocumentPointerDown", app)
        self.assertIn("pointerdown", app)


class TheConceptListShowsItsEdges(unittest.TestCase):
    def test_the_list_has_local_scroll_shadows(self):
        lst = rule(read(CSS), ".browse__concepts-list")
        self.assertIn("background-attachment: local", lst,
                      "the local/scroll gradient pair is the classic 'more above/below' cue")


if __name__ == "__main__":
    unittest.main()
