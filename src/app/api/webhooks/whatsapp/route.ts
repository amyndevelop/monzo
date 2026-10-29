import { getDb } from '@/lib/db';
import { safeEqual, validSignature } from '@/modules/whatsapp/core/crypto';
import { captureWebhook } from '@/modules/whatsapp/core/ingest';
import { dispatchJobs } from '@/modules/whatsapp/core/qstash';
import { z } from 'zod';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!token) return new Response('Webhook not configured', { status: 503 });
  const query = new URL(request.url).searchParams;
  const challenge = query.get('hub.challenge') ?? '';
  if (
    query.get('hub.mode') !== 'subscribe' ||
    !safeEqual(query.get('hub.verify_token') ?? '', token) ||
    !/^\d{1,128}$/.test(challenge)
  )
    return new Response('Forbidden', { status: 403 });
  return new Response(challenge, {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
export async function POST(request: Request) {
  if (!process.env.WHATSAPP_APP_SECRET)
    return new Response('Webhook not configured', { status: 503 });
  const reader = request.body?.getReader();
  if (!reader) return new Response('Empty body', { status: 400 });
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1024 * 1024) {
      await reader.cancel();
      return new Response('Payload too large', { status: 413 });
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks);
  if (!validSignature(raw, request.headers.get('x-hub-signature-256')))
    return new Response('Invalid signature', { status: 403 });
  try {
    const events = await captureWebhook(getDb(), raw);
    await dispatchJobs(
      getDb(),
      events.map(({ id }) => ({ kind: 'inbox', id })),
    );
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return new Response('Invalid payload', { status: 400 });
    console.error('WhatsApp webhook persistence failed.');
    return new Response('Temporarily unavailable', { status: 503 });
  }
}
