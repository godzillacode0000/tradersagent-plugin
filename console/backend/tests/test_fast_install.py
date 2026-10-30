"""bin/setup-python.sh (uv-first python setup), console/service-linux.sh and install.sh --all: plans, flags, unit text.

Nothing here downloads anything or touches systemd: setup-python is driven with --print, and the unit is printed."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SETUP = ROOT / "bin" / "setup-python.sh"
SERVICE = ROOT / "console" / "service-linux.sh"
INSTALL = ROOT / "install.sh"
BASH = shutil.which("bash") or "bash"


def _has_mcp():
    try:
        import mcp  # noqa: F401
        return True
    except ImportError:
        return False


def _tools_dir(with_uv, uv_finds_python=True):
    """A PATH with only the few coreutils the script needs, a python3.12 shim, and optionally a stub uv."""
    d = Path(tempfile.mkdtemp())
    for tool in ("env", "date", "dirname", "rm", "mkdir", "sed", "cat", "sleep"):
        src = shutil.which(tool)
        if src:
            (d / tool).symlink_to(src)
    (d / "python3.12").symlink_to(sys.executable)
    if with_uv:
        uv = d / "uv"
        uv.write_text("#!/bin/sh\n" + ("" if uv_finds_python else '[ "$1 $2" = "python find" ] && exit 1\n') + "exit 0\n")
        uv.chmod(0o755)
    return d


def run_setup(*args, path_dir=None, **env):
    e = {k: v for k, v in os.environ.items() if k not in ("PY", "PYTHONPATH", "PYTHONHOME")}
    e.update(env)
    if path_dir is not None:
        e["PATH"] = str(path_dir)
    return subprocess.run([BASH, str(SETUP), *args], capture_output=True, text=True, env=e, timeout=60)


class SetupPython(unittest.TestCase):
    def test_syntax(self):
        for f in (SETUP, SERVICE, INSTALL):
            self.assertEqual(subprocess.run(["bash", "-n", str(f)]).returncode, 0, f)

    def test_uv_plan_pins_a_tested_python_and_the_mcp_range(self):
        d = _tools_dir(with_uv=True)
        r = run_setup("--force", "--print", path_dir=d)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("tool: uv", r.stdout)
        self.assertIn("uv venv --python 3.12", r.stdout)
        self.assertIn("'mcp>=1,<3'", r.stdout)
        # a bare '>=3.11' once let uv pick a 3.14 release candidate whose pydantic could not import
        self.assertNotIn(">=3.11", r.stdout)

    def test_uv_falls_back_to_a_fetched_312_when_none_is_installed(self):
        d = _tools_dir(with_uv=True, uv_finds_python=False)
        r = run_setup("--force", "--print", path_dir=d)
        self.assertIn("uv venv --python 3.12", r.stdout)

    def test_without_uv_it_uses_venv_and_pip(self):
        d = _tools_dir(with_uv=False)
        r = run_setup("--force", "--print", path_dir=d)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("tool: pip", r.stdout)
        self.assertIn("-m venv", r.stdout)
        self.assertIn("-m pip install 'mcp>=1,<3'", r.stdout)

    def test_no_uv_and_no_python_is_a_sentence_not_a_traceback(self):
        d = Path(tempfile.mkdtemp())
        for tool in ("env", "date", "dirname", "sed", "cat"):
            src = shutil.which(tool)
            if src:
                (d / tool).symlink_to(src)
        r = run_setup("--force", "--print", path_dir=d)
        self.assertEqual(r.returncode, 1)
        self.assertIn("no uv and no python 3.11+", r.stderr)

    @unittest.skipUnless(_has_mcp(), "needs the mcp client in this interpreter")
    def test_an_existing_python_with_mcp_is_left_alone(self):
        r = run_setup(PY=sys.executable)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("nothing to install", r.stdout)

    def test_unknown_flag(self):
        self.assertEqual(run_setup("--nope").returncode, 2)


@unittest.skipUnless(sys.platform.startswith("linux"), "the systemd helper is Linux only")
class ServiceLinux(unittest.TestCase):
    def test_unit_text(self):
        r = subprocess.run(["bash", str(SERVICE), "print", "--port", "9123"], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        for needle in ('Environment="PORT=9123"', "Restart=always", "WantedBy=default.target",
                       'ExecStart=/bin/bash "%s"' % (ROOT / "console" / "start.sh")):
            self.assertIn(needle, r.stdout)

    def test_a_named_desk_gets_its_own_unit_and_state(self):
        # 30 Oct: dsh's console runs beside the Hermes one, never replacing its unit or its pid file
        r = subprocess.run(["bash", str(SERVICE), "print", "--port", "8788", "--instance", "dsh"],
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('Environment="TRADERS_AGENT_INSTANCE=dsh"', r.stdout)
        st = subprocess.run(["bash", str(SERVICE), "status", "--port", "1", "--instance", "dsh"],
                            capture_output=True, text=True, timeout=30)
        self.assertIn("traders-agent-dsh.service", st.stdout)
        self.assertIn("instances/dsh/console.log", st.stdout)
        bad = subprocess.run(["bash", str(SERVICE), "print", "--instance", "../x"], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 2)

    def test_the_default_unit_is_unchanged(self):
        st = subprocess.run(["bash", str(SERVICE), "status", "--port", "1"], capture_output=True, text=True, timeout=30)
        self.assertIn("journalctl --user -u traders-agent.service", st.stdout)

    def test_bad_port_and_unknown_command(self):
        self.assertEqual(subprocess.run(["bash", str(SERVICE), "print", "--port", "abc"], capture_output=True, text=True).returncode, 2)
        self.assertEqual(subprocess.run(["bash", str(SERVICE), "frobnicate"], capture_output=True, text=True).returncode, 2)

    def test_detached_start_does_not_hold_the_callers_pipe(self):
        # the recorded pid must be the console itself, and no wrapper may keep the caller's stdout open
        src = SERVICE.read_text()
        self.assertIn('exec env PORT="$PORT"', src)
        self.assertIn('echo $! > "$PIDFILE"', src)


class TheDoctorChecksTheInterpreterTheInstallUsed(unittest.TestCase):
    """30 Oct, a fresh-home run of `./install.sh --all` then `--doctor`: the install started the console with the
    python that HAS the mcp client (3.11), the doctor checked the first 3.11+ on PATH (a 3.14 without it) and
    reported FAIL on a working install — the first thing an agent following AGENTS.md would chase."""

    @unittest.skipIf((ROOT / ".venv").exists(), "a repo .venv wins over PATH; this pins the PATH order")
    def test_a_python_with_mcp_beats_a_newer_one_without(self):
        with tempfile.TemporaryDirectory() as d:
            stub = Path(d)
            (stub / "python3.14").write_text('#!/bin/sh\ncase "$*" in *"import mcp"*) exit 1;; esac\nexit 0\n')
            (stub / "python3.11").write_text("#!/bin/sh\nexit 0\n")
            for f in stub.iterdir():
                f.chmod(0o755)
            env = {"HOME": d, "PATH": f"{stub}:/usr/bin:/bin", "TERM": "dumb", "PORT": "1"}
            r = subprocess.run(["bash", str(INSTALL), "--doctor"], capture_output=True, text=True, env=env, timeout=60)
            self.assertIn(f"console python: {stub}/python3.11", r.stdout, r.stdout)


class InstallAllFlag(unittest.TestCase):
    def test_help_lists_the_one_command_install(self):
        r = subprocess.run(["bash", str(INSTALL), "--help"], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0)
        for flag in ("--all", "--setup-python", "--service"):
            self.assertIn(flag, r.stdout)

    def test_unknown_flag_still_refuses(self):
        r = subprocess.run(["bash", str(INSTALL), "--nope"], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 2)

    def test_python_step_runs_before_registration_and_service(self):
        src = INSTALL.read_text()
        self.assertLess(src.index("bin/setup-python.sh"), src.index('"$HERE/bin/register-mcp.sh"'))
        self.assertLess(src.index("bin/setup-python.sh"), src.index("SERVICE_SH="))


if __name__ == "__main__":
    unittest.main()
