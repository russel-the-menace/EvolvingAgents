import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteLearningStore } from '@evolving-agents/learning-engine';
import { createCryptoKnowledgeEngine } from '../src/learning.mjs';

test('financial knowledge is cited and unavailable before it was known', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const store = createSqliteLearningStore(db);
  const extractor = {
    extract: async ({ chunk }) => [{
      title: 'Funding-rate mechanism',
      proposition: 'Persistently positive funding transfers value from long positions to short positions.',
      kind: 'market_mechanism',
      assetScope: ['crypto_perpetuals'],
      evidenceType: 'exchange_documentation',
      sourceQuote: chunk.text,
      confidence: 0.95,
    }],
  };
  const engine = createCryptoKnowledgeEngine({ store, extractor });
  const { source } = await engine.ingest({
    title: 'Perpetual futures documentation',
    sourceType: 'exchange_documentation',
    sourceActor: 'exchange',
    metadata: {
      knownAt: '2026-08-13T10:00:00Z',
      publishedAt: '2026-08-13T09:00:00Z',
      evidenceType: 'exchange_documentation',
      authorityLevel: 'primary_source',
    },
    content: 'When the funding rate is positive, long positions pay short positions.',
  });
  await engine.learn(source.id);

  const beforePublication = await engine.retrieve('positive funding long short', {
    now: '2026-08-13T09:59:59Z',
  });
  assert.equal(beforePublication.length, 0);

  const available = await engine.retrieve('positive funding long short', {
    now: '2026-08-13T10:00:00Z',
  });
  assert.equal(available.length, 1);
  assert.deepEqual(available[0].claim.attributes.assetScope, ['crypto_perpetuals']);
  assert.match(engine.buildEvidenceContext(available)[0].evidence, /long positions pay short positions/);
  db.close();
});
