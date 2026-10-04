"""The Edge Stats tier's plugin side: install detection, the workspace config, the sidecar's life, the
data jobs, and the questions the page and the agent ask.

None of this needs Node: `edge_fakes.FakeEdgeHome` installs a fake `tsx` that speaks the engine's command
line and HTTP API (answering with real engine responses saved as fixtures) and keeps DuckDB's
single-writer lock — the fact the whole job design bends around. Each test below names the failure it
would otherwise let back in:

  * a job that does not stop the service first dies on the store lock;
  * a question asked mid-job hangs instead of answering "busy";
  * a bad symbol written to the config after a download started leaves a half-run job behind;
  * a console restart orphans the engine on its port and every later start dies on EADDRINUSE;
  * a machine with no Node reads as a crash instead of a first-run state.
"""

import json
import os
import signal
import sys
import time
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import edgestats  # noqa: E402
from edge_fakes import FakeEdgeHome, fixture  # noqa: E402


def wait_for(predicate, seconds=10.0, step=0.05):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(step)
    return False


class InstallState(unittest.TestCase):
    def test_no_node_is_a_first_run_state_with_a_fix(self):
        with FakeEdgeHome() as _:
            with mock.patch.object(edgestats, "node_version", return_value=None):
                st = edgestats.install_state()
        self.assertFalse(st["installed"])
        self.assertEqual(st["problem"], "no_node")
        self.assertIn("Node.js", st["fix"])

    def test_old_node_names_the_version_it_found(self):
        with FakeEdgeHome() as _:
            with mock.patch.object(edgestats, "node_version", return_value=("v18.19.0", 18)):
                st = edgestats.install_state()
        self.assertEqual(st["problem"], "old_node")
        self.assertIn("v18.19.0", st["fix"])

    def test_missing_engine_says_how_to_install_it(self):
        with FakeEdgeHome(installed=False) as _:
            st = edgestats.install_state()
        self.assertEqual(st["problem"], "not_installed")
        self.assertIn("--with-edge", st["fix"])

    def test_installed_engine_passes(self):
        with FakeEdgeHome() as _:
            st = edgestats.install_state()
        self.assertTrue(st["installed"])
        self.assertIsNone(st["problem"])

    def test_an_external_engine_counts_as_installed(self):
        with FakeEdgeHome(installed=False) as _:
            with mock.patch.dict(os.environ, {"LUXALGO_EDGESTATS": "http://127.0.0.1:1/"}):
                st = edgestats.install_state()
                self.assertTrue(st["installed"] and st["external"])
                self.assertEqual(edgestats.base_url(), "http://127.0.0.1:1")

    def test_the_pin_in_the_installer_is_the_pin_here(self):
        install = (BACKEND.parents[1] / "install.sh").read_text()
        self.assertTrue(edgestats.PINNED_COMMIT in install,
                        "install.sh and edgestats.py must pin the same edge-stats commit")


class SymbolEntries(unittest.TestCase):
    def test_binance_entry_is_a_crypto_1m_symbol_with_a_start_date(self):
        row = edgestats._symbol_entry("binance", "btcusdt", 3, False)
        self.assertEqual((row["symbol"], row["adapter"], row["assetClass"], row["tf"]),
                         ("BTCUSDT", "binance", "crypto", "1m"))
        want = (date.today() - timedelta(days=int(3 * 365.25))).isoformat()
        self.assertLessEqual(abs((date.fromisoformat(row["adapterOptions"]["start"]) -
                                  date.fromisoformat(want)).days), 2)
        self.assertNotIn("archiveOnly", row["adapterOptions"])

    def test_archive_only_is_carried_when_asked(self):
        row = edgestats._symbol_entry("binance", "ETHUSDT", 1, True)
        self.assertTrue(row["adapterOptions"]["archiveOnly"])

    def test_dukascopy_maps_the_trader_name_to_the_feed_id(self):
        row = edgestats._symbol_entry("dukascopy", "xauusd", 1, False)
        self.assertEqual(row["adapter"], "dukascopy")
        self.assertEqual(row["adapterOptions"]["instrument"], "xauusd")
        self.assertEqual(row["assetClass"], "forex")

    def test_demo_entries_are_the_two_synthetic_profiles(self):
        stk = edgestats._symbol_entry("demo", "DEMO_STK", 2, False)
        fut = edgestats._symbol_entry("demo", "DEMO_FUT", 2, False)
        self.assertEqual((stk["adapter"], stk["assetClass"]), ("synthetic", "equity"))
        self.assertEqual((fut["adapter"], fut["assetClass"]), ("synthetic", "future"))

    def test_hostile_or_odd_input_is_refused_before_any_disk_work(self):
        for source, symbol in (("binance", "btc"), ("binance", "BTC/USDT"), ("binance", "../../etc"),
                               ("binance", ""), ("dukascopy", "BTCUSDT"), ("demo", "AAPL"),
                               ("csv", "BTCUSDT"), ("alpaca", "AAPL"), ("", "BTCUSDT")):
            with self.assertRaises(edgestats.EdgeError, msg=f"{source}/{symbol}") as cm:
                edgestats._symbol_entry(source, symbol, 1, False)
            self.assertIn(cm.exception.code, ("bad_symbol", "bad_source"))
            self.assertEqual(cm.exception.status, 400)


class WorkspaceConfig(unittest.TestCase):
    def test_add_symbol_appends_once_and_is_idempotent(self):
        with FakeEdgeHome(with_config=True, symbols=[]) as _:
            first = edgestats._add_symbol("binance", "BTCUSDT", 3, False)
            again = edgestats._add_symbol("binance", "BTCUSDT", 9, False)
            self.assertEqual(first["symbol"], again["symbol"])
            self.assertEqual([s["symbol"] for s in edgestats.configured_symbols()], ["BTCUSDT"])
            # re-adding keeps the original start: the watermark is defined by it
            self.assertEqual(again["adapterOptions"]["start"], first["adapterOptions"]["start"])

    def test_a_symbol_keeps_its_adapter(self):
        with FakeEdgeHome(with_config=True, symbols=[]) as _:
            edgestats._add_symbol("binance", "BTCUSDT", 1, False)
            cfg = edgestats.read_config()
            cfg["symbols"][0]["adapter"] = "coinbase"
            edgestats._write_config(cfg)
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats._add_symbol("binance", "BTCUSDT", 1, False)
            self.assertEqual(cm.exception.code, "symbol_exists")

    def test_no_workspace_is_a_409_not_a_traceback(self):
        with FakeEdgeHome() as _:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats._add_symbol("demo", "DEMO_STK", 1, False)
            self.assertEqual((cm.exception.status, cm.exception.code), (409, "no_workspace"))

    def test_the_config_write_is_atomic(self):
        with FakeEdgeHome(with_config=True, symbols=[]) as _:
            edgestats._add_symbol("binance", "BTCUSDT", 1, False)
            leftovers = [p.name for p in edgestats.workspace_dir().iterdir() if p.suffix == ".tmp"]
            self.assertEqual(leftovers, [])


class SidecarLifecycle(unittest.TestCase):
    def test_not_installed_is_a_structured_refusal(self):
        with FakeEdgeHome(installed=False, with_config=True) as _:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.SIDECAR.ensure()
        self.assertEqual((cm.exception.status, cm.exception.code), (503, "edge_not_installed"))
        self.assertIn("--with-edge", cm.exception.hint)

    def test_installed_but_empty_says_load_data(self):
        with FakeEdgeHome(with_config=True, symbols=[]) as _:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.SIDECAR.ensure()
        self.assertEqual((cm.exception.status, cm.exception.code), (409, "edge_no_data"))

    def test_it_starts_lazily_once_and_stays_up(self):
        with FakeEdgeHome(with_config=True) as fake:
            self.assertEqual(edgestats.SIDECAR.state()["state"], "stopped")
            edgestats.SIDECAR.ensure()
            self.assertEqual(edgestats.SIDECAR.state()["state"], "ready")
            pid = json.loads(edgestats.pid_path().read_text())["pid"]
            edgestats.SIDECAR.ensure()
            self.assertEqual(json.loads(edgestats.pid_path().read_text())["pid"], pid,
                             "a second ensure() must not start a second engine")
            edgestats.SIDECAR.stop()
            self.assertFalse(edgestats.pid_path().exists())
            self.assertEqual(edgestats.SIDECAR.state()["state"], "stopped")
            self.assertTrue(wait_for(lambda: not edgestats._pid_alive(pid), 5.0))

    def test_status_never_starts_the_engine(self):
        with FakeEdgeHome(with_config=True) as _:
            st = edgestats.status()
            self.assertEqual(st["service"]["state"], "stopped")
            self.assertTrue(st["has_data"])
            self.assertFalse(edgestats.pid_path().exists())

    def test_a_restarted_console_adopts_the_engine_it_left_behind(self):
        with FakeEdgeHome(with_config=True) as _:
            edgestats.SIDECAR.ensure()
            pid = json.loads(edgestats.pid_path().read_text())["pid"]
            successor = edgestats.Sidecar()                     # what a restarted console starts with
            self.assertEqual(successor.state()["state"], "stopped")
            successor.ensure()
            self.assertEqual(json.loads(edgestats.pid_path().read_text())["pid"], pid)
            self.assertTrue(edgestats._pid_alive(pid))
            successor.stop()
            self.assertTrue(wait_for(lambda: not edgestats._pid_alive(pid), 5.0))

    def test_a_pid_that_is_not_ours_is_never_adopted_or_killed(self):
        with FakeEdgeHome(with_config=True) as _:
            edgestats.pid_path().parent.mkdir(parents=True, exist_ok=True)
            edgestats.pid_path().write_text(json.dumps(
                {"pid": os.getpid(), "port": edgestats.port(), "workspace": str(edgestats.workspace_dir())}))
            self.assertFalse(edgestats._is_our_engine(os.getpid()))
            self.assertFalse(edgestats.Sidecar()._adopt())
            edgestats.SIDECAR.ensure()                          # starts its own instead
            self.assertNotEqual(json.loads(edgestats.pid_path().read_text())["pid"], os.getpid())

    def test_a_taken_port_is_named(self):
        with FakeEdgeHome(with_config=True, mode="taken") as _:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.SIDECAR.ensure(wait=8)
        self.assertEqual(cm.exception.code, "edge_port_taken")
        self.assertIn("TRADERS_EDGE_PORT", cm.exception.hint)

    def test_a_locked_store_is_named(self):
        with FakeEdgeHome(with_config=True, mode="lock") as _:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.SIDECAR.ensure(wait=8)
        self.assertEqual(cm.exception.code, "edge_store_locked")

    def test_a_crash_carries_the_engines_last_words(self):
        with FakeEdgeHome(with_config=True, mode="crash") as _:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.SIDECAR.ensure(wait=8)
        self.assertEqual(cm.exception.code, "edge_start_failed")
        self.assertIn("boom", cm.exception.detail["log"])
        self.assertEqual(edgestats.SIDECAR.state()["state"], "failed")

    def test_an_engine_that_never_listens_times_out_and_is_not_left_running(self):
        with FakeEdgeHome(with_config=True, mode="hang") as _:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.SIDECAR.ensure(wait=1.5)
            self.assertEqual(cm.exception.code, "edge_start_failed")
            self.assertFalse(edgestats.SIDECAR._alive(), "a failed start must not leave a process behind")

    def test_a_dead_engine_is_restarted_by_the_next_question(self):
        with FakeEdgeHome(with_config=True) as _:
            edgestats.SIDECAR.ensure()
            pid = json.loads(edgestats.pid_path().read_text())["pid"]
            os.kill(pid, signal.SIGKILL)
            self.assertTrue(wait_for(lambda: not edgestats._pid_alive(pid), 3.0))
            out = edgestats.query({"dsl": "gapFill", "symbol": "DEMO_STK"})
            self.assertEqual(out["n"], fixture("query")["n"])
            self.assertNotEqual(json.loads(edgestats.pid_path().read_text())["pid"], pid)

    def test_the_engine_is_never_reached_through_the_environments_proxy(self):
        with FakeEdgeHome(with_config=True) as _:
            with mock.patch.dict(os.environ, {"http_proxy": "http://127.0.0.1:9", "HTTP_PROXY": "http://127.0.0.1:9"}):
                edgestats.SIDECAR.ensure()
                self.assertEqual(edgestats.SIDECAR.state()["state"], "ready")

    def test_status_answers_while_a_start_is_in_flight(self):
        """The two-lock design: a start may take seconds; the page's status poll must not wait for it."""
        with FakeEdgeHome(with_config=True, mode="hang") as _:
            import threading
            errors = []
            t = threading.Thread(target=lambda: errors.append(_try(lambda: edgestats.SIDECAR.ensure(wait=2.5))))
            t.start()
            time.sleep(0.4)
            t0 = time.monotonic()
            edgestats.status()
            self.assertLess(time.monotonic() - t0, 1.0, "status() blocked behind a start in progress")
            t.join(10)


def _try(fn):
    try:
        fn()
    except edgestats.EdgeError as exc:
        return exc


class Questions(unittest.TestCase):
    def setUp(self):
        self.fake = FakeEdgeHome(with_config=True)
        self.fake.__enter__()
        self.addCleanup(self.fake.__exit__, None, None, None)

    def test_a_query_comes_back_in_the_full_honest_envelope(self):
        out = edgestats.query({"dsl": "gapFill WHERE dayOfWeek = Tue", "symbol": "DEMO_STK"})
        for key in ("n", "successes", "estimate", "ci95", "guards", "stability", "perYear", "sessions", "disclaimer"):
            self.assertIn(key, out)
        self.assertEqual(out["query"]["dsl"], "gapFill WHERE dayOfWeek = Tue")

    def test_a_refused_estimate_stays_refused(self):
        out = edgestats.query({"dsl": "gapFill WHERE gapPct BETWEEN 0.05% AND 0.06%", "symbol": "DEMO_STK"})
        self.assertIsNone(out["estimate"])
        self.assertTrue(out["guards"]["refused"])

    def test_a_typo_comes_back_with_the_engines_suggestion(self):
        with self.assertRaises(edgestats.EdgeError) as cm:
            edgestats.query({"dsl": "gapFil WHERE dayOfWeek = Tue", "symbol": "DEMO_STK"})
        self.assertEqual((cm.exception.status, cm.exception.code), (400, "bad_query"))
        self.assertIn("gapFill", cm.exception.hint)

    def test_a_syntax_error_carries_its_position(self):
        with self.assertRaises(edgestats.EdgeError) as cm:
            edgestats.query({"dsl": "gapFill WHERE dayOfWeek =", "symbol": "DEMO_STK"})
        self.assertEqual(cm.exception.detail["position"], len("gapFill WHERE dayOfWeek ="))

    def test_an_unknown_symbol_is_refused_without_asking_the_engine(self):
        with mock.patch.object(edgestats.SIDECAR, "call") as call:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.query({"dsl": "gapFill", "symbol": "NOPE"})
            call.assert_not_called()
        self.assertEqual(cm.exception.code, "bad_symbol")
        self.assertIn("DEMO_STK", cm.exception.hint)

    def test_inputs_are_checked_before_they_reach_the_engine(self):
        bad = [
            {"dsl": "", "symbol": "DEMO_STK"},
            {"dsl": "x" * 2001, "symbol": "DEMO_STK"},
            {"dsl": "gapFill", "symbol": "DEMO_STK", "since": "last tuesday"},
            {"dsl": "gapFill", "symbol": "DEMO_STK", "until": "2024-1-1"},
            {"dsl": "gapFill", "symbol": "DEMO_STK", "groupBy": "dayOfWeek; DROP"},
            {"dsl": "gapFill", "symbol": "DEMO_STK", "sessionKey": "RTH!"},
            {"dsl": "gapFill", "symbol": "DEMO_STK", "sessionsLimit": "many"},
        ]
        with mock.patch.object(edgestats.SIDECAR, "call") as call:
            for body in bad:
                with self.assertRaises(edgestats.EdgeError, msg=str(body)) as cm:
                    edgestats.query(body)
                self.assertEqual(cm.exception.status, 400)
            call.assert_not_called()

    def test_the_session_list_is_clamped(self):
        self.assertEqual(edgestats._common({"symbol": "DEMO_STK", "sessionsLimit": 9999})["sessionsLimit"], 200)
        self.assertEqual(edgestats._common({"symbol": "DEMO_STK", "sessionsLimit": -4})["sessionsLimit"], 0)
        self.assertEqual(edgestats._common({"symbol": "DEMO_STK"})["sessionsLimit"], 25)

    def test_a_preset_runs_with_its_group_table(self):
        out = edgestats.preset({"presetId": "gap-fill", "symbol": "DEMO_STK", "groupBy": "dayOfWeek"})
        self.assertEqual(out["preset"]["id"], "gap-fill")
        self.assertEqual(len(out["groups"]), 5)

    def test_preset_inputs_are_checked(self):
        for body in ({"presetId": "Gap Fill", "symbol": "DEMO_STK"}, {"presetId": "", "symbol": "DEMO_STK"},
                     {"presetId": "gap-fill", "symbol": "DEMO_STK", "params": {"event": True}},
                     {"presetId": "gap-fill", "symbol": "DEMO_STK", "params": {"bad key": 1}},
                     {"presetId": "gap-fill", "symbol": "DEMO_STK", "params": [1]},
                     {"presetId": "gap-fill", "symbol": "DEMO_STK", "params": {f"p{i}": i for i in range(20)}}):
            with self.assertRaises(edgestats.EdgeError, msg=str(body)) as cm:
                edgestats.preset(body)
            self.assertEqual(cm.exception.status, 400)

    def test_session_bars_come_with_levels(self):
        out = edgestats.session_bars("DEMO_STK|rth|2024-12-17", 5)
        self.assertEqual(out["sessionId"], "DEMO_STK|rth|2024-12-17")
        self.assertIn("prevClose", out["levels"])
        self.assertTrue(out["bars"])

    def test_session_ids_are_validated_and_a_missing_one_is_a_404(self):
        for bad in ("", "DEMO_STK", "../x|rth|2024-01-01", "DEMO_STK|rth|2024-1-1", "a|b|c", None):
            with self.assertRaises(edgestats.EdgeError, msg=str(bad)):
                edgestats.session_bars(bad)
        with self.assertRaises(edgestats.EdgeError) as cm:
            edgestats.session_bars("DEMO_STK|rth|2000-01-01")
        self.assertEqual((cm.exception.status, cm.exception.code), (404, "edge_not_found"))

    def test_sessions_by_id_validates_the_list(self):
        self.assertEqual(len(edgestats.sessions(["DEMO_STK|rth|2024-12-17"])["sessions"]), 1)
        for bad in ([], "x", ["nope"], ["DEMO_STK|rth|2024-12-17"] * 201):
            with self.assertRaises(edgestats.EdgeError):
                edgestats.sessions(bad)

    def test_the_registry_filters_by_kind_and_is_cached(self):
        with mock.patch.object(edgestats.SIDECAR, "call", wraps=edgestats.SIDECAR.call) as call:
            edgestats.registry()
            edgestats.registry()
            self.assertEqual(call.call_count, 1)
        with self.assertRaises(edgestats.EdgeError):
            edgestats.registry("nonsense")

    def test_overview_is_the_pages_first_call(self):
        out = edgestats.overview()
        self.assertTrue(out["ready"])
        self.assertIsNone(out["reason"])
        self.assertEqual({s["symbol"] for s in out["symbols"]}, {"DEMO_STK", "DEMO_FUT"})
        self.assertTrue(all(s.get("lastBar") for s in out["symbols"]))
        self.assertGreaterEqual(len(out["presets"]), 6)
        self.assertEqual({s["id"] for s in out["sources"]}, {"binance", "dukascopy", "demo"})


class OverviewWithoutAnEngine(unittest.TestCase):
    def test_not_installed_is_data_not_an_error(self):
        with FakeEdgeHome(installed=False) as _:
            out = edgestats.overview()
        self.assertFalse(out["ready"])
        self.assertEqual(out["reason"], "edge_not_installed")
        self.assertIn("--with-edge", out["hint"])
        self.assertFalse(out["install"]["installed"])

    def test_no_data_is_data_not_an_error(self):
        with FakeEdgeHome(with_config=False) as _:
            out = edgestats.overview()
        self.assertFalse(out["ready"])
        self.assertEqual(out["reason"], "edge_no_data")
        self.assertEqual(out["symbols"], [])

    def test_a_failed_start_is_reported_with_its_reason(self):
        with FakeEdgeHome(with_config=True, mode="taken") as _:
            with mock.patch.object(edgestats, "START_WAIT", 6.0):
                out = edgestats.overview()
        self.assertEqual(out["reason"], "edge_port_taken")
        self.assertFalse(out["ready"])


class DataJobs(unittest.TestCase):
    def finish(self, seconds=15.0):
        self.assertTrue(wait_for(lambda: not edgestats.JOBS.running(), seconds), "the job never finished")
        return edgestats.JOBS.snapshot()

    def test_the_demo_loads_into_an_empty_workspace_and_the_engine_comes_back(self):
        with FakeEdgeHome(symbols=[]) as _:
            job = edgestats.setup({"source": "demo"})
            self.assertEqual(job["status"], "running")
            self.assertEqual(job["symbols"], ["DEMO_STK", "DEMO_FUT"])
            done = self.finish()
            self.assertEqual(done["status"], "done", done)
            self.assertEqual([s["symbol"] for s in edgestats.configured_symbols()], ["DEMO_STK", "DEMO_FUT"])
            self.assertTrue(any("+1000 bars" in line for line in done["tail"]))
            self.assertTrue(wait_for(lambda: edgestats.SIDECAR.state()["state"] == "ready", 10.0),
                            "the engine must be brought back after a successful job")

    def test_a_running_service_is_paused_for_the_job(self):
        """The fake sync dies on the store lock exactly as DuckDB would, so this only passes if the job
        stopped the service first — the one rule the design bends around."""
        with FakeEdgeHome(with_config=True) as _:
            edgestats.SIDECAR.ensure()
            self.assertEqual(edgestats.SIDECAR.state()["state"], "ready")
            edgestats.setup({})                                  # refresh everything
            done = self.finish()
            self.assertEqual(done["status"], "done", done)

    def test_questions_during_a_job_say_busy_instead_of_hanging(self):
        with FakeEdgeHome(with_config=True) as _, mock.patch.dict(os.environ, {"FAKE_SYNC_SECONDS": "1.5"}):
            edgestats.setup({})
            t0 = time.monotonic()
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.query({"dsl": "gapFill", "symbol": "DEMO_STK"})
            self.assertLess(time.monotonic() - t0, 1.0)
            self.assertEqual((cm.exception.status, cm.exception.code), (503, "edge_busy"))
            self.assertEqual(edgestats.overview()["reason"], "edge_busy")
            self.finish()

    def test_a_failing_sync_reports_its_last_words(self):
        with FakeEdgeHome(with_config=True) as _, mock.patch.dict(os.environ, {"FAKE_SYNC_EXIT": "1"}):
            edgestats.setup({})
            done = self.finish()
        self.assertEqual(done["status"], "failed")
        self.assertIn("bars", done["error"])

    def test_cancel_stops_the_download_promptly(self):
        with FakeEdgeHome(with_config=True) as _, mock.patch.dict(os.environ, {"FAKE_SYNC_SECONDS": "30"}):
            edgestats.setup({})
            self.assertTrue(wait_for(lambda: edgestats.JOBS.snapshot()["lines"] > 0, 5.0))
            t0 = time.monotonic()
            edgestats.cancel_job()
            done = self.finish(8.0)
            self.assertEqual(done["status"], "cancelled")
            self.assertLess(time.monotonic() - t0, 6.0)

    def test_only_one_job_at_a_time(self):
        with FakeEdgeHome(with_config=True) as _, mock.patch.dict(os.environ, {"FAKE_SYNC_SECONDS": "1"}):
            edgestats.setup({})
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.setup({})
            self.assertEqual((cm.exception.status, cm.exception.code), (409, "job_running"))
            self.finish()

    def test_cancelling_nothing_is_a_409(self):
        with FakeEdgeHome(with_config=True) as _:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.cancel_job()
        self.assertEqual(cm.exception.code, "no_job")

    def test_a_bad_symbol_fails_before_anything_is_created(self):
        with FakeEdgeHome(symbols=[]) as _:
            for body in ({"source": "binance", "symbol": "btc"}, {"source": "dukascopy", "symbol": "BTCUSDT"},
                         {"source": "csv", "symbol": "X"}, {"source": "binance", "symbol": "BTCUSDT", "years": 99},
                         {"source": "binance", "symbol": "BTCUSDT", "years": "lots"}):
                with self.assertRaises(edgestats.EdgeError, msg=str(body)) as cm:
                    edgestats.setup(body)
                self.assertEqual(cm.exception.status, 400)
            self.assertFalse(edgestats.config_path().exists(), "a refused request must leave the disk alone")
            self.assertIsNone(edgestats.JOBS.snapshot())

    def test_nothing_to_refresh_says_so(self):
        with FakeEdgeHome(with_config=True, symbols=[]) as _:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.setup({})
        self.assertEqual(cm.exception.code, "edge_no_data")

    def test_an_external_engine_cannot_be_paused_so_jobs_are_refused(self):
        with FakeEdgeHome(installed=False) as _:
            with mock.patch.dict(os.environ, {"LUXALGO_EDGESTATS": "http://127.0.0.1:1"}):
                with self.assertRaises(edgestats.EdgeError) as cm:
                    edgestats.setup({"source": "demo"})
        self.assertEqual(cm.exception.code, "edge_external")

    def test_setup_needs_an_installed_engine(self):
        with FakeEdgeHome(installed=False) as _:
            with self.assertRaises(edgestats.EdgeError) as cm:
                edgestats.setup({"source": "demo"})
        self.assertEqual(cm.exception.code, "edge_not_installed")

    def test_a_download_adds_its_symbol_to_the_config(self):
        with FakeEdgeHome(symbols=[]) as _:
            edgestats.setup({"source": "binance", "symbol": "ethusdt", "years": 2})
            done = self.finish()
            self.assertEqual(done["status"], "done", done)
            rows = edgestats.configured_symbols()
            self.assertEqual([r["symbol"] for r in rows], ["ETHUSDT"])
            self.assertEqual(rows[0]["adapter"], "binance")


if __name__ == "__main__":
    unittest.main()
