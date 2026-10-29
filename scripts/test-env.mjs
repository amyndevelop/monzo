import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
export function testEnvironment() {
  const env = parseEnv(readFileSync('.env.test', 'utf8'));
  const url = new URL(env.DATABASE_URL);
  if (url.hostname !== '127.0.0.1' || url.port !== '55433' || url.pathname !== '/monzo_test')
    throw new Error('Tests require the isolated local monzo_test database on port 55433.');
  if (env.BETTER_AUTH_URL !== 'http://127.0.0.1:3100')
    throw new Error('Unexpected test auth origin.');
  if (env.SMTP_HOST !== '127.0.0.1' || env.SMTP_PORT !== '1025')
    throw new Error('Tests require local Mailpit SMTP on port 1025.');
  const redis = new URL(env.REDIS_URL);
  if (redis.hostname !== '127.0.0.1' || redis.port !== '6379' || redis.pathname !== '/1')
    throw new Error('Tests require isolated local Redis database 1.');
  return { ...process.env, ...env };
}
