import { spawnSync } from 'node:child_process';
import { testEnvironment } from './test-env.mjs';
const env = testEnvironment();
for (const args of [
  ['prisma', 'migrate', 'deploy'],
  ['playwright', 'test', ...process.argv.slice(2)],
]) {
  const result = spawnSync('npx', args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
