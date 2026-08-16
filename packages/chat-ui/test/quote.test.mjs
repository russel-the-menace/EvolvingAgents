import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteChatPrompt } from '../src/quote.ts';

test('adds selected assistant text to the next question as a Markdown quote', () => {
  assert.equal(quoteChatPrompt('first line\nsecond line', 'Why?'), '> first line\n> second line\n\nWhy?');
});
