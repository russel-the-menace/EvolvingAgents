#!/usr/bin/env python3
"""Collect public crypto news into the server-side SQLite archive."""

import hashlib
import html
import json
import os
import re
import sqlite3
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

DB = Path(os.getenv("NEWS_DB_PATH", "/var/lib/custom-api-gateway/news.sqlite"))
INTERVAL = max(30, int(os.getenv("NEWS_POLL_SECONDS", "60")))
PROXY = os.getenv("MIHOMO_PROXY", "http://127.0.0.1:7890")
FEEDS = [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://decrypt.co/feed",
    "https://bitcoinmagazine.com/.rss/full/",
    "https://blog.kraken.com/feed",
    "https://rsshub.app/binance/announcement",
    "https://rsshub.app/okx/announcement",
    "https://rsshub.app/bybit/announcement",
]
API = os.getenv("CRYPTO_NEWS_URL", "https://cryptocurrency.cv/api/news?limit=100")
URGENT = ("hack", "exploit", "breach", "bankrupt", "halt", "outage", "delist", "listing", "liquidat", "黑客", "攻击", "漏洞", "暂停", "下架", "清算", "破产", "暴跌", "暴涨")


def clean(value=""):
    return " ".join(re.sub(r"<[^>]+>", " ", html.unescape(str(value or ""))).split())


def iso_date(value):
    raw = str(value or "")
    try:
        date = parsedate_to_datetime(raw) if "," in raw else datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return date.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError):
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize(title, url, source, summary, published_at):
    title, url, summary = clean(title)[:500], clean(url)[:2000], clean(summary)[:2000]
    if not title or not url:
        return None
    body = f"{title} {summary}".lower()
    return {"id": hashlib.sha256(f"{url}|{title}".encode()).hexdigest()[:20], "title": title, "url": url, "source": clean(source)[:200], "summary": summary, "publishedAt": iso_date(published_at), "urgency": "breaking" if any(word in body for word in URGENT) else "normal"}


def fetch(url):
    request = urllib.request.Request(url, headers={"Accept": "application/rss+xml, application/json", "User-Agent": "CryptoAgent-News/1"})
    handler = urllib.request.ProxyHandler({"http": PROXY, "https": PROXY})
    with urllib.request.build_opener(handler).open(request, timeout=15) as response:
        return response.read()


def rss(url):
    root, source, results = ET.fromstring(fetch(url)), urllib.parse.urlparse(url).hostname or url, []
    for node in root.iter():
        if node.tag.split("}")[-1] not in {"item", "entry"}:
            continue
        fields = {child.tag.split("}")[-1]: child for child in node}
        link = fields.get("link")
        value = normalize(fields.get("title").text if fields.get("title") is not None else "", link.get("href") if link is not None and link.get("href") else link.text if link is not None else "", source, fields.get("description").text if fields.get("description") is not None else fields.get("summary").text if fields.get("summary") is not None else "", fields.get("pubDate").text if fields.get("pubDate") is not None else fields.get("published").text if fields.get("published") is not None else fields.get("updated").text if fields.get("updated") is not None else "")
        if value:
            results.append(value)
    return results


def api_news():
    payload, results = json.loads(fetch(API)), []
    rows = payload if isinstance(payload, list) else next((payload[key] for key in ("articles", "items", "data", "results", "news") if isinstance(payload.get(key), list)), [])
    for row in rows:
        value = normalize(row.get("title") or row.get("headline") or row.get("text"), row.get("url") or row.get("link") or row.get("news_url"), row.get("source") or row.get("publisher") or "cryptocurrency.cv", row.get("summary") or row.get("description") or row.get("content") or "", row.get("publishedAt") or row.get("published_at") or row.get("createdAt") or row.get("date"))
        if value:
            results.append(value)
    return results


def store(items):
    DB.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB) as db:
        db.execute("CREATE TABLE IF NOT EXISTS news(id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,source TEXT NOT NULL,summary TEXT NOT NULL,published_at TEXT NOT NULL,urgency TEXT NOT NULL,ingested_at INTEGER NOT NULL)")
        before = db.total_changes
        db.executemany("INSERT OR IGNORE INTO news(id,title,url,source,summary,published_at,urgency,ingested_at) VALUES(:id,:title,:url,:source,:summary,:publishedAt,:urgency,:ingestedAt)", [{**item, "ingestedAt": int(time.time() * 1000)} for item in items])
        return db.total_changes - before


def collect():
    items = []
    feeds = [value.strip() for value in os.getenv("NEWS_RSS_URLS", ",".join(FEEDS)).split(",") if value.strip()]
    for url in feeds:
        try:
            items.extend(rss(url))
        except Exception as error:
            print(f"feed failed: {url}: {error}", flush=True)
    try:
        items.extend(api_news())
    except Exception as error:
        print(f"api failed: {error}", flush=True)
    return store(items)


if __name__ == "__main__":
    while True:
        started = time.monotonic()
        try:
            print(f"stored {collect()} new items", flush=True)
        except Exception as error:
            print(f"collection failed: {error}", flush=True)
        time.sleep(max(1, INTERVAL - (time.monotonic() - started)))
