import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  chmodSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { prepareEvolution } from '../../../scripts/setup-evolution.mjs';
import { prepareEvolutionPreview } from '../../../scripts/prepare-evolution-preview.mjs';

const origin = 'https://monzo-v-git-feat-evolution-conversations-arqen2.vercel.app';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'monzo-evolution-preview-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  prepareEvolution({
    directory,
    domain: 'onlineboosty.com.ar',
    monzoOrigin: 'https://monzo-v-git-feat-evolution-integration-arqen2.vercel.app',
  });
  return directory;
}
test('Preview: claves independientes, archivo privado y repetición estable sin cambiar el gateway', (t) => {
  const directory = fixture(t);
  const before = readFileSync(join(directory, '.env.evolution'), 'utf8');
  const source = parseEnv(before);
  const result = prepareEvolutionPreview(directory, origin);
  assert.equal(result.created, true);
  const content = readFileSync(result.path, 'utf8');
  const env = parseEnv(content);
  assert.equal(statSync(result.path).mode & 0o777, 0o600);
  assert.equal(statSync(join(directory, '.evolution')).mode & 0o777, 0o700);
  assert.equal(env.BETTER_AUTH_URL, origin);
  assert.deepEqual(Object.keys(env).sort(), [
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'WHATSAPP_ENCRYPTION_KEY',
  ]);
  assert.match(env.BETTER_AUTH_SECRET, /^[a-f0-9]{64}$/);
  assert.match(env.WHATSAPP_ENCRYPTION_KEY, /^[a-f0-9]{64}$/);
  assert.notEqual(env.BETTER_AUTH_SECRET, env.WHATSAPP_ENCRYPTION_KEY);
  for (const key of ['BETTER_AUTH_SECRET', 'WHATSAPP_ENCRYPTION_KEY'])
    assert.equal(Object.values(source).includes(env[key]), false);
  for (const key of [
    'DATABASE_URL',
    'SMTP_PASSWORD',
    'VERCEL_AUTOMATION_BYPASS_SECRET',
    'EVOLUTION_API_KEY',
    'EVOLUTION_GATEWAY_URL',
    'EVOLUTION_GATEWAY_KEY',
    'EVOLUTION_WEBHOOK_SECRET',
    'EVOLUTION_DB_PASSWORD',
    'EVOLUTION_REDIS_PASSWORD',
  ])
    assert.equal(key in env, false);
  assert.equal(prepareEvolutionPreview(directory, origin).created, false);
  assert.equal(readFileSync(result.path, 'utf8'), content);
  assert.equal(readFileSync(join(directory, '.env.evolution'), 'utf8'), before);
  for (const value of Object.values(env))
    assert.equal(JSON.stringify(result).includes(value), false);
});
test('Preview: rechaza producción, otro origen, rutas y archivos modificados sin rotar claves', (t) => {
  const directory = fixture(t);
  for (const invalid of [
    'https://monzo-v.vercel.app',
    origin + '/path',
    origin + '?private=value',
    'http://localhost',
    origin.replace('https://', 'https://private@'),
  ])
    assert.throws(() => prepareEvolutionPreview(directory, invalid), /PREVIEW_ORIGIN/);
  const result = prepareEvolutionPreview(directory, origin);
  const before = readFileSync(result.path, 'utf8');
  assert.throws(
    () => prepareEvolutionPreview(directory, origin.replace('monzo-v-git', 'another-git')),
    /EXISTING_PREVIEW/,
  );
  assert.equal(readFileSync(result.path, 'utf8'), before);
  writeFileSync(result.path, before + 'DATABASE_URL="do-not-copy-or-overwrite"\n');
  assert.throws(() => prepareEvolutionPreview(directory, origin), /EXISTING_PREVIEW/);
  assert.ok(readFileSync(result.path, 'utf8').includes('do-not-copy-or-overwrite'));
});
test('Preview: rechaza enlaces y permisos amplios sin escribir fuera del directorio privado', (t) => {
  const directory = fixture(t);
  const external = join(directory, 'external.txt');
  writeFileSync(external, 'preserve', { mode: 0o600 });
  const output = join(directory, '.evolution', 'preview-conversations.env');
  symlinkSync(external, output);
  assert.throws(() => prepareEvolutionPreview(directory, origin));
  assert.equal(readFileSync(external, 'utf8'), 'preserve');
  rmSync(output);
  chmodSync(join(directory, '.evolution'), 0o755);
  assert.throws(() => prepareEvolutionPreview(directory, origin), /PRIVATE_DIRECTORY/);
  chmodSync(join(directory, '.evolution'), 0o700);
  chmodSync(join(directory, '.env.evolution'), 0o644);
  assert.throws(() => prepareEvolutionPreview(directory, origin), /PRIVATE_FILE/);
});
test('Preview CLI: prepara offline, conserva el archivo y nunca imprime valores privados', (t) => {
  const directory = fixture(t);
  const script = new URL('../../../scripts/prepare-evolution-preview.mjs', import.meta.url)
    .pathname;
  const first = spawnSync(process.execPath, [script, '--monzo-origin', origin], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.equal(first.status, 0);
  const env = parseEnv(
    readFileSync(join(directory, '.evolution', 'preview-conversations.env'), 'utf8'),
  );
  for (const value of Object.values(env))
    assert.equal((first.stdout + first.stderr).includes(value), false);
  const second = spawnSync(process.execPath, [script, '--monzo-origin', origin], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.equal(second.status, 0);
  assert.ok(second.stdout.includes('Se conservó'));
});
