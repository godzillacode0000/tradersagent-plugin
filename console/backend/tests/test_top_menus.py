"""The chart row's right-hand corner (31 Oct).

The operator asked for every control there to be checked, and for the ⋯ menu to look like the replay
capsule: one frosted-glass sheet. The check found Alerts dead in a narrow pane (Vela's
openAlertsMenu(anchor) reads the anchor's box with no guard, and the narrow pane has no anchor), a
status pill that called the LuxAlgo Library link "Agent", a status click that only flashed a toast,
a pencil for the script editor beside the drawing tools, and a timeframe list that did not mark the
one in use. topmenus.js holds the menu and the popover.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FRONT = os.path.abspath(os.path.join(HERE, "..", "..", "frontend"))


def read(name: str) -> str:
    with open(os.path.join(FRONT, name), encoding="utf-8") as fh:
        return fh.read()


MENUS, WS, APP, CSS, HTML = (read("topmenus.js"), read("workspace.js"), read("app.js"),
                             read("styles.css"), read("index.html"))


class TheMoreMenu(unittest.TestCase):
    def test_it_is_loaded(self):
        self.assertIn('<script src="./topmenus.js"></script>', HTML)
        self.assertIn("window.taTopMenus = {", MENUS)

    def test_grouped_rows_with_icons_and_state(self):
        for part in ("['Trade', [", "['Chart', [", "ta-more__ic", "ta-more__on", "ta-more__count"):
            self.assertIn(part, MENUS)
        # "On" beside an open panel or a running replay comes from Vela's own state
        self.assertIn("ws.dock.openId === id", MENUS)

    def test_every_row_is_still_the_old_call(self):
        for call in ("window.taDesk.open('paper')", "window.edgeSheet.open()", "window.taReplay.stop()",
                     "window.taReplay.start()", "ws.dock.toggle('dataWindow')", "ws.dock.toggle('objects')",
                     "ws.downloadScreenshot()"):
            self.assertIn(call, MENUS)

    def test_alerts_work_without_an_anchor(self):
        # the list Vela keeps, and the chart that fired it focused with Vela's own call
        self.assertIn("ws.alerts", MENUS)
        self.assertIn("ws.setActiveCell(a.cellId)", MENUS)
        self.assertNotIn("ws.openAlertsMenu(", MENUS)
        self.assertIn("No alerts yet", MENUS)
        self.assertIn("alertcondition()", MENUS, "the empty state says where alerts come from")

    def test_alert_text_is_escaped(self):
        # titles and messages come from scripts; every one goes through esc()
        for field in ("esc(a.title || 'Alert')", "esc(a.message)", "esc(a.source || '')"):
            self.assertIn(field, MENUS)

    def test_keyboard(self):
        for key in ("'ArrowDown'", "'ArrowUp'", "'Home'", "'End'", "'ArrowRight'", "'ArrowLeft'", "'Escape'"):
            self.assertIn(key, MENUS)
        # Esc gives focus back to what opened it (audit 8 Oct, G6)
        self.assertIn("back.focus({ preventScroll: true })", MENUS)

    def test_a_hidden_anchor_is_no_anchor(self):
        body = MENUS.split("function openMore(anchor, ws, opts) {", 1)[1][:300]
        self.assertRegex(body, r"anchor\.getBoundingClientRect\(\)\.width === 0\)\s*anchor = null")

    def test_a_second_press_closes_it(self):
        self.assertIn("isOpen('ta-more') && current ? (current(true), null)", MENUS)


class TheStatus(unittest.TestCase):
    def test_it_is_the_library_not_the_agent(self):
        self.assertIn("'Library: offline'", APP)
        self.assertNotIn("'Agent: ", APP)
        self.assertIn("'Library offline'", APP, "two words in the row, the reason in the popover")
        self.assertIn("s.short || s.text", WS)

    def test_a_click_opens_the_connections_popover(self):
        block = WS.split("id: 'ta-status'", 1)[1].split("};", 1)[0]
        self.assertIn("window.taTopMenus.status(pressed())", block)
        for part in ("Chart data", "LuxAlgo Library", "Check again", "window.taCheckHealth({ quiet: true })"):
            self.assertIn(part, MENUS)
        self.assertIn("window.taCheckHealth = checkHealth;", APP)

    def test_check_again_does_not_toast(self):
        body = APP.split("async function checkHealth(opts) {", 1)[1].split("\n}", 1)[0]
        self.assertIn("if (!ready && !quiet) toast(", body)
        self.assertIn("if (!quiet) toast(", body)

    def test_it_says_what_still_works(self):
        self.assertIn("Only LuxAlgo Library scripts need it.", MENUS)


class TheRowAndVelasMenus(unittest.TestCase):
    def test_the_script_button_is_code_not_a_pencil(self):
        self.assertIn("registerIcon('ta-code'", WS)
        block = WS.split("id: 'ta-script'", 1)[1][:120]
        self.assertIn("icon: 'ta-code'", block)

    def test_the_timeframe_in_use_is_marked(self):
        self.assertIn('.vela-menu[aria-labelledby="vela-topbar-tf"]', MENUS)
        self.assertIn("ta-is-current", MENUS)
        self.assertIn(".vela-menu-item.ta-is-current", CSS)

    def test_one_glass_for_the_corner(self):
        rule = re.search(r"\.ta-glass \{([^}]*)\}", CSS).group(1)
        self.assertIn("backdrop-filter: blur(", rule)
        self.assertIn("color-mix(in srgb, var(--lx-surface-2) 80%, transparent)", rule)
        vela = re.search(r":root \.vela-menu \{([^}]*)\}", CSS).group(1)
        self.assertIn("backdrop-filter: blur(", vela)
        self.assertIn(':root[data-theme="light"] .ta-glass', CSS)
        self.assertIn("@media (prefers-reduced-motion: reduce) { .ta-glass { animation: none; } }", CSS)


if __name__ == "__main__":
    unittest.main()
