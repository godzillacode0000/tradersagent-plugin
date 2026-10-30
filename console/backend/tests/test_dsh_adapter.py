"""adapters/dsh/install-dsh.sh: skill copy, MCP entry merge (other servers kept, backup made), uninstall, bad JSON refused."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[3] / "adapters" / "dsh" / "install-dsh.sh"


_STUB = tempfile.mkdtemp()
_uvx = Path(_STUB) / "uvx"
_uvx.write_text("#!/bin/sh\nexit 0\n")
_uvx.chmod(0o755)


def run(*args, **env):
    # A stub uvx on PATH: the installer picks it and never tries to build a venv (no network in tests).
    e = {k: v for k, v in os.environ.items() if k not in ("LUXALGO_CONSOLE", "PY", "PORT")}  # other tests set these
    e.update(TRADERS_MCP_VENV="/nonexistent/venv", PATH=_STUB + os.pathsep + e["PATH"], **env)
    return subprocess.run(["bash", str(SCRIPT), *args], capture_output=True, text=True, env=e, timeout=60)


class DshAdapter(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.t = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_syntax_and_help(self):
        self.assertEqual(subprocess.run(["bash", "-n", str(SCRIPT)]).returncode, 0)
        h = run("--help")
        self.assertEqual(h.returncode, 0)
        self.assertIn("--mcp-file", h.stdout)

    def test_unknown_flag_is_an_error(self):
        r = run("--nope")
        self.assertEqual(r.returncode, 2)

    def test_install_merges_and_uninstall_removes(self):
        cfg = self.t / "mcp.json"
        cfg.write_text(json.dumps({"mcpServers": {"other": {"command": "x"}}, "keep": 1}))
        r = run("--skills-dir", str(self.t / "skills"), "--mcp-file", str(cfg), PORT="9123")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((self.t / "skills" / "trader-desk" / "SKILL.md").is_file())
        doc = json.loads(cfg.read_text())
        self.assertEqual(doc["keep"], 1)
        self.assertIn("other", doc["mcpServers"])
        e = doc["mcpServers"]["traders-chart"]
        self.assertEqual(e["env"]["LUXALGO_CONSOLE"], "http://127.0.0.1:9123")
        self.assertTrue(e["args"][-1].endswith("console/mcp/server.py"))
        self.assertTrue((self.t / "mcp.json.bak-traders").is_file())
        u = run("--skills-dir", str(self.t / "skills"), "--mcp-file", str(cfg), "--uninstall")
        self.assertEqual(u.returncode, 0, u.stderr)
        self.assertFalse((self.t / "skills" / "trader-desk").exists())
        self.assertEqual(list(json.loads(cfg.read_text())["mcpServers"]), ["other"])

    def test_invalid_json_is_not_overwritten(self):
        cfg = self.t / "bad.json"
        cfg.write_text("{bad")
        r = run("--skills-dir", str(self.t / "s"), "--mcp-file", str(cfg))
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(cfg.read_text(), "{bad")

    def test_bad_port_refused(self):
        self.assertEqual(run("--skills-dir", str(self.t / "s"), PORT="abc").returncode, 2)


if __name__ == "__main__":
    unittest.main()
