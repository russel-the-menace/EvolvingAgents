import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSceneView, makeAnswerPlan } from './scenes.mjs';
import { auditAnswer } from './answer-audit.mjs';

const claims = [
  { id: 'k1', title: 'HR management', proposition: 'HR management builds organizational capability for business goals.', tags: ['HR'], kind: 'knowledge', owner: 'external', epistemicStatus: 'understood', authorizationScope: 'reasoning_use' },
  { id: 'x1', title: 'Recruiting experience', proposition: 'I designed a recruiting process for an early-stage team.', tags: ['HR', 'recruiting'], kind: 'experience', owner: 'user', epistemicStatus: 'endorsed', authorizationScope: 'personal_experience' },
  { id: 'bad', title: 'Third-party case', proposition: 'A speaker recruited 300 people.', tags: ['HR'], kind: 'example', owner: 'third_party', epistemicStatus: 'understood', authorizationScope: 'reasoning_use' },
];

test('scene compilation selects relevant cognition and never enables write-back', () => {
  const scene = compileSceneView({ sceneId: 's1', sceneType: 'interview', audience: 'HR interviewer', goal: 'HR role', jd: 'HR recruiting and organizational management', resume: 'Recruiting experience', claims });
  assert.equal(scene.writeBack, false);
  assert.deepEqual(scene.knowledgeClaims.map((claim) => claim.id), ['k1', 'bad']);
  assert.deepEqual(scene.personalClaims.map((claim) => claim.id), ['x1']);
});

test('answer plans keep knowledge and personal evidence in separate channels', () => {
  const scene = compileSceneView({ sceneId: 's1', sceneType: 'interview', audience: 'HR interviewer', goal: 'HR role', jd: 'HR recruiting', resume: 'Recruiting experience', claims });
  const plan = makeAnswerPlan({ question: 'How do you understand HR management?', scene });
  assert(plan.knowledgeClaimIds.includes('k1'));
  assert(plan.personalClaimIds.includes('x1'));
  assert(!plan.personalClaimIds.includes('bad'));
});

test('answer audit flags unsupported numbers', () => {
  const scene = compileSceneView({ sceneId: 's1', sceneType: 'interview', audience: 'HR interviewer', goal: 'HR role', jd: 'HR recruiting', resume: 'Recruiting experience', claims });
  const plan = makeAnswerPlan({ question: 'What did you achieve?', scene });
  const audit = auditAnswer({ answer: 'I increased hiring efficiency by 37%.', scene, plan, claims });
  assert.equal(audit.passed, false);
  assert.equal(audit.violations[0].type, 'unsupported_numeric_claim');
});
