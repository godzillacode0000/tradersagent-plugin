"""The agent's door for a script's own settings (`inputs`) — everything around the pure resolution that
test_script_tools.py runs under Node:

  * the MCP tools carry `inputs` to the page, refuse a malformed call before anything is queued, and the
    new read-only `chart_pine_inputs` asks for a LISTING and nothing else;
  * the result store keeps `inputs` (it whitelists: a field it does not name never reaches the agent);
  * the CLI turns `--input LABEL=VALUE` into the same object;
  * the page wiring: apply / draw / script resolve the labels, run with the overrides, and let the
    editor's Settings show them ONLY when the editor holds that very script.

The whole path (real MCP tool -> console -> a live page -> the editor's Settings) was driven in Chromium.
"""

import contextlib
import importlib.machinery
import importlib.util
import io
import os
import re
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "console" / "backend"))

from test_mcp_server import HAVE_FASTMCP, _Stub, load_mcp, text_of     # noqa: E402  (helpers only)

FRONT = ROOT / "console" / "frontend"
BRIDGE = (FRONT / "chart-bridge.js").read_text(encoding="utf-8")
APP = (FRONT / "app.js").read_text(encoding="utf-8")
CLI_PATH = ROOT / "console" / "bin" / "trader-chart"

PINE = "//@version=6\nindicator('x')\nlen = input.int(20, 'Length')\nplot(close)"
ANSWER = {"ok": True, "data": {"pushed": 1, "command": {"id": 9},
                                "result": {"id": 9, "ok": True, "detail": "ran in 42 ms over 500 bars"}}}


@unittest.skipUnless(HAVE_FASTMCP, "fastmcp is not installed (only the MCP wrapper needs it)")
class MCPTools(unittest.TestCase):
    def setUp(self):
        _Stub.routes = {"/api/chart/command": ANSWER}
        _Stub.posts = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Stub)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.mcp = load_mcp(f"http://127.0.0.1:{self.server.server_address[1]}", tempfile.mkdtemp())

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def commands(self):
        return [p for p in _Stub.posts if "action" in p]

    def test_apply_carries_inputs_to_the_page(self):
        out = text_of(self.mcp.chart_apply_pine(PINE, inputs={"Length": 50, "Show upper band": False, "MA type": "EMA"}))
        self.assertTrue(out.startswith("✓"), out)
        sent = self.commands()[-1]
        self.assertEqual(sent["action"], "apply")
        self.assertEqual(sent["inputs"], {"Length": 50, "Show upper band": False, "MA type": "EMA"})

    def test_a_call_without_inputs_sends_none_at_all(self):
        """Absent, not null or {}: an explicit {} means 'all defaults' and clears the editor's values."""
        self.mcp.chart_apply_pine(PINE)
        self.mcp.chart_draw(PINE)
        for command in self.commands():
            self.assertNotIn("inputs", command)

    def test_an_explicit_empty_object_is_sent_because_it_means_all_defaults(self):
        self.mcp.chart_apply_pine(PINE, inputs={})
        self.assertEqual(self.commands()[-1]["inputs"], {})

    def test_draw_carries_inputs_too(self):
        self.mcp.chart_draw(PINE, inputs={"Swing length": 10})
        self.assertEqual(self.commands()[-1], {**self.commands()[-1], "action": "draw", "inputs": {"Swing length": 10}})

    def test_null_is_a_value_it_resets_the_input(self):
        self.mcp.chart_apply_pine(PINE, inputs={"Length": None})
        self.assertEqual(self.commands()[-1]["inputs"], {"Length": None})

    def test_labels_are_trimmed(self):
        self.mcp.chart_apply_pine(PINE, inputs={"  Length ": 5})
        self.assertEqual(self.commands()[-1]["inputs"], {"Length": 5})

    def test_a_malformed_call_is_refused_before_anything_is_queued(self):
        bad = [
            (["Length", 5], "must be an object"),
            ("Length=5", "must be an object"),
            ({"Length": [1, 2]}, "must be a number, true/false, text or null"),
            ({"Length": {"a": 1}}, "must be a number, true/false, text or null"),
            ({"Length": float("nan")}, "not a finite number"),
            ({"Length": float("inf")}, "not a finite number"),
            ({"": 5}, "1-200 characters"),
            ({"x" * 201: 5}, "1-200 characters"),
            ({"Length": "x" * 501}, "too long"),
            ({f"i{n}": n for n in range(65)}, "most one call takes is 64"),
        ]
        for value, fragment in bad:
            before = len(self.commands())
            out = text_of(self.mcp.chart_apply_pine(PINE, inputs=value))
            self.assertTrue(out.startswith("✗"), (value, out))
            self.assertIn(fragment, out)
            self.assertEqual(len(self.commands()), before, f"{fragment}: a refused call must not be queued")

    def test_the_page_s_reply_about_ignored_labels_reaches_the_agent(self):
        detail = ('ran in 42 ms · inputs: Length=50 · ⚠ not used — "Lenght": this script has no input called '
                  'that — did you mean "Length"?')
        _Stub.routes = {"/api/chart/command": {"ok": True, "data": {"pushed": 1, "command": {"id": 9},
                        "result": {"id": 9, "ok": True, "detail": detail}}}}
        out = text_of(self.mcp.chart_apply_pine(PINE, inputs={"Lenght": 1, "Length": 50}))
        self.assertIn('did you mean "Length"', out)

    # ── chart_pine_inputs ───────────────────────────────────────────────────
    def test_the_listing_asks_for_a_listing_and_nothing_else(self):
        out = text_of(self.mcp.chart_pine_inputs(PINE))
        self.assertTrue(out.startswith("✓"), out)
        sent = self.commands()[-1]
        self.assertEqual((sent["action"], sent["mode"], sent["pine"]), ("script", "inputs", PINE))
        self.assertNotIn("inputs", sent)

    def test_the_listing_needs_a_script(self):
        self.assertIn("no Pine source", self.mcp.chart_pine_inputs("   "))
        self.assertEqual(self.commands(), [])


class ResultStore(unittest.TestCase):
    def test_the_store_keeps_inputs_so_the_agent_is_told_what_was_ignored(self):
        import chart_bridge
        with tempfile.TemporaryDirectory() as root:
            payload = {"id": 3, "ok": True, "detail": "ran",
                       "inputs": {"applied": [{"name": "Length", "value": 50}], "ignored": [{"name": "Lenght", "reason": "x"}],
                                  "inEditor": True}}
            stored = chart_bridge.record_result(root, payload)
            self.assertEqual(stored["inputs"], payload["inputs"])
            self.assertEqual(chart_bridge.get_result(root, 3)["inputs"], payload["inputs"])

    def test_a_result_without_inputs_has_none(self):
        import chart_bridge
        with tempfile.TemporaryDirectory() as root:
            self.assertIsNone(chart_bridge.record_result(root, {"id": 4, "ok": True})["inputs"])


class Cli(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        loader = importlib.machinery.SourceFileLoader("trader_chart_cli_inputs", str(CLI_PATH))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        cls.cli = importlib.util.module_from_spec(spec)
        loader.exec_module(cls.cli)

    def test_pairs_become_the_object_the_page_wants(self):
        got = self.cli.parse_inputs(["Length=50", "Show upper band=false", "Multiplier=2.5", "MA type=EMA",
                                     "Basis colour=#ff8800", "Title=\"a=b\"", "Reset=null"])
        self.assertEqual(got, {"Length": 50, "Show upper band": False, "Multiplier": 2.5, "MA type": "EMA",
                               "Basis colour": "#ff8800", "Title": "a=b", "Reset": None})

    def test_nothing_given_is_none_not_an_empty_object(self):
        """None means 'leave the script on its defaults and the editor alone'; {} means 'reset it'."""
        self.assertIsNone(self.cli.parse_inputs(None))
        self.assertIsNone(self.cli.parse_inputs([]))

    def refused(self, item):
        with contextlib.redirect_stderr(io.StringIO()) as err, self.assertRaises(SystemExit):
            self.cli.parse_inputs([item])
        return err.getvalue()

    def test_a_pair_without_a_value_or_a_name_is_refused(self):
        for bad in ("Length", "=5", "  =5"):
            self.assertIn("NAME=VALUE", self.refused(bad))

    def test_a_list_or_an_object_is_not_a_value(self):
        for bad in ("Length=[1,2]", "Length={\"a\":1}"):
            self.assertIn("a number, true/false, text or null", self.refused(bad))

    def test_draw_and_script_take_input_and_script_can_list(self):
        src = CLI_PATH.read_text(encoding="utf-8")
        self.assertEqual(src.count('add_argument("--input", action="append"'), 2)
        self.assertIn('choices=["show", "draw", "native", "clear", "inputs"]', src)
        self.assertIn('die("script inputs needs --pine FILE', src)


class PageWiring(unittest.TestCase):
    """Pinned as source shape — the behaviour is in the Chromium run noted at the top."""

    def case(self, name):
        start = BRIDGE.index(f"case '{name}': {{")
        return BRIDGE[start:BRIDGE.index("\n        case '", start + 10)]

    def test_apply_and_draw_and_script_resolve_the_labels_and_run_with_the_overrides(self):
        apply_, draw, script = self.case("apply"), self.case("draw"), self.case("script")
        for body in (apply_, draw, script):
            self.assertIn("await agentInputs(pine, command.inputs)", body)
            self.assertIn("given.overrides || {}", body)
            self.assertIn("settleInputs(", body)
        self.assertRegex(apply_, r"TraderRun\.run\(pine, 'agent', given \? \{ inputs: given\.overrides \|\| \{\} \} : undefined\)")

    def test_what_happened_is_only_said_after_a_run_that_worked(self):
        self.assertLess(self.case("apply").index("if (!r.ok)"), self.case("apply").index("settleInputs("))
        self.assertIn("else await settleInputs(out, pine, given, true)", self.case("script"))

    def test_the_listing_is_a_read_it_does_not_open_the_pane(self):
        body = self.case("script")
        self.assertLess(body.index("=== 'inputs'"), body.index("sp.open()"))
        self.assertIn("scanInputs(src)", body)
        self.assertNotIn("TraderRun.run", body[:body.index("sp.open()")])

    def test_show_mode_sets_the_editors_values_without_running(self):
        show = self.case("script").split("if (mode === 'show') {", 1)[1].split("\n          }\n", 1)[0]
        self.assertIn("settleInputs(out, pine, await agentInputs(pine, command.inputs), false)", show)
        self.assertNotIn("TraderRun.run", show)

    def test_the_agent_s_values_reach_the_editor_only_when_it_holds_that_script(self):
        body = APP.split("window.scriptPane.adoptInputs = async (source, keyed, opts) => {", 1)[1].split("\n  };\n", 1)[0]
        self.assertIn(".replace(/\\r\\n?/g, '\\n')", body)               # a CRLF source still matches the textarea's value
        self.assertIn("if (srcBox.value !== want) return false;", body)
        self.assertLess(body.index("return false;"), body.index("inputStore = {};"))   # nothing is touched before the check
        self.assertIn("if (o.ran) lastRunSource = want;", body)          # a change in Settings then re-runs it

    def test_the_bridge_scan_supersedes_a_pending_one_so_nothing_is_read_twice(self):
        body = APP.split("window.scriptPane.adoptInputs = async (source, keyed, opts) => {", 1)[1].split("\n  };\n", 1)[0]
        self.assertIn("scanSeq++;", body)
        self.assertIn("applyMeta(o.metas);", body)

    def test_an_agent_run_stays_out_of_the_panes_run_list(self):
        """The operator's decision (Hermes' review of PR #4): chat and the activity note already cover it."""
        body = APP.split("window.scriptPane.adoptInputs = async (source, keyed, opts) => {", 1)[1].split("\n  };\n", 1)[0]
        self.assertNotIn("addRun(", body)
        self.assertNotIn("setStatus(", body)

    def test_the_page_refuses_what_it_cannot_read_instead_of_running_on_defaults_silently(self):
        body = BRIDGE.split("async function agentInputs(pine, given) {", 1)[1].split("\n  }\n", 1)[0]
        self.assertIn("must be an object that maps an input", body)
        self.assertIn("could not be read", body)
        self.assertIn("this page cannot read a script", body)


if __name__ == "__main__":
    unittest.main()
