"""The desk sheet (16 Oct 2026): the paper account + its journal — and the prop-firm reads — in one surface.

It replaced the small account popover broker.js painted. The popover could show a balance; it had
nowhere to say what the account DID (win rate, profit factor, the curve), which is the half LuxAlgo's
own app shows and ours did not.

What these tests protect, in the console's own terms:
  * the sheet is a READER — the only thing it may post is the account reset, and that one asks first;
    the approve/reject brake stays on the card, in broker.js, exactly where it was;
  * a rate with no sample prints — (a dash), and a profit factor with no losing trade prints ∞ —
    neither may be dressed up as 0 or as a number;
  * no door out: the sheet never opens a browser or a link, so the prop-firm offers are text + code;
  * the skin is the console's: --lx tokens, transform/opacity motion, reduced-motion respected.
"""

import re
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parents[1]
FRONT = ROOT / "console" / "frontend"

HTML = (FRONT / "index.html").read_text(encoding="utf-8")
JS = (FRONT / "desk.js").read_text(encoding="utf-8")
CSS = (FRONT / "desk.css").read_text(encoding="utf-8")


class TheSheetIsOnThePage(unittest.TestCase):
    def test_the_page_carries_the_sheet_its_skin_and_its_logic(self):
        for hook in ('id="desk-sheet"', 'id="desk-scrim"', 'id="desk-tabs"', 'id="desk-body"', 'id="desk-close"'):
            self.assertIn(hook, HTML, f"the sheet is missing {hook}")
        self.assertIn("./desk.css", HTML)
        self.assertIn('src="./desk.js"', HTML)

    def test_it_is_a_dialog_with_the_same_chrome_family_as_the_edge_sheet(self):
        self.assertRegex(HTML, r'class="desk-sheet"[^>]*role="dialog"[^>]*aria-modal="true"')
        self.assertIn('aria-hidden="true"', HTML)
        self.assertIn('role="tablist"', HTML)
        self.assertIn('role="tab"', JS, "the tabs must say they are tabs")

    def test_three_views_the_account_the_journal_the_firms(self):
        for tab in ("'paper'", "'journal'", "'propfirms'"):
            self.assertIn(tab, JS)
        for label in ("Paper", "Journal", "Prop firms"):
            self.assertIn(label, JS)

    def test_it_opens_from_the_more_menu_on_the_paper_view(self):
        ws = (FRONT / "workspace.js").read_text(encoding="utf-8")
        self.assertIn("taDesk", ws)
        self.assertIn("open('paper')", ws)


class TheSheetIsAReaderNotATrader(unittest.TestCase):
    def test_it_cannot_approve_or_reject_anything(self):
        """The brake is the card. If the sheet could approve, the sheet would be a second brake pedal."""
        self.assertNotIn("/api/broker/approve", JS)
        self.assertNotIn("/api/broker/reject", JS)
        self.assertNotIn("data-approve", JS)

    def test_the_one_write_it_has_asks_first(self):
        self.assertIn("/api/broker/reset", JS)
        self.assertIn("window.confirm", JS)

    def test_it_reads_the_broker_the_firms_and_the_offers(self):
        self.assertIn("/api/broker", JS)
        self.assertIn("/api/propfirms", JS)
        self.assertIn("/api/offers", JS)

    def test_no_door_out_of_hermes(self):
        """The plugin rule: nothing here opens a browser. Offers are text and a code, never a link."""
        for banned in ("window.open", "target=", "_blank", "location.href", "http://", "https://"):
            self.assertNotIn(banned, JS, f"the sheet must not contain {banned!r}")

    def test_it_repaints_from_the_same_events_the_card_hears(self):
        self.assertIn("ta-broker", JS)


class TheJournalSaysOnlyWhatItKnows(unittest.TestCase):
    def test_the_rates_come_from_the_broker_stats(self):
        for key in ("stats", "win_rate", "profit_factor", "avg_win", "avg_loss", "curve", "closed", "start_cash"):
            self.assertIn(key, JS, f"the journal never reads {key}")

    def test_a_rate_with_no_sample_prints_a_dash_never_a_zero(self):
        self.assertIn("'—'", JS)
        self.assertRegex(JS, r"v == null \? '—'", "None must print as —, not as 0%")

    def test_a_profit_factor_with_no_losing_trade_prints_infinity(self):
        self.assertIn("'∞'", JS)
        self.assertRegex(JS, r"wins > 0 \? '∞'", "∞ needs a win to mean 'no loss yet'")

    def test_every_rate_carries_its_sample_size(self):
        self.assertIn("of ${n}", JS, "a rate without its N is a decoration")
        self.assertIn("fills_kept", JS, "the sheet must say how many fills the account still holds")

    def test_the_curve_is_a_canvas_with_a_baseline_and_the_accounts_own_numbers(self):
        self.assertIn("canvas", JS)
        self.assertIn("getContext", JS)
        self.assertIn("--lx-profit", JS)
        self.assertIn("--lx-loss", JS)
        self.assertIn("setLineDash", JS, "the starting-cash baseline is what makes up/down readable")
        self.assertIn("resize", JS, "the curve redraws when the pane changes width")

    def test_it_says_the_curve_is_realised_only(self):
        self.assertIn("realised", JS.lower())
        self.assertIn("closed", JS.lower(), "an open position's P&L is not this curve")


class TheSkinIsTheConsolesSkin(unittest.TestCase):
    def test_tokens_only_no_raw_colours(self):
        body = CSS.split("@media", 1)[0]
        self.assertNotRegex(body, r"#[0-9a-fA-F]{3,6}\b", "colours come from --lx-* tokens only")
        self.assertIn("var(--lx-", CSS)

    def test_motion_is_transform_and_opacity(self):
        block = re.search(r"\.desk-sheet \{(.*?)\}", CSS, re.S).group(1)
        self.assertIn("transform: translateX(104%)", block)
        self.assertNotRegex(block, r"transition:[^;]*\b(height|width|top|left)\b")

    def test_it_respects_reduced_motion(self):
        self.assertIn("prefers-reduced-motion", CSS)

    def test_escape_and_the_scrim_close_it_and_focus_comes_back(self):
        self.assertIn("'Escape'", JS)
        self.assertIn("onAway", JS)
        self.assertIn("preventScroll", JS, "closing must hand focus back where it came from")

    def test_the_tabs_move_with_the_arrow_keys(self):
        self.assertIn("'ArrowRight'", JS)
        self.assertIn("'ArrowLeft'", JS)


if __name__ == "__main__":
    unittest.main()


class TheDataCard(unittest.TestCase):
    """The Data tab says what actually feeds the chart, so the operator never has to guess the source."""

    @classmethod
    def setUpClass(cls):
        cls.js = (Path(__file__).resolve().parents[2] / "frontend/desk.js").read_text(encoding="utf-8")

    def test_data_is_a_tab(self):
        self.assertIn("['data', 'Data']", self.js)

    def test_it_reads_the_tick_store_endpoint(self):
        self.assertIn("call('/api/fx/status')", self.js)
        self.assertIn("status.ticks", self.js)

    def test_it_says_yahoo_is_off(self):
        # the operator's ruling: no silent substitution, and the card has to say so
        self.assertIn("Yahoo off", self.js)

    def test_the_yahoo_line_follows_the_server_not_a_constant(self):
        # with TRADERS_FX_ALLOW_YAHOO=1 the card used to keep saying "Yahoo off"
        self.assertIn("status.yahoo", self.js)

    def test_the_card_rereads_the_store_each_time_the_tab_opens(self):
        # a download finished while the console ran was invisible until a page reload
        self.assertNotIn("S.data.asked", self.js)

    def test_symbols_are_escaped(self):
        self.assertIn("esc(sym)", self.js)
