import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLearningEngine, createSqliteLearningStore } from '../src/index.mjs';

function fixture(overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const store = createSqliteLearningStore(db);
  let version = 'v1';
  const engine = createLearningEngine({
    store,
    chunking: { maxChars: 400, overlapChars: 40 },
    extractor: { extract: async ({ chunk }) => [{
      title: `Rule ${version}`, proposition: `${version}: ${chunk.text.slice(0, 80)}`, kind: 'rule', sourceQuote: chunk.text.slice(0, 80),
    }] },
    policy: {
      mapProposal: ({ proposal, source, chunk }) => ({
        claim: { ...proposal, owner: source.sourceActor, epistemicStatus: 'active', authorizationScope: 'knowledge' },
        evidence: [{ text: proposal.sourceQuote, owner: source.sourceActor, ordinal: chunk.ordinal,
          startOffset: chunk.startOffset, endOffset: chunk.endOffset }],
      }),
      canRetrieve: () => true,
    },
    ...overrides,
  });
  return { db, store, engine, setVersion: (next) => { version = next; } };
}

test('ingest deduplicates identical content by checksum', async () => {
  const { db, engine, store } = fixture();
  const first = await engine.ingest({ title: 'First', sourceType: 'note', content: 'Same material' });
  const second = await engine.ingest({ title: 'Second', sourceType: 'note', content: 'Same material' });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.source.id, first.source.id);
  assert.equal(store.listSources().length, 1);
  db.close();
});

test('ingest rejects credentials nested in source metadata', async () => {
  const { db, engine } = fixture();
  await assert.rejects(
    engine.ingest({
      title: 'Private page', sourceType: 'html', content: 'Policy text',
      metadata: { acquisition: { cookies: 'session=secret' } },
    }),
    /Credentials must not be persisted/,
  );
  db.close();
});

test('custom reranker controls final ordering', async () => {
  const candidates = ['first', 'second'].map((id, index) => ({
    claim: { id, title: id, proposition: 'scholarship rule', tags: [] },
    evidence: [], searchScore: 2 - index,
  }));
  const { db, engine } = fixture({
    retrievers: [() => candidates],
    reranker: ({ candidates: ranked }) => [...ranked].reverse(),
  });
  const results = await engine.retrieve('scholarship', { limit: 2 });
  assert.deepEqual(results.map((result) => result.claim.id), ['second', 'first']);
  db.close();
});

test('relearning replaces stale derivations and retains evidence offsets', async () => {
  const { db, engine, store, setVersion } = fixture();
  const { source } = await engine.ingest({
    title: 'Policy', sourceType: 'document', sourceActor: 'publisher',
    content: '# Rule\n\nThis is the authoritative policy text.',
  });
  const first = await engine.learn(source.id);
  const firstId = first.claims[0].id;
  assert.equal(first.claims.length, 1);
  const firstEvidence = store.evidenceForClaim(firstId)[0];
  assert.equal(firstEvidence.startOffset, 0);
  assert(firstEvidence.endOffset > firstEvidence.startOffset);

  setVersion('v2');
  const second = await engine.learn(source.id);
  assert.equal(second.claims.length, 1);
  assert.notEqual(second.claims[0].id, firstId);
  assert.equal(store.getClaim(firstId), undefined);
  assert.match(second.claims[0].proposition, /^v2:/);
  db.close();
});
