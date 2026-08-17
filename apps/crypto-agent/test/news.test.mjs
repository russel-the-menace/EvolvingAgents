import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../src/news.mjs';

test('parses RSS items and marks urgent headlines', () => {
  const items = parseFeed('<rss><channel><item><title>Binance halts withdrawals after exploit</title><link>https://example.test/a</link><pubDate>Tue, 18 Aug 2026 10:00:00 GMT</pubDate><description><![CDATA[Security incident]]></description></item></channel></rss>', 'example.test');
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'example.test');
  assert.equal(items[0].urgency, 'breaking');
  assert.equal(items[0].url, 'https://example.test/a');
});
