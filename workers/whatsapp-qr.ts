import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { acquireWebLease } from '../src/modules/whatsapp/web/core';
import { WebSocketSession } from '../src/modules/whatsapp/web/socket';
import { processWebhook } from '../src/modules/whatsapp/core/ingest';
import { processOutbound } from '../src/modules/whatsapp/core/outbound';
import { encryptionKey } from '../src/modules/whatsapp/core/crypto';
const database = new URL(process.env.DATABASE_URL ?? '');
if (
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  database.pathname === '/monzo_test'
)
  throw new Error('QR worker requires an explicitly configured non-test database.');
encryptionKey();
const db = new PrismaClient();
const owner = randomUUID();
const sockets = new Map<string, WebSocketSession>();
const retryAt = new Map<string, number>();
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    stopping = true;
  });
console.info('MONZO QR service started. No QR, credentials or message content are logged.');
try {
  while (!stopping) {
    try {
      await db.workerHeartbeat.upsert({
        where: { id: 'whatsapp-qr' },
        create: { id: 'whatsapp-qr', outboundEnabled: true, seenAt: new Date() },
        update: { outboundEnabled: true, seenAt: new Date() },
      });
      const sessions = await db.whatsappWebSession.findMany({
        where: {
          account: { provider: 'BAILEYS' },
          OR: [{ desiredState: 'CONNECTED' }, { state: { not: 'DISCONNECTED' } }],
        },
      });
      for (const session of sessions) {
        if (!(await acquireWebLease(db, session.accountId, owner))) continue;
        let socket = sockets.get(session.accountId);
        if (
          socket &&
          (socket.session.generation !== session.generation ||
            socket.closed ||
            session.desiredState === 'DISCONNECTED')
        ) {
          await socket.stop(session.desiredState === 'DISCONNECTED');
          sockets.delete(session.accountId);
          socket = undefined;
          retryAt.set(session.accountId, Date.now() + 10000);
        }
        if (session.desiredState === 'DISCONNECTED') {
          await db.whatsappAccount.updateMany({
            where: {
              id: session.accountId,
              provider: 'BAILEYS',
              webSession: { generation: session.generation, leaseOwner: owner },
            },
            data: { enabled: false },
          });
          await db.whatsappWebSession.updateMany({
            where: {
              accountId: session.accountId,
              generation: session.generation,
              leaseOwner: owner,
            },
            data: {
              state: 'DISCONNECTED',
              authEncrypted: null,
              qrEncrypted: null,
              qrExpiresAt: null,
              connectedWaId: null,
            },
          });
          continue;
        }
        if (!socket && (retryAt.get(session.accountId) ?? 0) <= Date.now()) {
          const fresh = await db.whatsappWebSession.findUniqueOrThrow({
            where: { accountId: session.accountId },
          });
          socket = new WebSocketSession(db, fresh, owner);
          sockets.set(session.accountId, socket);
          try {
            await socket.start();
          } catch {
            await socket.stop();
            sockets.delete(session.accountId);
            retryAt.set(session.accountId, Date.now() + 30000);
            await db.whatsappWebSession.updateMany({
              where: {
                accountId: session.accountId,
                generation: session.generation,
                leaseOwner: owner,
              },
              data: {
                state: 'ERROR',
                lastErrorCode: 'SESSION_START_FAILED',
                qrEncrypted: null,
                qrExpiresAt: null,
              },
            });
          }
        }
      }
      const pendingEvents = await db.whatsappWebhookEvent.findMany({
        where: {
          state: 'PENDING',
          accountId: { in: [...sockets.keys()] },
          account: { provider: 'BAILEYS' },
        },
        select: { id: true, attempts: true },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const event of pendingEvents) {
        try {
          await processWebhook(db, event.id);
        } catch {
          await db.whatsappWebhookEvent.updateMany({
            where: { id: event.id, state: 'PENDING' },
            data: {
              attempts: { increment: 1 },
              state: event.attempts >= 7 ? 'FAILED' : 'PENDING',
              errorCode: 'QR_PROCESSING_FAILED',
            },
          });
        }
      }
      for (const [id, socket] of sockets) {
        if (!sessions.some((s) => s.accountId === id) || !(await acquireWebLease(db, id, owner))) {
          await socket.stop();
          sockets.delete(id);
          continue;
        }
        if (!socket.connected || socket.closed) continue;
        const queued = await db.message.findMany({
          where: { accountId: id, direction: 'OUTBOUND', status: 'QUEUED' },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: 5,
        });
        for (const message of queued) {
          await processOutbound(db, message.id, undefined, {
            owner,
            send: async (accountId, generation, to, text, messageId) => {
              if (accountId !== id) throw new Error('QR_ACCOUNT_MISMATCH');
              return socket.send(generation, to, text, messageId);
            },
          });
        }
      }
      await db.message.updateMany({
        where: {
          direction: 'OUTBOUND',
          status: 'SENDING',
          account: { provider: 'BAILEYS' },
          attemptedAt: { lt: new Date(Date.now() - 120000) },
        },
        data: { status: 'UNKNOWN', errorCode: 'QR_RESULT_UNKNOWN' },
      });
    } catch {
      console.error('MONZO QR tick failed; retrying.');
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
} finally {
  await Promise.allSettled([...sockets.values()].map((s) => s.stop()));
  await db.whatsappAccount.updateMany({
    where: { provider: 'BAILEYS', webSession: { leaseOwner: owner } },
    data: { enabled: false },
  });
  await db.whatsappWebSession.updateMany({
    where: { leaseOwner: owner },
    data: { leaseOwner: null, leaseUntil: null, qrEncrypted: null, qrExpiresAt: null },
  });
  await db.$disconnect();
}
