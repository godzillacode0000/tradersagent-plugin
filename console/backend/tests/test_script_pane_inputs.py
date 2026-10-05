"""The script pane's inputs, error marks and shortcut (5 Oct) — wiring pinned as source shape. The pure
decisions are executed in test_script_tools.py, the engine's side of the contract in
test_pine_inputs_engine.py, and the whole flow was driven in Chromium (Settings -> change -> the chart
re-runs with the new value; a syntax error and a name error marked on their lines; Ctrl+Enter; Esc closes
Settings before the pane; values survive a reload) with no page errors.
"""

import re
import unittest
from pathlib import Path

FRONT = Path(__file__).resolve().parents[3] / "console" / "frontend"
read = lambda n: (FRONT / n).read_text(encoding="utf-8")
HTML, CSS, APP = read("index.html"), read("styles.css"), read("app.js")
WORKER, RUNNER, UNIFIED = read("pinets-worker.js"), read("pinets-runner.js"), read("unified.js")
BLOCK = APP.split("// Script pane (restored 23 Sep)", 1)[1].split("// Theme: one button", 1)[0]
PANE_CSS = CSS[CSS.index(".script__bar {"):CSS.index("/* The legend must NOT set `display`")]


class Engine(unittest.TestCase):
    def test_the_worker_answers_an_inputs_scan_without_running_the_script(self):
        body = WORKER.split("if (msg.type === 'inputs') {", 1)[1].split("return;", 1)[0]
        self.assertIn("new mod.Indicator(", body)
        self.assertIn("getInputsMeta()", body)
        self.assertNotIn(".run(", body)

    def test_changed_inputs_ride_in_on_an_indicator_and_an_untouched_script_is_run_from_source(self):
        self.assertRegex(WORKER, r"changed \? new mod\.Indicator\(msg\.source, msg\.inputs\) : msg\.source")
        self.assertRegex(RUNNER, r"typeof mod\.Indicator === 'function'\s*\?\s*new mod\.Indicator\(source, opts\.inputs\) : source")

    def test_the_runner_hands_the_inputs_to_the_worker_and_exposes_the_scan(self):
        self.assertIn("workerRun(source, bars, ctx, timeoutMs, label, opts.inputs)", RUNNER)
        self.assertIn("inputs: inputs || null", RUNNER)
        self.assertRegex(RUNNER, r"window\.PineTSRunner = \{[^}]*scanInputs")

    def test_a_scan_has_a_deadline_and_is_always_terminated(self):
        body = RUNNER.split("function scanInputs(source) {", 1)[1].split("window.PineTSRunner", 1)[0]
        self.assertIn("setTimeout(() => finish({ ok: false, reason: 'scan timed out' }), 8000)", body)
        self.assertIn("worker.terminate()", body)

    def test_every_run_path_carries_the_inputs_through_unified(self):
        self.assertIn("inputs: (opts && opts.inputs) || null", UNIFIED)
        # remember() stores opts whole, so a reload and a market re-run keep the operator's values
        self.assertIn("opts: opts || null", UNIFIED)


class Errors(unittest.TestCase):
    def test_a_syntax_error_is_its_own_code_with_a_line_and_column(self):
        self.assertIn("code: 'SYNTAX_ERROR'", RUNNER)
        self.assertRegex(RUNNER, r"SYNTAX_ERROR', message: text, line: quotedLine\(text\), col: quotedCol\(text\)")

    def test_the_engines_position_form_is_read(self):
        self.assertIn("at ([0-9]{1,6}):[0-9]{1,6}", RUNNER)    # quotedLine: `at 3:7`
        self.assertIn("at [0-9]{1,6}:([0-9]{1,6})", RUNNER)    # quotedCol

    def test_the_pine_method_of_a_runtime_error_reaches_the_pane(self):
        self.assertIn("method: err && err.method ? String(err.method) : undefined", WORKER)
        self.assertIn("if (d.method) error.method = d.method", RUNNER)

    def test_a_failed_run_marks_its_line_and_says_when_it_is_a_guess(self):
        body = BLOCK.split("const doRun = async () => {", 1)[1]
        self.assertIn("ST.locateError(source, err || r.reason)", body)
        self.assertIn("likely line", body)
        self.assertIn("showErrorAt(loc.line)", body)

    def test_editing_clears_the_mark_and_go_to_line_selects_the_row(self):
        self.assertRegex(BLOCK, r"srcBox\.addEventListener\('input', \(\) => \{ clearError\(\);")
        goto = BLOCK.split("const goToLine = (line) => {", 1)[1].split("\n  };", 1)[0]
        self.assertIn("srcBox.setSelectionRange(start, start + rows[n - 1].length)", goto)

    def test_the_row_tints_never_catch_a_click(self):
        self.assertIn("pointer-events: none", re.search(r"\.script__mark \{[^}]*\}", CSS).group(0))


class Shortcut(unittest.TestCase):
    def test_ctrl_or_cmd_enter_runs_from_anywhere_in_the_pane(self):
        body = BLOCK.split("paneEl.addEventListener('keydown'", 1)[1].split("});", 1)[0]
        self.assertIn("ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)", body)
        self.assertIn("runBtn.click()", body)

    def test_the_run_tooltip_names_the_shortcut_for_the_platform(self):
        self.assertIn("(Ctrl+Enter)", HTML)
        self.assertIn("'⌘' : 'Ctrl+'", BLOCK)

    def test_a_change_made_mid_run_is_applied_once_after_it(self):
        self.assertIn("if (running) { runQueued = true; return; }", BLOCK)
        self.assertIn("if (runQueued) { runQueued = false; doRun(); }", BLOCK)


class Settings(unittest.TestCase):
    def test_the_view_is_markup_and_the_inputs_button_starts_hidden(self):
        self.assertIn('id="script-settings"', HTML)
        self.assertIn('id="script-settings-body"', HTML)
        self.assertRegex(HTML, r'id="script-gear"[^>]*\bhidden\b')
        self.assertLess(HTML.index('src="./script-tools.js"'), HTML.index('src="./app.js"'))

    def test_the_view_takes_the_editors_place_and_never_adds_height(self):
        self.assertRegex(CSS, r"\.script\.is-settings \.script__edit,\s*\.script\.is-scripts \.script__edit,\s*\.script\.is-scripts \.script__settings \{ display: none; \}")
        self.assertRegex(CSS, r"\.script\.is-settings \.script__out,\s*\.script\.is-scripts \.script__out \{ display: none; \}")

    def test_one_escape_closes_one_layer_drawer_then_settings_then_the_pane(self):
        """The behaviour is run in test_escape_layers.py; this pins that the pane block adds no second
        Escape handler (the one that used to hold the drawer check was never reached with the pane open)."""
        esc = APP.split("function escapeKeydown(ev) {", 1)[1].split("\n}\n", 1)[0]
        self.assertLess(esc.index("closeDrawerIfOpen"), esc.index("closeScriptLayerIfOpen"))
        self.assertLess(esc.index("closeScriptLayerIfOpen"), esc.index("setPanel('detail', false)"))
        self.assertNotIn("'Escape'", BLOCK.replace("Escape: see escapeKeydown", ""))
        # any view that holds the editor's place (Settings, the saved scripts) steps back to the editor first
        self.assertIn("window.closeScriptLayerIfOpen = () => { if (view === 'editor') return false; setView('editor'); return true; };", BLOCK)

    def test_values_go_through_coerce_so_nothing_unchecked_reaches_the_engine(self):
        commit = BLOCK.split("const commit = (raw) => {", 1)[1].split("};", 1)[0]
        self.assertIn("ST.overridesFor([meta], { [key]: raw })", commit)

    def test_while_typing_only_an_in_range_number_counts(self):
        body = BLOCK.split("t === 'int' || t === 'float' || t === 'price'", 1)[1].split("} else if (t === 'time')", 1)[0]
        self.assertIn("if (inRange) commit(field.value)", body)
        self.assertIn("addEventListener('change'", body)        # clamped on leaving the field

    def test_a_script_does_not_inherit_another_scripts_values(self):
        body = BLOCK.split("const applyMeta = (metas) => {", 1)[1].split("\n  };", 1)[0]
        self.assertIn("ST.declaredName(srcBox.value)", body)
        self.assertIn("if (declared !== storeFor) { inputStore = {}; storeFor = declared; }", body)

    def test_a_source_that_does_not_parse_does_not_cost_the_operator_their_values(self):
        body = BLOCK.split("const scan = async () => {", 1)[1].split("\n  };", 1)[0]
        # the store is reconciled only inside the success branch
        self.assertIn("if (r.ok) applyMeta(r.inputs || []); else { inputsMeta = [];", body)

    def test_a_run_straight_after_an_edit_waits_for_the_scan_that_re_reads_the_ids(self):
        self.assertIn("if (Object.keys(inputStore).length && scanDirty) await scan();", BLOCK)

    def test_values_survive_a_reload_with_the_draft(self):
        self.assertIn("inputs: inputStore, inputsFor: storeFor", BLOCK)
        self.assertIn("draft.inputs", BLOCK)

    def test_nothing_the_script_or_the_engine_says_reaches_innerHTML(self):
        code = re.sub(r"/\*.*?\*/", "", BLOCK, flags=re.S)
        self.assertNotIn("innerHTML", code)

    def test_the_pane_css_uses_tokens_only(self):
        self.assertEqual(re.findall(r"#[0-9a-fA-F]{3,8}\b", PANE_CSS), [])

    def test_the_switch_moves_transform_and_background_only(self):
        for rule in re.findall(r"\.set__(?:switch|knob) \{[^}]*\}", PANE_CSS):
            for prop in re.findall(r"transition:\s*([^;]+);", rule):
                self.assertNotRegex(prop, r"\ball\b")
                names = set(re.findall(r"(?:^|,)\s*([a-z-]+)\s", prop))
                self.assertLessEqual(names, {"transform", "background"}, rule)


if __name__ == "__main__":
    unittest.main()
