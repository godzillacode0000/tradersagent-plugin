"""Pins for the grouped catalogue: families, group headers, and a reading under every card.

The operator's ask, 27 Sep, in two halves:

  * "categorize each in the library into each own respective concept or aspect or group" — the LIBRARY
    is grouped by the catalogue's own families, with a rail in the nav to jump between them.
  * "each should have another button like collapsible that shows reading about each indicator" — every
    card carries its own write-up (`description`), folded by default, opened in place.

Both need the WHOLE catalogue in the browser, which is why the old paged loader is gone: a page of
sixty cannot count a family it has not paged to, and it could race a section change (26 Sep).
`/api/catalogue` walks the nine pages once, `sort=family`, and keeps the answer on disk.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BACKEND = os.path.join(ROOT, "console", "backend")
SERVER = os.path.join(BACKEND, "server.py")
APP = os.path.join(ROOT, "console", "frontend", "app.js")
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")
HTML = os.path.join(ROOT, "console", "frontend", "index.html")
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
        app = read(APP)
        self.assertIn("async function loadCatalogue()", app)
        self.assertIn("await api('/api/catalogue')", app)
        self.assertIn("function catalogueRows()", app)


class TheGroupsAreReal(unittest.TestCase):
    def test_the_grid_paints_a_header_per_family(self):
        app = read(APP)
        body = app.split("perFamily.entries())", 1)[1].split("/* Warm the pictures", 1)[0]
        self.assertIn("ind-group__head", body)
        self.assertIn("ind-group__name", body)
        self.assertIn("ind-group__n", body, "a group says how many it holds")
        self.assertIn("data-fold", body, "and can be folded away")
        self.assertIn("Show the other ${rest} in", body,
                      "a group longer than the slice offers its tail instead of hiding it")

    def test_the_biggest_group_leads_and_other_trails(self):
        app = read(APP)
        self.assertIn("const tail = (k) => (k.split('/').slice(1).join('/') === 'Other' ? 1 : 0);", app,
                      "\"Other\" (a row's family filed it under no cluster) is a remainder, not a headline")
        self.assertIn("return b[1].length - a[1].length || a[0].localeCompare(b[0]);", app,
                      "and the rest go biggest first")

    def test_picking_a_family_groups_by_its_clusters(self):
        """A family of 108 is still a wall; its clusters ("Moving-average lineage", 17) are the
        concept-level grouping the operator asked for."""
        app = read(APP)
        self.assertIn("const byCluster = Boolean(indState.family);", app)
        body = app.split("function indGroupKey(r) {", 1)[1].split("}", 1)[0]
        self.assertIn("indState.family ? family + '/' +", body)
        self.assertIn("'Other'", body)
        self.assertIn("function indGroupKey(r)", app)
        self.assertIn("catalogueRows().filter((r) => indGroupKey(r) === key)", app,
                      "the \"show the rest\" door must count the SAME groups the grid painted")

    def test_the_nav_carries_the_family_rail(self):
        html = read(HTML)
        self.assertIn('id="ind-fams"', html)
        app = read(APP)
        self.assertIn("function renderFamilies()", app)
        self.assertIn("data-family=", app)
        self.assertIn("window.setIndFamily = setIndFamily;", app,
                      "the door needs a handle on the rail, not just a click")

    def test_an_empty_family_filter_is_everything(self):
        app = read(APP)
        body = app.split("function setIndFamily(key)", 1)[1].split("}", 1)[0]
        self.assertIn("'all'", body, "`--family all` must clear the filter, not search for a family named all")
        cli = read(CLI)
        self.assertIn('payload["family"] = args.family or ""', cli,
                      "an omitted --family means the whole catalogue: a stale filter must not survive")

    def test_the_group_styling_spans_the_grid(self):
        css = read(CSS)
        self.assertIn('.ind-group { grid-column: 1 / -1;', css,
                      "a header is a row of its own, not a card-shaped cell")
        self.assertIn(".ind-group__more {", css)
        self.assertIn(".ind-fam.is-on", css)

    def test_hidden_means_hidden(self):
        """`#ind-more` is a `<button class="btn">`: the author `display` beat the UA `[hidden]`, so the
        page-wide "Load more" kept painting under a grid with per-group doors (27 Sep screenshot)."""
        css = read(CSS)
        self.assertIn("[hidden] { display: none !important; }", css)
        app = read(APP)
        self.assertIn("more.closest('.ind-more')", app)


class TheReadingOpensInPlace(unittest.TestCase):
    def test_the_card_carries_its_own_write_up(self):
        app = read(APP)
        self.assertIn("const about = (opts.about || '').trim();", app)
        self.assertIn('class="ind-card__more" data-about="1"', app)
        self.assertIn('class="ind-card__about"', app)
        self.assertIn("about: r.description", app, "the reading is the row's own description")

    def test_it_starts_folded(self):
        app = read(APP)
        self.assertIn("indState.expanded = {}" if "indState.expanded = {}" in app else "expanded: {}", app)
        body = app.split("function indCard(", 1)[1].split("/** The whole catalogue", 1)[0]
        self.assertIn("const open = Boolean(about && indState.expanded[id]);", body,
                      "806 cards shouting a paragraph each is a wall, not a catalogue")

    def test_the_click_opens_the_reading_not_the_details_pane(self):
        app = read(APP)
        body = app.split("modal.addEventListener('click'", 1)[1].split("modal.addEventListener('keydown'", 1)[0]
        about_at = body.index("[data-about]")
        pane_at = body.index("openResult({ ...row")
        self.assertLess(about_at, pane_at,
                        "the reading branch must answer before the card's door to the Details pane")
        self.assertIn("indState.expanded[id] = !indState.expanded[id];", body)

    def test_the_star_and_the_reading_buttons_are_not_the_card(self):
        """Space on ☆ or ▸ Reading must press that button, not open the Details pane."""
        app = read(APP)
        self.assertIn("if (card && !ev.target.closest('[data-star], [data-about]'))", app)

    def test_the_agent_can_open_a_reading_too(self):
        app = read(APP)
        self.assertIn("window.setIndReading = (slug, on = true)", app)
        bridge = read(BRIDGE)
        self.assertIn("command.reading != null", bridge)
        self.assertIn("reading: reading,", bridge)
        cli = read(CLI)
        self.assertIn('s.add_argument("--reading"', cli)
        self.assertIn('s.add_argument("--family"', cli)


if __name__ == "__main__":
    unittest.main()
