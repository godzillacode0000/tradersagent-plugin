"""Audit round 4, phase C (6 Oct 2026): the findings that were ours, fixed and held.

  * a study script that fails at its own defaults when the data has no signal yet (fvg-mitigation: a Pine `for`
    whose upper bound is below its start counts DOWN, so `for i = 0 to shown - 1` with shown == 0 still runs);
  * a run whose every line is empty reads as a normal "Ran · 0 series" — now it says why;
  * a timeframe input accepted "banana";
  * higher-timeframe rows used as given — newest-first rows made request.security return NaN everywhere.

Everything runs the real code under Node: the vendored engine, the worker's own functions, ScriptTools.
"""
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_history_and_mtf import function_source_for_tests  # noqa: E402  (helpers only)
from test_real_mtf import worker_pieces  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
FRONT = ROOT / "console" / "frontend"
ENGINE = FRONT / "vendor" / "pinets" / "pinets.min.browser.es.js"
NODE = shutil.which("node")


def node(script: str, module: bool = True):
    cmd = [NODE, "--input-type=module", "-"] if module else [NODE, "-"]
    done = subprocess.run(cmd, input=script, capture_output=True, text=True, timeout=120)
    if done.returncode != 0:
        raise AssertionError((done.stderr or done.stdout)[-1500:])
    return json.loads(done.stdout.strip().splitlines()[-1])


# ── the study scripts ──────────────────────────────────────────────────────────────────────────────────

ENGINE_PRELUDE = f"""
import {{ PineTS }} from {json.dumps(ENGINE.as_uri())};
const bars = (n, shape) => Array.from({{ length: n }}, (_, i) => {{
  const t = 1700000000000 + i * 3600000;
  const c = shape === 'flat' ? 100 : shape === 'trend' ? 50 + i * 0.5 : 100 + Math.sin(i / 9) * 10;
  const w = shape === 'flat' ? 0 : 1.5;
  return {{ openTime: t, closeTime: t + 3599999, open: c - w / 2, high: c + w, low: c - w, close: c, volume: 10 }};
}});
const run = async (src, shape) => {{
  try {{ await new PineTS(bars(300, shape), 'X', '60', 300).run(src); return 'ok'; }}
  catch (e) {{ return String((e && e.message) || e); }}
}};
"""


@unittest.skipUnless(NODE, "node is not installed")
class StudyScripts(unittest.TestCase):
    """The repo's own Pine studies must run on data that has not produced their first signal yet: a flat market,
    a smooth trend and a sine have no fair value gap, no sweep."""

    def test_every_study_runs_without_a_signal(self):
        studies = sorted((ROOT / "docs" / "studies" / "pine").glob("*.pine"))
        self.assertTrue(studies)
        got = {}
        for f in studies:
            got[f.name] = node(ENGINE_PRELUDE + f"""
              const src = {json.dumps(f.read_text())};
              console.log(JSON.stringify({{ flat: await run(src, 'flat'), trend: await run(src, 'trend'), sine: await run(src, 'sine') }}));""")
        for name, shapes in got.items():
            for shape, result in shapes.items():
                self.assertEqual(result, "ok", f"{name} on {shape} data: {result}")

    def test_the_guard_is_what_makes_fvg_mitigation_run(self):
        """The control: the same script without `and array.size(gaps) > 0` fails on flat data, with the very error
        the audit found. If the engine ever stops counting a downward `for`, this fails and the guard can go."""
        src = (ROOT / "docs" / "studies" / "pine" / "fvg-mitigation.pine").read_text()
        self.assertIn("if barstate.islast and array.size(gaps) > 0", src)
        unguarded = src.replace("if barstate.islast and array.size(gaps) > 0", "if barstate.islast")
        got = node(ENGINE_PRELUDE + f"console.log(JSON.stringify(await run({json.dumps(unguarded)}, 'flat')));")
        self.assertRegex(got, r"Index 0 is out of bounds, array size is 0")

    def test_the_script_no_longer_says_while_is_refused(self):
        src = (ROOT / "docs" / "studies" / "pine" / "fvg-mitigation.pine").read_text()
        self.assertNotIn("refuses `while` outright", src)


# ── a timeframe input ──────────────────────────────────────────────────────────────────────────────────

@unittest.skipUnless(NODE, "node is not installed")
class TimeframeInput(unittest.TestCase):
    def check(self, values):
        return node(f"""
          const S = require({json.dumps(str(FRONT / 'script-tools.js'))});
          const meta = {{ type: 'timeframe', defval: 'D', id: 'in_0', title: 'TF' }};
          process.stdout.write(JSON.stringify({json.dumps(values)}.map((v) => [v, S.coerce(meta, v).ok, S.resolveInputs([meta], {{ TF: v }}).ignored.map((i) => i.reason)])));
          """, module=False)

    def test_pines_spellings_are_accepted(self):
        for value, ok, _ in self.check(["", "15", "60", "240", "D", "1D", "W", "M", "3M", "4H", "30S", " 15 "]):
            self.assertTrue(ok, repr(value))

    def test_anything_else_is_refused_with_a_sentence_the_agent_can_act_on(self):
        for value, ok, why in self.check(["banana", "1x", "D1", "-5", "1.5", "one day"]):
            self.assertFalse(ok, repr(value))
            self.assertEqual(len(why), 1)
            self.assertIn("must be a timeframe like 15, 60, 240, D, W or M", why[0])


# ── higher-timeframe rows ──────────────────────────────────────────────────────────────────────────────

@unittest.skipUnless(NODE, "node is not installed")
class HigherTimeframeRows(unittest.TestCase):
    PRELUDE = "const self = { location: { origin: 'http://127.0.0.1:8787' } };\n"

    def run_js(self, body):
        return node(self.PRELUDE + worker_pieces() + "\n" + body, module=False)

    def test_rows_come_back_oldest_first_one_per_time(self):
        got = self.run_js("""
          const row = (t, c) => ({ openTime: t, closeTime: t + 9, open: c, high: c, low: c, close: c, volume: 1 });
          const asc = [row(1, 1), row(2, 2), row(3, 3)];
          const rev = [row(3, 3), row(2, 2), row(1, 1)];
          const dup = [row(1, 1), row(2, 2), row(2, 22), row(3, 3)];
          const bad = [row(2, 2), row(NaN, 9), row(1, 1)];
          process.stdout.write(JSON.stringify({
            sameArray: tidyRows(asc) === asc,
            reversed: tidyRows(rev).map((r) => r.openTime),
            dupes: tidyRows(dup).map((r) => [r.openTime, r.close]),
            dropsNaN: tidyRows(bad).map((r) => r.openTime),
            empty: tidyRows([]).length }));""")
        self.assertTrue(got["sameArray"], "rows already in order are handed back untouched (a single pass)")
        self.assertEqual(got["reversed"], [1, 2, 3])
        self.assertEqual(got["dupes"], [[1, 1], [2, 22], [3, 3]], "a repeated bar time keeps the later row")
        self.assertEqual(got["dropsNaN"], [1, 2])
        self.assertEqual(got["empty"], 0)

    def test_the_source_serves_newest_first_rows_in_order(self):
        got = self.run_js("""
          const bars = Array.from({ length: 10 }, (_, i) => ({ openTime: i * 3600000, closeTime: i * 3600000 + 3599999, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));
          attachSymbolInfo(bars, 'BTCUSDT', 0.01);
          const days = Array.from({ length: 6 }, (_, i) => ({ time: i * 86400000, open: 1, high: 3, low: 0.1, close: 2 + i, volume: 9 })).reverse();
          globalThis.fetch = async () => ({ json: async () => ({ ok: true, data: { bars: days } }) });
          (async () => {
            const src = makeSource(bars, { symbol: 'BTCUSDT', timeframe: '1h' }, { fetched: [], failed: [] });
            const rows = await src.getMarketData('BTCUSDT', 'D', 100);
            process.stdout.write(JSON.stringify(rows.map((r) => r.openTime / 86400000)));
          })();""")
        self.assertEqual(got, [0, 1, 2, 3, 4, 5])

    def test_the_worker_wiring(self):
        src = (FRONT / "pinets-worker.js").read_text()
        self.assertIn("return tidyRows(rows.map(", src)


# ── an all-empty run ───────────────────────────────────────────────────────────────────────────────────

@unittest.skipUnless(NODE, "node is not installed")
class EmptyRun(unittest.TestCase):
    SRC = (FRONT / "unified.js").read_text()

    def empties(self, cases):
        fn = function_source_for_tests(self.SRC, "emptyPlots")
        return node(fn + f"\nconsole.log(JSON.stringify({json.dumps(cases)}.map((raw) => emptyPlots(raw))));", module=False)

    def test_which_lines_are_empty(self):
        pt = lambda v: {"value": v, "options": {}, "time": 1}
        cases = [
            {"plots": {"s": [pt(None), pt(None)]}},                                  # worker shape: NaN became null
            {"plots": {"s": {"data": [pt(None)]}}},   # engine shape: { data: [...] }
            {"plots": {"s": [pt(1.5), pt(None)], "t": [pt(None)]}},                  # one has a value, one has none
            {"plots": {"s": [pt(True), pt(False)]}},                                 # booleans (plotshape) are values
            {"plots": {"s": [pt(0)]}},                                               # zero is a value
            {"plots": {"__labels__": [pt(None)], "s": [pt(2)]}},                     # drawing containers are not lines
            {"plots": {"s": []}},                                                    # no rows at all: not "empty"
            {"plots": {"f": [{"value": {"a": 1}}]}},                                 # a fill's object payload is a value
            {"plots": {"n": [None, None], "m": [3, None]}},                          # bare numbers / nulls
            {}, None,
        ]
        self.assertEqual(self.empties(cases), [["s"], ["s"], ["t"], [], [], [], [], [], ["n"], [], []])

    def test_it_speaks_only_when_nothing_else_is_on_the_chart(self):
        i = self.SRC.index("const empties = emptyPlots(res.raw);")
        block = self.SRC[i:i + 900]
        self.assertIn("!containers && !hasPaths && !(res.series && res.series.length) && empties.length", block)
        self.assertIn("nothing was plotted", block)
        self.assertIn("warnings.push(", block)


if __name__ == "__main__":
    unittest.main()
