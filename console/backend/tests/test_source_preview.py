"""The Library's 40-line preview must be REFUSED, not run (2 Nov 2026).

LuxAlgo's hosted tool answers anonymous callers with the first 40 lines of a script and says so:
`complete: false`, `reason: "sign-in-for-full-source"`, `shown_lines` / `total_lines`, `chart_url`.
The console used to drop those fields, so a preview looked exactly like a script — the drawer ran
the fragment and the engine answered `SYNTAX_ERROR … Unexpected token EOF at 40:81`, which is the
CUT, not the code. Measured while sweeping the catalogue: 7 of the first 59 scripts "failed" this
way, and every one of them is longer than 40 lines.

Pinned here:
  * `ep_source` passes the completeness fields through (and treats a payload without them as whole);
  * the drawer refuses a preview before it clears anything, and names the real numbers;
  * the detail panel's Run refuses too, and its header carries a preview badge;
  * the sweep script knows a preview is not a failure of the indicator.
"""
import os
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
ROOT = BACKEND.parents[1]
FRONT = ROOT / "console" / "frontend"


def read(path) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


import server as srv  # noqa: E402


def _source_response(fields: dict) -> dict:
    payload = {"slug": "frama", "name": "FRAMA", "available": True,
               "source": "// FRAMA\nindicator('FRAMA')\n" + "plot(close)\n" * 38, **fields}
    original = srv.mcp_call
    srv.mcp_call = lambda *a, **k: (payload, "raw", False)
    try:
        return srv.ep_source({"slug": ["frama"]})
    finally:
        srv.mcp_call = original


class TheSourceSaysWhetherItIsWhole(unittest.TestCase):
    def test_a_preview_passes_its_numbers_through(self):
        out = _source_response({"complete": False, "shown_lines": 40, "total_lines": 197,
                                "reason": "sign-in-for-full-source",
                                "chart_url": "https://vela.luxalgo.com/chart?pineScriptCodeId=x"})
        self.assertIs(out["complete"], False)
        self.assertEqual(out["shown_lines"], 40)
        self.assertEqual(out["total_lines"], 197)
        self.assertEqual(out["reason"], "sign-in-for-full-source")
        self.assertIn("vela.luxalgo.com/chart", out["chart_url"])

    def test_a_payload_without_the_fields_is_treated_as_whole(self):
        """Older/other answers carry no `complete`; refusing them would break real runs."""
        out = _source_response({})
        self.assertIs(out["complete"], True)

    def test_a_whole_source_says_so(self):
        out = _source_response({"complete": True, "shown_lines": 40, "total_lines": 40})
        self.assertIs(out["complete"], True)


class TheUiRefusesToRunAPreview(unittest.TestCase):
    def test_the_drawer_refuses_and_leaves_the_chart_alone(self):
        js = read(FRONT / "drawer.js")
        self.assertIn("data.complete === false", js)
        self.assertIn("preview only", js)
        self.assertIn("sign-in", js)
        self.assertIn("data.shown_lines", js)
        self.assertIn("data.total_lines", js)
        # the refusal must happen BEFORE the canvas is cleared — a preview click may not cost the
        # indicator already on the chart
        guard = js.index("data.complete === false")
        self.assertLess(guard, js.index("window.ChartOverlay.clear()"))

    def test_the_detail_panel_refuses_and_badges_it(self):
        js = read(FRONT / "app.js")
        self.assertIn("data.complete === false", js)
        self.assertIn("preview ·", js)            # the header badge
        self.assertIn("full source: ", js)        # the headline names where the rest lives

    def test_the_sweep_calls_a_preview_a_preview(self):
        sweep = (Path.home() / ".hermes/cache/scratch/rea/sweep_indicators.py")
        if not sweep.exists():
            self.skipTest("sweep harness is a scratch tool, not in the repo")
        text = sweep.read_text("utf-8")
        self.assertIn("complete", text)
        self.assertIn("preview", text.lower())


if __name__ == "__main__":
    unittest.main()
