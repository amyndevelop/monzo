import { randomBytes } from 'node:crypto';
import { EnvHttpProxyAgent, fetch as httpFetch } from 'undici';
import { z } from 'zod';
import {
  PROTOCOL,
  secretPattern,
  PROBE_PATH,
} from '../../../services/evolution-gateway/protocol.mjs';
import type { EvolutionReport } from './types';

export class EvolutionError extends Error {
  constructor(
    public code: string,
    public status = 502,
  ) {
    super(code);
  }
}
export function evolutionConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const url = env.EVOLUTION_GATEWAY_URL ?? '';
  const key = env.EVOLUTION_GATEWAY_KEY ?? '';
  const webhookSecret = env.EVOLUTION_WEBHOOK_SECRET ?? '';
  const missing = !url || !key || !webhookSecret;
  if (missing)
    return {
      configured: false as const,
      message:
        'El administrador de MONZO debe completar la conexión del servidor Evolution antes de comprobarlo.',
    };
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return {
      configured: false as const,
      message: 'La dirección del servidor necesita revisión en la configuración de MONZO.',
    };
  }
  const local = ['localhost', '127.0.0.1'].includes(target.hostname);
  let isolatedTest = false;
  try {
    const db = new URL(env.DATABASE_URL ?? '');
    isolatedTest =
      db.hostname === '127.0.0.1' && db.port === '55433' && db.pathname === '/monzo_test';
  } catch {}
  const allowLocal = !env.VERCEL && (isolatedTest || env.NODE_ENV === 'development');
  if (
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash ||
    !['http:', 'https:'].includes(target.protocol) ||
    (target.protocol !== 'https:' && !(local && allowLocal)) ||
    (local && !allowLocal) ||
    (!local && target.port)
  )
    return {
      configured: false as const,
      message:
        'El servidor debe usar un origen HTTPS válido. Revisá su dirección antes de continuar.',
    };
  if (!secretPattern.test(key) || !secretPattern.test(webhookSecret) || key === webhookSecret)
    return {
      configured: false as const,
      message:
        'Las credenciales del servidor necesitan revisión. Usá las claves generadas para esta conexión.',
    };
  return {
    configured: true as const,
    message: 'La configuración está cargada. Comprobá la conexión para conocer el estado actual.',
    origin: target.origin,
    key,
    webhookSecret,
  };
}
export type EvolutionTransport = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  },
) => Promise<{
  status: number;
  ok: boolean;
  headers: Pick<Headers, 'get'>;
  body: {
    cancel(): Promise<void>;
    getReader(): {
      read(): Promise<{ done: true; value?: Uint8Array } | { done: false; value: Uint8Array }>;
      cancel(): Promise<void>;
    };
  } | null;
}>;
let dispatcher: EnvHttpProxyAgent | undefined;
const network: EvolutionTransport = async (url, init) => {
  dispatcher ??= new EnvHttpProxyAgent();
  return httpFetch(url, { ...init, dispatcher });
};
export { network as evolutionNetwork };
const reportSchema = z
  .object({
    protocol: z.literal(PROTOCOL),
    challenge: z.string().regex(secretPattern),
    checkedAt: z.iso.datetime(),
    evolution: z
      .object({
        ok: z.boolean(),
        code: z.enum([
          'OK',
          'EVOLUTION_UNREACHABLE',
          'EVOLUTION_INVALID_RESPONSE',
          'EVOLUTION_AUTH',
          'EVOLUTION_VERSION',
        ]),
        version: z.string().max(30).optional(),
      })
      .strict(),
    callback: z
      .object({
        ok: z.boolean(),
        code: z.enum([
          'OK',
          'NOT_CHECKED',
          'CALLBACK_UNREACHABLE',
          'CALLBACK_AUTH',
          'CALLBACK_REDIRECT',
          'CALLBACK_RESPONSE',
        ]),
      })
      .strict(),
  })
  .strict();
export async function checkEvolutionGateway(
  config: ReturnType<typeof evolutionConfiguration>,
  monzoOrigin: string,
  transport: EvolutionTransport = network,
): Promise<EvolutionReport> {
  if (!config.configured) throw new EvolutionError('NOT_CONFIGURED', 409);
  if (
    transport === network &&
    process.env.DATABASE_URL &&
    new URL(process.env.DATABASE_URL).pathname === '/monzo_test'
  )
    throw new EvolutionError('TEST_NETWORK_DISABLED');
  const challenge = randomBytes(32).toString('hex');
  let response: Awaited<ReturnType<EvolutionTransport>>;
  try {
    response = await transport(config.origin + '/v1/diagnostics', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge, callbackUrl: monzoOrigin + PROBE_PATH }),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new EvolutionError('UNREACHABLE');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new EvolutionError(
      response.status === 401 || response.status === 403
        ? 'GATEWAY_AUTH'
        : response.status === 409
          ? 'CALLBACK_MISMATCH'
          : response.status === 429
            ? 'BUSY'
            : 'UNREACHABLE',
    );
  }
  if (
    !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => {});
    throw new EvolutionError('INVALID_RESPONSE');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let data: z.infer<typeof reportSchema>;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) throw new Error('LIMIT');
      chunks.push(value);
    }
    data = reportSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    await reader.cancel().catch(() => {});
    throw new EvolutionError('INVALID_RESPONSE');
  }
  if (
    data.challenge !== challenge ||
    Math.abs(Date.now() - Date.parse(data.checkedAt)) > 120000 ||
    data.evolution.ok !== (data.evolution.code === 'OK') ||
    data.callback.ok !== (data.callback.code === 'OK') ||
    (data.evolution.ok && data.evolution.version !== '2.3.8') ||
    (!data.evolution.ok && data.callback.code !== 'NOT_CHECKED')
  )
    throw new EvolutionError('INVALID_RESPONSE');
  const evoMessages: Record<string, string> = {
    EVOLUTION_UNREACHABLE: 'Evolution no responde. Revisá los contenedores y su conexión interna.',
    EVOLUTION_INVALID_RESPONSE:
      'El servidor respondió con un formato inesperado. Revisá la versión instalada.',
    EVOLUTION_AUTH:
      'Evolution rechazó su credencial interna. Revisá la configuración privada del VPS.',
    EVOLUTION_VERSION:
      'La versión de Evolution no coincide con la versión comprobada para esta integración.',
  };
  const callbackMessages: Record<string, string> = {
    NOT_CHECKED:
      'El retorno se comprueba cuando Evolution y su credencial responden correctamente.',
    CALLBACK_UNREACHABLE:
      'El VPS no pudo completar el retorno a MONZO. Revisá la URL y la disponibilidad del sitio.',
    CALLBACK_REDIRECT:
      'El retorno redirige a otra página. Si Vercel pide iniciar sesión, revisá el acceso para automatizaciones del VPS.',
    CALLBACK_AUTH:
      'El retorno fue rechazado. Revisá la clave de firma y si la protección del sitio de prueba bloquea las solicitudes del VPS.',
    CALLBACK_RESPONSE:
      'El retorno no coincide con la comprobación solicitada. Revisá el destino y la configuración del servicio.',
  };
  const serviceOk = ![
    'EVOLUTION_UNREACHABLE',
    'EVOLUTION_INVALID_RESPONSE',
    'EVOLUTION_VERSION',
  ].includes(data.evolution.code);
  return {
    ok: data.evolution.ok && data.callback.ok,
    checkedAt: data.checkedAt,
    checks: [
      {
        name: 'service',
        ok: serviceOk,
        message: serviceOk
          ? 'Evolution responde con la versión esperada.'
          : evoMessages[data.evolution.code],
      },
      {
        name: 'credential',
        ok: data.evolution.ok,
        message: data.evolution.ok
          ? 'La credencial interna fue aceptada por Evolution.'
          : data.evolution.code === 'EVOLUTION_AUTH'
            ? evoMessages.EVOLUTION_AUTH
            : 'Pendiente de que el servicio responda correctamente.',
      },
      {
        name: 'callback',
        ok: data.callback.ok,
        message: data.callback.ok
          ? 'El retorno autenticado llegó a MONZO y se verificó su respuesta.'
          : callbackMessages[data.callback.code],
      },
    ],
  };
}
