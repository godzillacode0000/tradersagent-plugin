"""Two views of the indicators, one door (31 Oct).

The operator picked both mock-ups and kept both: the quick-add dropdown ("Quick", picker.js) is what
the Indicators button opens by default, and the slide-in panel ("Panel", drawer.js) is the other view.
Each carries a switch to the other, and the choice is remembered. Neither owns data or actions: the
dropdown reads the drawer's rows and acts through the drawer, so a run is the same run from either.
"""

import re
import unittest
from pathlib import Path

FRONT = Path(__file__).resolve().parents[2] / "frontend"
PICKER = (FRONT / "picker.js").read_text(encoding="utf-8")
DRAWER = (FRONT / "drawer.js").read_text(encoding="utf-8")
WS = (FRONT / "workspace.js").read_text(encoding="utf-8")
APP = (FRONT / "app.js").read_text(encoding="utf-8")
HTML = (FRONT / "index.html").read_text(encoding="utf-8")
CSS = (FRONT / "styles.css").read_text(encoding="utf-8")


class OneDoorTwoViews(unittest.TestCase):
    def test_the_picker_loads_after_the_drawer(self):
        self.assertLess(HTML.index('src="./drawer.js"'), HTML.index('src="./picker.js"'))

    def test_the_indicators_button_opens_the_chosen_view(self):
        self.assertIn("window.taIndicators.toggle()", WS)
        self.assertIn("window.libDrawer.toggle()", WS, "without picker.js the panel is still the door")

    def test_quick_is_the_default(self):
        self.assertIn("read(VIEW_KEY, 'quick') === 'panel' ? 'panel' : 'quick'", PICKER)

    def test_the_choice_is_remembered(self):
        self.assertIn("const VIEW_KEY = 'ta-indicators-view'", PICKER)
        self.assertIn("write(VIEW_KEY", PICKER)

    def test_each_view_switches_to_the_other(self):
        self.assertIn('data-view="panel"', PICKER)
        self.assertIn("switchToPanel", PICKER)
        self.assertIn('data-view="quick"', HTML)
        self.assertIn("window.taIndicators.setView('quick')", DRAWER)

    def test_the_narrow_panes_scripts_button_follows_the_choice_too(self):
        block = DRAWER[DRAWER.index("if (fallback) fallback.addEventListener('click'"):][:300]
        self.assertIn("window.taIndicators.toggle()", block)


class TheDropdownOwnsNothing(unittest.TestCase):
    def test_rows_and_actions_come_from_the_drawer(self):
        self.assertIn("window.libDrawer.items()", PICKER)
        self.assertIn("window.libDrawer.act(", PICKER)
        self.assertNotIn("api('/api/source'", PICKER, "a run must go through the drawer's one run path")
        self.assertIn("items, act,", DRAWER)

    def test_the_drawer_still_writes_no_storage(self):
        # favourites have one store (app.js); recents and the view live in picker.js
        self.assertNotIn("localStorage.setItem", DRAWER)


class WhatItShows(unittest.TestCase):
    def test_yours_first(self):
        for cat in ("'recent'", "'fav'", "'on'", "'all'", "'builtin'"):
            self.assertIn(cat, PICKER)
        self.assertIn("st.cat = recent().length ? 'recent' : 'all'", PICKER)

    def test_a_run_is_remembered_for_recent(self):
        self.assertIn("ti().noteRecent(slug)", DRAWER)
        self.assertIn("noteRecent('builtin:' + nat.type)", DRAWER)

    def test_the_panel_groups_on_chart_and_recent_first(self):
        for label in ("'On chart · '", "'Recently used'", "'All scripts'"):
            self.assertIn(label, DRAWER)

    def test_initials_find_the_classic(self):
        # "rsi" is Relative Strength Index before Connors RSI
        self.assertIn("initials(x.name) === q.replace", PICKER)

    def test_matches_are_highlighted_safely(self):
        self.assertIn("'<mark>' + esc(", PICKER)

    def test_luxalgo_scripts_say_run_and_built_ins_say_add(self):
        # one LuxAlgo script at a time replaces the last; a built-in stacks — the words must not blur that
        self.assertIn("ICON.run + 'Run'", PICKER)
        self.assertIn("ICON.plus + 'Add'", PICKER)
        self.assertIn("r.__native ? 'Add' : 'Run'", DRAWER)


class ItBehaves(unittest.TestCase):
    def test_keyboard(self):
        for key in ("'ArrowDown'", "'ArrowUp'", "'Enter'", "'ArrowRight'", "'Escape'"):
            self.assertIn(key, PICKER)
        for key in ("'ArrowDown'", "'ArrowUp'", "'ArrowRight'"):
            self.assertIn(key, DRAWER)

    def test_escape_reaches_it_from_anywhere(self):
        self.assertIn("window.closePickerIfOpen", PICKER)
        self.assertLess(APP.index("window.closePickerIfOpen()"), APP.index("window.closeDrawerIfOpen()"))

    def test_it_is_a_listbox_for_screen_readers(self):
        self.assertIn('role="listbox"', PICKER)
        self.assertIn('role="option"', PICKER)
        self.assertIn("aria-activedescendant", PICKER)

    def test_the_global_search_style_does_not_draw_inside_it(self):
        self.assertIn('.qp__search input[type="search"]:focus', CSS)

    def test_motion_is_opacity_and_transform(self):
        rule = re.search(r"\.qp \{([^}]*)\}", CSS).group(1)
        self.assertIn("transition: opacity", rule)
        self.assertNotRegex(rule, r"transition:[^;]*\b(width|height|top|left)\b")
        self.assertIn(".qp { transition: none; }", CSS)

    def test_a_narrow_pane_gets_chips_and_no_preview(self):
        self.assertIn(".qp.is-narrow .qp__prev", CSS)
        self.assertIn("el.classList.toggle('is-narrow', narrow)", PICKER)


if __name__ == "__main__":
    unittest.main()


class EveryBuiltInHasARealPreview(unittest.TestCase):
    """31 Oct, the operator: "there must be preview of each indicator". Vela ships no picture for its
    built-ins, so each preview is the study itself — its own descriptor's compute(), default inputs, on
    the open chart's last bars. Nothing is fetched and nothing is drawn by hand."""

    def test_the_preview_runs_the_studys_own_maths(self):
        self.assertIn("v.getNativeIndicator(type)", PICKER)
        self.assertIn("d.create().spec.compute(bars, d.defaultInputs ? d.defaultInputs() : {})", PICKER)
        self.assertIn("window.chartBars()", PICKER)

    def test_overlays_and_oscillators_are_drawn_differently(self):
        self.assertIn("const sub = !r.overlay", PICKER)
        for part in ("out.bands", "out.levels", "out.polylines", "'columns'"):
            self.assertIn(part, PICKER)

    def test_volume_and_the_profile_come_from_the_candles(self):
        self.assertIn("r.type === 'vpvr'", PICKER)
        self.assertIn("r.type === 'volume'", PICKER)

    def test_both_views_draw_them(self):
        self.assertIn('data-native-preview="${esc(x.slug)}"', PICKER)
        self.assertIn('data-native-preview="${esc(r.slug)}"', DRAWER)
        self.assertIn("ti().drawNativeTiles(list)", DRAWER)

    def test_a_long_list_is_drawn_a_few_at_a_time(self):
        self.assertIn("tiles.splice(0, 6)", PICKER)
        self.assertIn("requestAnimationFrame(step)", PICKER)
