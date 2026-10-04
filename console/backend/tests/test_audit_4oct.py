"""Pins for the 4 Oct 2026 audit — each test names the defect it keeps out.

1. A bare ``%`` in an argparse ``help=`` crashed every ``trader-chart`` command on Python 3.14 (argparse
   there validates help strings when the parser is built) while 3.11-3.13 — and CI — stayed green.
2. The ⋯ menu was anchored to a hidden 0-width button in Vela's compact mode (the plugin's default
   620 px pane) and opened at x < 0, off-screen.
3. Four floating fallback buttons printed on top of the chart header and price axis at 620 px.
4. ``/api/agents*`` answered a caller's bad input with a 500 ``internal_error``.
5. CSS variables that nothing defines (``--lx-text-1`` …) made their rules silently do nothing — and the
   first fix for 3 used one, too.
"""
import ast
import glob
import os
import re
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FRONT = os.path.join(ROOT, "console", "frontend")

from test_edgestats_routes import RoutesBase  # noqa: E402


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def _python_sources():
    files = glob.glob(os.path.join(ROOT, "console", "**", "*.py"), recursive=True)
    files += glob.glob(os.path.join(ROOT, "tools", "*.py"))
    files += [os.path.join(ROOT, "console", "bin", n) for n in ("trader-chart", "library-indicator")]
    return [f for f in files if os.path.isfile(f) and "/vendor/" not in f]


class HelpStringsAreFormatSafe(unittest.TestCase):
    """argparse %-formats ``help=``: "95% interval" reads as the ``%i`` conversion. Python 3.14 raises at
    parser build; 3.11-3.13 only on ``--help``. Checked statically so it fails on every interpreter."""

    PARAMS = {k: "x" for k in ("prog", "default", "type", "choices", "metavar", "dest", "const", "nargs", "required")}

    def test_every_help_string_formats(self):
        bad = []
        for path in _python_sources():
            try:
                with open(path, encoding="utf-8") as fh:
                    tree = ast.parse(fh.read())
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                for kw in node.keywords:
                    if kw.arg == "help" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                        try:
                            kw.value.value % self.PARAMS
                        except (ValueError, TypeError, KeyError) as exc:
                            bad.append(f"{os.path.relpath(path, ROOT)}:{node.lineno}  {kw.value.value[:60]!r}  ({exc})")
        self.assertEqual(bad, [], "write a literal percent as %% in help=:\n" + "\n".join(bad))

    def test_the_cli_builds_and_prints_help_on_this_python(self):
        for args in (["--help"], ["edge", "--help"]):
            out = subprocess.run([sys.executable, os.path.join(ROOT, "console", "bin", "trader-chart"), *args],
                                 capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(out.returncode, 0, out.stderr[-400:])
            self.assertIn("usage:", out.stdout)


class StudyWritesRejectBadInputAs400(RoutesBase):
    def post(self, path, body):
        return self.call(path, "POST", body)

    def test_bad_input_is_a_400_not_a_500(self):
        for path in ("/api/agents", "/api/agents/delete", "/api/agents/learning"):
            for body in ({}, {"id": "X"}, {"agent_id": "../etc"}, {"name": 1}):
                status, out = self.post(path, body)
                self.assertEqual(status, 400, f"{path} {body} -> {status} {out}")
                self.assertEqual(out.get("code"), "bad_request")
                self.assertTrue(out.get("error"))

    def test_the_good_path_still_works(self):
        status, out = self.post("/api/agents", {"id": "audit-demo", "name": "Audit demo", "instruction": "x"})
        self.assertEqual(status, 200, out)
        status, out = self.post("/api/agents/delete", {"id": "audit-demo"})
        self.assertEqual(status, 200, out)

    def test_the_token_gate_is_unchanged(self):
        status, _ = self.call("/api/agents", "POST", {}, token=False)
        self.assertIn(status, (401, 403))


class CompactModeDoors(unittest.TestCase):
    def test_a_hidden_more_anchor_is_no_anchor(self):
        src = read("console", "frontend", "workspace.js")
        body = src.split("function openMoreMenu(anchor)", 1)[1].split("const items", 1)[0]
        self.assertRegex(body, r"anchor\.getBoundingClientRect\(\)\.width === 0\)\s*anchor = null",
                         "a 0-width anchor must fall through to the top-right placement")

    def test_edge_fallback_only_when_the_row_is_missing(self):
        src = read("console", "frontend", "edge.js")
        body = src.split("function showFallbackIfNeeded()", 1)[1].split("window.addEventListener", 1)[0]
        self.assertIn("document.querySelector('.vela-widget-topbar')", body)
        self.assertNotIn("getBoundingClientRect", body,
                         "compact mode is reached through the ⋯ menu; a width test brings the overlap back")

    def test_fallback_buttons_are_opaque_and_do_not_wrap(self):
        css = read("console", "frontend", "styles.css")
        rule = re.search(r"\.fallback-strip \.btn\s*\{([^}]*)\}", css)
        self.assertTrue(rule, "the fallback strip's buttons need their own rule")
        self.assertIn("background: var(--lx-surface-2)", rule.group(1))
        self.assertIn("white-space: nowrap", rule.group(1))


class EveryCssVariableIsDefined(unittest.TestCase):
    def test_no_var_points_at_nothing(self):
        css = "".join(read("console", "frontend", os.path.basename(f)) for f in glob.glob(os.path.join(FRONT, "*.css")))
        js = "".join(read("console", "frontend", os.path.basename(f)) for f in glob.glob(os.path.join(FRONT, "*.js")))
        defined = set(re.findall(r"(--lx-[a-z0-9-]+)\s*:", css))
        defined |= set(re.findall(r"setProperty\(\s*['\"](--lx-[a-z0-9-]+)['\"]", js))
        used = set(re.findall(r"var\((--lx-[a-z0-9-]+)", css))
        self.assertEqual(sorted(used - defined), [],
                         "undefined variables make their declaration a silent no-op")


if __name__ == "__main__":
    unittest.main()
