"""Pins for the doc's §2(a), §2(c) and §3 items 6 + 10 (3 Oct).

  (a) "On chart: X + Clear" becomes a CHIP in Vela's row: `● Order Block Detector ✕` (empty: "No
      indicator"). Clicking the name opens the drawer at that row; ✕ clears it. Inside the drawer the
      on-chart row shows `● on chart` and its button reads Remove — "so no separate strip is needed".
  (c) The Details view carries "Edit a copy", which opens the Script pane with the source loaded.
  #10 The status dot rides Vela's row as a widget action; it shows text only when something is wrong.

Vela 0.8.1 facts this rests on (read in vendor/vela/dist, 3 Oct):
  * a widget action's label is read when the row RENDERS, and `VelaWorkspace.refreshActions()`
    re-renders it — so a changing label is "update the descriptor, then refreshActions()";
  * `when(ctx)` is evaluated on every render, which is how ✕ exists only while something is on;
  * `registerIcon(id, svg)` is public, so the dot's colour is its own SVG, not a style we would have to
    re-apply after every re-render (Vela `replaceChildren()`s the row each time).
"""

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FRONT = os.path.join(ROOT, "console", "frontend")


def read(name: str) -> str:
    with open(os.path.join(FRONT, name), encoding="utf-8") as fh:
        return fh.read()


HTML, APP, DRAWER, WS, UNIFIED, CSS, BRIDGE = (
    read("index.html"), read("app.js"), read("drawer.js"), read("workspace.js"),
    read("unified.js"), read("styles.css"), read("chart-bridge.js"))


class TheRunAnnouncesItself(unittest.TestCase):
    def test_the_landasan_fires_one_event_when_what_is_on_changes(self):
        self.assertIn("ta-onchart", UNIFIED, "the chip and the drawer must hear about every change")
        # The overlay holds ONE script, so a landed run REPLACES the list (4 Oct) instead of appending to it.
        push = UNIFIED.split("applied.length = 0;\n    applied.push(name);", 1)[1][:300]
        self.assertIn("announce()", push, "a run that landed must announce it")
        reset = UNIFIED.split("function reset()", 1)[1].split("\n  }", 1)[0]
        self.assertIn("announce()", reset, "a clear must announce it")


class TheChipIsAWidgetAction(unittest.TestCase):
    def test_the_chip_is_registered_before_the_workspace(self):
        self.assertIn("id: 'ta-onchart'", WS)
        self.assertIn("id: 'ta-onchart-clear'", WS)
        self.assertLess(WS.index("id: 'ta-onchart'"), WS.index("new VelaWorkspace("))

    def test_the_chip_sits_with_the_door_on_the_left(self):
        block = WS.split("id: 'ta-onchart'", 1)[1].split("});", 1)[0]
        self.assertIn("align: 'left'", block)

    def test_the_label_is_live(self):
        self.assertIn("refreshActions()", WS, "a changed label only shows after Vela re-renders the row")
        self.assertIn("addEventListener('ta-onchart'", WS)
        self.assertIn("No indicator", WS, "the empty chip says so")

    def test_the_empty_chip_does_not_eat_the_row(self):
        block = WS.split("id: 'ta-onchart'", 1)[1].split("});", 1)[0]
        self.assertIn("when: () => onNames().length > 0", block)
        self.assertIn(".vela-widget-action-left { max-width:", CSS, "a long name ellipsizes")

    def test_the_rerender_does_not_wait_for_a_frame_nobody_paints(self):
        body = WS.split("const rerender = () => {", 1)[1].split("window.addEventListener('ta-onchart'", 1)[0]
        self.assertNotIn("requestAnimationFrame", body, "rAF never fires while the pane is occluded")
        self.assertIn("setTimeout(", body)

    def test_the_x_exists_only_while_something_is_on(self):
        block = WS.split("id: 'ta-onchart-clear'", 1)[1].split("});", 1)[0]
        self.assertIn("when:", block)
        self.assertIn("libDrawer.clear()", block, "✕ clears through the drawer's one clear")

    def test_the_name_opens_the_drawer_at_its_row(self):
        block = WS.split("id: 'ta-onchart'", 1)[1].split("});", 1)[0]
        self.assertIn("libDrawer.reveal(", block)


class TheDrawerMarksTheRowNotAStrip(unittest.TestCase):
    def test_the_strip_is_gone(self):
        self.assertNotIn('id="drawer-now"', HTML)
        self.assertNotIn("function paintNow", DRAWER)
        self.assertNotIn(".drawer__now", CSS)

    def test_the_on_chart_row_reads_remove(self):
        self.assertIn("on chart", DRAWER)
        self.assertIn("data-remove", DRAWER)
        self.assertIn("Remove", DRAWER)
        self.assertIn("is-on", DRAWER)

    def test_one_clear_for_every_door(self):
        self.assertIn("function clearChart()", DRAWER)
        api = DRAWER.split("window.libDrawer = {", 1)[1]
        self.assertIn("clear: clearChart", api)
        self.assertIn("reveal", api)


class TheDetailsViewCanEditACopy(unittest.TestCase):
    def test_the_button_exists_and_opens_the_script_pane(self):
        self.assertIn('id="edit-copy"', APP)
        body = APP.split("$('#edit-copy').addEventListener", 1)[1][:700]
        self.assertIn("script-src", body)
        self.assertIn("(copy)", body)
        self.assertIn("setPanel('script', true)", body)


class TheDotRidesTheRow(unittest.TestCase):
    def test_the_dot_is_a_widget_action_with_its_own_coloured_icons(self):
        self.assertIn("id: 'ta-status'", WS)
        self.assertIn("registerIcon", WS)
        for state in ("ta-dot-ok", "ta-dot-wait", "ta-dot-bad"):
            self.assertIn(state, WS)

    def test_the_dot_shows_text_only_when_something_is_wrong(self):
        block = WS.split("id: 'ta-status'", 1)[1].split("});", 1)[0]
        self.assertIn("iconOnly", block)
        self.assertIn("bad", block)

    def test_the_status_announces_itself(self):
        self.assertIn("ta-status", APP)
        body = APP.split("function paintStatus()", 1)[1].split("\n}", 1)[0]
        self.assertIn("window.taStatus", body)
        self.assertIn("dispatchEvent", body)

    def test_the_statusbar_dot_is_only_the_bare_chart_fallback(self):
        self.assertIn("el.dot", APP.split("const showFallbacks", 1)[1][:900])


class TheRowFitsTheNarrowPane(unittest.TestCase):
    """Measured 3 Oct: Vela's row needed 884-888 px in an 809-868 px pane, so Alerts / Data window /
    Object tree / Screenshot fell outside it and could not be clicked. Those four are rare; they move
    behind ONE `⋯` button, using Vela's own `topbar` composition option (not CSS hiding)."""

    def test_the_composition_drops_the_rare_buttons(self):
        block = WS.split("new VelaWorkspace(", 1)[1].split("});", 1)[0]
        self.assertIn("topbar:", block)
        right = block.split("right:", 1)[1].split("]", 1)[0]
        self.assertIn("'actions'", right, "our own actions (script, dot, full screen, ⋯) ride 'actions'")
        for gone in ("alerts", "panels", "screenshot"):
            self.assertNotIn(gone, right)

    def test_the_default_left_is_kept(self):
        block = WS.split("new VelaWorkspace(", 1)[1].split("});", 1)[0]
        left = block.split("left:", 1)[1].split("]", 1)[0]
        for keep in ("symbol", "timeframes", "style", "layout", "indicators", "actions", "undo-redo"):
            self.assertIn(keep, left)

    def test_one_more_button_is_registered_before_the_workspace(self):
        self.assertIn("id: 'ta-more'", WS)
        self.assertLess(WS.index("id: 'ta-more'"), WS.index("new VelaWorkspace("))

    def test_the_menu_reaches_all_four_through_vela(self):
        body = WS.split("function openMoreMenu", 1)[1][:2600]
        self.assertIn("openAlertsMenu", body)
        self.assertIn("dock.toggle('dataWindow'", body)
        self.assertIn("dock.toggle('objects'", body)
        self.assertIn("downloadScreenshot", body)

    def test_the_menu_closes_itself_and_obeys_escape(self):
        body = WS.split("function openMoreMenu", 1)[1][:2600]
        self.assertIn("Escape", body)
        self.assertIn("pointerdown", body)
        self.assertIn("role", body)

    def test_the_more_button_has_a_glyph(self):
        self.assertIn("registerIcon('ta-more'", WS, "Vela ships no 'more' icon, so the button would be blank")
        self.assertIn("icon: 'ta-more'", WS)

    def test_the_menu_is_styled_with_tokens(self):
        self.assertIn(".ta-more", CSS)
        self.assertIn("var(--lx-", CSS.split(".ta-more", 1)[1][:900])


if __name__ == "__main__":
    unittest.main()
