"""Edge Stats answers as text — and the one rule the engine itself keeps: no percentage without its N.

`edge_text` is what both the agent (MCP tools) and the shell (`trader-chart edge`) print. The fixtures are
REAL engine responses (tests/fixtures/edgestats/), so these tests pin the formatter against the true
shapes, including the refused (too few sessions) case where printing a rate at all would be the bug.
"""

import json
import re
import sys
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "mcp"))

import edge_text as et  # noqa: E402

FIX = HERE / "fixtures" / "edgestats"


def load(name):
    return json.loads((FIX / f"{name}.json").read_text())


class Result(unittest.TestCase):
    def test_the_headline_carries_estimate_n_and_interval_together(self):
        out = et.format_result(load("query"))
        self.assertIn("estimate 79.4%", out)
        self.assertIn("N = 102", out)
        self.assertIn("95% CI [70.6%, 86.1%]", out)
        self.assertIn("(81 hit(s))", out)

    def test_every_percentage_line_names_its_sample_size(self):
        """The engine's non-negotiable, kept by the formatter: a line with a rate in it also has an n."""
        for name in ("query", "preset_grouped"):
            env = load(name)
            out = et.format_result(env, sessions=4, group_by="dayOfWeek")
            for i, line in enumerate(out.splitlines()):
                if "%" not in line or i < 3:               # the first lines echo the DSL (which may contain %)
                    continue
                self.assertRegex(line, r"(\bn=\d|\bN = \d)", f"{name}: a rate without its n -> {line!r}")

    def test_a_refused_estimate_prints_no_rate_at_all(self):
        env = load("query_low")
        self.assertTrue(env["guards"]["refused"])
        out = et.format_result(env)
        self.assertIn("NO ESTIMATE", out)
        self.assertIn("only 3 session(s) matched", out)
        body = out.splitlines()[3:]                         # after the title/DSL/scope header
        self.assertFalse([l for l in body if "%" in l and "disclaimer" not in l.lower()
                          and "Historical" not in l], "a refused result must not print any percentage")
        self.assertNotIn("estimate", out.lower().replace("no estimate", ""))

    def test_a_low_sample_is_flagged(self):
        env = load("query")
        env["guards"] = {**env["guards"], "lowSample": True}
        self.assertIn("LOW SAMPLE", et.format_result(env))

    def test_stability_recency_years_and_distribution(self):
        out = et.format_result(load("preset_grouped"))
        self.assertIn("stability: first half 87.0% (n=247) vs second half 83.1% (n=248) — the halves agree", out)
        self.assertIn("recency: last 250 sessions 83.2% (n=250) vs all 85.0% (n=495)", out)
        self.assertIn("per year: 2023 87.0% (n=247) · 2024 83.1% (n=248)", out)
        self.assertIn("distribution (minutes, n=421): median 1 min", out)

    def test_disagreement_and_divergence_are_said_out_loud(self):
        env = load("preset_grouped")
        env["stability"]["agree"] = False
        env["recency"]["diverges"] = True
        out = et.format_result(env)
        self.assertIn("DISAGREE", out)
        self.assertIn("DIVERGE", out)

    def test_groups_come_in_weekday_order_with_n_and_interval(self):
        out = et.format_result(load("preset_grouped"), group_by="dayOfWeek")
        rows = [l.split()[0] for l in out.splitlines() if re.match(r"^\s{4}(Mon|Tue|Wed|Thu|Fri)\b", l)]
        self.assertEqual(rows, ["Mon", "Tue", "Wed", "Thu", "Fri"])
        self.assertIn("by dayOfWeek:", out)
        self.assertRegex(out, r"Tue\s+79\.4%\s+n=102\s+95% CI \[70\.6%, 86\.1%\]")

    def test_sessions_are_capped_and_the_id_format_is_taught(self):
        out = et.format_result(load("query"), sessions=3)
        self.assertIn("latest sessions (3 of 102)", out)
        self.assertIn("2024-12-24 miss", out)
        self.assertIn("2024-12-17 hit (0 min)", out)
        self.assertIn("DEMO_STK|rth|2024-12-24", out)
        self.assertEqual(et.format_result(load("query"), sessions=0).count("latest sessions"), 0)

    def test_the_disclaimer_always_closes_the_answer(self):
        for name in ("query", "query_low", "preset_grouped"):
            out = et.format_result(load(name))
            self.assertIn("Not predictions, not advice", out)
            self.assertTrue(out.rstrip().splitlines()[-1].strip().startswith("engine "))

    def test_a_missing_estimate_never_crashes(self):
        env = load("query")
        for key in ("estimate", "ci95", "stability", "recency", "perYear", "distribution", "sessions", "groups"):
            env[key] = None
        out = et.format_result(env)
        self.assertIn("estimate –", out)


class Session(unittest.TestCase):
    def test_levels_and_times_are_summarised(self):
        out = et.format_session(load("session_bars"))
        self.assertIn("DEMO_STK · 2024-12-17 · session rth", out)
        self.assertIn("prior session: high 388.11 · low 380.35 · close 382.01", out)
        self.assertIn("gap up +0.01% — filled 0 min after the open", out)
        self.assertIn("opening range 5m: 379.91–382.32 · first break down at +16 min", out)
        self.assertIn("touched prior low at +3 min", out)

    def test_an_incomplete_session_says_so(self):
        v = load("session_bars")
        v["complete"] = False
        self.assertIn("INCOMPLETE", et.format_session(v))


class Catalogue(unittest.TestCase):
    def test_presets_list_with_params_and_categories(self):
        out = et.format_presets(load("presets")["presets"])
        self.assertIn("- day-after-event [events] Day After an Event — params: event=OPEX", out)
        self.assertIn("categories:", out)

    def test_a_category_filter_and_a_wrong_one(self):
        rows = load("presets")["presets"]
        cat = rows[0]["category"]
        self.assertTrue(et.format_presets(rows, cat).startswith(f"{sum(1 for r in rows if r['category'] == cat)} report(s)"))
        self.assertIn("categories:", et.format_presets(rows, "nonsense"))

    def test_fields_filter_by_kind_and_search_and_teach_the_language(self):
        entries = load("registry")["entries"]
        out = et.format_fields(entries, kind="outcome")
        self.assertIn("OUTCOME [WHERE condition", out)
        self.assertIn("- outcome gapFill", out)
        self.assertIn("e.g. gapFill", out)
        self.assertIn("gapUp", et.format_fields(entries, search="gapped up"))
        self.assertIn("nothing in the registry", et.format_fields(entries, search="zzzz"))
        self.assertIn("showing 3", et.format_fields(entries, limit=3))

    def test_enum_values_and_arguments_are_shown(self):
        entries = [{"kind": "field", "name": "dayOfWeek", "doc": "Weekday.", "valueType": "enum", "enumValues": ["Mon", "Tue"]},
                   {"kind": "outcome", "name": "orbBreak", "doc": "Break.", "args": [{"name": "window"}, {"name": "dir"}], "valueUnit": "minutes"}]
        out = et.format_fields(entries)
        self.assertIn("dayOfWeek = Mon|Tue", out)
        self.assertIn("orbBreak(window, dir) → value in minutes", out)


class Status(unittest.TestCase):
    def test_not_installed_carries_the_fix(self):
        out = et.format_status({"install": {"installed": False, "problem": "not_installed", "fix": "Run ./install.sh --with-edge"}})
        self.assertTrue(out.startswith("✗"))
        self.assertIn("--with-edge", out)

    def test_installed_without_data_points_at_the_demo(self):
        out = et.format_status({"install": {"installed": True, "commit": "a" * 40, "node": "v22"}, "service": {"state": "stopped"},
                                "symbols": [], "sources": [{"id": "binance", "market": "crypto"}]})
        self.assertIn("edgestats_setup(source='demo')", out)
        self.assertIn("binance (crypto)", out)

    def test_symbols_and_a_running_job(self):
        now = time.time()
        out = et.format_status({"install": {"installed": True, "commit": "a" * 40, "node": "v22"}, "service": {"state": "ready"},
                                "symbols": [{"symbol": "BTCUSDT", "adapter": "binance", "lastBar": "2026-10-03T20:59:00Z"}],
                                "store_mb": 12.5,
                                "job": {"label": "Updating the data", "status": "running", "step": "downloading", "started": now - 5,
                                        "tail": ["BTCUSDT: downloading 2026-09"]}})
        self.assertIn("BTCUSDT (binance, to 2026-10-03)", out)
        self.assertIn("store 12.5 MB", out)
        self.assertIn("questions are paused", out)

    def test_job_verdicts(self):
        base = {"label": "x", "started": time.time() - 3, "finished": time.time(), "tail": ["a", "b"]}
        self.assertTrue(et.format_job({**base, "status": "done"}).startswith("✓"))
        self.assertTrue(et.format_job({**base, "status": "failed", "error": "boom"}).startswith("✗"))
        self.assertIn("boom", et.format_job({**base, "status": "failed", "error": "boom"}))
        self.assertTrue(et.format_job({**base, "status": "cancelled"}).startswith("◆"))
        self.assertIn("no data job", et.format_job(None))


class Units(unittest.TestCase):
    def test_values(self):
        self.assertEqual(et.fmt_value(0, "minutes"), "0 min")
        self.assertEqual(et.fmt_value(100, "minutes"), "1h 40m")
        self.assertEqual(et.fmt_value(120, "minutes"), "2h")
        self.assertEqual(et.fmt_value(1.5, "r"), "1.50 R")
        self.assertEqual(et.fmt_value(0.5, "%"), "0.50%")
        self.assertEqual(et.fmt_value(None, "minutes"), "")
        self.assertEqual(et.fmt_value(True, "minutes"), "")
        self.assertEqual(et.pct(None), "–")
        self.assertEqual(et.pct(0.7941), "79.4%")


if __name__ == "__main__":
    unittest.main()
