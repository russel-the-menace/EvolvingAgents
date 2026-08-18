import test from 'node:test';
import assert from 'node:assert/strict';
import { NewsService } from '../src/news.mjs';

test('reads news and cursor pages only from the custom API gateway', async () => {
  const calls = [];
  const service = new NewsService({ baseUrl: 'https://gateway.test', apiKey: 'secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ items: [{ id: 'a', title: 'A', publishedAt: '2026-08-18T10:00:00Z' }], nextCursor: 'next' }));
  } });
  const result = await service.history({ limit: 20, before: 'cursor' });
  assert.equal(result.nextCursor, 'next');
  assert.match(calls[0].url, /\/v1\/news\/archive\?limit=20&before=cursor$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.equal(calls[0].options.method, undefined);
});

test('polling emits only newly archived server items after initial load', async () => {
  let rows = [{ id: 'a', title: 'A', publishedAt: '2026-08-18T10:00:00Z', urgency: 'normal' }];
  const service = new NewsService({ baseUrl: 'https://gateway.test', apiKey: 'secret', fetchImpl: async () => new Response(JSON.stringify({ items: rows })) });
  const events = []; service.subscribe((event) => events.push(event));
  await service.load();
  rows = [{ id: 'b', title: 'B', publishedAt: '2026-08-18T10:01:00Z', urgency: 'breaking' }, ...rows];
  await service.poll();
  assert.deepEqual(events.map((event) => event.type), ['item', 'breaking']);
  assert.equal(service.recent()[0].id, 'b');
});
