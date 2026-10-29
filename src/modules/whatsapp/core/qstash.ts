import { Receiver } from '@upstash/qstash';
import { fetch, EnvHttpProxyAgent } from 'undici';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { processWebhook } from './ingest';
import { processOutbound } from './outbound';
import type { MetaFetch } from './meta';

export const jobSchema = z
  .object({ kind: z.enum(['inbox', 'outbox', 'watchdog']), id: z.string().min(1).max(128) })
  .strict();
export type WhatsappJob = z.infer<typeof jobSchema>;
export function processorMode() {
  const mode = process.env.WHATSAPP_PROCESSOR ?? 'bullmq';
  if (mode !== 'bullmq' && mode !== 'qstash') throw new Error('INVALID_WHATSAPP_PROCESSOR');
  return mode;
}
export function callbackUrl() {
  const origin = new URL(process.env.BETTER_AUTH_URL ?? '');
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !(
      origin.protocol === 'https:' ||
      (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))
    )
  )
    throw new Error('INVALID_CALLBACK_ORIGIN');
  return new URL('/api/jobs/whatsapp', origin).href;
}
function endpoint() {
  const url = new URL(process.env.QSTASH_URL || 'https://qstash.upstash.io');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !/^qstash(?:[.-][a-z0-9-]+)*\.upstash\.io$/.test(url.hostname)
  )
    throw new Error('INVALID_QSTASH_URL');
  return new URL('/v2/batch', url).href;
}
export function qstashConfigured() {
  try {
    callbackUrl();
    endpoint();
    return Boolean(
      process.env.QSTASH_TOKEN &&
      process.env.QSTASH_CURRENT_SIGNING_KEY &&
      process.env.QSTASH_NEXT_SIGNING_KEY,
    );
  } catch {
    return false;
  }
}
export type QueueFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
let dispatcher: EnvHttpProxyAgent | undefined;
const network: QueueFetch = async (url, init) => {
  if (new URL(process.env.DATABASE_URL ?? '').pathname === '/monzo_test')
    throw new Error('TEST_NETWORK_DISABLED');
  dispatcher ??= new EnvHttpProxyAgent();
  return fetch(url, { ...init, dispatcher, redirect: 'error' });
};
export async function publishJobs(jobs: WhatsappJob[], transport: QueueFetch = network) {
  if (!jobs.length) return;
  if (!qstashConfigured()) throw new Error('QSTASH_NOT_CONFIGURED');
  const destination = callbackUrl();
  for (let i = 0; i < jobs.length; i += 50) {
    const batch = jobs.slice(i, i + 50).map((job) => ({
      destination,
      body: JSON.stringify(jobSchema.parse(job)),
      headers: {
        'Content-Type': 'application/json',
        'Upstash-Retries': '2',
        ...(job.kind === 'watchdog' ? { 'Upstash-Delay': '130s' } : {}),
      },
    }));
    const response = await transport(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('QSTASH_PUBLISH_FAILED');
    const result = await response.json();
    if (
      !Array.isArray(result) ||
      result.length !== batch.length ||
      result.some((item) => !item || typeof item.messageId !== 'string' || !item.messageId)
    )
      throw new Error('QSTASH_RESPONSE_UNKNOWN');
  }
}
export async function dispatchJobs(db: PrismaClient, jobs: WhatsappJob[], transport?: QueueFetch) {
  if (processorMode() !== 'qstash' || !jobs.length) return;
  const stale = new Date(Date.now() - 120000);
  const [events, messages] = await Promise.all([
    db.whatsappWebhookEvent.findMany({
      where: {
        id: { in: jobs.filter((j) => j.kind === 'inbox').map((j) => j.id) },
        state: 'PENDING',
        OR: [{ jobPublishedAt: null }, { jobPublishedAt: { lt: stale } }],
      },
      select: { id: true },
    }),
    db.message.findMany({
      where: {
        id: { in: jobs.filter((j) => j.kind === 'outbox').map((j) => j.id) },
        status: 'QUEUED',
        direction: 'OUTBOUND',
        OR: [{ jobPublishedAt: null }, { jobPublishedAt: { lt: stale } }],
      },
      select: { id: true },
    }),
  ]);
  const pending: WhatsappJob[] = [
    ...events.map((e) => ({ kind: 'inbox' as const, id: e.id })),
    ...messages.flatMap((m) => [
      { kind: 'outbox' as const, id: m.id },
      { kind: 'watchdog' as const, id: m.id },
    ]),
  ];
  if (!pending.length) return;
  try {
    await publishJobs(pending, transport);
    await Promise.all([
      db.whatsappWebhookEvent.updateMany({
        where: { id: { in: events.map((e) => e.id) }, state: 'PENDING' },
        data: { jobPublishedAt: new Date(), errorCode: null },
      }),
      db.message.updateMany({
        where: { id: { in: messages.map((m) => m.id) }, status: 'QUEUED' },
        data: { jobPublishedAt: new Date(), errorCode: null },
      }),
    ]);
  } catch {
    await Promise.all([
      db.whatsappWebhookEvent.updateMany({
        where: { id: { in: events.map((e) => e.id) }, state: 'PENDING' },
        data: { errorCode: 'QSTASH_PUBLISH_FAILED' },
      }),
      db.message.updateMany({
        where: { id: { in: messages.map((m) => m.id) }, status: 'QUEUED' },
        data: { errorCode: 'QSTASH_PUBLISH_FAILED' },
      }),
    ]);
    throw new Error('QSTASH_PUBLISH_FAILED');
  }
}
export async function verifyJob(raw: string, signature: string | null) {
  if (!signature || !process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY)
    return false;
  try {
    return await new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    }).verify({ body: raw, signature, url: callbackUrl() });
  } catch {
    return false;
  }
}
export async function processJob(db: PrismaClient, job: WhatsappJob, transport?: MetaFetch) {
  if (job.kind === 'watchdog') {
    await db.message.updateMany({
      where: { id: job.id, status: 'SENDING', attemptedAt: { lt: new Date(Date.now() - 120000) } },
      data: { status: 'UNKNOWN', errorCode: 'WORKER_INTERRUPTED' },
    });
  } else if (job.kind === 'outbox') {
    await processOutbound(db, job.id, transport);
  } else {
    try {
      await processWebhook(db, job.id);
    } catch {
      await db.whatsappWebhookEvent.updateMany({
        where: { id: job.id, state: 'PENDING' },
        data: { attempts: { increment: 1 }, errorCode: 'PROCESSING_FAILED' },
      });
      const exhausted = await db.whatsappWebhookEvent.updateMany({
        where: { id: job.id, state: 'PENDING', attempts: { gte: 3 } },
        data: { state: 'FAILED' },
      });
      if (!exhausted.count) throw new Error('WEBHOOK_PROCESSING_FAILED');
    }
  }
}
