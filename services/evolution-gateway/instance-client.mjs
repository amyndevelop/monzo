import { createHash, createHmac } from 'node:crypto';
import { readJson } from './core.mjs';

export class InstanceError extends Error {
  constructor(code, uncertain = false) {
    super(code);
    this.code = code;
    this.uncertain = uncertain;
  }
}

export function instanceScope(input) {
  const id = /^[a-zA-Z0-9_-]{1,128}$/;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'accountId,expectedPhone,generation,tenantId' ||
    !id.test(input.tenantId ?? '') ||
    !id.test(input.accountId ?? '') ||
    typeof input.tenantId !== 'string' ||
    typeof input.accountId !== 'string' ||
    typeof input.expectedPhone !== 'string' ||
    !/^[1-9][0-9]{5,14}$/.test(input.expectedPhone) ||
    !Number.isSafeInteger(input.generation) ||
    input.generation < 1 ||
    input.generation > 2147483647
  )
    throw new InstanceError('INVALID_SCOPE');
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        'monzo-evolution-instance-v1',
        input.tenantId,
        input.accountId,
        input.generation,
      ]),
    )
    .digest('hex')
    .slice(0, 48);
  return { ...input, name: `monzo_${digest}_${input.generation}` };
}

export function instanceEventToken(config, input) {
  const scope = instanceScope(input);
  return createHmac('sha256', Buffer.from(config.apiKey, 'hex'))
    .update(`monzo-evolution-event-token-v1\n${scope.name}`)
    .digest('hex');
}

function statusFor(data, scope) {
  if (
    !data ||
    data.name !== scope.name ||
    data.integration !== 'WHATSAPP-BAILEYS' ||
    !['open', 'close', 'connecting'].includes(data.connectionStatus)
  )
    throw new InstanceError('INSTANCE_INVALID_RESPONSE');
  if (data.connectionStatus === 'open') {
    const phone =
      typeof data.ownerJid === 'string'
        ? /^([1-9][0-9]{5,14})(?::[0-9]{1,4})?@s\.whatsapp\.net$/.exec(data.ownerJid)?.[1]
        : null;
    if (!phone) throw new InstanceError('INSTANCE_IDENTITY_UNAVAILABLE');
    if (phone !== scope.expectedPhone) throw new InstanceError('NUMBER_MISMATCH');
    return { state: 'CONNECTED', connectedPhone: phone };
  }
  return { state: data.connectionStatus === 'connecting' ? 'CONNECTING' : 'DISCONNECTED' };
}

// Private provider adapter. Not registered as a public route or enabled in the Stage 2 stack.
// MONZO authorization, durable commands/events and generation fencing are required before wiring it.
export function instanceClient(config, transport = fetch) {
  const token = (scope, context) =>
    createHmac('sha256', Buffer.from(config.apiKey, 'hex'))
      .update(`monzo-evolution-${context}-v1\n${scope.name}`)
      .digest('hex');
  async function request(path, method = 'GET', body) {
    const mutating = method !== 'GET';
    let response;
    try {
      response = await transport(config.evolutionOrigin + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          apikey: config.apiKey,
          origin: new URL(config.callbackUrl).origin,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new InstanceError(
        mutating ? 'INSTANCE_RESULT_UNKNOWN' : 'INSTANCE_UNREACHABLE',
        mutating,
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ([401, 403].includes(response.status)) throw new InstanceError('EVOLUTION_AUTH');
      if (response.status === 404) throw new InstanceError('INSTANCE_NOT_FOUND');
      const uncertain = mutating && response.status >= 500;
      throw new InstanceError(
        uncertain ? 'INSTANCE_RESULT_UNKNOWN' : 'INSTANCE_REJECTED',
        uncertain,
      );
    }
    try {
      return await readJson(response, 65536);
    } catch {
      throw new InstanceError(
        mutating ? 'INSTANCE_RESULT_UNKNOWN' : 'INSTANCE_INVALID_RESPONSE',
        mutating,
      );
    }
  }
  async function lookup(scope) {
    let rows;
    try {
      rows = await request('/instance/fetchInstances?instanceName=' + scope.name);
    } catch (error) {
      if (error.code === 'INSTANCE_NOT_FOUND') return null;
      throw error;
    }
    if (!Array.isArray(rows) || rows.length > 1)
      throw new InstanceError('INSTANCE_INVALID_RESPONSE');
    if (rows.length === 0) return null;
    return statusFor(rows[0], scope);
  }
  return {
    async status(input) {
      const scope = instanceScope(input);
      return (await lookup(scope)) ?? { state: 'NOT_CREATED' };
    },
    async create(input) {
      const scope = instanceScope(input);
      const existing = await lookup(scope);
      if (existing) return existing;
      const data = await request('/instance/create', 'POST', {
        instanceName: scope.name,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: false,
        token: token(scope, 'provider-token'),
        groupsIgnore: true,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
        rejectCall: false,
        webhook: {
          enabled: true,
          url: 'http://evolution-gateway:9080/internal/events',
          byEvents: false,
          base64: false,
          headers: { authorization: 'Bearer ' + token(scope, 'event-token') },
          events: [
            'QRCODE_UPDATED',
            'CONNECTION_UPDATE',
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'SEND_MESSAGE',
          ],
        },
      });
      if (
        data?.instance?.instanceName !== scope.name ||
        data.instance.integration !== 'WHATSAPP-BAILEYS' ||
        data.instance.status !== 'close'
      )
        throw new InstanceError('INSTANCE_RESULT_UNKNOWN', true);
      return { state: 'DISCONNECTED' };
    },
    async connect(input) {
      const scope = instanceScope(input);
      const before = await lookup(scope);
      if (!before) throw new InstanceError('INSTANCE_NOT_FOUND');
      if (before.state === 'CONNECTED') return before;
      // Evolution uses GET for this action. A transport failure still has an uncertain outcome.
      let data;
      try {
        data = await request('/instance/connect/' + scope.name);
      } catch (error) {
        if (error.code === 'INSTANCE_UNREACHABLE')
          throw new InstanceError('INSTANCE_RESULT_UNKNOWN', true);
        throw error;
      }
      if (
        typeof data?.code === 'string' &&
        data.code.length > 0 &&
        data.code.length <= 4096 &&
        !/[\p{Cc}]/u.test(data.code)
      )
        return { state: 'QR', qr: data.code };
      // A phone may connect while the request is in flight. Never infer identity from state=open alone.
      const after = await lookup(scope);
      if (after?.state === 'CONNECTED') return after;
      if (after?.state === 'CONNECTING') return after;
      throw new InstanceError('QR_NOT_READY');
    },
    async disconnect(input) {
      const scope = instanceScope(input);
      let before;
      try {
        before = await lookup(scope);
      } catch (error) {
        // The owner must be able to close an accidentally scanned, mismatched phone.
        if (!['NUMBER_MISMATCH', 'INSTANCE_IDENTITY_UNAVAILABLE'].includes(error.code)) throw error;
        before = { state: 'CONNECTED' };
      }
      if (!before) return { state: 'NOT_CREATED' };
      if (before.state === 'DISCONNECTED') return before;
      await request('/instance/logout/' + scope.name, 'DELETE');
      const after = await lookup(scope);
      if (after?.state === 'CONNECTED') throw new InstanceError('INSTANCE_DISCONNECT_PENDING');
      return after ?? { state: 'NOT_CREATED' };
    },
  };
}
