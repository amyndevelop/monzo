import { createHmac, timingSafeEqual } from 'node:crypto';

export const PROTOCOL = 'monzo-evolution-v1';
export const PROBE_PATH = '/api/integrations/evolution/probe';
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
