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

    def test_catalog_entry_lists_the_same_tools(self):
        """The catalog entry is what a reviewer reads before enabling the plugin."""
        src = _read(CATALOG)
        block = re.search(r"provides_tools:\n((?:\s+-\s+\S+\n)+)", src)
        self.assertIsNotNone(block, "docs/plugin-catalog-entry.yaml has no provides_tools list")
        listed = re.findall(r"-\s+(\S+)", block.group(1) if block else "")
        self.assertEqual(sorted(listed), sorted(mcp_tools()))


if __name__ == "__main__":                                        # pragma: no cover
    unittest.main()
