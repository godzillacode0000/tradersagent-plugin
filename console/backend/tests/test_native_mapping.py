"""Which Vela native a script is allowed to become (27 Sep).

The operator's screen, after a run of the Library's *Wyckoff Wave & Volume Studies*: **five** stacked
`ATR 2.17` panes and no dashboard. Two separate faults, both pinned here.

  * **The script's name decides, not its source.** The old rule scanned the source for `ta.atr(` — and
    the Wyckoff script *uses* ATR as its reversal threshold, so the whole dashboard was painted as an
    Average True Range pane. A script called "…ATR…" is an ATR; one called "Wyckoff Wave & Volume
    Studies" is not. The title (`indicator("…")` / `shorttitle=`) is consulted first.
  * **A dashboard is not a native.** A script that builds tables/boxes/lines, or plots a family of its
    own series, is not expressed by one Vela indicator. It now says so instead of picking one.
  * **One pane per indicator.** Re-running a script — or running it after a reload, when the old
    handle is gone — stacked another pane. A native of that type already on the chart is left alone.

Read-source assertions: the console has no JS runner in this repo.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LAYER = os.path.join(ROOT, "console", "frontend", "pinets-layer.js")
UNIFIED = os.path.join(ROOT, "console", "frontend", "unified.js")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class WhichNativeAScriptBecomes(unittest.TestCase):
    def test_the_title_is_read_and_consulted_before_the_source(self):
        src = read(LAYER)
        self.assertIn("function scriptTitle(source)", src)
        self.assertIn("const NAMES = {", src)
        body = src[src.index("async function nativeFor("):]
        body = body[:body.index("\n  }")]
        self.assertLess(body.index("scriptTitle(source)"), body.index("for (const [re, type, label] of MAP)"),
                        "the source scan runs before the script's own name again")

    def test_the_names_table_covers_the_natives_the_map_knows(self):
        src = read(LAYER)
        block = src[src.index("const NAMES = {"):]
        block = block[:block.index("\n  };")]
        named = set(re.findall(r"(?:'([a-z-]+)'|([a-z]+)):\s*/", block))
        flat = {a or b for a, b in named}
        for must in ("average-true-range", "ema", "rsi", "macd", "supertrend", "vwap"):
            self.assertIn(must, flat, f"NAMES no longer names {must}")
        self.assertTrue(flat, "NAMES is empty")

    def test_a_dashboard_is_refused_a_native(self):
        src = read(LAYER)
        body = src[src.index("async function nativeFor("):]
        body = body[:body.index("\n  }")]
        self.assertIn("if (O.containers) return null;", body,
                      "a script that builds tables/boxes/lines may become a single native again")
        self.assertIn("O.series > 2", body,
                      "a script with a family of series may become a single native again")
        unified = read(UNIFIED)
        self.assertIn("paintNative(String(pine), { containers, series: res.series.length })", unified,
                      "the caller stopped telling the paint layer what the script built")

    def test_the_paint_layer_never_stacks_a_second_pane(self):
        src = read(LAYER)
        paint = src[src.index("async function paintNative("):]
        self.assertIn("presentNativeIndicators()", paint[:2000],
                      "the already-on-the-chart check is gone — panes will stack again")
        self.assertIn("not stacking a second pane", paint[:2500])

    def test_the_reason_names_the_dashboard(self):
        src = read(LAYER)
        self.assertIn("paints its own dashboard", src)


if __name__ == "__main__":
    unittest.main()
