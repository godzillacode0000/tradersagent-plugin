"""TRADERS_AGENT_ALLOWED_HOSTS must extend LOCAL_HOSTS at import.

The phone path (`tailscale serve` forwards `Host: macmini.tailXXXX.ts.net` to 127.0.0.1:8787)
depends on this hook; a silent drop would only show up as "refused: non-local Host" on Kevin's
phone while localhost keeps working. The env is read once (at import), so each case runs the
import in a subprocess.
"""

import os
import subprocess
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


class AllowedHostsEnvTest(unittest.TestCase):
    def probe(self, value: str) -> str:
        env = dict(os.environ)
        env["TRADERS_AGENT_ALLOWED_HOSTS"] = value
        env.pop("PYTHONPATH", None)      # keep the probe on the venv that runs this suite
        env.pop("PYTHONHOME", None)
        code = (
            "import sys; sys.path.insert(0, r'%s'); import server; "
            "print('macmini.test.example' in server.LOCAL_HOSTS)" % BACKEND
        )
        done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                              env=env, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout.strip()

    def test_extra_host_is_allowed(self):
        self.assertEqual(self.probe("macmini.test.example"), "True")

    def test_lowercased_variant_is_always_added(self):
        self.assertEqual(self.probe("MacMini.Test.Example"), "True")

    def test_empty_value_changes_nothing(self):
        self.assertEqual(self.probe(""), "False")


if __name__ == "__main__":
    unittest.main()
