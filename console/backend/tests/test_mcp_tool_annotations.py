"""Every MCP tool carries annotations — the machine-readable contract a client reads.

Why this is a test and not a convention: a tool review UI (and the MCP directory that lists this
server) decides what to warn about from `annotations`, and a chart-mutating tool that does not say so
gets called without a second thought. The set is closed and small, so it is pinned here: every tool
declares a title and an explicit `readOnlyHint`, the mutating ones are not read-only, and the tools
that leave this machine (the LuxAlgo Library) are marked `openWorldHint`.

Loaded by path because `console/mcp/server.py` and `console/backend/server.py` share a filename.
Requires `fastmcp` (the MCP wrapper's own dependency, not the console's).
"""

import importlib.util
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
MCP_FILE = os.path.abspath(os.path.join(HERE, "..", "..", "mcp", "server.py"))

try:
    import fastmcp  # noqa: F401
    HAVE_FASTMCP = True
except ImportError:                                             # pragma: no cover
    HAVE_FASTMCP = False

# CI sets this so a missing dependency fails instead of quietly skipping the contract check.
if os.environ.get("TRADER_CHART_REQUIRE_MCP") == "1" and not HAVE_FASTMCP:   # pragma: no cover
    raise RuntimeError("TRADER_CHART_REQUIRE_MCP=1 but fastmcp is not installed — tool annotations "
                       "would have gone unchecked")


def load_mcp():
    spec = importlib.util.spec_from_file_location("td_mcp_server_annotations", MCP_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def hint(annotations, name: str):
    """Read an annotation flag across both spellings.

    MCP SDK v2 renamed the fields to snake_case (`read_only_hint`) and warns when the camelCase alias
    is read; older builds only have the camelCase one. Tests must not care which is installed.
    """
    for attr in (name, name.replace("_hint", "Hint")):
        value = getattr(annotations, attr, None)
        if value is not None:
            return value
    return None


def tools_of(module):
    """name -> tool, however this FastMCP build exposes its registry."""
    manager = getattr(module.mcp, "_tool_manager", None)
    registry = getattr(manager, "_tools", None)
    if isinstance(registry, dict):
        return registry
    import asyncio
    listed = asyncio.run(module.mcp.list_tools())                # pragma: no cover - older builds
    return {t.name: t for t in listed}


@unittest.skipUnless(HAVE_FASTMCP, "fastmcp is not installed (the MCP wrapper's own dependency)")
class ToolAnnotationsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_mcp()
        cls.tools = tools_of(cls.module)

    def ann(self, name):
        tool = self.tools.get(name)
        self.assertIsNotNone(tool, f"tool {name} is gone — update this test with the API")
        annotations = getattr(tool, "annotations", None)
        self.assertIsNotNone(annotations, f"{name} has no annotations")
        return annotations

    def test_the_surface_is_the_expected_size(self):
        # A new tool must be added here deliberately: the contract is the point.
        self.assertGreaterEqual(len(self.tools), 10, sorted(self.tools))
        for name in ("chart_state", "chart_shot", "chart_apply_pine", "chart_add_indicator",
                     "chart_set_market", "chart_draw", "chart_clear", "chart_views"):
            self.assertIn(name, self.tools)

    def test_every_tool_has_a_title_and_an_explicit_read_only_flag(self):
        for name in self.tools:
            annotations = self.ann(name)
            self.assertTrue(getattr(annotations, "title", None), f"{name} has no title")
            self.assertIsNotNone(hint(annotations, "read_only_hint"),
                                 f"{name} leaves readOnlyHint unset — clients then guess")

    def test_read_only_tools_change_nothing(self):
        for name in ("chart_views", "chart_state", "chart_shot"):
            self.assertTrue(hint(self.ann(name), "read_only_hint"), f"{name} should be read-only")

    def test_chart_mutating_tools_say_so(self):
        for name in ("chart_apply_pine", "chart_add_indicator", "chart_set_market",
                     "chart_draw", "chart_clear"):
            annotations = self.ann(name)
            self.assertFalse(hint(annotations, "read_only_hint"), f"{name} changes the chart")
            self.assertTrue(hint(annotations, "destructive_hint"),
                            f"{name} should declare destructiveHint")

    def test_network_tools_are_marked_open_world(self):
        for name in ("library_search", "library_indicator"):
            self.assertTrue(hint(self.ann(name), "open_world_hint"), f"{name} leaves this machine")


if __name__ == "__main__":
    unittest.main()
