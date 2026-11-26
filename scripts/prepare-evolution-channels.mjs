// Prepare a separate Stage 3 configuration; never rotate or overwrite Stage 2.
import { randomBytes } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { privateFile, publishOnce } from './prepare-evolution-preview.mjs';
import { readConfig } from '../services/evolution-gateway/core.mjs';
import { PROBE_PATH, secretPattern } from '../services/evolution-gateway/protocol.mjs';

const secrets = [
  'EVOLUTION_API_KEY',
  'EVOLUTION_GATEWAY_KEY',
  'EVOLUTION_WEBHOOK_SECRET',
  'EVOLUTION_DB_PASSWORD',
  'EVOLUTION_REDIS_PASSWORD',
];
const previewPattern =
  /^https:\/\/monzo-v-git-feat-evolution-(?:integration|conversations)-arqen2\.vercel\.app$/;
const targetOrigin = 'https://monzo-v-git-feat-evolution-conversations-arqen2.vercel.app';
const serialize = (env) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join('\n') + '\n';

export function prepareEvolutionChannels(directory) {
  const parent = resolve(directory, '.evolution');
  const stat = lstatSync(parent);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error('PRIVATE_DIRECTORY');
  const source = parseEnv(privateFile(resolve(directory, '.env.evolution')));
  if (
    source.EVOLUTION_PUBLIC_HOST !== 'onlineboosty.com.ar' ||
    source.EVOLUTION_GATEWAY_PORT !== '18085' ||
    !previewPattern.test(source.MONZO_ORIGIN ?? '')
  )
    throw new Error('SOURCE');
  for (const name of secrets)
    if (!secretPattern.test(source[name] ?? '')) throw new Error('SOURCE_SECRET');
  if (new Set(secrets.map((k) => source[k])).size !== secrets.length)
    throw new Error('SOURCE_SECRET');
  readConfig({ ...source, MONZO_CALLBACK_URL: source.MONZO_ORIGIN + PROBE_PATH });
  // Require the already-installed Preview credentials; do not regenerate them.
  const auth = parseEnv(privateFile(resolve(parent, 'preview-conversations.env')));
  if (
    auth.BETTER_AUTH_URL !== targetOrigin ||
    !secretPattern.test(auth.BETTER_AUTH_SECRET ?? '') ||
    !secretPattern.test(auth.WHATSAPP_ENCRYPTION_KEY ?? '') ||
    auth.BETTER_AUTH_SECRET === auth.WHATSAPP_ENCRYPTION_KEY
  )
    throw new Error('PREVIEW');
  const fixed = {
    EVOLUTION_PUBLIC_HOST: source.EVOLUTION_PUBLIC_HOST,
    MONZO_ORIGIN: targetOrigin,
    EVOLUTION_GATEWAY_PORT: source.EVOLUTION_GATEWAY_PORT,
    ...Object.fromEntries(secrets.map((k) => [k, source[k]])),
    ...(source.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { VERCEL_AUTOMATION_BYPASS_SECRET: source.VERCEL_AUTOMATION_BYPASS_SECRET }
      : {}),
    EVOLUTION_CHANNELS_ENABLED: 'true',
  };
  const path = resolve(parent, 'channels.env');
  const validate = (content) => {
    const env = parseEnv(content);
    if (
      Object.keys(env).sort().join(',') !==
        [...Object.keys(fixed), 'EVOLUTION_STORAGE_KEY'].sort().join(',') ||
      Object.entries(fixed).some(([k, v]) => env[k] !== v) ||
      !secretPattern.test(env.EVOLUTION_STORAGE_KEY ?? '') ||
      [...Object.values(source), ...Object.values(auth)].includes(env.EVOLUTION_STORAGE_KEY)
    )
      throw new Error('EXISTING_CHANNELS');
    readConfig({ ...env, MONZO_CALLBACK_URL: targetOrigin + PROBE_PATH });
    return env;
  };
  let created = false;
  try {
    validate(privateFile(path));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const content = serialize({ ...fixed, EVOLUTION_STORAGE_KEY: randomBytes(32).toString('hex') });
    validate(content);
    created = publishOnce(path, content);
  }
  validate(privateFile(path));
  return { path, created, origin: targetOrigin };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    parseArgs({ options: {}, strict: true, allowPositionals: false });
    const result = prepareEvolutionChannels(process.cwd());
    console.log(
      result.created
        ? 'Configuración privada de canales preparada.'
        : 'Se conservó la configuración privada de canales.',
    );
    console.log('Archivo: .evolution/channels.env');
    console.log('Destino: ' + result.origin);
    console.log(
      'No se imprimieron claves, no se cambió la configuración anterior y no se inició ningún servicio.',
    );
  } catch {
    console.error(
      'No se pudo preparar canales. Revisá los archivos privados originales y del Preview; no borres ni regeneres claves para reintentar.',
    );
    process.exitCode = 1;
  }
}
