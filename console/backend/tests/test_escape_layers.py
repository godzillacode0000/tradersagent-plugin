"""One Escape closes ONE layer, topmost first: the library drawer, then the script pane's Settings view,
then the pane. Hermes measured the first step inverted in Desktop (5 Oct): with the drawer open, ONE Escape
closed the pane and left the drawer open, because the drawer check lived in a second handler bound AFTER
escapeKeydown — which had already closed the pane and prevented the event. (The bug dates from the drawer,
3 Oct; PR #4 only added the Settings layer, and its description claimed the whole chain without a test.)

The real handler is lifted out of app.js and run under Node against stand-ins for the three layers, so the
ORDER is what is tested, not the source's shape.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

APP = (Path(__file__).resolve().parents[3] / "console" / "frontend" / "app.js").read_text(encoding="utf-8")
NODE = shutil.which("node")
HANDLER = "function escapeKeydown(ev) {" + APP.split("function escapeKeydown(ev) {", 1)[1].split("\n}\n", 1)[0] + "\n}\n"

HARNESS = """
const state = { drawer: false, settings: false, pane: false };
const window = {
  closeDrawerIfOpen: () => { if (!state.drawer) return false; state.drawer = false; return true; },
  closeScriptLayerIfOpen: () => { if (!state.settings) return false; state.settings = false; return true; },
};
const el = { main: { get dataset() { return { detail: state.pane ? 'on' : 'off' }; } } };
const setPanel = (name, on) => { if (name === 'detail') state.pane = Boolean(on); };
%s
const press = (init = {}) => {
  const ev = { key: 'Escape', defaultPrevented: Boolean(init.prevented), preventDefault() { this.defaultPrevented = true; }, ...init.ev };
  escapeKeydown(ev);
  return { ...state, prevented: ev.defaultPrevented && !init.prevented };
};
"""


def run(scenario: str):
    done = subprocess.run([NODE, "-e", HARNESS % HANDLER + scenario], capture_output=True, text=True, timeout=30)
    if done.returncode != 0:
        raise AssertionError(done.stderr)
    return json.loads(done.stdout)


def chain(drawer=False, settings=False, pane=False, presses=4):
    return run(f"Object.assign(state, {{ drawer: {str(drawer).lower()}, settings: {str(settings).lower()}, pane: {str(pane).lower()} }});"
               f"const out = []; for (let i = 0; i < {presses}; i++) out.push(press()); process.stdout.write(JSON.stringify(out));")


def step(d, s, p, prevented=True):
    return {"drawer": d, "settings": s, "pane": p, "prevented": prevented}


@unittest.skipUnless(NODE, "node is not installed")
class TheChain(unittest.TestCase):
    def test_drawer_then_settings_then_the_pane_then_nothing(self):
        self.assertEqual(chain(True, True, True), [
            step(False, True, True), step(False, False, True), step(False, False, False), step(False, False, False, prevented=False)])

    def test_with_the_pane_open_the_drawer_goes_first_not_the_pane(self):
        """The reported bug: this used to give [drawer open, pane closed]."""
        first = chain(True, False, True, presses=2)
        self.assertEqual(first[0], step(False, False, True))
        self.assertEqual(first[1], step(False, False, False))

    def test_settings_then_the_pane(self):
        self.assertEqual(chain(False, True, True, presses=2), [step(False, False, True), step(False, False, False)])

    def test_the_pane_alone_closes(self):
        self.assertEqual(chain(False, False, True, presses=1), [step(False, False, False)])

    def test_the_drawer_alone_closes_without_touching_the_pane(self):
        self.assertEqual(chain(True, False, False, presses=2), [step(False, False, False), step(False, False, False, prevented=False)])

    def test_with_nothing_open_the_key_is_left_alone(self):
        self.assertEqual(chain(presses=1), [step(False, False, False, prevented=False)])

    def test_another_key_does_nothing(self):
        got = run("Object.assign(state, { drawer: true, settings: true, pane: true });"
                  "process.stdout.write(JSON.stringify(press({ ev: { key: 'Enter' } })));")
        self.assertEqual(got, step(True, True, True, prevented=False))

    def test_a_press_that_is_already_default_prevented_still_closes_the_pane(self):
        """After a click on the chart Vela marks Escape handled. A `defaultPrevented` guard here made
        Escape stop closing the pane (caught by an A/B run in the browser, 5 Oct)."""
        got = run("Object.assign(state, { drawer: false, settings: false, pane: true });"
                  "const ev = { key: 'Escape', defaultPrevented: true, preventDefault() {} };"
                  "escapeKeydown(ev); process.stdout.write(JSON.stringify(state));")
        self.assertEqual(got, {"drawer": False, "settings": False, "pane": False})


if __name__ == "__main__":
    unittest.main()
