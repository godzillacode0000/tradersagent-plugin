"""CI sets these so that a missing tool is a FAILURE, not a quiet skip. Without them 155 Node-driven tests (and the MCP layer)
skip themselves when `node` / `fastmcp` is absent and the suite still ends OK (audit 8 Oct, TC-5)."""
import os
import shutil
import unittest


class RequiredToolsAreThere(unittest.TestCase):
    def test_node_is_installed_when_ci_requires_it(self):
        if os.environ.get("TRADER_CHART_REQUIRE_NODE") == "1":
            self.assertTrue(shutil.which("node"), "TRADER_CHART_REQUIRE_NODE=1 but node is not on PATH: 155 tests would skip")

    def test_fastmcp_is_importable_when_ci_requires_it(self):
        if os.environ.get("TRADER_CHART_REQUIRE_MCP") == "1":
            import fastmcp  # noqa: F401  (ImportError is the failure)



class VendoredFilesAreWhatWasRecorded(unittest.TestCase):
    def test_vendor_sums_match(self):
        import subprocess
        import sys
        from pathlib import Path
        tool = Path(__file__).resolve().parents[3] / "tools" / "vendor-sums.py"
        done = subprocess.run([sys.executable, str(tool), "--check"], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr or "tools/vendor-sums.py --write after a deliberate vendor change")


if __name__ == "__main__":
    unittest.main()
