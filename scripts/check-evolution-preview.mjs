import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../services/evolution-gateway/core.mjs';
import { PROBE_PATH } from '../services/evolution-gateway/protocol.mjs';

export async function checkPreviewAccess(config, transport = fetch) {
  let response;
  try {
    response = await transport(config.callbackUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: config.vercelBypassSecret
        ? { 'x-vercel-protection-bypass': config.vercelBypassSecret }
        : {},
    });
    await response.body?.cancel();
  } catch {
    return { ok: false, code: 'UNREACHABLE', httpStatus: null };
  }
  // The real probe only accepts POST. GET=405 confirms we reached that route.
  return {
    ok: response.status === 405,
    code:
      response.status === 405
        ? 'OK'
        : response.status >= 300 && response.status < 400
          ? 'REDIRECT'
          : 'HTTP_ERROR',
    httpStatus: response.status,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = parseEnv(readFileSync('.env.evolution', 'utf8'));
    const config = readConfig({ ...env, MONZO_CALLBACK_URL: env.MONZO_ORIGIN + PROBE_PATH });
    const result = await checkPreviewAccess(config);
    if (result.ok)
      console.log(
        'Preview accesible: HTTP 405 esperado. Falta verificar el retorno HMAC desde MONZO.',
      );
    else if (result.code === 'REDIRECT')
      console.error(
        'El preview redirige la solicitud. Revisá la clave de acceso para automatizaciones de Vercel.',
      );
    else
      console.error(
        'No se pudo comprobar el preview. Estado HTTP: ' + (result.httpStatus ?? 'sin respuesta'),
      );
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    console.error('No se pudo leer la configuración privada de Evolution.');
    process.exitCode = 1;
  }
}
