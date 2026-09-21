#!/usr/bin/env python3
"""Can PineTS run the primitives the SMC/ICT family actually uses?

Every case goes through `bin/trader-chart apply`, which is the real plugin path: the chart's own
PineTS engine, the chart's own bars. A Node harness that imports pinets directly is not the same
test — an earlier attempt of mine reported 1/18 with "Unexpected token (2:5)" on every case, which
was my template literal starting with a newline, not an engine limit. This file keeps Pine source
on one line (\\n escapes, no literal newlines) so the source it measures is the source it sends.
"""
import json
import subprocess

CHART = "/home/godzillaton/Projects/luxalgo-web/bin/trader-chart"
H = '//@version=6\\n'

CASES = [
    # A gap is read from three bars.
    ("bar indexing [2]", H + 'indicator("t1", overlay=true)\\nplot(low > high[2] ? 1 : 0)'),
    # Gaps and levels have to survive across bars.
    ("var persistence", H + 'indicator("t2", overlay=true)\\nvar float top = na\\nif low > high[2]\\n    top := low\\nplot(top)'),
    # Order blocks and sweeps are collected.
    ("array", H + 'indicator("t3", overlay=true)\\nvar array<float> xs = array.new<float>(0)\\nif low > high[2]\\n    array.push(xs, high[2])\\nplot(array.size(xs))'),
    # Sweeps are found with pivots.
    ("ta.pivothigh", H + 'indicator("t4", overlay=true)\\nplot(ta.pivothigh(high, 5, 5))'),
    # Killzones need the clock.
    ("hour/minute", H + 'indicator("t5")\\nplot(hour(time) * 60 + minute(time))'),
    # Drawing the gap.
    ("box.new", H + 'indicator("t6", overlay=true)\\nvar box b = na\\nif low > high[2]\\n    b := box.new(bar_index-2, high[2], bar_index, low)\\nplot(bar_index)'),
    ("line.new", H + 'indicator("t7", overlay=true)\\nvar line ln = na\\nif low > high[2]\\n    ln := line.new(bar_index-2, high[2], bar_index, high[2])\\nplot(bar_index)'),
    ("label.new", H + 'indicator("t8", overlay=true)\\nif low > high[2]\\n    label.new(bar_index, low, "FVG")'),
    # Mitigation is a state machine over the gap.
    ("mitigation state", H + 'indicator("t9", overlay=true)\\nvar bool mit = false\\nvar float top = na\\nif low > high[2]\\n    top := low\\n    mit := false\\nif not na(top) and high >= top\\n    mit := true\\nplot(mit ? 1 : 0)'),
    # CISD normalises by ATR.
    ("ta.atr", H + 'indicator("t10")\\nplot(0.3 * ta.atr(200))'),
    ("ta.highest", H + 'indicator("t11")\\nplot(ta.highest(high, 20))'),
    # HTF context.
    ("request.security", H + 'indicator("t12")\\nplot(request.security(syminfo.tickerid, "D", high))'),
    # The CISD trigger: a close crossing a remembered open.
    ("remembered open", H + 'indicator("t13")\\nvar float ref = na\\nif close >= close[1]\\n    ref := open\\nplot(ref)'),
    ("table", H + 'indicator("t14")\\nvar table t = table.new(position.top_right, 1, 1)\\nif barstate.islast\\n    table.cell(t, 0, 0, "SMC")'),
    ("math + color", H + 'indicator("t15")\\nplot(math.max(close - open, 0.0), color=color.new(color.red, 80))'),
    # for ... in, used by the array-based scripts.
    ("for ... in", H + 'indicator("t16")\\na = array.from(1, 2, 3)\\nt = 0.0\\nfor v in a\\n    t := t + v\\nplot(t)'),
]


def run(pine: str):
    p = subprocess.run([CHART, "apply", "-"], input=pine, capture_output=True, text=True, timeout=120)
    out = (p.stdout or "").strip()
    return p.returncode, out


def main():
    ok = 0
    results = []
    for name, pine in CASES:
        try:
            code, out = run(pine)
        except subprocess.TimeoutExpired:
            code, out = 124, "timed out"
        ran = code == 0 and "refused" not in out.lower() and "error" not in out.lower()
        ok += 1 if ran else 0
        first = out.splitlines()[0] if out else "(no output)"
        results.append({"case": name, "ran": ran, "code": code, "out": first[:150]})
        print(f"{'RUN    ' if ran else 'REFUSED'}  {name:22} -- {first[:120]}")
    print(f"\n{ok}/{len(CASES)} ran through the chart's own engine")
    with open("/tmp/smc-study/pine-capability.json", "w") as fh:
        json.dump(results, fh, indent=1)


if __name__ == "__main__":
    main()
