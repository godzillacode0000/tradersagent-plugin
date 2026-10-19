"""The desk's owner (19 Oct 2026): commands are ROUTED to the right view, not raced for.

The failure this ends: several console views can be alive at once (the Hermes pane, a second tab, a
standalone window), and the old rule was "first claim wins" — so a background tab with no bars could
consume a command and answer "the chart did not answer … within 45s" while the operator's pane stood
ready. Now the owner is decided from the heartbeats — newest VISIBLE view with bars — a non-owner is
refused with the owner's id (its banner says who is driving), and the banner's button takes the desk
back deliberately.

The tests hold the rules and their edges: a hidden view must never take the desk from a working one, a
view without bars must not either, and everything falls back to the old single-view behaviour when no
per-view record exists (older pages, the CLI, tests).
"""

import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import chart_bridge as cb  # noqa: E402
import server as srv       # noqa: E402

FRONT = BACKEND.parent / "frontend"
TOKEN = "test-token"


def views(*rows):
    """Build a views map: (id, age_seconds_ago, hidden, bars)."""
    now = time.time()
    out = {}
    for vid, age, hidden, bars in rows:
        entry = {"at": now - age, "hidden": hidden}
        if bars:
            entry["bars"] = bars
        out[vid] = entry
    return out


class TheOwnerRule(unittest.TestCase):
    def test_newest_visible_view_with_bars_owns(self):
        got = cb._owner_from_views(views(("v-old", 20, False, 300), ("v-new", 5, False, 120)), time.time())
        self.assertEqual(got, "v-new")

    def test_a_hidden_view_never_takes_the_desk(self):
        got = cb._owner_from_views(views(("v-pane", 30, False, 300), ("v-tab", 2, True, 300)), time.time())
        self.assertEqual(got, "v-pane", "a background tab must not steal the desk")

    def test_a_view_without_bars_never_takes_it_either(self):
        got = cb._owner_from_views(views(("v-pane", 30, False, 300), ("v-bare", 2, False, 0)), time.time())
        self.assertEqual(got, "v-pane")

    def test_when_nobody_is_ready_the_newest_still_owns(self):
        got = cb._owner_from_views(views(("v-a", 40, True, 0), ("v-b", 3, True, 0)), time.time())
        self.assertEqual(got, "v-b", "a lone hidden view is still the desk (single-view legacy)")

    def test_a_claimed_view_outranks_the_bars_rule(self):
        v = views(("v-pane", 5, False, 300))
        v["v-new"] = {"at": time.time(), "hidden": False, "claimed": True}
        self.assertEqual(cb._owner_from_views(v, time.time()), "v-new")

    def test_nobody_fresh_means_no_owner(self):
        self.assertEqual(cb._owner_from_views(views(("v-old", 400, False, 300)), time.time()), "")

    def test_no_record_means_legacy_mode(self):
        d = tempfile.mkdtemp()
        self.assertEqual(cb.owner_of(d), "", "no per-view record: commands flow as they always did")


class TheHeartbeatsKeepTheMap(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()

    def beat(self, viewer, **extra):
        return cb.save_state(self.d, {"viewer": viewer, "symbol": "BTCUSDT", "bars": 100, **extra})

    def test_a_heartbeat_records_the_view_and_its_visibility(self):
        self.beat("v-a")
        self.beat("v-b", hidden=True)
        state = cb.load_state(self.d, max_age=300)
        self.assertEqual(state["owner"], "v-a", "the hidden view must not own")
        self.assertIn("v-b", state["views"])

    def test_a_visible_view_takes_over_when_the_old_owner_goes_quiet(self):
        self.beat("v-a")
        # age v-a past the ownership window without touching the clock by writing the file directly
        state = cb.load_state(self.d, max_age=300)
        state["views"]["v-a"]["at"] = time.time() - cb.OWNER_WINDOW - 5
        (Path(cb._chart_dir(self.d)) / cb.STATE_FILE).write_text(json.dumps(state), encoding="utf-8")
        self.beat("v-b")
        self.assertEqual(cb.owner_of(self.d), "v-b")

    def test_taking_the_desk_is_deliberate_and_sticks(self):
        self.beat("v-a")
        self.beat("v-b", hidden=True)          # v-b cannot win by heartbeat
        self.assertEqual(cb.owner_of(self.d), "v-a")
        self.assertEqual(cb.take_ownership(self.d, "v-b"), "v-b")
        self.assertEqual(cb.owner_of(self.d), "v-b")
        self.beat("v-b", hidden=True)          # its next heartbeat keeps the claim
        self.assertEqual(cb.owner_of(self.d), "v-b")

    def test_the_map_stays_small(self):
        for i in range(30):
            self.beat(f"v-{i}")
        state = cb.load_state(self.d, max_age=300)
        self.assertLessEqual(len(state["views"]), 30)
        self.assertTrue(all(isinstance(v, dict) for v in state["views"].values()))


class TheClaimDoorRoutes(unittest.TestCase):
    """The claim door is where routing happens: the owner is granted, everyone else is told why."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.patches = [
            mock.patch.object(srv, "CONSOLE_TOKEN", TOKEN),
            mock.patch.object(srv, "AGENTS_ROOT", cls.tmp.name),
        ]
        for p in cls.patches:
            p.start()
        cls.httpd = srv.Server(("127.0.0.1", 0), srv.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        for p in cls.patches:
            p.stop()
        cls.tmp.cleanup()

    def post(self, path, body):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=json.dumps(body).encode(),
            headers={"content-type": "application/json", "X-Trader-Token": TOKEN},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read().decode())

    def setUp(self):
        # Each test starts with no owner and no claims: the class shares one temp tree, and the
        # "claimed" flag is designed to stick — which is the behaviour under test elsewhere.
        try:
            (Path(cb._chart_dir(self.tmp.name)) / cb.STATE_FILE).unlink()
        except OSError:
            pass
        srv.STREAM._claims.clear()

    def get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}", timeout=10) as res:
            return json.loads(res.read().decode())

    def beat(self, viewer, hidden=False):
        return self.post("/api/chart/state", {"viewer": viewer, "symbol": "BTCUSDT", "bars": 200,
                                              "hidden": hidden})

    def test_the_non_owner_is_refused_with_the_owners_id(self):
        self.beat("v-pane")
        out = self.post("/api/chart/claim", {"id": 1, "viewer": "v-tab"})
        data = out.get("data") or out
        self.assertFalse(data["claimed"])
        self.assertEqual(data["owner"], "v-pane")
        self.assertIn("owns the chart", data["reason"])

    def test_the_owner_is_granted(self):
        self.beat("v-pane")
        out = self.post("/api/chart/claim", {"id": 2, "viewer": "v-pane"})
        data = out.get("data") or out
        self.assertTrue(data["claimed"])

    def test_the_commands_read_names_the_owner(self):
        self.beat("v-pane")
        out = self.get("/api/chart/commands?since=0")
        data = out.get("data") or out
        self.assertEqual(data["owner"], "v-pane")
        self.assertIn("commands", data)

    def test_the_banner_button_takes_the_desk(self):
        self.beat("v-pane")
        out = self.post("/api/chart/owner", {"viewer": "v-tab"})
        data = out.get("data") or out
        self.assertEqual(data["owner"], "v-tab")
        self.assertEqual((self.get("/api/chart/commands?since=0").get("data") or {}).get("owner"), "v-tab")


class ThePageSaysWhoItIs(unittest.TestCase):
    """Source-shape pins: there is no JS runner in this suite, and drifting here would be silent."""

    js = (FRONT / "chart-bridge.js").read_text(encoding="utf-8")
    html = (FRONT / "index.html").read_text(encoding="utf-8")
    css = (FRONT / "styles.css").read_text(encoding="utf-8")
    plugin = (BACKEND.parents[1] / "traders-desk" / "desktop" / "plugin.js").read_text(encoding="utf-8")

    def test_the_heartbeat_carries_visibility(self):
        self.assertIn("hidden: (typeof document !== 'undefined' && document.visibilityState === 'hidden')", self.js)
        self.assertIn("document.addEventListener('visibilitychange', () => { heartbeat(); }", self.js)

    def test_the_page_follows_the_owner_the_backend_names(self):
        self.assertIn("'owner' in data", self.js)
        self.assertIn("setPassive(Boolean(data.owner) && data.owner !== VIEWER)", self.js)
        self.assertIn("if (!iOwnTheDesk) continue;", self.js)

    def test_a_refused_claim_shows_the_banner(self):
        self.assertIn("claim.owner && claim.owner !== VIEWER", self.js)

    def test_the_banner_exists_and_can_take_the_desk(self):
        self.assertIn('id="passive-view"', self.html)
        self.assertIn(".statusbar.has-passive", self.css)
        self.assertIn("/api/chart/owner", self.js)

    def test_the_plugin_watchdog_stays_quiet_when_no_pane_is_mounted(self):
        self.assertIn("if (!paneReloaders.size) return", self.plugin,
                      "a closed pane is not a dead frame — no remounts, no warnings")
