import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createChatHistoryStore } from '@evolving-agents/chat-history';
import { createChatRuntime } from '../src/index.mjs';

test('persists user, title, and assistant around domain hooks', async () => {
  const history = createChatHistoryStore(new DatabaseSync(':memory:'));
  const session = history.createSession();
  const events = [];
  const runtime = createChatRuntime(history, { titleLength: 12 });
  const result = await runtime.run({ sessionId: session.id, content: 'A sufficiently long first question', beforeMessage: () => { events.push('before'); return { evidence: 'E1' }; }, createAnswer: ({ messages, context }) => { events.push('answer'); assert.equal(messages.at(-1).content, 'A sufficiently long first question'); return { content: 'Initial answer', evidence: context.evidence }; }, afterAnswer: ({ content }) => { events.push('after'); return { content: `${content} plus follow-up`, evidence: 'E1' }; } });
  assert.deepEqual(events, ['before', 'answer', 'after']);
  assert.equal(result.session.title, 'A sufficient');
  assert.deepEqual(result.session.messages.map(({ role, content }) => ({ role, content })), [{ role: 'user', content: 'A sufficiently long first question' }, { role: 'assistant', content: 'Initial answer plus follow-up' }]);
  assert.equal(result.evidence, 'E1');
});

test('keeps the user message when answer generation fails', async () => {
  const history = createChatHistoryStore(new DatabaseSync(':memory:'));
  const session = history.createSession();
  const runtime = createChatRuntime(history);
  await assert.rejects(() => runtime.run({ sessionId: session.id, content: 'Keep this', createAnswer: async () => { throw new Error('gateway down'); } }), /gateway down/);
  assert.deepEqual(history.getSession(session.id).messages.map(({ role, content }) => ({ role, content })), [{ role: 'user', content: 'Keep this' }]);
});

test('truncates an edited branch before appending replacement messages', async () => {
  const history = createChatHistoryStore(new DatabaseSync(':memory:'));
  const session = history.createSession();
  const first = history.addMessage(session.id, { role: 'user', content: 'old' });
  history.addMessage(session.id, { role: 'assistant', content: 'old answer' });
  const runtime = createChatRuntime(history);
  const result = await runtime.run({ sessionId: session.id, content: 'replacement', replaceFromMessageId: first.id, createAnswer: async () => 'new answer' });
  assert.deepEqual(result.session.messages.map(({ content }) => content), ['replacement', 'new answer']);
});
