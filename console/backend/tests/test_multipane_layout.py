"""Pins for the multi-pane grid: the boot preset, the `layout` door, and the three surfaces.

Same convention as test_pane_audit.py / test_ui_polish.py — this repo has no JS runner, so a behaviour
that would otherwise only be visible by eye is pinned as a shape in the source, plus the one fact that
cost real time to learn:

    `layout: false` is NOT "one chart". It sets `monoLayout`, and `setLayout()` returns immediately for
    the life of the page — so a page built that way can never be laid out again, no matter what the
    agent asks for. The guard for that is pinned here, because the failure mode is a silent no-op that
    reads as "the grid feature does not work".

Measured live on @luxalgo/vela 0.7.3, 26 Sep: presets `1 / 2h / 2v / 4 / 8`, custom `g<cols>x<rows>`
(1-4 each), and `ws.cells()` carrying each cell's own symbol/timeframe. See
docs/vela-chart-api-notes.md § "The workspace grid (multi-pane) — measured".
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BRIDGE = os.path.join(ROOT, "console", "frontend", "chart-bridge.js")
WORKSPACE = os.path.join(ROOT, "console", "frontend", "workspace.js")
CLI = os.path.join(ROOT, "console", "bin", "trader-chart")
MCP = os.path.join(ROOT, "console", "mcp", "server.py")
NOTES = os.path.join(ROOT, "docs", "vela-chart-api-notes.md")
TOOLS_DOC = os.path.join(ROOT, "docs", "MCP-TOOLS.md")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheConsoleBootsWithAGrid(unittest.TestCase):
    def test_the_boot_layout_is_a_preset_not_false(self):
        src = read(WORKSPACE)
        # The trap this guards, quoted in the header comment, must be visible in the source — but
        # never as the value the constructor is actually given.
        constructor = src.split("new VelaWorkspace(", 1)
        self.assertEqual(len(constructor), 2, "the workspace constructor has moved")
        options = constructor[1].split("});", 1)[0]
        self.assertNotIn("layout: false", options,
                         "`layout: false` sets monoLayout and disables setLayout() for the page's life")
        self.assertRegex(src, r"const LAYOUT = '[^']+'", "the boot preset is named, not inlined")
        self.assertIn("layout: LAYOUT", options, "the constructor must use it")

    def test_the_preset_it_boots_with_is_one_vela_registers(self):
        found = re.search(r"const LAYOUT = '([^']+)'", read(WORKSPACE))
        if found is None:
            self.fail("workspace.js must name its boot preset")
        preset = found.group(1)
        self.assertIn(preset, ("1", "2h", "2v", "4", "8", "g1x1"),
                      f"{preset} must be a preset Vela's registry knows")


class TheBridgeOwnsTheLayoutAction(unittest.TestCase):
    def test_layout_is_declared_as_an_action(self):
        # The server validates against the page's published list, so an action the page does not
        # declare is refused before it ever reaches the chart.
        self.assertIn("'layout'", read(BRIDGE))

    def test_the_case_refuses_a_preset_it_cannot_resolve(self):
        bridge = read(BRIDGE)
        case = bridge.split("case 'layout': {", 1)[1].split("case 'palette': {", 1)[0]
        self.assertIn("PRESETS", case, "the presets are enumerated, not guessed")
        self.assertRegex(case, r"\^g\[1-4\]x\[1-4\]\$", "custom grids are validated too")
        self.assertIn("unknown layout", case, "an unknown id is refused in prose")

    def test_the_monolayout_no_op_is_reported_rather_than_hidden(self):
        case = read(BRIDGE).split("case 'layout': {", 1)[1].split("case 'palette': {", 1)[0]
        self.assertIn("ws.monoLayout", case,
                      "a monoLayout page answers truthfully instead of a silent nothing")
        self.assertIn("no-op", case)

    def test_the_answer_carries_the_cells_not_the_id_asked_for(self):
        case = read(BRIDGE).split("case 'layout': {", 1)[1].split("case 'palette': {", 1)[0]
        self.assertIn("ws.cells()", case, "the cells are the evidence")
        self.assertIn("c.symbol", case)
        self.assertIn("c.timeframe", case)

    def test_a_read_does_not_write(self):
        case = read(BRIDGE).split("case 'layout': {", 1)[1].split("case 'palette': {", 1)[0]
        read_only = case.split("if (!want) {", 1)[1].split("if (!PRESETS", 1)[0]
        self.assertNotIn("setLayout(", read_only,
                         "asking for the grid must not change it")


class TheCliSpeaksTheSameDoor(unittest.TestCase):
    def test_the_subcommand_exists_and_takes_an_optional_preset(self):
        cli = read(CLI)
        self.assertIn('sub.add_parser("layout"', cli)
        self.assertIn('nargs="?"', cli.split('sub.add_parser("layout"', 1)[1].split("s.set_defaults", 1)[0])

    def test_the_command_sends_the_bridge_action(self):
        cli = read(CLI)
        self.assertIn("def cmd_layout", cli)
        body = cli.split("def cmd_layout", 1)[1].split("def cmd_wait", 1)[0]
        self.assertIn('"action": "layout"', body)
        self.assertIn("args.preset", body)


class TheMcpToolMatchesTheOthers(unittest.TestCase):
    def test_the_tool_exists_with_annotations_and_a_read_path(self):
        src = read(MCP)
        self.assertIn("def chart_set_layout", src)
        decl = src.split("def chart_set_layout", 1)[1].split("\n@mcp.tool", 1)[0]
        self.assertIn("_ann(", src.split("def chart_set_layout", 1)[0].rsplit("@mcp.tool", 1)[1])
        self.assertIn('_command("layout"', decl, "no argument = read")
        self.assertIn('_command("layout", layout=', decl, "an argument = write")

    def test_the_tool_is_documented(self):
        self.assertIn("`chart_set_layout`", read(TOOLS_DOC))
        self.assertIn("`chart_set_layout`", read(os.path.join(ROOT, "README.md")))


class TheMeasuredFactsAreWrittenDown(unittest.TestCase):
    def test_the_grid_section_exists_and_names_the_trap(self):
        notes = read(NOTES)
        self.assertIn("The workspace grid (multi-pane) — measured", notes)
        self.assertIn("monoLayout", notes)
        self.assertIn("2h", notes)


if __name__ == "__main__":
    unittest.main()
