"""Pins for full screen, and for a pane that cannot push the page sideways.

The operator, 27 Sep, looking at the chart pane:

    "i try use the indicators dari Luxalgo MCP.... and then the chart pane mcm tak adaptive...
     sy nak ada button capability untuk boleh kasi fullscreen ni chart,,, sekarang mcm takde"

Two claims to keep true:

  * **A button exists, and it does two things.** The console's chrome steps aside so the CHART owns
    the page (pure CSS — works in every host), and the page asks for real fullscreen so it can take
    the display (needs the plugin pane's iframe to carry `allowfullscreen`). `Esc`/the floating ✕
    comes back, and `fullscreenchange` re-syncs the class, because an Esc inside native fullscreen
    never reaches a keydown handler.
  * **Nothing here scrolls the page sideways.** With a legend chip plus the status pills, the
    topbar's min-content measured 921px inside an 870px pane and pushed the document wider — the
    horizontal scrollbar he read as "not adaptive". Reproduced in a headless browser before fixing;
    re-measured after. The rule is `overflow: hidden` on the shell + a topbar that may wrap + labels
    that go icon-only under 1180px.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FRONTEND = os.path.join(ROOT, "console", "frontend")
APP = os.path.join(FRONTEND, "app.js")
CSS = os.path.join(FRONTEND, "styles.css")
HTML = os.path.join(FRONTEND, "index.html")
BRIDGE = os.path.join(FRONTEND, "chart-bridge.js")
CLI = os.path.join(ROOT, "console", "bin", "trader-chart")
MCP = os.path.join(ROOT, "console", "mcp", "server.py")
STORE = os.path.join(ROOT, "console", "backend", "chart_bridge.py")
PLUGIN = os.path.join(ROOT, "plugin", "plugin.js")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheButtonIsThere(unittest.TestCase):
    def test_the_control_is_a_vela_widget_action_now(self):
        """3 Oct: ⛶ is registered through Vela's widget-action API (workspace.js) instead of sitting
        in our own topbar — one row, Vela's, with no DOM docking to maintain."""
        ws = read(os.path.join(FRONTEND, "workspace.js"))
        self.assertIn("id: 'ta-fullscreen'", ws)
        self.assertIn("window.setChartFullscreen", ws)
        self.assertIn('id="chart-focus-exit"', read(HTML), "in full screen there is no topbar left to click")

    def test_the_agent_has_the_same_button(self):
        bridge = read(BRIDGE)
        self.assertIn("'fullscreen',", bridge.split("const ACTIONS", 1)[1].split("];", 1)[0],
                      "the page must advertise the action it can run")
        self.assertIn("case 'fullscreen':", bridge)
        self.assertIn("window.setChartFullscreen(want)", bridge)
        cli = read(CLI)
        self.assertIn('sub.add_parser("fullscreen"', cli)
        self.assertIn('s.add_argument("--off"', cli)
        mcp = read(MCP)
        self.assertIn("def chart_fullscreen(", mcp)
        self.assertIn('_command("fullscreen", on=bool(on))', mcp)
        self.assertIn('"fullscreen": payload.get("fullscreen")', read(STORE),
                      "the result store whitelists; a field it does not name arrives empty")


class ItDoesBothHalves(unittest.TestCase):
    def test_the_chrome_steps_aside(self):
        css = read(CSS)
        self.assertIn("body.chart-focus .topbar,", css)
        self.assertIn("body.chart-focus .statusbar,", css)
        self.assertIn("body.chart-focus .panel--left,", css)
        self.assertIn("body.chart-focus .panel--right { display: none !important; }", css)

    def test_it_asks_for_the_display_too(self):
        app = read(APP)
        self.assertIn("document.documentElement.requestFullscreen", app)
        self.assertIn("document.exitFullscreen", app)
        plugin = read(PLUGIN)
        self.assertIn("allowFullScreen: true", plugin,
                      "without this the pane's iframe is refused fullscreen silently")

    def test_an_escape_inside_native_fullscreen_still_syncs(self):
        """Esc in native fullscreen exits it without a keydown reaching the page, so the class would
        say 'full screen' over a screen that came back. Measured live 27 Sep: it did exactly that,
        because the listener asked `isChartFullscreen()` — which reads the class itself — and so could
        never decide to turn it off. The browser's own state is tracked separately now."""
        app = read(APP)
        self.assertIn("document.addEventListener('fullscreenchange'", app)
        self.assertIn("ev.key === 'Escape' && isChartFullscreen()", app)
        self.assertIn("function isChartFullscreen()", app)
        self.assertIn("let nativeFullscreenWasOn = false;", app)
        self.assertIn("if (nativeFullscreenWasOn && !native && document.body.classList.contains('chart-focus'))", app,
                      "the browser leaving fullscreen means the page half goes too")
        self.assertIn("function paintChartFocus(on)", app)

    def test_the_chart_is_told_its_box_changed(self):
        css = read(CSS)
        self.assertIn("function syncChartBox()", read(APP))
        self.assertIn("body.chart-focus .app { grid-template-rows: minmax(0, 1fr); }", css)


class ThePageCannotBePushedSideways(unittest.TestCase):
    def test_the_shell_never_scrolls(self):
        css = read(CSS)
        self.assertIn(".app { overflow: hidden; }", css,
                      "everything that scrolls in here is a pane, never the shell")

    def test_the_console_first_row_is_gone(self):
        """3 Oct: the console's own bar (brand, pills, toggles) duplicated Vela's row and cost the
        chart ~34 px. It is deleted — brand and ◐ live in the drawer now, the status is one dot, and
        the legends ride the statusbar."""
        html = read(HTML)
        self.assertNotIn('<header class="topbar">', html)
        self.assertNotIn('id="mcp-status"', html)
        self.assertNotIn('id="bars-status"', html)
        self.assertNotIn('id="indicator-count"', html)
        css = read(CSS)
        self.assertNotIn("--lx-topbar-h", css, "the row's height variable went with the row")
        self.assertIn(".chart-legend { flex: 0 1 auto; min-width: 0; max-width: 34%; }", css,
                      "a legend chip carrying an indicator's name must be able to shrink")

    def test_the_measurement_is_written_down(self):
        """The numbers are the point: 921 > 870 is what "not adaptive" meant, and a future edit that
        re-breaks it should find the old reading next to the rule."""
        css = read(CSS)
        self.assertIn("921px", css)
        self.assertIn("870px", css)


class TheDoorAndTheDocsAgree(unittest.TestCase):
    def test_mcp_tools_doc_counts_the_new_tool(self):
        doc = read(os.path.join(ROOT, "docs", "MCP-TOOLS.md"))
        heading = re.search(r"# Trader's Agent .* \((\d+)\)", doc)
        if heading is None:
            self.fail("docs/MCP-TOOLS.md's heading no longer carries a tool count")
        # The heading counts EVERY tool the server exposes (chart + library + backtest tiers), so the
        # honest check is against the decorators themselves — not against the rows of any one table
        # (the failure-code and CLI tables use the same row shape).
        declared = len(re.findall(r"@mcp\.tool\(", read(MCP)))
        self.assertEqual(int(heading.group(1)), declared,
                         "the count in the heading and the server's tools are one fact")
        self.assertIn("| `chart_fullscreen` |", doc)

    def test_the_cli_help_names_both_states(self):
        cli = read(CLI)
        self.assertIn('help="give the chart the whole pane / the whole screen', cli)


if __name__ == "__main__":
    unittest.main()
