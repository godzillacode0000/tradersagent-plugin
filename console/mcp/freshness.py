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
