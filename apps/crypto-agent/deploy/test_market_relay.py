import unittest
import tempfile

from market_relay import Relay


class DepthSequenceTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
