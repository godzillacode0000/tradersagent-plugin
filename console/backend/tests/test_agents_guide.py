"""AGENTS.md — the install guide an AI agent follows when its user hands it this repository's link.

An agent follows it literally, so every flag it runs must exist and every message it is told to look
for must be one the scripts really print. These tests read the guide and the scripts side by side, so
a renamed flag or a reworded message fails here instead of stranding an agent mid-install.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GUIDE = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")
INSTALL = (ROOT / "install.sh").read_text(encoding="utf-8")
DSH = (ROOT / "adapters" / "dsh" / "install-dsh.sh").read_text(encoding="utf-8")
SOURCES = "\n".join(p.read_text(encoding="utf-8") for p in [
    ROOT / "install.sh", ROOT / "adapters/dsh/install-dsh.sh", ROOT / "bin/register-mcp.sh",
    ROOT / "bin/setup-python.sh", ROOT / "console/service-linux.sh", ROOT / "console/service-macos.sh",
    ROOT / "console/backend/server.py"])


def flags(script: str) -> set:
    """The options a script's case statement accepts."""
    return set(re.findall(r"^\s+(--[a-z][a-z-]*)\)", script, re.M)) | set(re.findall(r"\|(--[a-z][a-z-]*)\)", script))


class TheGuideIsFoundFirst(unittest.TestCase):
    def test_the_readme_points_agents_at_it_near_the_top(self):
        head = "\n".join(README.splitlines()[:30])
        self.assertIn("If you are an AI agent", head)
        self.assertIn("(AGENTS.md)", head)

    def test_the_guide_says_who_it_is_for(self):
        self.assertIn("If you are an AI agent", GUIDE.splitlines()[2])


class EveryCommandExists(unittest.TestCase):
    def test_install_sh_flags(self):
        used = set(re.findall(r"\./install\.sh ((?:--[a-z-]+ ?)+)", GUIDE))
        used = {f for group in used for f in group.split()}
        self.assertTrue(used, "the guide runs install.sh")
        self.assertLessEqual(used, flags(INSTALL), used - flags(INSTALL))

    def test_install_dsh_flags(self):
        used = {f for group in re.findall(r"install-dsh\.sh((?: --[a-z-]+(?: /\S+)?)+)", GUIDE)
                for f in re.findall(r"--[a-z-]+", group)}
        self.assertTrue(used)
        self.assertLessEqual(used, flags(DSH), used - flags(DSH))

    def test_the_scripts_it_names_are_in_the_repo(self):
        for rel in ("bin/setup-python.sh", "console/service-linux.sh", "console/service-macos.sh",
                    "adapters/dsh/install-dsh.sh", "install.sh"):
            self.assertIn(rel.split("/")[-1], GUIDE)
            self.assertTrue((ROOT / rel).is_file(), rel)


class EveryMessageItWaitsForIsReal(unittest.TestCase):
    def test_success_and_trouble_lines_are_printed_by_the_scripts(self):
        for msg in ("Done in", "The console is", "register-mcp.sh: no 'hermes' on PATH",
                    "note: no systemd user session here", "dsh gets a desk of its own",
                    "all checks passed", "no python with the 'mcp' client found",
                    "no uv and no python 3.11+ on PATH", "cannot listen on", "desk, not '",
                    "Reload desktop plugins"):
            self.assertIn(msg, GUIDE, f"the guide no longer mentions {msg!r}")
            self.assertIn(msg, SOURCES, f"the guide waits for {msg!r}, which no script prints")


class ItIsSafeToFollowLiterally(unittest.TestCase):
    def test_no_sudo_in_any_command(self):
        blocks = re.findall(r"```bash\n(.*?)```", GUIDE, re.S)
        self.assertTrue(blocks)
        for b in blocks:
            self.assertNotRegex(b, r"\bsudo\b")

    def test_it_asks_the_agent_to_tell_the_user_first_and_stop_on_failure(self):
        self.assertIn("Tell your user what you are about to do", GUIDE)
        self.assertIn("If a step fails, stop", GUIDE)

    def test_optional_extras_are_opt_in(self):
        self.assertIn("unless the user asks", GUIDE)
        for block in re.findall(r"```bash\n(.*?)```", GUIDE, re.S):
            self.assertNotIn("--with-", block, "the guide must not install the large extras by default")


if __name__ == "__main__":
    unittest.main()
