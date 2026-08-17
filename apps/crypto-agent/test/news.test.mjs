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

test('two-hour digests consume a cursor and do not repeat items', async () => {
  const now = Date.now();
  let learned = 0;
  const service = new (await import('../src/news.mjs')).NewsService({ learnItem: async () => { learned += 1; } });
  service.items.set('a', { id: 'a', title: 'A', url: 'https://example.test/a', source: 'example.test', summary: '', publishedAt: new Date(now - 60_000).toISOString(), urgency: 'normal' });
  const first = await service.twoHourDigest();
  const second = await service.twoHourDigest();
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(learned, 0);
});

test('new feed items are handed to the learning hook once', async () => {
  let learned = 0;
  const service = new (await import('../src/news.mjs')).NewsService({
    feedUrls: ['https://example.test/feed.xml'],
    learnItem: async () => { learned += 1; },
    fetchImpl: async () => new Response('<rss><channel><item><title>New report</title><link>https://example.test/a</link><pubDate>Tue, 18 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>'),
  });
  await service.poll();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await service.poll();
  assert.equal(learned, 1);
});
