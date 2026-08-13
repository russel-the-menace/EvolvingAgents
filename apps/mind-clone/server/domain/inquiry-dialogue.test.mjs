import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyInquiryReply, classifyInquiryReply } from './inquiry-dialogue.mjs';
import { openDatabase } from '../infrastructure/database.mjs';

test('classifies conversational inquiry replies', () => {
  assert.equal(classifyInquiryReply('是的，我认同').intent, 'accept');
  assert.equal(classifyInquiryReply('我不认同，这更像一种管理工具').intent, 'reject');
  assert.equal(classifyInquiryReply('部分认同，但是必须建立在业务目标清晰的前提上').intent, 'qualify');
  assert.equal(classifyInquiryReply('以后再说').intent, 'defer');
  assert.equal(classifyInquiryReply('我不完全认同，应该加一个前提').intent, 'qualify');
  assert.equal(classifyInquiryReply('帮我看看明天的面试').intent, 'unrelated');
});

test('accepting an imported personal claim authorizes it without a review screen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mindclone-inquiry-'));
  const repository = openDatabase(join(directory, 'test.sqlite'));
  const claim = repository.addClaim({
    title: 'Management view', proposition: 'HR management starts from business goals.', kind: 'viewpoint',
    owner: 'user', epistemicStatus: 'observed', authorizationScope: 'none', confidence: 0.8,
  });
  const inquiry = repository.addInquiry({ claimId: claim.id, question: 'Is this still your view?', reason: 'Imported material requires confirmation.', priority: 1 });

  const result = applyInquiryReply({ repository, inquiry, reply: classifyInquiryReply('是的，我认同') });

  assert.equal(result.resolution, 'accepted');
  assert.equal(repository.getClaim(claim.id).epistemicStatus, 'endorsed');
  assert.equal(repository.getClaim(claim.id).authorizationScope, 'personal_view');
  assert.equal(repository.listInquiries().length, 0);
  repository.close();
});

test('qualifying external knowledge creates a user-owned view and preserves the source claim', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mindclone-inquiry-'));
  const repository = openDatabase(join(directory, 'test.sqlite'));
  const source = repository.addClaim({
    title: 'External framework', proposition: 'Good HR is only about efficiency.', kind: 'knowledge',
    owner: 'external', epistemicStatus: 'understood', authorizationScope: 'reasoning_use', confidence: 0.8,
  });
  const inquiry = repository.addInquiry({ claimId: source.id, question: 'What do you think?', reason: 'External knowledge needs deliberation.', priority: 1 });
  const reply = classifyInquiryReply('我觉得效率只是结果，还要考虑组织能力。');

  const result = applyInquiryReply({ repository, inquiry, reply });

  assert.equal(result.claim.owner, 'user');
  assert.equal(result.claim.authorizationScope, 'personal_view');
  assert.equal(result.claim.proposition, reply.proposition);
  assert.equal(repository.getClaim(source.id).epistemicStatus, 'understood');
  repository.close();
});
