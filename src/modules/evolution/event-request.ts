import { z } from 'zod';
import { evolutionEventSchema, type EvolutionEvent } from './event-schema';
import { EvolutionEventError } from './events';
import {
  PROTOCOL,
  EVENT_PATH,
  secretPattern,
  noncePattern,
  verifyEvent,
  eventDigest,
  eventProof,
} from '../../../services/evolution-gateway/protocol.mjs';

export async function receiveEvolutionEvent(
  request: Request,
  options: {
    enabled: boolean;
    secret: string | undefined;
    process: (event: EvolutionEvent, digest: string) => Promise<unknown>;
    clock?: () => number;
  },
) {
  const reply = (status: number, body: unknown) =>
    Response.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  if (new URL(request.url).pathname !== EVENT_PATH) return reply(404, { error: 'NOT_FOUND' });
  if (request.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!options.enabled) return reply(503, { error: 'CHANNELS_DISABLED' });
  const secret = options.secret;
  if (!secret || !secretPattern.test(secret)) return reply(503, { error: 'NOT_CONFIGURED' });
  const headers = {
    timestamp: request.headers.get('x-monzo-timestamp'),
    nonce: request.headers.get('x-monzo-nonce'),
    signature: request.headers.get('x-monzo-signature'),
  };
  if (
    !headers.nonce ||
    !noncePattern.test(headers.nonce) ||
    !headers.signature ||
    !secretPattern.test(headers.signature) ||
    !headers.timestamp ||
    !/^\d{10}$/.test(headers.timestamp)
  )
    return reply(401, { error: 'UNAUTHORIZED' });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return reply(415, { error: 'CONTENT_TYPE' });
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 65536))
    return reply(413, { error: 'BODY_LIMIT' });
  const reader = request.body?.getReader();
  if (!reader) return reply(400, { error: 'BAD_REQUEST' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 5000);
  timer.unref();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        return reply(413, { error: 'BODY_LIMIT' });
      }
      chunks.push(value);
    }
  } catch {
    return reply(400, { error: 'BAD_REQUEST' });
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) return reply(408, { error: 'BODY_TIMEOUT' });
  const body = Buffer.concat(chunks),
    now = options.clock?.() ?? Date.now();
  if (!verifyEvent(secret, body, headers, now)) return reply(401, { error: 'UNAUTHORIZED' });
  try {
    const event = evolutionEventSchema.parse(JSON.parse(body.toString('utf8')));
    const digest = eventDigest(body);
    await options.process(event, digest);
    return reply(200, {
      protocol: PROTOCOL,
      id: event.id,
      digest,
      proof: eventProof(secret, event.id, digest, headers.nonce),
    });
  } catch (error) {
    if (error instanceof EvolutionEventError) return reply(error.status, { error: error.code });
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return reply(400, { error: 'BAD_EVENT' });
    return reply(500, { error: 'EVENT_PROCESSING' });
  }
}
