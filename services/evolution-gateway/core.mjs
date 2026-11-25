import { randomBytes } from 'node:crypto';
import {
  PROTOCOL,
  PROBE_PATH,
  probeSignature,
  responseProof,
  sameSecret,
  secretPattern,
} from './protocol.mjs';

// Bound the opaque key and exclude header injection and dotenv interpolation/escaping.
export const automationSecretPattern = /^[A-Za-z0-9._~+\/=-]{16,512}$/;

export class GatewayError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export function readConfig(env) {
  const config = {
    evolutionOrigin: env.EVOLUTION_ORIGIN ?? 'http://evolution:8080',
    apiKey: env.EVOLUTION_API_KEY ?? '',
    gatewayKey: env.EVOLUTION_GATEWAY_KEY ?? '',
    webhookSecret: env.EVOLUTION_WEBHOOK_SECRET ?? '',
    callbackUrl: env.MONZO_CALLBACK_URL ?? '',
    vercelBypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '',
    version: '2.3.8',
    port: Number(env.PORT ?? 9080),
  };
  if (
    ![config.apiKey, config.gatewayKey, config.webhookSecret].every((value) =>
      secretPattern.test(value),
    ) ||
    new Set([config.apiKey, config.gatewayKey, config.webhookSecret]).size !== 3
  )
    throw new GatewayError('CONFIG_SECRETS', 503);
  const localTest = env.NODE_ENV === 'test';
  let origin, callback;
  try {
    origin = new URL(config.evolutionOrigin);
    callback = new URL(config.callbackUrl);
  } catch {
    throw new GatewayError('CONFIG_URL', 503);
  }
  const isLoopback = (url) => ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.origin !== 'http://evolution:8080' &&
      !(localTest && origin.protocol === 'http:' && isLoopback(origin)))
  )
    throw new GatewayError('CONFIG_UPSTREAM', 503);
  if (
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash ||
    callback.pathname !== PROBE_PATH ||
    (callback.protocol !== 'https:' &&
      !(localTest && callback.protocol === 'http:' && isLoopback(callback)))
  )
    throw new GatewayError('CONFIG_CALLBACK', 503);
  if (callback.protocol === 'https:' && (isLoopback(callback) || callback.port))
    throw new GatewayError('CONFIG_CALLBACK', 503);
  if (
    config.vercelBypassSecret &&
    (!automationSecretPattern.test(config.vercelBypassSecret) ||
      [config.apiKey, config.gatewayKey, config.webhookSecret].includes(
        config.vercelBypassSecret,
      ) ||
      !(
        (callback.protocol === 'https:' && callback.hostname.endsWith('.vercel.app')) ||
        (localTest && callback.protocol === 'http:' && isLoopback(callback))
      ))
  )
    throw new GatewayError('CONFIG_VERCEL_AUTH', 503);
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535)
    throw new GatewayError('CONFIG_PORT', 503);
  return { ...config, evolutionOrigin: origin.origin, callbackUrl: callback.href };
}
export async function readJson(response, maximum = 16384) {
  if (
    !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => {});
    throw new GatewayError('INVALID_RESPONSE');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new GatewayError('RESPONSE_LIMIT');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error instanceof GatewayError ? error : new GatewayError('INVALID_RESPONSE');
  }
}
export async function checkEvolution(config, transport = fetch) {
  let root;
  try {
    root = await transport(config.evolutionOrigin + '/', {
      redirect: 'error',
      headers: { origin: new URL(config.callbackUrl).origin },
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    return { ok: false, code: 'EVOLUTION_UNREACHABLE' };
  }
  if (!root.ok) {
    await root.body?.cancel();
    return { ok: false, code: 'EVOLUTION_UNREACHABLE' };
  }
  let info;
  try {
    info = await readJson(root);
  } catch {
    return { ok: false, code: 'EVOLUTION_INVALID_RESPONSE' };
  }
  if (info?.version !== config.version) return { ok: false, code: 'EVOLUTION_VERSION' };
  let auth;
  try {
    auth = await transport(config.evolutionOrigin + '/instance/fetchInstances', {
      headers: { apikey: config.apiKey, origin: new URL(config.callbackUrl).origin },
      redirect: 'error',
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    return { ok: false, code: 'EVOLUTION_UNREACHABLE' };
  }
  // Verify the protected endpoint without parsing, returning or retaining the instance list.
  const json = auth.headers.get('content-type')?.toLowerCase().startsWith('application/json');
  await auth.body?.cancel();
  if ([401, 403].includes(auth.status)) return { ok: false, code: 'EVOLUTION_AUTH' };
  if (!auth.ok || !json) return { ok: false, code: 'EVOLUTION_INVALID_RESPONSE' };
  return { ok: true, code: 'OK', version: info.version };
}
export async function diagnostics(config, input, transport = fetch, now = Date.now()) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'callbackUrl,challenge' ||
    typeof input.challenge !== 'string' ||
    !secretPattern.test(input.challenge) ||
    input.callbackUrl !== config.callbackUrl
  )
    throw new GatewayError('CALLBACK_MISMATCH', 409);
  const evolution = await checkEvolution(config, transport);
  const result = {
    protocol: PROTOCOL,
    challenge: input.challenge,
    checkedAt: new Date(now).toISOString(),
    evolution,
    callback: { ok: false, code: 'NOT_CHECKED' },
  };
  if (!evolution.ok) return result;
  const nonce = randomBytes(16).toString('hex');
  const timestamp = String(Math.floor(now / 1000));
  const body = JSON.stringify({ kind: 'monzo.evolution.probe', challenge: input.challenge });
  let callback;
  try {
    callback = await transport(config.callbackUrl, {
      method: 'POST',
      // Inspect redirects without following them or forwarding any credentials.
      redirect: 'manual',
      signal: AbortSignal.timeout(7000),
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
  } catch {
    return { ...result, callback: { ok: false, code: 'CALLBACK_UNREACHABLE' } };
  }
  if (callback.status >= 300 && callback.status < 400) {
    await callback.body?.cancel();
    return { ...result, callback: { ok: false, code: 'CALLBACK_REDIRECT' } };
  }
  if ([401, 403].includes(callback.status)) {
    await callback.body?.cancel();
    return { ...result, callback: { ok: false, code: 'CALLBACK_AUTH' } };
  }
  if (!callback.ok) {
    await callback.body?.cancel();
    return { ...result, callback: { ok: false, code: 'CALLBACK_UNREACHABLE' } };
  }
  let data;
  try {
    data = await readJson(callback);
  } catch {
    return { ...result, callback: { ok: false, code: 'CALLBACK_RESPONSE' } };
  }
  return {
    ...result,
    callback: {
      ok:
        data?.challenge === input.challenge &&
        sameSecret(data?.proof, responseProof(config.webhookSecret, input.challenge, nonce)),
      code:
        data?.challenge === input.challenge &&
        sameSecret(data?.proof, responseProof(config.webhookSecret, input.challenge, nonce))
          ? 'OK'
          : 'CALLBACK_RESPONSE',
    },
  };
}
