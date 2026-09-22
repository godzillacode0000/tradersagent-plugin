"""The row must not be described as switching chats, anywhere a reader will see it.

The behaviour changed on 22 Sep (commit 446b6e1): the sidebar row docks the chart and leaves the
session alone; it used to jump to a dedicated desk chat on every click. Six prose spots survived that
change — README's opening line, its Using-it table, the Chat-beside-the-chart paragraph, HANDOFF's
diagram and table, and plugin.js's own header — because the docs-drift tests only compare TOOL NAMES
against the MCP server. Tool names stayed stable, so a hundred green runs said nothing about a README
that promised behaviour the plugin no longer has.

That is the shape of the failure worth pinning: claims about what the row DOES, in files a stranger
reads first. The forbidden phrases below are quoted from the stale text itself, so a revert of the
22 Sep fix — or a well-meaning "it should bring the desk chat back" — fails here instead of quietly
putting the lie back in front of users.
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
    ("docs/HANDOFF.md", "opens the desk chat"),
    ("plugin/plugin.js", "opens the desk chat"),
    ("plugin/plugin.js", "opens by default"),
]

# What the reader is promised instead — asserted so a fix cannot delete the claim and pass.
REQUIRED = [
    ("README.md", "session is not switched"),
    ("README.md", "leaves your session alone"),
    ("README.md", "collapsed"),
    ("docs/HANDOFF.md", "session untouched"),
    ("plugin/plugin.js", "leaves the session alone"),
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
        plugin = self._read("plugin/plugin.js")
        self.assertIn("defaultCollapsed: true", plugin)


if __name__ == "__main__":
    unittest.main()
