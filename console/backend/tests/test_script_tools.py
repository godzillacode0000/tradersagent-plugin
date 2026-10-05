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


@unittest.skipUnless(NODE, "node is not installed")
class LostLineBreaks(unittest.TestCase):
    """A one-line script hides everything after its first `//`. The decision is made here, not in the pane."""

    COLLAPSED = "// © LuxAlgo\\n//@version=6\\nindicator('x', overlay=true)\\nplot(close)"

    def diagnose(self, src: str):
        return run(f"T.diagnoseBreaks({json.dumps(src)})")

    def test_the_documented_example_is_flagged_although_it_is_only_69_characters(self):
        """The PR #3 hand-off gave this string as the check; a length gate of 80 meant it never fired."""
        self.assertEqual(len(self.COLLAPSED), 69)
        got = self.diagnose(self.COLLAPSED)
        self.assertEqual(got["kind"], "escaped")
        self.assertEqual(got["fixed"], "// © LuxAlgo\n//@version=6\nindicator('x', overlay=true)\nplot(close)")

    def test_a_break_inside_a_string_literal_is_kept_as_written(self):
        src = "indicator('x')\\nlabel.new(0, 0, \"a\\nb\")\\nplot(close)"
        got = self.diagnose(src)
        self.assertEqual(got["fixed"], "indicator('x')\nlabel.new(0, 0, \"a\\nb\")\nplot(close)")

    def test_a_long_real_one_liner_with_a_newline_only_inside_a_string_is_not_flagged(self):
        """The old check looked for a backslash-n anywhere, so this valid script was flagged and the restore
        button would have broken its string."""
        src = 'plot(close, "A title that runs well past eighty characters so that the old length gate would have passed it\\n")'
        self.assertGreater(len(src), 80)
        self.assertEqual(self.diagnose(src), {"kind": None})

    def test_a_quote_mark_inside_the_collapsed_comment_does_not_swallow_the_rest(self):
        src = "// Smart Money's thing\\n//@version=6\\nindicator('x')\\nplot(close)"
        got = self.diagnose(src)
        self.assertEqual(got["fixed"], "// Smart Money's thing\n//@version=6\nindicator('x')\nplot(close)")

    def test_crlf_and_tab_escapes_are_restored_outside_strings_only(self):
        got = run("T.restoreBreaks('a = 1\\\\r\\\\nb = \"x\\\\ty\"\\\\n\\\\tc = 2')")
        self.assertEqual(got, {"text": "a = 1\nb = \"x\\ty\"\n\tc = 2", "count": 2})

    def test_anything_with_a_real_line_break_is_left_alone(self):
        self.assertEqual(self.diagnose("plot(close) // a\\nb\nplot(open)"), {"kind": None})

    def test_an_ordinary_short_one_liner_is_not_flagged(self):
        self.assertEqual(self.diagnose("plot(close)"), {"kind": None})
        self.assertEqual(self.diagnose(""), {"kind": None})

    def test_a_real_one_liner_whose_comment_swallows_the_declaration_is_flagged_but_has_no_fix(self):
        src = "// header text that is long enough to pass the length gate //@version=6 indicator(\"x\") plot(close) more words here"
        self.assertEqual(self.diagnose(src), {"kind": "swallowed"})

    def test_a_short_commented_one_liner_is_not_flagged_as_swallowed(self):
        self.assertEqual(self.diagnose("// just a note indicator(\"x\")"), {"kind": None})


AGENT_METAS = [
    {"id": "in_0", "type": "int", "title": "Length", "varId": "len", "defval": 20, "minval": 2, "maxval": 200, "group": "Basis"},
    {"id": "in_1", "type": "string", "title": "MA type", "varId": "kind", "defval": "SMA", "options": ["SMA", "EMA"]},
    {"id": "in_2", "type": "float", "title": "Multiplier", "varId": "mult", "defval": 2, "minval": 0.1},
    {"id": "in_3", "type": "bool", "title": "Show upper band", "varId": "show", "defval": True},
    {"id": "in_4", "type": "color", "title": "Basis colour", "varId": "col", "defval": "#2962FFFF"},
]


def resolve(given):
    return run(f"T.resolveInputs({json.dumps(AGENT_METAS)}, {json.dumps(given)})")


@unittest.skipUnless(NODE, "node is not installed")
class AgentInputs(unittest.TestCase):
    """What the agent sends ({"Length": 50}) against the script's own declarations: matched by label, checked
    like the Settings panel checks the operator's values, and every refusal says why and what exists."""

    def test_a_label_a_case_variant_a_variable_name_and_an_engine_id_all_find_the_input(self):
        for name in ("Length", "length", "  LENGTH ", "len", "LEN", "in_0"):
            got = resolve({name: 50})
            self.assertEqual(got["overrides"], {"in_0": 50}, name)
            self.assertEqual(got["ignored"], [], name)

    def test_only_what_differs_from_a_default_is_handed_to_the_engine(self):
        got = resolve({"Length": 20, "MA type": "SMA", "Multiplier": 3})
        self.assertEqual(got["overrides"], {"in_2": 3})
        self.assertEqual([a["name"] for a in got["applied"]], ["Length", "MA type", "Multiplier"])   # all matched

    def test_the_keyed_form_is_the_panels_own_key(self):
        got = resolve({"Length": 50})
        self.assertEqual(got["keyed"], {"len|Length|int": 50})

    def test_null_puts_an_input_back_to_its_default(self):
        got = resolve({"Length": None})
        self.assertEqual(got["overrides"], {})
        self.assertEqual(got["applied"][0]["note"], "back to the default")

    def test_a_number_is_limited_to_the_inputs_range_and_the_answer_says_so(self):
        got = resolve({"Length": 9999})
        self.assertEqual(got["overrides"], {"in_0": 200})
        self.assertIn("asked for 9999, limited to 200", got["applied"][0]["note"])

    def test_a_fraction_for_a_whole_number_input_is_rounded_and_said_so(self):
        got = resolve({"Length": 7.6})
        self.assertEqual(got["overrides"], {"in_0": 8})
        self.assertEqual(got["applied"][0]["note"], "rounded from 7.6")

    def test_a_numeric_string_is_read_as_a_number(self):
        self.assertEqual(resolve({"Multiplier": " 3.5 "})["overrides"], {"in_2": 3.5})

    def test_a_booleans_words_are_strict(self):
        self.assertEqual(resolve({"Show upper band": "false"})["overrides"], {"in_3": False})
        self.assertEqual(resolve({"Show upper band": 0})["overrides"], {"in_3": False})
        got = resolve({"Show upper band": "no"})
        self.assertEqual(got["overrides"], {})
        self.assertEqual(got["ignored"][0]["reason"], "must be true or false")

    def test_a_choice_must_be_one_of_its_options(self):
        got = resolve({"MA type": "WMA"})
        self.assertEqual(got["overrides"], {})
        self.assertEqual(got["ignored"][0]["reason"], "must be one of: SMA, EMA")

    def test_a_six_digit_colour_takes_the_defaults_alpha_and_junk_is_refused(self):
        self.assertEqual(resolve({"Basis colour": "#ff8800"})["overrides"], {"in_4": "#FF8800FF"})
        self.assertEqual(resolve({"Basis colour": "#ff880080"})["overrides"], {"in_4": "#FF880080"})
        self.assertIn("colour like #2962FF", resolve({"Basis colour": "red"})["ignored"][0]["reason"])

    def test_a_value_that_is_not_a_scalar_is_refused(self):
        for bad in ({"a": 1}, [1, 2]):
            got = resolve({"Length": bad})
            self.assertEqual(got["overrides"], {}, bad)
            self.assertEqual(len(got["ignored"]), 1, bad)

    def test_an_unknown_label_is_refused_with_a_suggestion_when_one_is_close(self):
        got = resolve({"Lenght": 10})
        self.assertEqual(got["overrides"], {})
        self.assertEqual(got["ignored"][0]["reason"], 'this script has no input called that \u2014 did you mean "Length"?')
        far = resolve({"Banana": 1})["ignored"][0]["reason"]
        self.assertEqual(far, "this script has no input called that")

    def test_the_same_input_named_twice_is_set_once(self):
        got = resolve({"Length": 30, "len": 40})
        self.assertEqual(got["overrides"], {"in_0": 30})
        self.assertIn("already set", got["ignored"][0]["reason"])

    def test_two_inputs_with_one_label_are_ambiguous_and_neither_is_guessed(self):
        twin = AGENT_METAS + [{"id": "in_5", "type": "int", "title": "Length", "varId": "len2", "defval": 9}]
        got = run(f"T.resolveInputs({json.dumps(twin)}, {{ Length: 5 }})")
        self.assertEqual(got["overrides"], {})
        self.assertIn("2 inputs are called that", got["ignored"][0]["reason"])
        self.assertIn("len2", got["ignored"][0]["reason"])
        # ...and either is reachable by its variable name
        self.assertEqual(run(f"T.resolveInputs({json.dumps(twin)}, {{ len2: 5 }})")["overrides"], {"in_5": 5})

    def test_a_refusal_never_blocks_the_rest(self):
        got = resolve({"Length": 50, "Nope": 1, "MA type": "EMA"})
        self.assertEqual(got["overrides"], {"in_0": 50, "in_1": "EMA"})
        self.assertEqual([i["name"] for i in got["ignored"]], ["Nope"])

    def test_every_declared_input_is_described_for_the_agent(self):
        got = resolve({})
        self.assertEqual([a["name"] for a in got["available"]], ["Length", "MA type", "Multiplier", "Show upper band", "Basis colour"])
        length = got["available"][0]
        self.assertEqual((length["type"], length["default"], length["min"], length["max"], length["group"]),
                         ("int", 20, 2, 200, "Basis"))
        self.assertEqual(got["available"][1]["options"], ["SMA", "EMA"])

    def test_the_one_line_summaries(self):
        got = resolve({"Length": 50, "Show upper band": False, "MA type": "EMA", "Nope": 1})
        self.assertEqual(run(f"T.appliedLine({json.dumps(got['applied'])})"), 'Length=50, Show upper band=false, MA type="EMA"')
        said = run(f"T.ignoredLine({json.dumps(got['ignored'])}, {json.dumps(got['available'])})")
        self.assertTrue(said.startswith('"Nope": this script has no input called that \u2014 this script has: Length (int, default 20)'), said)
        self.assertEqual(run("T.ignoredLine([], [])"), "")

    def test_a_range_reads_naturally_with_one_end_or_both(self):
        self.assertEqual(run(f"T.describeInput({json.dumps(AGENT_METAS[0])})"), "Length (int, default 20, 2-200)")
        self.assertEqual(run(f"T.describeInput({json.dumps(AGENT_METAS[2])})"), "Multiplier (float, default 2, min 0.1)")
        self.assertEqual(run(f"T.describeInput({json.dumps(AGENT_METAS[1])})"), 'MA type (string, default "SMA", one of SMA/EMA)')

    def test_near_misses_are_found_but_unrelated_words_are_not(self):
        for typo, want in (("Lenght", "Length"), ("Multipler", "Multiplier"), ("show band", "Show upper band"), ("len gth", "Length")):
            self.assertEqual(run(f"(T.nearestInput({json.dumps(AGENT_METAS)}, {json.dumps(typo)}) || {{}}).title"), want, typo)
        for far in ("Banana", "x", "zzzzzz"):
            self.assertIsNone(run(f"T.nearestInput({json.dumps(AGENT_METAS)}, {json.dumps(far)})"), far)


if __name__ == "__main__":
    unittest.main()
