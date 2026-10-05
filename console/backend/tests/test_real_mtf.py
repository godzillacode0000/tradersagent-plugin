"""Real multi-timeframe for Pine runs (5 Oct 2026).

PineTS builds a second engine for ``request.security`` on the *same data source it was given*. The worker
used to give it a bare array of chart bars, which has one timeframe — so ``request.security(…, "D", close)``
came back identical to the chart's own close and a multi-timeframe indicator silently drew the chart's own
levels. The worker now gives it a source object that serves the chart's own market from memory and every
other (symbol, timeframe) from the console's /api/bars.

Everything here runs the worker's real code in Node: unit tests with a fake ``fetch``, and an end-to-end
run through the vendored engine (skipped without Node).
"""
import json
import os
import re
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FRONT = os.path.join(ROOT, "console", "frontend")
NODE = shutil.which("node")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def top_level(src, name):
    """`function name(` at column 0 up to the first line that is exactly `}`."""
    m = re.search(r"^(?:async )?function %s\(" % re.escape(name), src, re.M)
    assert m, "function %s not found" % name
    end = re.search(r"^\}$", src[m.start():], re.M)
    assert end, "no closing brace for %s" % name
    return src[m.start():m.start() + end.end()]


def worker_pieces():
    src = read("console", "frontend", "pinets-worker.js")
    ms = re.search(r"^const MS = \{[^}]*\};", src, re.M).group(0)
    return ms + "\n" + "\n".join(top_level(src, n) for n in ("attachSymbolInfo", "venueInterval", "makeSource"))


def run_node(script, module=True):
    cmd = [NODE, "--input-type=module", "-e", script] if module else [NODE, "-e", script]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=90, check=False)
    assert out.returncode == 0, (out.stderr or out.stdout)[-900:]
    return json.loads(out.stdout.strip().splitlines()[-1])


@unittest.skipUnless(NODE, "node not installed")
class TheWorkersSource(unittest.TestCase):
    PRELUDE = "const self = { location: { origin: 'http://127.0.0.1:8787' } };\n" + "%s"

    def script(self, body):
        return (self.PRELUDE % worker_pieces()) + """
        const urls = [];
        const bars = Array.from({length: 100}, (_, i) => ({openTime: i * 3600000, closeTime: i * 3600000 + 3599999, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1}));
        attachSymbolInfo(bars, 'BTCUSDT', 0.01);
        const daily = (n) => ({ok: true, data: {bars: Array.from({length: n}, (_, i) => ({time: i * 86400000, open: 1, high: 3, low: 0.1, close: 2, volume: 9}))}});
        globalThis.fetch = async (url) => { urls.push(url); return {json: async () => globalThis.__reply(url)}; };
        """ + body

    def test_the_charts_own_market_is_answered_from_memory(self):
        res = run_node(self.script("""
        globalThis.__reply = () => { throw new Error('should not be called'); };
        const rep = {fetched: [], failed: []};
        const src = makeSource(bars, {symbol: 'BTCUSDT', timeframe: '1h'}, rep);
        const a = await src.getMarketData('BTCUSDT', '1h', 100);
        const b = await src.getMarketData('BINANCE:BTCUSDT', '60', 100);     // Pine's own spelling, with a prefix
        console.log(JSON.stringify({same: a === bars && b === bars, urls, rep}));"""))
        self.assertTrue(res["same"])
        self.assertEqual(res["urls"], [], "the chart's own timeframe must not hit the network")

    def test_another_timeframe_is_fetched_sized_to_the_range_and_shared(self):
        res = run_node(self.script("""
        globalThis.__reply = () => daily(54);
        const rep = {fetched: [], failed: []};
        const src = makeSource(bars, {symbol: 'BTCUSDT', timeframe: '1h'}, rep);
        const to = 50 * 86400000, from = 0;
        const a = await src.getMarketData('BTCUSDT', 'D', undefined, from, to);
        const b = await src.getMarketData('BTCUSDT', 'D', undefined, from, to);   // a second request.security, same timeframe
        console.log(JSON.stringify({urls, n: a.length, shared: a === b, first: a[0], rep}));"""))
        self.assertEqual(len(res["urls"]), 1, "two requests for the same series are one fetch")
        self.assertIn("symbol=BTCUSDT", res["urls"][0])
        self.assertIn("interval=1d", res["urls"][0])
        self.assertIn("limit=53", res["urls"][0], "ceil(span / bar) + 3 bars")
        self.assertTrue(res["shared"])
        self.assertEqual(res["first"], {"openTime": 0, "closeTime": 86399999, "open": 1, "high": 3, "low": 0.1,
                                        "close": 2, "volume": 9}, "the shape the engine reads")
        self.assertEqual(res["rep"]["fetched"][0]["interval"], "1d")
        self.assertEqual(res["rep"]["failed"], [])

    def test_another_symbol_is_fetched_by_its_own_name(self):
        res = run_node(self.script("""
        globalThis.__reply = () => daily(40);
        const rep = {fetched: [], failed: []};
        const src = makeSource(bars, {symbol: 'BTCUSDT', timeframe: '1h'}, rep);
        await src.getMarketData('BINANCE:ethusdt', '1h', 100, 0, 40 * 3600000);
        console.log(JSON.stringify({urls}));"""))
        self.assertIn("symbol=ETHUSDT", res["urls"][0], "same timeframe, different symbol is NOT the chart's market")

    def test_a_failed_fetch_falls_back_to_the_charts_bars_and_says_so(self):
        for reply in ("({ok: false, data: {bars: [], error: 'URLError: 403'}})", "({ok: true, data: {bars: []}})"):
            res = run_node(self.script("""
            globalThis.__reply = () => %s;
            const rep = {fetched: [], failed: []};
            const src = makeSource(bars, {symbol: 'BTCUSDT', timeframe: '1h'}, rep);
            const a = await src.getMarketData('BTCUSDT', 'W', undefined, 0, 60 * 86400000);
            const b = await src.getMarketData('BTCUSDT', 'W', undefined, 0, 60 * 86400000);
            console.log(JSON.stringify({fallback: a === bars && b === bars, failed: rep.failed, fetched: rep.fetched}));""" % reply))
            self.assertTrue(res["fallback"])
            self.assertEqual(len(res["failed"]), 1, "reported once, however many calls asked")
            self.assertEqual(res["failed"][0]["interval"], "1w")
            self.assertEqual(res["fetched"], [])

    def test_a_network_error_is_also_a_fallback_not_a_crash(self):
        res = run_node(self.script("""
        globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
        const rep = {fetched: [], failed: []};
        const src = makeSource(bars, {symbol: 'BTCUSDT', timeframe: '1h'}, rep);
        const a = await src.getMarketData('BTCUSDT', 'D', undefined, 0, 9 * 86400000);
        console.log(JSON.stringify({fallback: a === bars, reason: rep.failed[0].reason}));"""))
        self.assertTrue(res["fallback"])
        self.assertIn("Failed to fetch", res["reason"])

    def test_every_timeframe_spelling_the_engine_can_send(self):
        cases = {"1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", "1440": "1d", "D": "1d", "1D": "1d",
                 "W": "1w", "1W": "1w", "1h": "1h", "4h": "4h", "30m": "30m", "M": "1M", "1M": "1M", "90": "90m"}
        script = self.PRELUDE % worker_pieces() + "\nconst c = %s;\nconsole.log(JSON.stringify(Object.fromEntries(Object.keys(c).map(k => [k, venueInterval(k).interval]))));" % json.dumps(cases)
        self.assertEqual(run_node(script), cases)

    def test_the_two_spellings_tables_agree_with_app_js(self):
        """app.js reads the chart's cell; the worker reads Pine's strings. They must say the same thing."""
        src = read("console", "frontend", "app.js")
        fn = re.search(r"^function intervalOf\(tf\) \{.*?^\}", src, re.M | re.S).group(0)
        cases = ["1m", "15m", "1h", "4h", "1d", "1w", "60", "240", "1440", "D", "1D", "W", "1M"]
        script = (self.PRELUDE % worker_pieces()) + "\n" + fn + "\nconst c = %s;\nconsole.log(JSON.stringify(c.map(k => [intervalOf(k), venueInterval(k).interval])));" % json.dumps(cases)
        for a, b in run_node(script):
            self.assertEqual(a, b)


@unittest.skipUnless(NODE, "node not installed")
class ThroughTheRealEngine(unittest.TestCase):
    def test_a_daily_request_on_an_hourly_chart_returns_daily_bars(self):
        engine = "file://" + os.path.join(FRONT, "vendor", "pinets", "pinets.min.browser.es.js")
        script = ("const self = { location: { origin: 'http://x' } };\n" + worker_pieces() + """
        import('%s').then(async (mod) => {
          const HOUR = 3600e3, DAY = 24 * HOUR;
          const px = (t) => 60000 + 2000 * Math.sin(t / (3 * DAY)) + 150 * Math.sin(t / (5 * HOUR));
          const t0 = Math.floor(Date.now() / DAY) * DAY - 21 * DAY;
          const candle = (t, step) => { const xs = []; for (let u = t; u < t + step; u += step / 24) xs.push(px(u));
            return {openTime: t, closeTime: t + step - 1, open: xs[0], high: Math.max(...xs), low: Math.min(...xs), close: xs[xs.length - 1], volume: 1}; };
          const hourly = Array.from({length: 500}, (_, i) => candle(t0 + i * HOUR, HOUR));
          const dailyBars = Array.from({length: 40}, (_, i) => candle(t0 - 10 * DAY + i * DAY, DAY));
          attachSymbolInfo(hourly, 'BTCUSDT', 0.01);
          globalThis.fetch = async (url) => ({ json: async () => ({ ok: true, data: { bars: dailyBars.map(c => ({time: c.openTime, open: c.open, high: c.high, low: c.low, close: c.close, volume: 1})) } }) });
          const rep = { fetched: [], failed: [] };
          const eng = new mod.PineTS(makeSource(hourly, { symbol: 'BTCUSDT', timeframe: '1h' }, rep), 'BTCUSDT', '1h', 500);
          const out = await eng.run(`//@version=5
indicator("mtf")
dh = request.security(syminfo.tickerid, "D", high)
plot(high, "chart high")
plot(dh, "D high")`);
          const get = (k) => { const n = out.plots[k]; const a = Array.isArray(n) ? n : n.data; return a.map(x => typeof x === 'number' ? x : x && x.value).filter(v => v != null && isFinite(v)); };
          const ch = get('chart high'), dh = get('D high');
          const dailyHighs = new Set(dailyBars.map(c => Math.round(c.high * 100)));
          console.log(JSON.stringify({ chartDistinct: new Set(ch.map(v => Math.round(v * 100))).size, dDistinct: new Set(dh.map(v => Math.round(v * 100))).size,
            allAreDailyHighs: dh.every(v => dailyHighs.has(Math.round(v * 100))), equalsChart: JSON.stringify(dh) === JSON.stringify(ch), rep }));
        });
        """ % engine)
        # import() works in a CommonJS -e script too, but a module context is the honest one for the engine
        res = run_node(script, module=True)
        self.assertFalse(res["equalsChart"], "the 'daily' high must not be the chart's own high")
        self.assertLess(res["dDistinct"], res["chartDistinct"] / 5, "~22 daily values over 500 hourly bars")
        self.assertGreater(res["dDistinct"], 10)
        self.assertTrue(res["allAreDailyHighs"], "every value must be one of the daily bars' highs")
        self.assertEqual(len(res["rep"]["fetched"]), 1)
        self.assertEqual(res["rep"]["failed"], [])


class Wiring(unittest.TestCase):
    def test_the_worker_uses_the_source_and_reports_back(self):
        w = read("console", "frontend", "pinets-worker.js")
        self.assertIn("new mod.PineTS(makeSource(bars, msg, mtf), msg.symbol, msg.timeframe", w)
        self.assertRegex(w, r"payload = \{ ok: true, ms: ms, plots: plots, strategy: strategy, mtf: mtf,")
        r = read("console", "frontend", "pinets-runner.js")
        self.assertIn("mtf: d.mtf || null", r)
        self.assertIn("mtf: viaWorker.mtf || null", r)

    def test_the_warning_is_about_what_failed_when_the_worker_reports(self):
        u = read("console", "frontend", "unified.js")
        self.assertIn("const mtf = res.mtf || null;", u)
        self.assertIn("(mtf.failed || []).map(", u)
        self.assertIn("scriptNotes(pine,", u, "no worker report (main-thread fallback): the static call-out stands")
        self.assertIn("multi-timeframe: ", u, "what was fetched is shown, not just what went wrong")


if __name__ == "__main__":
    unittest.main()
