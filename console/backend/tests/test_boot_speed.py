"""Chart loading and background traffic (6 Oct 2026), measured and then held.

What was found, with one tab open and the exchange mocked (localhost, headless Chromium):

  * the ES-module graph (workspace.js -> Vela, vela-pinets, PineTS, ~140 Zag files) is discovered one import level at
    a time: 17 sequential waves, about 1.3 s of a 1.8 s boot -> a generated `<link rel="modulepreload">` block;
  * the first chart data waits for TLS to the exchange, which only started once the chart did -> `preconnect`;
  * the 4-second heartbeat read the chart's bars TWICE, and when the chart hands none over each read was a live
    round trip to the venue (16 in 30 idle seconds) -> one read, shared between callers, and cached on the server.

The one trap, found by measuring (a first version "improved" boot by quietly breaking it): a module fetch that
starts before the import map is parsed FREEZES the map, every bare specifier ("pinets") then fails to resolve, and
the workspace falls back to the bare chart. The preload block must come after the import map.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FRONT = os.path.join(ROOT, "console", "frontend")
NODE = shutil.which("node")

import server as srv  # noqa: E402


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


INDEX = read("console", "frontend", "index.html")
APP = read("console", "frontend", "app.js")
BRIDGE = read("console", "frontend", "chart-bridge.js")


class ModulePreload(unittest.TestCase):
    def test_the_block_is_exactly_what_the_generator_derives(self):
        done = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "modulepreload.py"), "--check"],
                              capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr or "tools/modulepreload.py --write")

    def test_the_block_comes_after_the_import_map(self):
        """Before it, the browser freezes an empty map and the workspace silently falls back to the bare chart."""
        importmap = INDEX.index('<script type="importmap">')
        first_preload = INDEX.index('rel="modulepreload"')
        first_module = INDEX.index('type="module"', importmap)
        self.assertLess(importmap, first_preload)
        self.assertLess(first_preload, first_module)
        self.assertEqual(INDEX.count("<!-- modulepreload:start"), 1)
        self.assertNotIn('rel="modulepreload"', INDEX[:importmap], "no module fetch may start before the import map")

    def test_every_listed_file_exists_and_the_whole_graph_is_listed(self):
        links = re.findall(r'<link rel="modulepreload" href="\./([^"]+)">', INDEX)
        self.assertGreater(len(links), 100)
        for href in links:
            self.assertTrue(os.path.isfile(os.path.join(FRONT, href)), href)
        self.assertEqual(len(links), len(set(links)), "no file twice")
        for needed in ("vendor/vela/dist/workspace.js", "vendor/vela-pinets/dist/index.js", "vendor/pinets/pinets.min.browser.es.js"):
            self.assertIn(needed, links)
        # the generator must not mistake vela's own workspace.js for the page's entry file of the same name
        self.assertIn("vendor/vela/dist/workspace.js", links)

    def test_the_connections_the_first_data_needs_are_warmed(self):
        for host, cors in (("https://api.binance.com", True), ("https://fapi.binance.com", True), ("https://crypto-icons.ledger.com", False)):
            tag = f'<link rel="preconnect" href="{host}"' + (" crossorigin>" if cors else ">")
            self.assertIn(tag, INDEX)
        self.assertLess(INDEX.index('rel="preconnect"'), INDEX.index('type="importmap"'))


class OneReadPerHeartbeat(unittest.TestCase):
    def test_the_heartbeat_reads_the_bars_once(self):
        body = BRIDGE.split("async function heartbeat() {", 1)[1].split("await api('/api/chart/state'", 1)[0]
        self.assertEqual(body.count("window.chartBars()"), 1, "it used to read them twice per beat")
        self.assertIn("const last = barsList.length ? barsList[barsList.length - 1].close : null;", body)


@unittest.skipUnless(NODE, "node is not installed")
class SharedBars(unittest.TestCase):
    def helper(self):
        m = re.search(r"const BARS_SHARE_MS = \d+;\nconst sharedBars = new Map\(\);\nfunction consoleBars\(.*?\n\}\n", APP, re.S)
        self.assertTrue(m, "consoleBars not found in app.js")
        return m.group(0)

    def run_js(self, body):
        script = "let NOW = 1000000;\nDate.now = () => NOW;\n" + self.helper() + "\n" + body
        done = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=30)
        if done.returncode != 0:
            raise AssertionError(done.stderr[-1200:])
        return json.loads(done.stdout.strip().splitlines()[-1])

    FAKE = """
      let calls = 0, mode = 'ok';
      const row = (t) => ({ time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3, extra: 'x' });
      globalThis.fetch = async () => { calls++; if (mode === 'throw') throw new TypeError('down');
        return { json: async () => (mode === 'empty' ? { ok: true, data: { bars: [] } } : { ok: true, data: { bars: [row(1), row(2)] } }) }; };
    """

    def test_asks_in_the_same_moment_and_within_three_seconds_share_one_fetch(self):
        got = self.run_js(self.FAKE + """
          (async () => {
            const [a, b] = await Promise.all([consoleBars('BTCUSDT', '1h', 500), consoleBars('BTCUSDT', '1h', 500)]);   // in flight together
            NOW += 2900; const c = await consoleBars('BTCUSDT', '1h', 500);                                          // just inside
            NOW += 200; const d = await consoleBars('BTCUSDT', '1h', 500);                                           // just outside
            console.log(JSON.stringify({ calls, sizes: [a, b, c, d].map((x) => x.length), keys: Object.keys(a[0]) }));
          })();""")
        self.assertEqual(got["calls"], 2, "the first three asks are one fetch; the fourth is a new one")
        self.assertEqual(got["sizes"], [2, 2, 2, 2])
        self.assertEqual(got["keys"], ["time", "open", "high", "low", "close", "volume"], "only the bar fields come through")

    def test_another_market_or_size_is_another_fetch(self):
        got = self.run_js(self.FAKE + """
          (async () => { await consoleBars('BTCUSDT', '1h', 500); await consoleBars('ETHUSDT', '1h', 500); await consoleBars('BTCUSDT', '4h', 500); await consoleBars('BTCUSDT', '1h', 2000);
            console.log(JSON.stringify({ calls })); })();""")
        self.assertEqual(got["calls"], 4)

    def test_every_caller_gets_its_own_array(self):
        got = self.run_js(self.FAKE + """
          (async () => { const a = await consoleBars('BTCUSDT', '1h', 500); a.pop(); a.length = 0; const b = await consoleBars('BTCUSDT', '1h', 500);
            console.log(JSON.stringify({ calls, b: b.length })); })();""")
        self.assertEqual(got, {"calls": 1, "b": 2})

    def test_an_empty_or_failed_answer_is_never_kept(self):
        got = self.run_js(self.FAKE + """
          (async () => {
            mode = 'empty'; const a = await consoleBars('BTCUSDT', '1h', 500);
            mode = 'ok'; const b = await consoleBars('BTCUSDT', '1h', 500);            // not served the empty one
            mode = 'throw'; let threw = false; try { await consoleBars('SOLUSDT', '1h', 500); } catch (e) { threw = true; }
            mode = 'ok'; const c = await consoleBars('SOLUSDT', '1h', 500);            // not served the failure
            console.log(JSON.stringify({ calls, a: a.length, b: b.length, threw, c: c.length }));
          })();""")
        self.assertEqual(got, {"calls": 4, "a": 0, "b": 2, "threw": True, "c": 2})

    def test_chartbars_uses_it(self):
        self.assertIn("const rows = await consoleBars(symbol, interval, want);", APP)
        self.assertIn("fetch(`/api/bars?", APP, "the same-origin fetch is still the one path to the venue")


class ServerBarsMemo(unittest.TestCase):
    def setUp(self):
        self._orig = srv._fetch_klines
        srv._BARS_MEMO.clear()
        self.calls = []

    def tearDown(self):
        srv._fetch_klines = self._orig
        srv._BARS_MEMO.clear()

    @staticmethod
    def kline(t):
        return [t, "1", "2", "0.5", "1.5", "3", 0, "0", 0, "0", "0", "0"]

    def fake(self, fail=False):
        def f(symbol, interval, limit, end_time=None):
            self.calls.append((symbol, interval, limit))
            if fail:
                raise OSError("upstream down")
            return [self.kline(1), self.kline(2)]
        srv._fetch_klines = f

    def test_the_same_ask_within_the_window_is_one_upstream_call(self):
        self.fake()
        a = srv.fetch_bars("BTCUSDT", "1h", 500)
        b = srv.fetch_bars("BTCUSDT", "1h", 500)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(a, b)
        self.assertEqual(a["count"], 2)
        a["bars"].clear()                                   # a caller changing its answer cannot change the next one
        self.assertEqual(srv.fetch_bars("BTCUSDT", "1h", 500)["count"], 2)

    def test_a_different_market_interval_or_size_is_its_own_call(self):
        self.fake()
        for args in (("BTCUSDT", "1h", 500), ("ETHUSDT", "1h", 500), ("BTCUSDT", "4h", 500), ("BTCUSDT", "1h", 1000)):
            srv.fetch_bars(*args)
        self.assertEqual(len(self.calls), 4)

    def test_the_answer_expires(self):
        self.fake()
        srv.fetch_bars("BTCUSDT", "1h", 500)
        key = ("BTCUSDT", "1h", 500)
        stamp, payload = srv._BARS_MEMO[key]
        srv._BARS_MEMO[key] = (stamp - srv.BARS_TTL_S - 0.1, payload)
        srv.fetch_bars("BTCUSDT", "1h", 500)
        self.assertEqual(len(self.calls), 2)

    def test_a_failed_or_partial_answer_is_never_served_twice(self):
        self.fake(fail=True)
        first = srv.fetch_bars("BTCUSDT", "1h", 500)
        self.assertIn("error", first)
        srv.fetch_bars("BTCUSDT", "1h", 500)
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(srv._BARS_MEMO, {})

    def test_a_partial_answer_is_not_kept_either(self):
        """Bars gathered, then a page failed: `partial: true` with an error. Serving that again would hide that the
        rest was never fetched; the next ask tries again."""
        def f(symbol, interval, limit, end_time=None):
            self.calls.append(end_time)
            if end_time is not None:
                raise OSError("second page down")
            return [self.kline(1000 + i) for i in range(1000)]
        srv._fetch_klines = f
        first = srv.fetch_bars("BTCUSDT", "1h", 1500)
        self.assertTrue(first.get("partial"))
        self.assertEqual(srv._BARS_MEMO, {})
        srv.fetch_bars("BTCUSDT", "1h", 1500)
        self.assertEqual(len(self.calls), 4, "two pages asked for, twice")

    def test_the_memo_stays_small(self):
        self.fake()
        for i in range(200):
            srv.fetch_bars(f"S{i}USDT", "1h", 500)
        self.assertLessEqual(len(srv._BARS_MEMO), 70)

    def test_the_window_is_short(self):
        self.assertLessEqual(srv.BARS_TTL_S, 2.0)


if __name__ == "__main__":
    unittest.main()
