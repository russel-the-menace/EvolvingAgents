import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedAuthorization,
  assertOwnershipNonEscalation,
  assertTransition,
  defaultAuthorization,
  legacyCandidateToClaim,
} from './cognition.mjs';

test('external knowledge is understood for reasoning but is not a personal view', () => {
  assert.equal(defaultAuthorization({ owner: 'external', kind: 'knowledge', status: 'understood' }), 'reasoning_use');
  assert.equal(allowedAuthorization({ owner: 'external', kind: 'knowledge', status: 'endorsed', requestedScope: 'personal_view' }), false);
});

test('only user-owned experience can authorize first-person experience', () => {
  assert.throws(
    () => assertOwnershipNonEscalation({ owner: 'third_party', kind: 'experience' }, 'personal_experience'),
    /Only user-owned experience/,
  );
  assert.doesNotThrow(() => assertOwnershipNonEscalation({ owner: 'user', kind: 'experience' }, 'personal_experience'));
});

test('epistemic transitions reject resurrection of deleted cognition', () => {
  assert.doesNotThrow(() => assertTransition('observed', 'endorsed'));
  assert.throws(() => assertTransition('rejected', 'endorsed'), /not allowed/);
  assert.throws(() => assertTransition('superseded', 'understood'), /not allowed/);
});

test('legacy learning cards migrate without becoming user beliefs', () => {
  const claim = legacyCandidateToClaim({
    id: 'legacy-1', scope: 'learning', kind: 'framework', status: 'approved',
    content: 'HR management links organizational capability to business outcomes.', title: 'HR framework', tags: [], createdAt: '2026-01-01',
  });
  assert.equal(claim.owner, 'external');
  assert.equal(claim.epistemicStatus, 'understood');
  assert.equal(claim.authorizationScope, 'reasoning_use');
});
