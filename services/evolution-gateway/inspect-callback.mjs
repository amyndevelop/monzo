import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, readJson } from './core.mjs';
import { probeSignature, responseProof, sameSecret } from './protocol.mjs';

const networkCodes = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);
const configurationReasons = new Set([
  'MISSING',
  'QUOTED',
  'WHITESPACE',
  'ASSIGNMENT',
  'INVALID_FORMAT',
]);

// Operator-only diagnostic: read the running gateway's environment, never print its values.
export async function inspectCallback(config, transport = fetch) {
  const challenge = randomBytes(32).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ kind: 'monzo.evolution.probe', challenge });
  const started = Date.now();
  let response;
  try {
    response = await transport(config.callbackUrl, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        'content-type': 'application/json',
        ...(config.vercelBypassSecret
          ? { 'x-vercel-protection-bypass': config.vercelBypassSecret }
          : {}),
        'x-monzo-timestamp': timestamp,
        'x-monzo-nonce': nonce,
        'x-monzo-signature': probeSignature(config.webhookSecret, body, timestamp, nonce),
      },
      body,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return { code: 'REDIRECT', httpStatus: response.status, durationMs: Date.now() - started };
    }
    const data = await readJson(response).catch(() => null);
    const code =
      response.status === 503 && data?.error === 'NOT_CONFIGURED'
        ? 'NOT_CONFIGURED'
        : [401, 403].includes(response.status)
          ? 'AUTH'
          : !response.ok
            ? 'HTTP_ERROR'
            : data?.challenge === challenge &&
                sameSecret(data?.proof, responseProof(config.webhookSecret, challenge, nonce))
              ? 'OK'
              : 'INVALID_RESPONSE';
    return {
      code,
      httpStatus: response.status,
      durationMs: Date.now() - started,
      ...(code === 'NOT_CONFIGURED' && configurationReasons.has(data?.reason)
        ? { configurationReason: data.reason }
        : {}),
    };
  } catch (error) {
    const code =
      error?.name === 'TimeoutError'
        ? 'TIMEOUT'
        : networkCodes.has(error?.cause?.code)
          ? error.cause.code
          : 'NETWORK_OR_TLS';
    return { code, httpStatus: response?.status ?? null, durationMs: Date.now() - started };
  }
}

// Also accept source on stdin inside the existing /app container: no rebuild or restart.
if (!process.argv[1] || resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = readConfig(process.env);
    console.log('Destino del gateway:', new URL(config.callbackUrl).origin);
    const result = await inspectCallback(config);
    console.log('HTTP del Preview:', result.httpStatus ?? 'sin respuesta');
    console.log('Resultado:', result.code);
    if (result.configurationReason)
      console.log('Motivo de configuración:', result.configurationReason);
    console.log('Duración (ms):', result.durationMs);
    if (result.code === 'NOT_CONFIGURED')
      console.log(
        'Ese despliegue no tiene EVOLUTION_WEBHOOK_SECRET con formato válido. Revisar Preview, rama y redeploy del destino indicado.',
      );
    if (result.code === 'OK') console.log('Firma de respuesta válida.');
    process.exitCode = result.code === 'OK' ? 0 : 1;
  } catch {
    console.error(
      'No se pudo validar la configuración del gateway. No se muestran valores privados.',
    );
    process.exitCode = 1;
  }
}
