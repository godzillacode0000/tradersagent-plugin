# The desk's surfaces — what of LuxAlgo's app is in ours, and what is next

Status: plan of record, 16 Oct 2026. Written after the paper-trading study (`docs/studies/vela-paper-trading.md`)
and the LuxAlgo repos survey. The operator's ask that produced it: *"implement all these except Quant —
paper trading can. Our plugin is also an app, so fit all these properly into the Trader's Agent plugin."*

LuxAlgo's own app is the assembly of their open-source pieces plus two hosted ones. This is that map with
our column filled in, so nothing on the list is forgotten and nothing is claimed that is not built.

| LuxAlgo surface (their app) | Their piece | Ours — status |
|---|---|---|
| The chart (Vela + PineTS + the Library) | Vela (Apache-2.0), vela-pinets/PineTS (AGPL), luxalgo-mcp-server | **Shipped** — vendored chart, drawer, script pane, agent doors, 56 MCP tools |
| Edge analytics ("how often did this happen") | edge-stats (MIT) | **Shipped** — the Edge sheet + 8 `edgestats_*` tools, local engine |
| Paper account + paper trading | hosted (their bundle: `api/trading/paper/*`) | **Shipped** — the paper broker (`broker_*`: propose → the card approves) + **the desk sheet's Paper view (16 Oct)** |
| Journal — metrics, calendar, Edge Score | trade-journal (MIT) | **Partly shipped (16 Oct)** — the desk sheet's Journal view: net P&L, win rate, profit factor, avg win/loss, the realised curve, the closed trades, off the broker's own fills. Still missing: the P&L calendar, the per-day breakdown, Edge Score |
| Prop-firm directory + offers | propfirm-sim (MIT) + the hosted directory | **Directory shipped (16 Oct)** — the desk sheet's Prop firms view (`/api/propfirms`, `/api/offers`). **Not yet: the simulator verdicts** (pass rates, EV per attempt) — that needs their engine run locally, the way Edge Stats runs |
| Market trackers (Congress, insiders, contracts, lobbying) | market-trackers (MIT, data CC0) | **Not built.** Needs the market-trackers MCP registered with Hermes, then a Trackers view in the desk sheet — the same shape as Prop firms: read, cite the source, no links out |
| Real broker accounts (read-only) | broker-sdk (MIT, 23 brokers) | **Not built, deliberately last.** Read-only balances/positions would have to come through this console's own backend; keys stay in the local MCP config |
| Whale options flow | whale-options (MIT) | **Not built.** An options vertical only makes sense once the trackers drawer exists |
| Trade relay (alerts → execution) | trade-relay (MIT) | **Won't build.** The desk's design is propose → operator approves; an execution relay removes the brake, which is our feature (see the 24 Sep operator rule: the plugin never leaves Hermes) |
| Quant (the agent in the left column) | hosted | **Not ported on purpose.** The agent IS Hermes, beside the chart — the desk chat work (16 Oct) is the equivalent, and it does not need a second chat product |

## Shipped 16 Oct — the desk sheet

`console/frontend/desk.{js,css}` + the broker's per-trade accounting (`console/backend/broker.py`).
One ⋯ door, three views. The sheet is a reader; the approve/reject brake stays on the order card.
Tests: `test_broker.py::TheJournalReadsTheFillsBack` (the accounting identity),
`test_desk_sheet.py` (the sheet's rules).

## Next, in the order they pay off

1. **Journal calendar + per-day P&L** (fits the existing sheet; no new data source — the fills carry
   `closed` timestamps, so the calendar is a view over what the broker already records).
2. **Prop-firm simulator verdicts** — port the pattern Edge Stats already uses: run
   `@luxalgo/prop-firm-sim-core` locally through a small Python bridge (`console/backend/propfirmsim.py`,
   mirroring `edgestats.py`), feed it the console's own bars, and render its verdict grid in the sheet's
   Prop firms view. Needs an install step like `./install.sh --with-edge` (Node, ~MBs, no key).
3. **Market trackers view** — register the `market-trackers` MCP server with Hermes (it ships one),
   surface its queries through `/api/trackers` in the console backend, and add the view. Every row must
   carry its source the way Edge Stats carries its sample size.
4. **Real-account read-only** (broker-sdk) — the last item, and only read-only: a balance and positions
   pane with no order path.

## The rules every one of these keeps

- Nothing opens a browser or a link. Data comes in through this console's own backend.
- No number without its source: a rate carries its N, a source row carries its citation, a simulator
  verdict carries its attempts and seed.
- The agent proposes; the operator approves. No surface may approve anything except the order card.
