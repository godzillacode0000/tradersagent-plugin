"""Pins for the browsable catalogue — the 805 library indicators as clickable rows.

The operator's ask: "letak clickable option list indicators direct dari LuxAlgo MCP library". The
catalogue was already searchable, but search needs a name to start from; nothing listed it. Three
things must stay true for the list to be a real door rather than decoration:

1. It is FILLED from the catalogue, not from a hardcoded sample — and paged, because 805 rows in one
   paint is not a list anybody can use.
2. A pick goes through the SAME door a search result uses (`openResult`), so there is one executor
   and one run landasan. A second paint path would be a second way to lie about what ran.
3. It is reachable as a COMMAND as well as a click (`browse` in the page's action list, a CLI
   subcommand, an MCP tool) — a surface the agent can only reach by clicking is one it cannot verify.

Plus the honest label: Vela's own "Indicators" menu holds ITS ~76 natives and will never hold these,
so the catalogue needs its own door and the docs must not claim otherwise.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
HTML = os.path.join(ROOT, "console", "frontend", "index.html")
APP = os.path.join(ROOT, "console", "frontend", "app.js")
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")
BRIDGE = os.path.join(ROOT, "console", "frontend", "chart-bridge.js")
CLI = os.path.join(ROOT, "console", "bin", "trader-chart")
MCP = os.path.join(ROOT, "console", "mcp", "server.py")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheListIsReal(unittest.TestCase):
    def test_the_surface_exists(self):
        html = read(HTML)
        for needle in ('id="browse"', 'id="browse-list"', 'id="browse-families"', 'id="browse-more"'):
            self.assertIn(needle, html, f"{needle} is the browsable list")

    def test_indicator_scripts_and_family_concepts_use_distinct_endpoints(self):
        app = read(APP)
        self.assertIn("/api/indicators", app)
        self.assertIn("page_size: BROWSE_PAGE", app)
        self.assertIn("browseState.family", app, "indicator browsing keeps its own state")
        self.assertIn("api('/api/concepts'", app, "family bubbles must fetch their concept taxonomy")

    def test_the_family_row_comes_from_the_catalogue(self):
        # Hand-typed family lists drift from upstream keys; a stale chip silently opens no concepts.
        app = read(APP)
        self.assertIn("/api/families", app)

    def test_a_pick_uses_the_one_door(self):
        app = read(APP)
        block = app.split("function browseRow", 1)[1].split("\n}", 1)[0]
        self.assertIn("openResult(", block,
                      "a catalogue pick must go through the same door a search hit uses")


class TheListCannotDoubleCount(unittest.TestCase):
    """Two overlapping loads appended into one list: a 59-indicator family measured 118 rows.

    The window between a click and its fetch is where this bug lives, so it is pinned in source
    shape rather than by racing the app.
    """

    def test_overlapping_loads_join_instead_of_racing(self):
        # A "newest wins" token cancelled the winning paint (two triggers on one open left the list
        # blank); a join-and-queue keeps the list filled and still prevents double-appending.
        app = read(APP)
        block = app.split("async function loadBrowse", 1)[1].split("\n\n/* Run whatever", 1)[0]
        self.assertIn("browseState.loading", block)
        self.assertIn("drainBrowse", app)
        self.assertIn("browseState.queued", app)
        self.assertNotIn("browseToken", app, "the cancelling token is gone — do not bring it back")

    def test_a_reset_clears_before_it_fills(self):
        app = read(APP)
        block = app.split("async function loadBrowse", 1)[1].split("\n}", 1)[0]
        self.assertIn("browseState.rows = []", block)

    def test_the_bridge_waits_for_the_reset_before_counting(self):
        # "same count twice" fired while the list was cleared-but-not-yet-refilled, reporting 0 rows
        # for a family that has 55. The settle must notice a change happened first.
        bridge = read(BRIDGE)
        block = bridge.split("case 'browse'", 1)[1].split("case 'mode'", 1)[0]
        self.assertIn("sawChange", block)


class TheCatalogueHasOneDoorNow(unittest.TestCase):
    """3 Oct: the ☰ catalogue button (a fourth copy of the list, and it overflowed the 868 px pane) is
    gone. Its job — "land on the open catalogue list" — is a function the agent calls."""

    def test_the_button_is_gone(self):
        self.assertNotIn('id="lib-open"', read(HTML))
        self.assertNotIn("libOpen", read(APP))

    def test_nothing_docks_anything_any_more(self):
        self.assertNotIn("dockScriptButton", read(APP),
                         "the dock is gone: the controls are Vela widget actions now")

    def test_landing_on_the_open_list_is_a_function(self):
        # The operator's earlier complaint was landing on a surface that was present but collapsed.
        app = read(APP)
        block = app.split("function openLibraryBrowse", 1)[1].split("\n}", 1)[0]
        for call in ("setPanel('library', true)", "setLibraryCollapsed(false)", "toggleBrowse(true)"):
            self.assertIn(call, block, f"opening the browse list must {call}")


class ItIsCommandableNotJustClickable(unittest.TestCase):
    def test_the_page_publishes_the_action(self):
        self.assertIn("'browse'", read(BRIDGE))

    def test_the_bridge_reports_the_visible_concept_list(self):
        bridge = read(BRIDGE)
        self.assertIn("out.browse", bridge)
        self.assertIn("browse-concepts-list", bridge)
        self.assertIn("concept(s) on screen", bridge)
        self.assertIn("kind: conceptMode ? 'concepts' : 'indicators'", bridge)

    def test_the_cli_has_a_subcommand(self):
        cli = read(CLI)
        self.assertIn('"browse"', cli)
        self.assertIn("def cmd_browse", cli)

    def test_the_mcp_tool_exists(self):
        self.assertIn("def chart_browse", read(MCP))

    def test_an_omitted_family_means_all_families(self):
        # Leaving the filter alone made "browse" report a stale family's rows to a caller who never
        # asked for one — the read said trend while the request said nothing.
        self.assertIn('payload["family"] = args.family or ""', read(CLI))


class TheDocsSayWhatItIsNot(unittest.TestCase):
    def test_vellas_own_indicators_button_now_opens_the_drawer_that_holds_both_halves(self):
        # Vela's menu lists only its ~76 natives, never the 805 — so taking the button over is only
        # honest if the drawer carries the natives too.
        front = os.path.dirname(HTML)
        self.assertIn("registerWidgetAction", read(os.path.join(front, "workspace.js")))
        self.assertIn("__builtin", read(os.path.join(front, "drawer.js")))


class FamilyChipsRevealConcepts(unittest.TestCase):
    def test_family_chips_disclose_the_matching_concept_list(self):
        html = read(HTML)
        self.assertIn('id="browse-concepts"', html)
        self.assertIn('id="browse-concepts-list"', html)
        self.assertIn('id="browse-concepts-count"', html)

        app = read(APP)
        self.assertIn("async function loadFamilyConcepts", app)
        self.assertIn("api('/api/concepts'", app,
                      "family chips count concepts, not indicator scripts")
        family = app.split("function pickFamily", 1)[1].split("\n}\n\nfunction toggleBrowse", 1)[0]
        self.assertIn("familyConceptState.open", family,
                      "clicking the expanded family again must collapse its list")
        self.assertIn("loadFamilyConcepts", family)
        self.assertNotIn("loadBrowse", family,
                         "a concept-family click must not filter the indicator-script list")
        family_buttons = app.split("async function loadFamilies", 1)[1].split("\n}\n\nfunction pickFamily", 1)[0]
        self.assertIn("aria-controls", family_buttons)
        self.assertIn("aria-expanded", family_buttons)
        self.assertIn("aria-controls", app)
        self.assertIn("aria-expanded", app)

        bridge = read(BRIDGE).split("case 'browse':", 1)[1].split("case 'mode':", 1)[0]
        self.assertIn("browse-concepts-list", bridge)
        self.assertIn("state.loading || state.queued", bridge)

        row = app.split("function browseConceptRow", 1)[1].split("\n}", 1)[0]
        self.assertIn("kind: 'concept'", row)
        self.assertIn("openResult(", row,
                      "concepts use the existing Library details path")


if __name__ == "__main__":
    unittest.main()
