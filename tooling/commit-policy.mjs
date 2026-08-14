import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TYPES = new Set(['feat', 'fix', 'style', 'refactor', 'perf', 'test', 'docs', 'chore', 'build', 'ci', 'revert']);
const SCOPED_TYPES = new Set([...TYPES].filter((type) => type !== 'revert'));
const SCOPES = new Set(['mind-clone', 'campus-atlas', 'crypto-agent', 'learning-engine', 'monorepo']);
const APP_SCOPES = new Set(['mind-clone', 'campus-atlas', 'crypto-agent']);

export function parseCommitHeader(header) {
  const normalized = String(header || '').trim();
  const revertMatch = normalized.match(/^revert:\s+(.+)$/);
  if (revertMatch) {
    const [, subject] = revertMatch;
    if (subject.length > 100) return { error: 'Commit subject must be 1-100 characters.' };
    return { type: 'revert', scopes: [], subject };
  }

  const match = normalized.match(/^([a-z]+)\(([^)]+)\):\s+(.+)$/);
  if (!match) return { error: 'Commit must use `type(scope): subject`, or `revert: subject`.' };
  const [, type, rawScope, subject] = match;
  if (!TYPES.has(type)) return { error: `Unknown commit type "${type}".` };
  if (!SCOPED_TYPES.has(type)) return { error: '`revert` must not include a scope; use `revert: subject`.' };
  const scopes = rawScope.split(',').map((scope) => scope.trim());
  if (!scopes.length || scopes.some((scope) => !SCOPES.has(scope))) {
    return { error: `Scope must be one or more of: ${[...SCOPES].join(', ')}.` };
  }
  if (!subject || subject.length > 100) return { error: 'Commit subject must be 1-100 characters.' };
  if (new Set(scopes).size !== scopes.length) return { error: 'Commit scopes must not repeat.' };
  return { type, scopes, subject };
}

export function scopesForPath(path) {
  const normalized = String(path).replaceAll('\\', '/');
  if (normalized.startsWith('apps/mind-clone/')) return 'mind-clone';
  if (normalized.startsWith('apps/campus-atlas/')) return 'campus-atlas';
  if (normalized.startsWith('apps/crypto-agent/')) return 'crypto-agent';
  if (normalized.startsWith('packages/learning-engine/')) return 'learning-engine';
  return 'monorepo';
}

export function expectedScopes(paths) {
  const scopes = new Set(paths.map(scopesForPath));
  const appCount = [...scopes].filter((scope) => APP_SCOPES.has(scope)).length;
  const hasEngine = scopes.has('learning-engine');
  if (appCount >= 2 && hasEngine) return ['monorepo'];
  if (scopes.has('monorepo') && scopes.size > 1) return ['monorepo'];
  return [...scopes].sort();
}

export function validateCommit({ header, paths }) {
  const parsed = parseCommitHeader(header);
  if (parsed.error) return { valid: false, error: parsed.error };
  if (parsed.type === 'revert') return { valid: true, parsed, expected: [] };
  const expected = expectedScopes(paths);
  const actual = [...parsed.scopes].sort();
  if (expected.length === 1 && expected[0] === 'monorepo') {
    if (actual.length !== 1 || actual[0] !== 'monorepo') {
      return { valid: false, error: `These paths require scope \'monorepo\' (received ${parsed.scopes.join(',')}).` };
    }
  } else if (actual.join(',') !== expected.join(',')) {
    return { valid: false, error: `Scope does not match staged paths. Expected: ${expected.join(',')}; received: ${parsed.scopes.join(',')}.` };
  }
  return { valid: true, parsed, expected };
}

function stagedPaths() {
  return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACDMRTUXB'], { encoding: 'utf8' })
    .split('\n').map((path) => path.trim()).filter(Boolean);
}

if (process.argv[1]?.endsWith('commit-policy.mjs')) {
  const messageFile = process.argv[2];
  if (!messageFile) throw new Error('Usage: node tooling/commit-policy.mjs <commit-message-file>');
  const header = readFileSync(messageFile, 'utf8').split('\n').find((line) => line.trim() && !line.startsWith('#')) || '';
  const result = validateCommit({ header, paths: stagedPaths() });
  if (!result.valid) {
    console.error(`Commit rejected: ${result.error}`);
    console.error(`Staged paths imply: ${expectedScopes(stagedPaths()).join(',')}`);
    process.exit(1);
  }
  console.log(result.parsed.type === 'revert'
    ? 'Commit type accepted: revert'
    : `Commit scope accepted: ${result.parsed.scopes.join(',')}`);
}
