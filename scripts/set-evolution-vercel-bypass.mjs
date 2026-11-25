import { readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { readConfig, automationSecretPattern } from '../services/evolution-gateway/core.mjs';
import { PROBE_PATH } from '../services/evolution-gateway/protocol.mjs';

export function setVercelBypass(directory, input) {
  const secret = input.replace(/\r?\n$/, '');
  if (!automationSecretPattern.test(secret)) throw new Error('Invalid automation key format.');
  const filename = resolve(directory, '.env.evolution');
  const info = lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('Expected a regular private configuration file.');
  const config = parseEnv(readFileSync(filename, 'utf8'));
  config.VERCEL_AUTOMATION_BYPASS_SECRET = secret;
  readConfig({ ...config, MONZO_CALLBACK_URL: config.MONZO_ORIGIN + PROBE_PATH });
  const temporary = filename + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(
      temporary,
      Object.entries(config)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => key + '=' + JSON.stringify(value))
        .join('\n') + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    renameSync(temporary, filename);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2)
      throw new Error('Read the automation key from standard input, not arguments.');
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 514) throw new Error('Input too large.');
      chunks.push(chunk);
    }
    setVercelBypass(process.cwd(), Buffer.concat(chunks).toString('utf8'));
    console.log('Clave de automatizaciones de Vercel guardada en el archivo privado.');
  } catch {
    console.error(
      'No pudimos guardar la clave. Revisá que .env.evolution exista, que apunte al preview de Vercel y que hayas pegado la clave completa.',
    );
    process.exitCode = 1;
  }
}
