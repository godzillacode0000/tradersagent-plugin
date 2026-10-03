"""The paper broker (Phase 5, 3 Oct): every order is a PROPOSAL until the operator approves it.

Kevin's decisions: Binance, paper trading first, an Approve/Reject card on EVERY order. So the engine
has one rule above all: proposing never moves money. Only `approve` fills, and it fills at the price
read at the moment of approval — never at the price the agent saw when it proposed.
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from broker import PaperBroker, BrokerError  # noqa: E402


class Prices:
    """A price feed the test controls."""
    def __init__(self, **p):
        self.p = dict(p)

    def __call__(self, symbol):
        if symbol not in self.p or self.p[symbol] is None:
            raise BrokerError("no_price", f"no price for {symbol}")
        return float(self.p[symbol])


def make(prices=None, **kw):
    d = tempfile.mkdtemp()
    path = os.path.join(d, "paper.json")
    return PaperBroker(path, prices or Prices(BTCUSDT=100.0, ETHUSDT=10.0), **kw), path


class ProposingMovesNoMoney(unittest.TestCase):
    def test_a_proposal_is_pending_and_the_account_is_untouched(self):
        b, _ = make()
        o = b.propose("BTCUSDT", "buy", 1, note="breakout")
        self.assertEqual(o["status"], "pending")
        s = b.state()
        self.assertEqual(s["cash"], 10000.0)
        self.assertEqual(s["positions"], [])
        self.assertEqual([x["id"] for x in s["pending"]], [o["id"]])

    def test_reject_leaves_nothing_behind(self):
        b, _ = make()
        o = b.propose("BTCUSDT", "buy", 1)
        b.reject(o["id"])
        s = b.state()
        self.assertEqual((s["cash"], s["positions"], s["pending"]), (10000.0, [], []))
        self.assertEqual(b.get(o["id"])["status"], "rejected")


class ApprovingFillsAtTheApprovalPrice(unittest.TestCase):
    def test_fill_uses_the_price_at_approval_not_at_proposal(self):
        prices = Prices(BTCUSDT=100.0)
        b, _ = make(prices)
        o = b.propose("BTCUSDT", "buy", 2)
        prices.p["BTCUSDT"] = 110.0                       # the market moved while the card sat there
        f = b.approve(o["id"])
        self.assertEqual(f["status"], "filled")
        self.assertEqual(f["price"], 110.0)

    def test_buy_pays_price_plus_fee(self):
        b, _ = make(fee=0.001)
        o = b.propose("BTCUSDT", "buy", 10)               # 10 x 100 = 1000, fee 1.0
        b.approve(o["id"])
        s = b.state()
        self.assertAlmostEqual(s["cash"], 10000 - 1000 - 1.0)
        self.assertEqual(s["positions"][0]["symbol"], "BTCUSDT")
        self.assertEqual(s["positions"][0]["qty"], 10)

    def test_sell_closes_and_books_realised_pnl(self):
        prices = Prices(BTCUSDT=100.0)
        b, _ = make(prices, fee=0.0)
        b.approve(b.propose("BTCUSDT", "buy", 10)["id"])
        prices.p["BTCUSDT"] = 120.0
        b.approve(b.propose("BTCUSDT", "sell", 10)["id"])
        s = b.state()
        self.assertEqual(s["positions"], [])
        self.assertAlmostEqual(s["cash"], 10000 + 200)
        self.assertAlmostEqual(s["realized"], 200)

    def test_average_entry_across_two_buys(self):
        prices = Prices(BTCUSDT=100.0)
        b, _ = make(prices, fee=0.0)
        b.approve(b.propose("BTCUSDT", "buy", 1)["id"])
        prices.p["BTCUSDT"] = 200.0
        b.approve(b.propose("BTCUSDT", "buy", 1)["id"])
        self.assertAlmostEqual(b.state()["positions"][0]["avg"], 150.0)

    def test_unrealised_pnl_is_marked_to_the_live_price(self):
        prices = Prices(BTCUSDT=100.0)
        b, _ = make(prices, fee=0.0)
        b.approve(b.propose("BTCUSDT", "buy", 2)["id"])
        prices.p["BTCUSDT"] = 130.0
        p = b.state()["positions"][0]
        self.assertAlmostEqual(p["mark"], 130.0)
        self.assertAlmostEqual(p["unrealized"], 60.0)


class TheGuards(unittest.TestCase):
    def test_cannot_buy_more_than_the_cash(self):
        b, _ = make()
        o = b.propose("BTCUSDT", "buy", 1000)             # 100,000 > 10,000
        with self.assertRaises(BrokerError) as cm:
            b.approve(o["id"])
        self.assertEqual(cm.exception.code, "insufficient_cash")
        self.assertEqual(b.get(o["id"])["status"], "pending", "a refused fill stays on the card")
        self.assertEqual(b.state()["cash"], 10000.0)

    def test_spot_has_no_shorting(self):
        b, _ = make()
        o = b.propose("BTCUSDT", "sell", 1)
        with self.assertRaises(BrokerError) as cm:
            b.approve(o["id"])
        self.assertEqual(cm.exception.code, "insufficient_position")

    def test_an_order_cannot_be_approved_twice(self):
        b, _ = make(fee=0.0)
        o = b.propose("BTCUSDT", "buy", 1)
        b.approve(o["id"])
        with self.assertRaises(BrokerError) as cm:
            b.approve(o["id"])
        self.assertEqual(cm.exception.code, "not_pending")
        self.assertEqual(b.state()["positions"][0]["qty"], 1, "one fill, not two")

    def test_no_price_means_no_fill_and_the_card_stays(self):
        b, _ = make(Prices(BTCUSDT=None))
        o = b.propose("BTCUSDT", "buy", 1)
        with self.assertRaises(BrokerError) as cm:
            b.approve(o["id"])
        self.assertEqual(cm.exception.code, "no_price")
        self.assertEqual(b.get(o["id"])["status"], "pending")

    def test_bad_input_is_refused_at_proposal(self):
        b, _ = make()
        for args in [("BTCUSDT", "hold", 1), ("BTCUSDT", "buy", 0), ("BTCUSDT", "buy", -1),
                     ("BTCUSDT", "buy", float("nan")), ("BTCUSDT", "buy", float("inf")),
                     ("btc usdt;", "buy", 1), ("", "buy", 1), ("BTCUSDT", "buy", "lots")]:
            with self.assertRaises(BrokerError, msg=str(args)):
                b.propose(*args)

    def test_symbol_is_normalised(self):
        b, _ = make()
        self.assertEqual(b.propose(" btcusdt ", "BUY", 1)["symbol"], "BTCUSDT")

    def test_the_pending_queue_is_capped(self):
        b, _ = make(max_pending=3)
        for _ in range(3):
            b.propose("BTCUSDT", "buy", 1)
        with self.assertRaises(BrokerError) as cm:
            b.propose("BTCUSDT", "buy", 1)
        self.assertEqual(cm.exception.code, "too_many_pending")

    def test_unknown_id_is_a_clean_error(self):
        b, _ = make()
        for fn in (b.approve, b.reject):
            with self.assertRaises(BrokerError) as cm:
                fn(999)
            self.assertEqual(cm.exception.code, "unknown_order")


class StateSurvivesRestarts(unittest.TestCase):
    def test_reload_gives_the_same_account(self):
        b, path = make(fee=0.0)
        b.approve(b.propose("BTCUSDT", "buy", 3)["id"])
        pending = b.propose("ETHUSDT", "buy", 5)
        again = PaperBroker(path, Prices(BTCUSDT=100.0, ETHUSDT=10.0), fee=0.0)
        s = again.state()
        self.assertAlmostEqual(s["cash"], 10000 - 300)
        self.assertEqual(s["positions"][0]["qty"], 3)
        self.assertEqual([x["id"] for x in s["pending"]], [pending["id"]])
        nxt = again.propose("BTCUSDT", "buy", 1)
        self.assertGreater(nxt["id"], pending["id"], "ids never repeat across a restart")

    def test_the_file_is_private_and_valid_json(self):
        b, path = make()
        b.propose("BTCUSDT", "buy", 1)
        self.assertEqual(oct(os.stat(path).st_mode & 0o777), "0o600")
        json.load(open(path))

    def test_a_corrupt_file_is_set_aside_not_trusted(self):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "paper.json")
        open(path, "w").write("{not json")
        b = PaperBroker(path, Prices(BTCUSDT=100.0))
        self.assertEqual(b.state()["cash"], 10000.0)
        self.assertTrue(any(n.startswith("paper.json.bad") for n in os.listdir(d)),
                        "the broken file is kept for inspection, not deleted")

    def test_reset_starts_over(self):
        b, _ = make(fee=0.0)
        b.approve(b.propose("BTCUSDT", "buy", 3)["id"])
        b.reset()
        s = b.state()
        self.assertEqual((s["cash"], s["positions"], s["pending"], s["realized"]), (10000.0, [], [], 0.0))

    def test_history_is_bounded(self):
        b, _ = make(fee=0.0, keep=5)
        for _ in range(12):
            b.reject(b.propose("BTCUSDT", "buy", 1)["id"])
        self.assertLessEqual(len(b.state()["history"]), 5)


class ItIsPaperAndSaysSo(unittest.TestCase):
    def test_state_names_the_mode(self):
        b, _ = make()
        self.assertEqual(b.state()["mode"], "paper")
        self.assertEqual(b.state()["venue"], "binance")


if __name__ == "__main__":
    unittest.main()
