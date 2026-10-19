"""The prop-firm simulator bridge (19 Oct 2026): LuxAlgo's engine, run locally, rendered verbatim.

The engine is `@luxalgo/prop-firm-sim-cli` (MIT) — ten thousand challenge journeys through a firm's
exact ruleset. These tests hold the bridge's own job and none of the engine's maths: build the CLI
arguments from the form (percent → fraction, `--risk 1%`), validate input with a sentence instead of a
stack trace, run the CLI and parse its JSON, cache a repeat, and hand the engine's failure text back.
A fake CLI stands in for the real one, so the suite runs without Node or an install.
"""

import json
import os
import stat
import sys
import tempfile
import textwrap
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import propfirmsim as ps  # noqa: E402
import server as srv      # noqa: E402

FRONT = BACKEND.parent / "frontend"
TOKEN = "test-token"

FAKE_RESULT = {
    "schemaVersion": 1,
    "engineVersion": "9.9.9",
    "perAttempt": {
        "attemptsObserved": 10000,
        "passProbability": 0.5,
        "passProbabilityCi": {"low": 0.49, "high": 0.51},
        "failureBreakdown": {"daily-loss": 3, "max-loss": 40, "time-limit": 0, "abandoned": 0},
        "avgDaysWhenPassed": 12.5, "avgDaysWhenFailed": 11.0,
        "steps": [{"name": "Step 1", "targetPct": 10, "passProbability": 0.7, "failureBreakdown": {"max-loss": 30}}],
    },
    "journey": {"fundedProbability": 0.9, "attemptCap": 25, "attempts": {"mean": 1.5, "p50": 1, "p90": 3},
                "cost": {"mean": 100, "p50": 0, "p95": 500}, "daysToFunded": {"p50": 20}},
    "funded": {"horizonTradingDays": 90, "payoutTotal": {"p50": 5000}, "payoutProbability": 0.8, "blownProbability": 0.2},
    "ev": {"evTotal": 1234.5, "evStandardError": 50.0, "pPositive": 0.8},
    "assumptions": {"flags": ["a simplification"], "disclaimer": "Simulation, not prediction.",
                    "spec": {"productType": "cfd"}},
    "meta": {"paths": 10000, "seed": 42},
}


def write_fake_cli(dirpath: str, fail: str = "") -> str:
    """A stand-in for prop-firm-sim: records its argv, then answers (or fails) like the real one."""
    path = os.path.join(dirpath, "prop-firm-sim")
    body = f"""#!/bin/sh
echo "$@" >> "{dirpath}/calls.txt"
if [ -n "{fail}" ]; then
  echo "{fail}" >&2
  exit 1
fi
cat <<'JSON'
{json.dumps(FAKE_RESULT)}
JSON
"""
    Path(path).write_text(body, encoding="utf-8")
    path_obj = Path(path)
    path_obj.chmod(path_obj.stat().st_mode | stat.S_IEXEC)
    return path


class TheArguments(unittest.TestCase):
    def test_the_form_turns_into_the_clis_own_flags(self):
        args = ps.build_args({"firm": "ftmo", "challenge": "100k-2step", "winrate": "0.48",
                              "avg_win": "1.6", "avg_loss": "1", "trades_per_day": "4", "risk": "1"})
        joined = " ".join(args)
        self.assertIn("--firm ftmo --challenge 100k-2step", joined)
        self.assertIn("--winrate 0.48", joined)
        self.assertIn("--avg-win 1.6 --avg-loss 1", joined)
        self.assertIn("--trades-per-day 4", joined)
        self.assertIn("--risk 1%", joined, "the engine's own percent form")
        self.assertIn("--paths 10000", joined)
        self.assertIn("--seed 42", joined)

    def test_bad_input_is_a_sentence_not_a_traceback(self):
        for params, needle in [
            ({"firm": "", "challenge": "x"}, "firm and challenge"),
            ({"firm": "ftmo", "challenge": "x", "winrate": "2", "avg_win": "1", "trades_per_day": "4", "risk": "1"}, "winrate"),
            ({"firm": "ftmo", "challenge": "x", "winrate": "0.5", "avg_win": "0", "trades_per_day": "4", "risk": "1"}, "avg win"),
            ({"firm": "ftmo", "challenge": "x", "winrate": "0.5", "avg_win": "1", "trades_per_day": "4"}, "risk per trade"),
        ]:
            with self.assertRaises(ps.SimError) as ctx:
                ps.build_args(params)
            self.assertIn(needle, str(ctx.exception))

    def test_the_optional_flags_only_appear_when_asked_for(self):
        base = {"firm": "ftmo", "challenge": "x", "winrate": "0.5", "avg_win": "1",
                "trades_per_day": "4", "risk": "1", "no_funded": "1"}
        args = ps.build_args(base)
        self.assertIn("--no-funded", args)
        self.assertNotIn("--no-funded", ps.build_args({**base, "no_funded": ""}))


class TheEngineRun(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cli = write_fake_cli(self.tmp.name)
        self.env = mock.patch.dict(os.environ, {"PROPFIRMSIM_CLI": self.cli,
                                                "TRADERS_SIM_HOME": self.tmp.name + "/home"})
        self.env.start()
        self.addCleanup(self.env.stop)
        ps._CACHE.clear()

    def calls(self):
        try:
            return Path(self.tmp.name, "calls.txt").read_text(encoding="utf-8").strip().splitlines()
        except OSError:
            return []

    def test_a_run_parses_the_engines_json_and_says_how_long_it_took(self):
        out = ps.simulate({"firm": "ftmo", "challenge": "x", "winrate": "0.5", "avg_win": "1.5",
                           "trades_per_day": "4", "risk": "1"})
        self.assertEqual(out["result"]["perAttempt"]["passProbability"], 0.5)
        self.assertEqual(out["engine"], "9.9.9")
        self.assertFalse(out["cached"])
        self.assertIn("--json", self.calls()[0])
        self.assertGreaterEqual(out["elapsed_ms"], 0)

    def test_the_same_question_is_answered_from_the_cache(self):
        params = {"firm": "ftmo", "challenge": "x", "winrate": "0.5", "avg_win": "1.5",
                  "trades_per_day": "4", "risk": "1"}
        ps.simulate(dict(params))
        again = ps.simulate(dict(params))
        self.assertTrue(again["cached"])
        self.assertEqual(len(self.calls()), 1, "the engine runs once per identical question (its seed is pinned)")

    def test_the_engines_own_failure_text_comes_back(self):
        self.cli = write_fake_cli(self.tmp.name, fail='error: unknown challenge "x" for firm "ftmo"')
        os.environ["PROPFIRMSIM_CLI"] = self.cli
        ps._CACHE.clear()
        with self.assertRaises(ps.SimError) as ctx:
            ps.simulate({"firm": "ftmo", "challenge": "x", "winrate": "0.5", "avg_win": "1.5",
                         "trades_per_day": "4", "risk": "1"})
        self.assertIn("unknown challenge", str(ctx.exception))

    def test_not_installed_is_a_state_not_an_exception_stack(self):
        os.environ["PROPFIRMSIM_CLI"] = self.tmp.name + "/nope"
        state = ps.status()
        self.assertFalse(state["installed"])
        with self.assertRaises(ps.SimError) as ctx:
            ps.simulate({"firm": "ftmo", "challenge": "x", "winrate": "0.5", "avg_win": "1.5",
                         "trades_per_day": "4", "risk": "1"})
        self.assertIn("install.sh --with-prop", str(ctx.exception))


class TheHttpDoors(unittest.TestCase):
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

    def get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}", timeout=20) as res:
            return json.loads(res.read().decode())

    def test_the_status_door_answers_even_when_nothing_is_installed(self):
        with mock.patch.dict(os.environ, {"PROPFIRMSIM_CLI": self.tmp.name + "/nope"}):
            out = self.get("/api/propfirmsim/status")
        data = out.get("data") or out
        self.assertIn("installed", data)
        self.assertTrue(data.get("fix"), "a missing engine comes with the command that fixes it")

    def test_the_simulate_door_runs_the_engine_and_maps_bad_input_to_400(self):
        cli = write_fake_cli(self.tmp.name)
        with mock.patch.dict(os.environ, {"PROPFIRMSIM_CLI": cli,
                                          "TRADERS_SIM_HOME": self.tmp.name + "/home"}):
            ps._CACHE.clear()
            out = self.get("/api/propfirmsim/simulate?firm=ftmo&challenge=x&winrate=0.5&avg_win=1.5"
                           "&trades_per_day=4&risk=1")
            data = out.get("data") or out
            self.assertEqual(data["result"]["meta"]["seed"], 42)
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                self.get("/api/propfirmsim/simulate?firm=ftmo&challenge=x&winrate=nonsense")
            self.assertEqual(ctx.exception.code, 400)


class TheSheetUsesIt(unittest.TestCase):
    js = (FRONT / "desk.js").read_text(encoding="utf-8")
    css = (FRONT / "desk.css").read_text(encoding="utf-8")

    def test_the_tab_asks_for_the_engine_state_and_can_run_it(self):
        self.assertIn("/api/propfirmsim/status", self.js)
        self.assertIn("/api/propfirmsim/simulate", self.js)
        self.assertIn("data-simstat", self.js, "the form fields carry their key")
        self.assertIn('data-sim=', self.js, "each challenge chip is the Simulate button")

    def test_the_card_says_what_the_engine_says(self):
        for needle in ("passProbabilityCi", "failureBreakdown", "fundedProbability", "cost",
                       "payoutProbability", "blownProbability", "evTotal", "disclaimer", "flags",
                       "engineVersion"):
            self.assertIn(needle, self.js, f"the verdict card never reads {needle}")
        self.assertIn(".desk__verdict", self.css)
