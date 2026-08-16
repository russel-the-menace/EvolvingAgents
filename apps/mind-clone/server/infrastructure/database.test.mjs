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

test('scene summaries preserve answer-run provenance without changing the scene', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mindclone-scene-summary-test-'));
  const repository = openDatabase(join(directory, 'mindclone.sqlite'), join(directory, 'missing.json'));
  repository.addScene({ id: 'scene-1', sceneType: 'interview', audience: 'HR', goal: 'answer', jd: 'JD', resume: 'Resume', writeBack: false });
  repository.replaceSceneSummary({ sceneId: 'scene-1', content: 'Ledger [run-1]', answerRunIds: ['run-1'], coveredThroughOrdinal: 0 });
  const summary = repository.getActiveSceneSummary('scene-1');
  assert.deepEqual(summary.answerRunIds, ['run-1']);
  assert.equal(repository.getScene('scene-1').writeBack, false);
  repository.close();
});

test('editing a branch removes derived cognition, summaries, and prompt copies for deleted messages', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mindclone-branch-cleanup-test-'));
  const repository = openDatabase(join(directory, 'mindclone.sqlite'), join(directory, 'missing.json'));
  const session = repository.createSession();
  const first = repository.addMessage(session.id, { role: 'user', content: 'Keep this' });
  const keptAnswer = repository.addMessage(session.id, { role: 'assistant', content: 'Kept answer' });
  const deleted = repository.addMessage(session.id, { role: 'user', content: 'Delete this' });
  repository.addMessage(session.id, { role: 'assistant', content: 'Deleted answer' });
  const source = repository.addSource({ title: 'Derived turn', sourceType: 'conversation', content: 'Delete this', metadata: { directConversation: true, sessionId: session.id, userMessageId: deleted.id } });
  const evidenceId = repository.addEvidence({ sourceId: source.id, text: 'Delete this', owner: 'user' });
  repository.addClaim({ title: 'Deleted claim', proposition: 'Delete this', kind: 'viewpoint', owner: 'user', epistemicStatus: 'endorsed', authorizationScope: 'personal_view' }, evidenceId);
  repository.replaceContextSummary({ sessionId: session.id, content: 'Contains deleted text', messageIds: [deleted.id], coveredThroughOrdinal: 2 });
  repository.addContextRun({ sessionId: session.id, question: 'Delete this', strategy: 'full_transcript', budgetChars: 2000, usedChars: 20, totalMessages: 4, items: [{ type: 'message', id: deleted.id, content: 'Delete this' }] });

  assert.equal(repository.truncateSession(session.id, deleted.id), true);
  assert.deepEqual(repository.getSession(session.id).messages.map((message) => message.id), [first.id, keptAnswer.id]);
  assert.equal(repository.getSource(source.id), undefined);
  assert.equal(repository.listClaims().length, 0);
  assert.equal(repository.getActiveContextSummary(session.id), undefined);
  assert.deepEqual(repository.listContextRuns(session.id), []);
  repository.close();
});
