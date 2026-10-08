"""The Edge Stats sheet, pinned as source shape (there is no JS runner in this suite — the convention
test_overlay_paint.py set). Each pin names the defect it keeps from coming back; the sheet's behaviour was
verified in a real browser against the real engine, and these hold the parts a later edit could break
silently:

  * the honest-numbers rule: the refused branch is decided BEFORE any estimate is painted, and no template
    prints a rate without going through the one place that carries its N;
  * everything the engine says is escaped before it reaches innerHTML (the DSL echo, preset text,
    error messages, log lines);
  * the sheet is an overlay that animates transform/opacity only (a 2016 laptop), and never resizes Vela;
  * the doors: ⋯ menu, the bare-chart fallback, the agent's `edge` command (and the result store that
    would silently drop its after-state), Esc closing one layer.
"""

import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FRONT = ROOT / "console" / "frontend"
JS = (FRONT / "edge.js").read_text(encoding="utf-8")
CSS = (FRONT / "edge.css").read_text(encoding="utf-8")
HTML = (FRONT / "index.html").read_text(encoding="utf-8")


def function_body(name: str) -> str:
    start = JS.index(f"function {name}(")
    depth, i = 0, JS.index("{", start)
    for j in range(i, len(JS)):
        depth += JS[j] == "{"
        depth -= JS[j] == "}"
        if depth == 0:
            return JS[start:j + 1]
    raise AssertionError(name)


class Markup(unittest.TestCase):
    def test_the_sheet_and_its_scrim_exist_and_start_hidden(self):
        for ident in ("edge-sheet", "edge-scrim", "edge-bar", "edge-body", "edge-close", "edge-data", "edge-sub"):
            self.assertIn(f'id="{ident}"', HTML)
        self.assertIn('id="edge-sheet" role="dialog" aria-modal="true" aria-hidden="true"', HTML)
        self.assertIn('href="./edge.css"', HTML)
        self.assertIn('src="./edge.js"', HTML)

    def test_the_script_loads_after_the_things_it_talks_to(self):
        self.assertGreater(HTML.index('src="./edge.js"'), HTML.index('src="./replay.js"'))
        self.assertGreater(HTML.index('src="./edge.js"'), HTML.index('src="./app.js"'))

    def test_a_bare_chart_has_a_plain_door(self):
        self.assertIn('id="edge-fallback"', HTML)
        self.assertIn("edge-fallback", JS)


class HonestNumbers(unittest.TestCase):
    def test_a_refused_estimate_is_decided_before_any_rate_is_painted(self):
        body = function_body("renderResult")
        refused = body.index("if (refused)")
        first_rate = body.index("pctNum(d.estimate)")
        self.assertLess(refused, first_rate, "the refused branch must come first")
        self.assertIn("Not enough sessions to give a rate", body)
        self.assertIn("so no estimate is shown", body)

    def test_everything_below_the_headline_is_skipped_when_refused(self):
        body = function_body("renderResult")
        for section in ("d.groups", "d.stability", "d.recency", "d.perYear", "d.distribution"):
            self.assertRegex(body, r"if \(!refused && " + re.escape(section), f"{section} must not render for a refused result")

    def test_a_low_sample_gets_a_banner(self):
        body = function_body("renderResult")
        self.assertIn("guards.lowSample", body)
        self.assertIn("Low sample", body)

    def test_the_disclaimer_always_closes_the_answer(self):
        self.assertIn("Not predictions, not advice", function_body("renderResult"))

    def test_the_headline_names_its_sample_next_to_the_rate(self):
        body = function_body("renderResult")
        self.assertRegex(body, r"e-facts.*sessions.*95% range", )

    def test_the_sheet_never_computes_a_statistic(self):
        """The numbers are the engine's. A Wilson interval or a division of hits by N written here would be a
        second implementation to drift from the first."""
        for forbidden in ("Math.sqrt", "wilson", "Wilson(", "successes / ", "/ d.n"):
            self.assertNotIn(forbidden, JS, f"edge.js must not compute statistics ({forbidden})")


class Escaping(unittest.TestCase):
    def test_no_engine_text_is_interpolated_bare_into_markup(self):
        """`${x.message}` straight into a template is the hole; `${esc(x.message)}` is the fix. The engine
        echoes the operator's own query, preset text, error messages and log lines — all attacker-shaped
        if a Library write-up or a pasted question ever carries markup."""
        names = r"(message|hint|dsl|summary|title|group|symbol|adapter|doc|label|error|step|note|text|name|sessionKey|tradeDate|id|tz|tf)"
        bare = re.findall(r"\$\{\s*[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*\." + names + r"\s*\}", JS)
        self.assertEqual(bare, [], "engine text interpolated without esc(): " + str(bare))

    def test_dsl_echo_and_errors_go_through_esc(self):
        body = function_body("askErrorHtml")
        self.assertIn("esc(err.message)", body)
        self.assertIn("esc(a)", body)
        self.assertIn("esc(err.hint)", body)

    def test_a_job_log_is_escaped(self):
        self.assertIn("esc(job.tail.join", JS)
        self.assertIn("esc(job.error)", JS)


class Motion(unittest.TestCase):
    def test_keyframes_animate_only_transform_and_opacity(self):
        for name, block in re.findall(r"@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}", CSS):
            props = set(re.findall(r"([a-z-]+)\s*:", re.sub(r"\{[^}]*\}", lambda m: m.group(0), block)))
            self.assertLessEqual(props, {"transform", "opacity"}, f"@keyframes {name} animates {props}")

    def test_transitions_name_their_properties(self):
        self.assertNotRegex(CSS, r"transition:\s*all\b")
        self.assertNotRegex(CSS, r"transition-property:\s*all\b")

    def test_the_sheet_is_an_overlay_and_never_resizes_the_chart(self):
        sheet = CSS[CSS.index(".edge-sheet {"):CSS.index("}", CSS.index(".edge-sheet {"))]
        self.assertIn("position: fixed", sheet)
        self.assertIn("transform: translateX(104%)", sheet)
        self.assertNotIn("grid-template-columns", CSS.split("@media")[0].split(".edge-sheet {")[0])

    def test_reduced_motion_is_honoured(self):
        self.assertIn("prefers-reduced-motion: reduce", CSS)

    def test_only_tokens_colour_the_sheet(self):
        raw = [c for c in re.findall(r"#[0-9a-fA-F]{3,8}\b", CSS)]
        self.assertEqual(raw, [], "edge.css must use --lx-* tokens, not raw hex (dark/light would diverge)")

    def test_a_background_refresh_does_not_replay_the_entrance(self):
        self.assertIn(".edge__body.is-still .edge-card", CSS)
        self.assertIn("is-still", function_body("render"))


class Doors(unittest.TestCase):
    def test_the_more_menu_opens_it(self):
        ws = (FRONT / "workspace.js").read_text(encoding="utf-8")
        self.assertRegex(ws, r"\['Edge Stats', \(\) => \{ if \(window\.edgeSheet\) window\.edgeSheet\.open\(\); \}\]")

    def test_escape_closes_one_layer_and_app_js_skips_a_handled_press(self):
        self.assertIn("window.closeEdgeIfOpen", JS)
        self.assertIn("ev.preventDefault();\n      ev.stopPropagation();", JS)
        self.assertIn("}, true);", JS)                       # capture phase: before app.js's own handler
        # A press the sheet handled never reaches app.js: its handler runs in the capture phase and stops it
        # (asserted above). app.js's own handler must NOT skip a merely defaultPrevented press — after a
        # click on the chart Vela marks Escape handled, and skipping then meant Escape stopped closing the
        # pane (measured 5 Oct with an A/B run against the committed build).
        app = (FRONT / "app.js").read_text(encoding="utf-8")
        handler = app.split("function escapeKeydown(ev) {", 1)[1].split("\n}\n", 1)[0]
        self.assertNotIn("defaultPrevented", handler)

    def test_the_agent_door_is_registered_everywhere_it_must_be(self):
        bridge = (FRONT / "chart-bridge.js").read_text(encoding="utf-8")
        self.assertIn("'edge',", bridge)
        self.assertIn("case 'edge':", bridge)
        server = (ROOT / "console" / "backend" / "server.py").read_text(encoding="utf-8")
        self.assertRegex(server, r'CHART_ACTIONS_FALLBACK = \{[^}]*"edge"')
        store = (ROOT / "console" / "backend" / "chart_bridge.py").read_text(encoding="utf-8")
        self.assertIn('"edge": payload.get("edge")', store, "the store whitelists result fields — without this the agent is never told what is on screen")

    def test_the_agent_api_returns_what_is_shown_not_what_was_asked(self):
        for name in ("ask", "report", "session", "show", "data"):
            self.assertRegex(JS, rf"async {name}\(")
        self.assertIn("window.edgeSheet = {", JS)
        self.assertIn("describe()", JS)

    def test_posts_carry_the_console_token(self):
        self.assertIn("X-Trader-Token", JS)
        self.assertIn("/api/session", JS)

    def test_the_session_chart_is_the_vendored_vela(self):
        self.assertIn("import('@luxalgo/vela')", JS)
        self.assertNotIn("cdn.jsdelivr", JS)
        self.assertIn("unregisterNativeIndicator", JS)       # a chart torn down must not leak its indicator

    def test_the_chart_is_disposed_when_leaving_the_session_view(self):
        self.assertIn("destroyChartIfLeaving", function_body("render"))
        self.assertIn("destroyChart();", function_body("close"))


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class Syntax(unittest.TestCase):
    def test_the_scripts_parse(self):
        for name in ("edge.js", "chart-bridge.js", "workspace.js"):
            done = subprocess.run(["node", "--check", str(FRONT / name)], capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, f"{name}: {done.stderr}")


if __name__ == "__main__":
    unittest.main()
