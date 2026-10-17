import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export default async function globalSetup() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync(join(root, 'scripts', 'seed.sh'), [process.env.PLANNER_E2E_BASE], { stdio: 'inherit' });
}
