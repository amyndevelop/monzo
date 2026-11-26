import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PROTOCOL = 'monzo-evolution-v1';
export const PROBE_PATH = '/api/integrations/evolution/probe';
export const EVENT_PATH = '/api/integrations/evolution/events';
export const secretPattern = /^[a-f0-9]{64}$/;
export const noncePattern = /^[a-f0-9]{32}$/;

function mac(secret, value) {
  if (!secretPattern.test(secret)) throw new Error('INVALID_SECRET');
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(value).digest('hex');
}
export function sameSecret(a, b) {
  if (
    typeof a !== 'string' ||
    typeof b !== 'string' ||
    !secretPattern.test(a) ||
    !secretPattern.test(b)
  )
    return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
export function probeSignature(secret, body, timestamp, nonce) {
  if (!/^\d{10}$/.test(timestamp) || !noncePattern.test(nonce)) throw new Error('INVALID_ENVELOPE');
  return mac(
    secret,
    Buffer.concat([
      Buffer.from(`${PROTOCOL}:request\n${timestamp}\n${nonce}\n`),
      Buffer.from(body),
    ]),
  );
}
export function verifyProbe(secret, body, headers, now = Date.now()) {
  const { timestamp, nonce, signature } = headers;
  if (
    typeof timestamp !== 'string' ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 60 ||
    typeof nonce !== 'string' ||
    !noncePattern.test(nonce) ||
    typeof signature !== 'string' ||
    !secretPattern.test(signature)
  )
    return false;
  return sameSecret(signature, probeSignature(secret, body, timestamp, nonce));
}
export function responseProof(secret, challenge, nonce) {
  if (!secretPattern.test(challenge) || !noncePattern.test(nonce))
    throw new Error('INVALID_CHALLENGE');
  return mac(secret, `${PROTOCOL}:response\n${challenge}\n${nonce}`);
}

// Message delivery and its acknowledgement have separate domains from the
// side-effect-free probe. The signed request binds the fixed method and path.
export function eventDigest(body) {
  return createHash('sha256').update(body).digest('hex');
}
export function eventSignature(secret, body, timestamp, nonce) {
  if (!/^\d{10}$/.test(timestamp) || !noncePattern.test(nonce)) throw new Error('INVALID_ENVELOPE');
  return mac(
    secret,
    `${PROTOCOL}:event-request\nPOST\n${EVENT_PATH}\n${timestamp}\n${nonce}\n${eventDigest(body)}`,
  );
}
export function verifyEvent(secret, body, headers, now = Date.now()) {
  const { timestamp, nonce, signature } = headers;
  if (
    typeof secret !== 'string' ||
    !secretPattern.test(secret) ||
    typeof timestamp !== 'string' ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 60 ||
    typeof nonce !== 'string' ||
    !noncePattern.test(nonce) ||
    typeof signature !== 'string' ||
    !secretPattern.test(signature)
  )
    return false;
  return sameSecret(signature, eventSignature(secret, body, timestamp, nonce));
}
export function eventProof(secret, id, digest, nonce) {
  if (!secretPattern.test(id) || !secretPattern.test(digest) || !noncePattern.test(nonce))
    throw new Error('INVALID_EVENT_ACK');
  return mac(secret, `${PROTOCOL}:event-ack\n${EVENT_PATH}\n${id}\n${digest}\n${nonce}`);
}
export function outboundMessageId(secret, tenantId, accountId, messageId) {
  if (
    ![tenantId, accountId, messageId].every(
      (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value),
    )
  )
    throw new Error('INVALID_MESSAGE_SCOPE');
  return (
    '3EB0' +
    mac(secret, `${PROTOCOL}:outbound-message-id\n${tenantId}\n${accountId}\n${messageId}`)
      .slice(0, 18)
      .toUpperCase()
  );
}
