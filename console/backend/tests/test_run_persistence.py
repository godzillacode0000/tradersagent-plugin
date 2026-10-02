"""A Library/agent run survives a reload, an app restart and a night with the lid closed.

Vela persists its own natives (`persist: true` in workspace.js), but a script run through
TraderRun lives only on our overlay canvas — so the operator closed the laptop with a chart full of
order blocks and opened it next day to bare candles (2 Oct). The runner now remembers the LAST run
that landed (the overlay is one script at a time: `apply` clears the canvas), forgets it on
clear/remove-all, and the page re-runs it once bars are on screen.
"""

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


UNIFIED = read("console/frontend/unified.js")
APP = read("console/frontend/app.js")


class RunPersistence(unittest.TestCase):
    def test_runner_saves_the_landed_run(self):
        self.assertIn("RUN_KEY = 'luxalgo-web:last-run'", UNIFIED)
        self.assertIn("function remember(", UNIFIED)
        # only a run that LANDED is remembered — a failed run must not come back tomorrow
        body = UNIFIED.split("function remember(", 1)[1].split("\n  }\n", 1)[0]
        self.assertIn("localStorage.setItem(RUN_KEY", body)

    def test_reset_forgets_it(self):
        body = UNIFIED.split("function reset()", 1)[1].split("\n  }\n", 1)[0]
        self.assertIn("localStorage.removeItem(RUN_KEY)", body)

    def test_runner_exposes_restore(self):
        self.assertIn("async function restore(", UNIFIED)
        self.assertIn("restore,", UNIFIED.split("return { run, summarize", 1)[1])
        # a restore must never re-save itself into a loop or count as a fresh run on the legend twice
        self.assertIn("restoring: true", UNIFIED)

    def test_page_restores_after_boot(self):
        tail = APP.split("try { await bootChart(); }", 1)[1]
        self.assertIn("TraderRun.restore(", tail)


if __name__ == "__main__":
    unittest.main()
