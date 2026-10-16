"""The sidebar row puts the chart beside the conversation — and the desk chat in front of it ONLY
when no chat of the operator's own is there to displace.

Why this is a test rather than only a comment: the row's behaviour has been wrong in both directions.
Until 22 Sep it jumped into a dedicated desk chat on every click, which pulled the operator out of the
session he was in ("I have to go hunting for it") — a regression that looks like a working plugin,
because it does *something* plausible. The fix then made the row reveal-only in every case, which is
not what he wanted either: with no chat of his own in front, the desk's own chat is where he wants to
land. The 16 Oct call is policy 1 + 3 — open it only when the seat is empty, and put the off switch in
the palette. Both halves are pinned here: what "empty" means, where the off switch is, and the fact
that the desk session is *minted* (and remembered) rather than searched for.

The plugin is browser JavaScript with no JS test runner in this repo, so the checks read the source.
That is a deliberate trade: what must not change is a *shape* — a guard that must be there, a session
id that must not come back — and a source assertion is exactly the instrument for that.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PLUGIN = os.path.join(ROOT, "traders-desk", "desktop", "plugin.js")


def plugin_source() -> str:
    with open(PLUGIN, encoding="utf-8") as fh:
        return fh.read()


def without_comments(source: str) -> str:
    """Strip /* ... */ and // ... so prose about a removed call cannot satisfy a check for it."""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


class TheRowOpensTheDeskChatOnlyWhenTheSeatIsEmpty(unittest.TestCase):
    """Policy 1 + 3 (16 Oct). The guard comes first, the preference second, the session last."""

    def setUp(self):
        self.code = without_comments(plugin_source())

    def test_a_chat_in_front_short_circuits_the_desk_open(self):
        # The 22 Sep failure in one line: a focused session must return before anything else runs.
        self.assertIn("async function openDeskChatWhenEmpty(focused)", self.code)
        self.assertRegex(self.code, r"if \(focused \|\| !deskChatOn\) return false")

    def test_the_only_call_site_is_the_empty_seat_branch(self):
        # The page must call it from the branch that runs when `sid` is falsy — never unconditionally,
        # and never before the stored preference has been read (the launch reveal waits on its own
        # read for the same reason).
        self.assertRegex(self.code, r"\.then\(\(\) => openDeskChatWhenEmpty\(sid\)\)")
        self.assertIn("deskChatReady", self.code)

    def test_the_preference_defaults_on_and_persists(self):
        self.assertIn("deskChatOn = value !== false", self.code)   # on unless explicitly turned off
        self.assertIn("storeValue(DESK_PREF, deskChatOn)", self.code)

    def test_the_palette_carries_the_off_switch(self):
        self.assertIn("'tradingDesk.deskChat'", self.code)
        self.assertIn("toggle the desk chat on row click", self.code)

    def test_the_session_is_minted_never_pinned(self):
        # The old jump carried a fixed id/title to resolve against. The desk session is created on
        # first use now: no id in the source, and the create is idempotent so a retry cannot twin it.
        self.assertNotIn("DESK_SESSION_ID", self.code)
        self.assertNotRegex(self.code, r"\d{8}_\d{6}_[0-9a-f]{6}", "a Hermes session id is hardcoded")
        self.assertIn("'session.create'", self.code)
        self.assertIn("stored_session_id", self.code)       # the durable id, not the runtime one
        self.assertIn("idempotency_key: DESK_IDEMPOTENCY", self.code)

    def test_the_title_is_a_create_argument_never_a_search_key(self):
        # `title` is what the new session is called. Looking one UP by title (or listing sessions to
        # find one) is the old resolution path and must not come back.
        self.assertNotIn("listPersistedSessions", self.code)
        self.assertNotIn("'session.list'", self.code)
        self.assertNotRegex(self.code, r"\.find\([^)]*DESK_TITLE")
        self.assertNotRegex(self.code, r"DESK_TITLE\s*===?")

    def test_older_builds_degrade_to_reveal_only(self):
        # No request door (an older app) or no openSession door: the row must behave exactly as it
        # did before this feature existed, not throw.
        self.assertRegex(self.code, r"typeof host\.request !== 'function'")
        self.assertRegex(self.code, r"typeof host\.openSession !== 'function'")

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

    def test_the_card_states_the_desk_chat_policy(self):
        # A preference nobody can see is a preference nobody trusts: the docked card says which way
        # the row is set, both ways.
        self.assertRegex(self.code, r"Chart docked on the right")
        self.assertIn("Desk chat: on", self.code)
        self.assertIn("Desk chat: off", self.code)


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

    def test_a_focused_chat_still_wins_over_the_desk_chat(self):
        # Policy 1 in the page itself: `sid` truthy means his conversation is on screen, so the
        # bounce wins and the desk open is never reached.
        self.assertRegex(self.code, r"if \(sid\) \{\s*backToChat\(sid\)")

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


class TheConsoleNeverLeavesHermes(unittest.TestCase):
    """Operator, 24 Sep: "Always inside the Hermes for this plugin...never show me external
    browser." The plugin used to carry THREE exits — a card button, the docked card's button,
    and a palette command, all through ctx.os.openExternal — plus the shim feeding them.
    Removed; pinned here so an 'escape hatch' cannot walk back in."""

    def _src(self):
        with open(PLUGIN, encoding="utf-8") as fh:
            return fh.read()

    def test_no_external_browser_exit_in_the_plugin(self):
        src = self._src()
        for needle in ("Open in a browser", "openExternal", "openInBrowser", "ctx_os_open"):
            self.assertNotIn(needle, src)

    def test_reveal_paths_stay_in_app(self):
        src = self._src()
        self.assertIn("host.navigate", src)    # row/chip/palette commands navigate in-app
        self.assertIn("revealPane", src)       # the pane door is the app's own

    def test_docs_do_not_advertise_one(self):
        for rel in ("README.md", "docs/HANDOFF.md"):
            with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
                text = fh.read()
            self.assertNotIn("open console in browser", text)
            self.assertNotIn("open in browser", text.lower())


class TheManifestStaysHonest(unittest.TestCase):
    def test_expected_renders_match_what_the_plugin_contributes(self):
        # plugin.expect.json is what tools/verify-plugin.mjs checks against the rendered output, and
        # the repo's own harness passes. Pinning the marker here catches a rename that would otherwise
        # only fail when a human ran the harness.
        expect = os.path.join(ROOT, "traders-desk", "desktop", "plugin.expect.json")
        with open(expect, encoding="utf-8") as fh:
            manifest = fh.read()
        self.assertIn("Chart docked on the right", manifest)
        self.assertIn("Desk chat: on", manifest)
        self.assertIn("sidebar.nav", manifest)


if __name__ == "__main__":
    unittest.main()
