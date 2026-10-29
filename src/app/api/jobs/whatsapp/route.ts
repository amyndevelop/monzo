import { getDb } from '@/lib/db';
import { jobSchema, processJob, processorMode, verifyJob } from '@/modules/whatsapp/core/qstash';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  if (processorMode() !== 'qstash') return new Response('Not enabled', { status: 404 });
  const reader = request.body?.getReader();
  if (!reader) return new Response('Empty body', { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2048) {
      await reader.cancel();
      return new Response('Payload too large', { status: 413 });
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!(await verifyJob(raw, request.headers.get('upstash-signature'))))
    return new Response('Invalid signature', { status: 403 });
  let job;
  try {
    job = jobSchema.parse(JSON.parse(raw));
  } catch {
    return new Response('Invalid job', { status: 400 });
  }
  try {
    await processJob(getDb(), job);
    return Response.json({ processed: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('WhatsApp event processing unavailable.');
    return new Response('Temporarily unavailable', { status: 503 });
  }
}
