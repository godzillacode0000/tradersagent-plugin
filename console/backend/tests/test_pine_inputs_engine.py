"""The vendored PineTS engine's input contract, run for real under Node.

The Settings panel stands on three things the engine must keep doing; a vendor upgrade that changes any of
them should fail here, not in an operator's pane:

  * `new Indicator(source).getInputsMeta()` lists every input.*() with a stable shape, without running it;
  * `new Indicator(source, { in_N: value })` changes the result — by id, for numbers, booleans and choices;
  * an error's message carries `at LINE:COL` for a syntax error (the pane marks that line).
"""

import json
import shutil
import subprocess
import textwrap
import unittest
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[3] / "console" / "frontend" / "vendor" / "pinets" / "pinets.min.browser.es.js"
NODE = shutil.which("node")

PRELUDE = textwrap.dedent("""
    import { PineTS, Indicator } from %s;
    const bars = Array.from({ length: 200 }, (_, i) => { const t = 1700000000000 + i * 3600000; const c = 100 + Math.sin(i / 9) * 10;
      return { openTime: t, closeTime: t + 3599999, open: c - 1, high: c + 2, low: c - 2, close: c, volume: 10 }; });
    const SRC = `//@version=6
    indicator("Demo", overlay=true)
    len = input.int(14, "Length", minval=2, group="Basis")
    mult = input.float(2.0, "Mult", step=0.1, group="Bands")
    show = input.bool(true, "Show bands")
    src = input.source(close, "Source")
    kind = input.string("SMA", "MA type", options=["SMA", "EMA"])
    col = input.color(color.blue, "Colour")
    b = kind == "SMA" ? ta.sma(src, len) : ta.ema(src, len)
    plot(b, "basis", color=col)
    if show
        plot(b + mult * ta.stdev(src, len), "upper")
    `;
    const run = async (inputs) => {
      const target = inputs ? new Indicator(SRC, inputs) : SRC;
      const out = await new PineTS(bars, 'X', '60', 200).run(target);
      const last = (k) => { const d = out.plots[k] && out.plots[k].data; const v = d && d[d.length - 1]; return v && typeof v === 'object' ? v.value : v; };
      return { basis: last('basis'), upper: last('upper'), names: Object.keys(out.plots).filter((k) => !k.startsWith('__')) };
    };
""" % json.dumps(ENGINE.as_uri()))


def node(body: str):
    done = subprocess.run([NODE, "--input-type=module", "-e", PRELUDE + body], capture_output=True, text=True, timeout=120)
    if done.returncode != 0:
        raise AssertionError(done.stderr[-1500:])
    return json.loads(done.stdout)


@unittest.skipUnless(NODE, "node is not installed")
class InputContract(unittest.TestCase):
    def test_every_declaration_is_listed_with_the_fields_the_panel_reads(self):
        meta = node("process.stdout.write(JSON.stringify(new Indicator(SRC).getInputsMeta()));")
        self.assertEqual([m["varId"] for m in meta], ["len", "mult", "show", "src", "kind", "col"])
        self.assertEqual([m["type"] for m in meta], ["int", "float", "bool", "source", "string", "color"])
        self.assertEqual([m["id"] for m in meta], [f"in_{i}" for i in range(6)])
        self.assertEqual(meta[0]["group"], "Basis")
        self.assertEqual(meta[0]["minval"], 2)
        self.assertEqual(meta[4]["options"], ["SMA", "EMA"])
        self.assertIn("close", meta[3]["options"])
        self.assertRegex(meta[5]["defval"], r"^#[0-9A-F]{6}([0-9A-F]{2})?$")

    def test_scanning_does_not_run_the_script(self):
        """A script that would throw at run time still lists its inputs."""
        body = """
        const meta = new Indicator('//@version=6\\nindicator("x")\\nl = input.int(5, "L")\\nplot(nope_undefined)').getInputsMeta();
        process.stdout.write(JSON.stringify(meta.map((m) => m.title)));"""
        self.assertEqual(node(body), ["L"])

    def test_a_changed_number_changes_the_result(self):
        r = node("process.stdout.write(JSON.stringify({ a: await run(), b: await run({ in_0: 3 }) }));")
        self.assertNotAlmostEqual(r["a"]["basis"], r["b"]["basis"], places=3)

    def test_a_switched_off_boolean_removes_the_plot_it_guards(self):
        r = node("process.stdout.write(JSON.stringify({ a: await run(), b: await run({ in_2: false }) }));")
        self.assertIn("upper", r["a"]["names"])
        self.assertNotIn("upper", r["b"]["names"])

    def test_a_choice_and_a_source_are_honoured(self):
        r = node("process.stdout.write(JSON.stringify({ a: await run(), ema: await run({ in_4: 'EMA' }), high: await run({ in_3: 'high' }) }));")
        self.assertNotAlmostEqual(r["a"]["basis"], r["ema"]["basis"], places=3)
        self.assertGreater(r["high"]["basis"], r["a"]["basis"])

    def test_a_colour_override_is_accepted(self):
        r = node("process.stdout.write(JSON.stringify(await run({ in_5: '#FF8800FF' })));")
        self.assertIn("basis", r["names"])

    def test_an_empty_override_is_the_same_as_none(self):
        r = node("process.stdout.write(JSON.stringify({ a: await run(), b: await run({}) }));")
        self.assertEqual(r["a"], r["b"])

    def test_a_syntax_error_carries_its_line_and_column(self):
        body = """
        try { await new PineTS(bars, 'X', '60', 200).run('//@version=6\\nindicator("x")\\nb = 5 @@ 3\\nplot(b)\\n'); process.stdout.write('"ran"'); }
        catch (e) { process.stdout.write(JSON.stringify(String(e.message))); }"""
        self.assertRegex(node(body), r"Unexpected character '@' at 3:\d+")

    def test_a_runtime_error_names_the_pine_method(self):
        body = """
        try { await new PineTS(bars, 'X', '60', 200).run('//@version=6\\nindicator("x")\\nvar a = array.new_float(0)\\nx = array.get(a, 5)\\nplot(x)\\n'); process.stdout.write('{}'); }
        catch (e) { process.stdout.write(JSON.stringify({ method: e.method || null })); }"""
        self.assertEqual(node(body), {"method": "array.get"})


if __name__ == "__main__":
    unittest.main()
