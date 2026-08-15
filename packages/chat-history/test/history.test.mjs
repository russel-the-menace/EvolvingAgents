import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createChatHistoryStore } from '../src/index.mjs';

test('persists sessions and ordered messages', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON;');
  const store = createChatHistoryStore(db); const session = store.createSession();
  store.addMessage(session.id, { role: 'user', content: 'Hello' });
  store.addMessage(session.id, { role: 'assistant', content: 'Hi' });
  assert.deepEqual(store.getSession(session.id).messages.map((item) => item.content), ['Hello', 'Hi']);
  db.close();
});
