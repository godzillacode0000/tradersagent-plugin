"""The script pane at 760-1099 px (the operator's Hermes pane, 5 Oct): docked beside the chart it was capped
at 40dvh by the stacked-layout rule (a 240px pane, a 120px editor, a grey slab under it), and the bare-chart
fallback strip floated over its name field and hid ▶ Run and ✕. Pinned as source shape; the behaviour was
measured in a real browser at 771x603, 1150x900 and 740x603."""

import re
import unittest
from pathlib import Path

FRONT = Path(__file__).resolve().parents[3] / "console" / "frontend"
CSS = (FRONT / "styles.css").read_text(encoding="utf-8")
APP = (FRONT / "app.js").read_text(encoding="utf-8")


class DockedPane(unittest.TestCase):
    def rule(self) -> str:
        m = re.search(r'\.main\[data-dock="on"\]\[data-detail="on"\] \.panel--right \{([^}]*)\}', CSS)
        self.assertIsNotNone(m, "the docked-pane rule is gone")
        return m.group(1)

    def test_a_docked_pane_is_not_capped_at_the_stacked_height(self):
        self.assertIn("max-height: none", self.rule())

    def test_a_docked_pane_starts_below_the_fallback_strip(self):
        self.assertIn("padding-top: var(--lx-strip-h", self.rule())

    def test_the_strip_height_is_measured_where_the_pane_top_is(self):
        body = APP[APP.index("function setPaneTop("):]
        body = body[:body.index("\n}\n")]
        self.assertIn("fallback-strip", body)
        self.assertIn("--lx-strip-h", body)

    def test_fallbacks_re_measure_when_they_appear(self):
        body = APP[APP.index("const showFallbacks = () => {"):]
        self.assertIn("setPaneTop();", body[:body.index("};")])


if __name__ == "__main__":
    unittest.main()
