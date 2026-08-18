import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBinanceAnnouncements, parseFeed, parseNewsJson, parseOkxAnnouncements } from '../src/news.mjs';

test('parses RSS items and marks urgent headlines', () => {
  const items = parseFeed('<rss><channel><item><title>Binance halts withdrawals after exploit</title><link>https://example.test/a</link><pubDate>Tue, 18 Aug 2026 10:00:00 GMT</pubDate><description><![CDATA[Security incident]]></description></item></channel></rss>', 'example.test');
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'example.test');
  assert.equal(items[0].urgency, 'breaking');
  assert.equal(items[0].url, 'https://example.test/a');
});

test('normalizes aggregated JSON news and social items', () => {
  const items = parseNewsJson({ articles: [{ id: '42', text: 'BTC ETF approved', createdAt: 1_756_000_000, author: { name: 'KOL' } }] }, 'X · BTC');
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'KOL');
  assert.equal(items[0].urgency, 'breaking');
  assert.equal(items[0].url, 'https://x.com/i/web/status/42');
});

test('normalizes official Binance and OKX announcement payloads', () => {
  const binance = parseBinanceAnnouncements({ data: { catalogs: [{ articles: [{ code: 'abc', title: 'Binance listing', releaseDate: 1_756_000_000_000 }] }] } });
  const okx = parseOkxAnnouncements({ data: [{ details: [{ title: 'OKX listing', url: 'https://www.okx.com/help/a', pTime: '1756000000000' }] }] });
  assert.equal(binance[0].source, 'Binance');
  assert.match(binance[0].url, /binance\.com\/en\/support\/announcement\/abc/);
  assert.equal(okx[0].source, 'OKX');
  assert.equal(okx[0].url, 'https://www.okx.com/help/a');
});

test('polls configured JSON sources alongside RSS', async () => {
  const service = new (await import('../src/news.mjs')).NewsService({
    apiSources: [{ name: 'aggregator', url: 'https://example.test/api' }],
    fetchImpl: async () => new Response(JSON.stringify({ items: [{ title: 'Market update', url: 'https://example.test/a', publishedAt: '2026-08-18T10:00:00Z' }] }), { headers: { 'Content-Type': 'application/json' } }),
  });
  const fresh = await service.poll();
  assert.equal(fresh.length, 1);
  assert.equal(service.recent()[0].source, 'aggregator');
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

test('archives every fresh item and emits it to live subscribers', async () => {
  const requests = [];
  const service = new (await import('../src/news.mjs')).NewsService({
    feedUrls: ['https://publisher.test/feed.xml'],
    archiveUrl: 'https://archive.test',
    archiveKey: 'secret',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('/v1/news/archive')) return new Response('{"stored":1}', { headers: { 'Content-Type': 'application/json' } });
      return new Response('<rss><channel><item><title>Persistent report</title><link>https://publisher.test/a</link><pubDate>Tue, 18 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>');
    },
  });
  const events = [];
  service.subscribe((event) => events.push(event));
  await service.poll();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events[0].type, 'item');
  assert.equal(JSON.parse(requests.find((request) => request.url.includes('/v1/news/archive')).options.body).items[0].title, 'Persistent report');
});
