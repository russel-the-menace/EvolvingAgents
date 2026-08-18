import unittest
import tempfile
import sqlite3
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


if __name__ == "__main__":
    unittest.main()
