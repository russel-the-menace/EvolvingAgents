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
from statistics import median, pstdev
from contextlib import closing
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
NATIVE_INTERVALS = ("1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w", "1M")
INTERVALS = ("1s", *NATIVE_INTERVALS)
BASE_URL = "https://dapi.binance.com"
WS_URL = "wss://dstream.binance.com/stream?streams=" + "/".join(
    [*(f"{SYMBOL.lower()}@kline_{interval}" for interval in NATIVE_INTERVALS),
     f"{SYMBOL.lower()}@aggTrade", f"{SYMBOL.lower()}@depth@100ms", f"{SYMBOL.lower()}@markPrice@1s"]
)
FEATURE_DB = os.getenv("MARKET_FEATURE_DB_PATH", "/var/lib/custom-api-gateway/market-features.sqlite")
HISTORY_RETENTION_MS = int(os.getenv("MARKET_HISTORY_RETENTION_MS", str(7 * 24 * 60 * 60 * 1000)))
THRESHOLDS = tuple(sorted({float(value) for value in os.getenv("MARKET_BREAKING_THRESHOLDS", "").split(",") if value.strip()}))
THRESHOLD_COOLDOWN_MS = int(os.getenv("MARKET_THRESHOLD_COOLDOWN_MS", "300000"))
ANOMALY_MIN_RETURN = float(os.getenv("MARKET_ANOMALY_MIN_RETURN", "0.01"))
ANOMALY_SIGMA = float(os.getenv("MARKET_ANOMALY_SIGMA", "3"))
ANOMALY_VOLUME_MULTIPLIER = float(os.getenv("MARKET_ANOMALY_VOLUME_MULTIPLIER", "2"))
ANOMALY_COOLDOWN_MS = int(os.getenv("MARKET_ANOMALY_COOLDOWN_MS", "900000"))

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
        self.last_trade_price: float | None = None
        self.last_threshold_alert: dict[float, int] = {}
        self.last_anomaly_bucket = 0
        self.last_anomaly_at = 0
        self.last_candle_cleanup = 0

    def start(self) -> None:
        self._init_feature_db()
        threading.Thread(target=self._candle_history_loop, daemon=True, name="candle-history").start()
        threading.Thread(target=self._history_loop, daemon=True, name="market-history").start()
        threading.Thread(target=self._broadcast, daemon=True, name="market-broadcast").start()
        threading.Thread(target=self._socket_loop, daemon=True, name="market-websocket").start()
        threading.Thread(target=self._feature_loop, daemon=True, name="market-features").start()

    def _init_feature_db(self) -> None:
        directory = os.path.dirname(self.feature_db)
        if self.feature_db != ":memory:" and directory: os.makedirs(directory, exist_ok=True)
        with closing(sqlite3.connect(self.feature_db)) as db, db:
            if self.feature_db != ":memory:": db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS order_book_features (
                timestamp_ms INTEGER PRIMARY KEY, symbol TEXT NOT NULL, mid REAL NOT NULL, spread_bps REAL NOT NULL,
                bid_depth_5 REAL NOT NULL, ask_depth_5 REAL NOT NULL, imbalance_5 REAL NOT NULL,
                bid_depth_20 REAL NOT NULL, ask_depth_20 REAL NOT NULL, imbalance_20 REAL NOT NULL,
                mark_price REAL NOT NULL, funding_rate REAL NOT NULL
            )""")
            db.execute("""CREATE TABLE IF NOT EXISTS market_events (
                id TEXT PRIMARY KEY, observed_at_ms INTEGER NOT NULL, symbol TEXT NOT NULL,
                event_type TEXT NOT NULL, severity TEXT NOT NULL, direction TEXT NOT NULL,
                threshold REAL NOT NULL, price REAL NOT NULL, previous_price REAL NOT NULL,
                source TEXT NOT NULL, evidence_json TEXT NOT NULL
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS market_events_observed_at ON market_events(observed_at_ms DESC)")
            db.execute("DELETE FROM market_events WHERE event_type='market_update'")
            db.execute("""CREATE TABLE IF NOT EXISTS market_candles (
                symbol TEXT NOT NULL, interval TEXT NOT NULL, open_time_ms INTEGER NOT NULL,
                open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
                volume REAL NOT NULL, close_time_ms INTEGER NOT NULL, quote_volume REAL NOT NULL,
                PRIMARY KEY(symbol, interval, open_time_ms)
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS market_candles_lookup ON market_candles(symbol, interval, open_time_ms)")

    def _store_candle(self, interval: str, row: list[Any]) -> None:
        now = int(time.time() * 1000)
        with closing(sqlite3.connect(self.feature_db)) as db, db:
            db.execute("INSERT OR REPLACE INTO market_candles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (SYMBOL, interval, int(row[0]), *[float(value) for value in row[1:6]], int(row[6]), float(row[7])))
            if now - self.last_candle_cleanup >= 60 * 60_000:
                db.execute("DELETE FROM market_candles WHERE open_time_ms < ?", (now - HISTORY_RETENTION_MS,))
                self.last_candle_cleanup = now

    def _candle_history_loop(self) -> None:
        while True:
            time.sleep(6 * 60 * 60 if self._load_candle_history() else 30)

    def _load_candle_history(self) -> bool:
        end = int(time.time() * 1000); cursor = end - HISTORY_RETENTION_MS
        while cursor < end:
            try:
                rows = fetch_json("/dapi/v1/klines", {"symbol": SYMBOL, "interval": "1m", "startTime": str(cursor), "endTime": str(end), "limit": "1500"})
                if not rows: break
                with closing(sqlite3.connect(self.feature_db)) as db, db:
                    db.executemany("INSERT OR REPLACE INTO market_candles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [(SYMBOL, "1m", int(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5]), int(row[6]), float(row[7])) for row in rows])
                cursor = int(rows[-1][0]) + 60_000
                if len(rows) < 1500: break
            except Exception as error:
                logging.warning("failed to load candle history: %s", type(error).__name__); return False
        return True

    def history(self, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        start = max(start_ms, int(time.time() * 1000) - HISTORY_RETENTION_MS); end = min(end_ms, int(time.time() * 1000))
        if start >= end: return []
        with closing(sqlite3.connect(self.feature_db)) as db:
            rows = db.execute("SELECT open_time_ms,open,high,low,close,volume,close_time_ms,quote_volume FROM market_candles WHERE symbol=? AND interval='1m' AND open_time_ms BETWEEN ? AND ? ORDER BY open_time_ms LIMIT 11000", (SYMBOL, start, end)).fetchall()
        keys = ("time", "open", "high", "low", "close", "volume", "closeTime", "quoteVolume")
        return [dict(zip(keys, row)) for row in rows]

    def _record_threshold_crossing(self, price: float, previous_price: float | None, timestamp_ms: int, trade_id: Any) -> None:
        if previous_price is None: return
        for threshold in THRESHOLDS:
            if not previous_price < threshold <= price: continue
            last_alert = self.last_threshold_alert.get(threshold)
            if last_alert is not None and timestamp_ms - last_alert < THRESHOLD_COOLDOWN_MS: continue
            event_id = f"{SYMBOL}:threshold_up:{threshold:g}:{timestamp_ms}"
            evidence = json.dumps({"stream": "aggTrade", "tradeId": trade_id}, separators=(",", ":"))
            with closing(sqlite3.connect(self.feature_db)) as db, db:
                db.execute("INSERT OR IGNORE INTO market_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           (event_id, timestamp_ms, SYMBOL, "price_threshold_crossed", "breaking", "up", threshold,
                            price, previous_price, "binance_coinm_agg_trade", evidence))
                db.execute("DELETE FROM market_events WHERE observed_at_ms < ?", (timestamp_ms - 90 * 24 * 60 * 60 * 1000,))
            self.last_threshold_alert[threshold] = timestamp_ms

    def _record_market_anomaly(self, timestamp_ms: int, trade_id: Any) -> None:
        rows = self.klines.get("1m", [])
        if len(rows) < 16: return
        bucket = int(rows[-1][0])
        if bucket == self.last_anomaly_bucket or timestamp_ms - self.last_anomaly_at < ANOMALY_COOLDOWN_MS: return
        closes = [float(row[4]) for row in rows]
        returns = [(closes[index] / closes[index - 1]) - 1 for index in range(1, len(closes))]
        move = (closes[-1] / closes[-6]) - 1
        baseline = returns[-15:-5]
        if len(baseline) < 5: return
        volatility = pstdev(baseline) or 0
        current_volume = sum(float(row[5]) for row in rows[-5:])
        baseline_volumes = [sum(float(row[5]) for row in rows[index - 5:index]) for index in range(6, len(rows) - 4)]
        typical_volume = median(baseline_volumes) if baseline_volumes else 0
        if abs(move) < max(ANOMALY_MIN_RETURN, ANOMALY_SIGMA * volatility): return
        if typical_volume and current_volume < ANOMALY_VOLUME_MULTIPLIER * typical_volume: return
        event_id = f"{SYMBOL}:market_anomaly:{bucket}"
        evidence = json.dumps({"stream": "aggTrade", "tradeId": trade_id, "windowMs": 300000,
                               "return": move, "baselineVolatility": volatility,
                               "volume": current_volume, "typicalVolume": typical_volume}, separators=(",", ":"))
        with closing(sqlite3.connect(self.feature_db)) as db, db:
            db.execute("INSERT OR IGNORE INTO market_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       (event_id, timestamp_ms, SYMBOL, "market_anomaly", "breaking", "up" if move > 0 else "down",
                        0, closes[-1], closes[-6], "binance_coinm_agg_trade", evidence))
        self.last_anomaly_bucket = bucket
        self.last_anomaly_at = timestamp_ms

    def events(self, limit: int = 30, before: int | None = None) -> list[dict[str, Any]]:
        limit = min(max(limit, 1), 100)
        query = "SELECT id, observed_at_ms, symbol, event_type, severity, direction, threshold, price, previous_price, source, evidence_json FROM market_events"
        params: tuple[Any, ...] = ()
        if before is not None:
            query += " WHERE observed_at_ms < ?"; params = (before,)
        query += " ORDER BY observed_at_ms DESC LIMIT ?"; params += (limit,)
        with closing(sqlite3.connect(self.feature_db)) as db:
            rows = db.execute(query, params).fetchall()
        keys = ("id", "observedAt", "symbol", "eventType", "severity", "direction", "threshold", "price", "previousPrice", "source", "evidence")
        return [{**dict(zip(keys[:-1], row[:-1])), "evidence": json.loads(row[-1])} for row in rows]

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
        with closing(sqlite3.connect(self.feature_db)) as db, db:
            db.execute("INSERT OR REPLACE INTO order_book_features VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", row)
            self.feature_samples += 1
            if self.feature_samples % 60 == 0: db.execute("DELETE FROM order_book_features WHERE timestamp_ms < ?", (row[0] - HISTORY_RETENTION_MS,))
        return True

    def feature_summary(self, now_ms: int | None = None) -> dict[str, Any] | None:
        cutoff = (now_ms or int(time.time() * 1000)) - 24 * 60 * 60 * 1000
        try:
            with closing(sqlite3.connect(self.feature_db)) as db:
                row = db.execute("""SELECT COUNT(*), AVG(spread_bps), AVG(imbalance_5), MIN(imbalance_5), MAX(imbalance_5),
                                    AVG(imbalance_20), AVG(bid_depth_20), AVG(ask_depth_20), MIN(timestamp_ms), MAX(timestamp_ms)
                                    FROM order_book_features WHERE timestamp_ms >= ?""", (cutoff,)).fetchone()
            if not row or not row[0]: return None
            return dict(zip(("samples", "avgSpreadBps", "avgImbalance5", "minImbalance5", "maxImbalance5", "avgImbalance20", "avgBidDepth20", "avgAskDepth20", "startTime", "endTime"), row))
        except sqlite3.OperationalError:
            return None

    def feature_window(self, start_ms: int, end_ms: int, now_ms: int | None = None) -> dict[str, Any] | None:
        now = now_ms or int(time.time() * 1000)
        end = min(end_ms, now); start = max(start_ms, now - HISTORY_RETENTION_MS)
        if start >= end: return None
        duration = end - start
        base_resolution = 1_000 if end >= now - 15 * 60_000 and duration <= 10 * 60_000 else 60_000 if duration <= 3 * 60 * 60_000 else 300_000
        resolution = max(base_resolution, ((duration + 359_999) // 360_000) * 1_000)
        try:
            with closing(sqlite3.connect(self.feature_db)) as db:
                rows = db.execute("""SELECT CAST(timestamp_ms / ? AS INTEGER) * ? AS bucket, COUNT(*),
                    AVG(mid), MIN(mid), MAX(mid), AVG(spread_bps), AVG(bid_depth_5), AVG(ask_depth_5),
                    AVG(imbalance_5), MIN(imbalance_5), MAX(imbalance_5), AVG(bid_depth_20),
                    AVG(ask_depth_20), AVG(imbalance_20), AVG(mark_price), AVG(funding_rate)
                    FROM order_book_features WHERE timestamp_ms BETWEEN ? AND ?
                    GROUP BY bucket ORDER BY bucket LIMIT 400""", (resolution, resolution, start, end)).fetchall()
            if not rows: return None
            keys = ("time", "samples", "mid", "minMid", "maxMid", "spreadBps", "bidDepth5", "askDepth5",
                    "imbalance5", "minImbalance5", "maxImbalance5", "bidDepth20", "askDepth20",
                    "imbalance20", "markPrice", "fundingRate")
            points = [dict(zip(keys, row)) for row in rows]
            return {"startTime": start, "endTime": end, "resolutionMs": resolution,
                    "sourceSamples": sum(point["samples"] for point in points), "points": points}
        except sqlite3.OperationalError:
            return None

    def _history_loop(self) -> None:
        while not all(self.ready(interval) for interval in NATIVE_INTERVALS):
            self._select_route()
            for interval in NATIVE_INTERVALS:
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
            if not all(self.ready(interval) for interval in NATIVE_INTERVALS): time.sleep(30)

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
                    if interval == "1m": self._store_candle(interval, row)
                    self.price = float(item["c"])
                    self.revision += 1
                elif event == "aggTrade":
                    price, quantity = float(payload["p"]), float(payload.get("q", 0))
                    timestamp = int(payload.get("T") or payload.get("E") or time.time() * 1000)
                    previous_trade_price = self.last_trade_price
                    self.last_trade_price = price
                    bucket = timestamp // 1_000 * 1_000
                    rows = self.klines["1s"]
                    if rows and int(rows[-1][0]) == bucket:
                        previous = rows[-1]
                        rows[-1] = [bucket, previous[1], str(max(float(previous[2]), price)), str(min(float(previous[3]), price)), str(price), str(float(previous[5]) + quantity), bucket + 999, str(float(previous[7]) + price * quantity)]
                    else:
                        rows.append([bucket, str(price), str(price), str(price), str(price), str(quantity), bucket + 999, str(price * quantity)])
                    self.klines["1s"] = rows[-240:]
                    self.price = price
                    self.premium["markPrice"] = str(payload["p"])
                    self.revision += 1
                    self._record_threshold_crossing(price, previous_trade_price, timestamp, payload.get("a"))
                    self._record_market_anomaly(timestamp, payload.get("a"))
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

    def snapshot(self, interval: str, history: bool = True, feature_range: tuple[int, int] | None = None) -> dict[str, Any]:
        with self.lock:
            bids = sorted(self.bids.items(), key=lambda pair: float(pair[0]), reverse=True)[:1000]
            asks = sorted(self.asks.items(), key=lambda pair: float(pair[0]))[:1000]
            premium = {**self.premium, "markPrice": str(self.price or self.premium.get("markPrice", "0"))}
            rows = self.klines.get(interval, [])
            snapshot = {"symbol": SYMBOL, "interval": interval, "klines": list(rows if history else rows[-1:]),
                        "depth": {"bids": bids, "asks": asks}, "premium": premium, "partial": not history}
        if history: snapshot["orderBook24h"] = self.feature_summary()
        if history and feature_range: snapshot["orderBookWindow"] = self.feature_window(*feature_range)
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
            feature_range = None
            try:
                if "featureStartTime" in query and "featureEndTime" in query:
                    feature_range = (int(query["featureStartTime"][0]), int(query["featureEndTime"][0]))
            except ValueError:
                self.send_error(400, "invalid feature range"); return
            data = json.dumps(relay.snapshot(interval, feature_range=feature_range), separators=(",", ":")).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            return
        if parsed.path == "/events":
            try:
                limit = int(query.get("limit", ["30"])[0]); before = query.get("before", [None])[0]
                data = json.dumps({"items": relay.events(limit, int(before) if before else None)}, separators=(",", ":")).encode()
            except ValueError:
                self.send_error(400, "invalid event cursor"); return
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            return
        if parsed.path == "/history":
            try:
                start = int(query.get("startTime", [str(int(time.time() * 1000) - HISTORY_RETENTION_MS)])[0])
                end = int(query.get("endTime", [str(int(time.time() * 1000))])[0])
                data = json.dumps({"symbol": SYMBOL, "interval": "1m", "klines": relay.history(start, end)}, separators=(",", ":")).encode()
            except ValueError:
                self.send_error(400, "invalid history range"); return
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
