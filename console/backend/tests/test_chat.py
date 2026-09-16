"""Chat bridge tests — these never call the real agent; a shell script stands in for the CLI.

The contract: the composed prompt carries the brief, the ledger and the chart context; the reply
is parsed for its Pine block; a failing or hanging CLI is reported as a reason, never an exception.
"""

import os
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import chat


FAKE_CLI = """#!/bin/sh
case " $* " in *" --fail "*) echo "boom" >&2; exit 3;; esac
echo 'Here is your study.'
echo '```pine'
echo '//@version=5'
echo 'indicator("Probe", overlay=true)'
echo 'plot(ta.ema(close, 20), "EMA 20")'
echo '```'
exit 0
"""


class ChatTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.cli = os.path.join(self.dir, "fake-hermes")
        with open(self.cli, "w") as fh:
            fh.write(FAKE_CLI)
        os.chmod(self.cli, os.stat(self.cli).st_mode | stat.S_IEXEC)
        self.agent = {"id": "desk", "name": "Desk", "blurb": "", "instruction": "Be terse.",
                      "skills": [], "toolsets": []}

    def test_compose_prompt_carries_instruction_context_and_learnings(self):
        prompt = chat.compose_prompt(self.agent, "make an FVG tool",
                                     context={"symbol": "BTCUSDT", "timeframe": "1h"},
                                     learnings="## earlier · fvg\nrefused: for-in")
        self.assertIn("Be terse.", prompt)
        self.assertIn("make an FVG tool", prompt)
        self.assertIn("BTCUSDT", prompt)
        self.assertIn("refused: for-in", prompt)

    def test_run_returns_reply_and_flags_the_pine_block(self):
        result = chat.run_agent(self.cli, self.agent, "hello", context={}, timeout=20,
                                workdir=self.dir, resume=None)
        self.assertTrue(result["ok"])
        self.assertIn("Here is your study.", result["reply"])
        self.assertIn('indicator("Probe"', result["pine"])

    def test_run_reports_a_failing_cli_honestly(self):
        result = chat.run_agent(self.cli, self.agent, "hello", context={}, timeout=20,
                                workdir=self.dir, resume=None, extra_args=["--fail"])
        self.assertFalse(result["ok"])
        self.assertIn("exit 3", result["reason"])

    def test_run_times_out_instead_of_hanging(self):
        slow = os.path.join(self.dir, "slow-hermes")
        with open(slow, "w") as fh:
            fh.write("#!/bin/sh\nsleep 5\n")
        os.chmod(slow, os.stat(slow).st_mode | stat.S_IEXEC)
        result = chat.run_agent(slow, self.agent, "hello", context={}, timeout=1,
                                workdir=self.dir, resume=None)
        self.assertFalse(result["ok"])
        self.assertIn("timed out", result["reason"])

    def test_parse_actions_reads_the_agents_chart_directives(self):
        reply = ("Here you go.\nCHART: symbol=ETHUSDT timeframe=15m\nCHART: add supertrend\n"
                 "CHART: screenshot\nCHART: do something odd\n")
        actions = chat.parse_actions(reply)
        self.assertEqual(actions[0], {"kind": "market", "symbol": "ETHUSDT", "timeframe": "15m"})
        self.assertEqual(actions[1], {"kind": "add", "type": "supertrend"})
        self.assertEqual(actions[2], {"kind": "screenshot"})
        self.assertEqual(actions[3]["kind"], "unknown")      # never silently swallowed


if __name__ == "__main__":
    unittest.main()
