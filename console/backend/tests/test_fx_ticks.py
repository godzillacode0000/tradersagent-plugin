"""The Dukascopy v1 tick decoder (tools/fx-fetch.py).

The v1 API does not send prices and times directly: `times` are milliseconds SINCE THE PREVIOUS TICK,
and `bids`/`asks` are tick-count deltas since the previous price, with `multiplier` turning a delta
into a price. Cumulative sums are the whole game — a decoder that treats them as absolute values
produces plausible-looking prices that drift, and nothing downstream would notice. So the decoder is
one function, and this pins it on a synthetic hour plus the instrument map and the 1-based month.
"""

import importlib.util
import datetime as dt
import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
REPO = TESTS.parents[2]
TOOL = REPO / "tools" / "fx-fetch.py"

_spec = importlib.util.spec_from_file_location("fx_fetch", TOOL)
fxf = importlib.util.module_from_spec(_spec)
sys.modules["fx_fetch"] = fxf
_spec.loader.exec_module(fxf)


class TheDeltaDecode(unittest.TestCase):
    DOC = {
        "timestamp": 1787565600000,          # an hour boundary
        "multiplier": 1e-5,
        "bid": 1.30000,
        "ask": 1.30002,
        "times": [100, 250, 50],             # cumulative → 100, 350, 400 ms
        "bids": [0, 2, -1],                  # cumulative ticks → 0, +2, +1
        "asks": [0, -2, 3],                  # cumulative ticks → 0, -2, +1
        "bidVolumes": [1.0, 2.0, 3.0],
        "askVolumes": [4.0, 5.0, 6.0],
    }

    def test_times_are_cumulative_offsets(self):
        ticks = fxf.decode_hour(self.DOC)
        self.assertEqual([t[0] - 1787565600000 for t in ticks], [100, 350, 400])

    def test_prices_are_base_plus_cumulative_delta(self):
        ticks = fxf.decode_hour(self.DOC)
        self.assertAlmostEqual(ticks[0][1], 1.30000, places=6)      # +0 ticks
        self.assertAlmostEqual(ticks[1][1], 1.30002, places=6)      # +2 ticks
        self.assertAlmostEqual(ticks[2][1], 1.30001, places=6)      # +1 tick
        self.assertAlmostEqual(ticks[1][2], 1.30000, places=6)      # ask -2 ticks
        self.assertAlmostEqual(ticks[2][2], 1.30003, places=6)      # ask +1 tick

    def test_volumes_ride_along_in_order(self):
        ticks = fxf.decode_hour(self.DOC)
        self.assertEqual([t[3] for t in ticks], [1.0, 2.0, 3.0])
        self.assertEqual([t[4] for t in ticks], [4.0, 5.0, 6.0])

    def test_an_empty_hour_is_no_ticks(self):
        self.assertEqual(fxf.decode_hour({"timestamp": 0, "multiplier": 1e-5, "bid": 1, "ask": 1,
                                          "times": [], "bids": [], "asks": []}), [])

    def test_mismatched_arrays_stop_at_the_shortest(self):
        doc = dict(self.DOC, asks=[0, -2])          # one ask missing: zip() keeps two ticks
        self.assertEqual(len(fxf.decode_hour(doc)), 2)


class TheInstrumentMap(unittest.TestCase):
    def test_the_seven_instruments_have_feed_codes(self):
        for symbol, code in {"GBPUSD": "GBP-USD", "EURUSD": "EUR-USD", "GBPJPY": "GBP-JPY",
                             "XAUUSD": "XAU-USD", "XAGUSD": "XAG-USD",
                             "NAS100": "USATECH.IDX-USD", "SP500": "USA500.IDX-USD"}.items():
            self.assertEqual(fxf.INSTRUMENTS[symbol], code)

    def test_storage_layout_is_symbol_day_hour(self):
        path = fxf.hour_path("GBPUSD", dt.datetime(2026, 9, 24, 10, tzinfo=dt.timezone.utc))
        self.assertTrue(str(path).endswith("GBPUSD/2026-09-24/10.json.gz"))
