import type { PrismaClient } from '@prisma/client';
import { decryptToken } from './crypto';
import { MetaError, sendText, sendMedia, type MetaFetch } from './meta';
import { withinWindow } from './payload';
export async function processOutbound(db: PrismaClient, messageId: string, transport?: MetaFetch) {
  const candidate = await db.message.findUnique({
    where: { id: messageId },
    select: { tenantId: true },
  });
  if (!candidate) return;
  const claimed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${candidate.tenantId} FOR UPDATE`;
    const message = await tx.message.findUnique({
      where: { id: messageId },
      include: { account: true, conversation: { include: { contact: true } } },
    });
    if (!message || message.direction !== 'OUTBOUND' || message.status !== 'QUEUED') return null;
    const membership = message.createdByUserId
      ? await tx.membership.findUnique({
          where: {
            tenantId_userId: { tenantId: message.tenantId, userId: message.createdByUserId },
          },
        })
      : null;
    const problem = !membership
      ? 'MEMBERSHIP_REVOKED'
      : !message.account.enabled || !message.account.tokenEncrypted
        ? 'ACCOUNT_DISABLED'
        : !withinWindow(message.conversation.lastInboundAt)
          ? 'WINDOW_CLOSED'
          : message.account.lastErrorCode === 'META_190'
            ? 'CREDENTIALS_UNAVAILABLE'
            : null;
    if (problem) {
      await tx.message.update({
        where: { id: message.id },
        data: { status: 'CANCELED', errorCode: problem },
      });
      return null;
    }
    if (
      message.type !== 'text' &&
      (!['image', 'audio', 'video', 'document'].includes(message.type) || !message.mediaId)
    ) {
      await tx.message.update({
        where: { id: message.id },
        data: { status: 'FAILED', errorCode: 'MEDIA_UNAVAILABLE' },
      });
      return null;
    }
    let token: string;
    try {
      token = decryptToken(
        message.account.tokenEncrypted!,
        message.tenantId,
        message.account.phoneNumberId,
      );
    } catch {
      await tx.message.update({
        where: { id: message.id },
        data: { status: 'FAILED', errorCode: 'CREDENTIALS_UNAVAILABLE' },
      });
      return null;
    }
    await tx.message.update({
      where: { id: message.id },
      data: { status: 'SENDING', attemptedAt: new Date() },
    });
    return {
      id: message.id,
      tenantId: message.tenantId,
      accountId: message.accountId,
      phone: message.account.phoneNumberId,
      to: message.conversation.contact.waId,
      text: message.text ?? '',
      mediaId: message.mediaId,
      type: message.type,
      filename: message.mediaFilename,
      token,
      credentialVersion: message.account.tokenEncrypted!,
    };
  });
  if (!claimed) return;
  try {
    const providerId =
      claimed.type === 'text'
        ? await sendText(
            claimed.phone,
            claimed.token,
            claimed.to,
            claimed.text,
            claimed.id,
            transport,
          )
        : await sendMedia(
            claimed.phone,
            claimed.token,
            claimed.to,
            {
              type: claimed.type,
              id: claimed.mediaId!,
              filename: claimed.filename,
              caption: claimed.text,
            },
            claimed.id,
            transport,
          );
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${claimed.tenantId} FOR UPDATE`;
      const current = await tx.message.findUniqueOrThrow({ where: { id: claimed.id } });
      if (current.providerId && current.providerId !== providerId)
        throw new MetaError('RESPONSE_UNKNOWN', true);
      await tx.message.update({
        where: { id: claimed.id },
        data: {
          providerId,
          ...(['SENDING', 'UNKNOWN'].includes(current.status)
            ? { status: 'SENT', errorCode: null }
            : {}),
        },
      });
    });
  } catch (error) {
    const meta = error instanceof MetaError ? error : new MetaError('RESULT_UNKNOWN', true);
    await db.message.updateMany({
      where: { id: claimed.id, status: 'SENDING' },
      data: { status: meta.uncertain ? 'UNKNOWN' : 'FAILED', errorCode: meta.code },
    });
    if (meta.code === 'META_190')
      await db.whatsappAccount.updateMany({
        where: { id: claimed.accountId, tokenEncrypted: claimed.credentialVersion },
        data: { lastErrorCode: meta.code },
      });
  }
}
