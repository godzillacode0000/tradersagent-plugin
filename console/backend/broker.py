"""Paper broker — Binance spot, simulated. Every order is a PROPOSAL until the operator approves it.

Rules this module exists to enforce (the operator's decisions, 3 Oct 2026):
  * Proposing never moves money. Only `approve` fills.
  * A fill uses the price read AT APPROVAL, not the price the agent saw when it proposed.
  * Spot: no shorting, no margin. Cash cannot go negative.
  * The account survives a restart (atomic write, mode 0600). A corrupt file is set aside, not trusted.

No secrets live here and no network call is made by the engine itself: the price feed is injected
(`price_of`), so tests control it and the live server hands it Binance's public ticker. Real orders
(ccxt + vault keys) are a later step and would sit behind this same propose → approve gate.
"""

import copy
import json
import math
import os
import re
import tempfile
import threading
import time

START_CASH = 10000.0
FEE = 0.001                      # Binance spot taker, 0.1 %
SYMBOL_RE = re.compile(r"^[A-Z0-9]{3,20}$")


class BrokerError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _fresh(cash: float) -> dict:
    return {"cash": cash, "start_cash": cash, "realized": 0.0, "next_id": 1,
            "positions": {}, "orders": []}


class PaperBroker:
    def __init__(self, path: str, price_of, fee: float = FEE, start_cash: float = START_CASH,
                 max_pending: int = 20, keep: int = 200):
        self.path = path
        self.price_of = price_of
        self.fee = fee
        self.start_cash = float(start_cash)
        self.max_pending = max_pending
        self.keep = keep
        self._lock = threading.RLock()
        self._s = self._load()

    # ── persistence ──────────────────────────────────────────────────────────────────────────────
    def _load(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as fh:
                s = json.load(fh)
            if not isinstance(s, dict) or not isinstance(s.get("orders"), list) \
                    or not isinstance(s.get("positions"), dict) or not isinstance(s.get("cash"), (int, float)) \
                    or not math.isfinite(s["cash"]):
                raise ValueError("shape")
            # A hand-edited or older file may miss keys; fill them instead of answering 500 later (audit BE-12).
            s.setdefault("start_cash", self.start_cash)
            s.setdefault("realized", 0.0)
            ids = [o.get("id", 0) for o in s["orders"] if isinstance(o, dict) and isinstance(o.get("id"), int)]
            s["next_id"] = max(int(s.get("next_id") or 1), (max(ids) + 1) if ids else 1)
            return s
        except FileNotFoundError:
            return _fresh(self.start_cash)
        except ValueError:                                    # really unparsable: keep the broken file for inspection
            try:
                os.replace(self.path, f"{self.path}.bad{int(time.time())}")
            except OSError:
                pass
            return _fresh(self.start_cash)
        except OSError as exc:
            # A transient read error (EIO, EACCES) is NOT corruption: starting a fresh 10,000 account over a good
            # file would silently throw the real one away. Refuse instead (audit BE-12).
            raise BrokerError("broker_unavailable", f"cannot read the paper account at {self.path}: {exc}")

    def _save(self) -> None:
        d = os.path.dirname(self.path) or "."
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".paper.")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(self._s, fh, separators=(",", ":"))
                fh.flush()
                os.fsync(fh.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def _commit(self, before: dict) -> None:
        """Save, or put the account back exactly as it was. A failed write used to leave the fill in memory (and a
        retry answering "already filled") while the file still showed the order pending (audit BE-8)."""
        try:
            self._save()
        except BaseException:
            self._s = before
            raise

    @staticmethod
    def _dust(qty: float) -> float:
        """Float error grows with the size: 1e-12 absolute left ghost positions and refused legitimate sells for
        quantities in the millions (audit BE-13)."""
        return max(1e-12, 1e-9 * abs(qty))

    def _trim(self) -> None:
        done = [o for o in self._s["orders"] if o["status"] != "pending"]
        if len(done) > self.keep:
            drop = {o["id"] for o in done[: len(done) - self.keep]}
            self._s["orders"] = [o for o in self._s["orders"] if o["id"] not in drop]

    # ── the three verbs ──────────────────────────────────────────────────────────────────────────
    def propose(self, symbol, side, qty, note: str = "") -> dict:
        sym = str(symbol or "").strip().upper()
        if not SYMBOL_RE.match(sym):
            raise BrokerError("bad_symbol", f"not a symbol: {symbol!r}")
        sd = str(side or "").strip().lower()
        if sd not in ("buy", "sell"):
            raise BrokerError("bad_side", "side must be buy or sell")
        try:
            q = float(qty)
        except (TypeError, ValueError):
            raise BrokerError("bad_qty", f"quantity is not a number: {qty!r}")
        if not math.isfinite(q) or q <= 0:
            raise BrokerError("bad_qty", "quantity must be a positive, finite number")
        with self._lock:
            if sum(1 for o in self._s["orders"] if o["status"] == "pending") >= self.max_pending:
                raise BrokerError("too_many_pending", f"{self.max_pending} proposals are waiting — approve or reject some first")
            before = copy.deepcopy(self._s)
            o = {"id": self._s["next_id"], "symbol": sym, "side": sd, "qty": q,
                 "note": str(note or "")[:200], "status": "pending", "ts": time.time()}
            self._s["next_id"] += 1
            self._s["orders"].append(o)
            self._commit(before)
            return dict(o)

    def reject(self, order_id) -> dict:
        with self._lock:
            before = copy.deepcopy(self._s)
            o = self._pending(order_id)
            o["status"] = "rejected"
            o["closed"] = time.time()
            self._trim()
            self._commit(before)
            return dict(o)

    def approve(self, order_id) -> dict:
        with self._lock:
            before = copy.deepcopy(self._s)
            o = self._pending(order_id)
            px = float(self.price_of(o["symbol"]))            # may raise no_price → the card stays
            if not math.isfinite(px) or px <= 0:
                raise BrokerError("no_price", f"no usable price for {o['symbol']}")
            gross = px * o["qty"]
            fee = gross * self.fee
            pos = self._s["positions"].get(o["symbol"])
            if o["side"] == "buy":
                if gross + fee > self._s["cash"] + 1e-9:
                    raise BrokerError("insufficient_cash",
                                      f"needs {gross + fee:,.2f} but cash is {self._s['cash']:,.2f}")
                self._s["cash"] -= gross + fee
                # The entry fee is a cost the moment it is paid. It used to appear nowhere in P&L, so `realized`
                # understated a round trip by it and never reconciled with equity (audit BE-3).
                self._s["realized"] -= fee
                if pos:
                    tot = pos["qty"] + o["qty"]
                    pos["avg"] = (pos["avg"] * pos["qty"] + px * o["qty"]) / tot
                    pos["qty"] = tot
                else:
                    self._s["positions"][o["symbol"]] = {"qty": o["qty"], "avg": px}
            else:
                if not pos or pos["qty"] + self._dust(pos["qty"]) < o["qty"]:
                    have = pos["qty"] if pos else 0
                    raise BrokerError("insufficient_position", f"cannot sell {o['qty']} — holding {have} (spot, no shorting)")
                self._s["cash"] += gross - fee
                self._s["realized"] += (px - pos["avg"]) * o["qty"] - fee
                pos["qty"] -= o["qty"]
                if pos["qty"] <= self._dust(o["qty"]):
                    del self._s["positions"][o["symbol"]]
            o.update(status="filled", price=px, fee=fee, closed=time.time())
            self._trim()
            self._commit(before)
            return dict(o)

    def _pending(self, order_id) -> dict:
        try:
            oid = int(order_id)
        except (TypeError, ValueError):
            raise BrokerError("unknown_order", f"no order {order_id!r}")
        for o in self._s["orders"]:
            if o["id"] == oid:
                if o["status"] != "pending":
                    raise BrokerError("not_pending", f"order {oid} is already {o['status']}")
                return o
        raise BrokerError("unknown_order", f"no order {oid}")

    # ── reads ────────────────────────────────────────────────────────────────────────────────────
    def get(self, order_id) -> dict:
        with self._lock:
            for o in self._s["orders"]:
                if o["id"] == int(order_id):
                    return dict(o)
        raise BrokerError("unknown_order", f"no order {order_id}")

    def state(self) -> dict:
        # Prices are read OUTSIDE the lock: one blocking ticker call per position under it made propose / approve
        # wait behind a slow exchange (audit BE-7).
        with self._lock:
            held = {sym: dict(p) for sym, p in self._s["positions"].items()}
        marks = {}
        for sym, p in sorted(held.items()):
            try:
                marks[sym] = float(self.price_of(sym))
            except BrokerError:
                marks[sym] = p["avg"]                        # no price: show cost, not a made-up number
        with self._lock:
            positions, equity = [], self._s["cash"]
            for sym, p in sorted(self._s["positions"].items()):
                mark = marks.get(sym, p["avg"])
                positions.append({"symbol": sym, "qty": p["qty"], "avg": p["avg"], "mark": mark,
                                  "unrealized": (mark - p["avg"]) * p["qty"]})
                equity += mark * p["qty"]
            orders = self._s["orders"]
            return {"mode": "paper", "venue": "binance", "cash": self._s["cash"], "equity": equity,
                    "start_cash": self._s["start_cash"], "realized": self._s["realized"],
                    "positions": positions,
                    "pending": [dict(o) for o in orders if o["status"] == "pending"],
                    "history": [dict(o) for o in orders if o["status"] != "pending"][-self.keep:][::-1]}

    def reset(self) -> None:
        with self._lock:
            nxt = self._s.get("next_id", 1)
            self._s = _fresh(self.start_cash)
            self._s["next_id"] = nxt              # ids never restart: a stale card for old #1 must not approve a new #1
            self._save()
