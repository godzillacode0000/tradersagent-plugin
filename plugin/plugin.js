/**
 * traders-desk — the Trader's Agent view inside Hermes Desktop.
 *
 * One sidebar row, and what it opens is the chart: the full Vela console that runs locally on port
 * 8787 (LuxAlgo MCP proxy + the Vela workspace shell). The other twelve LuxAlgo projects stay
 * agent-side, invoked on request — nothing here lists them.
 *
 * Contributions:
 *   PLUGIN_PAGE       the landing the row opens: reveals the chart pane, opens the desk chat
 *   PANES_AREA        the chart itself, docked to the right of the conversation
 *   SIDEBAR_NAV_AREA  the row itself
 *   PALETTE_AREA      commands: open the console · reload the chart pane · toggle the reveal on
 *                     launch · open in a browser
 *   STATUSBAR_AREAS   a chip that opens the console on click, and does the launch reveal
 *
 * One console, one view: when the chart pane is on screen the page shows a short status card instead
 * of a second frame — two frames would each poll the bridge and could run a chart command twice. And
 * the page renders the console itself whenever the pane is hidden, so a click on the row can never
 * land on an empty page (the 17 Sep failure was a pane that mounted collapsed while the page deferred
 * to it: "nothing shown directly — where is my chart?").
 *
 * The chat on the left is the app's own composer on a real Hermes session (the desk chat), and that
 * session reads and drives the chart through the traders-chart MCP tools — not a second composer
 * bolted into this plugin (he removed one of those on 16 Sep).
 *
 * The launch reveal navigates **once per app run**, delayed past boot, so the chart is what the app
 * opens on (he asked for exactly that); he can turn it off with the palette command, and switch away
 * freely afterwards — nothing re-fronts itself later.
 *
 * A plugin may not import a chart library, so the console arrives as an iframe on its own origin —
 * same-origin fetches, its own storage, no CORS involved. The id MUST equal this folder name or the
 * loader refuses the plugin, and the file is never compiled, so it uses jsx() calls — never JSX
 * syntax. Colours come from theme vars only, so a skin change cannot break this.
 *
 * Deliberately not on this page: the app's wordmark, any repo catalogue, the killzone list
 * (killzones/plugin.js owns that), and no chat composer of its own — the operator types into
 * Hermes's own composer and the agent drives the chart through bin/trader-chart.
 */
import {
  host,
  haptic,
  ROUTES_AREA,
  PANES_AREA,
  SIDEBAR_NAV_AREA,
  PALETTE_AREA,
  STATUSBAR_AREAS
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const CONSOLE_ORIGIN = 'http://127.0.0.1:8787/'
/* The console is served without cache validators, so an embedded refresh can keep the previous
   CSS/JS. A stamp per plugin load (i.e. per app start) makes the frame fetch the current files. */
const APP_URL = `${CONSOLE_ORIGIN}?v=${Date.now().toString(36)}`
const ROUTE = '/trading-desk'
const REVEAL_DELAY_MS = 1500
/* Panes are addressed as `<pluginId>:<contributionId>` (the app prefixes the plugin id), and this
   one is the chart itself: docked to the RIGHT of the conversation, so the app's own chat keeps the
   left — which is the arrangement the operator asked for on 18 Sep ("left pane = Hermes chat, chart
   on the right"). The desk chat is the session that can actually read the chart: the traders-chart
   MCP tools answer in tens of milliseconds over the console's push channel.
   The id is `chart` and not `console` on purpose: the app remembers a pane's collapsed state by id
   in the renderer's localStorage, and the old id carried a "collapsed" left over from the dock the
   operator rejected on 17 Sep — a fresh id is a fresh placement (and this one opens by default). */
const PANE_ID = 'traders-desk:chart'
const DESK_TITLE = /trader'?s agent/i
/* The desk study's Hermes session (console/agents/desk/index.json) — the chat whose context and
   tool list are built for this chart. A shortcut for navigation only: on any other install this id
   simply does not exist, the openSession below fails harmlessly, and the title search then a fresh
   chat take over — so nothing machine-specific is required for the plugin to work. */
const DESK_SESSION_ID = '20260915_141502_527bcc'

const S = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
  pane: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
          background: 'var(--ui-bg-card, transparent)' },
  card: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px',
          maxWidth: '520px', height: '100%', justifyContent: 'center' },
  cardTitle: { fontSize: '14px', fontWeight: 600 },
  cardText: { fontSize: '12px', opacity: 0.75, lineHeight: 1.55 },
  cardNote: { fontSize: '11px', opacity: 0.55 },
  cardActions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  cardBtn: { alignSelf: 'flex-start', fontSize: '12px', padding: '6px 10px', cursor: 'pointer',
             borderRadius: '6px', border: '1px solid var(--ui-border, rgba(128,128,128,0.35))',
             background: 'var(--ui-bg-card, transparent)', color: 'var(--ui-text, inherit)' },
  meta: { fontSize: '11px', opacity: 0.65 },
  frameWrap: { position: 'relative', flex: 1, minHeight: 0, background: 'var(--ui-bg-card, transparent)' },
  frame: { border: 0, width: '100%', height: '100%', display: 'block' },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    fontSize: '12px',
    opacity: 0.75,
    pointerEvents: 'none'
  },
  chip: {
    font: 'inherit',
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '999px',
    cursor: 'pointer',
    color: 'inherit',
    border: '1px solid var(--ui-bg-quaternary, rgba(128,128,128,0.35))',
    background: 'transparent'
  }
}

/* ctx.os is handed to us at register time; this shim lets the component call it without threading
   the context through props. Same for the auto-reveal setting. */
let ctx_os_open = () => Promise.resolve(false)
let ctx_storage = null
let autoRevealOn = false      /* off by default: the pane opens on a click, not at boot */
let reveal_attempted = false

/* ONE console, ONE view — and it lives in the PAGE.
   The docked pane that some builds carried is gone (operator's call, 17 Sep: "I click Trader's Agent
   and nothing shown directly — where is my chart?"). The pane mounted at boot, took the console for
   itself, and left the page showing a notice — so a click on the row landed on an empty page while
   the chart sat collapsed in a dock. One view means no double-execution of chart commands as well
   (two live frames would each run `add ema`), so the page keeps the console and nothing else. */

/** Put the console in front: the app's own navigation, so the page mounts and is shown. */
function openConsole() {
  try {
    host.navigate(ROUTE)
    return true
  } catch (err) {
    host.notify({
      kind: 'error',
      title: "Trader's Agent",
      message: String((err && err.message) || err)
    })
    return false
  }
}

/**
 * The console frame: one iframe on its own origin, under a small honest "starting" overlay that only
 * the frame's own load event clears. A plugin cannot probe a cross-origin server, and inventing a
 * guess would be a lie — so it reports "starting", never "broken".
 *
 * No title bar (operator's call, 16 Sep): the console brings its own top row, and a second row above
 * it only stole height from the chart. Opening the console in a real browser lives in the palette.
 */
function ConsoleFrame({ title }) {
  const [loaded, setLoaded] = useState(false)
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    if (loaded) return undefined
    /* A plugin cannot probe a cross-origin server, so this is a wait and not a verdict: after a few
       seconds we stop saying only "starting" and hand over the one command that fixes it. */
    const timer = setTimeout(() => setWaiting(true), 6000)
    return () => clearTimeout(timer)
  }, [loaded])

  return jsxs('div', {
    style: S.frameWrap,
    children: [
      jsx('iframe', {
        src: APP_URL,
        title: title || "Trader's Agent chart console",
        style: S.frame,
        onLoad: () => setLoaded(true)
      }),
      loaded
        ? null
        : jsxs('div', {
            style: S.overlay,
            children: [
              jsx('span', { children: waiting
                ? 'The local console has not answered yet…'
                : 'Starting the local console…' }),
              jsx('span', { style: S.meta, children: CONSOLE_ORIGIN }),
              waiting
                ? jsx('span', { style: S.cardNote, children: "Still nothing? Start it once in a terminal: ./console/start.sh — then reload this pane from the palette." })
                : null
            ]
          })
    ]
  })
}

/**
 * The docked frame can go stale behind our back.
 *
 * A renderer keeps the last painted frame while the view is occluded — and a page that nothing is
 * executing cannot act on the console's own reload command, so the pane can sit on hours-old code
 * while the agent believes it refreshed. (Measured 18 Sep: the pane kept a light chart palette and
 * an old build through six reloads; the backend's heartbeat now carries the build stamp that makes
 * that visible.) So the pane remounts itself: when it is revealed again after being hidden, and on
 * demand from the palette. The chart re-boots in about a second and Vela restores its own workspace.
 */
const paneReloaders = new Set()
let paneWasHidden = false

function reloadChartPane() {
  let bumped = 0
  for (const bump of paneReloaders) {
    try {
      bump()
      bumped += 1
    } catch (err) {
      /* a listener from a torn-down pane */
    }
  }
  return bumped
}

/** The chart, as a pane docked to the right of the conversation. */
function ConsolePane() {
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const bump = () => setGeneration((n) => n + 1)
    paneReloaders.add(bump)
    return () => {
      paneReloaders.delete(bump)
    }
  }, [])

  // Hidden → visible: hand the operator a frame that is actually running. Quick pane-hopping is not
  // a reason to re-boot the chart, so only a frame that *was* out of sight is replaced.
  useEffect(() => {
    const stop = watchPane((visible) => {
      if (!visible) {
        paneWasHidden = true
        return
      }
      if (!paneWasHidden) return
      paneWasHidden = false
      setGeneration((n) => n + 1)
    })
    return () => {
      try {
        if (stop) stop()
      } catch (err) {
        /* the atom went away with the pane */
      }
    }
  }, [])

  return jsxs('div', {
    style: S.pane,
    children: [jsx(ConsoleFrame, { key: 'frame-' + generation, title: "Trader's Agent chart" })]
  })
}

/** Is the chart pane on screen right now? Guarded — an older build may not have the pane door. */
function paneVisible() {
  try {
    const atom = host.paneVisibility ? host.paneVisibility(PANE_ID) : null
    return Boolean(atom && typeof atom.get === 'function' && atom.get())
  } catch (err) {
    return false
  }
}

function watchPane(setVisible) {
  try {
    const atom = host.paneVisibility ? host.paneVisibility(PANE_ID) : null
    if (!atom || typeof atom.listen !== 'function') return null
    return atom.listen((visible) => setVisible(Boolean(visible)))
  } catch (err) {
    return null
  }
}

/** Reveal the chart. Called from the page's mount (a user click got us here) and its button. */
function revealChart() {
  try {
    if (typeof host.revealPane === 'function') host.revealPane(PANE_ID)
  } catch (err) {
    /* no pane door on this build: the page falls back to the console frame itself */
  }
}

/**
 * Put the chart-aware chat in front.
 *
 * The desk session is the one that carries the study's context and can call the chart tools, so the
 * row opens THAT chat rather than a blank one. Resolution ladder: the study's own session id (a
 * navigation shortcut with a fallback, never an identity claim — a stale id cannot dangle), then a
 * title search in the session list, then a fresh chat.
 */
async function openDeskChat() {
  const failures = []

  if (DESK_SESSION_ID) {
    try {
      await host.openSession(DESK_SESSION_ID)
      return 'desk chat in front'
    } catch (err) {
      failures.push('id')
    }
  }

  try {
    const profile = (host.state && host.state.profile && host.state.profile.get && host.state.profile.get()) || 'default'
    const page = await host.listPersistedSessions(null, { profile, limit: 60 })
    const rows = (page && page.sessions) || []
    const desk = rows.find((row) => row && DESK_TITLE.test(String(row.title || '')))
    if (desk && desk.id) {
      await host.openSession(desk.id)
      return 'desk chat in front'
    }
    failures.push('title')
  } catch (err) {
    failures.push('list')
  }

  try {
    host.newChat()
    return 'a fresh chat is in front'
  } catch (err) {
    return 'chat unchanged (' + failures.join(', ') + ')'
  }
}

/**
 * The page — where the sidebar row, the status chip and the palette command land.
 *
 * Two things, in order: reveal the chart pane (this click IS the explicit user action that justifies
 * it), and put the desk chat in front. If the pane cannot be shown, the page renders the console
 * itself — so a click never lands on an empty page (which is exactly how the 17 Sep version failed).
 */
function TradersDeskPage() {
  const [paneUp, setPaneUp] = useState(paneVisible)
  const [note, setNote] = useState('opening the desk chat…')

  useEffect(() => {
    let live = true
    const stop = watchPane(setPaneUp)
    revealChart()
    openDeskChat()
      .then((text) => {
        if (live) setNote(text)
      })
      .catch(() => {})
    return () => {
      live = false
      if (typeof stop === 'function') stop()
    }
  }, [])

  if (!paneUp) return jsx('div', { style: S.page, children: jsx(ConsoleFrame, {}) })
  return jsx(ChartDocked, { note })
}

/** Shown when the chart is already docked right: the chat owns the left, and this says so. */
function ChartDocked({ note }) {
  return jsxs('div', {
    style: S.card,
    children: [
      jsx('div', { style: S.cardTitle, children: 'Chart docked on the right' }),
      jsx('div', {
        style: S.cardText,
        children: 'The Vela console is in the pane beside this chat. Ask here — the agent reads the ' +
          'chart with the traders-chart tools (chart_state, chart_shot, chart_apply_pine, ' +
          'library_search) and commands land in tens of milliseconds.'
      }),
      jsx('div', { style: S.cardNote, children: note }),
      jsxs('div', {
        style: S.cardActions,
        children: [
          jsx('button', {
            type: 'button',
            style: S.cardBtn,
            onClick: () => {
              haptic()
              revealChart()
            },
            children: 'Show the chart pane'
          }),
          jsx('button', {
            type: 'button',
            style: S.cardBtn,
            onClick: () => {
              haptic()
              ctx_os_open(CONSOLE_ORIGIN)
            },
            children: 'Open in a browser'
          })
        ]
      })
    ]
  })
}

function DeskChip() {
  const [fronted, setFronted] = useState(false)

  useEffect(() => {
    if (reveal_attempted) return undefined
    reveal_attempted = true
    if (!autoRevealOn) return undefined
    const timer = setTimeout(() => {
      if (autoRevealOn && openConsole()) setFronted(true)
    }, REVEAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  return jsx('button', {
    type: 'button',
    style: S.chip,
    title: 'Open the Trader’s Agent chart',
    onClick: () => {
      haptic()
      if (openConsole()) setFronted(true)
    },
    children: fronted ? "Trader's Agent ●" : "Trader's Agent"
  })
}

export default {
  id: 'traders-desk',
  name: 'Trading Desk',
  register(ctx) {
    if (ctx.os) ctx_os_open = (url) => ctx.os.openExternal(url)

    if (ctx.storage) {
      ctx_storage = ctx.storage
      Promise.resolve(ctx.storage.get('autoReveal'))
        .then((value) => {
          autoRevealOn = value !== false
        })
        .catch(() => {})
    }

    const CONTRIBUTIONS = [
      {
        /* The row's route, and the console itself: landing here IS seeing the chart. */
        id: 'page',
        area: ROUTES_AREA,
        data: { path: ROUTE },
        render: () => jsx(TradersDeskPage, {})
      },
      {
        /* The chart beside the conversation: the app's chat keeps the left, the chart reads on the
           right. Closed until the operator asks for it (his call, 19 Sep): the pane used to open with
           the app, and "only show when I click Trader's Agent" is the behaviour he wants. The row's
           landing (`revealPane` below) is the way in, and the app remembers the state after that. */
        id: 'chart',
        area: PANES_AREA,
        title: "Trader's Agent",
        data: { placement: 'right', dock: { pane: 'workspace', pos: 'right' },
                width: '620px', defaultCollapsed: true },
        render: () => jsx(ConsolePane, {})
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 40,
        data: { path: ROUTE, label: "Trader's Agent", codicon: 'graph' }
      },
      {
        /* Renders at boot, before anything is fronted — so the launch reveal lives here, and it
           doubles as the click-to-open affordance. */
        id: 'chip',
        area: STATUSBAR_AREAS.right,
        render: () => jsx(DeskChip, {})
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'tradingDesk.open',
          label: "Trading: open Trader's Agent",
          keywords: ['trading', 'trader', 'vela', 'chart', 'luxalgo', 'desk'],
          run: () => openConsole()
        }
      },
      {
        id: 'reloadPane',
        area: PALETTE_AREA,
        data: {
          id: 'tradingDesk.reloadPane',
          label: 'Trading: reload the chart pane',
          keywords: ['trading', 'trader', 'chart', 'reload', 'refresh', 'pane', 'stale', 'frame'],
          run: () => {
            const bumped = reloadChartPane()
            host.notify({
              kind: bumped ? 'info' : 'error',
              title: "Trader's Agent",
              message: bumped
                ? 'Chart pane reloading — the console boots in a second.'
                : 'No chart pane is mounted right now; open Trader’s Agent first.'
            })
          }
        }
      },
      {
        id: 'toggleAutoReveal',
        area: PALETTE_AREA,
        data: {
          id: 'tradingDesk.autoReveal',
          label: 'Trading: toggle chart reveal on launch',
          keywords: ['trading', 'trader', 'chart', 'launch', 'startup', 'auto', 'reveal'],
          run: () => {
            autoRevealOn = !autoRevealOn
            if (ctx_storage) {
              Promise.resolve(ctx_storage.set('autoReveal', autoRevealOn)).catch(() => {})
            }
            host.notify({
              kind: 'info',
              title: "Trader's Agent",
              message: autoRevealOn
                ? 'The console will open by itself when the app starts.'
                : 'Launch reveal is off — the row and the chip still open the console.'
            })
          }
        }
      },
      {
        /* The page itself is chart-only now, so the escape hatch to a real browser window lives
           here instead of in a header row above the chart. */
        id: 'openInBrowser',
        area: PALETTE_AREA,
        data: {
          id: 'tradingDesk.browser',
          label: 'Trading: open console in browser ↗',
          keywords: ['trading', 'trader', 'browser', 'external', 'console', 'chrome', 'firefox'],
          run: () => {
            haptic()
            return Promise.resolve(ctx_os_open(CONSOLE_ORIGIN))
          }
        }
      }
    ]
    ctx.registerMany(CONTRIBUTIONS)

    /* A load beacon (proves a save reaches the running app): console.error reaches ~/.hermes/logs/desktop.log (console.log does not), so a
       plugin the app silently skipped is distinguishable from one that actually loaded. The count is
       derived from the list itself — hand-typed counts drifted (a stale "6" outlived the pane's
       removal), and a beacon that lies is worse than no beacon. */
    console.error(`[traders-desk] loaded — ${CONTRIBUTIONS.length} contributions registered`)
  }
}