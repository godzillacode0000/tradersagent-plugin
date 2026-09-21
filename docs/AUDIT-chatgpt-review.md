# Audit of the ChatGPT architecture review — what is verified, what is wrong

An outside review of this repo made ~17 claims. This file records which ones hold **against the code
as it is now**, which are wrong, and which are real but deliberately out of scope. Claims are checked
by running or reading the repo, not by agreeing with the prose.

## Verified true — these are real weaknesses

| # | Claim | Evidence found here |
|---|---|---|
| 2 | **Market data is Binance-only** | `frontend/workspace.js:73` registers exactly one provider: `{ binance: () => new BinanceProvider() }`. |
| 2 | **A non-crypto symbol is an architectural false-positive** | Ran `trader-chart market XAUUSD 5m` → **timed out (exit 124)**, chart stayed `BTCUSDT 4h`. So `chart_set_market` accepts a symbol the data engine cannot serve, and the call does not fail fast — it hangs. This is the most serious true claim in the review. |
| 3 | **No multi-symbol workspace** | One chart, one market. Nothing correlates XAUUSD↔XAGUSD or NAS100↔SPX500. SMT cannot be expressed. |
| 8 | **Snapshot is shallow** | `chart_snapshot`'s docstring: *"Remember the chart's indicators plus its symbol/timeframe"*; `chart_undo`: *"Drawings are not restored — use chart_clear, then re-draw."* Exactly as the review says. |
| 12 | **Documentation drift is real** | `docs/MCP-TOOLS.md` is titled **"MCP tools (14)"** while `console/mcp/server.py` registers **27**. This is drift inside the repo that a reader will trust. |
| 4 | **ICT drawings are an overlay workaround, not chart objects** | `frontend/overlay.js` maps bar+price → pixels onto its own canvas, and carries auto-scaling calibration. Zoom/pan/resize/timeframe must keep that mapping in sync. |

## Verified wrong — the review overstates these

| # | Claim | What the code actually shows |
|---|---|---|
| 12 | "docs say 14, server has **25**" | The count 25 is wrong; it is **27** (`grep -c '@mcp.tool'`). The drift is real, the number is not. |
| 11 | "one-indicator rule conflicts with the ICT goal" | Correct as an observation, but the rule is a **guard against Vela's own behaviour**, not a design limit: stacking natives in this Vela build is what produced the earlier mess. The review's own fix — separate *studies* from *analysis objects* — is the right one, and the overlay layer already allows multiple drawings. |
| 13 | "Linux-only is a serious blocker for **your** environment" | Kevin's own instruction, twice: *"jangan pening2 lu untuk macOS atau windows..kita omarchy +hermes skrg ni"*. Linux-only is a **decision, not a gap**. The review argues against a constraint it was not told about. |
| 15 | "no account/positions/P&L" | True, and **intended**: the scope is read/style/draw/compute with **no order writes**. The review agrees execution should stay out, then lists it as a limitation. |
| 5 | "you need first-class ICT primitives instead of Pine" | The direction is right, but "instead of" is wrong for now: `chart_draw` already gives the agent boxes/lines/labels for FVG/OB/session work today, and LuxAlgo Library sources run unchanged (measured: 4/6). Typed primitives are an upgrade, not a rescue. |

## Real but unimplementable as stated

| # | Claim | Why it cannot be done as described |
|---|---|---|
| 5 | "typed objects: `{type: fvg, left, right, top, bottom}`" | The Vela build in use exposes no chart-object API — measured earlier, twice. Any such object is still drawn by **this** overlay, so the typed layer would sit on top of the same coordinate mapping. It buys a cleaner agent contract, not a sturdier chart. Worth doing for that reason alone; not a fix for claim 4. |
| 6 | "high-level intent tools" | Nothing blocks this, but every one of them is a **wrapper over tools that already ship**, and a wrapper that encodes judgement (where is the FVG?) is the agent's job, not the console's. The valuable version is deterministic detection over bars, which is new analysis code — a real project, not a tool addition. |
| 10 | "combine structured + visual state" | Already the design: `chart_state` (structured) and `chart_shot` (visual) exist, and the desk chat reads both. The review presents this as missing. |

## The useful parts to act on, in order

1. **Make an unservable symbol fail fast and loudly.** `chart_set_market("XAUUSD")` must return a
   refusal naming the provider limit, not hang for 30 s. This is the concrete bug behind claim 2 and
   it needs no new architecture.
2. **Fix the drift the review correctly found.** `docs/MCP-TOOLS.md` says 14; make it 27 and make CI
   compare it to the decorators (the tool already exists: `test_docs_drift.py` compares the README
   table and the catalog, so add this third view).
3. **Say the provider limit where a user meets it.** README + `chart_caps` should state which markets
   are genuinely served, so nobody plans an ICT workflow on a symbol that will hang.
4. **Typed draw primitives** (`chart_draw_object` or similar) — cheap, improves the agent contract.
5. Everything else in the review (market-data adapters, multi-symbol workspace, lifecycle manager) is
   a genuine next chapter, and each is larger than this plugin. They belong in a roadmap, not a patch.
