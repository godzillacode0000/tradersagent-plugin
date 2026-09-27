"""Bar-time geometry is translated, never dropped (27 Sep).

A Pine drawing declared with `xloc = xloc.bar_time` carries **ms timestamps**, not bar indices, and
our overlay paints in bar-index space. The old flatten() dropped such boxes outright —
`filter((b) => b.xloc !== 'bt')` — so an indicator could compute its zones perfectly and show none of
them: applying the Library's *Smart Money Concepts* drew 35 lines and 35 labels and **0 boxes**, while
the LuxAlgo original shows order blocks and fair value gaps as shaded rectangles. A probe box built
exactly the way SMC builds them (`box.new(na, na, na, na, xloc = xloc.bar_time, extend = extend.right)`
then `box.set_lefttop/set_rightbottom`) reported "engine stored raw row(s) but none survived".

The fix is a translation: nearest bar at or before the timestamp, applied to every x a row carries
(box `left`/`right`, line `x1`/`x2`, label `x`). Rows that still cannot be placed are dropped — the
report counts what is on the canvas, not what was computed.

Measured after: the probe -> `1 box`; SMC -> `5 box / 31 line / 35 label on screen`.

Read-source assertions: the console has no JS runner in this repo.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
UNIFIED = os.path.join(ROOT, "console", "frontend", "unified.js")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class BarTimeGeometry(unittest.TestCase):
    def test_the_drop_filter_is_gone(self):
        src = read(UNIFIED)
        self.assertNotIn("b.xloc !== 'bt'", src,
                         "bar-time boxes are being thrown away again instead of translated")

    def test_every_x_is_translated(self):
        src = read(UNIFIED)
        for call, fields in (("__boxes__", "['left', 'right']"),
                             ("__lines__", "['x1', 'x2']"),
                             ("__labels__", "['x']")):
            line = next((l for l in src.splitlines() if call in l), "")
            self.assertIn("toBarIndex(", line, f"{call} no longer goes through the translator")
            self.assertIn(fields, line, f"{call} is translated with the wrong fields")

    def test_the_translation_reads_the_bars(self):
        src = read(UNIFIED)
        self.assertIn("function barAt(bars, t)", src)
        self.assertIn("flatten(res.raw, bars)", src,
                      "flatten() was called without the bars — bar-time rows cannot be placed")
        body = src[src.index("function barAt("):]
        body = body[:body.index("\n  }")]
        self.assertIn("b.time", body, "the bar's own time field is not read")
        self.assertIn("openTime", body, "the engine's other time spelling is not read")

    def test_rows_that_cannot_be_placed_are_dropped(self):
        src = read(UNIFIED)
        self.assertIn("if (i == null) return null;", src)
        self.assertTrue(re.search(r"\.filter\(Boolean\)", src), "nothing filters unplaceable rows")


if __name__ == "__main__":
    unittest.main()
