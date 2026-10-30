"""Bars built from the local tick store (console/backend/fxticks.py).

The arithmetic here is the kind that fails silently: an off-by-60 in the minute bucketing still returns
"bars", just at the wrong times; a summed spread instead of a median lets one bad print widen a whole
bar. So these tests build a two-hour store with hand-computed ticks and assert the exact OHLC, volume
and spread of the resampled bars.
"""

import datetime as dt
import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import fxticks  # noqa: E402


def write_hour(root: Path, symbol: str, when: dt.datetime, ticks: list[tuple[int, float, float]]):
    """`ticks` are (ms_into_hour, bid, ask) — encoded the way the feed does: as cumulative deltas."""
    base_ms = int(when.replace(minute=0, second=0, microsecond=0).timestamp() * 1000)
    mult = 1e-5
    times, bids, asks = [], [], []
    prev_t = prev_b = prev_a = 0
    for ms, bid, ask in ticks:
        times.append(ms - prev_t)
        bids.append(round((bid - ticks[0][1]) / mult) - prev_b)
        asks.append(round((ask - ticks[0][2]) / mult) - prev_a)
        prev_t, prev_b, prev_a = ms, round((bid - ticks[0][1]) / mult), round((ask - ticks[0][2]) / mult)
    doc = {"timestamp": base_ms, "multiplier": mult,
           "bid": ticks[0][1], "ask": ticks[0][2],
           "times": times, "bids": bids, "asks": asks,
           "bidVolumes": [1.0] * len(ticks), "askVolumes": [1.0] * len(ticks)}
    d = root / symbol / when.strftime("%Y-%m-%d")
    d.mkdir(parents=True, exist_ok=True)
    with gzip.open(d / f"{when.hour:02d}.json.gz", "wb") as fh:
        fh.write(json.dumps(doc).encode())


class BarsFromTicks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self._old_ticks = fxticks.TICKS
        fxticks.TICKS = self.root
        fxticks._hour.cache_clear()
        self.addCleanup(setattr, fxticks, "TICKS", self._old_ticks)
        self.addCleanup(fxticks._hour.cache_clear)

        day = dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc)
        # 10:00 hour: three ticks at 00:10, 00:20, 00:50 with a 2-pip spread
        write_hour(self.root, "GBPUSD", day.replace(hour=10),
                   [(10_000, 1.30000, 1.30020), (20_000, 1.30010, 1.30030), (50_000, 1.29990, 1.30010)])
        # 11:00 hour: two ticks; a 30-minute window must not bleed into this hour
        write_hour(self.root, "GBPUSD", day.replace(hour=11),
                   [(1_000, 1.30100, 1.30120), (2_000, 1.30150, 1.30170)])

    def bars(self, tf="30", limit=100, end=None):
        return fxticks.bars("GBPUSD", tf, limit, end or dt.datetime(2026, 10, 20, 11, 30, tzinfo=dt.timezone.utc))

    def test_the_bar_is_mid_price_ohlc(self):
        rows, meta = self.bars()
        self.assertEqual(meta["source"], "dukascopy-ticks")
        first = rows[0]
        self.assertEqual(first["openTime"],
                         int(dt.datetime(2026, 10, 20, 10, 0, tzinfo=dt.timezone.utc).timestamp() * 1000))
        self.assertAlmostEqual(first["open"], 1.30010, places=6)      # (1.30000+1.30020)/2
        self.assertAlmostEqual(first["high"], 1.30020, places=6)      # (1.30010+1.30030)/2
        self.assertAlmostEqual(first["low"], 1.30000, places=6)       # (1.29990+1.30010)/2
        self.assertAlmostEqual(first["close"], 1.30000, places=6)

    def test_volume_is_the_tick_count(self):
        rows, _ = self.bars()
        self.assertEqual(rows[0]["volume"], 3)

    def test_spread_is_the_median_not_the_sum(self):
        rows, _ = self.bars()
        # every tick here has a 2-pip spread: 0.00020, no matter how many ticks
        self.assertAlmostEqual(rows[0]["spread"], 0.00020, places=8)

    def test_hours_do_not_bleed_into_each_other(self):
        rows, _ = self.bars()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]["volume"], 2)
        self.assertAlmostEqual(rows[1]["open"], 1.30110, places=6)

    def test_a_symbol_with_no_store_raises_rather_than_substituting(self):
        with self.assertRaises(fxticks.TickError):
            fxticks.bars("EURUSD", "30", 10)

    def test_has_and_coverage_read_the_store(self):
        self.assertTrue(fxticks.has("GBPUSD"))
        self.assertFalse(fxticks.has("EURUSD"))
        cov = fxticks.coverage("GBPUSD")
        assert cov is not None
        self.assertEqual(cov["hours"], 2)
        self.assertEqual(cov["from"], "2026-10-20")

    def test_status_counts_hours(self):
        st = fxticks.status()
        self.assertEqual(st["symbols"]["GBPUSD"]["hours"], 2)


class FxDataPrefersTheStore(unittest.TestCase):
    """fxdata must answer from the store, and must not touch the network to do it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        day = dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc)
        for hour in range(0, 12):                       # 24 half-hour bars, enough for limit=10
            write_hour(self.root, "GBPUSD", day.replace(hour=hour),
                       [(1_000, 1.30000, 1.30020), (2_000, 1.30010, 1.30030)])
        self._old = fxticks.TICKS
        fxticks.TICKS = self.root
        fxticks._hour.cache_clear()
        self.addCleanup(setattr, fxticks, "TICKS", self._old)
        self.addCleanup(fxticks._hour.cache_clear)

    def test_fxdata_returns_ticks_before_touching_the_network(self):
        import fxdata
        saved_latest, saved_download = fxdata.latest_available, fxdata._download
        fxdata.latest_available = lambda *a, **k: self.fail("network used: latest_available")
        fxdata._download = lambda *a, **k: self.fail("network used: _download")
        self.addCleanup(lambda: setattr(fxdata, "latest_available", saved_latest))
        self.addCleanup(lambda: setattr(fxdata, "_download", saved_download))
        rows, meta = fxdata._bars("GBPUSD", "30", 10)
        self.assertEqual(meta["source"], "dukascopy-ticks")
        self.assertTrue(rows)


def _weekday_store(root: Path, symbol: str, last_day: dt.datetime, weekdays: int) -> int:
    """`weekdays` trading days ending on `last_day`, two ticks an hour; returns the hour-files written."""
    n, day = 0, last_day
    while n < weekdays * 24:
        if day.weekday() < 5:
            for hour in range(24):
                write_hour(root, symbol, day.replace(hour=hour),
                           [(1_000, 1.30000, 1.30020), (2_000, 1.30010, 1.30030)])
                n += 1
        day -= dt.timedelta(days=1)
    return n


class LongWindows(unittest.TestCase):
    """A 4h or daily request covers months of calendar time. The window has to be sized from the
    timeframe once — not grown a day at a time, which re-read every hour on every pass, gave up after
    60 passes and returned fewer bars than asked for without saying so (500 x 4h came back as ~400)."""

    WEEKDAYS = 230
    END = dt.datetime(2026, 10, 24, tzinfo=dt.timezone.utc)          # a Saturday: Friday is the last day

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.files = _weekday_store(cls.root, "GBPUSD", dt.datetime(2026, 10, 23, tzinfo=dt.timezone.utc),
                                   cls.WEEKDAYS)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self._old = fxticks.TICKS
        fxticks.TICKS = self.root
        fxticks._hour.cache_clear()
        self.addCleanup(setattr, fxticks, "TICKS", self._old)
        self.addCleanup(fxticks._hour.cache_clear)
        self.passes = 0
        real = fxticks._minute_bars

        def counted(*a, **k):
            self.passes += 1
            return real(*a, **k)

        fxticks._minute_bars = counted
        self.addCleanup(setattr, fxticks, "_minute_bars", real)

    def test_500_four_hour_bars_are_500(self):
        rows, meta = fxticks.bars("GBPUSD", "240", 500, self.END)
        self.assertEqual(len(rows), 500)
        self.assertEqual(meta["count"], 500)

    def test_150_daily_bars_are_150(self):
        rows, _ = fxticks.bars("GBPUSD", "D", 150, self.END)
        self.assertEqual(len(rows), 150)

    def test_the_hours_are_read_in_at_most_two_passes(self):
        fxticks.bars("GBPUSD", "240", 500, self.END)
        self.assertLessEqual(self.passes, 2)

    def test_asking_past_the_store_returns_the_store_and_stops_at_its_first_day(self):
        rows, meta = fxticks.bars("GBPUSD", "D", 1000, self.END)
        self.assertEqual(len(rows), self.WEEKDAYS)          # every day there is, not a guess
        self.assertEqual(meta["count"], self.WEEKDAYS)
        self.assertLessEqual(self.passes, 2)                # and no walking into years with no files


class TheHourCache(unittest.TestCase):
    """The decoded-hour cache is what makes a second request cheap; it must not hold raw ticks. A busy
    hour is thousands of ticks — at thousands of cached hours that was gigabytes of tuples."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self._old = fxticks.TICKS
        fxticks.TICKS = self.root
        fxticks._hour.cache_clear()
        self.addCleanup(setattr, fxticks, "TICKS", self._old)
        self.addCleanup(fxticks._hour.cache_clear)

    def test_an_hour_is_cached_as_at_most_sixty_minute_bars(self):
        when = dt.datetime(2026, 10, 20, 10, tzinfo=dt.timezone.utc)
        write_hour(self.root, "GBPUSD", when,
                   [(i * 100, 1.30000 + (i % 7) * 1e-5, 1.30020 + (i % 7) * 1e-5) for i in range(3000)])
        cached = fxticks.hour_minutes("GBPUSD", when)
        self.assertLessEqual(len(cached), 60)
        self.assertEqual(sum(m[5] for m in cached), 3000)    # every tick still counted in volume

    def test_a_truncated_hour_is_skipped_not_fatal(self):
        # tools/fx-fetch.py interrupted mid-write used to leave a half gzip that broke every window
        # containing it — the provider then fell through to the network for the whole request
        day = dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc)
        write_hour(self.root, "GBPUSD", day.replace(hour=10), [(1_000, 1.30000, 1.30020)])
        write_hour(self.root, "GBPUSD", day.replace(hour=11), [(1_000, 1.30100, 1.30120)])
        bad = self.root / "GBPUSD" / "2026-10-20" / "11.json.gz"
        bad.write_bytes(bad.read_bytes()[:12])
        rows, meta = fxticks.bars("GBPUSD", "60", 10, day.replace(hour=12))
        self.assertEqual(len(rows), 1)
        self.assertEqual(meta["unreadable_hours"], 1)
