"""Pins for the 25 Sep UI polish pass on the console's non-chart surfaces.

Same convention as test_pane_audit.py: this repo has no JS test runner, so each behaviour that
would otherwise only be visible by eye is pinned as a shape in the source. The defects these guard
are the quiet ones — a class rendered with no CSS rules behind it, a count that went stale
upstream, a popover that cannot be closed from the keyboard.

Scope (operator, 25 Sep — "I am talking part only"): the Library part of the pane — search block,
filter row, suggestion chips, "Browse all" bar, the family bubble row and the concept popover it
opens. Phase 4 of the plan (the detail pane) is pinned here from T4.1 on; Phase 5 (the global toast
layer) stays optional.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")
APP = os.path.join(ROOT, "console", "frontend", "app.js")
BRIDGE = os.path.join(ROOT, "console", "frontend", "chart-bridge.js")
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


class TheRowsReadAsCards(unittest.TestCase):
    def test_every_row_carries_a_kind_coloured_glyph(self):
        app = read(APP)
        self.assertIn("function glyphFor", app)
        self.assertIn('class="row__glyph"', app)
        css = read(CSS)
        for needle in (".row__glyph", '.row[data-kind="concept"] .row__glyph',
                       '.row[data-kind="indicator"] .row__glyph'):
            self.assertIn(needle, css)

    def test_the_name_line_owns_its_width(self):
        """The pill used to sit on the name line and ellipsized names at ~10 characters."""
        css = read(CSS)
        self.assertIn(".row__sub", css)
        self.assertIn("class=\"row__sub\"", read(APP))

    def test_concept_rows_carry_no_kind_pill(self):
        """Operator: "Buang tag concept" — the glyph colour already says what the row is."""
        self.assertNotIn('row__kind row__kind--concept">concept</span>', read(APP))

    def test_the_kind_tag_is_a_pill(self):
        self.assertIn("border-radius: 999px", rule(read(CSS), ".row__kind"))

    def test_group_headings_stick_while_the_list_scrolls(self):
        self.assertIn("position: sticky", rule(read(CSS), ".browse__group"))

    def test_the_popover_header_never_wraps(self):
        css = read(CSS)
        self.assertIn("flex-wrap: nowrap", rule(css, ".browse__concepts-head"))
        self.assertIn("text-overflow: ellipsis", rule(css, ".browse__concepts-head strong"))


class TheDisclosureReadsAsOneSurface(unittest.TestCase):
    def test_the_header_does_not_repeat_the_family_name(self):
        """The popover title names the family; the count line repeated it ("Wyckoff" twice)."""
        self.assertIn("const scope = wantedFamily ? '' : ' · all families';", read(APP))

    def test_the_open_bubble_is_brought_into_view(self):
        app = read(APP)
        self.assertIn("scrollIntoView", app, "a family past the fold left no visible active chip")
        self.assertIn("scroll-behavior: smooth", read(CSS))

    def test_the_script_list_hides_while_concepts_are_disclosed(self):
        self.assertIn(".browse__body.is-concepts .browse__list", read(CSS))
        self.assertIn("is-concepts", read(APP), "the body class is what the CSS rule hangs off")

    def test_the_empty_state_hides_while_concepts_are_disclosed(self):
        self.assertIn(".view.is-concepts .results .empty", read(CSS))
        self.assertIn("closest('.view')", read(APP))


class TheDocsDoNotBakeCounts(unittest.TestCase):
    def test_docs_do_not_quote_the_stale_catalogue_size(self):
        """The docs quoted "805" for a year while the catalogue moved to 806 indicators / 853
        concepts. A doc that states a moving number is a doc that goes wrong quietly."""
        for path in (os.path.join(ROOT, "README.md"), os.path.join(ROOT, "docs", "MCP-TOOLS.md")):
            self.assertNotIn("805", read(path), f"{path} must not bake a catalogue count")


class TheConceptListShowsItsEdges(unittest.TestCase):
    def test_the_list_has_local_scroll_shadows(self):
        lst = rule(read(CSS), ".browse__concepts-list")
        self.assertIn("background-attachment: local", lst,
                      "the local/scroll gradient pair is the classic 'more above/below' cue")


class TheDetailPaneHoldsItsPlace(unittest.TestCase):
    def test_sticky_head_and_action_states(self):
        css = read(CSS)
        self.assertIn("position: sticky", rule(css, ".detail__head"))
        self.assertIn(".btn.is-busy", css)
        self.assertIn("function setActionState", read(APP))

    def test_the_head_wraps_title_meta_and_actions(self):
        self.assertIn('class="detail__head"', read(APP))


class TheConceptWriteUpIsRendered(unittest.TestCase):
    def test_markdown_renderer_exists_and_is_used(self):
        app = read(APP)
        self.assertIn("function renderMarkdown", app)
        branch = app.split("const data = await api('/api/concept'", 1)[1]
        self.assertIn("renderMarkdown(", branch[:900])
        self.assertNotIn("esc(body.slice(0, 14000))", app)

    def test_renderer_escapes_before_it_formats(self):
        fn = read(APP).split("function renderMarkdown", 1)[1].split("\n}", 1)[0]
        self.assertIn("esc(", fn, "upstream text is data — escape first, then format")

    def test_the_concept_branch_reads_the_field_the_api_returns(self):
        # The pane read `body_markdown`; the API answers `content_markdown`. Every concept showed
        # "No write-up returned." until this matched.
        branch = read(APP).split("const data = await api('/api/concept'", 1)[1][:400]
        self.assertIn("content_markdown", branch)

    def test_detail_text_styles_exist(self):
        self.assertIn(".detail__text h3", read(CSS))


class TheCodeBlockIsDressed(unittest.TestCase):
    def test_code_bar_with_label_and_copy(self):
        app = read(APP)
        self.assertIn('class="code__bar"', app)
        self.assertIn('class="code__label"', app)
        css = read(CSS)
        self.assertIn(".code__bar", css)
        self.assertIn(".code__label", css)

    def test_one_copy_button_only(self):
        app = read(APP)
        self.assertEqual(app.count('id="copy"'), 1, "copy lives on the code bar — not twice")


class TheAgentCanOpenOneRow(unittest.TestCase):
    """Phase 4's verification door: a screenshot of the detail pane has to come from a real click."""

    def test_open_op_exists_in_bridge_and_cli(self):
        bridge = read(os.path.join(ROOT, "console", "frontend", "chart-bridge.js"))
        self.assertIn("case 'open':", bridge)
        self.assertIn("dataset.slug === command.slug", bridge, "the op clicks the row, it does not fake it")
        cli = read(os.path.join(ROOT, "console", "bin", "trader-chart"))
        self.assertIn("def cmd_open", cli)
        self.assertIn('"open"', cli)

    def test_open_is_announced_in_the_actions_list(self):
        # The backend refuses any action the page's heartbeat does not claim — an unannounced op is a
        # 400, not a silent no-op.
        bridge = read(os.path.join(ROOT, "console", "frontend", "chart-bridge.js"))
        announced = bridge.split("const ACTIONS", 1)[1].split("];", 1)[0]
        self.assertIn("'open'", announced)

    def test_open_is_browsing_only(self):
        bridge = read(os.path.join(ROOT, "console", "frontend", "chart-bridge.js"))
        block = bridge.split("case 'open':", 1)[1].split("case 'mode':", 1)[0]
        for forbidden in ("TraderRun.run", "queueMount", "apply("):
            self.assertNotIn(forbidden, block, "opening a row must never run or mount anything")


class TheOverlayPanelKeepsTheTopbarReachable(unittest.TestCase):
    def test_the_fixed_detail_panel_starts_below_the_topbar(self):
        # The overlay is global now (F1, 25 Sep): it must cost the chart nothing at ANY width, so the
        # rule lives outside the narrow media query — and it still has to start under the topbar and
        # stop above the statusbar, or a covered toggle/toast leaves no way out and cuts words.
        css = read(CSS)
        block = css.split(".panel--right {", 1)[1].split("}", 1)[0]
        self.assertIn("position: fixed", block, "the right column must be an overlay, not a grid column")
        self.assertIn("inset-block: var(--lx-topbar-h) var(--lx-statusbar-h)", block,
                      "a covered Details toggle leaves no way to close the panel, and a covered "
                      "statusbar cuts the toast mid-word")
        self.assertIn("--lx-statusbar-h", css)

    def test_the_right_column_never_takes_grid_space(self):
        # F1 (operator's recording, 25 Sep): when the column took a grid column the chart shrank and
        # Vela's canvas came back blank — the run's paint landed on a white area nobody could see.
        # It must be an overlay at every width, so no grid rule may name the panel column.
        css = read(CSS)
        for rule in css.split(".main[")[1:]:
            head = rule.split("}", 1)[0]
            if "grid-template-columns" in head:
                self.assertNotIn("380px", head, "the right column must not take grid space")
                self.assertNotIn("340px", head, "the right column must not take grid space")
        self.assertIn(".main[data-detail=\"on\"] .panel--right { transform: none; }", css)

    def test_the_topbar_toggle_still_exists(self):
        self.assertIn('id="detail-open"', read(HTML))


    def test_the_welcome_blurb_hides_while_the_catalogue_is_open(self):
        block = read(APP).split("function toggleBrowse", 1)[1].split("\n}", 1)[0]
        self.assertIn("is-browsing", block, "the catalogue open state must mark the view")
        self.assertIn(".view.is-browsing .results .empty", read(CSS))


class EscapeHidesTheRightColumn(unittest.TestCase):
    def test_escape_hides_the_right_column(self):
        # Operator's note in the app's chat (25 Sep): the PineTS pane opened, but Escape did not
        # hide it again. One document-level listener, guarded so it acts only while the column is
        # open — the draft is saved as you type, so hiding the pane loses nothing.
        app = read(APP)
        block = app.split("ev.key !== 'Escape'", 1)[1].split("});", 1)[0]
        self.assertIn("el.main.dataset.detail !== 'on'", block)
        self.assertIn("setPanel('script', false)", block)


class ContrastClearsAA(unittest.TestCase):
    """The audit of 25 Sep found --lx-fg-faint at 3.60:1 and --lx-loss at 3.95:1 in the dark theme,
    and accent / warn below 4.5 on paper. This pins the CONTRACT (every text token clears AA on the
    worst surface it is used on), not the current hexes — any palette may ship if it passes."""

    SURFACES = {"dark": "#1b1b20", "light": "#f0efec"}

    @staticmethod
    def _ratio(fg, bg):
        def lin(c):
            c /= 255
            return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

        def lum(h):
            h = h.lstrip("#")
            r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
            return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

        a, b = lum(fg), lum(bg)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)

    def _token(self, theme, name):
        """The dark theme defines each token first; the light theme redefines it later. Read them in
        file order instead of slicing blocks on braces, which silently picked the wrong value."""
        hits = re.findall(r"--lx-%s:\s*(#[0-9a-fA-F]{6})" % name, read(CSS))
        self.assertTrue(hits, "--lx-%s has no solid value" % name)
        return hits[0] if theme == "dark" else hits[-1]

    def test_dark_text_tokens_clear_aa(self):
        for name in ("fg-faint", "loss"):
            r = self._ratio(self._token("dark", name), self.SURFACES["dark"])
            self.assertGreaterEqual(r, 4.5, "--lx-%s is %.2f:1 on a raised row" % (name, r))

    def test_light_text_tokens_clear_aa(self):
        for name in ("accent", "warn", "loss"):
            r = self._ratio(self._token("light", name), self.SURFACES["light"])
            self.assertGreaterEqual(r, 4.5, "--lx-%s is %.2f:1 on paper" % (name, r))


if __name__ == "__main__":
    unittest.main()

    def test_the_bridge_can_report_where_a_control_sits(self):
        # The agent clicks for real (ydotool): a geometry read beats guessing from a screenshot.
        bridge = read(BRIDGE)
        self.assertIn("case 'rect'", bridge)
        self.assertIn("getBoundingClientRect", bridge)
        self.assertIn("cx:", bridge)

    def test_the_cli_and_the_bridge_agree_on_what_a_script_command_carries(self):
        # `trader-chart script show --pine FILE` sends `source`; the bridge must read it too.
        bridge = read(BRIDGE)
        self.assertIn("command.pine || command.source", bridge)
        self.assertIn("mode === 'show'", bridge)
        cli = read(os.path.join(ROOT, "console", "bin", "trader-chart"))
        self.assertIn('command["source"]', cli)

    def test_every_panel_flip_nudges_the_chart_to_repaint(self):
        # Operator's recording: open the Script pane -> the chart went white. Vela must be nudged
        # after the layout flip, or the run's paint lands on a canvas nobody repainted.
        app = read(APP)
        self.assertIn("function nudgeChart()", app)
        self.assertIn("chart.resize()", app)
        self.assertGreaterEqual(app.count("nudgeChart();"), 3)   # both branches of setPanel + the helper
