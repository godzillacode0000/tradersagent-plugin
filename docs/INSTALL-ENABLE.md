## Install the plugin, and **enable** it

Two steps. Skipping the second is why a correct install can look broken: the pane never appears, the
sidebar row is missing, and nothing says why.

```bash
./install.sh                 # 1. copies plugin/ -> $HERMES_HOME/desktop-plugins/traders-desk/
```

**2. Enable it.** Hermes Desktop ships desktop plugins **off by default** — an installed plugin is
inventoried but contributes nothing until you switch it on. Do that in the app:

* **Capabilities → Plugins** → find **Trader's Agent** → switch it on, or
* the status bar entry once it loads, or
* press `Ctrl+K` → type `plugins` → if the plugin is listed, it is installed; use the row to enable it

Then open it: click the **Trader's Agent** row in the sidebar (or `Ctrl+K` → `Trader's Agent`). The
Vela console pane docks to the **right of the conversation**, keeping Hermes's own chat and composer
on the left.

### Why the pane can stay hidden even when it is enabled

A plugin can be enabled and still not show a pane, for two app-side reasons worth knowing:

| Symptom | Real cause | Fix |
|---|---|---|
| Installed, nothing anywhere | Plugin is `false` in the app's decision store — the default state | Enable it (step 2 above) |
| Row exists, but no pane docks | The app kept its layout zone `minimized: true`; `revealPane()` reports success without clearing it | `Ctrl+K` → **Reload chart pane**, or **Layouts** (`Ctrl+Shift+\`) → reset, or restart the app |

The second one is a known interaction with Hermes Desktop 0.17.0, documented in the "Known Hermes
Desktop interaction" section above. The plugin mitigates it (reveal is attempted twice, and a
dismissable hint says the pane is still hidden), but it cannot clear a flag the app owns.

### Checking it landed

```bash
./install.sh --doctor        # interpreter, console port, service, plugin folder
hermes plugins capabilities  # what the desktop plugin registered
```

`install.sh --doctor` tells you the plugin folder is present. It cannot tell you whether the app has
enabled it — that decision lives in the app, so check **Capabilities → Plugins** when in doubt.
