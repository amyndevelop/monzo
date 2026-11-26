import type { PrismaClient, MessageStatus } from '@prisma/client';
import { pauseForHuman, advanceAutomation } from '../automations/runtime';
import { encryptToken } from '../whatsapp/core/crypto';
import { evolutionEventSchema, type EvolutionEvent } from './event-schema';

export class EvolutionEventError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
const statusRank: Partial<Record<MessageStatus, number>> = { SENT: 1, DELIVERED: 2, READ: 3 };
const qrContext = (accountId: string, generation: number) =>
  `evolution-qr:${accountId}:${generation}`;
export { qrContext };

// No HTTP or queue calls inside this transaction. The relay acknowledges only
// after it commits; duplicates must match the full signed body digest and scope.
export async function processEvolutionEvent(
  db: PrismaClient,
  input: EvolutionEvent,
  digest: string,
  now = Date.now(),
) {
  const event = evolutionEventSchema.parse(input);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new EvolutionEventError('EVENT_DIGEST', 400);
  const { scope, payload } = event;
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${scope.tenantId} FOR UPDATE`;
      const previous = await tx.evolutionDelivery.findUnique({ where: { id: event.id } });
      if (previous) {
        if (
          previous.digest !== digest ||
          previous.accountId !== scope.accountId ||
          previous.tenantId !== scope.tenantId ||
          previous.generation !== scope.generation ||
          previous.sequence !== BigInt(event.sequence)
        )
          throw new EvolutionEventError('EVENT_CONFLICT');
        return;
      }
      const account = await tx.whatsappAccount.findUnique({
        where: { id: scope.accountId },
        include: { evolutionSession: true },
      });
      const session = account?.evolutionSession;
      if (
        !account ||
        account.provider !== 'EVOLUTION' ||
        account.tenantId !== scope.tenantId ||
        !session ||
        session.expectedWaId !== scope.expectedPhone
      )
        throw new EvolutionEventError('ACCOUNT_SCOPE');
      if (scope.generation > session.generation) throw new EvolutionEventError('FUTURE_GENERATION');
      const currentGeneration = scope.generation === session.generation;
      const freshSequence = BigInt(event.sequence) > session.lastEventSequence;

      if (payload.type === 'connection' && currentGeneration && freshSequence) {
        if (payload.observedAt > now + 60000) throw new EvolutionEventError('EVENT_TIME', 400);
        let state = payload.state,
          code: string | null = payload.code ?? null;
        let connectedWaId: string | null = null,
          qrEncrypted: string | null = null,
          qrExpiresAt: Date | null = null;
        if (state === 'CONNECTED') {
          if (payload.connectedPhone !== scope.expectedPhone) {
            state = 'ERROR';
            code = 'NUMBER_MISMATCH';
          } else if (session.desiredState !== 'CONNECTED') state = 'DISCONNECTING';
          else if (payload.observedAt < now - 60000) {
            state = 'CONNECTING';
            code = 'INSTANCE_UNREACHABLE';
          } else connectedWaId = payload.connectedPhone;
        }
        if (state === 'QR') {
          if (
            !payload.qr ||
            !payload.qrExpiresAt ||
            payload.qrExpiresAt > payload.observedAt + 45000
          )
            throw new EvolutionEventError('INVALID_QR', 400);
          if (session.desiredState !== 'CONNECTED') state = 'DISCONNECTED';
          else if (payload.qrExpiresAt <= now) {
            state = 'CONNECTING';
            code = 'QR_EXPIRED';
          } else {
            qrEncrypted = encryptToken(
              payload.qr,
              scope.tenantId,
              qrContext(scope.accountId, scope.generation),
            );
            qrExpiresAt = new Date(payload.qrExpiresAt);
          }
        }
        const seenAt = Math.min(now, payload.observedAt);
        await tx.evolutionSession.update({
          where: { accountId: account.id },
          data: {
            state,
            connectedWaId,
            qrEncrypted,
            qrExpiresAt,
            lastErrorCode: code,
            lastEventSequence: BigInt(event.sequence),
            lastSeenAt: new Date(Math.max(session.lastSeenAt?.getTime() ?? 0, seenAt)),
          },
        });
        await tx.whatsappAccount.update({
          where: { id: account.id },
          data: { enabled: state === 'CONNECTED', lastErrorCode: code },
        });
        if (['DISCONNECTED', 'DISCONNECTING', 'ERROR'].includes(state))
          await tx.message.updateMany({
            where: { tenantId: scope.tenantId, accountId: account.id, status: 'QUEUED' },
            data: { status: 'CANCELED', errorCode: 'EVOLUTION_DISCONNECTED' },
          });
      }
      if (payload.type === 'message' || payload.type === 'receipt') {
        if (payload.verifiedPhone !== scope.expectedPhone)
          throw new EvolutionEventError('NUMBER_MISMATCH');
        if (payload.verifiedAt > now + 60000 || payload.occurredAt > now + 60000)
          throw new EvolutionEventError('EVENT_TIME', 400);
        const live =
          currentGeneration &&
          session.desiredState === 'CONNECTED' &&
          payload.verifiedAt >= now - 60000;
        // A verified message can arrive before the connection event. Its identity
        // snapshot establishes that same generation, without reviving a disconnect.
        if (live && freshSequence) {
          await tx.evolutionSession.update({
            where: { accountId: account.id },
            data: {
              state: 'CONNECTED',
              connectedWaId: payload.verifiedPhone,
              qrEncrypted: null,
              qrExpiresAt: null,
              lastSeenAt: new Date(
                Math.max(session.lastSeenAt?.getTime() ?? 0, Math.min(now, payload.verifiedAt)),
              ),
              lastErrorCode: null,
              lastEventSequence: BigInt(event.sequence),
            },
          });
          await tx.whatsappAccount.update({
            where: { id: account.id },
            data: { enabled: true, lastErrorCode: null },
          });
        }
        const existing = await tx.message.findUnique({
          where: {
            accountId_providerId: { accountId: account.id, providerId: payload.providerId },
          },
          include: { conversation: { include: { contact: true } } },
        });
        if (payload.type === 'receipt') {
          if (
            existing?.direction === 'OUTBOUND' &&
            existing.status !== 'CANCELED' &&
            existing.channelGeneration === scope.generation &&
            existing.conversation.contact.waId === payload.peer &&
            (payload.status === 'FAILED'
              ? !statusRank[existing.status]
              : (statusRank[payload.status] ?? 0) >= (statusRank[existing.status] ?? 0))
          )
            await tx.message.update({
              where: { id: existing.id },
              data: {
                status: payload.status,
                errorCode: payload.status === 'FAILED' ? 'EVOLUTION_DELIVERY_FAILED' : null,
              },
            });
        } else if (existing) {
          // Echo of a MONZO send with a preassigned provider ID is a receipt, not
          // an external human message. It must never pause its own automation.
          if (
            payload.fromMe &&
            existing.direction === 'OUTBOUND' &&
            existing.channelGeneration === scope.generation &&
            existing.conversation.contact.waId === payload.peer &&
            ['SENDING', 'UNKNOWN', 'FAILED'].includes(existing.status)
          )
            await tx.message.update({
              where: { id: existing.id },
              data: { status: 'SENT', errorCode: null },
            });
        } else {
          const at = new Date(payload.occurredAt);
          const contact = await tx.contact.upsert({
            where: {
              tenantId_accountId_waId: {
                tenantId: scope.tenantId,
                accountId: account.id,
                waId: payload.peer,
              },
            },
            create: {
              tenantId: scope.tenantId,
              accountId: account.id,
              waId: payload.peer,
              name: payload.fromMe ? undefined : payload.contactName,
            },
            update: !payload.fromMe && payload.contactName ? { name: payload.contactName } : {},
          });
          const conversation = await tx.conversation.upsert({
            where: { accountId_contactId: { accountId: account.id, contactId: contact.id } },
            create: {
              tenantId: scope.tenantId,
              accountId: account.id,
              contactId: contact.id,
              lastMessageAt: at,
              lastInboundAt: payload.fromMe ? null : at,
              automationPaused: payload.fromMe || payload.history || !live,
            },
            update: {},
          });
          const saved = await tx.message.create({
            data: {
              tenantId: scope.tenantId,
              accountId: account.id,
              conversationId: conversation.id,
              direction: payload.fromMe ? 'OUTBOUND' : 'INBOUND',
              status: payload.fromMe ? 'SENT' : 'RECEIVED',
              channelGeneration: scope.generation,
              providerId: payload.providerId,
              type: payload.messageType,
              text: payload.text,
              mediaId: payload.media?.id,
              mediaMimeType: payload.media?.mimeType,
              mediaFilename: payload.media?.filename,
              mediaSize: payload.media?.size,
              occurredAt: at,
            },
          });
          await tx.conversation.update({
            where: { id: conversation.id },
            data: {
              lastMessageAt: at > conversation.lastMessageAt ? at : conversation.lastMessageAt,
              ...(!payload.fromMe
                ? {
                    unreadCount: { increment: payload.history ? 0 : 1 },
                    lastInboundAt:
                      !conversation.lastInboundAt || at > conversation.lastInboundAt
                        ? at
                        : conversation.lastInboundAt,
                    ...(conversation.closedAt &&
                    at.getTime() >= Math.floor(conversation.closedAt.getTime() / 1000) * 1000
                      ? { status: 'OPEN', closedAt: null }
                      : {}),
                  }
                : {}),
            },
          });
          if (payload.fromMe && currentGeneration && !payload.history)
            await pauseForHuman(tx, scope.tenantId, conversation.id);
          else if (live && !payload.history && payload.messageType === 'text')
            await advanceAutomation(tx, { ...account, enabled: true }, conversation, {
              id: saved.id,
              text: payload.text ?? '',
              at,
              eventId: event.id,
            });
        }
      }
      await tx.evolutionDelivery.create({
        data: {
          id: event.id,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          generation: scope.generation,
          sequence: BigInt(event.sequence),
          digest,
        },
      });
    },
    { timeout: 15000 },
  );
  return db.message.findMany({
    where: {
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      automationEventId: event.id,
      status: 'QUEUED',
    },
    select: { id: true },
  });
}
