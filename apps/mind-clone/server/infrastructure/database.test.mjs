import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from './database.mjs';

test('legacy JSON migration is lossless and idempotent', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mindclone-db-test-'));
  const databasePath = join(directory, 'mindclone.sqlite');
  const legacyPath = join(directory, 'memory-store.json');
  writeFileSync(legacyPath, JSON.stringify({
    documents: [{ id: 'd1', title: 'Video', sourceType: 'short_video', content: 'HR framework', createdAt: '2026-01-01' }],
    memories: [{ id: 'm1', documentId: 'd1', scope: 'learning', kind: 'framework', status: 'approved', title: 'Framework', content: 'HR framework', tags: ['HR'], sourceQuote: 'HR framework', createdAt: '2026-01-01' }],
    sessions: [{ id: 's1', title: 'Recent', createdAt: '2026-01-01', updatedAt: '2026-01-01', messages: [{ id: 'msg1', role: 'user', content: 'Hello', createdAt: '2026-01-01' }] }],
  }));
  const first = openDatabase(databasePath, legacyPath);
  assert.equal(first.listSources().length, 1);
  assert.equal(first.listClaims().length, 1);
  assert.equal(first.listClaims()[0].authorizationScope, 'reasoning_use');
  assert.equal(first.listSessions()[0].messages.length, 1);
  first.close();
  const second = openDatabase(databasePath, legacyPath);
  assert.equal(second.listSources().length, 1);
  assert.equal(second.listClaims().length, 1);
  second.close();
});

test('re-extraction removes stale claims, search rows, and inquiries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mindclone-db-cleanup-test-'));
  const repository = openDatabase(join(directory, 'mindclone.sqlite'), join(directory, 'missing.json'));
  const source = repository.addSource({ title: 'Article', sourceType: 'article', content: 'External claim' });
  const evidenceId = repository.addEvidence({ sourceId: source.id, text: 'External claim', speaker: 'author', owner: 'external' });
  const claim = repository.addClaim({
    title: 'Claim', proposition: 'External claim', kind: 'knowledge', owner: 'external',
    epistemicStatus: 'understood', authorizationScope: 'reasoning_use', tags: [], confidence: 0.8,
  }, evidenceId);
  repository.addInquiry({ claimId: claim.id, question: 'Do you endorse this?', reason: 'Test', priority: 1 });

  assert.equal(repository.deleteClaimsForSource(source.id), 1);
  assert.equal(repository.listClaims().length, 0);
  assert.equal(repository.listInquiries().length, 0);
  assert.equal(repository.db.prepare('SELECT COUNT(*) AS count FROM claim_search').get().count, 0);
  repository.close();
});

test('context runs preserve selected items and omitted-history reasons', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mindclone-context-run-test-'));
  const repository = openDatabase(join(directory, 'mindclone.sqlite'), join(directory, 'missing.json'));
  const session = repository.createSession();
  const runId = repository.addContextRun({
    sessionId: session.id, question: 'What changed?', strategy: 'bounded_transcript', budgetChars: 2000,
    usedChars: 1200, totalMessages: 40, omittedMessages: 30,
    omitted: [{ id: 'm1', reason: 'working_context_budget' }],
    items: [{ type: 'message', id: 'm40', content: 'Latest fact', selectionReason: 'transcript_budget' }],
  });
  const run = repository.getContextRun(runId);
  assert.equal(run.sessionId, session.id);
  assert.equal(run.omittedMessages, 30);
  assert.deepEqual(run.omitted, [{ id: 'm1', reason: 'working_context_budget' }]);
  assert.equal(run.items[0].content, 'Latest fact');
  assert.deepEqual(repository.listContextRuns(session.id), [runId]);
  repository.close();
});

test('conversation summaries are versioned and preserve covered message ids', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mindclone-summary-test-'));
  const repository = openDatabase(join(directory, 'mindclone.sqlite'), join(directory, 'missing.json'));
  const session = repository.createSession();
  const firstId = repository.replaceContextSummary({ sessionId: session.id, content: 'First', messageIds: ['m1'], coveredThroughOrdinal: 0 });
  const secondId = repository.replaceContextSummary({ sessionId: session.id, content: 'Second', messageIds: ['m1', 'm2'], coveredThroughOrdinal: 1 });
  const active = repository.getActiveContextSummary(session.id);
  assert.notEqual(firstId, secondId);
  assert.equal(active.version, 2);
  assert.deepEqual(active.messageIds, ['m1', 'm2']);
  assert.equal(repository.db.prepare('SELECT COUNT(*) AS count FROM context_summaries WHERE superseded_at IS NOT NULL').get().count, 1);
  repository.close();
});
