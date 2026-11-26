import { z } from 'zod';
import { evolutionScopeSchema } from './event-schema';
import {
  EvolutionError,
  evolutionConfiguration,
  evolutionNetwork,
  type EvolutionTransport,
} from './core';
import { PROTOCOL, PROBE_PATH } from '../../../services/evolution-gateway/protocol.mjs';

export type EvolutionScope = z.infer<typeof evolutionScopeSchema>;
export type EvolutionCommand =
  | {
      scope: EvolutionScope;
      commandId: string;
      deadline: number;
      operation: 'connect' | 'refresh' | 'disconnect';
    }
  | {
      scope: EvolutionScope;
      commandId: string;
      deadline: number;
      operation: 'send';
      data: { messageId: string; providerId: string; to: string; text: string };
    };
export class ChannelRpcError extends EvolutionError {
  constructor(
    code: string,
    public uncertain = false,
    status = 502,
  ) {
    super(code, status);
  }
}
const stateSchema = z
  .object({
    protocol: z.literal(PROTOCOL),
    scope: evolutionScopeSchema,
    state: z.enum(['DISCONNECTED', 'DISCONNECTING', 'CONNECTING', 'QR', 'CONNECTED', 'ERROR']),
    desiredState: z.enum(['CONNECTED', 'DISCONNECTED']),
    connectedPhone: z
      .string()
      .regex(/^[1-9][0-9]{5,14}$/)
      .nullable(),
    qr: z.string().max(4096).nullable(),
    qrExpiresAt: z.number().int().safe().positive().nullable(),
    lastSeenAt: z.number().int().safe().positive().nullable(),
    lastErrorCode: z
      .string()
      .regex(/^[A-Z0-9_]{1,64}$/)
      .nullable(),
  })
  .strict();
const commandSchema = z
  .object({
    protocol: z.literal(PROTOCOL),
    commandId: z.string().min(1).max(128),
    state: z.enum(['ACCEPTED', 'DONE', 'UNKNOWN', 'FAILED', 'CANCELED']),
  })
  .strict();
const errorCodes = new Set([
  'CALLBACK_MISMATCH',
  'STALE_GENERATION',
  'IDEMPOTENCY_CONFLICT',
  'NUMBER_SCOPE_CHANGED',
  'COMMAND_EXPIRED',
  'CHANNEL_CAPACITY',
  'PHONE_IN_USE',
  'DISCONNECTED',
  'INVALID_MESSAGE',
  'STORAGE_FULL',
]);
async function json(response: Awaited<ReturnType<EvolutionTransport>>) {
  if (
    !response.body ||
    !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
  ) {
    await response.body?.cancel().catch(() => {});
    throw new ChannelRpcError('INVALID_RESPONSE', true);
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) throw new Error('LIMIT');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    await reader.cancel().catch(() => {});
    throw new ChannelRpcError('INVALID_RESPONSE', true);
  }
}
async function rpc(
  config: ReturnType<typeof evolutionConfiguration>,
  monzoOrigin: string,
  path: '/v1/channels/command' | '/v1/channels/state',
  input: object,
  transport: EvolutionTransport,
) {
  if (!config.configured) throw new ChannelRpcError('NOT_CONFIGURED');
  if (transport === evolutionNetwork && process.env.DATABASE_URL) {
    const db = new URL(process.env.DATABASE_URL);
    if (
      db.pathname === '/monzo_test' &&
      !(
        db.hostname === '127.0.0.1' &&
        db.port === '55433' &&
        !process.env.VERCEL &&
        new URL(config.origin).hostname === '127.0.0.1'
      )
    )
      throw new ChannelRpcError('TEST_NETWORK_DISABLED');
  }
  let response: Awaited<ReturnType<EvolutionTransport>>;
  try {
    response = await transport(config.origin + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, callbackUrl: monzoOrigin + PROBE_PATH }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ChannelRpcError('UNREACHABLE', true);
  }
  if (!response.ok) {
    const uncertain = response.status >= 500 && response.status !== 507;
    let code =
      response.status === 401 || response.status === 403
        ? 'GATEWAY_AUTH'
        : response.status === 404
          ? 'CHANNELS_DISABLED'
          : response.status === 429
            ? 'BUSY'
            : 'UNREACHABLE';
    try {
      const data = await json(response);
      if (
        data &&
        typeof data === 'object' &&
        'error' in data &&
        typeof data.error === 'string' &&
        errorCodes.has(data.error)
      )
        code = data.error;
    } catch {}
    throw new ChannelRpcError(code, uncertain);
  }
  return json(response);
}
export async function evolutionCommand(
  config: ReturnType<typeof evolutionConfiguration>,
  monzoOrigin: string,
  command: EvolutionCommand,
  transport: EvolutionTransport = evolutionNetwork,
) {
  const result = commandSchema.safeParse(
    await rpc(config, monzoOrigin, '/v1/channels/command', command, transport),
  );
  if (!result.success || result.data.commandId !== command.commandId)
    throw new ChannelRpcError('INVALID_RESPONSE', true);
  return result.data;
}
export async function evolutionState(
  config: ReturnType<typeof evolutionConfiguration>,
  monzoOrigin: string,
  scope: EvolutionScope,
  transport: EvolutionTransport = evolutionNetwork,
) {
  const result = stateSchema.safeParse(
    await rpc(config, monzoOrigin, '/v1/channels/state', { scope }, transport),
  );
  if (
    !result.success ||
    Object.keys(scope).some(
      (key) =>
        result.data.scope[key as keyof EvolutionScope] !== scope[key as keyof EvolutionScope],
    ) ||
    (result.data.state === 'CONNECTED' && result.data.connectedPhone !== scope.expectedPhone)
  )
    throw new ChannelRpcError('INVALID_RESPONSE', true);
  return result.data;
}
