"""adapters/dsh/install-dsh.sh: skill copy, MCP entry merge (other servers kept, backup made), uninstall, bad JSON refused.

30 Oct: dsh gets a desk of its OWN by default (TRADERS_AGENT_INSTANCE=dsh on port 8788), so nothing the
dsh agent does reaches the Hermes desk on 8787 — `--shared` is the explicit way back to one desk.
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[3] / "adapters" / "dsh" / "install-dsh.sh"
BACKEND = Path(__file__).resolve().parents[1]


_STUB = tempfile.mkdtemp()
_uvx = Path(_STUB) / "uvx"
_uvx.write_text("#!/bin/sh\nexit 0\n")
_uvx.chmod(0o755)


def run(*args, **env):
    # A stub uvx on PATH: the installer picks it and never tries to build a venv (no network in tests).
    e = {k: v for k, v in os.environ.items()
         if k not in ("LUXALGO_CONSOLE", "PY", "PORT", "TRADERS_AGENT_INSTANCE", "DSH_INSTANCE")}  # other tests set these
    e.update(TRADERS_MCP_VENV="/nonexistent/venv", PATH=_STUB + os.pathsep + e["PATH"], HOME=_STUB, **env)
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

    def entry(self, *args, **env):
        cfg = self.t / "e.json"
        r = run("--skills-dir", str(self.t / "skills"), "--mcp-file", str(cfg), *args, **env)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(cfg.read_text())["mcpServers"]["traders-chart"], r.stdout

    def test_dsh_gets_its_own_desk_by_default(self):
        e, out = self.entry()
        self.assertEqual(e["env"]["LUXALGO_CONSOLE"], "http://127.0.0.1:8788",
                         "the dsh agent must talk to dsh's console, not the Hermes one on 8787")
        self.assertIn("desk of its own", out)
        self.assertIn("--console", out)

    def test_shared_is_the_explicit_way_back_to_the_hermes_console(self):
        e, out = self.entry("--shared")
        self.assertEqual(e["env"]["LUXALGO_CONSOLE"], "http://127.0.0.1:8787")
        self.assertIn("same chart and paper account", out)

    def test_shared_cannot_start_or_install_a_console(self):
        self.assertEqual(run("--shared", "--console").returncode, 2)
        self.assertEqual(run("--shared", "--service").returncode, 2)

    def test_a_bad_desk_name_is_refused(self):
        self.assertEqual(run("--skills-dir", str(self.t / "s"), DSH_INSTANCE="../hermes").returncode, 2)

    def test_console_and_service_start_dshs_own_desk(self):
        src = SCRIPT.read_text()
        self.assertIn('exec env TRADERS_AGENT_INSTANCE="$INSTANCE" PORT="$PORT" bash "$REPO/console/start.sh"', src)
        self.assertIn('exec env TRADERS_AGENT_INSTANCE="$INSTANCE" PORT="$PORT" bash "$SERVICE_SH" install', src)

    def test_uninstall_only_touches_dshs_own_service(self):
        src = SCRIPT.read_text()
        self.assertIn('env TRADERS_AGENT_INSTANCE="$INSTANCE" bash "$SERVICE_SH" uninstall', src)
        self.assertIn('if [[ -n "$INSTANCE" ]]; then\n    env TRADERS_AGENT_INSTANCE', src)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TheDoctorKnowsWhichDeskItFound(unittest.TestCase):
    """Answering is not enough: a console on dsh's port that is the HERMES desk would mean the dsh
    agent drives the Hermes chart. The doctor reads /api/health's `instance` and says so."""

    def console(self, home, instance):
        port = _free_port()
        env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME", "TRADERS_AGENT_INSTANCE")}
        env.update(HOME=home, LUXALGO_AGENTS_DIR=os.path.join(home, "agents-" + (instance or "default")))
        if instance:
            env["TRADERS_AGENT_INSTANCE"] = instance
        p = subprocess.Popen([sys.executable, str(BACKEND / "server.py"), "--port", str(port), "--no-mcp",
                              "--frontend", str(BACKEND.parent / "frontend")], cwd=str(BACKEND), env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: (p.terminate(), p.wait(10)))
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1).read()
                return port
            except OSError:
                time.sleep(0.1)
        self.fail("console did not start")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_the_hermes_desk_on_dshs_port_is_a_failure(self):
        port = self.console(self.tmp.name, None)
        r = run("--doctor", PORT=str(port))
        self.assertIn("is the 'default' desk, not 'dsh'", r.stdout)
        self.assertEqual(r.returncode, 1)

    def test_dshs_own_desk_passes_that_check(self):
        port = self.console(self.tmp.name, "dsh")
        r = run("--doctor", PORT=str(port))
        self.assertIn("(desk: dsh)", r.stdout)


if __name__ == "__main__":
    unittest.main()
