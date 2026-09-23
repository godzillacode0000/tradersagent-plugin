"""How old is too old to trust a chart's own report?

Split out of server.py so it can be tested without fastmcp installed. The server cannot be imported
in a stdlib-only run (it exits when fastmcp is missing), and a guard that skips is a guard that does
not guard — the whole point of this file is to be present in the plain suite.

Why it exists: a chart pane that has been closed for hours still answers every read with a perfectly
plausible symbol, price and bar count. Nothing in that payload says "this is three hours old". The
age is there, but an agent has no scale for it, so a stale reading and a live one look identical.
These thresholds give the number a scale, and say what it means in words.
"""

# The page republishes its state every 4 s (STATE_EVERY in the console's chart-bridge.js). 30 s is
# several missed beats; 300 s is a page that is not there any more — most likely the window was
# closed or the machine slept.
STALE_AFTER_S = 30
DEAD_AFTER_S = 300
COMMAND_MAX_AGE_S = 10


def _command_gate(age) -> str:
    """Turn a page's heartbeat age into a refusal when answering is no longer possible.

    The read warning fires at STALE_AFTER_S (30s) and still hands over its numbers — a stale read
    is information. A command is different: it is executed by the page (push → claim → run), so
    when the heartbeat is gone nobody is coming to claim it, and the caller would burn the whole
    inline window (INLINE_WAIT, 8s) to be told a page that was never going to answer "had not
    answered". The gate is therefore tighter than the read warning: 10s is two and a half missed
    beats of a 4s heartbeat — comfortably more than any healthy page ever misses, and small enough
    that a dead pane costs one fast sentence instead of eight seconds of pretending.

    Returns "" when the command may be queued: young heartbeat, or unknown age (None/garbage —
    let push-and-wait decide; a preflight that guesses is worse than no preflight).
    """
    try:
        age = int(age)
    except (TypeError, ValueError):
        return ""
    if age < COMMAND_MAX_AGE_S:
        return ""
    return (f"the console page is not answering — its last heartbeat was {age}s ago "
            f"(it republishes every 4s; the gate is {COMMAND_MAX_AGE_S}s). The pane is closed or "
            f"the page is frozen — click the Trader's Agent sidebar row in Hermes Desktop to "
            f"bring the chart back, then call this tool again. Nothing was queued.")


def _freshness(age) -> str:
    """Turn a page's heartbeat age into a warning when it is old enough to matter.

    Returns "" when the age is healthy, and a sentence starting with a warning marker otherwise, so
    callers can append it without checking anything.
    """
    try:
        age = int(age)
    except (TypeError, ValueError):
        return "\n  ⚠ the page did not report how long ago it spoke — treat this reading as unverified"
    if age >= DEAD_AFTER_S:
        return (f"\n  ⚠ STALE: the page has not spoken for {age}s ({age // 60} min). The chart window is "
                f"probably closed or the machine slept. Anything below describes an older moment — "
                f"the numbers are not live, and a command will most likely be queued and never run.")
    if age >= STALE_AFTER_S:
        return (f"\n  ⚠ the page last spoke {age}s ago (it republishes every 4s) — it may be busy or "
                f"about to go quiet. Re-read before trusting these values.")
    return ""
