# Installing Trader's Agent: instructions for AI agents

**If you are an AI agent and your user gave you this repository's link to install, follow this file.**
It is written for you: every command is exact, and each step says what success looks like. A human can
read it too. The README holds the same facts, written for people.

Trader's Agent is a chart-first trading desk:
- a local console on `127.0.0.1` (a Vela chart, the LuxAlgo Library, a paper broker);
- a `traders-chart` MCP server with 56 tools, so you can drive that chart;
- a skill that teaches you to use those tools;
- in Hermes Desktop, a sidebar pane that shows the chart beside the chat.

## Rules

1. **Tell your user what you are about to do, in one short message, before you run anything.** For
   example: "I'll clone it to ~/tradersagent-plugin and run its installer. That sets up a Python
   environment, installs the console as a login service, and registers the chart tools with me. No
   sudo; about a minute." Then proceed unless they object.
2. **Never use `sudo`**, and never edit system files. Everything installs into the user's home folder.
3. **Run only the commands below.** Do not add optional extras (`--with-edge`, `--with-prop`,
   `--with-backtest`) unless the user asks for them. They are large and need Node 20+.
4. **If a step fails, stop.** Show the user the exact error and the matching row under
   [If something fails](#if-something-fails). Do not improvise workarounds.
5. **Keep the clone where you put it.** The console service runs from that folder, so never clone into a
   temporary directory.

## 1. Check the machine

```bash
uname -s                                   # Linux or Darwin (macOS). Windows: stop, it is not supported.
git --version                              # required
command -v uv || python3 --version         # uv, OR a Python 3.11+ (one of the two is enough)
curl --version | head -1                   # required
```

Then work out which agent host you are running in:

| Signal | You are in | Go to |
|---|---|---|
| `$HERMES_HOME` is set, or `~/.hermes` exists, or `hermes` is on PATH | Hermes Agent / Hermes Desktop | step 3A |
| `dsh` is on PATH, or your user says DeepSeek Harness | DeepSeek Harness | step 3B |
| neither | another agent | step 3C |

## 2. Get the code

```bash
if [ -d ~/tradersagent-plugin/.git ]; then
  git -C ~/tradersagent-plugin pull --ff-only
else
  git clone --depth 1 https://github.com/godzillacode0000/tradersagent-plugin ~/tradersagent-plugin
fi
cd ~/tradersagent-plugin
```

## 3A. Hermes Agent / Hermes Desktop

```bash
./install.sh --all
```

This one command:
1. finds or builds a Python with the `mcp` client (uses `uv` when present);
2. installs the plugin and the desk skill into `$HERMES_HOME` (default `~/.hermes`);
3. installs the console as a login service on port 8787;
4. registers the `traders-chart` MCP server with Hermes;
5. waits until the console answers.

It is safe to run again: it updates in place.

**Success:** it ends with `Done in Ns. The console is answering on http://127.0.0.1:8787.`

Two lines you may also see:
- **`register-mcp.sh: no 'hermes' on PATH — run this once in a terminal where it is:`** followed by a
  `hermes mcp add traders-chart ...` command. If you can run `hermes`, run that exact command.
  Otherwise give it to your user to paste.
- **`note: no systemd user session here — starting the console detached`** means the console is
  running now but will not start again after a reboot. Tell your user.

Then go to step 4.

## 3B. DeepSeek Harness (dsh)

dsh gets a desk of its own: a separate console on port 8788, with its own chart, paper account and
token. It is never linked to a Hermes desk on the same machine.

First find the JSON file where this dsh lists its MCP servers. Check dsh's docs or config folder. If
you cannot find it, ask your user. Do not guess.

```bash
./adapters/dsh/install-dsh.sh --mcp-file /path/to/dsh/mcp.json   # skill + MCP entry (other servers kept, backup made)
./adapters/dsh/install-dsh.sh --service                         # dsh's own console, starts at login
```

If you could not find the MCP file, run `./adapters/dsh/install-dsh.sh` with no flags. It prints the
JSON entry, which your user can paste into dsh's config themselves.

**Success:** `install-dsh.sh` prints `dsh gets a desk of its own ('dsh' on port 8788)`, and `--service`
prints `ok  console running ... on port 8788`.

Then go to step 4.

## 3C. Another MCP-capable agent

There is no ready adapter for your host, and this path is untested. Tell your user so. If they want to
try anyway, use the dsh adapter: it writes a standard stdio MCP entry and runs an isolated desk.

```bash
./adapters/dsh/install-dsh.sh --skills-dir /your/skills/folder   # prints a standard {"mcpServers": {...}} entry
./adapters/dsh/install-dsh.sh --service                          # the console it points at, on port 8788
```

Add the printed entry to your MCP configuration.

## 4. Verify

| Host | Command | Must end with |
|---|---|---|
| Hermes | `./install.sh --doctor` | no `FAIL` lines |
| dsh, or another agent | `./adapters/dsh/install-dsh.sh --doctor` | `all checks passed` |

Lines starting with `--` are optional parts that are not installed. They are not failures.

Then check that the console answers:

```bash
curl -fsS http://127.0.0.1:8787/api/health   # Hermes desk
curl -fsS http://127.0.0.1:8788/api/health   # dsh desk
```

The `instance` field must say `default` for the Hermes desk and `dsh` for the dsh desk.

## 5. Tell your user what is left

You cannot click inside their app, so finish with these steps for them.

**Hermes Desktop:**
1. Press Cmd/Ctrl+K and choose "Reload desktop plugins".
2. Click "Trader's Agent" in the left sidebar. The chart opens beside the chat.
3. If the row is missing: Settings → Plugins → "Trader's Agent" → on.
4. Start a new agent session so it gets the chart tools, then ask: "what is on my chart?"

**DeepSeek Harness:**
1. Restart dsh, or reload its MCP servers and skills.
2. Open http://127.0.0.1:8788/ in a browser to watch the chart.
3. Ask: "what is on my chart?"

## If something fails

| You see | Do this |
|---|---|
| `no python with the 'mcp' client found` | `./bin/setup-python.sh`, then repeat your step 3 command |
| `no uv and no python 3.11+ on PATH` | ask your user to install `uv` (https://docs.astral.sh/uv/) or Python 3.12, then retry |
| `cannot listen on 127.0.0.1:8787` / port in use | another program uses the port. Run `./install.sh --doctor` and show your user the result. Do not kill processes you did not start |
| `console not answering` after install | read the last 30 lines of the log the installer printed (`console.log`, or `journalctl --user -u traders-agent.service -n 30`) and show them |
| `the console on ... is the 'default' desk, not 'dsh'` | dsh's port is taken by the Hermes desk. Run `./adapters/dsh/install-dsh.sh --service` |
| the chart pane says the console is not running | `./console/service-linux.sh status` (Linux) or `./console/service-macos.sh status` (macOS) |
| anything else | stop, and show your user the full error |

## Update and uninstall

```bash
cd ~/tradersagent-plugin && git pull --ff-only && ./install.sh --all     # Hermes: update in place
./install.sh --uninstall                                                 # Hermes: remove plugin and skill (prints what else to undo)
./adapters/dsh/install-dsh.sh --uninstall --mcp-file /path/to/dsh/mcp.json   # dsh: remove skill, entry and dsh's service
```

The user's paper account and settings are left in `~/.local/state/traders-agent/` on purpose.
Uninstalling never deletes them.

## Working on this repository instead?

If you were asked to change this code rather than install it, this file is not your guide. Start with
[`docs/HANDOFF.md`](docs/HANDOFF.md). Run the tests with:

```bash
python3 -m unittest discover -s console/backend/tests
```

Then run the checks in `.github/workflows/ci.yml` before you push.
