"""Pins for the Indicators surface — ONE surface now: the drawer.

The operator's doc §1 (3 Oct): "Keep one surface: the left drawer. Put everything from the ⌗ modal
into it. Delete: the ⌗ Indicators modal …". The modal's three halves — ★ favourites, Built-ins 76,
Library 807 — are the drawer's chips, the door is Vela's own Indicators button (taken over through
`registerWidgetAction({ id: 'indicators' })`), and the agent's `indicators` command drives the
DRAWER through its own API.

The facts that cost real time to learn stay pinned:
  1. The store **whitelists** result fields (console/backend/chart_bridge.py). A page that reports a
     new key correctly still arrives here empty, and an empty result reads as "the page said nothing"
     — not as "nobody taught the store this key yet". `layout`, `cells`, `catalog` and `indicators`
     are pinned below for that reason.
  2. The filter is a function of state, not a request. The old paged loader could race a section
     change against a search (measured 26 Sep: `0 row(s) for "supertrend"` while `/api/indicators`
     answered `total 10`); the drawer filters the loaded catalogue in memory, and the paged loader
     must not come back.
  3. BUILT-INS must be read from the frame (`availableNativeIndicators()`), never copied into the
     console: a stale copy offers the operator a study this build cannot mount.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
APP = os.path.join(ROOT, "console", "frontend", "app.js")
HTML = os.path.join(ROOT, "console", "frontend", "index.html")
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")
BRIDGE = os.path.join(ROOT, "console", "frontend", "chart-bridge.js")
DRAWER = os.path.join(ROOT, "console", "frontend", "drawer.js")
STORE = os.path.join(ROOT, "console", "backend", "chart_bridge.py")
CLI = os.path.join(ROOT, "console", "bin", "trader-chart")
MCP = os.path.join(ROOT, "console", "mcp", "server.py")
TOOLS_DOC = os.path.join(ROOT, "docs", "MCP-TOOLS.md")
CATALOG = os.path.join(ROOT, "docs", "plugin-catalog-entry.yaml")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheModalIsGone(unittest.TestCase):
    """§1: "Delete: the ⌗ Indicators modal." Its halves live in the drawer; nothing of it is left."""

    def test_no_modal_markup(self):
        html = read(HTML)
        for gone in ('id="ind-modal"', 'id="ind-grid"', 'id="ind-nav"', 'id="ind-q"',
                     'id="ind-fams"', 'id="ind-count"', 'id="ind-close"', 'id="ind-more"'):
            self.assertNotIn(gone, html, f"the modal is deleted; {gone} must be gone with it")

    def test_no_modal_js(self):
        src = read(APP)
        for gone in ("function openIndicators", "function renderIndicators", "function initIndicators",
                     "function setIndSection", "function setIndSearch", "function setIndFold",
                     "function setIndReading", "function setIndFavourite", "function indCard",
                     "function catalogueRows", "window.openIndicators", "window.indicatorsSurface",
                     "indState.section", "indState.folded", "indState.expanded"):
            self.assertNotIn(gone, src, f"the modal's JS is deleted; {gone} must be gone with it")

    def test_no_modal_css(self):
        css = read(CSS)
        for gone in (".ind-modal", ".ind-grid", ".ind-card", ".ind-nav", ".ind-tab", ".ind-fams",
                     ".ind-group", ".has-ind-modal"):
            self.assertNotIn(gone, css, f"the modal's CSS is deleted; {gone} must be gone with it")

    def test_nothing_initialises_the_modal(self):
        self.assertNotIn("initIndicators()", read(APP))


class TheDrawerIsTheSurface(unittest.TestCase):
    """The drawer holds the three halves and answers the agent, because the modal cannot any more."""

    def test_the_drawer_holds_the_three_halves(self):
        js = read(DRAWER)
        for anchor in ("__fav", "__builtin", "Built-ins"):
            self.assertIn(anchor, js, f"the drawer must hold {anchor}")

    def test_the_drawer_exposes_the_agent_api(self):
        js = read(DRAWER)
        for api in ("search: (q) =>", "family: (f) =>", "function star(spec, on)", "rows: () =>"):
            self.assertIn(api, js, f"the bridge drives the drawer through {api}")

    def test_the_bridge_drives_the_drawer_and_not_the_modal(self):
        bridge = read(BRIDGE)
        self.assertIn("window.libDrawer", bridge)
        self.assertNotIn("openIndicators", bridge)
        self.assertNotIn("indicatorsSurface", bridge)
        for api in ("ld.search(", "ld.family(", "ld.star("):
            self.assertIn(api, bridge, f"the indicators door must use the drawer's {api}")

    def test_built_ins_are_read_from_the_frame_not_copied(self):
        src = read(APP)
        self.assertIn("availableNativeIndicators()", src,
                      "BUILT-INS must come from the chart's own catalogue, not a copy in the console")
        self.assertNotRegex(src, r"NATIVE_(TITLES|CATALOG)\s*=\s*\[",
                            "a hard-coded built-in list would drift from what this build can mount")

    def test_the_filter_is_a_function_of_state_not_a_request(self):
        js = read(DRAWER)
        self.assertIn("function rows()", js, "filtering happens over the loaded catalogue")
        self.assertIn("function matches(r, q)", js)
        self.assertNotIn("loadLibrary", js, "the paged loader and its queue are gone on purpose")

    def test_the_search_looks_at_everything_a_person_would_type(self):
        """`orderblock` must find "Order Block" and `order-blocks`, and the reading counts too."""
        js = read(DRAWER)
        body = js.split("function matches(r, q)", 1)[1].split("}", 1)[0]
        for field in ("r.name", "r.slug", "r.family", "r.cluster", "r.description"):
            self.assertIn(field, body, f"the search must look at {field}")


class TheDoorIsHonest(unittest.TestCase):
    def test_the_store_passes_the_new_fields_through(self):
        store = read(STORE)
        for key in ("layout", "cells", "catalog", "indicators"):
            self.assertRegex(store, rf'"{key}": payload\.get\("{key}"\)',
                             f"the store whitelists results: {key} must be listed or it arrives empty")

    def test_the_bridge_has_both_actions(self):
        src = read(BRIDGE)
        for action in ("'natives'", "'indicators'"):
            self.assertIn(action, src, f"the bridge must accept the {action} action")
        self.assertIn("window.mountNative", src,
                      "mounting from the surface must run the same function a click runs")

    def test_the_cli_and_mcp_expose_them(self):
        cli, mcp, doc = read(CLI), read(MCP), read(TOOLS_DOC)
        self.assertIn('add_parser("natives"', cli)
        self.assertIn('add_parser("indicators"', cli)
        self.assertIn("def chart_natives(", mcp)
        self.assertIn("def chart_indicators(", mcp)
        self.assertIn("chart_natives", doc)
        self.assertIn("chart_indicators", doc)
        listed = re.search(r"chart_natives\b.*?chart_indicators", doc, re.S)
        self.assertIsNotNone(listed, "both tools belong in the tool catalogue")
        self.assertIn("chart_indicators", read(CATALOG),
                      "the plugin catalogue entry lists every tool, and drift fails the docs test")

    def test_the_search_text_is_always_sent(self):
        """An omitted `--q` means "no filter" — a stale one must not survive a call that never asked
        for it (the same lesson `browse --family` already carries)."""
        cli = read(CLI)
        self.assertIn('payload["q"] = args.q or ""', cli)


if __name__ == "__main__":
    unittest.main()
