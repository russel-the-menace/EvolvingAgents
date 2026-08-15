import assert from 'node:assert/strict';
import test from 'node:test';
import { planningPrompt, responseText } from './index.mjs';

test('extracts the OpenAI-compatible assistant response returned by custom-api-gateway', () => {
  assert.equal(responseText({ choices: [{ message: { content: 'Policy answer' } }] }), 'Policy answer');
  assert.throws(() => responseText({ choices: [] }), /no assistant message/);
});

test('planning prompt requires evidence-grounded output', () => {
  const prompt = planningPrompt('安排人工智能竞赛', [{ citation: 'E1', evidence: '报名截止 2027-04-30' }]);
  assert.match(prompt, /官方事实/);
  assert.match(prompt, /E1/);
});
