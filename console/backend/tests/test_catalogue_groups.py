"""Pins for the catalogue's grouping: families, their counts, and where a row's write-up lives.

The operator's ask, 27 Sep, in two halves:

  * "categorize each in the library into each own respective concept or aspect or group" — the
    catalogue is grouped by its own families. The ⌗ modal's grouped grid is deleted (3 Oct, the
    operator's doc §1), so the grouping is the DRAWER's chips: All · Built-ins · ★ Favourites · one
    per family, each with its count, and the search narrows them all together.
  * "each should have another button like collapsible that shows reading about each indicator" — the
    write-up is no longer unfolded on a card: a row opens the DETAIL view inside the drawer (source,
    write-up, licence line), and the agent reads the same text from `rows[].reading`.

Both need the WHOLE catalogue in the browser, which is why the old paged loader is gone: a page of
sixty cannot count a family it has not paged to, and it could race a section change (26 Sep).
`/api/catalogue` walks the nine pages once, `sort=family`, and keeps the answer on disk.
"""

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BACKEND = os.path.join(ROOT, "console", "backend")
SERVER = os.path.join(BACKEND, "server.py")
APP = os.path.join(ROOT, "console", "frontend", "app.js")
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")
HTML = os.path.join(ROOT, "console", "frontend", "index.html")
DRAWER = os.path.join(ROOT, "console", "frontend", "drawer.js")
BRIDGE = os.path.join(ROOT, "console", "frontend", "chart-bridge.js")
CLI = os.path.join(ROOT, "console", "bin", "trader-chart")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheCatalogueComesInOnePiece(unittest.TestCase):
    def test_the_endpoint_walks_the_pages_once_and_keeps_them(self):
        src = read(SERVER)
        self.assertIn('"/api/catalogue"', src)
        body = src.split("def ep_catalogue(", 1)[1].split("\ndef ", 1)[0]
        self.assertIn('"sort": ["family"]', body,
                      "the server's own grouping means the rows arrive clustered and the page can walk them")
        self.assertIn("CATALOGUE_PAGE", body, "the MCP caps a page at 100 rows; the walk has to loop")
        self.assertIn('os.path.join(AGENTS_ROOT, "catalogue.json")', body, "kept on disk, across restarts")
        self.assertIn("_stale(saved, CATALOGUE_TTL)", body, "and refreshed when it goes stale")
        self.assertIn('"groups"', body, "the answer carries the family names and counts, not just rows")

    def test_the_second_walk_is_what_files_the_unfiled(self):
        """Half the catalogue carries no family; its CONCEPTS do. Walk them and 390 of 414 rows land
        in a real group (measured 27 Sep) — otherwise the rail opens with a 414-row "Unfiled"."""
        src = read(SERVER)
        body = src.split("def ep_catalogue(", 1)[1].split("\ndef ", 1)[0]
        self.assertIn("ep_concepts(", body, "the concept walk shares the catalogue's cache and TTL")
        self.assertIn('concept = concepts.get(row.get("slug") or "")', body)
        self.assertIn('row["family"] = concept.get("family")', body)
        self.assertIn('row["cluster"] = concept.get("cluster")', body)
        self.assertIn('"clusters"', body, "a group says which clusters it holds and how big each is")

    def test_a_page_of_sixty_could_never_have_answered_this(self):
        src = read(SERVER)
        self.assertIn("CATALOGUE_MAX_PAGES = 20", src, "a runaway walk needs a guard rail")
        self.assertIn("CATALOGUE_TTL = 12 * 3600", src)

    def test_the_page_loads_it_once_and_filters_in_memory(self):
        app, drawer = read(APP), read(DRAWER)
        self.assertIn("async function loadCatalogue()", app)
        self.assertIn("await api('/api/catalogue')", app)
        self.assertIn("function rows()", drawer, "the filter is a function of state, over the loaded rows")
        self.assertIn("function matches(r, q)", drawer)


class TheChipsAreTheGrouping(unittest.TestCase):
    """The modal's grouped grid is deleted; its grouping is the drawer's chips, with the same counts."""

    def chips_body(self):
        drawer = read(DRAWER)
        return drawer.split("function paintFamilies()", 1)[1].split("function paintNow()", 1)[0]

    def test_the_chips_carry_every_family_and_its_count(self):
        body = self.chips_body()
        self.assertIn("chip('', 'All', hits.length)", body)
        self.assertIn("chip('__builtin', 'Built-ins'", body)
        self.assertIn("chip('__fav', '★ Favourites'", body)
        for field in ("g.name", "g.count", "g.key"):
            self.assertIn(field, body, f"the family chips come from the catalogue's own groups ({field})")
        self.assertIn("data-fam=", body, "a chip is a handle, not a label")

    def test_the_counts_follow_the_search(self):
        body = self.chips_body()
        self.assertIn("hits.filter", body, "a family with no hit steps aside while the search is up")
        self.assertIn("!q || n(g.key) > 0 || st.family === g.key", body)

    def test_a_family_chip_narrows_the_list(self):
        drawer = read(DRAWER)
        self.assertIn("st.family = b.dataset.fam;", drawer)
        self.assertIn("else if (st.family && (r.family || 'unfiled') !== st.family) return false;", drawer)
        self.assertIn("family: (f) =>", drawer, "the agent narrows through the same state the chips write")
        cli = read(CLI)
        self.assertIn('payload["family"] = args.family or ""', cli,
                      "an omitted --family means the whole catalogue: a stale filter must not survive")

    def test_an_empty_family_filter_is_everything(self):
        drawer = read(DRAWER)
        body = drawer.split("family: (f) =>", 1)[1].split("},", 1)[0]
        self.assertIn("'all'", body, "`--family all` must clear the filter, not search for a family named all")

    def test_the_chip_styling_exists(self):
        css = read(CSS)
        self.assertIn(".dchip", css, "the chips are the drawer's own control")
        self.assertIn(".dchip.is-on", css)


class TheWriteUpLivesInTheDetailView(unittest.TestCase):
    """§2(c): "Details … inside the drawer, as a second view. It has: Run, source, write-up, licence." """

    def test_the_detail_renders_the_write_up(self):
        app = read(APP)
        self.assertIn("await api('/api/concept'", app)
        self.assertIn("renderMarkdown(body.slice(0, 14000))", app)
        html = read(HTML)
        drawer = html.split('id="lib-drawer"', 1)[1].split("</aside>", 1)[0]
        self.assertIn('id="detail"', drawer, "the write-up renders inside the drawer, not a column")

    def test_a_row_opens_the_detail(self):
        drawer = read(DRAWER)
        block = drawer.split("if (ev.target.closest('[data-open]'))", 1)[1][:200]
        self.assertIn("openResult(", block)

    def test_the_agent_reads_the_same_text(self):
        bridge = read(BRIDGE)
        self.assertIn("reading: r.description || ''", bridge,
                      "the write-up the card used to unfold is reported per row")
        self.assertNotIn("command.reading", bridge, "the card unfold is gone; the rows carry the text")


class HiddenMeansHidden(unittest.TestCase):
    def test_the_state_rule_beats_author_displays(self):
        """A `<button class="btn">` or a flex container carries an author `display`, and an author
        `display` beats the UA sheet's `[hidden]` — both cost a live sighting to learn."""
        css = read(CSS)
        self.assertIn("[hidden] { display: none !important; }", css)
        self.assertIn(".drawer__detail[hidden] { display: none; }", css)


if __name__ == "__main__":
    unittest.main()
