"""The sidebar row must put the chart beside the conversation, never switch the conversation.

Why this is a test rather than only a comment: the behaviour was the opposite until 22 Sep, and the
old behaviour was not visibly broken — it did *something* plausible (it opened a chat), so a
regression would look like a working plugin. What it actually did was pull the operator out of the
session he was in every time he pressed the row, which is the "I have to go hunting for it" complaint.
Nothing about a wrong-but-quiet jump to another chat fails a smoke test, so it is pinned here.

The plugin is browser JavaScript with no JS test runner in this repo, so the checks read the source.
That is a deliberate trade: what must not change is a *shape* — a call that is not there, a session id
that must not come back — and a source assertion is exactly the instrument for that.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PLUGIN = os.path.join(ROOT, "plugin", "plugin.js")


def plugin_source() -> str:
    with open(PLUGIN, encoding="utf-8") as fh:
        return fh.read()


def without_comments(source: str) -> str:
    """Strip /* ... */ and // ... so prose about a removed call cannot satisfy a check for it."""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


class TheRowLeavesTheSessionAlone(unittest.TestCase):
    def setUp(self):
        self.code = without_comments(plugin_source())

    def test_the_page_does_not_open_another_chat(self):
        for call in ("openDeskChat", "openSession", "newChat", "listPersistedSessions"):
            self.assertNotIn(
                call,
                self.code,
                f"landing on the row must not switch sessions, but it still calls {call}()",
            )

    def test_no_session_is_pinned_by_id_or_title(self):
        # A hardcoded id or a title regex is how the old jump resolved its target; either one coming
        # back means the row can leave the operator's session again.
        self.assertNotIn("DESK_SESSION_ID", self.code)
        self.assertNotIn("DESK_TITLE", self.code)
        self.assertNotRegex(
            self.code,
            r"\d{8}_\d{6}_[0-9a-f]{6}",
            "a Hermes session id is hardcoded again",
        )

    def test_the_page_still_reveals_the_chart(self):
        # The one job the row kept. Without this the row does nothing at all.
        self.assertIn("revealChart()", self.code)
        self.assertIn("adoptAndReveal", self.code)

    def test_the_pane_still_does_not_open_by_itself(self):
        # The operator's call, kept: the pane is contributed collapsed and only the click opens it.
        self.assertIn("defaultCollapsed: true", self.code)

    def test_the_hidden_pane_fallback_survives(self):
        # Landing on an empty page was the 17 Sep failure. The console-instead-of-nothing branch and
        # its way-out button must stay.
        self.assertIn("function TradersDeskPage()", self.code)
        self.assertIn("ConsoleFrame", self.code)
        self.assertIn("PaneHint", self.code)

    def test_the_card_says_the_chat_was_left_alone(self):
        # The wording is the user-facing half of the promise, so it is asserted, not just the absence
        # of a call.
        self.assertRegex(
            self.code,
            r"Chart docked on the right",
        )
        self.assertRegex(
            self.code,
            r"your chat was left open",
        )


class TheLandingHandsTheWorkspaceBack(unittest.TestCase):
    """22 Sep: the route page covered his chat — the composer sat behind a status card.

    A contributed route mounts a FULL page in the workspace by SDK design, so the row's landing
    displaced his conversation while the card claimed "your chat was left open". The bounce back
    to the focused chat is the difference between reveal-only (the promise) and take-over (the
    report: "where is my chat composer part in the middle?"). It must: exist, carry the STORED
    id — routes parse durable ids, the runtime id resolves to no route — and wait for the pane,
    because the hidden-pane branch is the console fallback that must stay put.
    """

    def setUp(self):
        self.code = without_comments(plugin_source())

    def test_the_page_navigates_back_to_the_focused_chat(self):
        self.assertIn("host.state.focusedStoredSessionId", self.code)
        self.assertIn("host.navigate", self.code)

    def test_the_id_read_is_reactive_not_one_shot(self):
        # The first bounce read the id exactly once at mount. Sessions restore asynchronously, so
        # a cold boot mounted the page while the id was still null: the navigate was skipped, the
        # effect never re-ran (deps were [paneUp] only), and re-clicking the row did not remount
        # the same path — the card stuck until the app was restarted (23 Sep screenshot). The id
        # must arrive through a subscription, and the effect must re-fire when it does.
        self.assertIn("useValue(host.state && host.state.focusedStoredSessionId)", self.code)
        self.assertRegex(self.code, r"\[paneUp, sid\]")

    def test_it_does_not_route_on_the_runtime_id(self):
        # activeSessionId is the RUNTIME id (store/session.ts seeds it with 'rt-focus'-shaped
        # values); sessionRoute builds '/' + stored id, so routing on it lands on no route.
        self.assertNotIn("host.state.activeSessionId", self.code)

    def test_the_bounce_waits_for_the_pane(self):
        # Pane hidden → this page IS the console fallback (the 17 Sep rule) and must stay.
        self.assertRegex(self.code, r"if \(!paneUp\) return")


class TheManifestStaysHonest(unittest.TestCase):
    def test_expected_renders_match_what_the_plugin_contributes(self):
        # plugin.expect.json is what tools/verify-plugin.mjs checks against the rendered output, and
        # the repo's own harness passes. Pinning the marker here catches a rename that would otherwise
        # only fail when a human ran the harness.
        expect = os.path.join(ROOT, "plugin", "plugin.expect.json")
        with open(expect, encoding="utf-8") as fh:
            manifest = fh.read()
        self.assertIn("Chart docked on the right", manifest)
        self.assertIn("sidebar.nav", manifest)


if __name__ == "__main__":
    unittest.main()
