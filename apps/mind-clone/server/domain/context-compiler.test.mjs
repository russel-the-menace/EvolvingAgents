import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTranscript, contextAuditText } from './context-compiler.mjs';

test('compileTranscript bounds the working prompt without deleting transcript input', () => {
  const messages = Array.from({ length: 40 }, (_, index) => ({
    id: `m${index + 1}`, role: index % 2 ? 'assistant' : 'user', content: `fact-${index + 1} `.repeat(20),
  }));
  const context = compileTranscript(messages, { budgetChars: 2_000, recentCount: 4 });
  assert.equal(context.totalMessages, 40);
  assert(context.usedChars <= context.budgetChars);
  assert(context.omittedMessages > 0);
  assert.equal(messages.length, 40);
  assert.match(contextAuditText(context), /retained in storage/);
});

test('compileTranscript keeps all messages when they fit the budget', () => {
  const messages = [{ id: 'm1', role: 'user', content: 'one' }, { id: 'm2', role: 'assistant', content: 'two' }];
  const context = compileTranscript(messages, { budgetChars: 2_000 });
  assert.deepEqual(context.messages.map((item) => item.id), ['m1', 'm2']);
  assert.equal(context.omittedMessages, 0);
  assert.equal(context.strategy, 'full_transcript');
});

