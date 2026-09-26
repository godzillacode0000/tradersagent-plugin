"""Pins for the Indicators surface: one modal for BUILT-INS + LIBRARY + favourites.

Same convention as the repo's other UI pins (no JS runner here): a behaviour that would only be
visible by eye is pinned as a shape in the source, plus the facts that cost real time to learn on
26 Sep 2026, live:

  1. The store **whitelists** result fields (console/backend/chart_bridge.py). A page that reports a
     new key correctly still arrives here empty, and an empty result reads as "the page said nothing"
     — not as "nobody taught the store this key yet". `layout`, `cells`, `catalog` and `indicators`
     are pinned below for that reason.
  2. A section change and a search text in the same breath race. The door sends both, the first load
     runs with the OLD query, and the second request — the one carrying the text — was dropped while
     the first was in flight: measured as `0 row(s) for "supertrend"` while `/api/indicators` answered
     `total 10`. The queue-and-drain is pinned here.
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
BRIDGE = os.path.join(ROOT, "console", "frontend", "chart-bridge.js")
STORE = os.path.join(ROOT, "console", "backend", "chart_bridge.py")
CLI = os.path.join(ROOT, "console", "bin", "trader-chart")
MCP = os.path.join(ROOT, "console", "mcp", "server.py")
TOOLS_DOC = os.path.join(ROOT, "docs", "MCP-TOOLS.md")
CATALOG = os.path.join(ROOT, "docs", "plugin-catalog-entry.yaml")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheSurfaceExists(unittest.TestCase):
    def test_the_modal_and_its_door_are_in_the_page(self):
        html = read(HTML)
        for anchor in ("id=\"ind-modal\"", "id=\"ind-open\"", "id=\"ind-q\"", "id=\"ind-grid\"",
                       "id=\"ind-nav\"", 'data-section="favorites"'):
            self.assertIn(anchor, html, f"the Indicators surface needs {anchor}")

    def test_built_ins_are_read_from_the_frame_not_copied(self):
        src = read(APP)
        self.assertIn("availableNativeIndicators()", src,
                      "BUILT-INS must come from the chart's own catalogue, not a copy in the console")
        self.assertNotRegex(src, r"NATIVE_(TITLES|CATALOG)\s*=\s*\[",
                            "a hard-coded built-in list would drift from what this build can mount")

    def test_a_library_request_arriving_mid_flight_is_queued(self):
        src = read(APP)
        self.assertRegex(src, r"if \(lib\.loading\) \{ lib\.queued =",
                         "a search that lands while a load is running must be queued, not dropped")
        self.assertIn("loadLibrary(queued === 'reset')", src,
                      "the queued ask has to actually run once the first load finishes")
        self.assertIn("queued: null", src, "the queue must exist in the state shape")

    def test_the_servers_answer_is_not_filtered_again_by_the_page(self):
        """The catalogue's search is not a substring match: `orderblock` answers with `order-blocks`
        and "Order Block". A local `includes()` re-filter painted 0 rows over a 2-row answer."""
        src = read(APP)
        self.assertIn("indState.library.query !== indState.q", src,
                      "client-side filtering may only run on rows the server did not answer for")


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
        self.assertIn("window.indicatorsSurface", src,
                      "the door reports the rows the grid painted, not just that it opened")
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
