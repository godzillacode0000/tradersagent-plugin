"""The Strategy tester (19 Oct 2026): the broker emulator rebuilt on an intrabar model.

Vela 0.8.5 + vela-pinets 0.2.17 + PineTS 0.12.0 shipped on 19 Oct; the engine now resolves fills and
exits *inside* the bar, with commission, slippage, margin and trailing stops, and returns a real
ledger (round trips with per-trade commission and excursions). This suite holds the reader side:

- the strip exists, is linked in the right order, and prints the five numbers Vela's own tester shows;
- missing data looks missing (`—` for no sample, `∞` for a profit factor with no losing trade);
- the ratio is computed from the ledger when the worker's smaller summary omits the totals, and the
  footer says which source it used — never "commission none" for a run that paid commission;
- every strategy run publishes to it, on both engine paths, with the declaration's title recovered
  from the source the worker's summary dropped;
- the agent reads the same ledger through chart_apply's answer;
- the vendored versions are the ones the update shipped.
"""

import importlib.util
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
FRONT = ROOT / "frontend"

# Loaded by path: console/mcp/server.py and console/backend/server.py share a filename, and the
# backend's own `server` is already in sys.modules by the time this file is collected.
MCP_FILE = ROOT / "mcp" / "server.py"
_spec = importlib.util.spec_from_file_location("td_mcp_tester_strip", MCP_FILE)
mcp = importlib.util.module_from_spec(_spec)
sys.modules["td_mcp_tester_strip"] = mcp
_spec.loader.exec_module(mcp)

JS = (FRONT / "tester.js").read_text(encoding="utf-8")
CSS = (FRONT / "tester.css").read_text(encoding="utf-8")
RUNNER = (FRONT / "pinets-runner.js").read_text(encoding="utf-8")
HTML = (FRONT / "index.html").read_text(encoding="utf-8")


class TheStripExists(unittest.TestCase):
    def test_it_is_linked_and_loads_before_the_runner(self):
        self.assertIn('<link rel="stylesheet" href="./tester.css" />', HTML)
        self.assertLess(HTML.index("tester.js"), HTML.index("pinets-runner.js"),
                        "the strip must exist before the first run publishes to it")
        self.assertIn("window.TraderTester", JS)

    def test_it_shows_the_five_numbers_vela_shows(self):
        for label in ("Net profit", "Trades", "Win rate", "Max drawdown", "Profit factor"):
            self.assertIn(label, JS, f"the strip never prints {label}")
        self.assertIn("intrabar fills", JS, "the update's own claim, on the strip")

    def test_the_curve_says_what_it_is(self):
        self.assertIn("cumulative closed-trade", JS)
        self.assertIn("not an intra-bar equity path", JS)

    def test_it_is_a_reader_with_no_door_out(self):
        for forbidden in ("window.open", "location.href", "http://", "https://"):
            self.assertNotIn(forbidden, JS, f"the tester must not carry a door out ({forbidden})")


class MissingDataLooksMissing(unittest.TestCase):
    def test_a_rate_with_no_sample_prints_a_dash(self):
        self.assertIn("no sample", JS)
        self.assertIn("winRate: decided ? (wins / decided) * 100 : null", JS)

    def test_a_profit_factor_with_no_losing_trade_prints_infinity(self):
        self.assertIn("pf = Infinity", JS)
        self.assertIn("'∞'", JS)

    def test_gross_and_loss_come_from_the_ledger_when_the_engine_omits_them(self):
        self.assertIn("fromEngine", JS)
        self.assertIn("book.up", JS)
        self.assertIn("from the closed trades", JS)

    def test_commission_paid_is_never_reported_as_none(self):
        self.assertIn("paid (from the fills)", JS)


class EveryRunPublishes(unittest.TestCase):
    def test_both_engine_paths_reach_the_strip(self):
        self.assertEqual(RUNNER.count("publishStrategy("), 3, "definition + worker + main-thread")

    def test_a_worker_summary_without_config_still_gets_its_title(self):
        self.assertIn("declaredTitle", RUNNER)
        self.assertIn("declaredTitle(source)", RUNNER, "the title is read from the declaration")
        self.assertIn("strategy", RUNNER[RUNNER.index("function declaredTitle"):][:400].lower())

    def test_a_failing_strip_never_fails_the_run(self):
        self.assertIn("a view failing is not the run failing", RUNNER)


class TheAgentReadsTheLedger(unittest.TestCase):
    def test_one_line_with_every_figure_labelled(self):
        line = mcp._ledger_line({
            "netprofit": -189.55, "closedtrades": 11, "wintrades": 3, "losstrades": 8,
            "max_drawdown": 194.15, "max_drawdown_pct": 2.38, "currency": "USD", "slippage": 2,
            "commission": None, "trades": [{"profit": 6.75, "commission": 1.98}],
        })
        for needle in ("net -189.55 USD", "11 trades", "win 27.3% (n=11)", "max DD 194.15 (2.38%)",
                       "PF ", "commission 1.98 paid", "slippage 2", "intrabar fills"):
            self.assertIn(needle, line)

    def test_no_losing_trade_is_infinity_not_a_number(self):
        line = mcp._ledger_line({"netprofit": 100, "closedtrades": 2, "wintrades": 2, "losstrades": 0,
                                 "grossprofit": 100, "grossloss": 0})
        self.assertIn("PF ∞", line)

    def test_a_positive_engine_grossloss_is_a_number_not_infinity(self):
        # PineTS reports grossloss as a positive magnitude; only a zero loss may print ∞.
        line = mcp._ledger_line({"netprofit": 81.46, "closedtrades": 11, "wintrades": 5, "losstrades": 6,
                                 "grossprofit": 144.07, "grossloss": 62.62})
        self.assertIn("PF 2.30", line)
        self.assertNotIn("∞", line)

    def test_no_sample_says_so(self):
        line = mcp._ledger_line({"netprofit": 0, "closedtrades": 3, "wintrades": 0, "losstrades": 0})
        self.assertIn("no decided sample", line)

    def test_a_non_strategy_result_adds_nothing(self):
        self.assertEqual(mcp._ledger_line(None), "")
        self.assertEqual(mcp._ledger_line({}), "")

    def test_the_answer_carries_the_line(self):
        self.assertIn('_ledger_line(result.get("strategy"))', MCP_FILE.read_text(encoding="utf-8"))


class TheShippedVersions(unittest.TestCase):
    def test_the_vendor_notes_name_the_update(self):
        vendoring = (FRONT / "vendor" / "VENDORING.md").read_text(encoding="utf-8")
        self.assertIn("vela 0.8.5", vendoring)
        self.assertIn("vela-pinets 0.2.17", vendoring)

    def test_the_engine_provenance_names_012(self):
        prov = (FRONT / "vendor" / "pinets" / "PROVENANCE.md").read_text(encoding="utf-8")
        self.assertIn("0.12.0", prov)
        self.assertIn("walkInitExpression", prov, "the rebase moved patch 2 into the extracted walker")
