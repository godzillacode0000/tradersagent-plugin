"""script-tools.js — the pane's pure decisions, executed under Node (there is no browser in this suite).

  * where an error is: a syntax error quotes `at 3:7`; a runtime error names only a variable or a Pine
    function, and the first line using that name is a guess that must be labelled as one;
  * which input values changed and what the engine is handed: only changes, clamped to the input's own
    range, keyed by the engine's id; values do not leak between scripts or survive an input being removed.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

FRONT = Path(__file__).resolve().parents[3] / "console" / "frontend"
NODE = shutil.which("node")


def run(expr: str):
    """Evaluate a JS expression with ScriptTools in scope; return it JSON-decoded."""
    script = (
        f"const T = require({json.dumps(str(FRONT / 'script-tools.js'))});\n"
        f"process.stdout.write(JSON.stringify({expr}));"
    )
    done = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=30)
    if done.returncode != 0:
        raise AssertionError(done.stderr)
    return json.loads(done.stdout) if done.stdout else None


INT = {"id": "in_0", "type": "int", "title": "Length", "varId": "len", "defval": 14, "minval": 2, "maxval": 200}
FLT = {"id": "in_1", "type": "float", "title": "Mult", "varId": "m", "defval": 2.0}
BOOL = {"id": "in_2", "type": "bool", "title": "Show", "varId": "s", "defval": True}
CHOICE = {"id": "in_3", "type": "string", "title": "MA", "varId": "k", "defval": "SMA", "options": ["SMA", "EMA"]}
COLOR = {"id": "in_4", "type": "color", "title": "Colour", "varId": "c", "defval": "#2962FFFF"}
METAS = [INT, FLT, BOOL, CHOICE, COLOR]


@unittest.skipUnless(NODE, "node is not installed")
class Errors(unittest.TestCase):
    def test_a_syntax_error_is_located_exactly_from_the_engines_own_position(self):
        loc = run("T.locateError('a=1\\nb=@@\\nplot(b)\\n', {message: \"Failed to transpile Pine Script version 6: Unexpected character '@' at 2:3\"})")
        self.assertEqual(loc, {"line": 2, "col": 3, "approx": False})

    def test_a_position_past_the_end_is_clamped_to_the_last_line(self):
        """An unclosed bracket is reported at the end of file (5:1 in a 4-line script)."""
        loc = run("T.locateError('a=1\\nb=ta.sma(close, 3\\nplot(b)\\n', {message: 'Unexpected token EOF at 9:1'})")
        self.assertEqual(loc["line"], 4)            # 'plot(b)' + the empty last row
        self.assertFalse(loc["approx"])

    def test_an_undefined_name_points_at_its_first_use_and_says_it_is_a_guess(self):
        loc = run("T.locateError('len = 14\\nplot(close)\\nplot(nope + len)\\n', {message: 'nope is not defined'})")
        self.assertEqual(loc["line"], 3)
        self.assertTrue(loc["approx"])

    def test_a_dotted_function_is_found_and_a_longer_name_is_not_mistaken_for_it(self):
        src = "x = ta.smaller(close)\\ny = ta.sma(close, 3)\\n"
        loc = run(f"T.locateError('{src}', {{message: 'ta.sma is not a function'}})")
        self.assertEqual(loc["line"], 2)

    def test_a_name_in_a_comment_or_a_string_is_not_a_hit(self):
        src = json.dumps("// nope is here\nlabel.new(0, 0, 'nope')\nplot(nope)\n")
        loc = run(f"T.locateError({src}, {{message: 'nope is not defined'}})")
        self.assertEqual(loc["line"], 3)

    def test_a_member_of_something_else_is_not_the_name(self):
        loc = run("T.locateError('a = obj.nope\\nplot(nope)\\n', {message: 'nope is not defined'})")
        self.assertEqual(loc["line"], 2)

    def test_a_runtime_error_with_a_pine_method_is_located_by_that_method(self):
        loc = run("T.locateError('v = 1\\nx = array.get(a, 5)\\n', {message: 'Index 5 is out of bounds', method: 'array.get'})")
        self.assertEqual(loc["line"], 2)
        self.assertTrue(loc["approx"])

    def test_nothing_is_invented_when_there_is_nothing_to_go_on(self):
        self.assertIsNone(run("T.locateError('a=1\\n', {message: 'something broke'})"))
        self.assertIsNone(run("T.locateError('a=1\\n', {message: 'zzz is not defined'})"))   # never appears
        self.assertIsNone(run("T.locateError('a=1\\n', null)"))

    def test_the_plumbing_is_cut_out_of_the_engines_message(self):
        self.assertEqual(
            run("T.cleanMessage(\"PineTS error: Failed to transpile Pine Script version 6: Unexpected character '@' at 3:7\")"),
            "Unexpected character '@'")
        self.assertEqual(run("T.cleanMessage('nope is not defined')"), "nope is not defined")


@unittest.skipUnless(NODE, "node is not installed")
class Inputs(unittest.TestCase):
    def test_an_untouched_script_hands_the_engine_nothing(self):
        self.assertEqual(run(f"T.overridesFor({json.dumps(METAS)}, {{}})"), {})

    def test_a_value_equal_to_its_default_is_not_an_override(self):
        store = {"len|Length|int": 14, "k|MA|string": "SMA", "c|Colour|color": "#2962ffff"}
        self.assertEqual(run(f"T.overridesFor({json.dumps(METAS)}, {json.dumps(store)})"), {})

    def test_changes_are_keyed_by_the_engines_id(self):
        store = {"len|Length|int": 5, "s|Show|bool": False, "k|MA|string": "EMA"}
        self.assertEqual(run(f"T.overridesFor({json.dumps(METAS)}, {json.dumps(store)})"),
                         {"in_0": 5, "in_2": False, "in_3": "EMA"})

    def test_numbers_are_clamped_to_their_own_range_and_integers_rounded(self):
        for raw, want in ((500, 200), (1, 2), (7.6, 8), ("9", 9)):
            got = run(f"T.coerce({json.dumps(INT)}, {json.dumps(raw)})")
            self.assertEqual(got, {"ok": True, "value": want}, raw)

    def test_an_unusable_value_is_refused_not_guessed(self):
        self.assertEqual(run(f"T.coerce({json.dumps(INT)}, '')"), {"ok": False})
        self.assertEqual(run(f"T.coerce({json.dumps(INT)}, 'abc')"), {"ok": False})
        self.assertEqual(run(f"T.coerce({json.dumps(CHOICE)}, 'WMA')"), {"ok": False})     # not one of the options
        self.assertEqual(run(f"T.coerce({json.dumps(COLOR)}, 'red')"), {"ok": False})

    def test_a_colour_keeps_its_alpha_form_and_is_upper_cased(self):
        self.assertEqual(run(f"T.coerce({json.dumps(COLOR)}, '#ff8800ff')"), {"ok": True, "value": "#FF8800FF"})

    def test_a_number_that_must_be_one_of_a_set_of_options_is_checked_against_them(self):
        meta = {"id": "in_9", "type": "int", "title": "Pick", "defval": 5, "options": [3, 5, 8]}
        self.assertEqual(run(f"T.coerce({json.dumps(meta)}, 8)"), {"ok": True, "value": 8})
        self.assertEqual(run(f"T.coerce({json.dumps(meta)}, 4)"), {"ok": False})

    def test_values_follow_an_input_across_edits_but_not_a_removed_or_retyped_one(self):
        store = {"len|Length|int": 5, "gone|Old|int": 3, "k|MA|bool": True}
        kept = run(f"T.reconcile({json.dumps(METAS)}, {json.dumps(store)})")
        self.assertEqual(kept, {"len|Length|int": 5})      # 'gone' was removed; 'k' is now a string input

    def test_the_key_survives_an_input_being_added_above_it(self):
        """The engine's ids are positions: in_0 becomes in_1. The key is the variable, label and type."""
        shifted = {**INT, "id": "in_1"}
        a = run(f"T.inputKey({json.dumps(INT)})")
        b = run(f"T.inputKey({json.dumps(shifted)})")
        self.assertEqual(a, b)

    def test_groups_keep_declaration_order_and_ungrouped_inputs_share_one(self):
        metas = [{**INT, "group": "Basis"}, FLT, {**BOOL, "group": "Basis"}, {**CHOICE, "group": "Style"}]
        got = run(f"T.groupInputs({json.dumps(metas)}).map(g => [g.name, g.items.map(i => i.id)])")
        self.assertEqual(got, [["Basis", ["in_0", "in_2"]], ["Inputs", ["in_1"]], ["Style", ["in_3"]]])

    def test_a_script_is_known_by_the_title_it_declares(self):
        self.assertEqual(run("T.declaredName(\"//@version=6\\nindicator('Smart Money', overlay=true)\")"), "Smart Money")
        self.assertEqual(run("T.declaredName('indicator(title=\"X y\", overlay=true)')"), "X y")
        self.assertEqual(run("T.declaredName('// indicator(\"commented out\")\\nplot(close)')"), "")

    def test_the_run_list_says_how_many_inputs_changed(self):
        self.assertEqual(run("[T.changedNote(0), T.changedNote(1), T.changedNote(3)]"),
                         ["", "1 input changed", "3 inputs changed"])


if __name__ == "__main__":
    unittest.main()
