"""The vectorbt tier — its own venv, its own port, its own process.

Why a separate service instead of importing vectorbt into the console: the console is stdlib-only
and must stay that way (it is the thing that is always up). vectorbt drags pandas + numba + llvmlite
(~840MB, and numba JITs on first use — measured 17s cold, 23ms warm on this box). So it lives here,
behind a two-route HTTP contract, and the console reaches it over 127.0.0.1.

    GET  /health   -> {ok, vectorbt, warm, jit_ms}
    POST /run      -> {kind:"ma_cross", fast, slow, fee, source}          -> metrics + trades
    POST /sweep    -> {kind:"ma_cross_sweep", window:[lo,hi], fee, source} -> ranked table

Run it with the backtest venv's interpreter:
    ~/.local/share/traders-agent/bt/venv/bin/python backtest_service.py --port 8788

Sources: "binance:BTCUSDT:30m" (public klines REST, no key) or "local:NAME" (a CSV/Parquet in
--data-dir). Results are written to <chart-root>/backtest/<run_id>.json — a namespace of its own,
never the live chart's state.json (one writer per file, so no race with a live session).

Single-flight on purpose: one backtest at a time. This box has 8GB; two numba jobs at once would
swap. A second request gets 409 with the running run_id rather than silently queueing.

Licence: vectorbt is Apache-2.0 WITH Commons Clause. Installed into its own venv by the user; not
redistributed in the repo. See THIRD-PARTY.md.
"""
from __future__ import annotations

import argparse
import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "0.1.0"
DEFAULT_PORT = 8788
DEFAULT_DATA_DIR = os.path.expanduser("~/.local/share/traders-agent/data")

_LOCK = threading.Lock()          # single-flight: one run at a time
_STATE = {"running": None, "warm": False, "jit_ms": None, "vectorbt": None, "runs": 0}
_DATA_DIR = DEFAULT_DATA_DIR
_CHART_ROOT = None


# ─────────────────────────── data ───────────────────────────

def _klines_binance(symbol: str, interval: str, bars: int) -> "object":
    """Public klines REST, paginated. No key, no account — the same feed the chart itself uses."""
    import urllib.request
    import pandas as pd

    out, end = [], None
    while len(out) < bars:
        want = min(1000, bars - len(out))
        url = (f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}"
               f"&limit={want}" + (f"&endTime={end}" if end else ""))
        with urllib.request.urlopen(url, timeout=25) as res:
            page = json.load(res)
        if not page:
            break
        out = page + out
        end = page[0][0] - 1
        if len(page) < want:
            break
    df = pd.DataFrame({
        "open": [float(k[1]) for k in out], "high": [float(k[2]) for k in out],
        "low": [float(k[3]) for k in out], "close": [float(k[4]) for k in out],
        "volume": [float(k[5]) for k in out]},
        index=pd.to_datetime([k[0] for k in out], unit="ms", utc=True))
    return df


def _bars_local(name: str) -> "object":
    """A file the operator owns: CSV or Parquet in the data dir. Same schema the chart uses."""
    import pandas as pd

    base = Path(_DATA_DIR)
    for suffix in (".parquet", ".csv", ""):
        p = base / (name if name.endswith(suffix) and suffix else name + suffix)
        if p.exists():
            df = pd.read_parquet(p) if p.suffix == ".parquet" else pd.read_csv(p, index_col=0)
            df.index = pd.to_datetime(df.index, utc=True)
            cols = {c.lower(): c for c in df.columns}
            df = df.rename(columns={cols[c]: c for c in ("open", "high", "low", "close", "volume")
                                    if c in cols})
            return df[["open", "high", "low", "close", "volume"]].astype(float).sort_index()
    raise FileNotFoundError(f"no local data named {name!r} in {base} "
                            f"(expected {name}.csv or {name}.parquet)")


def load_bars(source: str, bars: int):
    if source.startswith("binance:"):
        _, symbol, interval = source.split(":", 2)
        return _klines_binance(symbol.upper(), interval, bars)
    if source.startswith("local:"):
        return _bars_local(source.split(":", 1)[1])
    raise ValueError(f"unknown source {source!r} — use binance:SYMBOL:TF or local:NAME")


# ─────────────────────────── engine ───────────────────────────

def _num(x, default: float = 0.0) -> float:
    """vectorbt hands back a Series in places even for a single column — take the last value.

    (pandas 3.0 + vectorbt 1.1.1: `pf.value()` and friends are not always scalars. A bare float()
    on those raises `TypeError: ... not 'Series'`, which is exactly how the first /run failed.)
    """
    try:
        if hasattr(x, "iloc"):
            x = x.iloc[-1]
        return float(x)
    except (TypeError, ValueError, IndexError):
        return float(default)


def _metrics(pf) -> dict:
    return {
        "total_return_pct": round(_num(pf.total_return()) * 100, 3),
        "max_drawdown_pct": round(_num(pf.max_drawdown()) * 100, 3),
        "sharpe": round(_num(pf.sharpe_ratio()), 3),
        "sortino": round(_num(pf.sortino_ratio()), 3),
        "trades": int(pf.trades.count()),
        "win_rate_pct": round(_num(pf.trades.win_rate()) * 100, 1),
        "profit_factor": round(_num(pf.trades.profit_factor()), 3),
        "expectancy": round(_num(pf.trades.expectancy()), 4),
        "final_value": round(_num(pf.value(), 10000.0), 2),
    }


def _trades(pf) -> list:
    rec = pf.trades.records_readable
    keep = [c for c in ("Entry Timestamp", "Exit Timestamp", "Avg Entry Price", "Avg Exit Price",
                        "PnL", "Return", "Status") if c in rec.columns]
    out = []
    for _, r in rec[keep].iterrows():
        out.append({
            "entry_time": str(r.get("Entry Timestamp")), "exit_time": str(r.get("Exit Timestamp")),
            "entry_price": _num(r.get("Avg Entry Price")),
            "exit_price": _num(r.get("Avg Exit Price")),
            "pnl": round(_num(r.get("PnL")), 2),
            "return_pct": round(_num(r.get("Return")) * 100, 3),
        })
    return out


def run_ma_cross(spec: dict) -> dict:
    import vectorbt as vbt

    fast_n, slow_n = int(spec.get("fast", 20)), int(spec.get("slow", 50))
    fee = float(spec.get("fee", 0.001))
    init = float(spec.get("init_cash", 10000))
    freq = spec.get("freq") or None
    df = load_bars(str(spec.get("source", "binance:BTCUSDT:30m")), int(spec.get("bars", 1000)))
    price = df["close"]

    t0 = time.time()
    fast, slow = vbt.MA.run(price, fast_n), vbt.MA.run(price, slow_n)
    pf = vbt.Portfolio.from_signals(price, fast.ma_crossed_above(slow), fast.ma_crossed_below(slow),
                                    init_cash=init, fees=fee, freq=freq)
    ms = (time.time() - t0) * 1000
    return {"kind": "ma_cross", "fast": fast_n, "slow": slow_n, "fee": fee,
            "source": spec.get("source"), "bars": int(len(df)),
            "first": str(df.index[0]), "last": str(df.index[-1]),
            "last_price": _num(price.iloc[-1]), "ms": round(ms, 1),
            "metrics": _metrics(pf), "trades": _trades(pf)}


def run_ma_cross_sweep(spec: dict) -> dict:
    import numpy as np
    import vectorbt as vbt

    lo, hi = spec.get("window", [5, 60])
    fee = float(spec.get("fee", 0.001))
    init = float(spec.get("init_cash", 10000))
    top_n = int(spec.get("top", 10))
    df = load_bars(str(spec.get("source", "binance:BTCUSDT:30m")), int(spec.get("bars", 1000)))
    price = df["close"]

    t0 = time.time()
    fast, slow = vbt.MA.run_combs(price, window=np.arange(int(lo), int(hi) + 1), r=2,
                                  short_names=["fast", "slow"])
    pf = vbt.Portfolio.from_signals(price, fast.ma_crossed_above(slow), fast.ma_crossed_below(slow),
                                    init_cash=init, fees=fee, freq=spec.get("freq") or None)
    ms = (time.time() - t0) * 1000
    ret = pf.total_return()
    rows = []
    for (f_n, s_n), v in ret.sort_values(ascending=False).head(top_n).items():
        p = pf[(f_n, s_n)]
        rows.append({"fast": int(f_n), "slow": int(s_n), "return_pct": round(_num(v) * 100, 2),
                     "trades": int(p.trades.count()),
                     "win_rate_pct": round(_num(p.trades.win_rate()) * 100, 1),
                     "max_drawdown_pct": round(_num(p.max_drawdown()) * 100, 2)})
    return {"kind": "ma_cross_sweep", "window": [int(lo), int(hi)], "fee": fee,
            "source": spec.get("source"), "bars": int(len(df)), "combos": int(len(ret)),
            "median_pct": round(float(ret.median()) * 100, 2),
            "worst_pct": round(float(ret.min()) * 100, 2),
            "best_pct": round(float(ret.max()) * 100, 2),
            "ms": round(ms, 1), "top": rows}


RUNNERS = {"ma_cross": run_ma_cross, "ma_cross_sweep": run_ma_cross_sweep}


def warm_up() -> None:
    """Pay the numba JIT once, at start-up, so the operator's first run is not a 17s wait."""
    import numpy as np
    import pandas as pd
    import vectorbt as vbt

    t0 = time.time()
    idx = pd.date_range("2024-01-01", periods=60, freq="30min", tz="UTC")
    price = pd.Series(np.cumprod(1 + np.random.normal(0, 0.01, 60)) * 100, index=idx, name="close")
    fast, slow = vbt.MA.run(price, 5), vbt.MA.run(price, 15)
    vbt.Portfolio.from_signals(price, fast.ma_crossed_above(slow), fast.ma_crossed_below(slow))
    _STATE.update(warm=True, jit_ms=round((time.time() - t0) * 1000, 1), vectorbt=vbt.__version__)


# ─────────────────────────── http ───────────────────────────

def _handle(kind: str, spec: dict) -> dict:
    if kind not in RUNNERS:
        return {"ok": False, "error": f"unknown kind {kind!r} — one of {sorted(RUNNERS)}"}
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    with _LOCK:
        _STATE["running"] = run_id
        try:
            result = RUNNERS[kind](spec)
            result.update(run_id=run_id, ok=True, vectorbt=_STATE["vectorbt"])
            if _CHART_ROOT:
                out = Path(_CHART_ROOT) / "backtest"
                out.mkdir(parents=True, exist_ok=True)
                (out / f"{run_id}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
                (out / "latest.json").write_text(json.dumps({"run_id": run_id}), encoding="utf-8")
            _STATE["runs"] += 1
            return result
        except Exception as exc:  # noqa: BLE001 — the operator needs the reason, not a trace
            return {"ok": False, "run_id": run_id, "error": f"{type(exc).__name__}: {exc}"}
        finally:
            _STATE["running"] = None


class Handler(BaseHTTPRequestHandler):
    server_version = f"trader-backtest/{VERSION}"

    def log_message(self, fmt, *args):  # keep the journal readable
        print(f"[backtest] {fmt % args}", flush=True)

    def _send(self, code: int, body: dict):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") in ("/health", "/api/backtest/health"):
            self._send(200, {"ok": True, "version": VERSION, "vectorbt": _STATE["vectorbt"],
                             "warm": _STATE["warm"], "jit_ms": _STATE["jit_ms"],
                             "running": _STATE["running"], "runs": _STATE["runs"],
                             "data_dir": _DATA_DIR, "chart_root": _CHART_ROOT})
        else:
            self._send(404, {"ok": False, "error": "GET /health"})

    def do_POST(self):  # noqa: N802
        path = self.path.rstrip("/") or "/"
        if path not in ("/run", "/sweep", "/api/backtest", "/api/backtest/sweep"):
            self._send(404, {"ok": False, "error": "POST /run or /sweep"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            spec = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError) as exc:
            self._send(400, {"ok": False, "error": f"bad JSON body: {exc}"})
            return
        if _STATE["running"]:
            self._send(409, {"ok": False, "error": "a backtest is already running",
                             "running": _STATE["running"]})
            return
        kind = spec.get("kind") or ("ma_cross_sweep" if path.endswith("sweep") else "ma_cross")
        self._send(200, _handle(kind, spec))


def main() -> int:
    global _DATA_DIR, _CHART_ROOT
    ap = argparse.ArgumentParser(description="the Trader's Agent vectorbt tier")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    ap.add_argument("--chart-root", default=os.environ.get("LUXALGO_CHART_ROOT", ""))
    ap.add_argument("--no-warm", action="store_true")
    args = ap.parse_args()
    _DATA_DIR = args.data_dir
    _CHART_ROOT = args.chart_root or None
    print(f"[backtest] starting v{VERSION} on {args.host}:{args.port} · data {_DATA_DIR} "
          f"· chart {_CHART_ROOT or '(no results dir)'}", flush=True)
    if not args.no_warm:
        try:
            warm_up()
            print(f"[backtest] warm in {_STATE['jit_ms']}ms · vectorbt {_STATE['vectorbt']}", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"[backtest] WARNING: warm-up failed: {type(exc).__name__}: {exc}", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
