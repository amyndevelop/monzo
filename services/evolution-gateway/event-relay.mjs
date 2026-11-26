import { randomBytes } from 'node:crypto';
import { readJson } from './core.mjs';
import { instanceScope } from './instance-client.mjs';
import {
  PROTOCOL,
  PROBE_PATH,
  EVENT_PATH,
  secretPattern,
  eventDigest,
  eventSignature,
  eventProof,
  sameSecret,
} from './protocol.mjs';

// config comes from readConfig: there is one fixed callback origin. Neither an
// event nor a requester can supply its URL or any response redirect destination.
export async function deliverEvent(config, record, { transport = fetch, clock = Date.now } = {}) {
  const target = new URL(config.callbackUrl);
  if (
    target.pathname !== PROBE_PATH ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  )
    throw new Error('CONFIG_CALLBACK');
  target.pathname = EVENT_PATH;
  if (
    !record ||
    record.kind !== 'event' ||
    !secretPattern.test(record.id) ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 1
  )
    throw new Error('EVENT_ENVELOPE');
  const { tenantId, accountId, generation, expectedPhone } = instanceScope(record.scope);
  const scope = { tenantId, accountId, generation, expectedPhone };
  const body = JSON.stringify({
    kind: 'monzo.evolution.event',
    id: record.id,
    sequence: record.sequence,
    scope,
    payload: record.payload,
  });
  if (Buffer.byteLength(body) > 65536) return { acknowledged: false, code: 'EVENT_LIMIT' };
  const digest = eventDigest(body);
  const nonce = randomBytes(16).toString('hex');
  const timestamp = String(Math.floor(clock() / 1000));
  let response;
  try {
    response = await transport(target.href, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(7000),
      headers: {
        'content-type': 'application/json',
        ...(config.vercelBypassSecret
          ? { 'x-vercel-protection-bypass': config.vercelBypassSecret }
          : {}),
        'x-monzo-timestamp': timestamp,
        'x-monzo-nonce': nonce,
        'x-monzo-signature': eventSignature(config.webhookSecret, body, timestamp, nonce),
      },
      body,
    });
  } catch {
    return { acknowledged: false, code: 'CALLBACK_UNREACHABLE' };
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    const code =
      response.status >= 300 && response.status < 400
        ? 'CALLBACK_REDIRECT'
        : [401, 403].includes(response.status)
          ? 'CALLBACK_AUTH'
          : response.status === 409
            ? 'CALLBACK_CONFLICT'
            : 'CALLBACK_UNAVAILABLE';
    return { acknowledged: false, code };
  }
  let ack;
  try {
    ack = await readJson(response, 2048);
  } catch {
    return { acknowledged: false, code: 'CALLBACK_RESPONSE' };
  }
  if (
    !ack ||
    typeof ack !== 'object' ||
    Array.isArray(ack) ||
    Object.keys(ack).sort().join(',') !== 'digest,id,proof,protocol' ||
    ack.protocol !== PROTOCOL ||
    ack.id !== record.id ||
    ack.digest !== digest ||
    !sameSecret(ack.proof, eventProof(config.webhookSecret, record.id, digest, nonce))
  )
    return { acknowledged: false, code: 'CALLBACK_PROOF' };
  return { acknowledged: true, code: 'OK' };
}

// Claim at most four accounts concurrently. The store keeps a failed account's
// head pending, allows other accounts to advance, and preserves order on retry.
// HTTP 200 alone never authorizes removal: only a matching signed ACK does.
export async function relayEvents(store, config, options = {}) {
  const records = store.claim('event', { limit: 4, leaseMs: 30000 });
  return Promise.all(
    records.map(async (record) => {
      const result = await deliverEvent(config, record, options);
      if (result.acknowledged) {
        if (!store.finish(record.id, record.leaseToken, { code: 'ACKNOWLEDGED' }))
          return { id: record.id, acknowledged: false, code: 'LEASE_LOST' };
      } else {
        // No maximum attempt count discards a pending business event.
        const delayMs = Math.min(300000, 1000 * 2 ** Math.min(record.attempts - 1, 9));
        if (!store.retryEvent(record.id, record.leaseToken, delayMs))
          return { id: record.id, acknowledged: false, code: 'LEASE_LOST' };
      }
      return { id: record.id, ...result };
    }),
  );
}
