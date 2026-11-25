import { z } from 'zod';
import {
  verifyProbe,
  responseProof,
  secretPattern,
  noncePattern,
} from '../../../services/evolution-gateway/protocol.mjs';

export async function evolutionProbe(request: Request, secret: string | undefined) {
  const respond = (status: number, body: unknown) =>
    Response.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  if (!secret || !secretPattern.test(secret)) return respond(503, { error: 'NOT_CONFIGURED' });
  const headers = {
    timestamp: request.headers.get('x-monzo-timestamp'),
    nonce: request.headers.get('x-monzo-nonce'),
    signature: request.headers.get('x-monzo-signature'),
  };
  if (
    !headers.signature ||
    !secretPattern.test(headers.signature) ||
    !headers.nonce ||
    !noncePattern.test(headers.nonce) ||
    !headers.timestamp ||
    !/^\d{10}$/.test(headers.timestamp)
  )
    return respond(401, { error: 'UNAUTHORIZED' });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return respond(415, { error: 'CONTENT_TYPE' });
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 2048))
    return respond(413, { error: 'BODY_LIMIT' });
  const reader = request.body?.getReader();
  if (!reader) return respond(400, { error: 'BAD_REQUEST' });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2048) {
        await reader.cancel();
        return respond(413, { error: 'BODY_LIMIT' });
      }
      chunks.push(value);
    }
  } catch {
    return respond(400, { error: 'BAD_REQUEST' });
  }
  const raw = Buffer.concat(chunks);
  if (!verifyProbe(secret, raw, headers)) return respond(401, { error: 'UNAUTHORIZED' });
  const schema = z
    .object({
      kind: z.literal('monzo.evolution.probe'),
      challenge: z.string().regex(secretPattern),
    })
    .strict();
  try {
    const data = schema.parse(JSON.parse(raw.toString('utf8')));
    // This endpoint is a side-effect-free, idempotent connectivity probe, not a message receiver.
    return respond(200, {
      challenge: data.challenge,
      proof: responseProof(secret, data.challenge, headers.nonce),
    });
  } catch {
    return respond(400, { error: 'BAD_REQUEST' });
  }
}
