import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
  chmodSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { prepareEvolution } from '../../../scripts/setup-evolution.mjs';
import { prepareEvolutionPreview } from '../../../scripts/prepare-evolution-preview.mjs';
import { prepareEvolutionChannels } from '../../../scripts/prepare-evolution-channels.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'monzo-channels-setup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  prepareEvolution({
    directory,
    domain: 'onlineboosty.com.ar',
    monzoOrigin: 'https://monzo-v-git-feat-evolution-integration-arqen2.vercel.app',
  });
  prepareEvolutionPreview(
    directory,
    'https://monzo-v-git-feat-evolution-conversations-arqen2.vercel.app',
  );
  return directory;
}
test('canales setup: claves previas intactas; nueva clave independiente, privada y estable al repetir', (t) => {
  const directory = fixture(t),
    original = join(directory, '.env.evolution'),
    auth = join(directory, '.evolution/preview-conversations.env');
  const before = readFileSync(original, 'utf8'),
    beforeAuth = readFileSync(auth, 'utf8');
  const first = prepareEvolutionChannels(directory);
  assert.equal(first.created, true);
  const content = readFileSync(first.path, 'utf8'),
    env = parseEnv(content),
    source = parseEnv(before);
  assert.equal(env.MONZO_ORIGIN, first.origin);
  assert.equal(env.EVOLUTION_CHANNELS_ENABLED, 'true');
  assert.match(env.EVOLUTION_STORAGE_KEY, /^[a-f0-9]{64}$/);
  assert.ok(
    ![...Object.values(source), ...Object.values(parseEnv(beforeAuth))].includes(
      env.EVOLUTION_STORAGE_KEY,
    ),
  );
  for (const key of [
    'EVOLUTION_API_KEY',
    'EVOLUTION_GATEWAY_KEY',
    'EVOLUTION_WEBHOOK_SECRET',
    'EVOLUTION_DB_PASSWORD',
    'EVOLUTION_REDIS_PASSWORD',
  ])
    assert.equal(env[key], source[key]);
  assert.equal(statSync(first.path).mode & 0o777, 0o600);
  assert.equal(prepareEvolutionChannels(directory).created, false);
  assert.equal(readFileSync(first.path, 'utf8'), content);
  assert.equal(readFileSync(original, 'utf8'), before);
  assert.equal(readFileSync(auth, 'utf8'), beforeAuth);
  const result = spawnSync(process.execPath, [resolve('scripts/prepare-evolution-channels.mjs')], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  for (const value of Object.values(env).filter((v) => /^[a-f0-9]{64}$/.test(v)))
    assert.ok(!(result.stdout + result.stderr).includes(value));
});
test('canales setup: archivo modificado no se sobrescribe ni se rota su clave', (t) => {
  const directory = fixture(t),
    first = prepareEvolutionChannels(directory);
  const content = readFileSync(first.path, 'utf8').replace(
    'EVOLUTION_CHANNELS_ENABLED="true"',
    'EVOLUTION_CHANNELS_ENABLED="false"',
  );
  writeFileSync(first.path, content);
  assert.throws(() => prepareEvolutionChannels(directory), /EXISTING_CHANNELS/);
  assert.equal(readFileSync(first.path, 'utf8'), content);
});
test('canales setup: rechaza producción, permisos abiertos y archivos enlazados', (t) => {
  const directory = fixture(t),
    original = join(directory, '.env.evolution');
  const before = readFileSync(original, 'utf8');
  writeFileSync(
    original,
    before.replace(
      'monzo-v-git-feat-evolution-integration-arqen2.vercel.app',
      'monzo-v.vercel.app',
    ),
  );
  assert.throws(() => prepareEvolutionChannels(directory), /SOURCE/);
  writeFileSync(original, before);
  chmodSync(original, 0o644);
  assert.throws(() => prepareEvolutionChannels(directory), /PRIVATE_FILE/);
  chmodSync(original, 0o600);
  symlinkSync(original, join(directory, '.evolution/channels.env'));
  assert.throws(() => prepareEvolutionChannels(directory));
  assert.equal(readFileSync(original, 'utf8'), before);
});
test('canales setup: sin credenciales existentes de Preview no genera otras', (t) => {
  const directory = fixture(t),
    auth = join(directory, '.evolution/preview-conversations.env');
  rmSync(auth);
  assert.throws(() => prepareEvolutionChannels(directory), { code: 'ENOENT' });
  assert.throws(() => statSync(auth), { code: 'ENOENT' });
  assert.throws(() => statSync(join(directory, '.evolution/channels.env')), { code: 'ENOENT' });
});

test('comprobación CLI: --channels usa el destino nuevo y --signed exige una prueba HMAC válida', (t) => {
  const directory = fixture(t),
    prepared = prepareEvolutionChannels(directory);
  const env = parseEnv(readFileSync(prepared.path, 'utf8'));
  const preload = join(directory, 'controlled-fetch.mjs');
  writeFileSync(
    preload,
    `
    import { responseProof } from ${JSON.stringify(new URL('../protocol.mjs', import.meta.url).href)};
    globalThis.fetch = async (url, options) => {
      if (url !== ${JSON.stringify(prepared.origin + '/api/integrations/evolution/probe')} || options.method !== 'POST' || options.redirect !== 'manual') throw new Error('Wrong target');
      const { challenge } = JSON.parse(options.body);
      return Response.json({ challenge, proof: process.env.CLI_TEST_INVALID ? 'invalid' : responseProof(process.env.CLI_TEST_SECRET, challenge, options.headers['x-monzo-nonce']) });
    };
  `,
  );
  const args = [
    '--import',
    preload,
    resolve('scripts/check-evolution-preview.mjs'),
    '--channels',
    '--signed',
  ];
  const config = {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, CLI_TEST_SECRET: env.EVOLUTION_WEBHOOK_SECRET },
  };
  const success = spawnSync(process.execPath, args, config);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /Retorno HMAC: OK/);
  assert.ok(!success.stdout.includes(env.EVOLUTION_WEBHOOK_SECRET));
  const invalid = spawnSync(process.execPath, args, {
    ...config,
    env: { ...config.env, CLI_TEST_INVALID: '1' },
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stdout, /INVALID_RESPONSE/);
  const wrongFile = spawnSync(
    process.execPath,
    args.filter((arg) => arg !== '--channels'),
    config,
  );
  assert.equal(wrongFile.status, 1);
  assert.doesNotMatch(wrongFile.stdout, /Retorno HMAC: OK/);
});
