"""The row must be described in prose the way it actually behaves — including its 16 Oct condition.

The behaviour changed on 22 Sep (commit 446b6e1): the sidebar row docks the chart and leaves the
session alone; it used to jump to a dedicated desk chat on every click. Six prose spots survived that
change — README's opening line, its Using-it table, the Chat-beside-the-chart paragraph, HANDOFF's
diagram and table, and plugin.js's own header — because the docs-drift tests only compare TOOL NAMES
against the MCP server. Tool names stayed stable, so a hundred green runs said nothing about a README
that promised behaviour the plugin no longer has.

16 Oct sharpened it rather than reverting it: the row DOES open the desk chat now, but only when no
chat of the operator's own is in front (policy 1), with a palette off switch (policy 3). So the lies
are the *unconditional* forms — "opens the desk chat" as a flat promise, "leaves your session alone"
as a flat promise, "session untouched" — and the truth that must be stated is the condition. Both
halves are pinned below: the forbidden phrases are quoted from real stale prose, and the required
phrases are what a reader is owed.

That is the shape of the failure worth pinning: claims about what the row DOES, in files a stranger
reads first. A revert of either fix — or a "it should bring the desk chat back" that skips the guard —
fails here instead of quietly putting a lie back in front of users.
"""

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

# (relative path, phrase) pairs: every one appeared in the real stale prose.
FORBIDDEN = [
    ("README.md", "opens the desk chat"),
    ("README.md", "brings the desk chat to the front"),
    ("README.md", "opens a full trading console in the main zone"),
    ("README.md", "620px, open by\ndefault"),
    ("README.md", "leaves your session alone"),
    ("docs/HANDOFF.md", "session untouched"),
    ("traders-desk/desktop/plugin.js", "opens the desk chat"),
    ("traders-desk/desktop/plugin.js", "opens by default"),
]

# What the reader is promised instead — asserted so a fix cannot delete the claim and pass.
REQUIRED = [
    ("README.md", "is not switched"),
    ("README.md", "a chat you are in is never switched"),
    ("README.md", "collapsed"),
    ("docs/HANDOFF.md", "only when no chat is in front"),
    ("traders-desk/desktop/plugin.js", "the desk chat opens only when"),
    ("traders-desk/desktop/plugin.js", "Desk chat: on"),
]


class ProseMatchesBehaviour(unittest.TestCase):
    def _read(self, rel):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
            return fh.read()

    def test_no_stale_claims_survive(self):
        for rel, phrase in FORBIDDEN:
            with self.subTest(file=rel, phrase=phrase):
                self.assertNotIn(
                    phrase,
                    self._read(rel),
                    f"{rel} still claims the row '{phrase}' — the row docks the chart and "
                    f"leaves the session alone since 446b6e1",
                )

    def test_the_current_behaviour_is_documented(self):
        for rel, phrase in REQUIRED:
            with self.subTest(file=rel, phrase=phrase):
                self.assertIn(
                    phrase,
                    self._read(rel),
                    f"{rel} no longer says '{phrase}' — the docs drifted the OTHER way this time",
                )

    def test_the_pane_is_still_contributed_collapsed(self):
        # The behaviour behind the prose: the pane does not open with the app (operator's call, 19 Sep).
        plugin = self._read("traders-desk/desktop/plugin.js")
        self.assertIn("defaultCollapsed: true", plugin)


if __name__ == "__main__":
    unittest.main()
