"""One version, four places that must agree.

The audit's #7 found three different numbers shipping at once — `/api/health` said `1.0.0`, the plugin
manifest `1.2.0`, the catalog entry `1.3.0` — so "which version is this?" had no answer. `VERSION` at
the repo root is now the single source: the console reads it, the manifest and the catalog entry are
held to it here, and a mismatch fails the suite instead of shipping.
"""

import importlib.util
import re
import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent          # console/backend/tests
BACKEND = TESTS.parent                            # console/backend
CONSOLE = BACKEND.parent                          # console
REPO = CONSOLE.parent                             # the repo root


class OneVersion(unittest.TestCase):
    def setUp(self):
        self.version = (REPO / "VERSION").read_text(encoding="utf-8").strip()
        self.assertTrue(re.fullmatch(r"\d+\.\d+\.\d+", self.version), self.version)

    def test_the_plugin_manifest_matches(self):
        manifest = (REPO / "traders-desk" / "plugin.yaml").read_text(encoding="utf-8")
        found = re.search(r"^version:\s*(\S+)", manifest, re.M)
        self.assertEqual(found.group(1), self.version)

    def test_the_catalog_entry_matches(self):
        entry = (REPO / "docs" / "plugin-catalog-entry.yaml").read_text(encoding="utf-8")
        found = re.search(r"^version:\s*\"?([0-9.]+)\"?", entry, re.M)
        self.assertEqual(found.group(1), self.version)

    def test_the_console_reports_it(self):
        spec = importlib.util.spec_from_file_location("td_server_version", BACKEND / "server.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules["td_server_version"] = module
        sys.path.insert(0, str(BACKEND))
        try:
            spec.loader.exec_module(module)
        finally:
            sys.path.pop(0)
        self.assertEqual(module.SERVER_VERSION, self.version)
