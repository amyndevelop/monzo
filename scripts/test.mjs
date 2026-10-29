import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { testEnvironment } from './test-env.mjs';
const qstash = process.argv.includes('--qstash');
const env = {
  ...testEnvironment(),
  WHATSAPP_QUEUE_PREFIX: `monzo-test-${process.pid}`,
  WHATSAPP_PROCESSOR: qstash ? 'qstash' : 'bullmq',
  ...(qstash
    ? {
        QSTASH_TOKEN: '',
        QSTASH_CURRENT_SIGNING_KEY: randomBytes(32).toString('hex'),
        QSTASH_NEXT_SIGNING_KEY: randomBytes(32).toString('hex'),
      }
    : {}),
};
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
const migrate = await run('npx', ['prisma', 'migrate', 'deploy']);
if (migrate !== 0) process.exit(migrate);
// A real inbound worker is exercised. Outbound provider requests are tested via explicit injected transports,
// never by sending fake credentials or messages to Meta.
const worker = qstash
  ? null
  : spawn(process.execPath, ['--import', 'tsx', 'workers/whatsapp.ts', '--inbound-only'], {
      env,
      stdio: 'inherit',
    });
let workerFailed = false;
worker?.once('error', () => {
  workerFailed = true;
});
let status = 1;
try {
  const args = process.argv.slice(2).filter((arg) => arg !== '--qstash');
  if (qstash && !args.length) args.push('tests/qstash.spec.ts');
  status = Number(await run('npx', ['playwright', 'test', ...args]));
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => worker.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (worker.exitCode === null) worker.kill('SIGKILL');
  }
}
process.exit(workerFailed ? 1 : status);
