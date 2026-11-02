# LuxAlgo's open-source projects, and what each would take to add here

Use this before answering "what else of LuxAlgo's can we use?" — do not re-research from scratch.
Refresh the list with the GitHub API (no auth needed, occasional use is inside the rate limit):

```bash
curl -sS -H "Accept: application/vnd.github+json" \
  "https://api.github.com/orgs/LuxAlgo/repos?per_page=100&sort=pushed" -o /tmp/luxalgo-repos.json
# then print name | stars | language | licence.spdx_id | pushed_at | description and sort by pushed_at
npm view @luxalgo/vela version        # and any other @luxalgo/<pkg> to see what is published
```

Write the JSON to a file first and parse it in Python — piping `curl` straight into a heredoc-fed
script fails with a write error and reads as an "API error" that is not one.

## Already in the plugin — never propose these as new

| Project | Licence | How we use it |
|---|---|---|
| **Vela** (chart core) | Apache-2.0 | vendored in `console/frontend/vendor/vela/dist` |
| **Vela-pinets** (Vela's Pine addon) | AGPL-3.0 | vendored; moves with a Vela bump |
| **PineTS** (Pine runtime) | AGPL-3.0 | the operator's patched fork is vendored — never overwrite it in a Vela bump |
| **luxalgo-mcp-server** | MIT | the console proxies its Library / edge / prop-firm reads as `library_*`, `edge_*`, `propfirm*` |
| **edge-stats** | MIT | the optional LOCAL engine behind `edgestats_*` (bars downloaded on this machine) |

## The rest, in the order they are worth adding

| Project | Licence | Shape | What it gives the desk |
|---|---|---|---|
| **prop-firm-sim** | MIT | `@luxalgo/prop-firm-sim-core` (pure TS, seeded → byte-identical replays, 10k paths ≈ 0.3 s) + `-cli` + **`@luxalgo/prop-firm-sim-mcp`**, all on npm | Monte-Carlo odds for a challenge, per firm: `result.perAttempt.passProbability` with a Wilson CI, `stagnationDays`, optimal risk. Pairs with the existing `propfirms` / `propfirm_offers` reads (they list the offers; this answers "will it pass?"). Drop-in MCP |
| **market-trackers** | MIT (data **CC0**) | ingests 18 primary-source datasets into a local DB (Congress trades, insider filings 3/4/5, 13F, federal contracts/grants, lobbying, FINRA short volume, COT, clinical trials, FDA approvals, FEC, Fed comms, Wikipedia pageviews…), serves them over **its own MCP server** (`tracker_congress_trades`, `tracker_congress_members`, `tracker_member_profile`, `tracker_committees`) and republishes JSON/Parquet dumps with a dependency-light Python reader | "What did Congress buy this week", with a citation back to the filing. CC0 means the dumps can be shipped, not only queried. Drop-in MCP |
| **trade-journal** | MIT | full app (Next.js + SQLite, Node 22 + pnpm) **and** `@luxalgo/journal-core` on npm; Edge Score v2 written up in its `docs/edge-score.md` | The journal half of the paper-parity gap: round-trip trade rebuilding, P&L calendar, equity curve, drawdown/win-rate style metrics, AI reflection. Either run it as a local sidecar and read its SQLite, or port the metric math from journal-core into `console/backend/broker.py` |
| **broker-sdk** | MIT | `@luxalgo/broker-sdk` (Node ≥18.17, zero deps); 23 brokers + CSV import; read-only and local-only by design; `broker-sync` daemon with HMAC-signed webhooks; a React connect kit at `/connect`; **its agent door is the `broker_*` tools inside luxalgo-mcp-server** | Read-only visibility of REAL accounts (Alpaca, IBKR, Schwab, Hyperliquid, tastytrade, Tradier…). Needs the user's keys in the MCP env; order placement is experimental — our propose → operator-approves gate stays in front of it |
| **trade-relay** | MIT | webhook/agent → broker execution relay (Node ≥22) with a documented safety-rails contract | Only if automated execution is ever wanted. Our design is propose → approve, so read it, do not adopt it |
| **whale-options** | MIT | options flow engine (sweeps/blocks/splits, scored with the work shown) | A new vertical: needs options data and a UI. Heaviest item on the list |
| **pinets-cli** | AGPL-3.0 | terminal runner for `.pine` files | Marginal: we run Pine in-page. Possible dev/CI use to execute scripts headlessly |

### prop-firm-sim, measured (the engine's contract)

Probed on this Mac; start a simulator task from this block instead of re-probing the package.

- **Install:** `npm install @luxalgo/prop-firm-sim-cli` into its own directory — the live one is
  `~/.local/share/traders-agent/propfirmsim` (~10 MB, CLI 1.2.0 + core engine 1.3.0; Node 20+, no key,
  no build step). Binary: `node_modules/.bin/prop-firm-sim`.
- **Subcommands:** `firms`, `rules <firm> <challengeId>`, `simulate`, `optimal-risk`, `compare`
  (refs like `ftmo/<challengeId>`), `overlap` (2–5 trade logs).
- **`simulate`** reads the live directory (`--firm --challenge`) or an offline `--spec <file>`. Inputs:
  parametric (`--winrate --avg-win --avg-loss --trades-per-day --risk [--risk-mode]`), a raw R series
  (`--r-series "1.6,-1,0.8"` / `--r-series-file`, `--block-length`), or imported exports
  (`--trade-log <file>` up to 5 to merge a portfolio; `--import-risk` for files carrying P&L but no
  risk). Options: `--paths --seed --attempt-cap --funded-horizon --no-funded --json`.
- **`--json` is the contract to parse.** Top-level: `schemaVersion, engineVersion, perAttempt,
  journey, funded, ev, drawdown, assumptions, meta`. Inside: `perAttempt.passProbability` with
  `passProbabilityCi` (Wilson), `failureBreakdown`, `steps`, `avgDaysWhenPassed/Failed`,
  `stagnationDays`; `journey.{fundedProbability, attempts, cost, daysToFunded}`;
  `funded.{payoutProbability, blownProbability, avgPayoutEvents, daysToFirstPayout}`;
  `ev.{evTotal, evStandardError, pPositive}`; `drawdown.maxDrawdownPct`;
  `assumptions.{spec, profile, options, flags, disclaimer}` — the spec carries the rules' provenance
  and `flags` every simplification. Quote seed + paths + engineVersion with any result.
- **Challenge ids in the vendor README are stale** (`ftmo/100k-2step` is refused). Take the real id
  from the refusal's own "Known challenges" list or from `prop-firm-sim firms`; our `/api/propfirms`
  parses ids in the same shape.
- **Journal-fed runs need a stated risk denominator.** The engine computes R-multiples and refuses
  P&L-only data; the paper account has no stops, so feed a risk (`--import-risk`) or the R-series
  mode rather than inventing one — otherwise use parametric mode.

### prop-firm-sim, integrated (what shipped, and what is left)

The bridge and the sheet shipped — do not re-plan them. `console/backend/propfirmsim.py` is the
`edgestats.py` pattern again: `build_args()` validates with sentences (win rate as a fraction, `--risk 1%`
in the engine's own percent form), the CLI runs with `--json`, the answer is cached by identical question
(the seed is pinned, so a repeat is byte-identical), and the engine's own failure text is relayed
(`SimError` → 409 when the engine is missing — the fix command IS the message — 400 for bad input). Doors:
GET `/api/propfirmsim/status` and `/api/propfirmsim/simulate` with query params (reads are GETs; no token).
`./install.sh --with-prop` installs the engine at `TRADERS_SIM_HOME` (default
`~/.local/share/traders-agent/propfirmsim`). In the sheet, every challenge chip is the Simulate button and
the card carries the engine's answer verbatim. `test_propfirmsim.py` pins the bridge and the sheet wiring
against a fake CLI, so the suite runs with no engine installed. Deterministic smoke run: ftmo 100k 2-step,
48% / 1.6R / 1% risk / 4 trades per day → 93.2% pass per attempt (CI 92.7–93.7), mean 1.07 attempts,
EV +$66,755, seed 42.

Left for a later pass (phase 2 in `docs/PLAN-desk-surfaces.md`): journal-fed runs (`--trade-log` plus
`--import-risk` — state the risk basis, never invent one) and agent-facing MCP tools so "what are my odds
on this challenge?" is one prompt.

### broker-sdk, measured (what it is, and what it is NOT)

Probed on npm + the repo README (v0.5.1); start a real-accounts answer from this block.

- **Shape:** `connect({broker, credentials})` → `fetchSnapshot()` returns accounts in ONE normalized
  schema — `{ id, name, currency, equity, cash?, environment: live|paper, positions[], trades[] }` —
  and `createPortfolio()/fetchAll()` sweeps many brokers at once (a failing broker comes back in
  `failures`, never kills the sweep). `computeStats()` does FIFO round-trip matching (win rate, avg
  win/loss); a sell with no recorded buy is IGNORED, never guessed.
- **Read-only by design:** every broker's credential is the read-scoped kind (read-only API key,
  auditor role, read-scope OAuth app, Flex token, wallet address). There is no order path in the
  README — if the operator ever wants one, that is trade-relay's territory and a product decision,
  not a flag here.
- **Extras:** statement CSV import for ANY institution (`/csv`: tolerant headers, skipped rows
  counted); `fetchBars` on Alpaca + Tradier ONLY (others reject with `UnsupportedCapabilityError`);
  IBKR Flex needs the statement's timezone passed.
- **The broker list is the README's own table** (which broker takes which credential shape, and which
  carry trade history) — read it there; do not quote a count from memory (npm says 22, the repo has
  said 22 and 23 at different times).
- **The prop-firm simulator consumes this exact trade-history JSON** — a live broker pull drops
  straight into a sim run, so the natural build order is simulator first, read-only accounts second
  (real history → real odds).
- **Our plan shape (item 4 in `docs/PLAN-desk-surfaces.md`):** a Node bridge mirroring
  `edgestats.py`, keys stored locally and never in the repo, a read-only Accounts view in the desk
  sheet, and NO order path — the propose → approve brake stays on the paper side.

## Rules that apply to all of them

- **Licence hygiene:** MIT and CC0 projects can be vendored or ported freely. AGPL (PineTS,
  vela-pinets, pinets-cli) is fine to run locally, but source must travel with any service that offers
  it over the network — the repo's `THIRD-PARTY.md` is where attribution lives, and it must be updated
  in the same change.
- **A hosted-shell feature is still not in any package.** Vela's paper account, Trade Journal UI inside
  Vela, and Quant live server-side; the open-source journal/broker projects are SEPARATE self-hosted
  tools, not a way to unlock the hosted one.
- **Prefer a project that ships its own MCP server** (prop-firm-sim, market-trackers): registration is
  the whole integration, and the desk answers with citations the tools already carry.
- **Quote the measured list, not memory:** stars, licence and last push come from the API call above,
  and "is it published?" from `npm view <pkg> version`.

## How the official product is assembled from these

What the operator sees as "the Vela/Quant app" IS this list wired together — one account, one window,
one repo per surface. Answer "how does their app do X / how would ours look with it" from this map
instead of rebuilding the UI to show it:

| Surface (vela.luxalgo.com/chart · luxalgo.com) | Carried by |
|---|---|
| the chart, drawings, layouts | Vela |
| Indicators + Strategy Tester (Pine on live bars, on-chart backtest) | PineTS + vela-pinets |
| in-app analytics reads (Library, edge, prop-firm offers) | edge-stats + luxalgo-mcp-server |
| the Journal: dashboard, P&L calendar, Edge Score v2, equity curve | trade-journal |
| the Prop Firms simulator page | prop-firm-sim |
| broker connections and the read-only `broker_*` agent tools | broker-sdk |
| alert/webhook → broker execution | trade-relay |
| Market Trackers page (Congress, insiders, contracts, lobbying) | market-trackers |
| options flow | whale-options |
| the Quant chat column and the $100k paper account | hosted-only — no repo exists, no update brings them |

For "show me how it looks" asks, cite the cheap evidence, never a rebuild: each repo's own README
screenshots (`raw.githubusercontent.com/LuxAlgo/<repo>/main/.github/assets/…` for trade-journal's
dashboard/calendar/trade shots; `prop-firm-sim/main/docs/assets/simulator-*.png`;
`trade-relay/main/docs/assets/dashboard.png`) plus demo-video frames for the hosted-only surfaces
(chart+Quant two-column layout; paper Buy/Sell with drag-set stop/target; tester strip NET PROFIT ·
822 trades · 45.61% win · PF 1.023). One-line caption per image.
