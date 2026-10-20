"""The FX loader (20 Oct): Dukascopy's free tick files → bars, with a Yahoo fallback that says so.

These tests never touch the network: a synthetic hour is compressed exactly the way Dukascopy
publishes it (LZMA alone, `>IIIff` records, prices as ints scaled by 10^digits), and the HTTP doors
are exercised with `fxdata.bars` stubbed. What is being held here:

- the file format is read correctly (scale, timestamps, volumes, truncated tail);
- the hour cache is real (a second call does not fetch) and a 404 is an answer, not an error;
- a burst that gets 429 is retried, not cached as an empty hour;
- `request.security`-style second pairs and the coverage metadata (`source`, `lag_hours`) are honest;
- the endpoints map a bad pair to 400 and a good one to bars.
"""

import datetime as dt
import lzma
import os
import struct
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import fxdata  # noqa: E402
import server as srv  # noqa: E402

TOKEN = "test-token"


def hour_bytes(ticks):
    """A Dukascopy hour: LZMA-alone of `>IIIff` records (ms offset, ask, bid, askVol, bidVol)."""
    scale = 10 ** 5
    blob = b"".join(struct.pack(">IIIff", ms, int(ask * scale), int(bid * scale), av, bv)
                    for ms, ask, bid, av, bv in ticks)
    return lzma.compress(blob, format=lzma.FORMAT_ALONE)


class TheFileFormat(unittest.TestCase):
    def test_one_hour_decodes_with_its_own_scale_and_times(self):
        raw = hour_bytes([(0, 1.32610, 1.32606, 0.5, 0.5), (1500, 1.32620, 1.32615, 1.0, 2.0)])
        base = int(dt.datetime(2026, 9, 15, 10, tzinfo=dt.timezone.utc).timestamp() * 1000)
        out = fxdata.decode_hour(raw, base, "GBPUSD")
        self.assertEqual(len(out), 2)
        self.assertAlmostEqual(out[0][1], 1.32606, places=5)
        self.assertAlmostEqual(out[0][2], 1.32610, places=5)
        self.assertEqual(out[1][0], base + 1500)
        self.assertAlmostEqual(out[1][3], 3.0)          # bid + ask volume

    def test_a_jpy_pair_uses_three_decimals(self):
        blob = struct.pack(">IIIff", 0, 147123, 147120, 1.0, 1.0)
        raw = lzma.compress(blob, format=lzma.FORMAT_ALONE)
        out = fxdata.decode_hour(raw, 0, "USDJPY")
        self.assertAlmostEqual(out[0][1], 147.120, places=3)

    def test_a_truncated_tail_record_is_dropped_not_guessed(self):
        good = hour_bytes([(0, 1.3, 1.2999, 1, 1)])
        raw = lzma.compress(lzma.decompress(good) + b"\x00\x00\x00", format=lzma.FORMAT_ALONE)
        self.assertEqual(len(fxdata.decode_hour(raw, 0, "GBPUSD")), 1)

    def test_an_empty_hour_is_no_ticks(self):
        self.assertEqual(fxdata.decode_hour(b"", 0, "GBPUSD"), [])


class TheCacheAndTheFeed(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.patch = mock.patch.object(fxdata, "CACHE", Path(self.tmp.name))
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.calls = []

    def fake(self, payload=b"", code=200):
        class Res:
            def __init__(self, body):
                self.body = body

            def read(self):
                return self.body

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def urlopen(req, timeout=0, **kw):
            self.calls.append(req.full_url)
            if code != 200:
                raise urllib.error.HTTPError(req.full_url, code, "err", {}, None)
            return Res(payload)
        return urlopen

    def test_a_second_call_reads_the_disk(self):
        when = dt.datetime(2026, 9, 15, 10, tzinfo=dt.timezone.utc)
        with mock.patch("urllib.request.urlopen", self.fake(b"PAYLOAD")):
            self.assertEqual(fxdata._download("GBPUSD", when), b"PAYLOAD")
            self.assertEqual(fxdata._download("GBPUSD", when), b"PAYLOAD")
        self.assertEqual(len(self.calls), 1, "one fetch, then the cache")

    def test_a_404_is_an_answer_and_is_cached(self):
        when = dt.datetime(2026, 10, 15, 10, tzinfo=dt.timezone.utc)
        with mock.patch("urllib.request.urlopen", self.fake(code=404)):
            self.assertEqual(fxdata._download("GBPUSD", when), b"")
            self.assertEqual(fxdata._download("GBPUSD", when), b"")
        self.assertEqual(len(self.calls), 1)

    def test_429_is_retried_and_never_cached_as_empty(self):
        when = dt.datetime(2026, 10, 15, 10, tzinfo=dt.timezone.utc)
        with mock.patch("urllib.request.urlopen", self.fake(code=429)), \
             mock.patch("time.sleep"):
            with self.assertRaises(fxdata.FxError) as ctx:
                fxdata._download("GBPUSD", when)
        self.assertEqual(ctx.exception.code, "feed_unreachable")     # throttled out, not a 404
        self.assertFalse(fxdata.hour_path("GBPUSD", when).exists(), "a throttled hour must not be cached")

    def test_a_connection_reset_is_retried_then_survives(self):
        when = dt.datetime(2026, 9, 15, 10, tzinfo=dt.timezone.utc)
        attempts = {"n": 0}

        class Res:
            def read(self):
                return b"OK"

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def flaky(req, timeout=0, **kw):
            attempts["n"] += 1
            if attempts["n"] == 1:
                raise ConnectionResetError(54, "reset")
            return Res()

        with mock.patch("urllib.request.urlopen", flaky), mock.patch("time.sleep"):
            self.assertEqual(fxdata._download("GBPUSD", when), b"OK")
        self.assertEqual(attempts["n"], 2)


class TheBars(unittest.TestCase):
    def test_resample_keeps_first_open_last_close_and_extremes(self):
        m1 = {
            0: {"t": 0, "o": 1.0, "h": 1.2, "l": 0.9, "c": 1.1, "v": 1},
            60000: {"t": 60000, "o": 1.1, "h": 1.4, "l": 1.0, "c": 1.3, "v": 2},
            1800000: {"t": 1800000, "o": 1.3, "h": 1.35, "l": 1.25, "c": 1.28, "v": 4},
        }
        out = fxdata._resample(m1, 30)
        # 1,800,000 ms is exactly one bucket away, so t=1800000 opens the NEXT bar (the loader is
        # right to bucket on floor(t/step), and a test that expected one bar was wrong).
        self.assertEqual(len(out), 2)
        first, second = out
        self.assertEqual((first["open"], first["close"]), (1.0, 1.3))
        self.assertEqual((first["high"], first["low"]), (1.4, 0.9))
        self.assertEqual(first["volume"], 3)
        self.assertEqual((second["open"], second["close"]), (1.3, 1.28))
        self.assertEqual(second["closeTime"] - second["openTime"], 30 * 60000)

    def test_fallback_to_yahoo_reports_its_source(self):
        doc = {"chart": {"result": [{"timestamp": [1000, 2000],
                                     "indicators": {"quote": [{"open": [1.1, 1.2], "high": [1.3, 1.4],
                                                               "low": [1.0, 1.1], "close": [1.25, 1.35],
                                                               "volume": [5, 6]}]}}]}}
        body = mock.Mock()
        body.read.return_value = __import__("json").dumps(doc).encode()
        body.__enter__ = lambda s: s
        body.__exit__ = lambda *a: False
        with mock.patch("urllib.request.urlopen", lambda *a, **k: body):
            rows = fxdata.yahoo_bars("GBPUSD", "30", 10)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["openTime"], 1000 * 1000)
        self.assertEqual(fxdata.LAST["source"], "yahoo")

    def test_symbol_info_precision_follows_the_pair(self):
        self.assertAlmostEqual(fxdata.symbol_info("GBPUSD")["mintick"], 0.00001)
        self.assertAlmostEqual(fxdata.symbol_info("USDJPY")["mintick"], 0.001)

    def test_junk_pairs_are_refused_with_a_sentence(self):
        for bad in ("", "GBP", "GBPUSDT", "12AB34"):
            with self.assertRaises(fxdata.FxError):
                fxdata._clean_pair(bad)


class TheDoors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.patches = [mock.patch.object(srv, "CONSOLE_TOKEN", TOKEN),
                       mock.patch.object(srv, "AGENTS_ROOT", cls.tmp.name)]
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
            return __import__("json").loads(res.read().decode())

    def test_status_names_the_cache_and_the_feed(self):
        out = self.get("/api/fx/status")
        data = out.get("data") or out
        self.assertIn("home", data)
        self.assertIn("GBPUSD", data["pairs_supported"])

    def test_bars_door_returns_the_rows_and_their_source(self):
        rows = [{"openTime": 0, "closeTime": 1800000, "open": 1.3, "high": 1.31, "low": 1.29,
                 "close": 1.305, "volume": 1.0}]
        def fake_bars(pair, tf, limit):
            fxdata.LAST.clear()
            fxdata.LAST.update({"pair": pair, "timeframe": tf, "count": len(rows), "source": "dukascopy"})
            return rows

        with mock.patch.object(fxdata, "bars", fake_bars):
            out = self.get("/api/fx/bars?pair=GBPUSD&timeframe=30&limit=10")
        data = out.get("data") or out
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["source"], "dukascopy")
        self.assertEqual(data["symbol"]["ticker"], "GBPUSD")

    def test_a_bad_pair_is_a_400(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/api/fx/bars?pair=NOPE&timeframe=30")
        self.assertEqual(ctx.exception.code, 400)
