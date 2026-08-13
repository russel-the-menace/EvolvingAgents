import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('HTTP flow preserves ownership and audits a bounded scene', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mindclone-api-test-'));
  process.env.MINDCLONE_NO_LISTEN = '1';
  process.env.MINDCLONE_DB_PATH = join(directory, 'mindclone.sqlite');
  process.env.MINDCLONE_LEGACY_STORE_PATH = join(directory, 'missing.json');
  const { app, repository } = await import(`./index.mjs?test=${Date.now()}`);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  try {
    const external = repository.addClaim({
      title: 'Strategic HR management',
      proposition: 'HR management aligns organizational capability with business goals.',
      kind: 'knowledge',
      owner: 'external',
      epistemicStatus: 'understood',
      authorizationScope: 'reasoning_use',
      tags: ['HR'],
      confidence: 0.9,
    });

    const internalizedResponse = await fetch(`${baseUrl}/claims/${external.id}/internalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposition: '我认同人力资源管理需要服务业务目标。', reason: '用户讨论后明确认同。' }),
    });
    assert.equal(internalizedResponse.status, 201);
    const internalized = await internalizedResponse.json();
    assert.equal(internalized.sourceClaim.owner, 'external');
    assert.equal(internalized.sourceClaim.epistemicStatus, 'understood');
    assert.equal(internalized.claim.owner, 'user');
    assert.equal(internalized.claim.authorizationScope, 'personal_view');

    const sceneResponse = await fetch(`${baseUrl}/scenes/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneType: 'interview',
        audience: 'HR director',
        goal: 'answer as an HR professional',
        jd: '负责组织能力建设与业务协同。',
        resume: '参与销售团队招聘和新人培训。',
      }),
    });
    assert.equal(sceneResponse.status, 201);
    const { scene } = await sceneResponse.json();
    assert.equal(scene.writeBack, false);

    const completeResponse = await fetch(`${baseUrl}/scenes/${scene.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: '你怎么理解人力资源管理？',
        plan: { knowledgeClaimIds: [], personalClaimIds: [], rules: { writeBack: false } },
        answer: '我曾带领120人的HR团队完成200%的增长。',
      }),
    });
    assert.equal(completeResponse.status, 200);
    const { audit } = await completeResponse.json();
    assert.equal(audit.passed, false);
    assert.deepEqual(audit.violations[0].values, ['120', '200%']);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    repository.close();
  }
});
