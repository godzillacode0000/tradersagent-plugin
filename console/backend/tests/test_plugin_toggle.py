"""The sidebar row is a switch: click opens the chart, click again closes it (2 Oct).

The SDK has `revealPane` but no close door, so the plugin owns the pane's REGISTRATION: an
unregistered pane leaves the grid (its siblings take the space) and re-registering puts it back where
the tree remembers it. The open/closed choice survives an app restart via ctx.storage. The palette's
"open" and the status chip always OPEN — only the row toggles.
"""

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CODE = open(os.path.join(ROOT, "plugin/plugin.js"), encoding="utf-8").read()


class RowToggle(unittest.TestCase):
    def test_pane_registration_is_owned(self):
        self.assertIn("function mountPane(", CODE)
        self.assertIn("function unmountPane(", CODE)
        self.assertIn("registerPaneFn = () => ctx.register(PANE_CONTRIB)", CODE)

    def test_pane_is_not_in_the_static_list(self):
        static = CODE.split("const CONTRIBUTIONS = [", 1)[1].split("ctx.registerMany(CONTRIBUTIONS)", 1)[0]
        self.assertNotIn("area: PANES_AREA", static)

    def test_choice_survives_restart(self):
        self.assertIn("ctx_storage.set('paneOpen'", CODE)
        self.assertIn("ctx.storage.get('paneOpen')", CODE)

    def test_row_toggles_and_doors_open(self):
        self.assertIn("paneIntent = 'open'", CODE.split("function openConsole()", 1)[1].split("\n}\n", 1)[0])
        self.assertIn("intent === 'toggle'", CODE)

    def test_palette_has_close(self):
        self.assertIn("tradingDesk.close", CODE)

    def test_visibility_requires_registration(self):
        body = CODE.split("function paneVisible()", 1)[1].split("\n}\n", 1)[0]
        self.assertIn("if (!paneDispose) return false", body)


if __name__ == "__main__":
    unittest.main()
