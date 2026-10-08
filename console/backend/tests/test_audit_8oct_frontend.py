"""The 8 Oct 2026 audit, frontend half: the findings that are ours, held under Node where the logic can be lifted out.

(The layout and keyboard fixes - the top-bar focus ring, the ⋯ button at 1024 px, the status line at 200% zoom, focus
restore, inert background - were verified in a real Chromium; their rules are pinned here as the cheapest guard that
survives, and the audit's own point stands that a string pin is weaker than a browser test.)
"""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FRONT = ROOT / "console" / "frontend"
NODE = shutil.which("node")


def read(name):
    return (FRONT / name).read_text(encoding="utf-8")


def node(script):
    done = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    if done.returncode != 0:
        raise AssertionError((done.stderr or done.stdout)[-1500:])
    return json.loads(done.stdout.strip().splitlines()[-1])


@unittest.skipUnless(NODE, "node is not installed")
class ScriptTools(unittest.TestCase):
    def test_two_untitled_inline_inputs_get_different_keys_and_named_ones_keep_theirs(self):
        got = node(f"""
          const S = require({json.dumps(str(FRONT / 'script-tools.js'))});
          console.log(JSON.stringify({{
            a: S.inputKey({{ type: 'int', id: 'in_0' }}), b: S.inputKey({{ type: 'int', id: 'in_1' }}),
            named: S.inputKey({{ varId: 'len', title: 'Length', type: 'int', id: 'in_7' }}),
            titled: S.inputKey({{ title: 'Length', type: 'int', id: 'in_7' }}) }}));""")
        self.assertNotEqual(got["a"], got["b"])
        self.assertEqual(got["named"], "len|Length|int", "stored values for named inputs must keep matching")
        self.assertEqual(got["titled"], "|Length|int")

    def test_a_double_slash_inside_the_title_is_not_a_comment(self):
        got = node(f"""
          const S = require({json.dumps(str(FRONT / 'script-tools.js'))});
          console.log(JSON.stringify([
            S.declaredName('indicator("A // B", overlay=true)'), S.declaredName('indicator("Plain") // trailing'),
            S.declaredName('// indicator("x")\\nindicator(title="Real")'), S.declaredName('plot(close)')]));""")
        self.assertEqual(got, ["A // B", "Plain", "Real", ""])


@unittest.skipUnless(NODE, "node is not installed")
class BridgeToken(unittest.TestCase):
    def test_a_failed_session_fetch_is_not_remembered(self):
        src = read("chart-bridge.js")
        m = re.search(r"  let TOKEN = null;\n  const token = async \(\) => \{.*?\n  \};\n", src, re.S)
        self.assertTrue(m, "token() not found in chart-bridge.js")
        got = node(m.group(0) + """
          let calls = 0, mode = 'fail';
          globalThis.fetch = async () => { calls++; if (mode === 'fail') throw new TypeError('network'); return { json: async () => ({ data: { token: 'T' } }) }; };
          (async () => {
            const first = await token();            // the first fetch fails
            mode = 'ok';
            const second = await token();           // it must ask again, not serve the failure
            const third = await token();            // and now it is cached
            console.log(JSON.stringify({ first, second, third, calls }));
          })();""")
        self.assertEqual(got, {"first": "", "second": "T", "third": "T", "calls": 2})


class Pins(unittest.TestCase):
    """Cheap guards for what a browser verified."""

    def test_the_stream_no_longer_moves_the_polls_high_water_mark(self):
        body = read("chart-bridge.js").split("stream.onmessage = async (event) => {", 1)[1].split("connectStream()", 1)[0]
        code = re.sub(r"/\*.*?\*/", "", body.split("await run(payload.command)")[0].split("seen.add(id);")[1], flags=re.S)
        self.assertNotIn("lastCommandId", code)

    def test_a_reschedule_cannot_be_skipped_by_a_throw(self):
        self.assertIn("try { await poll(); } finally { setTimeout(tick, pollDelay); }", read("chart-bridge.js"))

    def test_the_rerun_waits_for_the_one_in_flight(self):
        src = read("unified.js")
        self.assertIn("if (rerunning) { check(); return; }", src)
        self.assertLess(src.index("if (rerunning) { check(); return; }"), src.index("marketSig = now;\n        /* The new bars load"))

    def test_the_newest_run_wins(self):
        src = read("unified.js")
        self.assertIn("const mySeq = ++runSeq;", src)
        self.assertIn("if (mySeq !== runSeq) {", src)

    def test_catalogue_links_must_be_https(self):
        src = read("app.js")
        self.assertIn("function safeHref(u)", src)
        self.assertNotIn("href=\"${esc(row.url || '#')}\"", src)
        self.assertIn("\"'\": '&#39;'", src, "esc() must escape the single quote too")

    def test_the_draft_is_flushed_when_the_page_goes_away(self):
        src = read("app.js")
        self.assertIn("window.addEventListener('pagehide', flushDraft)", src)

    def test_the_highlight_layer_is_not_a_tab_stop(self):
        self.assertIn('class="script__clip" aria-hidden="true" tabindex="-1" inert', read("index.html"))

    def test_the_sheets_are_dialogs_and_make_the_rest_inert(self):
        html = read("index.html")
        for ident in ("lib-drawer", "edge-sheet"):
            self.assertRegex(html, rf'id="{ident}" role="dialog" aria-modal="true"')
        self.assertIn("window.taModal.enter(", read("drawer.js") + read("edge.js"))

    def test_the_top_bar_has_a_focus_ring_that_beats_all_unset(self):
        css = read("styles.css")
        i = css.index(".vela-widget-symbol:focus-visible")
        self.assertIn("outline: var(--lx-focus-ring) !important", css[i:i + 700])

    def test_inputs_keep_a_transparent_outline_for_forced_colours(self):
        css = read("styles.css")
        self.assertIn("input:focus-visible, textarea:focus-visible {\n  /* transparent", css)

    def test_the_dock_band_and_the_short_viewport_rules_exist(self):
        css = read("styles.css")
        self.assertIn("@media (min-width: 1020px) and (max-width: 1069px)", css)
        self.assertIn("calc(100vw - 630px)", css)
        self.assertIn("@media (max-height: 560px)", css)

    def test_the_console_has_a_title_and_an_icon(self):
        html = read("index.html")
        self.assertIn("<title>Trader's Agent</title>", html)
        self.assertIn('rel="icon"', html)


class PluginReveal(unittest.TestCase):
    def test_the_launch_reveal_waits_for_the_stored_choice_and_defaults_to_off(self):
        src = (ROOT / "plugin" / "plugin.js").read_text(encoding="utf-8")
        self.assertIn("autoRevealOn = value === true", src)
        self.assertIn("autoRevealReady.then(", src)
        self.assertNotIn("autoRevealOn = value !== false", src)



class AddDoor(unittest.TestCase):
    def test_an_unknown_native_is_refused_before_vela_is_asked(self):
        src = read("chart-bridge.js")
        i = src.index("case 'add': {")
        block = src[i:i + 4200]
        self.assertLess(block.index("availableNativeIndicators"), block.index("c.addNativeIndicator(name);"))
        self.assertIn("did you mean", block)


if __name__ == "__main__":
    unittest.main()
