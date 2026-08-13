import test from 'node:test';
import assert from 'node:assert/strict';
import { auditAnswer } from './answer-audit.mjs';

const emptyPlan = {
  knowledgeClaimIds: [],
  personalClaimIds: [],
  rules: { writeBack: false },
};

test('flags unsupported metrics in Chinese first-person answers', () => {
  const audit = auditAnswer({
    answer: '我曾带领120人的HR团队完成200%的增长。',
    scene: { resume: '参与销售团队招聘和新人培训。', jd: '招聘HRBP。', writeBack: false },
    plan: emptyPlan,
    claims: [],
  });
  assert.equal(audit.passed, false);
  assert.deepEqual(audit.violations[0], { type: 'unsupported_numeric_claim', values: ['120', '200%'] });
});

test('accepts a metric explicitly supported by the submitted resume', () => {
  const audit = auditAnswer({
    answer: '我曾负责120人的团队招聘。',
    scene: { resume: '负责120人的团队招聘。', jd: '招聘HRBP。', writeBack: false },
    plan: emptyPlan,
    claims: [],
  });
  assert.equal(audit.passed, true);
});
