"""The extra indicator scripts: the licence gate + manifest ↔ files.

Bundling third-party Pine is only allowed for permissive licences (the project rule: MIT/Apache-
style only; never GPL, never an unlicensed source). This test is that gate, plus the checks that
keep the manifest, the files, the licence texts and THIRD-PARTY.md from drifting apart.
"""
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, "..", "..", "frontend"))
EXTRA = os.path.join(FRONTEND, "extra")
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
ALLOWED = ("MIT", "MPL-2.0")


def read(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


class ExtraScripts(unittest.TestCase):
    def manifest(self):
        return json.loads(read(os.path.join(EXTRA, "extra-scripts.json")))

    def test_manifest_lists_only_permissive_licences(self):
        for s in self.manifest()["scripts"]:
            self.assertIn(
                s["licence"], ALLOWED, f"{s['slug']}: licence {s['licence']} is not bundleable"
            )

    def test_every_listed_file_exists_and_is_pine_v6(self):
        for s in self.manifest()["scripts"]:
            path = os.path.join(EXTRA, s["file"])
            self.assertTrue(os.path.isfile(path), f"missing {s['file']}")
            src = read(path)
            self.assertIn("//@version=6", src, f"{s['file']}: not a v6 script")
            self.assertIn("indicator(", src, f"{s['file']}: no indicator() declaration")

    def test_licence_text_travels_with_the_scripts(self):
        texts = [f for f in os.listdir(EXTRA) if f.startswith("LICENSE-")]
        self.assertTrue(texts, "no licence text beside the bundled scripts")
        for s in self.manifest()["scripts"]:
            want = "MIT" if s["licence"] == "MIT" else "Mozilla Public License"
            found = any(want in read(os.path.join(EXTRA, t)) for t in texts)
            self.assertTrue(found, f"{s['slug']}: no licence text containing {want!r}")

    def test_third_party_names_every_script(self):
        tpd = read(os.path.join(REPO, "THIRD-PARTY.md"))
        for s in self.manifest()["scripts"]:
            self.assertIn(s["slug"], tpd, f"THIRD-PARTY.md does not mention {s['slug']}")

    def test_the_extra_section_never_gains_a_gpl_row(self):
        tpd = read(os.path.join(REPO, "THIRD-PARTY.md"))
        if "## Extra indicator scripts" not in tpd:
            self.fail("THIRD-PARTY.md has no 'Extra indicator scripts' section")
        section = tpd.split("## Extra indicator scripts")[-1]
        rows = [ln for ln in section.splitlines() if ln.strip().startswith("- **`")]
        self.assertTrue(rows, "the extra section lists no script rows")
        for row in rows:
            self.assertNotIn("GPL", row, f"an extra script row may not be GPL: {row[:60]}")
