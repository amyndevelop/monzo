import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { prepareEvolution } from '../../../scripts/setup-evolution.mjs';
import { setVercelBypass } from '../../../scripts/set-evolution-vercel-bypass.mjs';
import { randomBytes } from 'node:crypto';
test('setup: conserva claves, separa entornos y genera Nginx sin modificar el sistema', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'monzo-evolution-setup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    directory,
    domain: 'onlineboosty.com.ar',
    monzoOrigin: 'https://preview.example.test',
  };
  prepareEvolution(options);
  const first = readFileSync(join(directory, '.env.evolution'), 'utf8');
  const env = parseEnv(first);
  assert.equal(
    new Set([
      env.EVOLUTION_API_KEY,
      env.EVOLUTION_GATEWAY_KEY,
      env.EVOLUTION_WEBHOOK_SECRET,
      env.EVOLUTION_DB_PASSWORD,
      env.EVOLUTION_REDIS_PASSWORD,
    ]).size,
    5,
  );
  assert.equal(statSync(join(directory, '.env.evolution')).mode & 0o777, 0o600);
  assert.equal(statSync(join(directory, '.evolution')).mode & 0o777, 0o700);
  const nginx = readFileSync(join(directory, '.evolution/nginx-https.conf'), 'utf8');
  assert.ok(nginx.includes('server_name onlineboosty.com.ar;'));
  assert.equal(
    nginx,
    readFileSync(
      new URL('../../../deploy/evolution/nginx-onlineboosty.conf', import.meta.url),
      'utf8',
    ),
  );
  assert.ok(nginx.includes('127.0.0.1:18085'));
  assert.ok(nginx.includes('root /var/www/letsencrypt;'));
  assert.ok(nginx.includes('include /etc/letsencrypt/options-ssl-nginx.conf;'));
  assert.ok(
    nginx.includes('ssl_certificate /etc/letsencrypt/live/onlineboosty.com.ar/fullchain.pem;'),
  );
  assert.ok(
    nginx.includes('ssl_certificate_key /etc/letsencrypt/live/onlineboosty.com.ar/privkey.pem;'),
  );
  const http = readFileSync(join(directory, '.evolution/nginx-http.conf'), 'utf8');
  assert.ok(http.includes('location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }'));
  assert.equal(http.includes('ssl_certificate'), false);
  assert.equal(nginx.includes(env.EVOLUTION_API_KEY), false);
  prepareEvolution(options);
  assert.ok(
    readFileSync(join(directory, '.env.evolution'), 'utf8') === first,
    'Private configuration must remain byte-for-byte stable.',
  );
  assert.throws(() => prepareEvolution({ ...options, domain: 'another.example.test' }));
  assert.throws(() =>
    prepareEvolution({ ...options, monzoOrigin: 'https://production.example.test' }),
  );
  assert.ok(
    readFileSync(join(directory, '.env.evolution'), 'utf8') === first,
    'Private configuration must remain byte-for-byte stable.',
  );
});
test('setup: rechaza inyección en dominio, puertos ocupables por sistemas y orígenes inseguros', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'monzo-evolution-setup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    directory,
    domain: 'onlineboosty.com.ar',
    monzoOrigin: 'https://preview.example.test',
  };
  for (const change of [
    { domain: 'https://onlineboosty.com.ar' },
    { domain: 'example.test; include /etc/passwd;' },
    { domain: '127.0.0.1' },
    { monzoOrigin: 'http://preview.example.test' },
    { monzoOrigin: 'https://user:secret@example.test' },
    { port: 5432 },
    { port: 8080 },
  ])
    assert.throws(() => prepareEvolution({ ...options, ...change }));
});
test('setup: conserva configuraciones editadas y rechaza enlaces a archivos externos', async (t) => {
  const { writeFileSync, symlinkSync } = await import('node:fs');
  const directory = mkdtempSync(join(tmpdir(), 'monzo-evolution-preserve-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    directory,
    domain: 'onlineboosty.com.ar',
    monzoOrigin: 'https://preview.example.test',
  };
  prepareEvolution(options);
  const nginx = join(directory, '.evolution/nginx-http.conf');
  writeFileSync(nginx, '# manual configuration to preserve\n');
  assert.throws(() => prepareEvolution(options), /Nginx file differs/);
  assert.equal(readFileSync(nginx, 'utf8'), '# manual configuration to preserve\n');
  const external = join(directory, 'external.txt');
  writeFileSync(external, 'preserve\n');
  rmSync(join(directory, '.evolution/vercel.env'));
  symlinkSync(external, join(directory, '.evolution/vercel.env'));
  assert.throws(() => prepareEvolution(options), /symbolic links/);
  assert.equal(readFileSync(external, 'utf8'), 'preserve\n');
});
test('Vercel: guarda la clave privadamente por stdin sin rotar credenciales ni exportarla al cliente MONZO', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'monzo-vercel-private-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    directory,
    domain: 'onlineboosty.com.ar',
    monzoOrigin: 'https://preview.vercel.app',
  };
  prepareEvolution(options);
  const filename = join(directory, '.env.evolution');
  const original = parseEnv(readFileSync(filename, 'utf8'));
  const secret = randomBytes(32).toString('hex');
  const script = resolve('scripts/set-evolution-vercel-bypass.mjs');
  const result = spawnSync(process.execPath, [script], {
    cwd: directory,
    input: secret,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal((result.stdout + result.stderr).includes(secret), false);
  const saved = parseEnv(readFileSync(filename, 'utf8'));
  assert.ok(saved.VERCEL_AUTOMATION_BYPASS_SECRET === secret);
  assert.ok(
    Object.keys(original).every((name) => saved[name] === original[name]),
    'Existing configuration must be preserved.',
  );
  assert.equal(statSync(filename).mode & 0o777, 0o600);
  assert.equal(
    readFileSync(join(directory, '.evolution/vercel.env'), 'utf8').includes(secret),
    false,
  );
  prepareEvolution(options);
  assert.ok(parseEnv(readFileSync(filename, 'utf8')).VERCEL_AUTOMATION_BYPASS_SECRET === secret);
  const unchanged = readFileSync(filename, 'utf8');
  for (const invalid of ['short', secret + '\nX-Header: injection', 'x'.repeat(513)])
    assert.throws(() => setVercelBypass(directory, invalid));
  assert.ok(readFileSync(filename, 'utf8') === unchanged);
  const forbiddenArgument = spawnSync(
    process.execPath,
    [script, 'do-not-put-secrets-in-arguments'],
    { cwd: directory, encoding: 'utf8' },
  );
  assert.equal(forbiddenArgument.status, 1);
  assert.ok(readFileSync(filename, 'utf8') === unchanged);
});
test('Vercel CLI: distingue archivo inicial ausente y entrada vacía sin mostrar la clave', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'monzo-vercel-missing-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = resolve('scripts/set-evolution-vercel-bypass.mjs');
  const secret = randomBytes(32).toString('hex');
  const missing = spawnSync(process.execPath, [script], {
    cwd: directory,
    input: secret,
    encoding: 'utf8',
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Falta \.env\.evolution/);
  assert.equal((missing.stdout + missing.stderr).includes(secret), false);
  const empty = spawnSync(process.execPath, [script], {
    cwd: directory,
    input: '',
    encoding: 'utf8',
  });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /No llegó ninguna clave/);
  const invalid = spawnSync(process.execPath, [script], {
    cwd: directory,
    input: 'incomplete-private-key$',
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /formato incompleto o no válido/);
  assert.equal((invalid.stdout + invalid.stderr).includes('incomplete-private-key$'), false);
});
