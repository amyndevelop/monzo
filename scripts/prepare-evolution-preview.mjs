import { randomBytes } from 'node:crypto';
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  linkSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { readConfig } from '../services/evolution-gateway/core.mjs';
import { PROBE_PATH, secretPattern } from '../services/evolution-gateway/protocol.mjs';

const keys = ['BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'WHATSAPP_ENCRYPTION_KEY'];
export function privateFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > 16384
    )
      throw new Error('PRIVATE_FILE');
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}
export function publishOnce(path, content) {
  const temporary = path + '.' + randomBytes(6).toString('hex') + '.tmp';
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    try {
      linkSync(temporary, path);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
export function prepareEvolutionPreview(directory, monzoOrigin) {
  let origin;
  try {
    origin = new URL(monzoOrigin);
  } catch {
    throw new Error('PREVIEW_ORIGIN');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !/^[a-z0-9-]+-git-feat-evolution-conversations-[a-z0-9-]+\.vercel\.app$/.test(origin.hostname)
  )
    throw new Error('PREVIEW_ORIGIN');
  const source = parseEnv(privateFile(resolve(directory, '.env.evolution')));
  readConfig({ ...source, MONZO_CALLBACK_URL: source.MONZO_ORIGIN + PROBE_PATH });
  const privateDirectory = resolve(directory, '.evolution');
  try {
    mkdirSync(privateDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stat = lstatSync(privateDirectory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error('PRIVATE_DIRECTORY');
  const path = resolve(privateDirectory, 'preview-conversations.env');
  const fixed = {
    BETTER_AUTH_URL: origin.origin,
  };
  const validate = (content) => {
    const env = parseEnv(content);
    if (
      Object.keys(env).sort().join(',') !== [...keys].sort().join(',') ||
      Object.entries(fixed).some(([key, value]) => env[key] !== value) ||
      !secretPattern.test(env.BETTER_AUTH_SECRET ?? '') ||
      !secretPattern.test(env.WHATSAPP_ENCRYPTION_KEY ?? '')
    )
      throw new Error('EXISTING_PREVIEW');
    const own = [env.BETTER_AUTH_SECRET, env.WHATSAPP_ENCRYPTION_KEY];
    if (new Set(own).size !== 2 || own.some((value) => Object.values(source).includes(value)))
      throw new Error('EXISTING_PREVIEW');
  };
  try {
    validate(privateFile(path));
    return { path, created: false };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const prepared = {
    ...fixed,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    WHATSAPP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  const content = keys.map((key) => `${key}=${JSON.stringify(prepared[key])}`).join('\n') + '\n';
  validate(content);
  const created = publishOnce(path, content);
  validate(privateFile(path));
  return { path, created };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { 'monzo-origin': { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
    const result = prepareEvolutionPreview(process.cwd(), values['monzo-origin']);
    console.log(
      result.created
        ? 'Configuración privada del Preview preparada.'
        : 'Se conservó la configuración privada existente del Preview.',
    );
    console.log('Archivo: .evolution/preview-conversations.env');
    console.log(
      'No se imprimieron claves ni se cambiaron la base, el gateway o los servicios del VPS.',
    );
  } catch {
    console.error(
      'No se pudo preparar el Preview. Revisá el origen de la rama, la configuración inicial y los permisos privados; no borres ni regeneres claves para reintentar.',
    );
    process.exitCode = 1;
  }
}
