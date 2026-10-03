"""Replay (Phase 6, 3 Oct): Vela's replay engine behind a control strip, an agent door and honest fills.

The operator's calls: the strip lives IN the chart ("jalur kawalan dalam chart") and is started from
the ⋯ menu; the chart stays whole otherwise. While replay is on, a paper fill uses the REPLAY cursor
price instead of the live one — that is what makes replay practice an honest manual backtest.

Two halves pinned here:
  * the backend price rule — the page-only `/api/broker/replay` push, and what approve() fills at;
  * the frontend — the strip, the bridge action, the ⋯ menu item, the card's REPLAY tag, the docs.
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
FRONT = ROOT / "console" / "frontend"


def _read(path) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


import server as srv  # noqa: E402
from broker import PaperBroker  # noqa: E402


class Published(list):
    def __call__(self, payload, command_id=None):
        self.append(payload)
        return 1


class TheReplayPriceIsWhatAFillUses(unittest.TestCase):
    """The one rule that makes replay practice real: while replaying, the fill price is the CURSOR's."""

    def setUp(self):
        srv._REPLAY.update(active=False, price=None, time=None)
        self.live = 200.0
        self._real_price = srv.binance_price
        srv.binance_price = lambda symbol: self.live
        d = tempfile.mkdtemp()
        srv._BROKER = PaperBroker(os.path.join(d, "paper.json"), srv.broker_price, fee=0.0)
        self.pub = Published()
        self._real_pub = srv.STREAM.publish
        srv.STREAM.publish = self.pub

    def tearDown(self):
        srv.binance_price = self._real_price
        srv.STREAM.publish = self._real_pub
        srv._BROKER = None
        srv._REPLAY.update(active=False, price=None, time=None)

    def test_the_page_turns_replay_pricing_on_and_off(self):
        out = srv.broker_action("replay", {"active": True, "price": 123.45, "time": 1790934300000},
                                from_page=True)
        self.assertTrue(out["replay"]["active"])
        st = srv.broker_action("state", {}, from_page=False)
        self.assertEqual(st["replay"]["price"], 123.45)
        self.assertEqual(st["replay"]["time"], 1790934300000)
        srv.broker_action("replay", {"active": False}, from_page=True)
        st = srv.broker_action("state", {}, from_page=False)
        self.assertFalse(st["replay"]["active"])
        self.assertIsNone(st["replay"]["price"])

    def test_the_agent_cannot_set_replay_pricing(self):
        with self.assertRaises(srv.ApiError) as cm:
            srv.broker_action("replay", {"active": True, "price": 1.0}, from_page=False)
        self.assertEqual((cm.exception.status, cm.exception.code), (403, "approval_needs_the_page"))

    def test_replay_on_without_a_price_is_refused_and_changes_nothing(self):
        with self.assertRaises(srv.ApiError) as cm:
            srv.broker_action("replay", {"active": True}, from_page=True)
        self.assertEqual((cm.exception.status, cm.exception.code), (400, "replay_needs_price"))
        self.assertFalse(srv._REPLAY["active"])

    def test_a_fill_uses_the_replay_cursor_price_not_the_live_one(self):
        srv.broker_action("replay", {"active": True, "price": 50.0, "time": 1}, from_page=True)
        o = srv.broker_action("propose", {"symbol": "BTCUSDT", "side": "buy", "qty": 2},
                              from_page=False)["order"]
        filled = srv.broker_action("approve", {"id": o["id"]}, from_page=True)["order"]
        self.assertAlmostEqual(filled["price"], 50.0)
        srv.broker_action("replay", {"active": False}, from_page=True)
        o2 = srv.broker_action("propose", {"symbol": "BTCUSDT", "side": "buy", "qty": 1},
                               from_page=False)["order"]
        filled2 = srv.broker_action("approve", {"id": o2["id"]}, from_page=True)["order"]
        self.assertAlmostEqual(filled2["price"], self.live)

    def test_marks_use_the_replay_price_while_replay_is_on(self):
        srv.broker_action("replay", {"active": True, "price": 50.0, "time": 1}, from_page=True)
        o = srv.broker_action("propose", {"symbol": "BTCUSDT", "side": "buy", "qty": 1},
                              from_page=False)["order"]
        srv.broker_action("approve", {"id": o["id"]}, from_page=True)
        st = srv.broker_action("state", {}, from_page=False)
        self.assertAlmostEqual(st["positions"][0]["mark"], 50.0)

    def test_turning_replay_on_tells_the_page(self):
        srv.broker_action("replay", {"active": True, "price": 7.0, "time": 2}, from_page=True)
        self.assertEqual(self.pub[-1]["type"], "broker")
        self.assertEqual(self.pub[-1]["event"], "replay")
        self.assertTrue(self.pub[-1]["replay"]["active"])


class TheDoorIsPinnedInSource(unittest.TestCase):
    src = _read(BACKEND / "server.py")

    def test_replay_is_a_page_only_broker_verb(self):
        needs = self.src.split("_BROKER_NEEDS_PAGE = (", 1)[1].split(")", 1)[0]
        self.assertIn('"replay"', needs)

    def test_the_price_wrapper_sits_between_the_broker_and_binance(self):
        self.assertIn("def broker_price(", self.src)
        block = self.src.split("def broker_price(", 1)[1].split("\ndef ", 1)[0]
        self.assertIn("_REPLAY", block)
        self.assertIn("binance_price(", block)


class TheControlStrip(unittest.TestCase):
    js = _read(FRONT / "replay.js") if (FRONT / "replay.js").exists() else ""
    html = _read(FRONT / "index.html")
    css = _read(FRONT / "styles.css")
    ws = _read(FRONT / "workspace.js")

    def test_the_page_loads_the_strip_after_the_card(self):
        self.assertIn('src="./replay.js"', self.html)
        self.assertGreater(self.html.index('src="./replay.js"'), self.html.index('src="./broker.js"'))

    def test_the_strip_drives_velas_own_replay_engine(self):
        self.assertIn("ws.replay", self.js)
        for op in ("r.start(", "r.step()", "r.play(", "r.pause()", "r.stop()"):
            self.assertIn(op, self.js, f"the strip must drive ws.replay — {op} missing")

    def test_the_strip_is_hidden_until_replay_is_on(self):
        self.assertIn("el.hidden = true", self.js)
        self.assertIn("state.active", self.js)

    def test_the_strip_carries_play_step_speed_and_exit(self):
        for act in ('data-act="play"', 'data-act="step"', 'data-act="speed"', 'data-act="exit"'):
            self.assertIn(act, self.js)
        self.assertIn("SPEEDS", self.js)

    def test_the_strip_pushes_the_replay_price_to_the_page_only_endpoint(self):
        self.assertIn("/api/broker/replay", self.js)
        self.assertIn("X-Trader-Token", self.js)
        self.assertIn("/api/session", self.js)

    def test_the_strip_hears_the_bridge_and_velas_own_events(self):
        self.assertIn("ta-replay", self.js)
        self.assertIn("replay:start", self.js)
        self.assertIn("replay:tick", self.js)

    def test_the_menu_starts_and_exits_replay(self):
        self.assertIn("taReplay", self.ws)
        self.assertIn("'Replay'", self.ws)

    def test_the_topbar_carries_a_replay_button_with_velas_own_glyph(self):
        self.assertIn("id: 'ta-replay'", self.ws)
        self.assertIn("icon: 'replay'", self.ws)          # Vela's own rewind glyph, from its registry
        self.assertIn("window.addEventListener('ta-replay', rerender)", self.ws)
        self.assertIn("replayAction.label", self.ws)      # the tooltip follows the engine's state

    def test_the_strip_sits_above_the_bottom_axis_and_clears_the_cards(self):
        rule = re.search(r"\.ta-replay \{(.*?)\}", self.css, re.S).group(1)
        self.assertRegex(rule, r"position:\s*fixed")
        self.assertIn("left: 50%", rule)
        self.assertIn("translateX(-50%)", rule)
        m = re.search(r"bottom:\s*(\d+)px", rule)
        self.assertIsNotNone(m, "anchored to the bottom band — the order card owns the top")
        self.assertGreaterEqual(int(m.group(1)), 48, "above the date axis and the statusbar")
        self.assertNotRegex(rule, r"[^-]top:\s*\d", "the top band belongs to the card and the popover")
        self.assertNotRegex(rule, r"[^-]right:\s*\d", "centred — the price axis is on the right")

    def test_motion_is_transform_and_opacity_only(self):
        block = self.css.split(".ta-replay {", 1)[1].split("@media", 1)[0]
        self.assertNotRegex(block, r"transition:[^;]*\b(height|width|top|left)\b")
        self.assertIn("prefers-reduced-motion", self.css.split(".ta-replay", 1)[1])


class TheAgentDoor(unittest.TestCase):
    bridge = _read(FRONT / "chart-bridge.js")

    def test_the_page_publishes_the_replay_action(self):
        self.assertIn("'replay',", self.bridge)

    def test_the_case_drives_the_engine_with_bars_or_from(self):
        body = self.bridge.split("case 'replay': {", 1)[1].split("\n        case ", 1)[0]
        self.assertIn("ws.replay", body)
        self.assertIn("command.bars", body)
        self.assertIn("command.from", body)
        for op in ("'step'", "'play'", "'pause'", "'stop'"):
            self.assertIn(op, body)

    def test_velas_replay_events_are_redispatched_for_the_strip(self):
        self.assertIn("ta-replay", self.bridge)
        for ev in ("replay:start", "replay:step", "replay:tick", "replay:end"):
            self.assertIn(ev, self.bridge)


class TheCardSaysReplay(unittest.TestCase):
    js = _read(FRONT / "broker.js")

    def test_the_card_says_paper_and_switches_to_replay_pricing(self):
        self.assertIn("PAPER", self.js)
        self.assertIn("REPLAY", self.js)
        self.assertIn("replay cursor price", self.js.lower())

    def test_it_still_promises_the_live_price_outside_replay(self):
        self.assertIn("live price", self.js.lower())


class TheMcpDoor(unittest.TestCase):
    mcp = _read(ROOT / "console" / "mcp" / "server.py")
    cli = _read(ROOT / "console" / "bin" / "trader-chart")

    def test_chart_replay_exists_and_sends_the_action(self):
        self.assertIn("def chart_replay(", self.mcp)
        body = self.mcp.split("def chart_replay(", 1)[1].split("\n@mcp.tool", 1)[0]
        self.assertIn('_command("replay"', body)

    def test_the_cli_can_drive_it(self):
        self.assertIn('add_parser("replay"', self.cli)
        self.assertIn("def cmd_replay(", self.cli)

    def test_broker_state_mentions_replay_pricing(self):
        body = self.mcp.split("def broker_state(", 1)[1].split("\n@mcp.tool", 1)[0]
        self.assertIn("replay", body)


if __name__ == "__main__":
    unittest.main()
