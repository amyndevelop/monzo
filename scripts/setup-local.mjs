import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
const original = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const env = parseEnv(original);
const generate = () => randomBytes(32).toString('hex');
const additions = {};
for (const key of ['MONZO_DEV_DB_PASSWORD', 'MONZO_TEST_DB_PASSWORD', 'BETTER_AUTH_SECRET']) {
  if (!env[key]) additions[key] = generate();
}
const config = { ...env, ...additions };
const defaults = {
  BETTER_AUTH_URL: 'http://localhost:3000',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  SMTP_FROM: 'MONZO Desarrollo <cuentas@monzo.test>',
};
for (const [key, value] of Object.entries(defaults)) if (!config[key]) additions[key] = value;
let content = original;
const exampleURL = 'postgresql://monzo:monzo@localhost:5432/monzo_dev?schema=public';
if (!env.DATABASE_URL || env.DATABASE_URL === exampleURL) {
  content = content.replace(/^DATABASE_URL=.*$/m, '');
  additions.DATABASE_URL = `postgresql://monzo:${config.MONZO_DEV_DB_PASSWORD}@127.0.0.1:5432/monzo_dev?schema=public`;
}
if (Object.keys(additions).length)
  content +=
    '\n# Local generated configuration; never commit.\n' +
    Object.entries(additions)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join('\n') +
    '\n';
if (content !== original) writeFileSync('.env', content, { mode: 0o600 });
if (!existsSync('.env.test')) {
  const settings = {
    DATABASE_URL: `postgresql://monzo:${config.MONZO_TEST_DB_PASSWORD}@127.0.0.1:55433/monzo_test?schema=public`,
    BETTER_AUTH_SECRET: generate(),
    BETTER_AUTH_URL: 'http://127.0.0.1:3100',
    ...Object.fromEntries(Object.entries(defaults).filter(([k]) => k !== 'BETTER_AUTH_URL')),
  };
  writeFileSync(
    '.env.test',
    Object.entries(settings)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
}
console.log(
  'Local configuration prepared without printing secrets. Existing custom values preserved.',
);
