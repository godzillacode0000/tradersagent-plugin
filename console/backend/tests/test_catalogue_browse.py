"""Pins for the catalogue's ONE door and its agent paths.

The operator's doc §1/§2 (3 Oct): the Library's search/browse view is deleted — "its job moves into
the drawer" — and the agent's commands must keep working: "chart-bridge 'browse' and 'open' commands
target the drawer's list/detail ids and keep their reply shape (out.browse, out.opened)".

The lessons that cost real time stay pinned:

  * the list cannot double-count: the old paged loader could append one family twice (59 measured as
    118) and needed a queue-and-drain to join overlapping asks. The drawer has no loads to race —
    the catalogue is in memory and the filter is a function of state;
  * landing on the open list is a FUNCTION, not a click: `chart browse --show` used to click the
    ☰ catalogue button, and deleting that button must not take the agent's path with it.
"""

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
APP = os.path.join(ROOT, "console", "frontend", "app.js")
HTML = os.path.join(ROOT, "console", "frontend", "index.html")
DRAWER = os.path.join(ROOT, "console", "frontend", "drawer.js")
BRIDGE = os.path.join(ROOT, "console", "frontend", "chart-bridge.js")
WORKSPACE = os.path.join(ROOT, "console", "frontend", "workspace.js")
CLI = os.path.join(ROOT, "console", "bin", "trader-chart")
MCP = os.path.join(ROOT, "console", "mcp", "server.py")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheListIsTheDrawer(unittest.TestCase):
    def test_the_panel_view_is_gone(self):
        html = read(HTML)
        for gone in ('id="view-library"', 'id="browse-list"', 'id="browse-concepts-list"',
                     'id="browse-body"', 'id="browse-families"', 'id="results"', 'id="search-form"',
                     'id="browse-toggle"', 'id="library-toggle"'):
            self.assertNotIn(gone, html, f"the Library's search/browse view is deleted; {gone} must be gone")
        app = read(APP)
        for gone in ("function toggleBrowse", "function loadBrowse", "function browseRow",
                     "function loadFamilies", "function runSearch", "function renderResults",
                     "function loadFamilyConcepts", "browseState", "familyConceptState"):
            self.assertNotIn(gone, app, f"{gone} belonged to the deleted view")

    def test_the_drawer_holds_the_list(self):
        self.assertIn('id="drawer-list"', read(HTML))
        drawer = read(DRAWER)
        self.assertIn("function rows()", drawer)
        self.assertIn("drow", drawer)

    def test_a_pick_uses_the_one_door(self):
        drawer = read(DRAWER)
        block = drawer.split("if (ev.target.closest('[data-open]'))", 1)[1][:200]
        self.assertIn("openResult(", block,
                      "picking a row must run the same openResult a search hit always ran")


class TheListCannotDoubleCount(unittest.TestCase):
    def test_the_filter_is_a_function_of_state(self):
        """The old loader could append a family twice (59 measured as 118) and needed a queue to join
        overlapping asks. The drawer filters the loaded catalogue in memory: nothing to race."""
        drawer = read(DRAWER)
        self.assertIn("function rows()", drawer)
        self.assertIn("function matches(r, q)", drawer)
        self.assertNotIn("queued", drawer)
        self.assertNotIn("loadLibrary", read(APP))

    def test_the_bridge_waits_for_a_loading_catalogue(self):
        body = read(BRIDGE).split("case 'browse': {", 1)[1].split("case 'open': {", 1)[0]
        self.assertIn("catalogue === 'loading'", body,
                      "a cold page must not report 0 rows while the walk runs")
        self.assertIn("45000", body, "the first walk on a machine is ~25 s")


class TheCatalogueHasOneDoorNow(unittest.TestCase):
    def test_the_button_is_gone(self):
        html = read(HTML)
        for gone in ('id="lib-open"', 'id="library-open"', 'id="ind-open"', 'id="detail-open"'):
            self.assertNotIn(gone, html)

    def test_nothing_docks_anything_any_more(self):
        app = read(APP)
        self.assertNotIn("dockScriptButton", app)
        self.assertNotIn("setInterval(() => dockScriptButton", app)

    def test_landing_on_the_open_list_is_a_function(self):
        """`chart browse --show` used to click the ☰ catalogue button; the door is the drawer's own
        API now, so nothing in the pane has to exist for it."""
        bridge = read(BRIDGE)
        body = bridge.split("case 'browse': {", 1)[1].split("case 'open': {", 1)[0]
        self.assertIn("window.libDrawer", body)
        self.assertIn("ld.open(true)", body)
        self.assertNotIn("openLibraryBrowse", bridge)
        self.assertNotIn("toggleBrowse", bridge)


class ItIsCommandableNotJustClickable(unittest.TestCase):
    def test_the_page_publishes_the_actions(self):
        bridge = read(BRIDGE)
        self.assertIn("'browse',", bridge)
        self.assertIn("'open',", bridge)

    def test_the_bridge_reports_what_the_list_holds(self):
        bridge = read(BRIDGE)
        browse_body = bridge.split("case 'browse': {", 1)[1].split("case 'open': {", 1)[0]
        self.assertIn("out.browse", browse_body)
        self.assertIn("kind: 'indicators'", browse_body)
        open_body = bridge.split("case 'open': {", 1)[1].split("case 'mode'", 1)[0]
        self.assertIn("out.opened", open_body)
        self.assertIn("#drawer-list .drow[data-slug]", open_body,
                      "the row must be found in the drawer's list")

    def test_the_open_waits_work_for_every_branch(self):
        """`pause` was first written inside the indicator branch while the concept branch and the
        shared title-wait used it — `open <concept>` died with "pause is not defined" (measured
        live, 3 Oct). The helper must exist before any branch that uses it."""
        body = read(BRIDGE).split("case 'open': {", 1)[1].split("case 'mode'", 1)[0]
        self.assertLess(body.index("const pause ="), body.index("if (kind === 'concept')"))

    def test_the_cli_has_a_subcommand(self):
        cli = read(CLI)
        self.assertIn('add_parser("browse"', cli)
        self.assertIn('add_parser("open"', cli)

    def test_the_mcp_tool_exists(self):
        mcp = read(MCP)
        self.assertIn("def chart_browse(", mcp, "the catalogue's agent door")
        self.assertIn('_command("browse"', mcp)

    def test_an_omitted_family_means_all_families(self):
        cli = read(CLI)
        self.assertIn('payload["family"] = args.family or ""', cli,
                      "an omitted --family means the whole catalogue: a stale filter must not survive")


class TheDocsSayWhatItIsNot(unittest.TestCase):
    def test_vellas_own_indicators_button_opens_the_drawer_that_holds_all_three_halves(self):
        ws = read(WORKSPACE)
        self.assertIn("registerWidgetAction", ws)
        self.assertIn("'indicators'", ws)
        drawer = read(DRAWER)
        for half in ('__builtin', '__fav', 'Built-ins'):
            self.assertIn(half, drawer)


if __name__ == "__main__":
    unittest.main()
