import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceChatDrafts } from '../src/chat-state.ts';

const messages = (userId, answerId) => [
  { id: userId, role: 'user', content: 'question' },
  { id: answerId, role: 'assistant', content: '' },
];

test('keeps concurrent chat drafts isolated by session', () => {
  let state = reduceChatDrafts({}, { type: 'start', sessionId: 'one', messages: messages('u1', 'a1') });
  state = reduceChatDrafts(state, { type: 'start', sessionId: 'two', messages: messages('u2', 'a2') });
  state = reduceChatDrafts(state, { type: 'delta', sessionId: 'one', messageId: 'a1', delta: 'first' });
  state = reduceChatDrafts(state, { type: 'delta', sessionId: 'two', messageId: 'a2', delta: 'second' });

  assert.equal(state.one.messages.at(-1).content, 'first');
  assert.equal(state.two.messages.at(-1).content, 'second');
  state = reduceChatDrafts(state, { type: 'finish', sessionId: 'one' });
  assert.equal(state.one, undefined);
  assert.equal(state.two.streaming, true);
});
