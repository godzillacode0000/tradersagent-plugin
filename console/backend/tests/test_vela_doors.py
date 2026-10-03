"""Phase 7 (3 Oct): the Vela features that only a hand could reach become agent doors.

Three doors, one module (`frontend/vela-doors.js`), so the bridge stays small:
  * `drawing` — Vela's own drawing tools (trend line, fib, channel, XABCD …), real objects the operator
    can drag afterwards. Anchors are validated BEFORE the call, because Vela happily returns a
    half-made drawing (one anchor on a trend line) that paints nothing.
  * `view`    — chart type, price scale, countdown, time zone, session, watermark, status line, grid
    sync, the ? shortcuts panel and the alerts inbox, as one "setting + value" door.
  * `marks`   — event marks on the time axis.

Honest limit pinned here too: Vela has no API that CREATES a price alert (its inbox only collects
alerts an indicator raises), so the door reads and clears the inbox and says so.
"""

import re
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
ROOT = BACKEND.parents[1]
FRONT = ROOT / "console" / "frontend"
VELA_DRAWINGS = FRONT / "vendor" / "vela" / "dist" / "chunk-EZ5FWVLA.js"


def _read(path) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def anchor_table(js: str) -> dict:
    body = js.split("const ANCHORS = {", 1)[1].split("};", 1)[0]
    return {m.group(1): (int(m.group(2)), int(m.group(3)))
            for m in re.finditer(r"([a-z0-9]+):\s*\[(\d+),\s*(\d+)\]", body)}


class TheModule(unittest.TestCase):
    js = _read(FRONT / "vela-doors.js")
    html = _read(FRONT / "index.html")

    def test_it_is_loaded_before_the_bridge(self):
        self.assertIn('src="./vela-doors.js"', self.html)
        self.assertLess(self.html.index("vela-doors.js"), self.html.index("chart-bridge.js"))

    def test_it_is_one_global_with_three_doors(self):
        self.assertIn("window.TaVela", self.js)
        for door in ("drawing", "view", "marks"):
            self.assertRegex(self.js, rf"\b{door}\b\s*[:(]")

    def test_it_keeps_the_pane_quiet(self):
        # No permanent widget: the module paints nothing of its own, and uses no animation frames.
        self.assertNotIn("requestAnimationFrame", self.js)
        self.assertNotIn("createElement", self.js)


class TheDrawingDoor(unittest.TestCase):
    js = _read(FRONT / "vela-doors.js")

    def test_the_table_has_the_whole_toolbar(self):
        table = anchor_table(self.js)
        self.assertGreaterEqual(len(table), 76, "Vela's toolbar offers 76 drawing types")
        for must in ("trendline", "hline", "parallelchannel", "fibretracement", "xabcd", "gannfan",
                     "elliottimpulse", "pitchfork", "box", "text", "position", "headshoulders"):
            self.assertIn(must, table)

    def test_the_table_agrees_with_velas_own_classes(self):
        # Drift guard: where the bundle states a class's anchor schema, the table must say the same.
        src = _read(VELA_DRAWINGS)
        table = anchor_table(self.js)
        checked = 0
        for chunk in re.split(r"\n(?=var [A-Za-z0-9_]+ = class)", src):
            kind = re.search(r'this\.type = "([a-z0-9]+)"', chunk)
            schema = re.search(r"anchorSchema\(\)\s*\{\s*return \{\s*min: (\d+),\s*max: (\d+)", chunk)
            if kind and schema and kind.group(1) in table:
                want = (int(schema.group(1)), int(schema.group(2)))
                self.assertEqual(table[kind.group(1)], want, f"{kind.group(1)} drifted from Vela")
                checked += 1
        # Measured on Vela 0.8.1: 30 classes state their schema directly; the other 46 types inherit it
        # from a shared base (the live probe covered all 76). Fewer than 30 means this regex rotted.
        self.assertGreaterEqual(checked, 30, "the guard matched too few classes to mean anything")

    def test_anchors_are_checked_before_vela_is_called(self):
        body = self.js.split("async function drawing(", 1)[1].split("\n  async function ", 1)[0]
        self.assertIn("ANCHORS[type]", body)
        self.assertIn("anchor", body.lower())
        self.assertLess(body.index("ANCHORS[type]"), body.index("D.add("))

    def test_it_speaks_in_bars_and_times(self):
        self.assertIn("bars_ago", self.js)
        self.assertIn("chartBars", self.js)

    def test_it_can_add_list_update_remove_and_clear(self):
        body = self.js.split("async function drawing(", 1)[1].split("\n  async function ", 1)[0]
        for op in ("'add'", "'list'", "'update'", "'remove'", "'clear'", "'types'"):
            self.assertIn(op, body)
        self.assertIn("D.removeMany(", body)       # clear is ONE undo step

    def test_it_reads_back_what_it_made(self):
        body = self.js.split("async function drawing(", 1)[1].split("\n  async function ", 1)[0]
        self.assertIn("D.all()", body)


class TheViewDoor(unittest.TestCase):
    js = _read(FRONT / "vela-doors.js")

    def test_every_setting_the_operator_can_hand_set_is_here(self):
        for setting in ("chart_type", "log", "invert", "scale_mode", "countdown", "timezone", "session",
                        "watermark", "indicator_titles", "indicator_values", "statusline_ohlc",
                        "statusline_name", "statusline_change", "sync_symbol", "sync_timeframe",
                        "sync_crosshair", "sync_style", "shortcuts", "alerts"):
            self.assertRegex(self.js, rf"\b{setting}\b", f"setting {setting} missing")

    def test_chart_types_are_velas_six(self):
        for kind in ("candles", "bars", "line", "area", "baseline", "heikinashi"):
            self.assertIn(f"'{kind}'", self.js)

    def test_it_uses_velas_own_setters(self):
        for call in ("setPriceStyle(", "setTimezone(", "setSession(", "setWatermarkVisible(",
                     "setStatuslinePart(", "applySyncSetting(", "renderer.set(", "shortcutsHelp"):
            self.assertIn(call, self.js)

    def test_a_write_is_read_back_and_never_claimed_blind(self):
        body = self.js.split("async function view(", 1)[1].split("\n  async function ", 1)[0]
        self.assertIn("readBack", body)
        self.assertIn("ok", body)

    def test_a_setting_that_cannot_apply_says_why(self):
        self.assertIn("no extended session", self.js.lower())

    def test_the_alert_inbox_is_honest_about_creating(self):
        low = self.js.lower()
        self.assertIn("alertcondition", low)
        self.assertIn("cannot create", low)

    def test_kuala_lumpur_is_mapped_to_a_zone_vela_lists(self):
        # Vela's list has Singapore (UTC+8) but no Kuala Lumpur.
        self.assertIn("Asia/Singapore", self.js)


class TheMarksDoor(unittest.TestCase):
    js = _read(FRONT / "vela-doors.js")

    def test_marks_live_in_one_named_group(self):
        self.assertIn("defineGroup(", self.js)
        self.assertIn("trader-agent", self.js)

    def test_it_can_add_list_remove_and_clear(self):
        body = self.js.split("async function marks(", 1)[1]
        for op in ("'add'", "'list'", "'remove'", "'clear'"):
            self.assertIn(op, body)

    def test_clear_only_removes_the_agents_own_marks(self):
        body = self.js.split("async function marks(", 1)[1]
        self.assertIn("GROUP.id", body)


class TheBridgeDelegates(unittest.TestCase):
    bridge = _read(FRONT / "chart-bridge.js")

    def test_the_page_publishes_the_three_actions(self):
        for action in ("'drawing'", "'view'", "'marks'"):
            self.assertIn(action, self.bridge.split("const ACTIONS", 1)[1].split("];", 1)[0])

    def test_each_case_hands_over_to_the_module(self):
        for action in ("drawing", "view", "marks"):
            body = self.bridge.split(f"case '{action}': {{", 1)[1].split("\n        case ", 1)[0]
            self.assertIn(f"window.TaVela.{action}(", body)

    def test_a_missing_module_is_reported_not_swallowed(self):
        self.assertIn("window.TaVela", self.bridge)
        self.assertIn("older frontend", self.bridge)


class TheReservedIdField(unittest.TestCase):
    """Found live (4 Oct): `drawing remove --id dw-1` answered "not found: 2788". The backend's
    enqueue() drops any `id` the caller sends and stamps the COMMAND's own number there, so the page
    never sees a drawing's id under that name. The doors must use their own field names."""

    js = _read(FRONT / "vela-doors.js")
    mcp = _read(ROOT / "console" / "mcp" / "server.py")
    cli = _read(ROOT / "console" / "bin" / "trader-chart")

    def test_the_backend_really_reserves_id(self):
        src = _read(BACKEND / "chart_bridge.py")
        self.assertIn('if k != "id"', src)

    def test_the_module_never_reads_the_commands_id(self):
        self.assertNotRegex(self.js, r"command\.id\b")

    def test_the_module_reads_its_own_field_names(self):
        self.assertIn("command.drawing_id", self.js)
        self.assertIn("command.mark_id", self.js)

    def test_mcp_sends_the_renamed_fields(self):
        drawing = self.mcp.split("def chart_drawing(", 1)[1].split("\n@mcp.tool", 1)[0]
        marks = self.mcp.split("def chart_marks(", 1)[1].split("\n@mcp.tool", 1)[0]
        self.assertIn('fields["drawing_id"]', drawing)
        self.assertNotIn('fields["id"]', drawing)
        self.assertIn('"mark_id"', marks)
        self.assertNotIn('("id", id)', marks)

    def test_the_cli_sends_the_renamed_fields(self):
        drawing = self.cli.split("def cmd_drawing(", 1)[1].split("\ndef ", 1)[0]
        marks = self.cli.split("def cmd_marks(", 1)[1].split("\ndef ", 1)[0]
        self.assertIn('payload["drawing_id"]', drawing)
        self.assertNotIn('payload["id"]', drawing)
        self.assertIn('payload["mark_id"]', marks)
        self.assertNotIn('"id")', marks)


class TheServerFallback(unittest.TestCase):
    server = _read(BACKEND / "server.py")

    def test_the_fallback_allow_list_has_the_new_actions(self):
        block = self.server.split("CHART_ACTIONS_FALLBACK = {", 1)[1].split("}", 1)[0]
        for action in ("drawing", "view", "marks"):
            self.assertIn(f'"{action}"', block)


class TheMcpDoors(unittest.TestCase):
    mcp = _read(ROOT / "console" / "mcp" / "server.py")
    cli = _read(ROOT / "console" / "bin" / "trader-chart")

    def test_each_door_is_a_tool_that_sends_its_action(self):
        for tool, action in (("chart_drawing", "drawing"), ("chart_view", "view"), ("chart_marks", "marks")):
            self.assertIn(f"def {tool}(", self.mcp)
            body = self.mcp.split(f"def {tool}(", 1)[1].split("\n@mcp.tool", 1)[0]
            self.assertIn(f'_command("{action}"', body)

    def test_each_is_declared_a_chart_mutation(self):
        for tool in ("chart_drawing", "chart_view", "chart_marks"):
            head = self.mcp.split(f"def {tool}(", 1)[0].rsplit("@mcp.tool", 1)[1]
            self.assertIn("read_only=False", head)

    def test_the_cli_can_drive_each(self):
        for name in ("drawing", "view", "marks"):
            self.assertIn(f'add_parser("{name}"', self.cli)
            self.assertIn(f"def cmd_{name}(", self.cli)

    def test_the_tool_tells_the_agent_about_the_alert_limit(self):
        body = self.mcp.split("def chart_view(", 1)[1].split("\n@mcp.tool", 1)[0]
        self.assertIn("alertcondition", body)


if __name__ == "__main__":
    unittest.main()
