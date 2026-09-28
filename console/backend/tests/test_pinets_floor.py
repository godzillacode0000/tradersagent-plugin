"""The Pine engine pin is a floor, not a preference.

What the operator saw, 27 Sep: an indicator applied from the Library mounts, the pane opens — and
stays blank. The engine (pinets 0.9.33, from the page's import map) evaluates BOTH sides of a
ternary, so the guard every LuxAlgo script uses for a rolling array —

    storedCount >= 2 ? array.get(waveVolumeArray, storedCount - 2) : na

— still executes the read on an empty array and throws `Index -2 is out of bounds, array size is 0`.
The script aborts on its first wave, so nothing is drawn. Reproduced through the console's own door
(`trader-chart apply`), then proven minimal: `1 == 2 ? array.get(arr, -5) : 7` crashes the engine
although the guarded branch cannot be reached. 0.10.0 honours the guard; the same Library script
then runs and draws four series.

Two things must stay true:

  * **The import map asks for 0.10.0 or newer.** One URL, one line — easy to lose in a rewrite, and
    losing it silently costs every guarded-array script in the Library.
  * **The reason is written down** in THIRD-PARTY.md, next to the pin it explains, so the next person
    to touch the version knows it is not a random bump to be reverted.
"""

import json
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FRONTEND = os.path.join(ROOT, "console", "frontend")
HTML = os.path.join(FRONTEND, "index.html")
THIRD_PARTY = os.path.join(ROOT, "THIRD-PARTY.md")

FLOOR = (0, 10, 0)


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def version_tuple(text: str):
    return tuple(int(part) for part in text.split("."))


def import_map(html: str) -> dict:
    match = re.search(
        r'<script type="importmap">\s*(\{.*?\})\s*</script>', html, re.S
    )
    if not match:
        raise AssertionError("index.html carries no import map")
    return json.loads(match.group(1))["imports"]


class ThePineEnginePin(unittest.TestCase):
    def test_the_import_map_asks_for_the_fixed_engine(self):
        """The engine is either a CDN URL (>= floor) or the vendored file (with its provenance).

        It moved from `pinets@0.10.0` on jsDelivr to `./vendor/pinets/` when the engine was bundled:
        the version is then recorded in PROVENANCE.md next to the file, because a minified bundle
        carries no readable version marker.
        """
        url = import_map(read(HTML)).get("pinets")
        self.assertIsNotNone(url, "the import map no longer maps 'pinets'")

        match = re.search(r"pinets@(\d+\.\d+\.\d+)", url)
        if match:
            self.assertGreaterEqual(
                version_tuple(match.group(1)),
                FLOOR,
                "pinets is pinned below 0.10.0 — that engine runs both sides of a ternary and "
                "kills every guarded array read in the Library (Index -2 is out of bounds)",
            )
            return

        # A local path: the file must be there, and its provenance must name the version.
        path = os.path.normpath(os.path.join(FRONTEND, url))
        self.assertTrue(os.path.isfile(path), f"the import map points at a missing file: {url}")
        self.assertGreater(
            os.path.getsize(path),
            100_000,
            f"{url} is too small to be the engine bundle",
        )
        provenance = read(os.path.join(os.path.dirname(path), "PROVENANCE.md"))
        found = re.search(r"Version\s*\|\s*\*\*(\d+\.\d+\.\d+)\*\*", provenance)
        self.assertIsNotNone(found, f"PROVENANCE.md next to {url} names no version")
        self.assertGreaterEqual(
            version_tuple(found.group(1)),
            FLOOR,
            "the vendored engine is below 0.10.0 — see the ternary note in THIRD-PARTY.md",
        )
        self.assertIn("AGPL-3.0-only", provenance, "PROVENANCE.md must state the licence")
        self.assertIn("github.com/godzillacode0000/PineTS", provenance, "name the fork")
        self.assertTrue(
            os.path.isfile(os.path.join(os.path.dirname(path), "LICENSE")),
            "the AGPL text must travel with the redistributed engine",
        )

    def test_nothing_else_pins_the_engine_below_the_floor(self):
        """A stale copy in a script or a doc is how the old pin comes back.

        Only *pins* count: a version inside a URL (the import map, an installer's curl) or a JSON
        dependency. Prose that names an old version — the note in THIRD-PARTY.md explaining why the
        floor exists — is the record, not a pin, and must not be flagged.
        """
        patterns = (
            re.compile(r"https?://[^\s\"'`()]*(?<![-\w])pinets@(\d+\.\d+\.\d+)"),
            re.compile(r"\"pinets\"\s*:\s*\"(\d+\.\d+\.\d+)\""),
        )
        stale = []
        for base, dirs, files in os.walk(ROOT):
            dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "vendor"}]
            for name in files:
                if not name.endswith((".html", ".js", ".py", ".sh", ".md", ".yaml", ".json")):
                    continue
                path = os.path.join(base, name)
                try:
                    text = read(path)
                except (OSError, UnicodeDecodeError):
                    continue
                for pattern in patterns:
                    for match in pattern.finditer(text):
                        if version_tuple(match.group(1)) < FLOOR:
                            stale.append(
                                f"{os.path.relpath(path, ROOT)} pins pinets@{match.group(1)}"
                            )
        self.assertEqual(
            stale,
            [],
            "an engine pin below the floor survives somewhere:\n  " + "\n  ".join(stale),
        )

    def test_the_reason_sits_next_to_the_pin(self):
        text = read(THIRD_PARTY).replace("*", "")
        self.assertIn("pinets@0.10.0", text)
        self.assertRegex(text, r"both sides of a\s+ternary")
        self.assertIn("out of bounds", text)


if __name__ == "__main__":
    unittest.main()
