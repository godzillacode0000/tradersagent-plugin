"""Pins for the 5 Oct 2026 Edge Stats redesign.

What the redesign promises, so it cannot quietly erode:

* ONE hero per view: the rate, 56px, the largest type in the sheet — and no rate without its N beside it.
* Summary is short (hero, verdict chips, breakdown, days); Detailed adds the evidence behind the chips.
  The choice is remembered. A refused answer shows no percentage in either mode.
* A level far outside the day's candles is not drawn (it stretched the chart's price scale until the candles
  were a sliver) — it is named in the legend as off-chart instead.
* The sheet has its own theme switch, and it presses the app's one theme button (one code path).
* "Start here" only offers reports the engine really has.
"""
import json
import os
import re
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
NODE = shutil.which("node")


def read(name):
    with open(os.path.join(ROOT, "console", "frontend", name), encoding="utf-8") as fh:
        return fh.read()


JS, CSS, HTML = read("edge.js"), read("edge.css"), read("index.html")


def block(name):
    """A function inside edge.js's IIFE, by indentation (a brace matcher chokes on regex/quote characters)."""
    m = re.search(r"^  (?:async )?function %s\(" % re.escape(name), JS, re.M)
    assert m, name
    end = re.search(r"^  \}$", JS[m.start():], re.M)
    return JS[m.start():m.start() + end.end()]


# every report the engine shipped on 5 Oct 2026 (LuxAlgo/edge-stats @ a482598), from /api/edgestats/presets
ENGINE_REPORTS = {
    "day-after-event", "day-before-event", "day-of-week", "doji-follow-through", "engulfing-bear", "engulfing-bull",
    "event-day-cpi", "event-day-fomc", "event-day-nfp", "event-day-opex", "fvg-below-green", "fvg-magnet", "gap-and-go",
    "gap-fill-by-direction", "gap-fill-by-size", "gap-fill-by-weekday", "gap-fill-time", "gap-fill", "gap-reversal",
    "green-rate", "high-time", "ib-extension", "initial-balance", "inside-day", "low-time", "month-of-year", "nr7-expansion",
    "orb-by-direction", "orb-false-break", "orb-target", "orb-time-to-break", "orb", "outside-day", "prev-high-break-hold",
    "prev-high-touch-by-open", "prev-low-break-hold", "prev-low-touch", "prev-range", "quiet-then-wild", "range-vs-atr",
    "streak-continuation", "streak-reversion",
}


class OneHero(unittest.TestCase):
    def test_the_rate_is_the_biggest_type_in_the_sheet(self):
        scale = dict(re.findall(r"--e-([a-z]+):\s*(\d+)px", CSS.split(".edge-sheet.is-open")[0]))
        self.assertEqual(scale["hero"], "56")
        self.assertGreaterEqual(int(scale["hero"]), 48, "the hero figure is at least 48px")
        for name, px in scale.items():
            if name != "hero":
                self.assertLess(int(px), int(scale["hero"]), f"--e-{name} must stay below the hero")
        self.assertRegex(CSS, r"\.e-rate__n\s*\{[^}]*font-size:\s*var\(--e-hero\)")
        self.assertNotIn("tabular-nums", re.search(r"\.e-rate__n\s*\{[^}]*\}", CSS).group(0),
                         "big standalone figures are proportional; tabular is for columns")

    def test_the_hero_names_its_sample_and_range_next_to_the_rate(self):
        body = block("renderResult")
        self.assertRegex(body, re.compile(r'class="e-rate".*?class="e-facts".*?sessions.*?95% range', re.S))

    def test_a_refused_answer_prints_no_percentage_and_no_chips(self):
        body = block("renderResult")
        refused = body[body.index("if (refused)"):body.index("} else if (isNum(d.estimate)")]
        self.assertNotIn("pctNum", refused)
        self.assertNotIn("e-verdicts", refused)
        self.assertIn("Not enough sessions to give a rate", refused)


class SummaryAndDetailed(unittest.TestCase):
    def test_the_evidence_is_only_in_the_detailed_branch(self):
        body = block("renderResult")
        evidence = body[body.index("if (detailed) {"):body.index("/* — the days behind it")]
        for token in ("d.stability.firstHalf", "d.recency", "d.perYear", "d.distribution"):
            self.assertIn(token, evidence)
        summary = body[:body.index("if (detailed) {")]
        for token in ("firstHalf", "perYear", "edge-dist"):
            self.assertNotIn(token, summary, f"{token} belongs to Detailed")
        self.assertIn("d.stability.agree", summary, "the Summary still says whether it is stable — as a chip")

    def test_the_breakdown_and_the_days_are_in_both_modes(self):
        body = block("renderResult")
        self.assertRegex(body, r"if \(!refused && d\.groups && d\.groups\.length\)")
        self.assertIn("Days behind it", body)
        self.assertIn("Math.min(5, S.sessShown)", body, "the Summary lists five days, not the whole page")

    def test_the_choice_is_remembered_and_summary_is_the_default(self):
        self.assertIn("const KEY_DETAIL = 'luxalgo-web:edge-detail'", JS)
        self.assertRegex(JS, r"detail: readStore\(KEY_DETAIL\) === 'detailed' \? 'detailed' : 'summary'")
        self.assertIn("writeStore(KEY_DETAIL, S.detail)", block("setDetail") if "function setDetail(" in JS else JS)

    def test_a_chip_is_a_door_to_its_evidence(self):
        body = block("renderResult")
        self.assertIn('data-act="jump" data-target="e-stable"', body)
        self.assertIn('data-act="jump" data-target="e-recent"', body)
        self.assertIn('id="e-stable"', body)
        self.assertIn('id="e-recent"', body)

    def test_every_figure_in_the_evidence_keeps_its_n(self):
        body = block("renderResult")
        self.assertGreaterEqual(body.count("<small>n ${num("), 4, "halves, recent, all and each year show their n")
        self.assertIn("n ${num(g.n)}", body, "each group row shows its n")


class Levels(unittest.TestCase):
    @unittest.skipUnless(NODE, "node not installed")
    def test_a_level_far_from_the_candles_is_not_drawn_but_is_named(self):
        script = ("const isNum = (v) => typeof v === 'number' && Number.isFinite(v);\n" + block("levelsInReach") + """
        const bars = [{low: 84700, high: 85900}, {low: 84750, high: 85800}];
        const reach = levelsInReach({ bars, context: { bars: [{ low: 84690, high: 84800 }] }, levels: {} });
        console.log(JSON.stringify({ high: reach(87220), low: reach(83888), close: reach(84518.01), inside: reach(85200), nan: reach(NaN) }));
        """)
        out = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(out.returncode, 0, out.stderr[-400:])
        self.assertEqual(json.loads(out.stdout), {"high": False, "low": False, "close": True, "inside": True, "nan": False})

    def test_the_overlay_and_the_legend_use_the_same_rule(self):
        self.assertGreaterEqual(JS.count("levelsInReach("), 3)
        self.assertIn("off chart", block("legendItems"))
        for level in ("prior-close", "'open'", "opening-range"):
            self.assertIn(level, block("buildOverlay"))
        self.assertIn("!reach(y)", block("buildOverlay"))


class Theme(unittest.TestCase):
    def test_the_sheet_has_a_theme_switch_wired_to_the_apps_own_button(self):
        self.assertIn('id="edge-theme"', HTML)
        self.assertIn("$('theme-toggle')", JS)
        self.assertIn("app.click()", JS)
        self.assertIn("function paintTheme()", JS)
        self.assertIn("Switch to the light theme", JS)
        self.assertIn("Switch to the dark theme", JS)
        self.assertIn(':root[data-theme="light"] .edge__icon .i-sun { display: none; }', CSS)

    def test_the_app_still_owns_theme_state(self):
        app = read("app.js")
        self.assertIn("$('#theme-toggle').addEventListener('click'", app)
        self.assertIn("luxalgo-web:theme", app)


class StartHere(unittest.TestCase):
    def test_it_only_offers_reports_the_engine_has(self):
        ids = re.findall(r"\['([a-z0-9-]+)', '", JS[JS.index("const START_HERE"):JS.index("];", JS.index("const START_HERE"))])
        self.assertGreaterEqual(len(ids), 4)
        self.assertLessEqual(len(ids), 8, "a short list, or it is just the catalogue again")
        self.assertTrue(set(ids) <= ENGINE_REPORTS, set(ids) - ENGINE_REPORTS)
        self.assertIn(".filter((x) => x.p)", JS, "an id the engine lacks is skipped, never an empty tile")

    def test_the_catalogue_is_grouped_instead_of_repeating_a_tag_per_row(self):
        body = block("reportRows")
        self.assertIn("e-grouphead", body)
        self.assertIn("const tagged = S.cat === 'all' && !!S.q.trim()", body)


class DataView(unittest.TestCase):
    def test_one_source_at_a_time_and_the_sandbox_option_is_tucked_away(self):
        body = block("sourceCard")
        self.assertIn('data-src="${id}"', body)
        self.assertIn("<summary>Advanced</summary>", body)
        self.assertLess(body.index("<summary>Advanced</summary>"), body.index('id="edge-archive"'))


class Honesty(unittest.TestCase):
    def test_the_disclaimer_and_the_licence_line_survive_the_trim(self):
        self.assertIn("Not predictions, not advice", block("renderResult"))
        home, data = block("renderHome"), block("renderData")
        for body in (home, data):
            self.assertIn("CC BY 4.0", body, "the calendar data's attribution is a licence condition")
            self.assertIn("github.com/LuxAlgo/edge-stats", body)

    def test_the_statements_that_were_cut_stay_cut(self):
        for gone in ("Any outcome combines with any conditions", "Open any session to see its bars",
                     "The matching sessions, split in time, give overlapping intervals", "Bars show the 95% interval; a group"):
            self.assertNotIn(gone, JS)


if __name__ == "__main__":
    unittest.main()
