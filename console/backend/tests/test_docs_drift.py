"""The README's tool table and the MCP server cannot drift apart.

Why this is a test and not a convention: the table is what a stranger installs against, and the two
ways it rots are both silent — a tool gets added and nobody documents it (a user never calls it), or a
row survives a rename (a user calls a tool that no longer exists). Both are install-day defects in a
plugin whose whole promise is a flawless first run.

Both sides are plain text, so this needs no fastmcp and runs in the stdlib-only suite.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MCP_SERVER = os.path.join(ROOT, "console", "mcp", "server.py")
README = os.path.join(ROOT, "README.md")
CATALOG = os.path.join(ROOT, "docs", "plugin-catalog-entry.yaml")
MCP_TOOLS_DOC = os.path.join(ROOT, "docs", "MCP-TOOLS.md")
MANIFEST = os.path.join(ROOT, "traders-desk", "plugin.yaml")
DESKTOP_ENTRY = os.path.join(ROOT, "traders-desk", "desktop", "plugin.js")
CONSOLE_SERVER = os.path.join(ROOT, "console", "backend", "server.py")

TABLE_HEADER = "| Tool | What it does |"


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def mcp_tools() -> list:
    """Tool names as the decorators declare them, in file order.

    Both loops are tolerant of the ways this file legitimately wraps and quotes:

    * the decorator nests parens (`_ann("…", read_only=True)` inside `@mcp.tool(...)`), so the block
      is walked with a depth counter instead of a regex on one line;
    * a signature may wrap (`def library_list(family: str = "",\\n    sort: str = "", …)`), so the
      `def` is looked for over a small window rather than only the first line after the block;
    * a tool's own docstring quotes a call — `@mcp.tool(` inside chart_batch's help text — which the
      depth walk otherwise counts as a real decorator, swallowing the next tool. Only a line that
      STARTS with the decorator opens a block, and the def window is measured from there.
    """
    names = []
    lines = _read(MCP_SERVER).splitlines()
    index = 0
    while index < len(lines):
        if not lines[index].lstrip().startswith("@mcp.tool("):
            index += 1
            continue
        depth = 0
        cursor = index
        while cursor < len(lines):
            depth += lines[cursor].count("(") - lines[cursor].count(")")
            if depth <= 0 and cursor > index:
                break
            cursor += 1
        # The def sits on the decorator's own line or immediately below it, and its signature may
        # wrap: scan forward from the decorator for the first line that OPENS a definition, which is
        # always before the body's docstring.
        for follow in lines[index:index + 4]:
            match = re.match(r"\s*(?:async\s+)?def\s+([a-z_][a-z0-9_]*)\s*\(", follow)
            if match:
                names.append(match.group(1))
                break
        index = max(cursor, index + 1)
    return names


def readme_tool_rows() -> list:
    """Rows of the README's tool table only — not every backticked cell in the file."""
    lines = _read(README).splitlines()
    try:
        start = lines.index(TABLE_HEADER)
    except ValueError:                                            # pragma: no cover
        return []
    rows = []
    for line in lines[start + 1:]:
        if re.match(r"^\|\s*-{2,}", line):      # the |---|---| separator under the header
            continue
        match = re.match(r"^\|\s*`([a-z_][a-z0-9_]*)`\s*\|", line)
        if not match:
            break
        rows.append(match.group(1))
    return rows


class DocDrift(unittest.TestCase):
    def test_the_table_is_not_empty(self):
        self.assertTrue(readme_tool_rows(), "the README's tool table has gone missing")
        self.assertTrue(mcp_tools(), "no MCP tools found — did the decorators change shape?")

    def test_every_tool_is_documented(self):
        documented = set(readme_tool_rows())
        missing = [name for name in mcp_tools() if name not in documented]
        self.assertEqual(missing, [], f"README tool table is missing: {missing}")

    def test_every_documented_tool_exists(self):
        declared = set(mcp_tools())
        extra = [name for name in readme_tool_rows() if name not in declared]
        self.assertEqual(extra, [], f"README documents tools that do not exist: {extra}")

    def test_catalog_entry_declares_no_tools_of_its_own(self):
        """The catalog entry's `capabilities` must match what the package REGISTERS (rule 6).

        This package is the desktop half — UI contributions, not tools. The 56 chart tools belong
        to the traders-chart MCP server the operator registers separately (bin/register-mcp.sh), so
        the entry claims none of them: the old version of this test asserted the opposite and would
        have shipped a capability-creep entry to review.
        """
        entry = _read(CATALOG)
        self.assertIn("provides_tools: []", entry,
                      "docs/plugin-catalog-entry.yaml must claim no tools (they live in the MCP server)")
        # The manifest agrees, and the loadable entrypoint the catalog requires is really there.
        self.assertTrue(os.path.isfile(MANIFEST), "traders-desk/plugin.yaml has gone missing")
        manifest = _read(MANIFEST)
        self.assertIn("name: traders-desk", manifest)
        self.assertNotRegex(manifest, r"provides_tools:\s*\n\s+-",
                            "the manifest must not declare tools it does not register")
        self.assertTrue(os.path.isfile(DESKTOP_ENTRY), "traders-desk/desktop/plugin.js has gone missing")
        # And the tools themselves are still documented where the agent reads them.
        self.assertIn("chart_objects", _read(MCP_TOOLS_DOC))

    def test_mcp_tools_doc_lists_the_same_tools(self):
        """docs/MCP-TOOLS.md is the third view of the same fact, and it rotted worst.

        Its title still read "(14)" while the server had 27 — the count in a heading is the kind of
        thing nobody re-reads, and a reader trusts it precisely because it is a number.
        """
        src = _read(MCP_TOOLS_DOC)
        documented = set(re.findall(r"^\|\s*`([a-z_][a-z0-9_]*)`\s*\|", src, re.M))
        self.assertTrue(documented, "docs/MCP-TOOLS.md has no tool table rows")
        missing = [name for name in mcp_tools() if name not in documented]
        extra = [name for name in sorted(documented) if name not in set(mcp_tools())]
        self.assertEqual(missing, [], f"docs/MCP-TOOLS.md is missing: {missing}")
        self.assertEqual(extra, [], f"docs/MCP-TOOLS.md documents tools that do not exist: {extra}")

    def test_mcp_tools_doc_heading_matches_the_count(self):
        """The heading promises a number; hold it to the number."""
        src = _read(MCP_TOOLS_DOC)
        match = re.search(r"^#\s+.*\((\d+)\)\s*$", src, re.M)
        self.assertIsNotNone(match, "docs/MCP-TOOLS.md heading no longer carries a tool count")
        self.assertEqual(int(match.group(1)), len(mcp_tools()),
                         "the tool count in docs/MCP-TOOLS.md's heading is stale")


if __name__ == "__main__":                                        # pragma: no cover
    unittest.main()


class OneVersionNumber(unittest.TestCase):
    """The three places that state a version must state the SAME one.

    They rotted apart exactly as you would expect, each for its own reason: `SERVER_VERSION` was
    typed once at 1.0.0 and never touched again (nothing reads it back, so nothing complained),
    while the manifest and the catalog entry are edited by different hands at release time. The
    console then reported `"version": "1.0.0"` on `/api/health`, in `/api/build` and in its own
    `Server:` header while the repo shipped 1.3.0 - a number an agent, a bug report and
    `./install.sh --doctor` all read and believe.

    Deliberately three literals and one test, not one file read at runtime: the console is
    stdlib-only and must not grow an import-time file read (and a fallback value would be the same
    lie with extra steps). Bumping a release means editing all three; this fails loudly until you do.
    """

    def version_of(self, path: str, pattern: str) -> str:
        found = re.search(pattern, _read(path), re.M)
        self.assertIsNotNone(found, f"no version found in {os.path.relpath(path, ROOT)}")
        return found.group(1)

    def test_manifest_catalog_entry_and_console_agree(self):
        manifest = self.version_of(MANIFEST, r'^version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?\s*$')
        catalog = self.version_of(CATALOG, r'^version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?\s*$')
        console = self.version_of(CONSOLE_SERVER, r'^SERVER_VERSION\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"')
        self.assertEqual(
            {"traders-desk/plugin.yaml": manifest,
             "docs/plugin-catalog-entry.yaml": catalog,
             "console/backend/server.py": console},
            {"traders-desk/plugin.yaml": manifest,
             "docs/plugin-catalog-entry.yaml": manifest,
             "console/backend/server.py": manifest},
            "the manifest, the catalog entry and the console must all state one version",
        )
