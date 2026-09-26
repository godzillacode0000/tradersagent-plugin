"""The chart bridge's two idempotence rules, and the two ways they silently rot.

Both rules exist because of a defect seen on a real chart, and both fail *quietly* — the agent is
told the work happened, so nothing surfaces until a person notices overlapping studies on the pane.

1. `add` must not stack a second copy of a study. Vela's addNativeIndicator appends; asking for `ema`
   twice drew two EMAs on top of each other. The old report called that a success because it checked
   `after.includes(name)`, which is true either way.

2. `remove` must actually remove, on a page with no workspace. The ledger path was gated behind
   `window.__wsApp`, so a bare-chart page reported "nothing removed" and left every study standing.

The checks below read the bridge's source. That is deliberate: the bridge is browser-only JavaScript
with no JS test runner in this repo, and what regresses here is a *shape* — an early return that goes
missing, a gate that comes back — which is exactly what a source assertion can hold.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BRIDGE = os.path.join(ROOT, "console", "frontend", "chart-bridge.js")


def bridge_source() -> str:
    with open(BRIDGE, encoding="utf-8") as fh:
        return fh.read()


def case_block(source: str, action: str) -> str:
    """The body of one `case '<action>': { ... }`, up to the next case at the same indent."""
    start = source.index("case '%s': {" % action)
    following = [
        m.start()
        for m in re.finditer(r"\n        case '", source[start + 1 :])
    ]
    end = start + 1 + following[0] if following else len(source)
    return source[start:end]


class AddIsIdempotent(unittest.TestCase):
    """A second `add` for a study already on the chart must change nothing and say so."""

    def setUp(self):
        self.block = case_block(bridge_source(), "add")

    def test_refuses_to_stack_a_duplicate(self):
        # The guard has to read the chart *before* it calls addNativeIndicator, otherwise there is
        # nothing to compare against.
        call = self.block.index("c.addNativeIndicator(")
        guard = self.block.index("alreadyPresent")
        self.assertLess(
            guard,
            call,
            "the duplicate check must run before addNativeIndicator is called",
        )
        self.assertIn(
            "break;",
            self.block[:call],
            "asking for an already-present study must return early, not fall through to the add",
        )

    def test_counts_existing_copies_before_deciding(self):
        # `includes` would be enough to detect one copy, but the chart can already hold several from
        # before this guard existed — the message names that number so the state is not hidden.
        self.assertIn(
            "before.filter((n) => n === name)",
            self.block,
            "the guard must count existing copies, not just test for presence",
        )

    def test_success_is_measured_as_a_gain(self):
        # The original defect: ok was `gained.length > 0 || after.includes(name)`, so a no-op add of
        # an existing study reported success. Only a real gain may count.
        #
        # Strip comments first: the comment explaining the old defect quotes `after.includes(name)`,
        # and a naive substring check would match the explanation instead of the code.
        code = re.sub(r"/\*.*?\*/", "", self.block, flags=re.S)
        self.assertNotIn(
            "after.includes(",
            code,
            "success must be a measured gain, not a presence check that a duplicate also satisfies",
        )
        self.assertIn("out.ok = gained.length > 0;", code)

    def test_repeat_is_reported_as_already_present(self):
        self.assertIn("out.alreadyPresent = true;", self.block)
        self.assertIn("nothing added", self.block)
        # The name is trimmed once and reused, so an untrimmed echo cannot disagree with what the
        # guard compared.
        code = re.sub(r"/\*.*?\*/", "", self.block, flags=re.S)
        self.assertIn("String(command.native || '').trim()", code)


class RemoveWorksWithoutAWorkspace(unittest.TestCase):
    """`remove` must reach the chart's own ledger even when there is no workspace handle."""

    def setUp(self):
        self.block = case_block(bridge_source(), "remove")

    def test_the_ledger_is_not_gated_behind_the_workspace(self):
        # The defect: an `if (firstCell) {` wrapper around the whole ledger loop meant a page without
        # window.__wsApp never attempted a removal, and still answered "nothing removed".
        self.assertNotIn(
            "firstCell",
            self.block,
            "the removal path must not depend on a workspace cell existing",
        )
        self.assertNotIn(
            "if (firstCell)",
            self.block,
            "the workspace gate must not come back — it disables removal on a bare-chart page",
        )

    def test_it_still_reads_the_ledger_off_the_chart_handle(self):
        self.assertIn("typeof c.indicators === 'function'", self.block)
        self.assertIn("ledgerOf", self.block)

    def test_all_removes_until_the_chart_is_empty(self):
        # `all` is periodically re-checked, because the ledger shifts as entries come off.
        self.assertIn("maxPasses = command.all ? 6 : 1", self.block)
        self.assertIn("if (read().length === 0) break;", self.block)

    def test_the_report_names_what_came_off(self):
        # The list is the pane's truth now (name + the reader that saw it), not the natives diff:
        # a Library run is not a Vela name, so a natives-only diff said "nothing removed" over a
        # chart the operator could see was busy (26 Sep).
        self.assertIn("gone.length ? 'removed ' + gone.map(studyTag).join(', ')", self.block)
        self.assertIn("out.ok = after.length < beforeAll.length;", self.block)


class BothFixesSurviveInTheLiveCopy(unittest.TestCase):
    """The repo copy is the source of truth, but the machine serves a different tree.

    tools/sync-live.sh copies repo -> live. A manual edit to the live tree (or a fix applied only
    there) is invisible to this repo and to anyone installing it, so the two were compared directly
    once and had genuinely drifted: the live tree carried the SYMBOL_NOT_SERVED guard while the repo
    carried none. This test pins that both rules are present in the repo copy, which is what
    sync-live.sh then publishes.
    """

    def test_the_market_switch_guard_is_still_here(self):
        source = bridge_source()
        self.assertIn("SYMBOL_NOT_SERVED", source)
        self.assertIn("SWITCH_DEADLINE_MS", source)

    def test_the_live_tree_matches_the_repo_when_present(self):
        live = os.environ.get("LUXALGO_LIVE") or os.path.expanduser(
            "~/Projects/luxalgo-web/frontend/chart-bridge.js"
        )
        if not os.path.exists(live):
            self.skipTest("no live tree on this machine")
        with open(live, encoding="utf-8") as fh:
            live_source = fh.read()
        self.assertEqual(
            bridge_source(),
            live_source,
            "the served tree differs from the repo — run tools/sync-live.sh, then reload the console",
        )


if __name__ == "__main__":
    unittest.main()
