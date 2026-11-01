"""UI polish pass (1 Nov): what a sweep of every surface found, at 1280 px and the 620 px Hermes pane, dark and light.

Each test names what was wrong on screen; the fix is pinned by its source shape.
"""

import re
import unittest
from pathlib import Path

FRONT = Path(__file__).resolve().parents[2] / "frontend"
APP = (FRONT / "app.js").read_text(encoding="utf-8")
DRAWER = (FRONT / "drawer.js").read_text(encoding="utf-8")
DESK = (FRONT / "desk.js").read_text(encoding="utf-8")
DESK_CSS = (FRONT / "desk.css").read_text(encoding="utf-8")
CSS = (FRONT / "styles.css").read_text(encoding="utf-8")
HTML = (FRONT / "index.html").read_text(encoding="utf-8")


class TheNarrowPane(unittest.TestCase):
    def test_the_floating_strip_stays_off_when_velas_compact_bar_is_there(self):
        # "Scripts / <> Script / Full screen" floated over the second chart's symbol and price scale, though
        # Vela's compact bar already had all three (its Indicators icon, and Script / Full screen in its ⋮ sheet)
        self.assertIn("shownOnScreen('.vela-widget-topbar') || shownOnScreen('.vela-mb-more')", APP)
        self.assertIn("shown('.vela-widget-topbar') || shown('.vela-mb-indicators')", DRAWER)

    def test_the_replay_capsule_clears_the_time_axis(self):
        self.assertIn("@media (max-width: 640px) { .ta-replay:not(.ta-replay--free) { bottom: 92px; } }", CSS)

    def test_the_replay_drag_handle_is_a_real_target(self):
        rule = re.search(r"\.ta-replay__drag \{([^}]*)\}", CSS).group(1)
        self.assertIn("min-width: 24px", rule)

    def test_no_dead_band_under_the_stacked_script_pane(self):
        self.assertIn('.main[data-detail="on"] { grid-template-rows: minmax(0, 1fr) auto; }', CSS)


class TheEditorFooter(unittest.TestCase):
    def test_the_caret_position_has_room(self):
        # "Ln 31, C…" was cut at desktop width: the theme picker and the size control are a little narrower
        self.assertIn("max-width: 108px", re.search(r"\.script__themesel \{([^}]*)\}", CSS).group(1))


class TheDesk(unittest.TestCase):
    def test_an_offline_library_is_said_in_plain_words(self):
        self.assertIn("The prop-firm directory comes from the LuxAlgo Library, which isn\\'t connected right now.", DESK)
        self.assertIn("Prop firms aren't available right now", DESK)

    def test_an_empty_tick_store_is_a_setup_card_with_a_copyable_command(self):
        self.assertIn("const FX_FETCH = 'python3 tools/fx-fetch.py --years 2';", DESK)
        self.assertIn('data-copy="${esc(FX_FETCH)}"', DESK)
        self.assertIn("navigator.clipboard.writeText(copyBtn.dataset.copy)", DESK)
        self.assertIn(".desk__setup {", DESK_CSS)
        self.assertEqual(re.findall(r"#[0-9a-fA-F]{3,8}\b", DESK_CSS.split(".desk__setup {", 1)[1].split(".desk__cmd code", 1)[0]), [])

    def test_the_journal_note_has_no_row_of_dashes_when_empty(self):
        self.assertIn("const extremes = trades.length", DESK)


class ThePanel(unittest.TestCase):
    def test_the_footer_hint_is_one_line_and_the_rule_moved_to_the_buttons(self):
        note = re.search(r'<p class="drawer__note muted">(.*?)</p>', HTML).group(1)
        self.assertNotIn("paints one LuxAlgo script", note)
        self.assertIn("Run: one LuxAlgo script at a time, it replaces the last", DRAWER)
        self.assertIn("Add: built-ins stack beside what is on the chart", DRAWER)


if __name__ == "__main__":
    unittest.main()
