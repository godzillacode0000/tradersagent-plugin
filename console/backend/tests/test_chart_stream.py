"""The push channel (SSE): a view holds one stream, and the caller gets the answer in the same trip.

What is pinned here is the bookkeeping the SSE handler and the API handlers race over — what counts
as a push, how a result is matched back to its command, and the honest failure of the whole design:
with no view attached nothing is pushed and nobody pretends otherwise. That is the case the tools
report as "no chart view attached", so it is the one worth a test.
"""

import json
import os
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chart_stream import ChartStream


class ChartStreamTest(unittest.TestCase):
    def setUp(self):
        # short timings: the real ones are 8s keepalive / 60s result TTL
        self.stream = ChartStream(keepalive=0.1, result_ttl=0.5)

    def test_no_view_means_nothing_is_pushed_and_nothing_is_claimed(self):
        self.assertEqual(self.stream.client_count(), 0)
        self.assertEqual(self.stream.publish({"action": "add", "native": "ema"}, command_id=1), 0)
        self.assertEqual(self.stream.stats()["pushes"], 0)
        self.assertIsNone(self.stream.result_for(1))

    def test_an_attached_view_receives_the_command_as_json(self):
        cid, inbox = self.stream.attach()
        self.assertEqual(self.stream.client_count(), 1)
        self.assertEqual(self.stream.publish({"action": "add", "native": "ema"}, command_id=7), 1)
        event = json.loads(inbox.get_nowait())
        self.assertEqual(event["action"], "add")
        self.assertEqual(event["native"], "ema")
        self.assertEqual(self.stream.stats()["pushes"], 1)
        self.stream.detach(cid)
        self.assertEqual(self.stream.client_count(), 0)

    def test_every_attached_view_gets_every_command(self):
        _, a = self.stream.attach()
        _, b = self.stream.attach()
        self.assertEqual(self.stream.publish({"action": "market"}), 2)
        self.assertEqual(json.loads(a.get_nowait())["action"], "market")
        self.assertEqual(json.loads(b.get_nowait())["action"], "market")

    def test_a_detached_view_stops_receiving(self):
        cid, _ = self.stream.attach()
        self.stream.detach(cid)
        self.assertEqual(self.stream.publish({"action": "shot"}), 0)

    def test_next_event_times_out_instead_of_blocking_forever(self):
        _, inbox = self.stream.attach()
        started = time.time()
        self.assertIsNone(ChartStream.next_event(inbox, 0.1))     # the handler sends a keepalive then
        self.assertLess(time.time() - started, 2.0)
        inbox.put_nowait("queued")
        self.assertEqual(ChartStream.next_event(inbox, 0.1), "queued")

    def test_a_result_is_stamped_with_the_push_latency(self):
        self.stream.attach()
        self.stream.publish({"action": "shot"}, command_id=3)
        out = self.stream.deliver_result({"id": 3, "ok": True, "detail": "captured"})
        self.assertIn("stream_ms", out)
        self.assertGreaterEqual(out["stream_ms"], 0.0)
        self.assertTrue(self.stream.result_for(3)["ok"])

    def test_wait_for_result_returns_as_soon_as_it_lands(self):
        self.stream.attach()
        self.stream.publish({"action": "apply"}, command_id=5)
        threading.Timer(
            0.05, lambda: self.stream.deliver_result({"id": 5, "ok": True, "detail": "ran in 42 ms"})
        ).start()
        got = self.stream.wait_for_result(5, timeout=2.0)
        self.assertIsNotNone(got)
        self.assertEqual(got["detail"], "ran in 42 ms")

    def test_wait_for_result_gives_up_loudly_by_returning_nothing(self):
        self.assertIsNone(self.stream.wait_for_result(99, timeout=0.15))

    def test_an_expired_result_is_dropped(self):
        self.stream.deliver_result({"id": 6, "ok": True})
        self.assertIsNotNone(self.stream.result_for(6))
        time.sleep(0.6)                                   # ttl is 0.5s
        self.stream.deliver_result({"id": 7, "ok": True})  # any later result prunes the old one
        self.assertIsNone(self.stream.result_for(6))
        self.assertIsNotNone(self.stream.result_for(7))

    def test_a_result_without_a_usable_id_is_passed_through_untouched(self):
        self.assertEqual(self.stream.deliver_result({"ok": True}), {"ok": True})
        odd = {"id": "nonsense", "ok": True}
        self.assertEqual(self.stream.deliver_result(odd), odd)

    def test_the_push_map_does_not_grow_without_bound(self):
        for cid in range(1, 260):
            self.stream.publish({"action": "add"}, command_id=cid)
        self.assertLessEqual(self.stream.stats()["tracking"], 200)

    def test_stats_report_what_the_stream_has_done(self):
        self.stream.attach()
        self.stream.publish({"action": "add"}, command_id=1)
        stats = self.stream.stats()
        self.assertEqual(stats["views"], 1)
        self.assertEqual(stats["pushes"], 1)
        self.assertEqual(stats["dropped"], 0)
        self.assertIsNotNone(stats["last_push_ms"])
        self.assertEqual(stats["keepalive_s"], self.stream.keepalive())


if __name__ == "__main__":
    unittest.main()
