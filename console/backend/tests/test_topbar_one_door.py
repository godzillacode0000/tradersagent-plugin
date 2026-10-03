"""Pins for the top-bar consolidation (3 Oct): ONE door to indicators, ONE surface behind it.

Before: seven buttons opened four surfaces that listed the same 807 scripts (☰ drawer, ⌗ modal,
☰ Library, ☰ catalogue, ▤ Details, Vela's own Indicators, `<>`). The operator could not tell which
one to press, and two of them overflowed the 868 px pane.

After: Vela's own "Indicators" button is taken over through its official `registerWidgetAction`
override (the only overridable slots are `indicators` and `screenshot`), and it opens the drawer.
The drawer holds both halves — BUILT-INS (Vela's natives) and the LuxAlgo catalogue — because
overriding Vela's button would otherwise cost the operator its ~76 built-ins.

Two facts that cost time to learn, pinned so they stay learned:

  1. Vela reads the override in the VelaWorkspace CONSTRUCTOR (`this.indicatorsOverride =
     topbarActionOverride("indicators")`), so the action must be registered BEFORE `new
     VelaWorkspace(`. Registered late, Vela has already built its own picker and the override
     silently does nothing.
  2. The agent used to reach these surfaces by clicking the buttons (`lib-open`, `ind-open`).
     Deleting a button without moving that path breaks `chart browse --show` and
     `chart_indicators` with no error. They call functions now, and these tests pin it.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FRONT = os.path.join(ROOT, "console", "frontend")


def read(name: str) -> str:
    with open(os.path.join(FRONT, name), encoding="utf-8") as fh:
        return fh.read()


HTML, APP, DRAWER, BRIDGE, WORKSPACE, CSS = (
    read("index.html"), read("app.js"), read("drawer.js"),
    read("chart-bridge.js"), read("workspace.js"), read("styles.css"))


class TheDoorIsVelasOwnIndicatorsButton(unittest.TestCase):
    def test_the_action_is_registered_through_velas_plugin_api(self):
        self.assertIn("registerWidgetAction", WORKSPACE)
        self.assertIn("@luxalgo/vela/plugin", WORKSPACE)

    def test_it_is_registered_before_the_workspace_is_constructed(self):
        reg = WORKSPACE.index("registerWidgetAction({")
        ctor = WORKSPACE.index("new VelaWorkspace(")
        self.assertLess(reg, ctor, "Vela reads the override in its constructor — late is too late")

    def test_it_takes_over_the_indicators_slot_on_the_topbar(self):
        block = WORKSPACE.split("registerWidgetAction({", 1)[1].split("});", 1)[0]
        self.assertRegex(block, r"id:\s*'indicators'")
        self.assertRegex(block, r"target:\s*'topbar'")
        self.assertIn("libDrawer", block, "the door opens the drawer")

    def test_a_failed_registration_does_not_cost_the_chart(self):
        i = WORKSPACE.index("registerWidgetAction({")
        self.assertIn("catch", WORKSPACE[i:i + 2600])


class TheDuplicateDoorsAreGone(unittest.TestCase):
    def test_no_console_button_is_left_for_the_surfaces_the_drawer_replaced(self):
        for gone in ('id="ind-open"', 'id="library-open"', 'id="detail-open"',
                     'id="lib-open"', 'id="drawer-open"'):
            self.assertNotIn(gone, HTML, f"{gone} is a duplicate door")

    def test_app_js_no_longer_wires_or_docks_them(self):
        for gone in ("el.libraryOpen", "el.detailOpen", "el.libOpen", "libOpen:", "#lib-open",
                     "#library-open", "#detail-open"):
            self.assertNotIn(gone, APP, f"app.js still reaches for {gone}")

    def test_the_css_for_deleted_buttons_is_gone_too(self):
        self.assertNotIn("#lib-open", CSS)
        self.assertNotIn("#script-open", CSS)
        self.assertNotIn(".hamburger", CSS)

    def test_script_and_full_screen_are_vela_widget_actions_now(self):
        self.assertNotIn('id="script-open"', HTML)
        self.assertNotIn('id="full-open"', HTML)
        ws = read("workspace.js")
        self.assertIn("id: 'ta-script'", ws)
        self.assertIn("id: 'ta-fullscreen'", ws)
        self.assertIn("window.scriptPane", ws)
        self.assertNotIn("dockScriptButton", APP)
        # bare-chart fallbacks stay available
        self.assertIn('id="script-fallback"', HTML)
        self.assertIn('id="full-fallback"', HTML)


class TheAgentStillHasItsPaths(unittest.TestCase):
    """The agent drove these surfaces by clicking buttons that no longer exist."""

    def test_the_bridge_clicks_no_deleted_button(self):
        for gone in ("'lib-open'", "'ind-open'", "'library-open'", "'detail-open'"):
            self.assertNotIn(f"getElementById({gone})", BRIDGE, f"the bridge still clicks {gone}")

    def test_browse_goes_through_a_function(self):
        self.assertIn("window.openLibraryBrowse", BRIDGE)
        self.assertRegex(APP, r"window\.openLibraryBrowse\s*=")
        body = APP.split("function openLibraryBrowse", 1)[1].split("\n}", 1)[0]
        for call in ("setPanel('library', true)", "setLibraryCollapsed(false)", "toggleBrowse(true)"):
            self.assertIn(call, body, f"opening the browse list must {call}")

    def test_the_indicators_door_goes_through_a_function(self):
        self.assertIn("window.openIndicators", BRIDGE)


class TheDrawerHoldsBothHalves(unittest.TestCase):
    def test_a_builtins_view_reads_velas_natives_and_mounts_through_the_same_function(self):
        self.assertIn("__native", DRAWER)
        self.assertIn("indState.natives", DRAWER)
        self.assertIn("loadNatives()", DRAWER)
        self.assertIn("mountNative(", DRAWER, "a click must run the function a click always ran")

    def test_the_drawer_exposes_open_close_and_toggle(self):
        body = DRAWER.split("window.libDrawer", 1)[1]
        for api in ("open:", "toggle", "state:"):
            self.assertIn(api, body)

    def test_the_drawer_does_not_need_its_own_button(self):
        self.assertNotIn("$id('drawer-open')", DRAWER)


if __name__ == "__main__":
    unittest.main()
