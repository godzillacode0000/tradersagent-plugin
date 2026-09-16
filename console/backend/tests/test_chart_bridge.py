"""The chart bridge: the agent <-> live Vela chart handshake.

These tests pin the contract the agent tools depend on: the agent can read what the chart
shows, ask for something to happen on it, and find out what actually happened.
"""

import base64
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import chart_bridge as cb


def make_png(w=200, h=150) -> str:
    """A genuine PNG (varying pixels) built from the stdlib, so no image library is needed.

    It is deliberately big enough to pass the "this is too small to be a chart" guard that
    exists to reject placeholder junk.
    """
    import struct
    import zlib

    rows = [bytes(((x * 7 + y * 13) % 256) for x in range(w)) for y in range(h)]
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6))
           + chunk(b"IEND", b""))
    return "data:image/png;base64," + base64.b64encode(png).decode()


PNG = make_png()


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_state_means_chart_not_open(self):
        state = cb.load_state(self.root)
        self.assertFalse(state["open"])
        self.assertIn("reported", state["reason"])

    def test_state_round_trip_and_open_window(self):
        cb.save_state(self.root, {"symbol": "BTCUSDT", "timeframe": "1h", "last": 77434.5,
                                  "natives": ["volume", "donchian-channels"]})
        state = cb.load_state(self.root)
        self.assertTrue(state["open"])
        self.assertEqual(state["symbol"], "BTCUSDT")
        self.assertEqual(state["last"], 77434.5)
        self.assertIn("donchian-channels", state["natives"])

    def test_a_stale_heartbeat_reports_closed_and_says_why(self):
        cb.save_state(self.root, {"symbol": "BTCUSDT"})
        p = self.root / "_chart" / cb.STATE_FILE
        old = json.loads(p.read_text("utf-8"))
        old["at"] = time.time() - 600
        p.write_text(json.dumps(old), "utf-8")
        state = cb.load_state(self.root)
        self.assertFalse(state["open"])
        self.assertIn("heartbeat", state["reason"])

    def test_a_heartbeat_records_the_picture(self):
        cb.save_state(self.root, {"symbol": "BTCUSDT", "shot": PNG})
        state = cb.load_state(self.root)
        shot = Path(state["shot"])
        self.assertTrue(shot.exists())
        self.assertGreater(shot.stat().st_size, 128)

    def test_a_tiny_placeholder_picture_is_refused(self):
        # a 1x1 blank is what a broken capture looks like: it must not be passed off as the chart
        tiny = "data:image/png;base64," + base64.b64encode(b"x" * 40).decode()
        state = cb.save_state(self.root, {"symbol": "BTCUSDT", "shot": tiny})
        self.assertNotIn("shot", state)

    def test_a_heartbeat_without_a_picture_keeps_the_previous_one(self):
        cb.save_state(self.root, {"symbol": "BTCUSDT", "shot": PNG})
        first = cb.load_state(self.root)["shot"]
        cb.save_state(self.root, {"symbol": "ETHUSDT"})
        state = cb.load_state(self.root)
        self.assertEqual(state["shot"], first)
        self.assertEqual(state["symbol"], "ETHUSDT")

    def test_enqueue_and_commands_since(self):
        a = cb.enqueue(self.root, {"action": "add", "native": "ema"})
        b = cb.enqueue(self.root, {"action": "market", "symbol": "ETHUSDT", "timeframe": "15m"})
        self.assertEqual((a["id"], b["id"]), (1, 2))
        self.assertEqual([c["id"] for c in cb.commands_since(self.root, 0)], [1, 2])
        self.assertEqual([c["id"] for c in cb.commands_since(self.root, 1)], [2])
        self.assertEqual(cb.commands_since(self.root, 2), [])

    def test_result_records_what_actually_happened(self):
        cmd = cb.enqueue(self.root, {"action": "apply", "pine": "plot(close)"})
        self.assertIsNone(cb.get_result(self.root, cmd["id"]))
        cb.record_result(self.root, {"id": cmd["id"], "ok": True,
                                     "detail": "ran in 61 ms", "series": 3})
        got = cb.get_result(self.root, cmd["id"])
        self.assertTrue(got["ok"])
        self.assertEqual(got["series"], 3)
        self.assertEqual(got["detail"], "ran in 61 ms")

    def test_a_result_carries_the_picture_back_to_the_agent(self):
        cmd = cb.enqueue(self.root, {"action": "shot"})
        cb.record_result(self.root, {"id": cmd["id"], "ok": True, "shot": PNG})
        got = cb.get_result(self.root, cmd["id"])
        self.assertTrue(Path(got["shot"]).exists())
        self.assertFalse(got.get("detail"))

    def test_an_unusable_picture_is_reported_not_silently_dropped(self):
        cmd = cb.enqueue(self.root, {"action": "shot"})
        cb.record_result(self.root, {"id": cmd["id"], "ok": True, "shot": "data:image/png;base64,eA=="})
        got = cb.get_result(self.root, cmd["id"])
        self.assertNotIn("shot", got)
        self.assertIn("unusable", got["detail"])


if __name__ == "__main__":
    unittest.main()
