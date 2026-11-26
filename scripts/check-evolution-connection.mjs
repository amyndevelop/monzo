import { randomBytes } from 'node:crypto';
import { parseArgs, parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, readJson } from '../services/evolution-gateway/core.mjs';
import { PROTOCOL, PROBE_PATH } from '../services/evolution-gateway/protocol.mjs';
import { privateFile } from './prepare-evolution-preview.mjs';

const evolutionCodes = new Set([
  'OK',
  'EVOLUTION_UNREACHABLE',
  'EVOLUTION_INVALID_RESPONSE',
  'EVOLUTION_AUTH',
  'EVOLUTION_VERSION',
]);
const callbackCodes = new Set([
  'OK',
  'NOT_CHECKED',
  'CALLBACK_UNREACHABLE',
  'CALLBACK_AUTH',
  'CALLBACK_REDIRECT',
  'CALLBACK_RESPONSE',
]);
class ConnectionCheckError extends Error {}
export function gatewayOrigin(host) {
  if (!/^(?=.{1,253}$)(?!.*\.\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))
    throw new ConnectionCheckError('CONFIGURATION');
  return 'https://' + host;
}
export async function checkGatewayConnection(config, origin, transport = fetch) {
  const challenge = randomBytes(32).toString('hex');
  let response;
  try {
    response = await transport(origin + '/v1/diagnostics', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { authorization: 'Bearer ' + config.gatewayKey, 'content-type': 'application/json' },
      body: JSON.stringify({ challenge, callbackUrl: config.callbackUrl }),
    });
  } catch {
    throw new ConnectionCheckError('UNREACHABLE');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ConnectionCheckError(
      [401, 403].includes(response.status)
        ? 'GATEWAY_AUTH'
        : response.status === 409
          ? 'CALLBACK_MISMATCH'
          : response.status === 429
            ? 'BUSY'
            : 'GATEWAY_HTTP',
    );
  }
  let data;
  try {
    data = await readJson(response);
  } catch {
    throw new ConnectionCheckError('INVALID_RESPONSE');
  }
  const evo = data?.evolution,
    callback = data?.callback;
  const timestamp = Date.parse(data?.checkedAt);
  if (
    data?.protocol !== PROTOCOL ||
    data?.challenge !== challenge ||
    !Number.isFinite(timestamp) ||
    Math.abs(Date.now() - timestamp) > 120000 ||
    !evolutionCodes.has(evo?.code) ||
    !callbackCodes.has(callback?.code) ||
    evo?.ok !== (evo?.code === 'OK') ||
    callback?.ok !== (callback?.code === 'OK') ||
    (evo?.ok && evo.version !== '2.3.8') ||
    (!evo?.ok && callback?.code !== 'NOT_CHECKED')
  )
    throw new ConnectionCheckError('INVALID_RESPONSE');
  // Return only allowlisted status codes, never provider payloads or keys.
  return { ok: evo.ok && callback.ok, evolutionCode: evo.code, callbackCode: callback.code };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { channels: { type: 'boolean' } },
      strict: true,
      allowPositionals: false,
    });
    const env = parseEnv(
      privateFile(values.channels ? '.evolution/channels.env' : '.env.evolution'),
    );
    const config = readConfig({ ...env, MONZO_CALLBACK_URL: env.MONZO_ORIGIN + PROBE_PATH });
    const result = await checkGatewayConnection(config, gatewayOrigin(env.EVOLUTION_PUBLIC_HOST));
    console.log('Evolution y credencial interna: ' + result.evolutionCode);
    console.log('Retorno HMAC a MONZO: ' + result.callbackCode);
    if (result.ok)
      console.log(
        'Conexión técnica completa comprobada. No se enviaron mensajes ni se modificó la base de MONZO.',
      );
    else
      console.error(
        'La comprobación quedó pendiente. Revisá las variables del Preview y el estado indicado.',
      );
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    const messages = {
      UNREACHABLE:
        'No se pudo conectar con el gateway HTTPS. Revisá el dominio, TLS y la red del VPS.',
      GATEWAY_AUTH:
        'El gateway rechazó su clave de conexión. Revisá la configuración privada del servicio.',
      CALLBACK_MISMATCH:
        'El gateway está preparado para otro origen de MONZO. Revisá el destino fijo del retorno.',
      BUSY: 'El gateway está ocupado. Esperá un momento antes de repetir.',
      GATEWAY_HTTP: 'El gateway respondió con un error HTTP.',
      INVALID_RESPONSE: 'El gateway devolvió una respuesta incompatible con esta comprobación.',
    };
    console.error(
      messages[error?.message] ??
        'No se pudo leer o validar la configuración privada de Evolution.',
    );
    process.exitCode = 1;
  }
}
