import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketEventService } from '../src/market.mjs';

test('emits a breaking market event only after it appears in the server archive', async () => {
  let rows = [{ id: 'threshold-1', observedAt: 1, severity: 'breaking' }];
  const service = new MarketEventService({ baseUrl: 'https://gateway.test', apiKey: 'secret', fetchImpl: async () => new Response(JSON.stringify({ items: rows })) });
  const events = []; service.subscribe((event) => events.push(event));
  await service.load();
  rows = [{ id: 'threshold-2', observedAt: 2, severity: 'breaking' }, ...rows];
  await service.poll();
  assert.deepEqual(events.map((event) => event.item.id), ['threshold-2']);
  assert.equal(events[0].type, 'breaking');
});
