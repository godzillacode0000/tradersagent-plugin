"""The Edge Stats tier against the REAL engine (LuxAlgo/edge-stats), when one is installed.

CI does not install Node or the engine, so this skips there — and runs on any machine that has done
`./install.sh --with-edge` (or sets EDGESTATS_ENGINE to a checkout). It exists because the fake engine in
edge_fakes.py proves the plugin's logic, but only the real one can prove the plugin's ASSUMPTIONS about
it: the command line, the lock, the JSON shapes, and that a demo store really answers the numbers the
upstream README quotes (the demo bars are seeded, so they are deterministic everywhere).
"""

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import edgestats  # noqa: E402


def real_engine() -> Path | None:
    candidates = [os.environ.get("EDGESTATS_ENGINE"),
                  str(Path.home() / ".local/share/traders-agent/edge/engine"),
                  str(Path(os.environ.get("TRADERS_EDGE_HOME", "/nonexistent")) / "engine")]
    for cand in candidates:
        if cand and (Path(cand) / "node_modules/.bin/tsx").exists() and (Path(cand) / "packages/cli/src/index.ts").exists():
            return Path(cand)
    return None


@unittest.skipUnless(real_engine() and edgestats.node_version() and edgestats.node_version()[1] >= 20,
                     "no real Edge Stats engine installed (./install.sh --with-edge)")
class RealEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(prefix="edge-real-")
        cls._saved = {k: os.environ.get(k) for k in ("TRADERS_EDGE_HOME", "EDGESTATS_ENGINE", "TRADERS_EDGE_PORT")}
        from edge_fakes import free_port
        os.environ.update(TRADERS_EDGE_HOME=cls._tmp.name, EDGESTATS_ENGINE=str(real_engine()),
                          TRADERS_EDGE_PORT=str(free_port()))
        edgestats._CACHE.clear()
        edgestats.SIDECAR = edgestats.Sidecar()
        edgestats.JOBS = edgestats.Jobs()

    @classmethod
    def tearDownClass(cls):
        edgestats.SIDECAR.stop()
        for k, v in cls._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        edgestats._CACHE.clear()
        cls._tmp.cleanup()

    def test_01_the_demo_loads_and_the_engine_comes_back(self):
        job = edgestats.setup({"source": "demo"})
        self.assertEqual(job["status"], "running")
        deadline = time.monotonic() + 180
        while edgestats.JOBS.running() and time.monotonic() < deadline:
            time.sleep(0.5)
        done = edgestats.JOBS.snapshot()
        self.assertEqual(done["status"], "done", done)
        self.assertTrue(any("DEMO_STK" in line for line in done["tail"]), done["tail"])

    def test_02_overview_lists_what_the_store_holds(self):
        out = edgestats.overview()
        self.assertTrue(out["ready"], out)
        self.assertEqual({s["symbol"] for s in out["symbols"]}, {"DEMO_STK", "DEMO_FUT"})
        self.assertEqual(len(out["presets"]), 42)
        self.assertTrue(all(s["lastBar"] for s in out["symbols"]))

    def test_03_a_query_matches_the_seeded_demo(self):
        out = edgestats.query({"dsl": "gapFill WHERE dayOfWeek = Tue", "symbol": "DEMO_STK"})
        self.assertEqual((out["n"], out["successes"]), (102, 81))
        self.assertAlmostEqual(out["estimate"], 0.7941, places=3)
        self.assertEqual(len(out["ci95"]), 2)
        self.assertFalse(out["guards"]["refused"])
        self.assertTrue(out["disclaimer"])

    def test_04_a_grouped_preset(self):
        out = edgestats.preset({"presetId": "gap-fill", "symbol": "DEMO_STK", "groupBy": "dayOfWeek"})
        self.assertEqual({g["group"] for g in out["groups"]}, {"Mon", "Tue", "Wed", "Thu", "Fri"})

    def test_05_a_session_has_bars_and_levels(self):
        out = edgestats.session_bars("DEMO_STK|rth|2024-12-17", 5)
        self.assertEqual(len(out["bars"]), 390)
        self.assertAlmostEqual(out["levels"]["prevClose"], 382.01, places=2)
        self.assertEqual(out["tf"], "1m")

    def test_06_mistakes_are_explained(self):
        with self.assertRaises(edgestats.EdgeError) as cm:
            edgestats.query({"dsl": "gapFil", "symbol": "DEMO_STK"})
        self.assertIn("gapFill", cm.exception.hint)
        with self.assertRaises(edgestats.EdgeError) as cm:
            edgestats.query({"dsl": "gapFill WHERE (dayOfWeek = ", "symbol": "DEMO_STK"})
        self.assertIn("position", cm.exception.detail)

    def test_07_the_registry_describes_every_outcome(self):
        entries = edgestats.registry("outcome")["entries"]
        self.assertGreaterEqual(len(entries), 17)
        self.assertTrue(all(e["kind"] == "outcome" and e["doc"] for e in entries))

    def test_08_a_refresh_pauses_and_restores_the_engine(self):
        edgestats.SIDECAR.ensure()
        job = edgestats.setup({})
        self.assertEqual(job["label"], "Updating the data")
        deadline = time.monotonic() + 180
        while edgestats.JOBS.running() and time.monotonic() < deadline:
            time.sleep(0.5)
        self.assertEqual(edgestats.JOBS.snapshot()["status"], "done", edgestats.JOBS.snapshot())
        out = edgestats.query({"dsl": "gapFill", "symbol": "DEMO_FUT"})
        self.assertGreater(out["n"], 100)


if __name__ == "__main__":
    unittest.main()
