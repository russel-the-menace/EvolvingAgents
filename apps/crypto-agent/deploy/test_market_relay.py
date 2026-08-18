import unittest

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


if __name__ == "__main__":
    unittest.main()
