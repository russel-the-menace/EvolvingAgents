import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshConversationSummary } from './context-summarization.mjs';

test('recursively summarizes only history outside the recent window', async () => {
  const messages = Array.from({ length: 20 }, (_, ordinal) => ({ id: `m${ordinal}`, role: ordinal % 2 ? 'assistant' : 'user', content: `content ${ordinal}`, createdAt: '2026-01-01', ordinal }));
  let saved;
  const repository = {
    listMessagesForSummary: (_sessionId, after = -1, through = Number.MAX_SAFE_INTEGER) => messages.filter((item) => item.ordinal > after && item.ordinal <= through),
    getActiveContextSummary: () => saved || null,
    replaceContextSummary: (summary) => { saved = { id: 'summary-1', version: 1, ...summary }; return saved.id; },
  };
  let prompt;
  const gateway = { complete: async (request) => { prompt = request.at(-1).content; return 'faithful summary [m0]'; } };
  const summary = await refreshConversationSummary({ repository, gateway, sessionId: 's1', keepRecent: 8, minNewMessages: 8 });
  assert.equal(summary.coveredThroughOrdinal, 11);
  assert.equal(summary.messageIds.length, 12);
  assert.match(prompt, /\[m0\]/);
  assert.doesNotMatch(prompt, /\[m12\]/);
});
