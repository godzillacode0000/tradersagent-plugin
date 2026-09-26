/**
 * traders-desk — the Trader's Agent view inside Hermes Desktop.
 *
 * One sidebar row, and what it opens is the chart: the full Vela console that runs locally on port
 * 8787 (LuxAlgo MCP proxy + the Vela workspace shell). The other twelve LuxAlgo projects stay
 * agent-side, invoked on request — nothing here lists them.
 *
 * Contributions:
 *   PLUGIN_PAGE       the landing the row opens: reveals the chart pane, hands the workspace
 *                     back to your open chat — leaves the session alone
 *   PANES_AREA        the chart itself, docked to the right of the conversation
 *   SIDEBAR_NAV_AREA  the row itself
 *   PALETTE_AREA      commands: open the console · reload the chart pane · toggle the reveal on
 *                     launch — all in-app; the operator's rule (24 Sep) is that this plugin
 *                     never leaves Hermes, so no command or button opens an external browser
 *   STATUSBAR_AREAS   a chip that opens the console on click, and does the launch reveal
 *
 * One console, one view: when the chart pane is on screen the page shows a short status card instead
 * of a second frame — two frames would each poll the bridge and could run a chart command twice. And
 * the page renders the console itself whenever the pane is hidden, so a click on the row can never
 * land on an empty page (the 17 Sep failure was a pane that mounted collapsed while the page deferred
 * to it: "nothing shown directly — where is my chart?").
 *
 * When the pane cannot be shown at all (the app kept its layout zone minimized), the page renders the
 * console itself plus a short PaneHint saying so, with the two ways out — never a silent empty page.
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
  useValue,
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
const ROUTE = '/traders-agent'
const REVEAL_DELAY_MS = 1500
/* Panes are addressed as `<pluginId>:<contributionId>` (the app prefixes the plugin id), and this
   one is the chart itself: docked to the RIGHT of the conversation, so the app's own chat keeps the
   left — which is the arrangement the operator asked for on 18 Sep ("left pane = Hermes chat, chart
   on the right"). The desk chat is the session that can actually read the chart: the traders-chart
   MCP tools answer in tens of milliseconds over the console's push channel.
   The id is `chart` and not `console` on purpose: the app remembers a pane's collapsed state by id
   in the renderer's localStorage, and the old id carried a "collapsed" left over from the dock the
   operator rejected on 17 Sep — a fresh id is a fresh placement, contributed collapsed so it only
   opens when the row is clicked (his call, 19 Sep). */
const PANE_ID = 'traders-desk:chart'

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
  /* The pane-hidden note: a thin strip above the fallback console. The operator clicked for a chart
     beside the chat and got the console in the page instead, so he deserves to know why and to have
     both ways out within reach. */
  hint: { display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap',
          padding: '8px 12px', fontSize: '12px',
          borderBottom: '1px solid var(--ui-border, rgba(128,128,128,0.35))',
          background: 'var(--ui-bg-card, transparent)' },
  hintBody: { display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: '240px' },
  hintTitle: { fontSize: '12px', fontWeight: 600 },
  hintText: { fontSize: '11px', opacity: 0.7, lineHeight: 1.5 },
  hintActions: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' },
  hintClose: { font: 'inherit', fontSize: '11px', padding: '2px 6px', cursor: 'pointer',
               background: 'transparent', color: 'inherit', opacity: 0.6,
               border: '1px solid transparent' },
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

/* ctx.storage is handed to us at register time; this shim lets components read the auto-reveal
   setting without threading the context through props. (No ctx.os shim: the operator's rule is
   that this plugin never opens an external browser — 24 Sep.) */
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
/* The watchdog (26 Sep): a frame can die while nobody is looking.
 *
 * An iframe whose load was cut short — the console restarted mid-load — stays blank forever, and a
 * page that never ran cannot act on the console's own reload command. The console's state already
 * carries the heartbeat time (`at`), so the plugin can tell "the chart is quiet" from "the frame is
 * dead" without probing a cross-origin document, and remount through the same reloaders the reveal
 * path uses. Cooldown keeps a genuinely absent chart from turning into a remount loop.
 */
const WATCHDOG_EVERY_MS = 20000
const WATCHDOG_DEAD_S = 75
let watchdogLastBump = 0

function startChartWatchdog() {
  if (startChartWatchdog.started) return
  startChartWatchdog.started = true
  setInterval(async () => {
    try {
      const res = await fetch(CONSOLE_ORIGIN + 'api/chart/state', { cache: 'no-store' })
      if (!res.ok) return                      // console down: the overlay's own message owns that
      const body = await res.json()
      const st = (body && (body.state || body.data)) || body || {}
      const at = Number(st.at || 0)
      if (!at) return                          // nothing ever painted: not ours to fix
      const age = Date.now() / 1000 - at
      if (age <= WATCHDOG_DEAD_S) return
      if (Date.now() - watchdogLastBump < 60000) return
      watchdogLastBump = Date.now()
      console.warn('[traders-desk] chart frame silent for ' + Math.round(age) + 's — remounting the pane')
      reloadChartPane()
    } catch (err) {
      /* console down or offline: the pane's own overlay says so, and it is not a dead frame */
    }
  }, WATCHDOG_EVERY_MS)
}

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

startChartWatchdog()

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

/**
 * Reveal the chart. Called from the page's mount (a user click got us here) and its button.
 *
 * Adoption first, then reveal. A pane the app has dismissed (or a layout template dropped) is not in
 * the layout tree at all, and `revealPane` alone cannot put it back — the dock hint is only honoured
 * when the pane is adopted again. Measured 19 Sep: after a layout reset the sidebar row opened the
 * console as the main page instead of docking the pane, because the pane was gone from the tree.
 */
function adoptAndReveal() {
  try {
    if (typeof host.undismissPane === 'function') host.undismissPane(PANE_ID)
  } catch (err) {
    /* older build without the adoption door */
  }
  try {
    if (typeof host.revealPane === 'function') host.revealPane(PANE_ID)
  } catch (err) {
    /* no pane door on this build: the page falls back to the console frame itself */
  }
}

/**
 * Reveal the chart, twice: now, and once more a beat later.
 *
 * The app adopts contributed panes on its own schedule, so a reveal fired from a page's mount can
 * land while the tree is still being rebuilt — and then the pane stays minimized even though the
 * call "succeeded". Measured 19 Sep 2026 on Hermes Desktop 0.17.0: after Layouts -> Reset, the row's
 * reveal left `{"panes":["traders-desk:chart"],"minimized":true}` in hermes.desktop.layoutTree.v2
 * and the console rendered in the main zone instead of docking beside the chat. The second call
 * catches that window; when even that misses, the page says so instead of pretending (PaneHint).
 *
 * Returns a cancel function so an effect can clean the timer up.
 */
function revealChart() {
  adoptAndReveal()
  const timer = setTimeout(adoptAndReveal, 700)
  return () => clearTimeout(timer)
}

/**
 * The page — where the sidebar row, the status chip and the palette command land.
 *
 * One job: reveal the chart pane. This click IS the explicit user action that justifies it.
 *
 * It deliberately does NOT switch the chat. Until 22 Sep this called openDeskChat(), which jumped the
 * operator into the desk's own session (resolved by id, then by title) every time the row was
 * clicked — so pressing "Trader's Agent" pulled him out of the conversation he was having, which is
 * the "I have to go hunting for it" complaint. The row now leaves his session exactly where it was and
 * only puts the chart beside it; the agent in whatever chat he is already using can read the chart,
 * because the tools are server-side and not scoped to the desk session.
 *
 * If the pane cannot be shown, the page renders the console itself — so a click never lands on an
 * empty page (which is exactly how the 17 Sep version failed).
 */
function TradersDeskPage() {
  const [paneUp, setPaneUp] = useState(paneVisible)

  useEffect(() => {
    let live = true
    const stop = watchPane(setPaneUp)
    revealChart()
    return () => {
      live = false
      if (typeof stop === 'function') stop()
    }
  }, [])

  /**
   * Hand the workspace back to the chat he was in.
   *
   * A contributed route is a FULL PAGE by SDK design ("A route mounts a full page in the
   * workspace pane"), so landing here used to cover his conversation — the report: "where is my
   * chat composer part in the middle?". The card below then claimed his chat was left open while
   * it sat where his composer should be. The row promises reveal-only: once the pane is confirmed
   * on screen, go back to the focused chat, session unchanged.
   *
   * The id is read REACTIVELY (useValue), not once at mount: sessions restore asynchronously, so a
   * cold boot mounts this page while focusedStoredSessionId is still null. The first version read
   * it exactly once — it skipped the navigate, never retried, and clicking the row again did not
   * remount (same path), so the card stuck forever (the 23 Sep 06:08 screenshot, app restarted
   * 05:51). Subscribing means the bounce fires the moment the id arrives, whatever woke this page.
   *
   * `focusedStoredSessionId`, not `activeSessionId`: routes parse STORED ids (routes.ts —
   * routeSessionId reads '/' + durable id), while activeSessionId is a runtime id that lands on
   * a route no parser accepts. Guarded on paneUp: while the pane is hidden this page IS the
   * console fallback (the 17 Sep "where is my chart?" rule) and must stay put. No focused
   * session ever (a full page like Settings): no navigation — the card is the honest answer there.
   */
  const sid = useValue(host.state && host.state.focusedStoredSessionId)
  useEffect(() => {
    if (!paneUp) return
    if (!sid || typeof host.navigate !== 'function') return
    host.navigate('/' + encodeURIComponent(sid))
  }, [paneUp, sid])

  if (!paneUp) {
    return jsxs('div', {
      style: S.page,
      children: [
        jsx(PaneHint, { onRetry: () => { revealChart(); setTimeout(() => setPaneUp(paneVisible()), 1200) } }),
        jsx(ConsoleFrame, {})
      ]
    })
  }
  return jsx(ChartDocked, { note: 'your chat was left open — the chart is beside it' })
}

/**
 * Why the chart is not beside the chat — and the two ways to get it there.
 *
 * Only rendered when the pane API exists and still reports the pane as not visible, i.e. exactly the
 * minimized-zone case; a build without panes at all gets the plain console and no nagging.
 */
function PaneHint({ onRetry }) {
  const [asked, setAsked] = useState(false)
  const [hidden, setHidden] = useState(false)

  if (hidden) return null
  if (typeof host.paneVisibility !== 'function') return null

  return jsxs('div', {
    style: S.hint,
    children: [
      jsxs('div', {
        style: S.hintBody,
        children: [
          jsx('span', { style: S.hintTitle, children: 'The chart pane is not on screen' }),
          jsx('span', {
            style: S.hintText,
            children: 'The app kept this pane minimized in the saved layout, and a reveal request ' +
              'does not always clear that (Hermes Desktop 0.17.0). The console below is the same ' +
              'chart, so nothing is lost — to dock it beside the chat, open Layouts (Ctrl+Shift+\\) ' +
              'and pick a template, or reload the window (Ctrl+R).'
          })
        ]
      }),
      jsxs('div', {
        style: S.hintActions,
        children: [
          jsx('button', {
            type: 'button',
            style: S.cardBtn,
            onClick: () => {
              haptic()
              setAsked(true)
              onRetry()
            },
            children: asked ? 'Asked again…' : 'Ask again'
          }),
          jsx('button', {
            type: 'button',
            style: S.hintClose,
            title: 'Hide this note',
            onClick: () => setHidden(true),
            children: '✕'
          })
        ]
      })
    ]
  })
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
  name: "Trader's Agent",
  register(ctx) {
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