"""The broker's door (Phase 5, 3 Oct): the agent PROPOSES, only the page APPROVES.

The card is the whole point of "paper first, Approve/Reject on every order". If the agent could call
approve, the card would be decoration. So:
  * propose is open to any token holder (the MCP tool, the CLI, the page);
  * approve / reject / reset are refused unless the request carries a local Origin — which a browser
    page always sends on a POST and the MCP/CLI/curl do not. (A deliberate caller can forge a header,
    so this is a guard against the agent doing it by accident or by being talked into it, not a
    security boundary against local malware — the token file is readable by the same user.)
  * the MCP exposes NO approve tool at all. Pinned in the source below.
"""

import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
ROOT = BACKEND.parents[1]

import server as srv  # noqa: E402
from broker import PaperBroker  # noqa: E402


def fresh(price=100.0):
    d = tempfile.mkdtemp()
    srv._BROKER = PaperBroker(os.path.join(d, "paper.json"), lambda s: price, fee=0.0)
    return srv._BROKER


class Published(list):
    def __call__(self, payload, command_id=None):
        self.append(payload)
        return 1


class TheEndpoints(unittest.TestCase):
    def setUp(self):
        fresh()
        self.pub = Published()
        self._real = srv.STREAM.publish
        srv.STREAM.publish = self.pub

    def tearDown(self):
        srv.STREAM.publish = self._real
        srv._BROKER = None

    def test_propose_returns_a_pending_order_and_tells_the_page(self):
        out = srv.broker_action("propose", {"symbol": "btcusdt", "side": "buy", "qty": 1, "note": "x"}, from_page=False)
        self.assertEqual(out["order"]["status"], "pending")
        self.assertEqual(out["order"]["symbol"], "BTCUSDT")
        self.assertEqual(self.pub[-1]["type"], "broker")
        self.assertEqual(self.pub[-1]["event"], "proposed")

    def test_the_agent_cannot_approve(self):
        o = srv.broker_action("propose", {"symbol": "BTCUSDT", "side": "buy", "qty": 1}, from_page=False)["order"]
        for act in ("approve", "reject", "reset"):
            with self.assertRaises(srv.ApiError) as cm:
                srv.broker_action(act, {"id": o["id"]}, from_page=False)
            self.assertEqual(cm.exception.status, 403, act)
            self.assertEqual(cm.exception.code, "approval_needs_the_page")
        self.assertEqual(srv.broker_action("state", {}, from_page=False)["pending"][0]["id"], o["id"])
        self.assertEqual(srv.broker_action("state", {}, from_page=False)["positions"], [])

    def test_the_page_can_approve_and_the_account_moves(self):
        o = srv.broker_action("propose", {"symbol": "BTCUSDT", "side": "buy", "qty": 2}, from_page=False)["order"]
        done = srv.broker_action("approve", {"id": o["id"]}, from_page=True)
        self.assertEqual(done["order"]["status"], "filled")
        self.assertEqual(srv.broker_action("state", {}, from_page=False)["positions"][0]["qty"], 2)
        self.assertEqual(self.pub[-1]["event"], "filled")

    def test_the_page_can_reject(self):
        o = srv.broker_action("propose", {"symbol": "BTCUSDT", "side": "buy", "qty": 2}, from_page=False)["order"]
        self.assertEqual(srv.broker_action("reject", {"id": o["id"]}, from_page=True)["order"]["status"], "rejected")
        self.assertEqual(self.pub[-1]["event"], "rejected")

    def test_broker_errors_become_clear_http_errors(self):
        cases = [(("approve", {"id": 99}), 404, "unknown_order"),
                 (("propose", {"symbol": "BTCUSDT", "side": "hold", "qty": 1}), 400, "bad_side")]
        for (act, body), status, code in cases:
            with self.assertRaises(srv.ApiError) as cm:
                srv.broker_action(act, body, from_page=True)
            self.assertEqual((cm.exception.status, cm.exception.code), (status, code))
        o = srv.broker_action("propose", {"symbol": "BTCUSDT", "side": "buy", "qty": 1}, from_page=False)["order"]
        srv.broker_action("approve", {"id": o["id"]}, from_page=True)
        with self.assertRaises(srv.ApiError) as cm:
            srv.broker_action("approve", {"id": o["id"]}, from_page=True)
        self.assertEqual(cm.exception.status, 409)

    def test_an_unknown_verb_is_refused(self):
        with self.assertRaises(srv.ApiError) as cm:
            srv.broker_action("withdraw", {}, from_page=True)
        self.assertEqual(cm.exception.code, "unknown_endpoint")

    def test_state_is_a_route(self):
        self.assertIn("/api/broker", srv.ROUTES)
        data = srv.ROUTES["/api/broker"][0]({})
        self.assertEqual(data["mode"], "paper")

    def test_the_price_feed_failure_is_a_broker_error_not_a_crash(self):
        from broker import BrokerError
        real = srv._http_json
        srv._http_json = lambda url: (_ for _ in ()).throw(OSError("offline"))
        try:
            with self.assertRaises(BrokerError) as cm:
                srv.binance_price("BTCUSDT")
            self.assertEqual(cm.exception.code, "no_price")
        finally:
            srv._http_json = real


class TheDoorInTheHandler(unittest.TestCase):
    src = (BACKEND / "server.py").read_text(encoding="utf-8")

    def test_the_post_route_decides_from_page_by_the_origin_header(self):
        body = self.src.split('path.startswith("/api/broker")', 1)[1][:900]
        self.assertIn('self.headers.get("Origin")', body)
        self.assertIn("broker_action(", body)

    def test_it_is_in_the_api_index(self):
        self.assertIn('"/api/broker"', self.src.split("API_INDEX = {", 1)[1])


class TheAgentCannotApproveThroughMcp(unittest.TestCase):
    mcp = (ROOT / "console" / "mcp" / "server.py").read_text(encoding="utf-8")

    def test_there_is_no_approve_tool(self):
        names = re.findall(r"^def (\w+)\(", self.mcp, re.M)
        for n in names:
            self.assertNotIn("approve", n)
            self.assertNotIn("reject", n)
        self.assertNotIn("/api/broker/approve", self.mcp)
        self.assertNotIn("/api/broker/reject", self.mcp)

    def test_propose_and_state_exist(self):
        self.assertIn("def broker_propose(", self.mcp)
        self.assertIn("def broker_state(", self.mcp)

    def test_state_is_read_only_and_propose_says_it_waits_for_the_operator(self):
        m = re.search(r'@mcp\.tool\(annotations=_ann\([^\n]*\)\)\ndef broker_propose\(.*?\n    """(.*?)"""', self.mcp, re.S)
        self.assertIsNotNone(m)
        self.assertIn("approve", m.group(1).lower())
        self.assertIn("operator", m.group(1).lower())
        self.assertRegex(self.mcp, r'read_only=True\)\)\ndef broker_state')


class TheLiveCopyCanBoot(unittest.TestCase):
    def test_sync_live_copies_the_broker(self):
        sh = (ROOT / "tools" / "sync-live.sh").read_text(encoding="utf-8")
        self.assertIn("broker.py", sh, "a module missing from the copy list kills the live server at start-up")


class TheCard(unittest.TestCase):
    front = ROOT / "console" / "frontend"
    js = (front / "broker.js").read_text(encoding="utf-8") if (front / "broker.js").exists() else ""

    def test_the_page_loads_it(self):
        self.assertIn('src="./broker.js"', (self.front / "index.html").read_text(encoding="utf-8"))

    def test_the_card_has_approve_and_reject_and_is_hidden_when_nothing_waits(self):
        self.assertIn("data-approve", self.js)
        self.assertIn("data-reject", self.js)
        self.assertIn("hidden", self.js)
        self.assertIn("/api/broker/approve", self.js)
        self.assertIn("/api/broker/reject", self.js)

    def test_it_hears_the_page_stream_and_restores_pending_on_load(self):
        self.assertIn("ta-broker", self.js)
        self.assertIn("/api/broker", self.js)
        self.assertIn("refresh()", self.js)
        bridge = (self.front / "chart-bridge.js").read_text(encoding="utf-8")
        self.assertIn("'broker'", bridge)
        self.assertIn("ta-broker", bridge)

    def test_it_says_paper_and_shows_the_price_it_will_use_is_the_live_one(self):
        self.assertIn("PAPER", self.js)
        self.assertIn("live price", self.js.lower())

    def test_a_refused_fill_shows_the_reason_and_keeps_the_card(self):
        self.assertIn("toast", self.js.lower())

    def test_the_account_is_reachable_from_the_more_menu(self):
        ws = (self.front / "workspace.js").read_text(encoding="utf-8")
        self.assertIn("Paper account", ws)
        self.assertIn("taBroker", ws)

    def test_posts_carry_the_console_token(self):
        """Live defect (3 Oct): Approve answered "missing console token". The page lives in an iframe where
        the SameSite cookie is dropped, so every POST must send X-Trader-Token from /api/session — the
        same bootstrap chart-bridge.js uses."""
        self.assertIn("/api/session", self.js)
        self.assertIn("X-Trader-Token", self.js)

    def test_the_card_does_not_sit_on_the_price_axis_or_the_range_bar(self):
        """Live defect (3 Oct): bottom-right covered the price labels and the 1D..ALL bar. It floats at
        the top of the plot, left of the price axis, instead."""
        css = (self.front / "styles.css").read_text(encoding="utf-8")
        rule = re.search(r"\.ta-orders \{(.*?)\}", css, re.S).group(1)
        self.assertRegex(rule, r"top:\s*\d+px")
        self.assertNotRegex(rule, r"bottom:")
        m = re.search(r"right:\s*(\d+)px", rule)
        self.assertIsNotNone(m, "an offset literal keeps it clear of the axis")
        self.assertGreaterEqual(int(m.group(1)), 72, "the price axis is ~64px wide")

    def test_the_account_popover_clears_the_axis_and_the_cards(self):
        """Live defect (3 Oct): the popover at right:16px covered the price-axis labels. It sits on the LEFT of
        the plot (clear of the ~48px drawing-tools column), so it can never meet the cards on the right."""
        css = (self.front / "styles.css").read_text(encoding="utf-8")
        rule = re.search(r"\.ta-acct \{(.*?)\}", css, re.S).group(1)
        self.assertNotRegex(rule, r"[^-]right:", "right-anchored = on the price axis")
        m = re.search(r"left:\s*(\d+)px", rule)
        self.assertIsNotNone(m)
        self.assertGreaterEqual(int(m.group(1)), 56)
        self.assertRegex(rule, r"top:\s*(9\d|1\d\d)px", "below the OHLC legend row")

    def test_motion_is_transform_and_opacity_only_and_respects_reduced_motion(self):
        css = (self.front / "styles.css").read_text(encoding="utf-8")
        block = css.split(".ta-order", 1)[1]
        self.assertIn("prefers-reduced-motion", css.split(".ta-order", 1)[1])
        self.assertNotRegex(block.split("@media", 1)[0][:2500], r"transition:[^;]*\b(height|width|top|left)\b")


if __name__ == "__main__":
    unittest.main()
