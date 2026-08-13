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
