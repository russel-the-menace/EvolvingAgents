import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonResponse, planningPrompt, shouldLearnConversation } from './index.mjs';

test('planning prompt requires evidence-grounded output', () => {
  const prompt = planningPrompt('安排人工智能竞赛', [{ citation: 'E1', evidence: '报名截止 2027-04-30' }]);
  assert.match(prompt, /官方事实/);
  assert.match(prompt, /E1/);
});

test('parses fenced JSON returned by an extraction model', () => {
  assert.deepEqual(parseJsonResponse('```json\n[{"title":"Deadline"}]\n```'), [{ title: 'Deadline' }]);
  assert.deepEqual(parseJsonResponse('[{"title":"Deadline"}]\nThe extracted claim is above.'), [{ title: 'Deadline' }]);
});

test('only learns long messages that explicitly look like supplied source material', () => {
  assert.equal(shouldLearnConversation('这是普通问题吗？'), false);
  assert.equal(shouldLearnConversation('请记住这份竞赛资料：' + '报名截止和组队要求。'.repeat(12)), true);
});
