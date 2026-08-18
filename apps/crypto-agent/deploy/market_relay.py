#!/usr/bin/env python3
"""Small server-side COIN-M market relay.

The relay owns one Binance public WebSocket connection and exposes a local
SSE stream to the gateway. It deliberately has no trading credentials.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    import websocket
except ImportError:  # The deployment venv installs this optional runtime dependency.
    websocket = None  # type: ignore[assignment]


HOST = os.getenv("MARKET_RELAY_HOST", "127.0.0.1")
PORT = int(os.getenv("MARKET_RELAY_PORT", "8790"))
MIHOMO_PROXY = os.getenv("MIHOMO_PROXY", "http://127.0.0.1:7890")
MIHOMO_CONTROLLER = os.getenv("MIHOMO_CONTROLLER", "http://127.0.0.1:9090").rstrip("/")
MIHOMO_CONFIG = os.getenv("MIHOMO_CONFIG", "/home/admin/.config/mihomo/config.yaml")
SYMBOL = "BTCUSD_PERP"
INTERVALS = ("1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M")
BASE_URL = "https://dapi.binance.com"
WS_URL = "wss://dstream.binance.com/stream?streams=" + "/".join(
    [*(f"{SYMBOL.lower()}@kline_{interval}" for interval in INTERVALS),
     f"{SYMBOL.lower()}@aggTrade", f"{SYMBOL.lower()}@depth@100ms", f"{SYMBOL.lower()}@markPrice@1s"]
)
FEATURE_DB = os.getenv("MARKET_FEATURE_DB_PATH", "/var/lib/custom-api-gateway/market-features.sqlite")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def proxy_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.ProxyHandler({"http": MIHOMO_PROXY, "https": MIHOMO_PROXY}))


def fetch_json(path: str, params: dict[str, str]) -> Any:
    url = f"{BASE_URL}{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "crypto-agent-market-relay/1"})
    with proxy_opener().open(request, timeout=10) as response:
        return json.loads(response.read())


class Relay:
    def __init__(self, feature_db: str = ":memory:") -> None:
        self.lock = threading.RLock()
        self.klines: dict[str, list[list[Any]]] = {interval: [] for interval in INTERVALS}
        self.bids: dict[str, str] = {}
        self.asks: dict[str, str] = {}
        self.last_update_id = 0
        self.previous_update_id = 0
        self.premium: dict[str, Any] = {"markPrice": "0", "indexPrice": "0", "lastFundingRate": "0"}
        self.price = 0.0
        self.revision = 0
        self.depth_ready = False
        self.clients: set[queue.Queue[dict[str, Any]]] = set()
        self.route_lock = threading.Lock()
        self.feature_db = feature_db
        self.feature_samples = 0

    def start(self) -> None:
        self._init_feature_db()
        threading.Thread(target=self._history_loop, daemon=True, name="market-history").start()
        threading.Thread(target=self._broadcast, daemon=True, name="market-broadcast").start()
        threading.Thread(target=self._socket_loop, daemon=True, name="market-websocket").start()
        threading.Thread(target=self._feature_loop, daemon=True, name="market-features").start()

    def _init_feature_db(self) -> None:
        directory = os.path.dirname(self.feature_db)
        if self.feature_db != ":memory:" and directory: os.makedirs(directory, exist_ok=True)
        with sqlite3.connect(self.feature_db) as db:
            if self.feature_db != ":memory:": db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS order_book_features (
                timestamp_ms INTEGER PRIMARY KEY, symbol TEXT NOT NULL, mid REAL NOT NULL, spread_bps REAL NOT NULL,
                bid_depth_5 REAL NOT NULL, ask_depth_5 REAL NOT NULL, imbalance_5 REAL NOT NULL,
                bid_depth_20 REAL NOT NULL, ask_depth_20 REAL NOT NULL, imbalance_20 REAL NOT NULL,
                mark_price REAL NOT NULL, funding_rate REAL NOT NULL
            )""")

    def _feature_loop(self) -> None:
        while True:
            time.sleep(1)
            if self.depth_ready: self._record_feature()

    def _record_feature(self, timestamp_ms: int | None = None) -> bool:
        with self.lock:
            bids = sorted(self.bids.items(), key=lambda pair: float(pair[0]), reverse=True)[:20]
            asks = sorted(self.asks.items(), key=lambda pair: float(pair[0]))[:20]
            if not bids or not asks: return False
            bid, ask = float(bids[0][0]), float(asks[0][0]); mid = (bid + ask) / 2
            depth = lambda levels, count: sum(float(quantity) for _, quantity in levels[:count])
            bid5, ask5, bid20, ask20 = depth(bids, 5), depth(asks, 5), depth(bids, 20), depth(asks, 20)
            imbalance = lambda left, right: (left - right) / max(left + right, 1e-12)
            row = (timestamp_ms or int(time.time() * 1000), SYMBOL, mid, (ask - bid) / mid * 10_000,
                   bid5, ask5, imbalance(bid5, ask5), bid20, ask20, imbalance(bid20, ask20),
                   self.price or mid, float(self.premium.get("lastFundingRate", 0) or 0))
        with sqlite3.connect(self.feature_db) as db:
            db.execute("INSERT OR REPLACE INTO order_book_features VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", row)
            self.feature_samples += 1
            if self.feature_samples % 60 == 0: db.execute("DELETE FROM order_book_features WHERE timestamp_ms < ?", (row[0] - 24 * 60 * 60 * 1000,))
        return True

    def feature_summary(self, now_ms: int | None = None) -> dict[str, Any] | None:
        cutoff = (now_ms or int(time.time() * 1000)) - 24 * 60 * 60 * 1000
        try:
            with sqlite3.connect(self.feature_db) as db:
                row = db.execute("""SELECT COUNT(*), AVG(spread_bps), AVG(imbalance_5), MIN(imbalance_5), MAX(imbalance_5),
                                    AVG(imbalance_20), AVG(bid_depth_20), AVG(ask_depth_20), MIN(timestamp_ms), MAX(timestamp_ms)
                                    FROM order_book_features WHERE timestamp_ms >= ?""", (cutoff,)).fetchone()
            if not row or not row[0]: return None
            return dict(zip(("samples", "avgSpreadBps", "avgImbalance5", "minImbalance5", "maxImbalance5", "avgImbalance20", "avgBidDepth20", "avgAskDepth20", "startTime", "endTime"), row))
        except sqlite3.OperationalError:
            return None

    def _history_loop(self) -> None:
        while not all(self.ready(interval) for interval in INTERVALS):
            self._select_route()
            for interval in INTERVALS:
                if self.klines[interval]: continue
                try:
                    rows = fetch_json("/dapi/v1/klines", {"symbol": SYMBOL, "interval": interval, "limit": "240"})
                    with self.lock: self.klines[interval] = rows[-240:]; self.revision += 1
                except Exception as error:
                    logging.warning("failed to load %s history: %s", interval, type(error).__name__)
            if not self.depth_ready:
                self._load_depth_once()
            if not self.price:
                try:
                    premium = fetch_json("/dapi/v1/premiumIndex", {"symbol": SYMBOL})
                    with self.lock: self.premium = premium[0] if isinstance(premium, list) else premium; self.price = float(self.premium.get("markPrice", 0)); self.revision += 1
                except Exception as error:
                    logging.warning("failed to load premium snapshot: %s", type(error).__name__)
            if not all(self.ready(interval) for interval in INTERVALS): time.sleep(30)

    def _socket_loop(self) -> None:
        if websocket is None:
            logging.error("websocket-client is not installed; market relay is offline")
            return
        while True:
            self._select_route()
            try:
                socket = websocket.WebSocketApp(WS_URL, on_open=self._on_open, on_message=self._on_message,
                                                 on_error=lambda _ws, error: logging.warning("market websocket: %s", error),
                                                 on_close=lambda _ws, _code, _reason: logging.warning("market websocket closed"))
                parsed = urllib.parse.urlparse(MIHOMO_PROXY)
                socket.run_forever(http_proxy_host=parsed.hostname, http_proxy_port=parsed.port, proxy_type="http",
                                   ping_interval=20, ping_timeout=10)
            except Exception:
                logging.exception("market websocket loop failed")
            time.sleep(10)

    def _select_route(self) -> None:
        with self.route_lock:
            try:
                config = open(MIHOMO_CONFIG, encoding="utf-8").read()
                secret_line = next(line for line in config.splitlines() if line.startswith("secret:"))
                secret = secret_line.split(":", 1)[1].strip().strip("'\"")
                headers = {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}
                group_url = f"{MIHOMO_CONTROLLER}/proxies/{urllib.parse.quote('Binance', safe='')}"
                with urllib.request.urlopen(urllib.request.Request(group_url, headers=headers), timeout=3) as response:
                    group = json.loads(response.read())
                candidates = list(dict.fromkeys(group.get("all", [])))
                preferred = sorted(candidates, key=lambda name: (not name.upper().startswith(("JP", "SG", "TW", "KR")), name))
                for candidate in preferred:
                    request = urllib.request.Request(group_url, json.dumps({"name": candidate}).encode(), headers, method="PUT")
                    urllib.request.urlopen(request, timeout=3).close()
                    try:
                        with proxy_opener().open(urllib.request.Request(f"{BASE_URL}/dapi/v1/ping"), timeout=5) as response:
                            if response.status == 200:
                                logging.info("selected Binance route %s", candidate)
                                return
                    except Exception:
                        continue
                logging.warning("no healthy Binance route returned HTTP 200")
            except Exception as error:
                logging.warning("Mihomo route selection unavailable: %s", type(error).__name__)

    def _on_open(self, _socket: websocket.WebSocketApp) -> None:
        logging.info("market websocket connected")

    def _on_message(self, _socket: websocket.WebSocketApp, raw: str) -> None:
        try:
            envelope = json.loads(raw)
            payload = envelope.get("data", envelope)
            event = payload.get("e")
            with self.lock:
                if event == "depthUpdate":
                    self._apply_depth(payload)
                elif event == "kline":
                    item = payload["k"]
                    interval = str(item["i"])
                    row = [item["t"], item["o"], item["h"], item["l"], item["c"], item["v"], item["T"], item["q"]]
                    rows = self.klines.setdefault(interval, [])
                    if rows and int(rows[-1][0]) == int(item["t"]): rows[-1] = row
                    else: rows.append(row)
                    self.klines[interval] = rows[-240:]
                    self.price = float(item["c"])
                    self.revision += 1
                elif event == "aggTrade":
                    self.price = float(payload["p"])
                    self.premium["markPrice"] = str(payload["p"])
                    self.revision += 1
                elif event == "markPriceUpdate":
                    self.premium = {**self.premium, **payload, "markPrice": payload.get("p", self.price),
                                    "indexPrice": payload.get("i", self.premium.get("indexPrice", "0")),
                                    "lastFundingRate": payload.get("r", self.premium.get("lastFundingRate", "0")),
                                    "nextFundingTime": payload.get("T", self.premium.get("nextFundingTime"))}
                    self.price = float(payload.get("p", self.price))
                    self.revision += 1
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            logging.warning("ignored malformed market event")

    def _apply_depth(self, payload: dict[str, Any]) -> None:
        if not self.depth_ready:
            return
        first = int(payload.get("U", 0)); last = int(payload.get("u", 0)); previous = int(payload.get("pu", 0))
        if last <= self.last_update_id:
            return
        # Binance COIN-M diff streams require continuity; a gap is repaired by
        # taking a fresh REST snapshot before applying future events.
        gap = previous != self.previous_update_id if self.previous_update_id else not (first <= self.last_update_id <= last)
        if gap:
            self.depth_ready = False
            threading.Thread(target=self._reload_depth, daemon=True).start()
            return
        for price, quantity in payload.get("b", []):
            if float(quantity): self.bids[str(price)] = str(quantity)
            else: self.bids.pop(str(price), None)
        for price, quantity in payload.get("a", []):
            if float(quantity): self.asks[str(price)] = str(quantity)
            else: self.asks.pop(str(price), None)
        self.last_update_id = last
        self.previous_update_id = last
        self.revision += 1

    def _reload_depth(self) -> None:
        while not self.depth_ready:
            self._select_route()
            if self._load_depth_once(): return
            time.sleep(30)

    def _load_depth_once(self) -> bool:
        try:
            snapshot = fetch_json("/dapi/v1/depth", {"symbol": SYMBOL, "limit": "1000"})
            with self.lock:
                self.last_update_id = int(snapshot["lastUpdateId"])
                self.previous_update_id = 0
                self.bids = {str(price): str(quantity) for price, quantity in snapshot.get("bids", []) if float(quantity)}
                self.asks = {str(price): str(quantity) for price, quantity in snapshot.get("asks", []) if float(quantity)}
                self.depth_ready = True
                self.revision += 1
            return True
        except Exception as error:
            logging.warning("failed to load depth snapshot: %s", type(error).__name__)
            return False

    def snapshot(self, interval: str, history: bool = True) -> dict[str, Any]:
        with self.lock:
            bids = sorted(self.bids.items(), key=lambda pair: float(pair[0]), reverse=True)[:1000]
            asks = sorted(self.asks.items(), key=lambda pair: float(pair[0]))[:1000]
            premium = {**self.premium, "markPrice": str(self.price or self.premium.get("markPrice", "0"))}
            rows = self.klines.get(interval, [])
            snapshot = {"symbol": SYMBOL, "interval": interval, "klines": list(rows if history else rows[-1:]),
                        "depth": {"bids": bids, "asks": asks}, "premium": premium, "partial": not history}
        if history: snapshot["orderBook24h"] = self.feature_summary()
        return snapshot

    def ready(self, interval: str) -> bool:
        with self.lock:
            return bool(self.klines.get(interval) and self.depth_ready and self.price > 0)

    def subscribe(self) -> queue.Queue[dict[str, Any]]:
        client: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=2)
        with self.lock: self.clients.add(client)
        return client

    def unsubscribe(self, client: queue.Queue[dict[str, Any]]) -> None:
        with self.lock: self.clients.discard(client)

    def _broadcast(self) -> None:
        last_revision = -1
        while True:
            time.sleep(.1)
            with self.lock:
                if self.revision == last_revision: continue
                last_revision = self.revision
                clients = list(self.clients)
                payload = {"revision": self.revision}
                for client in clients:
                    try: client.put_nowait(payload)
                    except queue.Full:
                        try: client.get_nowait(); client.put_nowait(payload)
                        except queue.Empty: pass


relay = Relay(FEATURE_DB)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        interval = query.get("interval", ["5m"])[0]
        if interval not in INTERVALS:
            self.send_error(400, "invalid interval")
            return
        if parsed.path == "/healthz":
            data = json.dumps({"ok": True, "ready": relay.ready(interval)}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            return
        if parsed.path == "/snapshot":
            if not relay.ready(interval):
                self.send_error(503, "market upstream is not ready")
                return
            data = json.dumps(relay.snapshot(interval), separators=(",", ":")).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            return
        if parsed.path != "/stream":
            self.send_error(404); return
        if not relay.ready(interval):
            self.send_error(503, "market upstream is not ready")
            return
        self.send_response(200); self.send_header("Content-Type", "text/event-stream; charset=utf-8"); self.send_header("Cache-Control", "no-cache"); self.send_header("Connection", "keep-alive"); self.end_headers()
        client = relay.subscribe()
        try:
            self.wfile.write(f"event: market\ndata: {json.dumps(relay.snapshot(interval), separators=(',', ':'))}\n\n".encode()); self.wfile.flush()
            while True:
                try: client.get(timeout=10)
                except queue.Empty:
                    self.wfile.write(b": heartbeat\n\n"); self.wfile.flush(); continue
                self.wfile.write(f"event: market\ndata: {json.dumps(relay.snapshot(interval, history=False), separators=(',', ':'))}\n\n".encode()); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            relay.unsubscribe(client)

    def log_message(self, format: str, *args: Any) -> None:
        logging.info("market relay %s", format % args)


if __name__ == "__main__":
    relay.start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
