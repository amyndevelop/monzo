import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type MessageStatus } from '@prisma/client';
import { envelopeSchema, valueSchema, providerDate } from './payload';
export async function captureWebhook(db: PrismaClient, raw: Buffer) {
  const parsed = envelopeSchema.parse(JSON.parse(raw.toString('utf8')));
  const digest = createHash('sha256').update(raw).digest('hex');
  const records: {
    tenantId: string;
    accountId: string;
    digest: string;
    payload: Prisma.InputJsonValue;
  }[] = [];
  for (const entry of parsed.entry)
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      const value = valueSchema.parse(change.value);
      const account = await db.whatsappAccount.findUnique({
        where: { phoneNumberId: value.metadata.phone_number_id },
        select: { id: true, tenantId: true, businessAccountId: true, enabled: true },
      });
      if (!account?.enabled || account.businessAccountId !== entry.id) continue;
      // Bound the work in each transaction, including when Meta batches many messages.
      // Every chunk belongs to one account; data spanning tenants is never stored together.
      const chunks = [];
      for (let i = 0; i < (value.messages?.length ?? 0); i += 25) {
        const messages = value.messages!.slice(i, i + 25);
        chunks.push({
          metadata: value.metadata,
          messages,
          contacts: value.contacts?.filter((c) => messages.some((m) => m.from === c.wa_id)) ?? [],
        });
      }
      for (let i = 0; i < (value.statuses?.length ?? 0); i += 50)
        chunks.push({ metadata: value.metadata, statuses: value.statuses!.slice(i, i + 50) });
      for (const chunk of chunks) {
        const key = createHash('sha256')
          .update(digest + JSON.stringify(chunk))
          .digest('hex');
        records.push({
          tenantId: account.tenantId,
          accountId: account.id,
          digest: key,
          payload: chunk as unknown as Prisma.InputJsonValue,
        });
      }
    }
  if (records.length)
    await db.whatsappWebhookEvent.createMany({ data: records, skipDuplicates: true });
  if (!records.length) return [];
  return db.whatsappWebhookEvent.findMany({
    where: {
      state: 'PENDING',
      OR: records.map(({ accountId, digest }) => ({ accountId, digest })),
    },
    select: { id: true },
  });
}
const statusMap: Record<string, MessageStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};
const rank: Partial<Record<MessageStatus, number>> = {
  QUEUED: 0,
  SENDING: 0,
  UNKNOWN: 0,
  FAILED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
};
export async function processWebhook(db: PrismaClient, eventId: string) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "WhatsappWebhookEvent" WHERE "id"=${eventId} FOR UPDATE`;
      const event = await tx.whatsappWebhookEvent.findUnique({
        where: { id: eventId },
        include: { account: true },
      });
      if (!event || ['DONE', 'FAILED'].includes(event.state)) return;
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${event.tenantId} FOR UPDATE`;
      const account = await tx.whatsappAccount.findUniqueOrThrow({
        where: { id: event.accountId },
      });
      if (account.enabled) {
        const value = valueSchema.parse(event.payload);
        for (const message of value.messages ?? []) {
          const duplicate = await tx.message.findUnique({
            where: { accountId_providerId: { accountId: account.id, providerId: message.id } },
            select: { id: true },
          });
          if (duplicate) continue;
          const date = providerDate(message.timestamp);
          const profile = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name;
          const contact = await tx.contact.upsert({
            where: {
              tenantId_accountId_waId: {
                tenantId: event.tenantId,
                accountId: account.id,
                waId: message.from,
              },
            },
            create: {
              tenantId: event.tenantId,
              accountId: account.id,
              waId: message.from,
              name: profile,
            },
            update: profile ? { name: profile } : {},
          });
          const conversation = await tx.conversation.upsert({
            where: { accountId_contactId: { accountId: account.id, contactId: contact.id } },
            create: {
              tenantId: event.tenantId,
              accountId: account.id,
              contactId: contact.id,
              lastMessageAt: date,
              lastInboundAt: date,
            },
            update: {},
          });
          const media =
            message.image ?? message.audio ?? message.video ?? message.document ?? message.sticker;
          await tx.message.create({
            data: {
              tenantId: event.tenantId,
              accountId: account.id,
              conversationId: conversation.id,
              direction: 'INBOUND',
              status: 'RECEIVED',
              type: message.type,
              text:
                message.text?.body ??
                media?.caption ??
                message.button?.text ??
                message.interactive?.button_reply?.title ??
                message.interactive?.list_reply?.title,
              mediaId: media?.id,
              mediaMimeType: media?.mime_type,
              mediaFilename: media?.filename,
              mediaSha256: media?.sha256,
              providerId: message.id,
              occurredAt: date,
            },
          });
          await tx.conversation.update({
            where: { id: conversation.id },
            data: {
              unreadCount: { increment: 1 },
              lastMessageAt: date > conversation.lastMessageAt ? date : conversation.lastMessageAt,
              lastInboundAt:
                !conversation.lastInboundAt || date > conversation.lastInboundAt
                  ? date
                  : conversation.lastInboundAt,
              // Meta timestamps have second precision, while our close time has milliseconds.
              ...(conversation.closedAt &&
              date.getTime() >= Math.floor(conversation.closedAt.getTime() / 1000) * 1000
                ? { status: 'OPEN', closedAt: null }
                : {}),
            },
          });
        }
        for (const receipt of value.statuses ?? []) {
          const next = statusMap[receipt.status];
          if (!next) continue;
          providerDate(receipt.timestamp);
          const message = await tx.message.findFirst({
            where: {
              accountId: account.id,
              tenantId: event.tenantId,
              direction: 'OUTBOUND',
              OR: [
                { providerId: receipt.id },
                ...(receipt.biz_opaque_callback_data
                  ? [{ id: receipt.biz_opaque_callback_data }]
                  : []),
              ],
            },
          });
          if (
            !message ||
            message.status === 'CANCELED' ||
            (message.providerId && message.providerId !== receipt.id)
          )
            continue;
          if (next === 'FAILED' && (rank[message.status] ?? 0) >= 1) continue;
          if (next !== 'FAILED' && (rank[next] ?? 0) < (rank[message.status] ?? 0)) continue;
          await tx.message.update({
            where: { id: message.id },
            data: {
              providerId: receipt.id,
              status: next,
              errorCode:
                next === 'FAILED' ? `META_${receipt.errors?.[0]?.code ?? 'DELIVERY_FAILED'}` : null,
            },
          });
        }
      }
      await tx.whatsappWebhookEvent.update({
        where: { id: event.id },
        data: {
          state: 'DONE',
          payload: Prisma.DbNull,
          errorCode: account.enabled ? null : 'ACCOUNT_DISABLED',
          processedAt: new Date(),
        },
      });
    },
    { timeout: 15000 },
  );
}
