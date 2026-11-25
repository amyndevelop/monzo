import { readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { readConfig, automationSecretPattern } from '../services/evolution-gateway/core.mjs';
import { PROBE_PATH } from '../services/evolution-gateway/protocol.mjs';

export function setVercelBypass(directory, input) {
  const secret = input.replace(/\r?\n$/, '');
  if (!secret) throw Object.assign(new Error('EMPTY_INPUT'), { code: 'EMPTY_INPUT' });
  if (!automationSecretPattern.test(secret))
    throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
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
  } catch (error) {
    const messages = {
      ENOENT:
        'Falta .env.evolution. Primero ejecutá scripts/setup-evolution.mjs para crear la configuración privada.',
      EACCES:
        'No hay permisos para leer o guardar la configuración privada. Revisá el propietario del archivo y del directorio.',
      EPERM:
        'No hay permisos para guardar la configuración privada. Revisá el propietario del archivo y del directorio.',
      EMPTY_INPUT:
        'No llegó ninguna clave por la entrada privada. Volvé a pegar la misma clave en el campo oculto.',
      INVALID_INPUT:
        'La clave recibida tiene un formato incompleto o no válido. Copiá el valor completo sin comillas ni espacios.',
      CONFIG_SECRETS:
        'La configuración interna está incompleta. Revisá la preparación inicial antes de guardar la clave de Vercel.',
      CONFIG_URL:
        'La configuración no contiene un origen de retorno válido. Revisá MONZO_ORIGIN sin compartir credenciales.',
      CONFIG_CALLBACK: 'El retorno debe apuntar al origen HTTPS del preview de MONZO.',
      CONFIG_VERCEL_AUTH:
        'La clave debe ser independiente y el retorno debe apuntar al preview bajo .vercel.app.',
    };
    console.error(
      messages[error?.code] ??
        'No pudimos guardar la clave. Revisá la configuración privada de Evolution.',
    );
    process.exitCode = 1;
  }
}
