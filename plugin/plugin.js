/**
 * traders-desk — the Trader's Agent view inside Hermes Desktop.
 *
 * The arrangement he asked for (17 Sep): the chart sits BESIDE Hermes's own chat, never instead of
 * it. The console (the full Vela shell on port 8787) is contributed as a **pane** docked to the
 * right edge of the app's `workspace` pane — the pane that holds the conversation and its composer —
 * so clicking Trader's Agent lands on: chat on the left, chart on the right, chart stretching to the
 * window edge. When the app's session sidebar is open the chart simply gets narrower; it never
 * stops reaching the edge, and the composer keeps its own minimum.
 *
 * Contributions:
 *   PANES_AREA        the console itself — one iframe, docked right of the chat pane
 *   SIDEBAR_NAV_AREA  the row: navigates to the chat, where the chart pane is already beside it
 *   PALETTE_AREA      show/hide the chart pane · toggle the reveal on launch · open in browser
 *   STATUSBAR_AREAS   a chip that brings the chart back if the pane was closed
 *
 * One surface per view: the console lives in the PANE and nothing else renders it. Every trigger
 * (sidebar row, status chip, palette command, launch reveal) either reveals that pane or navigates
 * to the chat — no second frame, no second bridge loop, and a command relayed to a hidden copy can
 * never happen.
 *
 * What this replaced: the console used to be a ROUTES_AREA page, which took the whole window and
 * left no composer beside it. A page cannot host the app's own chat, so the arrangement has to be
 * made of panes — the app's chat pane plus ours.
 *
 * A plugin may not import a chart library, so the console arrives as an iframe on its own origin —
 * same-origin fetches, its own storage, no CORS involved. The id MUST equal this folder name or the
 * loader refuses the plugin, and the file is never compiled, so it uses jsx() calls — never JSX
 * syntax. Colours come from theme vars only, so a skin change cannot break this.
 *
 * Deliberately not in here: the app's wordmark, any repo catalogue, the killzone list
 * (killzones/plugin.js owns that), and no chat composer of its own — the operator types into
 * Hermes's own composer and the agent drives the chart through bin/trader-chart.
 */
import {
  host,
  haptic,
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
const PANE_ID = 'chart'
const PANE_VIEW = `traders-desk:${PANE_ID}`
/* The app's own chat workspace. Landing here puts the composer on screen with our pane beside it. */
const CHAT_ROUTE = '/'
const REVEAL_DELAY_MS = 1500

/**
 * The workspace layout that puts the chart beside the chat.
 *
 * Measured in the app bundle: a layout is a tree of split nodes
 * `{ id, kind: 'row' | 'column', weights, children }` whose leaves are zones
 * `{ id, panes: [paneId, …] }`, and layouts are contributed through the `layouts` area — the same
 * registry the app's own Default / Focus / Terminal deck / Quad presets use. A layout is the only
 * thing that can put the app's chat pane and a plugin pane side by side: contributing a pane alone
 * leaves it unplaced (a registration with no zone never renders, even across a restart, and the
 * Layouts dialog has no tray for unplaced panes).
 *
 * Weights are flex ratios, so the chart keeps the larger share and still shrinks when the session
 * sidebar opens — the chat keeps its own 22vw floor.
 */
const DESK_LAYOUT = {
  id: 'td-root',
  kind: 'row',
  weights: [1, 2.2],
  children: [
    { id: 'td-chat', panes: ['workspace'] },
    { id: 'td-chart', panes: [PANE_VIEW] }
  ]
}

const S = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
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
let autoRevealOn = true
let reveal_attempted = false

/**
 * The app's visibility store for one pane, or null when this build has no such API.
 * Shape (measured in the app bundle): a nanostore — `.get()`, `.set(value)`, `.listen(fn)`.
 */
function paneStore(view = PANE_VIEW) {
  try {
    if (typeof host.paneVisibility === 'function') return host.paneVisibility(view)
  } catch (err) {
    /* fall through: reported as "no store", never faked */
  }
  return null
}

/** Show (or hide) the chart pane. Returns false when the app cannot do it — the caller says so. */
function setChartVisible(visible) {
  const store = paneStore()
  if (store && typeof store.set === 'function') {
    try {
      store.set(!!visible)
      return true
    } catch (err) {
      /* fall through */
    }
  }
  return false
}

/**
 * Bring the desk in front: reveal the chart pane, then navigate to the chat so the composer is on
 * screen next to it. The navigation is the app's own mechanism — there is no second way in.
 */
function openDesk() {
  const revealed = setChartVisible(true)
  try {
    host.navigate(CHAT_ROUTE)
    return revealed
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
 * The console: one iframe on its own origin, filling the pane, under a small honest "starting"
 * overlay that only the frame's own load event clears. A plugin cannot probe a cross-origin server,
 * and inventing a guess would be a lie — so it reports "starting", never "broken".
 *
 * No title bar, no credit strip: the console brings its own top row, and furniture above the chart
 * only steals height from it.
 */
function ChartPane() {
  const [loaded, setLoaded] = useState(false)

  return jsx('div', {
    style: S.page,
    children: jsxs('div', {
      style: S.frameWrap,
      children: [
        jsx('iframe', {
          src: APP_URL,
          title: "Trader's Agent chart console",
          style: S.frame,
          onLoad: () => setLoaded(true)
        }),
        loaded
          ? null
          : jsxs('div', {
              style: S.overlay,
              children: [
                jsx('span', { children: 'Starting the local console…' }),
                jsx('span', { style: S.meta, children: CONSOLE_ORIGIN })
              ]
            })
      ]
    })
  })
}

function DeskChip() {
  const [fronted, setFronted] = useState(false)

  useEffect(() => {
    if (reveal_attempted) return undefined
    reveal_attempted = true
    if (!autoRevealOn) return undefined
    const timer = setTimeout(() => {
      if (autoRevealOn && openDesk()) setFronted(true)
    }, REVEAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  return jsx('button', {
    type: 'button',
    style: S.chip,
    title: 'Open the Trader’s Agent chart beside the chat',
    onClick: () => {
      haptic()
      if (openDesk()) setFronted(true)
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

    ctx.registerMany([
      {
        /* The console, docked to the right of the chat pane: `workspace` is where the conversation
           and its composer live, and `pos: 'right'` puts the chart immediately beside it. Width is
           a fraction, so the chart keeps reaching the window's right edge; the chat keeps its own
           minimum (22vw, the app's own floor) and the two re-split when the sidebar opens. */
        id: PANE_ID,
        area: PANES_AREA,
        title: "Trader's Agent chart",
        data: {
          placement: 'right',
          dock: { pane: 'workspace', pos: 'right', enforce: true },
          width: '58vw',
          minWidth: '24vw',
          collapsible: true
        },
        render: () => jsx(ChartPane, {})
      },
      {
        /* A workspace preset the Layouts dialog offers as a card: chat left, chart right. Applying
           it once is what makes the arrangement — and the app remembers the applied layout. */
        id: 'layout',
        area: 'layouts',
        title: "Trader's Agent",
        order: 5,
        data: DESK_LAYOUT
      },
      {
        /* The chat route: the click lands on the composer with the chart pane already beside it. */
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 40,
        data: { path: CHAT_ROUTE, label: "Trader's Agent", codicon: 'graph' }
      },
      {
        /* Renders at boot, before anything is fronted — so the launch reveal lives here, and it
           doubles as the way back when the chart pane has been closed. */
        id: 'chip',
        area: STATUSBAR_AREAS.right,
        render: () => jsx(DeskChip, {})
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'tradingDesk.open',
          label: "Trading: show the chart beside the chat",
          keywords: ['trading', 'trader', 'vela', 'chart', 'luxalgo', 'desk', 'pane'],
          run: () => openDesk()
        }
      },
      {
        id: 'hide',
        area: PALETTE_AREA,
        data: {
          id: 'tradingDesk.hide',
          label: 'Trading: hide the chart pane',
          keywords: ['trading', 'trader', 'chart', 'hide', 'close', 'pane'],
          run: () => {
            const hidden = setChartVisible(false)
            if (!hidden) {
              host.notify({
                kind: 'warning',
                title: "Trader's Agent",
                message: 'This build has no pane-visibility API — close the pane with its own ✕.'
              })
            }
            return hidden
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
                ? 'The chart pane will open beside the chat when the app starts.'
                : 'Launch reveal is off — the row, the chip and ⌘K still open it.'
            })
          }
        }
      },
      {
        /* The pane is chart-only, so the escape hatch to a real browser window lives here. */
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
    ])

    /* A load beacon (proves a save reaches the running app): console.error reaches ~/.hermes/logs/desktop.log (console.log does not), so a
       plugin the app silently skipped is distinguishable from one that actually loaded. */
    console.error('[traders-desk] loaded — 8 contributions registered')
  }
}
