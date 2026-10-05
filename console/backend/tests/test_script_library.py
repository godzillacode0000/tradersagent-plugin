"""The saved-scripts list in the script pane — wiring pinned as source shape. The rules themselves (what Save,
Rename, Open, Delete mean) are executed under Node in test_script_store.py; the view was driven in Chromium:
save -> the list -> open -> the settings values come back -> edit shows the "unsaved" dot -> Ctrl+S overwrites
-> a new name is a new script -> Ctrl+Shift+S makes "(2)" -> opening with unsaved changes asks -> rename (a
taken name is refused, Esc cancels) -> delete asks first -> a reload keeps the list and the editor, no page
errors.
"""

import re
import unittest
from pathlib import Path

FRONT = Path(__file__).resolve().parents[3] / "console" / "frontend"
read = lambda n: (FRONT / n).read_text(encoding="utf-8")
HTML, CSS, APP, BRIDGE, LIB = read("index.html"), read("styles.css"), read("app.js"), read("chart-bridge.js"), read("script-library.js")
HTML_CODE = re.sub(r"<!--.*?-->", "", HTML, flags=re.S)
LIB_CODE = re.sub(r"/\*.*?\*/", "", LIB, flags=re.S)
BLOCK = APP.split("// Script pane (restored 23 Sep)", 1)[1].split("// Theme: one button", 1)[0]
SV_CSS = CSS[CSS.index("/* ── Saved scripts: the list in the editor's place"):CSS.index("/* The runs block: one status line")]
API = BLOCK.split("Object.assign(window.scriptPane, {", 1)[1].split("\n  });\n", 1)[0]


class Markup(unittest.TestCase):
    def test_the_button_the_view_and_their_hooks_exist_and_the_view_starts_hidden(self):
        for ident in ("script-lib-btn", "script-lib", "script-lib-list", "script-lib-title", "script-lib-now",
                      "script-lib-bar", "script-lib-new", "script-lib-copy", "script-lib-save"):
            self.assertIn(f'id="{ident}"', HTML_CODE)
        self.assertRegex(HTML_CODE, r'id="script-lib"[^>]*\bhidden\b')
        self.assertRegex(HTML_CODE, r'id="script-lib-copy"[^>]*\bhidden\b')       # a copy needs a script that is open
        self.assertRegex(HTML_CODE, r'id="script-lib-bar"[^>]*role="alert"')

    def test_the_action_bar_gains_one_control_and_run_stays_the_loudest(self):
        bar = HTML_CODE.split('class="script__bar"', 1)[1].split("</div>", 1)[0]
        self.assertEqual(re.findall(r'id="([\w-]+)"', bar), ["script-name", "script-lib-btn", "script-gear", "script-run", "script-close"])

    def test_the_scripts_load_in_the_right_order(self):
        order = [HTML.index(f'src="./{n}"') for n in ("script-tools.js", "script-store.js", "app.js", "script-library.js")]
        self.assertEqual(order, sorted(order))


class ThePanesHands(unittest.TestCase):
    def test_the_pane_exposes_exactly_what_the_list_and_the_other_doors_need(self):
        for name in ("working", "settled:", "load:", "setName:", "view:", "setView"):
            self.assertIn(name, API)

    def test_load_resets_what_belongs_to_the_old_script_and_says_what_was_loaded(self):
        load = API.split("load: (spec, attachId) => {", 1)[1].split("\n    },\n", 1)[0]
        for needle in ("inputStore = {};", "lastRunSource = null;", "clearError();", "setView('editor');",
                       "checkBreaks();", "scheduleScan(200)", "saveDraft();", "'scriptpane:loaded'", "attachId: attachId || null"):
            self.assertIn(needle, load)
        self.assertIn("Loaded \\u201c", load)                         # the status line stops describing the last script

    def test_a_change_of_any_kind_announces_itself_so_the_unsaved_dot_stays_true(self):
        draft = BLOCK.split("function saveDraft() {", 1)[1].split("\n  }\n", 1)[0]
        self.assertIn("new Event('scriptpane:changed')", draft)

    def test_three_views_hold_the_editors_place_and_escape_steps_back(self):
        view = BLOCK.split("const setView = (name) => {", 1)[1].split("\n  };\n", 1)[0]
        self.assertIn("classList.toggle('is-scripts'", view)
        self.assertIn("classList.toggle('is-settings'", view)
        self.assertIn("'scriptpane:view'", view)
        self.assertIn(".script.is-scripts .script__edit", CSS)

    def test_the_other_doors_put_a_script_in_through_load_not_through_the_textarea(self):
        self.assertIn("window.scriptPane.load({ source, name: copyName })", APP)            # the Library's "Edit a copy"
        self.assertIn("sp.load({ source: pine })", BRIDGE)                                  # the agent's `show`

    def test_settled_waits_for_the_scan_only_when_there_are_values_to_translate(self):
        self.assertIn("settled: async () => { if (Object.keys(inputStore).length && scanDirty) await scan(); return working(); }", API)


class TheView(unittest.TestCase):
    def test_nothing_typed_by_the_operator_reaches_innerHTML(self):
        self.assertNotIn("innerHTML", LIB_CODE)
        self.assertNotIn("insertAdjacentHTML", LIB_CODE)

    def test_no_browser_dialog_is_used_the_questions_are_inline(self):
        for forbidden in ("confirm(", "prompt(", "alert("):
            self.assertNotIn(forbidden, LIB_CODE)

    def test_a_write_the_browser_refuses_is_reverted_and_said(self):
        commit = LIB.split("function commit(next) {", 1)[1].split("\n  }\n", 1)[0]
        self.assertIn("localStorage.setItem(KEY, S.serialize(store))", commit)
        self.assertIn("store = before;", commit)
        self.assertIn("nothing was saved", commit)

    def test_save_goes_through_the_stores_rules_and_fixes_the_name_field(self):
        save = LIB.split("async function saveWorking(asNew) {", 1)[1].split("\n  }\n", 1)[0]
        self.assertIn("await sp().settled()", save)
        self.assertIn("S.save(store, w, { asNew })", save)
        self.assertIn("sp().setName(r.item.name)", save)             # a numbered name shows in the field too
        self.assertIn("(that name was taken)", save)

    def test_opening_or_starting_over_asks_only_when_work_would_be_lost_and_inside_the_list(self):
        self.assertIn("S.needsSaving(store, w)", LIB)
        for label in ("'Save and '", "'Discard and '", "'Cancel'", "Discard changes"):
            self.assertIn(label, LIB)
        self.assertIn("pending = { kind: 'open', id }", LIB)
        self.assertIn("pending = { kind: 'new', id: null }", LIB)
        self.assertIn("pending = { kind: 'revert', id }", LIB)       # reopening the open script with edits would discard them

    def test_a_save_and_open_only_opens_if_the_save_worked(self):
        self.assertIn("const r = await saveWorking(false); if (r && r.ok) proceed();", LIB)

    def test_ctrl_or_cmd_s_saves_and_shift_makes_a_copy_from_anywhere_in_the_pane(self):
        key = LIB.split("pane.addEventListener('keydown'", 1)[1].split("});", 1)[0]
        self.assertIn("(ev.ctrlKey || ev.metaKey)", key)
        self.assertIn("ev.preventDefault()", key)                    # the browser's "save page" must not open
        self.assertIn("saveWorking(ev.shiftKey && Boolean(S.active(store)))", key)

    def test_rename_commits_on_enter_cancels_on_escape_and_that_escape_goes_no_further(self):
        rename = LIB.split("input.addEventListener('keydown'", 1)[1].split("});", 1)[0]
        self.assertIn("ev.key === 'Enter'", rename)
        self.assertIn("ev.key === 'Escape'", rename)
        self.assertIn("ev.stopPropagation()", rename)                # so the pane stays open under the list

    def test_a_delete_asks_first_with_words_that_name_the_script_and_the_consequence(self):
        self.assertIn("? This can\u2019t be undone.", LIB)
        self.assertIn("'Delete script'", LIB)
        self.assertIn("'Keep'", LIB)

    def test_another_console_view_that_saves_is_picked_up(self):
        self.assertIn("window.addEventListener('storage'", LIB)
        self.assertIn("ev.key !== KEY", LIB)

    def test_a_loaded_script_attaches_the_list_to_it_or_to_nothing(self):
        loaded = LIB.split("window.addEventListener('scriptpane:loaded'", 1)[1].split("});", 1)[0]
        self.assertIn("S.setActive(store, attach || null)", loaded)

    def test_the_empty_state_says_what_this_is_and_how_to_start(self):
        self.assertIn("Nothing saved yet. Save the script in the editor to keep its code and its settings here.", LIB)


class Styling(unittest.TestCase):
    def test_tokens_only(self):
        self.assertEqual(re.findall(r"#[0-9a-fA-F]{3,8}\b", SV_CSS), [])

    def test_the_rows_are_hairlines_not_cards(self):
        row = re.search(r"\.sv__row \{([^}]*)\}", SV_CSS).group(1)
        self.assertIn("border-top: 1px solid var(--lx-border)", row)
        self.assertNotIn("box-shadow", row)
        self.assertNotIn("border-radius", row)

    def test_meta_is_mono_and_nothing_animates(self):
        meta = re.search(r"\.sv__meta \{([^}]*)\}", SV_CSS).group(1)
        self.assertIn("var(--lx-font-mono)", meta)
        self.assertNotIn("transition", SV_CSS)
        self.assertNotIn("animation", SV_CSS)

    def test_the_unsaved_dot_is_amber_so_it_is_not_mistaken_for_the_inputs_dot(self):
        dot = re.search(r"\.script__lib-btn\[data-dirty\]::after \{([^}]*)\}", CSS).group(1)
        self.assertIn("var(--lx-warn)", dot)


if __name__ == "__main__":
    unittest.main()
