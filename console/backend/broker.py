"""Paper broker — Binance spot, simulated. Every order is a PROPOSAL until the operator approves it.

Rules this module exists to enforce (the operator's decisions, 3 Oct 2026):
  * Proposing never moves money. Only `approve` fills.
  * A fill uses the price read AT APPROVAL, not the price the agent saw when it proposed.
  * Spot: no shorting, no margin. Cash cannot go negative.
  * The account survives a restart (atomic write, mode 0600). A corrupt file is set aside, not trusted.

Accounting (16 Oct 2026 — the journal needs per-trade numbers, not just a running total):
  * A buy books its fee immediately and remembers it ON THE POSITION (`fees`), so the part of it that
    belongs to a later sale can be attributed then.
  * A sale records `pnl` on the order: (exit − average entry) × qty − exit fee − the entry-fee share
    for that qty. Summed over every sale this equals the account's `realized` exactly — the identity
    is asserted in the tests, so the journal can never drift from the account.
  * `stats()` reads those fills back as closed trades (win rate, profit factor, average win/loss)
    and builds the realised-equity curve. It is a READ: it never moves money and never fills gaps.

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
                # understated a round trip by it and never reconciled with equity (audit BE-3). It is also
                # remembered on the POSITION, so the sale that inherits this qty can attribute its share.
                self._s["realized"] -= fee
                if pos:
                    tot = pos["qty"] + o["qty"]
                    pos["avg"] = (pos["avg"] * pos["qty"] + px * o["qty"]) / tot
                    pos["fees"] = float(pos.get("fees", 0.0)) + fee
                    pos["qty"] = tot
                else:
                    self._s["positions"][o["symbol"]] = {"qty": o["qty"], "avg": px, "fees": fee}
                # This fill's own contribution to `realized`: the identity sum(fill deltas) == realized
                # is what the journal's curve and totals rely on.
                o["pnl"] = -fee
            else:
                if not pos or pos["qty"] + self._dust(pos["qty"]) < o["qty"]:
                    have = pos["qty"] if pos else 0
                    raise BrokerError("insufficient_position", f"cannot sell {o['qty']} — holding {have} (spot, no shorting)")
                held_fees = float(pos.get("fees", 0.0))
                fee_share = held_fees * (o["qty"] / pos["qty"]) if pos["qty"] > 0 else 0.0
                self._s["cash"] += gross - fee
                self._s["realized"] += (px - pos["avg"]) * o["qty"] - fee
                # The closed trade's own P&L: both legs' fees on this qty, so the journal's win rate and
                # profit factor describe the trade, not half of it.
                o["pnl"] = (px - pos["avg"]) * o["qty"] - fee - fee_share
                pos["fees"] = max(0.0, held_fees - fee_share)
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

    def stats(self) -> dict:
        """The journal's read (16 Oct 2026): closed trades off the fills, and the realised curve.

        A closed trade is a filled SELL — spot has no shorts, so a sale closes qty a buy opened. Its
        `pnl` already carries both legs' fees for that qty, so these numbers describe the trade and
        not half of it. The identity to hold: **sum(sell pnl) == realized + the open positions' entry
        fees** (an open position's fee is booked, but no sale has attributed it yet); the tests assert
        it, so the journal can never drift from the account.

        Nothing here guesses. With no closed trades the rates are None, not 0 % — a rate with no
        sample is not a rate — and `fills_kept` reports how many fills the account still holds (it
        trims old ones), so any rate can be read with its own N.
        """
        with self._lock:
            orders = [dict(o) for o in self._s["orders"]]
            start = float(self._s["start_cash"])
            realized = float(self._s["realized"])
            open_fees = sum(float(p.get("fees", 0.0)) for p in self._s["positions"].values())
        sells = sorted((o for o in orders if o.get("status") == "filled" and o.get("side") == "sell"),
                       key=lambda o: o.get("closed") or o.get("ts") or 0)
        trades, curve, cum = [], [], start
        for o in sells:
            pnl = float(o.get("pnl") or 0.0)
            at = o.get("closed") or o.get("ts")
            cum += pnl
            trades.append({"id": o.get("id"), "symbol": o.get("symbol"), "qty": o.get("qty"),
                           "exit": o.get("price"), "pnl": pnl, "at": at})
            curve.append({"at": at, "equity": cum})
        wins = [t["pnl"] for t in trades if t["pnl"] > 0]
        losses = [t["pnl"] for t in trades if t["pnl"] < 0]
        gross_win = sum(wins)
        gross_loss = -sum(losses)                     # a positive number; 0.0 when nothing lost yet
        n = len(trades)
        return {
            "closed": n,
            "wins": len(wins),
            "losses": len(losses),
            "breakeven": n - len(wins) - len(losses),
            "win_rate": (len(wins) / n) if n else None,
            "gross_win": gross_win,
            "gross_loss": gross_loss,
            # None means "no losing trade yet", which is NOT a very large factor: the sheet prints ∞.
            "profit_factor": (gross_win / gross_loss) if gross_loss > 0 else None,
            "avg_win": (gross_win / len(wins)) if wins else None,
            "avg_loss": (-gross_loss / len(losses)) if losses else None,
            "best": max((t["pnl"] for t in trades), default=None),
            "worst": min((t["pnl"] for t in trades), default=None),
            "net": sum(t["pnl"] for t in trades),
            "start_cash": start,
            "realized": realized,
            "open_fees": open_fees,
            "fills_kept": len(orders),
            "trades": trades[-40:][::-1],             # newest first, bounded for the sheet
            "curve": curve,                           # realised equity after each closed trade
        }

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
            out = {"mode": "paper", "venue": "binance", "cash": self._s["cash"], "equity": equity,
                   "start_cash": self._s["start_cash"], "realized": self._s["realized"],
                   "positions": positions,
                   "pending": [dict(o) for o in orders if o["status"] == "pending"],
                   "history": [dict(o) for o in orders if o["status"] != "pending"][-self.keep:][::-1]}
        # The journal half (closed trades, win rate, profit factor, the realised curve). A pure read:
        # it cannot move money, and a broker that cannot answer it is a bug, not a paper account.
        out["stats"] = self.stats()
        return out

    def reset(self) -> None:
        with self._lock:
            nxt = self._s.get("next_id", 1)
            self._s = _fresh(self.start_cash)
            self._s["next_id"] = nxt              # ids never restart: a stale card for old #1 must not approve a new #1
            self._save()
