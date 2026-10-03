"""The ☰ drawer: the LuxAlgo catalogue one click from the chart, with a one-click Run (3 Oct).

The operator asked for "a hamburger menu above the chart area" holding every LuxAlgo Library script.
It slides in from the left over the chart (transform/opacity only — the laptop is a 2016 Pavilion),
searches the whole catalogue in memory, groups by family, stars favourites in the SAME list the
Indicators surface uses, and its Run goes through TraderRun like every other door.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


HTML = read("console/frontend/index.html")
CSS = read("console/frontend/styles.css")
JS = read("console/frontend/drawer.js")
APP = read("console/frontend/app.js")


def rule(css, selector):
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return m.group(1) if m else ""


class Drawer(unittest.TestCase):
    def test_the_door_is_velas_indicators_button_not_a_console_hamburger(self):
        self.assertNotIn('id="drawer-open"', HTML)
        self.assertNotIn("hamburger", HTML)
        ws = open(os.path.join(os.path.dirname(os.path.join(ROOT, "console", "frontend", "index.html")),
                               "workspace.js"), encoding="utf-8").read()
        self.assertIn("window.libDrawer.toggle()", ws)

    def test_loaded_after_app(self):
        self.assertLess(HTML.index('src="./app.js"'), HTML.index('src="./drawer.js"'))

    def test_markup(self):
        for anchor in ('id="lib-drawer"', 'id="drawer-q"', 'id="drawer-fams"', 'id="drawer-list"',
                       'id="drawer-scrim"'):
            self.assertIn(anchor, HTML)

    def test_run_goes_through_the_landasan(self):
        self.assertIn("window.TraderRun.run(", JS)
        self.assertIn("api('/api/source'", JS)

    def test_shares_catalogue_and_favourites(self):
        self.assertIn("loadCatalogue()", JS)
        self.assertIn("toggleFavourite(", JS)
        self.assertNotIn("localStorage.setItem", JS)   # no second favourites store

    def test_motion_is_cheap(self):
        body = rule(CSS, ".lib-drawer")
        self.assertIn("transform", body)
        self.assertNotIn("width:", rule(CSS, ".lib-drawer.is-open"))
        self.assertIn("prefers-reduced-motion", CSS.split(".lib-drawer", 1)[1])

    def test_escape_closes_it_first(self):
        self.assertIn("closeDrawerIfOpen", read("console/frontend/app.js"))

    def test_readback_for_the_agent(self):
        self.assertIn("window.libDrawer", JS)


if __name__ == "__main__":
    unittest.main()


class TheDetailIsADrawerView(unittest.TestCase):
    """The operator's doc §1 (3 Oct): "Details: delete as a button. Details become a view inside the
    drawer." The right column keeps the Pine editor; a picked result renders in the drawer, with a
    way back to the list — one surface over the chart instead of a close-then-reopen dance."""

    def test_the_detail_element_lives_inside_the_drawer(self):
        drawer = HTML.split('id="lib-drawer"', 1)[1].split('</aside>', 1)[0]
        for anchor in ('id="drawer-detail"', 'id="drawer-detail-back"', 'id="detail"'):
            self.assertIn(anchor, drawer)

    def test_the_right_column_no_longer_hosts_it(self):
        column = HTML.split('class="panel panel--right"', 1)[1].split('</section>', 1)[0]
        self.assertNotIn('id="detail"', column)
        self.assertIn('id="view-script"', column)

    def test_picking_a_row_keeps_the_drawer_open(self):
        block = JS.split("if (ev.target.closest('[data-open]'))", 1)[1][:200]
        self.assertIn('openResult', block)
        self.assertNotIn('setOpen(false)', block,
                         "the old dance closed the drawer and reopened the column; the pick IS the drawer's second view now")

    def test_the_drawer_has_a_detail_view_state(self):
        self.assertIn('function showDetail', JS)
        self.assertIn("'is-detail'", JS)
        self.assertIn('detail:', JS)                    # the API surface app.js calls
        self.assertIn('drawer-detail-back', JS)

    def test_going_back_shows_the_list_again(self):
        block = JS.split('back.addEventListener', 1)[1][:400]
        self.assertIn('showDetail(false)', block)

    def test_closing_the_drawer_returns_to_the_list(self):
        block = JS.split('function setOpen', 1)[1].split('\n  }', 1)[0]
        self.assertIn('showDetail(false)', block, "reopening must show the catalogue, not a stale pick")

    def test_a_picked_result_opens_the_drawer(self):
        self.assertIn('window.libDrawer.detail(true)', APP)

    def test_the_detail_hides_while_the_list_shows(self):
        block = CSS.split('.lib-drawer.is-detail', 1)[1].split('}', 1)[0]
        for part in ('drawer__list', 'drawer__search'):
            self.assertIn(part, block)

    def test_the_column_view_switch_no_longer_touches_the_drawers_detail(self):
        block = APP.split('function showRightView', 1)[1].split('\n}', 1)[0]
        self.assertIn('view-script', block)
        self.assertNotIn('el.detail', block,
                         "hiding the column view must not hide the drawer's detail element")

    def test_the_editor_is_the_only_column_view_at_boot(self):
        self.assertIn("showRightView('script');", APP)


    def test_the_hidden_attribute_can_actually_hide_the_detail(self):
        """`display: flex` on the container outranks the UA's `[hidden] { display: none }`, so without
        an explicit rule the detail would sit under the list even when hidden."""
        self.assertIn('.drawer__detail[hidden]', CSS)
