import unittest
import tempfile
import sqlite3
import time
from contextlib import closing

from market_relay import Relay


class DepthSequenceTest(unittest.TestCase):
    def test_aggregates_trades_into_one_second_klines(self) -> None:
        relay = Relay()
        relay._on_message(None, '{"data":{"e":"aggTrade","p":"100","q":"2","T":1100}}')
        relay._on_message(None, '{"data":{"e":"aggTrade","p":"105","q":"3","T":1900}}')
        relay._on_message(None, '{"data":{"e":"aggTrade","p":"103","q":"1","T":2100}}')
        self.assertEqual(relay.klines["1s"][0], [1000, "100.0", "105.0", "100.0", "105.0", "5.0", 1999, "515.0"])
        self.assertEqual(len(relay.klines["1s"]), 2)

    def test_snapshot_accepts_first_event_then_requires_previous_update(self) -> None:
        relay = Relay()
        relay.depth_ready = True
        relay.last_update_id = 10
        relay.bids = {"1": "2"}
        relay.asks = {"2": "3"}

        relay._apply_depth({"U": 10, "u": 12, "pu": 9, "b": [["1", "0"], ["1.1", "4"]], "a": [["2", "0"]]})
        relay._apply_depth({"U": 13, "u": 13, "pu": 12, "b": [["1.2", "5"]], "a": []})

        self.assertEqual(relay.bids, {"1.1": "4", "1.2": "5"})
        self.assertEqual(relay.asks, {})
        self.assertEqual(relay.previous_update_id, 13)
        self.assertTrue(relay.depth_ready)

    def test_records_compact_order_book_features(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            relay = Relay(f"{directory}/features.sqlite")
            relay._init_feature_db()
            relay.depth_ready = True
            relay.bids = {"100": "3", "99": "2"}
            relay.asks = {"101": "1", "102": "4"}
            relay.price = 100.5

            self.assertTrue(relay._record_feature(1_000_000))
            summary = relay.feature_summary(1_000_000)
            self.assertEqual(summary["samples"], 1)
            self.assertAlmostEqual(summary["avgImbalance20"], 0)

    def test_feature_window_keeps_recent_detail_and_aggregates_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            relay = Relay(f"{directory}/features.sqlite")
            relay._init_feature_db(); relay.depth_ready = True
            relay.bids = {"100": "3"}; relay.asks = {"101": "1"}; relay.price = 100.5
            now = 20_000_000
            timestamps = [*range(now - 300_000, now, 1_000), *range(now - 10_800_000, now - 7_200_000, 10_000)]
            with closing(sqlite3.connect(relay.feature_db)) as db, db:
                db.executemany("INSERT INTO order_book_features VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               [(timestamp, "BTCUSD_PERP", 100.5, 1, 3, 1, .5, 3, 1, .5, 100.5, 0) for timestamp in timestamps])
            recent = relay.feature_window(now - 300_000, now, now)
            self.assertEqual(recent["resolutionMs"], 1_000)
            self.assertEqual(len(recent["points"]), 300)
            historical = relay.feature_window(now - 10_800_000, now - 7_200_000, now)
            self.assertEqual(historical["resolutionMs"], 60_000)
            self.assertLessEqual(len(historical["points"]), 61)

    def test_records_an_upward_threshold_crossing_once_per_cooldown(self) -> None:
        import market_relay
        with tempfile.TemporaryDirectory() as directory:
            original_thresholds = market_relay.THRESHOLDS
            market_relay.THRESHOLDS = (65000,)
            relay = Relay(f"{directory}/features.sqlite")
            relay._init_feature_db()
            relay._on_message(None, '{"data":{"e":"aggTrade","p":"64999","q":"1","T":1000,"a":1}}')
            relay._on_message(None, '{"data":{"e":"aggTrade","p":"65001","q":"1","T":2000,"a":2}}')
            event = relay.events()[0]
            self.assertEqual(event["eventType"], "price_threshold_crossed")
            self.assertEqual(event["direction"], "up")
            self.assertEqual(event["threshold"], 65000)
            self.assertEqual(event["previousPrice"], 64999)
            market_relay.THRESHOLDS = original_thresholds

    def test_records_adaptive_anomaly_without_an_absolute_price_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            relay = Relay(f"{directory}/features.sqlite")
            relay._init_feature_db()
            relay.klines["1m"] = [[index * 60_000, "100", "100", "100", str(100 + index * .01), "10", 0, "0"] for index in range(16)]
            relay.klines["1m"][-1][4] = "103"
            for row in relay.klines["1m"][-5:]: row[5] = "30"
            relay._record_market_anomaly(1_000_000, 1)
            event = relay.events()[0]
            self.assertEqual(event["eventType"], "market_anomaly")
            self.assertEqual(event["threshold"], 0)

    def test_persists_and_queries_recent_one_minute_candles(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            relay = Relay(f"{directory}/features.sqlite")
            relay._init_feature_db()
            now = int(time.time() * 1000) // 60_000 * 60_000
            relay._store_candle("1m", [now, "100", "102", "99", "101", "3", now + 59_999, "303"])
            rows = relay.history(now - 60_000, now + 60_000)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["close"], 101)

    def test_backfills_regular_five_minute_market_updates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            relay = Relay(f"{directory}/features.sqlite")
            relay._init_feature_db()
            now = int(time.time() * 1000) // 60_000 * 60_000
            with closing(sqlite3.connect(relay.feature_db)) as db, db:
                db.executemany("INSERT INTO market_candles VALUES (?, '1m', ?, ?, ?, ?, ?, ?, ?, ?)",
                               [("BTCUSD_PERP", now - (5 - index) * 60_000, 100, 102, 99, 100 + index, 10, now, 1000) for index in range(5)])
            relay._backfill_market_updates()
            event = relay.events()[0]
            self.assertEqual(event["eventType"], "market_update")
            self.assertEqual(event["severity"], "normal")


if __name__ == "__main__":
    unittest.main()
