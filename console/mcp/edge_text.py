"""Edge Stats answers as plain text — for the agent (MCP tools) and for the shell (`trader-chart edge`).

One module, no dependencies, so the stdlib-only suite can test it (the MCP server itself cannot be
imported without fastmcp) and both front doors say exactly the same sentence.

The engine's rule is this module's rule: **no percentage without its sample size.** Every rate printed
here carries its N next to it — the estimate with its interval, each half of the stability split, each
year, each group — and when the engine refuses an estimate (too few sessions) NO percentage is printed
at all, only the counts. The disclaimer the engine attaches is always the last line of a result.
"""

from __future__ import annotations

DISCLAIMER_FALLBACK = "Historical conditional frequencies with sample sizes. Not predictions, not advice."

# How the answers point at their next step. The agent calls MCP tools; the shell types commands. One
# renderer serves both, so the names are data: `use_cli_names()` swaps them for `trader-chart edge …`.
NAMES = {"session": "edgestats_session", "report": "edgestats_report(preset, symbol, params)",
         "setup_demo": "edgestats_setup(source='demo')", "status": "edgestats_status"}


def use_cli_names() -> None:
    NAMES.update(session="trader-chart edge session", report="trader-chart edge report PRESET --symbol S --param k=v",
                 setup_demo="trader-chart edge setup --source demo", status="trader-chart edge status")


def pct(value, digits: int = 1) -> str:
    return f"{value * 100:.{digits}f}%" if isinstance(value, (int, float)) and not isinstance(value, bool) else "–"


def _num(n) -> str:
    return f"{int(n):,}" if isinstance(n, (int, float)) else str(n)


def fmt_value(value, unit: str = "") -> str:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return ""
    if unit == "minutes":
        m = round(value)
        if m < 60:
            return f"{m} min"
        h, r = divmod(m, 60)
        return f"{h}h {r}m" if r else f"{h}h"
    if unit == "%":
        return f"{value:.2f}%"
    if unit == "r":
        return f"{value:.2f} R"
    return f"{value:.3g}"


def _ci(ci) -> str:
    return f"[{pct(ci[0])}, {pct(ci[1])}]" if isinstance(ci, (list, tuple)) and len(ci) == 2 else ""


def _group_sort_key(row: dict):
    name = str(row.get("group"))
    weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    buckets = ["xs", "s", "m", "l", "xl"]
    for order in (weekdays, buckets, ["false", "true"]):
        if name in order:
            return (0, order.index(name), name)
    if name == "NULL":
        return (2, 0, name)
    if name.lstrip("-").isdigit():
        return (1, int(name), name)
    return (1, 0, name)


def format_result(env: dict, sessions: int = 8, title: str = "", group_by: str = "") -> str:
    """One query/report envelope as text. `sessions` caps the listed matches."""
    q = env.get("query") or {}
    guards = env.get("guards") or {}
    n, k = env.get("n", 0), env.get("successes", 0)
    unit = (env.get("distribution") or {}).get("unit", "")
    scope = " · ".join(str(x) for x in (
        q.get("symbol"), q.get("sessionKey"),
        f"{q.get('since') or 'start'} → {q.get('until') or 'latest'}") if x)
    lines = []
    if title:
        lines.append(f"{title}")
    lines.append(q.get("dsl") or "(query)")
    lines.append(f"  {scope}")
    lines.append("")

    if guards.get("refused"):
        lines.append(f"  NO ESTIMATE — only {_num(n)} session(s) matched ({_num(k)} hit(s)); the engine refuses "
                     f"to give a rate below {guards.get('refuseFloor', 10)} sessions.")
    else:
        lines.append(f"  estimate {pct(env.get('estimate'))}   N = {_num(n)}   95% CI {_ci(env.get('ci95'))}"
                     f"   ({_num(k)} hit(s))")
        if guards.get("lowSample"):
            lines.append(f"  ⚠ LOW SAMPLE: N = {_num(n)} is below {guards.get('warnFloor', 30)} — a hint, not a rate; "
                         "the interval is wide for a reason.")
        st = env.get("stability")
        if st and st.get("firstHalf") and st.get("secondHalf"):
            a, b = st["firstHalf"], st["secondHalf"]
            lines.append(f"  stability: first half {pct(a.get('estimate'))} (n={_num(a.get('n'))}) vs second half "
                         f"{pct(b.get('estimate'))} (n={_num(b.get('n'))}) — "
                         + ("the halves agree" if st.get("agree") else "the halves DISAGREE (the pattern may have changed)"))
        rc = env.get("recency")
        if rc:
            lines.append(f"  recency: last {_num(rc.get('window'))} sessions {pct(rc.get('estimate'))} (n={_num(rc.get('n'))}) "
                         f"vs all {pct(env.get('estimate'))} (n={_num(n)}) — "
                         + ("recent sessions DIVERGE from history" if rc.get("diverges") else "recent sessions match history"))
        years = env.get("perYear") or []
        if years:
            lines.append("  per year: " + " · ".join(f"{y.get('year')} {pct(y.get('estimate'))} (n={_num(y.get('n'))})" for y in years))
        d = env.get("distribution")
        if d and d.get("count"):
            lines.append(f"  distribution ({unit or 'value'}, n={_num(d['count'])}): median {fmt_value(d.get('median'), unit)} · "
                         f"p25 {fmt_value(d.get('p25'), unit)} · p75 {fmt_value(d.get('p75'), unit)} · "
                         f"p90 {fmt_value(d.get('p90'), unit)} · max {fmt_value(d.get('max'), unit)}")

    groups = env.get("groups")
    if groups:
        lines.append("")
        lines.append(f"  by {group_by or 'group'}:")
        for g in sorted(groups, key=_group_sort_key):
            if isinstance(g.get("estimate"), (int, float)):
                low = "  ⚠ low sample" if g.get("lowSample") else ""
                lines.append(f"    {str(g.get('group')):<8} {pct(g.get('estimate')):>6}  n={_num(g.get('n'))}  "
                             f"95% CI {_ci(g.get('ci95'))}{low}")
            else:
                lines.append(f"    {str(g.get('group')):<8} no estimate  n={_num(g.get('n'))}  ({_num(g.get('successes'))} hit(s))")

    listed = (env.get("sessions") or [])[:max(0, sessions)]
    if listed:
        lines.append("")
        bits = []
        for s in listed:
            val = fmt_value(s.get("value"), unit)
            bits.append(f"{s.get('tradeDate')} {'hit' if s.get('success') else 'miss'}" + (f" ({val})" if val else ""))
        more = len(env.get("sessions") or []) - len(listed)
        lines.append(f"  latest sessions ({_num(len(listed))} of {_num(n)}): " + " · ".join(bits) + (f" · (+{more} more listed)" if more > 0 else ""))
        lines.append(f"  open one with {NAMES['session']} — its id is SYMBOL|session|DATE, e.g. "
                     f"{q.get('symbol', 'SYMBOL')}|{q.get('sessionKey', 'rth')}|{listed[0].get('tradeDate')}")
    lines.append("")
    lines.append("  " + (env.get("disclaimer") or DISCLAIMER_FALLBACK))
    eng = env.get("engine") or {}
    if eng:
        lines.append(f"  engine {eng.get('version', '?')} · store {str(eng.get('storeFingerprint', ''))[:8]}")
    return "\n".join(lines)


def format_session(view: dict) -> str:
    """One session's derived levels and event times (the bars themselves stay in the pane)."""
    lv, tm = view.get("levels") or {}, view.get("times") or {}
    bars = view.get("bars") or []
    px = lambda v: f"{v:.2f}" if isinstance(v, (int, float)) and not isinstance(v, bool) else "–"  # noqa: E731
    lines = [f"{view.get('symbol')} · {view.get('tradeDate')} · session {view.get('sessionKey')} · "
             f"{len(bars)} × {view.get('tf')} bars ({view.get('tz')})"
             + ("" if view.get("complete", True) else " · INCOMPLETE session")
             + (" · half day" if view.get("isHalfDay") else "") + (" · roll day" if view.get("isRollDay") else "")]
    if bars:
        hi = max(b["high"] for b in bars)
        lo = min(b["low"] for b in bars)
        lines.append(f"  open {px(bars[0]['open'])} · high {px(hi)} · low {px(lo)} · close {px(bars[-1]['close'])}")
    lines.append(f"  prior session: high {px(lv.get('prevHigh'))} · low {px(lv.get('prevLow'))} · close {px(lv.get('prevClose'))}")
    if isinstance(lv.get("gapPct"), (int, float)) and lv.get("gapDir") not in (None, "none"):
        filled = tm.get("gapFillMin")
        lines.append(f"  gap {lv['gapDir']} {lv['gapPct']:+.2f}% — " + (f"filled {filled} min after the open" if isinstance(filled, (int, float)) else "not filled"))
    for o in lv.get("openingRanges") or []:
        if isinstance(o.get("high"), (int, float)):
            lines.append(f"  opening range {o.get('window')}m: {px(o['low'])}–{px(o['high'])} · first break "
                         f"{o.get('firstBreak') or 'none'}" + (f" at +{o['breakMin']} min" if isinstance(o.get("breakMin"), (int, float)) else ""))
    for label, key in (("touched prior high", "touchPrevHighMin"), ("touched prior low", "touchPrevLowMin"),
                       ("session high", "highTimeMin"), ("session low", "lowTimeMin")):
        if isinstance(tm.get(key), (int, float)):
            lines.append(f"  {label} at +{tm[key]} min")
    lines.append("  " + (view.get("disclaimer") or DISCLAIMER_FALLBACK))
    return "\n".join(lines)


def _one_line(text: str, width: int = 110) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= width else text[: width - 1] + "…"


def format_presets(presets: list, category: str = "") -> str:
    cat = (category or "").strip().lower()
    rows = [p for p in presets if not cat or str(p.get("category", "")).lower() == cat]
    if not rows:
        known = sorted({str(p.get("category")) for p in presets})
        return f"no report in category '{category}' — categories: {', '.join(known)}"
    out = [f"{len(rows)} report(s)" + (f" in {cat}" if cat else "") + f" — run one with {NAMES['report']}:"]
    for p in rows:
        params = []
        for s in p.get("params") or []:
            bit = s.get("name", "?")
            if s.get("type") == "enum" and s.get("values"):
                bit += "=" + "|".join(map(str, s["values"]))
            elif "default" in s:
                bit += f"={s['default']}"
            params.append(bit)
        out.append(f"- {p.get('id')} [{p.get('category')}] {p.get('title')}"
                   + (f" — params: {', '.join(params)}" if params else ""))
    if not cat:
        out.append("categories: " + ", ".join(sorted({str(p.get('category')) for p in presets})))
    return "\n".join(out)


def format_fields(entries: list, kind: str = "", search: str = "", limit: int = 40) -> str:
    kind = (kind or "").strip().lower()
    q = (search or "").strip().lower()
    rows = [e for e in entries
            if (not kind or e.get("kind") == kind)
            and (not q or q in (str(e.get("name", "")) + " " + str(e.get("title", "")) + " " + str(e.get("doc", ""))).lower())]
    if not rows:
        return "nothing in the registry matches" + (f" '{search}'" if search else "") + (f" ({kind})" if kind else "")
    shown = rows[:max(1, limit)]
    out = [f"{len(rows)} entr{'y' if len(rows) == 1 else 'ies'}" + (f" — showing {len(shown)}; narrow with `search`" if len(rows) > len(shown) else "")
           + " — the query language is:  OUTCOME [WHERE condition [AND condition …]]"]
    for e in shown:
        args = e.get("args") or []
        sig = f"({', '.join(a.get('name', '?') for a in args)})" if args else ""
        extra = ""
        if e.get("valueType") == "enum" and e.get("enumValues"):
            extra = " = " + "|".join(map(str, e["enumValues"]))
        elif e.get("valueType"):
            extra = f" ({e['valueType']})"
        if e.get("kind") == "outcome" and e.get("valueUnit"):
            extra += f" → value in {e['valueUnit']}"
        out.append(f"- {e.get('kind')} {e.get('name')}{sig}{extra} — {_one_line(e.get('doc') or e.get('title'))}")
        ex = (e.get("examples") or [])[:1]
        if ex:
            out.append(f"    e.g. {ex[0]}")
    return "\n".join(out)


def format_job(job: dict | None) -> str:
    if not job:
        return "no data job has run in this console session"
    status = job.get("status")
    mark = {"running": "…", "cancelling": "…", "done": "✓", "cancelled": "◆", "failed": "✗"}.get(status, "?")
    secs = int(((job.get("finished") or 0) or __import__("time").time()) - (job.get("started") or 0))
    line = f"{mark} {job.get('label')} — {status}" + (f" ({job.get('step')})" if status in ("running", "cancelling") else "") + f" · {secs}s"
    tail = [t for t in (job.get("tail") or []) if str(t).strip()][-2:]
    if job.get("error"):
        line += f"\n  {job['error']}"
    elif tail:
        line += "\n  " + "\n  ".join(_one_line(t, 140) for t in tail)
    if status in ("running", "cancelling"):
        line += f"\n  questions are paused until it finishes — poll {NAMES['status']}"
    return line


def format_status(st: dict) -> str:
    inst = st.get("install") or {}
    svc = st.get("service") or {}
    lines = []
    if not inst.get("installed"):
        lines.append(f"✗ Edge Stats is not installed ({inst.get('problem')}): {inst.get('fix')}")
    else:
        what = "external engine" if inst.get("external") else f"engine {str(inst.get('commit') or '')[:7]} · node {inst.get('node')}"
        lines.append(f"Edge Stats installed ({what}) · service {svc.get('state')}" + (f" — {svc['error']}" if svc.get("error") else ""))
    syms = st.get("symbols") or []
    if syms:
        lines.append("symbols: " + ", ".join(
            f"{s['symbol']} ({s.get('adapter')}" + (f", to {str(s['lastBar'])[:10]}" if s.get("lastBar") else "") + ")" for s in syms)
            + (f" · store {st.get('store_mb')} MB" if st.get("store_mb") else ""))
    elif inst.get("installed"):
        lines.append(f"no data yet — start with {NAMES['setup_demo']} (10 s, synthetic) or a free download")
    if st.get("job"):
        lines.append(format_job(st["job"]))
    srcs = st.get("sources") or []
    if srcs and not syms:
        lines.append("free sources: " + "; ".join(f"{s['id']} ({s['market']})" for s in srcs))
    return "\n".join(lines)
