"""One machine, two agent hosts, two desks that never touch.

30 Oct, the operator: "if this plugin opened in DeepSeek Harness, it should stay in DeepSeek Harness
only — not linked or connected" to the Hermes one. Before this, the dsh adapter pointed its MCP
server at the SAME console as Hermes (127.0.0.1:8787): one chart, one paper account, one token, one
set of studies, and the in-app study chat shelled out to Hermes. `TRADERS_AGENT_INSTANCE=<name>`
gives a console its own state; the default (unset) is exactly what Hermes has always had.

Shared on purpose: market data and installed tools (tick store, candle caches, downloaded data,
thumbnails, the prop-firm simulator) — they describe the market, not a desk.
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

BACKEND = Path(__file__).resolve().parents[1]


def probe(code: str, home: str, **env) -> dict:
    """Import the console in a fresh interpreter (paths are resolved at import) and print JSON."""
    e = {k: v for k, v in os.environ.items()
         if k not in ("PYTHONPATH", "PYTHONHOME", "TRADERS_AGENT_INSTANCE", "LUXALGO_AGENTS_DIR",
                      "TRADER_PAPER_FILE", "TRADER_CONSOLE_TOKEN_FILE", "HERMES_CLI",
                      "TRADERS_EDGE_HOME", "TRADERS_EDGE_PORT", "TRADERS_AGENT_WORKDIR")}
    e["HOME"] = home
    e.update(env)
    done = subprocess.run([sys.executable, "-c", f"import sys, json; sys.path.insert(0, r'{BACKEND}'); {code}"],
                          capture_output=True, text=True, env=e, timeout=60)
    if done.returncode != 0:
        return {"_rc": done.returncode, "_err": done.stderr}
    return json.loads(done.stdout.strip().splitlines()[-1])


PATHS = ("import server, edgestats; b = server.get_broker(); "
         "print(json.dumps({'agents': server.AGENTS_ROOT, 'token': str(server.TOKEN_PATH), "
         "'paper': str(b.path), 'chat': server.CHAT_CLI, 'edge': str(edgestats.home()), "
         "'workdir': server._agent_workdir(), 'instance': server.instance.label()}))")


class WhereADeskKeepsItsState(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = self.tmp.name

    def test_unset_is_the_desk_hermes_has_always_had(self):
        p = probe(PATHS, self.home)
        self.assertNotIn("_err", p, p.get("_err"))
        state = Path(self.home) / ".local/state/traders-agent"
        self.assertEqual(p["instance"], "default")
        self.assertEqual(p["token"], str(state / "console.token"))
        self.assertEqual(p["paper"], str(state / "paper.json"))
        self.assertEqual(Path(p["agents"]), (BACKEND.parent / "agents").resolve())
        self.assertTrue(p["chat"].endswith("hermes"), "the default desk still talks to Hermes")
        self.assertEqual(p["edge"], str(Path(self.home) / ".local/share/traders-agent/edge"))

    def test_a_named_desk_keeps_everything_of_its_own(self):
        p = probe(PATHS, self.home, TRADERS_AGENT_INSTANCE="dsh")
        self.assertNotIn("_err", p, p.get("_err"))
        mine = Path(self.home) / ".local/state/traders-agent/instances/dsh"
        self.assertEqual(p["instance"], "dsh")
        self.assertEqual(p["token"], str(mine / "console.token"))
        self.assertEqual(p["paper"], str(mine / "paper.json"))
        self.assertEqual(p["agents"], str(mine / "agents"))
        self.assertEqual(p["workdir"], str(mine / "agents"))
        self.assertEqual(p["edge"], str(Path(self.home) / ".local/share/traders-agent/instances/dsh/edge"))

    def test_a_named_desk_does_not_call_hermes(self):
        p = probe(PATHS, self.home, TRADERS_AGENT_INSTANCE="dsh")
        self.assertEqual(p["chat"], "", "the dsh desk must not shell out to the Hermes CLI")

    def test_an_explicit_cli_or_path_still_wins(self):
        p = probe(PATHS, self.home, TRADERS_AGENT_INSTANCE="dsh", HERMES_CLI="/opt/x/agent",
                  TRADER_PAPER_FILE=self.home + "/p.json")
        self.assertEqual(p["chat"], "/opt/x/agent")
        self.assertEqual(p["paper"], self.home + "/p.json")

    def test_a_bad_name_stops_the_console_with_a_sentence(self):
        for bad in ("../hermes", "Has Space", "x" * 40, "-lead"):
            p = probe(PATHS, self.home, TRADERS_AGENT_INSTANCE=bad)
            self.assertIn("_rc", p, f"{bad!r} was accepted")
            self.assertIn("TRADERS_AGENT_INSTANCE", p["_err"])
            self.assertNotIn("Traceback", p["_err"])

    def test_default_is_a_spelling_of_unset(self):
        self.assertEqual(probe(PATHS, self.home, TRADERS_AGENT_INSTANCE="default")["instance"], "default")

    def test_the_edge_engine_port_follows_the_console_port(self):
        code = "import instance; print(json.dumps([instance.edge_port(8787), instance.edge_port(8788)]))"
        self.assertEqual(probe(code, self.home), [8789, 8789])
        self.assertEqual(probe(code, self.home, TRADERS_AGENT_INSTANCE="dsh"), [8789, 8790])


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TwoDesksOnOneMachine(unittest.TestCase):
    """Two real consoles, as the operator runs them: Hermes's (unset) and dsh's. Nothing one desk
    does may show up in the other."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.procs = []
        cls.ports = {}
        for name in ("default", "dsh"):
            port = free_port()
            env = {k: v for k, v in os.environ.items()
                   if k not in ("PYTHONPATH", "PYTHONHOME", "TRADERS_AGENT_INSTANCE", "LUXALGO_AGENTS_DIR",
                                "TRADER_PAPER_FILE", "TRADER_CONSOLE_TOKEN_FILE")}
            env["HOME"] = cls.tmp.name
            if name != "default":
                env["TRADERS_AGENT_INSTANCE"] = name
            else:   # keep the default desk's chart files out of the repo's own agents/ folder
                env["LUXALGO_AGENTS_DIR"] = str(Path(cls.tmp.name) / "hermes-agents")
            p = subprocess.Popen([sys.executable, str(BACKEND / "server.py"), "--port", str(port), "--no-mcp",
                                  "--frontend", str(BACKEND.parent / "frontend")],
                                 cwd=str(BACKEND), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            cls.procs.append(p)
            cls.ports[name] = port
        for name, port in cls.ports.items():
            for _ in range(100):
                try:
                    cls.get(name, "/api/health")
                    break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError(f"{name} console did not start")

    @classmethod
    def tearDownClass(cls):
        for p in cls.procs:
            p.terminate()
            p.wait(10)
            if p.stderr:
                p.stderr.close()
        cls.tmp.cleanup()

    @classmethod
    def get(cls, name, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{cls.ports[name]}{path}", timeout=5) as r:
            return json.loads(r.read())

    @classmethod
    def post(cls, name, path, body, token):
        req = urllib.request.Request(f"http://127.0.0.1:{cls.ports[name]}{path}", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "X-Trader-Token": token})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())

    def token(self, name):
        return self.get(name, "/api/session")["data"]["token"]

    def test_each_console_says_which_desk_it_is(self):
        self.assertEqual(self.get("default", "/api/health")["data"]["instance"], "default")
        self.assertEqual(self.get("dsh", "/api/health")["data"]["instance"], "dsh")

    def test_the_write_tokens_differ(self):
        a, b = self.token("default"), self.token("dsh")
        self.assertTrue(a and b)
        self.assertNotEqual(a, b, "one token would let either agent write to the other's desk")

    def test_a_token_from_one_desk_is_refused_by_the_other(self):
        req = urllib.request.Request(f"http://127.0.0.1:{self.ports['default']}/api/chart/command",
                                     data=json.dumps({"action": "market", "symbol": "ETHUSDT"}).encode(),
                                     headers={"Content-Type": "application/json", "X-Trader-Token": self.token("dsh")})
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)
        self.assertIn(ctx.exception.code, (401, 403))

    def test_a_chart_command_to_dsh_never_reaches_the_hermes_chart(self):
        sent = self.post("dsh", "/api/chart/command", {"action": "market", "symbol": "ETHUSDT", "wait": 0},
                         self.token("dsh"))
        self.assertTrue(sent.get("ok"), sent)
        dsh_pending = self.get("dsh", "/api/chart/commands?since=0")
        hermes_pending = self.get("default", "/api/chart/commands?since=0")
        self.assertIn("ETHUSDT", json.dumps(dsh_pending))
        self.assertNotIn("ETHUSDT", json.dumps(hermes_pending))

    def test_each_desk_wrote_its_own_token_file(self):
        root = Path(self.tmp.name) / ".local/state/traders-agent"
        a, b = self.token("default"), self.token("dsh")
        self.assertEqual((root / "console.token").read_text().strip(), a)
        self.assertEqual((root / "instances/dsh/console.token").read_text().strip(), b)

    def test_the_dsh_desk_refuses_the_hermes_study_chat(self):
        sys.path.insert(0, str(BACKEND))
        import agents_store                        # noqa: PLC0415
        agents_store.upsert(str(Path(self.tmp.name) / ".local/state/traders-agent/instances/dsh/agents"),
                            {"id": "trend-study", "name": "Trend study", "instruction": "Read the trend."})
        req = urllib.request.Request(f"http://127.0.0.1:{self.ports['dsh']}/api/chat",
                                     data=json.dumps({"agent_id": "trend-study", "message": "hi"}).encode(),
                                     headers={"Content-Type": "application/json", "X-Trader-Token": self.token("dsh")})
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(ctx.exception.code, 503)
        body = json.loads(ctx.exception.read())
        self.assertEqual(body.get("code") or (body.get("error") or {}).get("code"), "chat_unavailable", body)

if __name__ == "__main__":
    unittest.main()


class TheMacServiceIsPerDeskToo(unittest.TestCase):
    """launchd cannot run here, so the source is pinned: a named desk gets its own label, plist and logs."""

    src = (BACKEND.parent / "service-macos.sh").read_text()

    def test_label_and_state_follow_the_instance(self):
        self.assertIn('LABEL="$LABEL.$INSTANCE"', self.src)
        self.assertIn('STATE_DIR="$STATE_DIR/instances/$INSTANCE"', self.src)
        self.assertLess(self.src.index('LABEL="$LABEL.$INSTANCE"'), self.src.index('PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"'),
                        "the plist path must be derived after the label")

    def test_the_plist_carries_the_instance(self):
        self.assertIn("<key>TRADERS_AGENT_INSTANCE</key>", self.src)
