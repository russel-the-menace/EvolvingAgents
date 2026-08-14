import { readFileSync } from 'node:fs';
import { validateCommit } from './commit-policy.mjs';

const messageFile = process.argv[2];
const pathsFile = process.env.COMMIT_POLICY_PATHS_FILE;
if (!messageFile || !pathsFile) throw new Error('Usage requires a message file and COMMIT_POLICY_PATHS_FILE.');
const header = readFileSync(messageFile, 'utf8').split('\n').find((line) => line.trim() && !line.startsWith('#')) || '';
const paths = readFileSync(pathsFile, 'utf8').split('\n').map((path) => path.trim()).filter(Boolean);
const result = validateCommit({ header, paths });
if (!result.valid) {
  console.error(`Commit rejected: ${result.error}`);
  process.exit(1);
}
console.log(result.parsed.type === 'revert'
  ? 'Commit type accepted: revert'
  : `Commit scope accepted: ${result.parsed.scopes.join(',')}`);
