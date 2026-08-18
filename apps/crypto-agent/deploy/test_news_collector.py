import json
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("news_collector", Path(__file__).with_name("news-collector.py"))
news_collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(news_collector)


class CexAnnouncementsTest(unittest.TestCase):
    def test_normalizes_official_binance_and_okx_announcements(self) -> None:
        original_fetch = news_collector.fetch
        payloads = {
            news_collector.BINANCE_ANNOUNCEMENTS: {"data": {"catalogs": [{"articles": [{"code": "abc", "title": "Binance listing", "releaseDate": 1_756_000_000_000}]}]}},
            news_collector.OKX_ANNOUNCEMENTS: {"data": [{"details": [{"title": "OKX listing", "url": "https://www.okx.com/help/a", "pTime": "1756000000000"}]}]},
        }
        news_collector.fetch = lambda url: json.dumps(payloads[url]).encode()
        try:
            binance = news_collector.binance_announcements()[0]
            okx = news_collector.okx_announcements()[0]
        finally:
            news_collector.fetch = original_fetch
        self.assertEqual(binance["source"], "Binance 官方公告")
        self.assertEqual(binance["url"], "https://www.binance.com/en/support/announcement/abc")
        self.assertEqual(okx["source"], "OKX 官方公告")
        self.assertEqual(okx["publishedAt"], "2025-08-24T01:46:40Z")


if __name__ == "__main__":
    unittest.main()
