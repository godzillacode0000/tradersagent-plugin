/**
 * traders-desk — the Trader's Agent view inside Hermes Desktop.
 *
 * One sidebar row, and what it opens is the chart: the full Vela console that runs locally on port
 * 8787 (LuxAlgo MCP proxy + the Vela workspace shell). The other twelve LuxAlgo projects stay
 * agent-side, invoked on request — nothing here lists them.
 *
 * Contributions:
 *   ROUTES_AREA       the console page — this IS the chart, and the row's click lands on it
 *   SIDEBAR_NAV_AREA  the row itself
 *   PALETTE_AREA      commands: open the console · toggle the reveal on launch
 *   STATUSBAR_AREAS   a chip that opens the console on click, and does the launch reveal
 *
 * One surface per view: the console lives in the PAGE and nothing else renders it. Every trigger
 * (sidebar row, status chip, palette command, launch reveal) NAVIGATES to /trading-desk, which is
 * the app's own way of putting a view in front — landing on that route mounts this page, so one
 * click is enough.
 *
 * What that replaced, and why: the previous revision docked a *second* view through
 * `host.openWorkspace` and left the page as a placeholder. That call still reported success after
 * the app updated to v0.21.3 while the view stayed behind the route — the operator clicked the row
 * and got an empty page ("why didnt show anything"). The console was mounted, just never fronted.
 * One page, one frame, one bridge poll loop.
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
 * The console: one iframe on its own origin, filling the whole pane, under a small honest "starting"
 * overlay that only the frame's own load event clears. A plugin cannot probe a cross-origin server,
 * and inventing a guess would be a lie — so it reports "starting", never "broken".
 *
 * No title bar here on purpose (operator's call, 16 Sep): the console brings its own top row, and a
 * second row above it only stole height from the chart. Opening the console in a real browser moved
 * to the palette ("Trading: open console in browser").
 */
function TradersDeskPage() {
  const [loaded, setLoaded] = useState(false)

  return jsxs('div', {
    style: S.page,
    children: [
      jsxs('div', {
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