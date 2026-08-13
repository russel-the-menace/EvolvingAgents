import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedScopes, parseCommitHeader, scopesForPath, validateCommit } from './commit-policy.mjs';

test('accepts a single application scope', () => {
  assert.deepEqual(validateCommit({
    header: 'feat(mind-clone): add interview evidence review',
    paths: ['apps/mind-clone/src/App.tsx'],
  }).valid, true);
});

test('accepts style commits', () => {
  assert.equal(validateCommit({
    header: 'style(mind-clone): align chat message actions',
    paths: ['apps/mind-clone/src/styles.css'],
  }).valid, true);
});

test('accepts an application plus learning-engine scope', () => {
  assert.deepEqual(expectedScopes(['apps/crypto-agent/src/learning.mjs', 'packages/learning-engine/src/engine.mjs']), ['crypto-agent', 'learning-engine']);
  assert.equal(validateCommit({
    header: 'fix(crypto-agent,learning-engine): preserve research timestamps',
    paths: ['apps/crypto-agent/src/learning.mjs', 'packages/learning-engine/src/engine.mjs'],
  }).valid, true);
});

test('requires monorepo for two or more apps plus the engine', () => {
  const paths = ['apps/mind-clone/src/App.tsx', 'apps/campus-atlas/src/learning.mjs', 'packages/learning-engine/src/retrieval.mjs'];
  assert.deepEqual(expectedScopes(paths), ['monorepo']);
  assert.equal(validateCommit({ header: 'refactor(monorepo): align retrieval contracts', paths }).valid, true);
  assert.match(validateCommit({ header: 'fix(campus-atlas,learning-engine): align retrieval contracts', paths }).error, /monorepo/);
});

test('requires every changed application in a multi-app commit', () => {
  const result = validateCommit({
    header: 'feat(mind-clone): add shared dashboard',
    paths: ['apps/mind-clone/src/App.tsx', 'apps/campus-atlas/README.md'],
  });
  assert.equal(result.valid, false);
  assert.match(result.error, /campus-atlas/);
});

test('root-only changes use monorepo scope', () => {
  assert.equal(scopesForPath('README.md'), 'monorepo');
  assert.equal(validateCommit({ header: 'docs(monorepo): document commit policy', paths: ['README.md', 'docs/monorepo.md'] }).valid, true);
});

test('deleted files still determine their application scope', () => {
  assert.equal(validateCommit({
    header: 'refactor(campus-atlas): remove obsolete adapter',
    paths: ['apps/campus-atlas/src/old-adapter.mjs'],
  }).valid, true);
});

test('rejects malformed headers, unknown scopes, and duplicate scopes', () => {
  assert.match(parseCommitHeader('update things').error, /type\(scope\)/);
  assert.match(parseCommitHeader('fix(unknown): bad scope').error, /Scope/);
  assert.match(parseCommitHeader('fix(mind-clone,mind-clone): duplicate').error, /repeat/);
});
