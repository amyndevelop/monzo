import { pauseForHuman } from '../../automations/runtime';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { decryptToken } from './crypto';
import { readTemplateSnapshot } from './template-schema';
import { withinWindow } from './payload';
import {
  AttachmentError,
  inspectMedia,
  uploadMedia,
  downloadMedia,
  type MediaFetch,
} from './media';

export async function attachmentContext(
  db: Pick<PrismaClient, 'membership' | 'conversation'>,
  tenantId: string,
  userId: string,
  conversationId: string,
) {
  const member = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
  });
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { account: true },
  });
  if (!member || !conversation)
    throw new AttachmentError(403, 'ACCESS', 'No tenés acceso a esta conversación.');
  return conversation;
}
function assertSendable(conversation: Awaited<ReturnType<typeof attachmentContext>>) {
  if (
    !conversation.account.enabled ||
    !conversation.account.tokenEncrypted ||
    conversation.account.lastErrorCode === 'META_190'
  )
    throw new AttachmentError(
      409,
      'ACCOUNT_DISABLED',
      'El canal necesita una autorización válida para enviar.',
    );
  if (!withinWindow(conversation.lastInboundAt))
    throw new AttachmentError(
      409,
      'WINDOW_CLOSED',
      'La ventana de 24 horas está cerrada. Esperá un nuevo mensaje del cliente.',
    );
}
export async function consumeLimit(
  tx: Prisma.TransactionClient,
  tenantId: string,
  name: string,
  limit: number,
  message = 'Alcanzaste el límite de archivos por minuto. Intentá más tarde.',
) {
  const minute = BigInt(Math.floor(Date.now() / 60000) * 60000);
  const key = `whatsapp-media:${name}:${tenantId}`;
  const previous = await tx.rateLimit.findUnique({ where: { key } });
  if (previous && previous.lastRequest === minute && previous.count >= limit)
    throw new AttachmentError(429, 'MEDIA_RATE_LIMIT', message);
  await tx.rateLimit.upsert({
    where: { key },
    create: { id: key, key, count: 1, lastRequest: minute },
    update: {
      count: previous?.lastRequest === minute ? previous.count + 1 : 1,
      lastRequest: minute,
    },
  });
}
export async function enqueueAttachment(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  conversationId: string,
  input: { bytes: Uint8Array; filename: string; text: string; idempotencyKey: string },
  transport?: MediaFetch,
) {
  const { idempotencyKey, text } = z
    .object({ idempotencyKey: z.uuid(), text: z.string().trim().max(1024) })
    .parse(input);
  const file = await inspectMedia(input.bytes, input.filename, false);
  if (file.kind === 'audio' && text)
    throw new AttachmentError(
      400,
      'AUDIO_CAPTION',
      'Los audios se envían sin texto. Enviá el texto como un mensaje separado.',
    );
  const existing = async (tx: Prisma.TransactionClient) => {
    const message = await tx.message.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
    });
    if (
      message &&
      (message.conversationId !== conversationId ||
        message.type !== file.kind ||
        message.mediaSha256 !== file.sha256 ||
        message.mediaFilename !== file.filename ||
        (message.text ?? '') !== text)
    )
      throw new AttachmentError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'La clave de envío ya se usó para otro mensaje.',
      );
    return message;
  };
  const prepared = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const conversation = await attachmentContext(tx, tenantId, userId, conversationId);
    const found = await existing(tx);
    if (found) return { found, conversation };
    assertSendable(conversation);
    await consumeLimit(tx, tenantId, 'upload', 10);
    return { found: null, conversation };
  });
  if (prepared.found) return prepared.found;
  const account = prepared.conversation.account;
  let token: string;
  try {
    token = decryptToken(account.tokenEncrypted!, tenantId, account.phoneNumberId);
  } catch {
    throw new AttachmentError(
      409,
      'CREDENTIALS_UNAVAILABLE',
      'El canal necesita volver a autorizarse en Canales.',
    );
  }
  const mediaId = await uploadMedia(account.phoneNumberId, token, input.bytes, file, transport);
  // No DB lock is held across the HTTP upload. Recheck revocation, channel and window.
  // Concurrent uploads may leave an unused provider file, but create at most one message.
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const conversation = await attachmentContext(tx, tenantId, userId, conversationId);
    const found = await existing(tx);
    if (found) return found;
    assertSendable(conversation);
    if (
      (await tx.message.count({
        where: { tenantId, direction: 'OUTBOUND', createdAt: { gt: new Date(Date.now() - 60000) } },
      })) >= 30
    )
      throw new AttachmentError(
        429,
        'SEND_RATE_LIMIT',
        'Alcanzaste el límite de envíos por minuto. Intentá más tarde.',
      );
    await pauseForHuman(tx, tenantId, conversationId);
    const message = await tx.message.create({
      data: {
        tenantId,
        accountId: account.id,
        conversationId,
        direction: 'OUTBOUND',
        status: 'QUEUED',
        type: file.kind,
        text: text || null,
        mediaId,
        mediaMimeType: file.mime,
        mediaFilename: file.filename,
        mediaSize: file.size,
        mediaSha256: file.sha256,
        idempotencyKey,
        createdByUserId: userId,
        occurredAt: new Date(),
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
    return message;
  });
}
export async function readAttachment(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  messageId: string,
  transport?: MediaFetch,
) {
  const message = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    if (!(await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } })))
      throw new AttachmentError(403, 'ACCESS', 'No tenés acceso a este archivo.');
    const found = await tx.message.findFirst({
      where: { id: messageId, tenantId },
      include: { account: true },
    });
    if (!found) throw new AttachmentError(403, 'ACCESS', 'No tenés acceso a este archivo.');
    if (!found.mediaId)
      throw new AttachmentError(
        404,
        'MEDIA_MISSING',
        'Este mensaje no tiene un archivo disponible.',
      );
    if (!found.account.enabled || !found.account.tokenEncrypted)
      throw new AttachmentError(
        409,
        'ACCOUNT_DISABLED',
        'El canal necesita estar autorizado para abrir este archivo.',
      );
    await consumeLimit(tx, tenantId, 'download', 60);
    return found;
  });
  let token: string;
  try {
    token = decryptToken(message.account.tokenEncrypted!, tenantId, message.account.phoneNumberId);
  } catch {
    throw new AttachmentError(
      409,
      'CREDENTIALS_UNAVAILABLE',
      'El canal necesita volver a autorizarse en Canales.',
    );
  }
  const file = await downloadMedia(
    message.account.phoneNumberId,
    token,
    message.mediaId!,
    message.mediaFilename,
    message.type === 'template'
      ? (readTemplateSnapshot(message.templateSnapshot)?.media?.kind ?? 'unknown')
      : message.type,
    message.mediaSha256,
    transport,
  );
  // Do not disclose bytes if access was revoked while Meta was serving the file.
  const [member, account] = await Promise.all([
    db.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } }),
    db.whatsappAccount.findFirst({ where: { id: message.accountId, tenantId, enabled: true } }),
  ]);
  if (!member || !account?.tokenEncrypted)
    throw new AttachmentError(403, 'ACCESS', 'No tenés acceso a este archivo.');
  return file;
}
