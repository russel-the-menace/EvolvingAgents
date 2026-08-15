import assert from 'node:assert/strict';
import test from 'node:test';
import { responseText } from './index.mjs';

test('extracts the OpenAI-compatible assistant response returned by custom-api-gateway', () => {
  assert.equal(responseText({ choices: [{ message: { content: 'Policy answer' } }] }), 'Policy answer');
  assert.throws(() => responseText({ choices: [] }), /no assistant message/);
});
