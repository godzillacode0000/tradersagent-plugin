"""Study store: one folder per study, and it grows with use.

These tests are the contract the console depends on: a study exists without being configured,
an edit never loses its session or counters, the learnings ledger is append-only, and a
delete is recoverable rather than destructive.
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import agents_store


class StudyStoreTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()

    def test_first_read_seeds_one_general_study(self):
        studies = agents_store.list_studies(self.root)
        self.assertEqual([s["id"] for s in studies], ["desk"])
        self.assertTrue(os.path.exists(os.path.join(self.root, "desk", "index.json")))
        self.assertTrue(os.path.exists(os.path.join(self.root, "desk", "learnings.md")))

    def test_create_read_update(self):
        agents_store.upsert(self.root, {"id": "options", "name": "Options study", "instruction": "GEX, skew."})
        self.assertIsNone(agents_store.load(self.root, "options")["session_id"])
        agents_store.upsert(self.root, {"id": "options", "name": "Options & flow", "instruction": "GEX, skew."})
        self.assertEqual(agents_store.load(self.root, "options")["name"], "Options & flow")
        self.assertEqual(len(agents_store.list_studies(self.root)), 2)

    def test_validation(self):
        for bad in ({"id": "Bad Id", "name": "x", "instruction": "y"},
                    {"id": "ok", "name": "", "instruction": "y"},
                    {"id": "ok", "name": "x", "instruction": ""}):
            with self.assertRaises(ValueError):
                agents_store.upsert(self.root, bad)

    def test_session_and_counters_survive_an_edit(self):
        agents_store.upsert(self.root, {"id": "desk", "name": "Desk", "instruction": "i"})
        agents_store.set_session(self.root, "desk", "20260915_131945_deadbe")
        agents_store.record_run(self.root, "desk", "backtest")
        agents_store.upsert(self.root, {"id": "desk", "name": "Desk renamed", "instruction": "i2"})
        rec = agents_store.load(self.root, "desk")
        self.assertEqual(rec["session_id"], "20260915_131945_deadbe")
        self.assertEqual(rec["counters"], {"runs": 1, "backtests": 1})
        self.assertTrue(rec["last_active"])

    def test_learnings_append_and_tail(self):
        agents_store.upsert(self.root, {"id": "desk", "name": "Desk", "instruction": "i"})
        agents_store.append_learning(self.root, "desk", title="ema-envelope", body="ran in 84 ms; net +1.2%")
        agents_store.append_learning(self.root, "desk", title="fvg", body="refused: for-in")
        tail = agents_store.learnings_tail(self.root, "desk", max_chars=500)
        self.assertIn("ema-envelope", tail)
        self.assertIn("fvg", tail)
        self.assertLessEqual(len(tail), 500)

    def test_delete_moves_to_trash_not_unlink(self):
        agents_store.upsert(self.root, {"id": "temp", "name": "T", "instruction": "i"})
        self.assertTrue(agents_store.delete(self.root, "temp"))
        # the seed study is always present, so the list is exactly the seed afterwards
        self.assertEqual([s["id"] for s in agents_store.list_studies(self.root)], ["desk"])
        self.assertTrue(os.path.isdir(os.path.join(self.root, ".trash")))


if __name__ == "__main__":
    unittest.main()
