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


def rule(css, selector):
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return m.group(1) if m else ""


class Drawer(unittest.TestCase):
    def test_hamburger_is_the_first_thing_in_the_topbar(self):
        top = HTML.split('<header class="topbar">', 1)[1]
        self.assertLess(top.index('id="drawer-open"'), top.index('class="brand"'))

    def test_loaded_after_app(self):
        self.assertLess(HTML.index('src="./app.js"'), HTML.index('src="./drawer.js"'))

    def test_markup(self):
        for anchor in ('id="lib-drawer"', 'id="drawer-q"', 'id="drawer-fams"', 'id="drawer-list"',
                       'id="drawer-scrim"', 'id="drawer-now"'):
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
