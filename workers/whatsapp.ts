import { PrismaClient } from '@prisma/client';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { processWebhook } from '../src/modules/whatsapp/core/ingest';
import { processOutbound } from '../src/modules/whatsapp/core/outbound';
if (process.env.WHATSAPP_PROCESSOR === 'qstash')
  throw new Error('QStash mode runs via signed HTTP callbacks; do not start the permanent worker.');
const db = new PrismaClient();
const redis = new URL(process.env.REDIS_URL ?? '');
if (!['redis:', 'rediss:'].includes(redis.protocol))
  throw new Error('REDIS_URL must be redis:// or rediss://.');
if (redis.protocol !== 'rediss:' && !['localhost', '127.0.0.1'].includes(redis.hostname))
  throw new Error('Remote Redis requires TLS (rediss://).');
const connection: ConnectionOptions = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  username: redis.username ? decodeURIComponent(redis.username) : undefined,
  password: redis.password ? decodeURIComponent(redis.password) : undefined,
  db: Number(redis.pathname.slice(1) || 0),
  maxRetriesPerRequest: null,
  ...(redis.protocol === 'rediss:' ? { tls: {} } : {}),
};
const inboundOnly = process.argv.includes('--inbound-only');
if (new URL(process.env.DATABASE_URL ?? '').pathname === '/monzo_test' && !inboundOnly)
  throw new Error(
    'Test database workers must use --inbound-only. Outbound tests inject a transport.',
  );
const prefix = process.env.WHATSAPP_QUEUE_PREFIX ?? 'monzo-whatsapp';
const inbox = new Queue('inbox', { connection, prefix });
const outbox = new Queue('outbox', { connection, prefix });
const workers = [
  new Worker(
    'inbox',
    async (job) => {
      try {
        await processWebhook(db, String(job.data.eventId));
      } catch {
        await db.whatsappWebhookEvent.updateMany({
          where: { id: String(job.data.eventId), state: { not: 'DONE' } },
          data: {
            attempts: { increment: 1 },
            state: job.attemptsMade + 1 >= 8 ? 'FAILED' : 'PENDING',
            errorCode: 'PROCESSING_FAILED',
          },
        });
        throw new Error('Webhook processing failed.');
      }
    },
    { connection, prefix, concurrency: 2 },
  ),
];
if (!inboundOnly)
  workers.push(
    new Worker('outbox', async (job) => processOutbound(db, String(job.data.messageId)), {
      connection,
      prefix,
      concurrency: 2,
      limiter: { max: 10, duration: 1000 },
    }),
  );
for (const worker of workers)
  worker.on('error', () => console.error('WhatsApp worker connection error.'));
for (const queue of [inbox, outbox])
  queue.on('error', () => console.error('WhatsApp queue connection error.'));
let stopping = false;
let running = false;
async function dispatch() {
  if (stopping || running) return;
  running = true;
  try {
    await inbox.waitUntilReady();
    await outbox.waitUntilReady();
    await db.workerHeartbeat.upsert({
      where: { id: 'whatsapp' },
      create: { id: 'whatsapp', seenAt: new Date(), outboundEnabled: !inboundOnly },
      update: { seenAt: new Date(), outboundEnabled: !inboundOnly },
    });
    const events = await db.whatsappWebhookEvent.findMany({
      where: { state: 'PENDING' },
      select: { id: true },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    for (const event of events) {
      const jobId = `event-${event.id}`;
      const previous = await inbox.getJob(jobId);
      if (previous && ['failed', 'completed'].includes(await previous.getState())) {
        const fresh = await db.whatsappWebhookEvent.findUnique({
          where: { id: event.id },
          select: { state: true },
        });
        if (fresh?.state !== 'PENDING') continue;
        await previous.remove();
      }
      await inbox.add(
        'receive',
        { eventId: event.id },
        {
          jobId,
          attempts: 8,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    }
    if (!inboundOnly) {
      const messages = await db.message.findMany({
        where: { direction: 'OUTBOUND', status: 'QUEUED' },
        select: { id: true },
        take: 100,
        orderBy: { createdAt: 'asc' },
      });
      for (const message of messages) {
        const jobId = `message-${message.id}`;
        const previous = await outbox.getJob(jobId);
        if (previous && ['failed', 'completed'].includes(await previous.getState())) {
          const fresh = await db.message.findUnique({
            where: { id: message.id },
            select: { status: true },
          });
          // Only a message that has never been claimed may be dispatched again.
          if (fresh?.status !== 'QUEUED') continue;
          await previous.remove();
        }
        await outbox.add(
          'send',
          { messageId: message.id },
          {
            jobId,
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: 100,
          },
        );
      }
    }
    // A crash after submitting to Meta cannot be retried safely. Later signed receipts can reconcile UNKNOWN.
    await db.message.updateMany({
      where: { status: 'SENDING', attemptedAt: { lt: new Date(Date.now() - 120000) } },
      data: { status: 'UNKNOWN', errorCode: 'WORKER_INTERRUPTED' },
    });
    // Retain only bounded operational history; never delete conversations or messages here.
    await db.whatsappWebhookEvent.deleteMany({
      where: { state: 'DONE', processedAt: { lt: new Date(Date.now() - 7 * 86400000) } },
    });
  } catch {
    console.error('WhatsApp dispatcher unavailable; pending work remains in PostgreSQL.');
  } finally {
    running = false;
  }
}
const timer = setInterval(() => void dispatch(), 3000);
void dispatch();
console.log(`WhatsApp worker started (${inboundOnly ? 'inbound only' : 'inbound and outbound'}).`);
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all([inbox.close(), outbox.close()]);
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
