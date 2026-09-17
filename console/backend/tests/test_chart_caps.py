"""Command validation against what the page can actually execute.

Measured failure this pins down: `CHART_ACTIONS` in the backend listed an action ("overlay") that the
page had no case for. The command passed validation, the console answered HTTP 200, the page replied
"unknown action" and nothing happened — a silent no-op that read as success. The page now publishes
its own action list in the heartbeat (frontend/chart-bridge.js) and the backend validates against it,
falling back to the built-in set only when no page has ever checked in.
"""

import importlib.util
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, BACKEND_DIR)
SERVER_FILE = os.path.join(BACKEND_DIR, "server.py")


def load_server():
    """Load backend/server.py by path: console/mcp/server.py shares the filename."""
    spec = importlib.util.spec_from_file_location("td_backend_server", SERVER_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


srv = load_server()


class ChartActionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._root = srv.AGENTS_ROOT
        srv.AGENTS_ROOT = self.tmp.name

    def tearDown(self):
        srv.AGENTS_ROOT = self._root
        self.tmp.cleanup()

    def test_falls_back_when_no_page_has_checked_in(self):
        self.assertEqual(srv.chart_actions(), set(srv.CHART_ACTIONS_FALLBACK))

    def test_fallback_does_not_list_unimplemented_actions(self):
        # The regression: 'overlay' was whitelisted while the page had no case for it.
        self.assertNotIn("overlay", srv.CHART_ACTIONS_FALLBACK)
        self.assertTrue({"apply", "add", "draw", "clear", "market", "shot", "probe"} <=
                        srv.CHART_ACTIONS_FALLBACK)

    def test_page_published_actions_win(self):
        srv.save_chart_state(srv.AGENTS_ROOT, {
            "symbol": "BTCUSDT", "timeframe": "15m", "bars": 500,
            "actions": ["apply", "draw", "clear", "shots"],   # a page that cannot do `add`
        })
        supported = srv.chart_actions()
        self.assertEqual(supported, {"apply", "draw", "clear", "shots"})
        self.assertNotIn("add", supported)          # the page is the authority, not the constant
        self.assertNotIn("overlay", supported)

    def test_empty_published_list_falls_back(self):
        srv.save_chart_state(srv.AGENTS_ROOT, {"symbol": "BTCUSDT", "actions": []})
        self.assertEqual(srv.chart_actions(), set(srv.CHART_ACTIONS_FALLBACK))

    def test_garbage_state_falls_back(self):
        srv.save_chart_state(srv.AGENTS_ROOT, {"symbol": "BTCUSDT", "actions": "apply,draw"})
        self.assertEqual(srv.chart_actions(), set(srv.CHART_ACTIONS_FALLBACK))


if __name__ == "__main__":
    unittest.main()
