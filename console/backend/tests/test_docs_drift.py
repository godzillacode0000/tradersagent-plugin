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

    The decorator nests parens (`_ann("…", read_only=True)` inside `@mcp.tool(...)`), so this walks
    the source counting depth instead of regex-matching the whole line.
    """
    names = []
    lines = _read(MCP_SERVER).splitlines()
    for index, line in enumerate(lines):
        if not line.lstrip().startswith("@mcp.tool("):
            continue
        depth = 0
        cursor = index
        while cursor < len(lines):
            depth += lines[cursor].count("(") - lines[cursor].count(")")
            if depth <= 0 and cursor > index:
                break
            cursor += 1
        for follow in lines[cursor:cursor + 3]:
            match = re.match(r"\s*(?:async\s+)?def\s+([a-z_][a-z0-9_]*)\s*\(", follow)
            if match:
                names.append(match.group(1))
                break
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
