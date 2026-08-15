import { spawnSync } from 'node:child_process';

const applications = {
  'campus-atlas': { workspace: '@evolving-agents/campus-atlas', displayName: 'CampusAtlas', commands: ['dev'] },
  campusatlas: { workspace: '@evolving-agents/campus-atlas', displayName: 'CampusAtlas', commands: ['dev'] },
  'crypto-agent': { workspace: '@evolving-agents/crypto-agent', displayName: 'CryptoAgent', commands: [] },
  cryptoagent: { workspace: '@evolving-agents/crypto-agent', displayName: 'CryptoAgent', commands: [] },
  'mind-clone': { workspace: '@evolving-agents/mind-clone', displayName: 'MindClone', commands: ['dev', 'desktop'] },
  mindclone: { workspace: '@evolving-agents/mind-clone', displayName: 'MindClone', commands: ['dev', 'desktop'] },
};

const command = process.argv[2];
const requested = String(process.argv[3] || '').toLowerCase();
const application = applications[requested];

if (!command || !application) {
  console.log(`Usage: npm run ${command || 'dev'} -- <app>\n`);
  console.log('Apps: mind-clone (or mindclone), campus-atlas (or campusatlas), crypto-agent (or cryptoagent)');
  process.exitCode = requested && !application ? 1 : 0;
} else if (!application.commands.includes(command)) {
  console.error(`${application.displayName} does not provide an npm ${command} script yet.`);
  process.exitCode = 1;
} else {
  const result = spawnSync('npm', ['run', command, '--workspace', application.workspace], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
