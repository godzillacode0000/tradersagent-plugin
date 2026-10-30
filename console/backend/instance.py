"""Which desk this console is — so two agent hosts on one machine never share one.

Unset (or `default`), the console is the desk Hermes has always had: state under
~/.local/state/traders-agent, chart files in console/agents, the in-app study chat through the Hermes
CLI, the Edge Stats engine on 8789. `TRADERS_AGENT_INSTANCE=<name>` (lowercase letters, digits,
dashes) gives a console a desk of its own — 30 Oct, the operator: a desk opened in the DeepSeek
Harness "should stay in DeepSeek Harness only, not linked or connected":

* its token, paper account and chart/study files under ~/.local/state/traders-agent/instances/<name>/
* its Edge Stats workspace under ~/.local/share/traders-agent/instances/<name>/edge, and its engine on
  the console's port + 2 (8788 -> 8790), so two consoles never fight over one sidecar;
* no Hermes study chat unless HERMES_CLI names a CLI on purpose.

The browser keeps layout, theme and saved scripts per origin, and a named desk runs on its own port,
so those are separate too. Market data and installed tools stay shared on purpose — the tick store,
candle caches, downloaded data, thumbnails and the prop-firm simulator describe the market, not a
desk. Every explicit path variable (TRADER_PAPER_FILE, LUXALGO_AGENTS_DIR, ...) still wins.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

ENV = "TRADERS_AGENT_INSTANCE"
_NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
DEFAULT_EDGE_PORT = 8789


class InstanceError(ValueError):
    """The instance name cannot be used as a folder name."""


def name() -> str:
    """'' for the default desk, else the validated instance name."""
    raw = (os.environ.get(ENV) or "").strip()
    if raw in ("", "default"):
        return ""
    if not _NAME.fullmatch(raw):
        raise InstanceError(f"{ENV}={raw!r} is not a desk name: use 1-32 lowercase letters, digits or dashes "
                            "(not starting with a dash), e.g. dsh")
    return raw


def label() -> str:
    return name() or "default"


def state_dir() -> Path:
    """Token, paper account, pid and log — per desk."""
    base = Path.home() / ".local" / "state" / "traders-agent"
    return base / "instances" / name() if name() else base


def share_dir() -> Path:
    """Per-desk data that is NOT market data (the Edge Stats workspace)."""
    base = Path.home() / ".local" / "share" / "traders-agent"
    return base / "instances" / name() if name() else base


def edge_port(console_port: int) -> int:
    """The Edge Stats engine: 8789 for the default desk, the console's port + 2 for a named one."""
    return console_port + 2 if name() else DEFAULT_EDGE_PORT
