import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
  console.log('Git hooks configured: .githooks');
} catch {
  // npm install is also used outside a Git checkout (for example in a package build).
}
