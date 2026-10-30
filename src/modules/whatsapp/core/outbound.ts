import type { PrismaClient } from '@prisma/client';
import { snapshotSchema, interactivePayload } from '../../automations/definition';
import { decryptToken } from './crypto';
import {
  MetaError,
  sendText,
  sendMedia,
  sendTemplate,
  sendInteractive,
  type MetaFetch,
} from './meta';
import { withinWindow } from './payload';
import { checkQueuedTemplate, templateComponents } from './templates';
export async function processOutbound(db: PrismaClient, messageId: string, transport?: MetaFetch) {
  const candidate = await db.message.findUnique({
    where: { id: messageId },
    select: { tenantId: true, type: true },
  });
  if (!candidate) return;
  const checkedTemplate =
    candidate.type === 'template' ? await checkQueuedTemplate(db, messageId, transport) : null;
  if (candidate.type === 'template' && !checkedTemplate) return;
  const claimed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${candidate.tenantId} FOR UPDATE`;
    const message = await tx.message.findUnique({
      where: { id: messageId },
      include: { account: true, template: true, conversation: { include: { contact: true } } },
    });
    if (!message || message.direction !== 'OUTBOUND' || message.status !== 'QUEUED') return null;
    const membership = message.createdByUserId
      ? await tx.membership.findUnique({
          where: {
            tenantId_userId: { tenantId: message.tenantId, userId: message.createdByUserId },
          },
        })
      : null;
    const snapshot = message.automationFlowId
      ? snapshotSchema.safeParse(message.automationSnapshot)
      : null;
    const flow = message.automationFlowId
      ? await tx.automationFlow.findFirst({
          where: {
            id: message.automationFlowId,
            accountId: message.accountId,
            tenantId: message.tenantId,
          },
        })
      : null;
    const automationProblem =
      message.automationFlowId &&
      (!snapshot?.success ||
        !flow?.enabled ||
        snapshot.data.flowId !== flow.id ||
        flow.publishedVersion !== snapshot.data.publishedVersion ||
        message.conversation.automationPaused ||
        message.conversation.assignedUserId ||
        message.conversation.automationGeneration !== snapshot.data.generation ||
        flow.publishedByUserId !== message.createdByUserId ||
        membership?.role === 'MEMBER')
        ? 'AUTOMATION_PAUSED'
        : null;
    const problem = !membership
      ? 'MEMBERSHIP_REVOKED'
      : !message.account.enabled || !message.account.tokenEncrypted
        ? 'ACCOUNT_DISABLED'
        : message.type !== 'template' && !withinWindow(message.conversation.lastInboundAt)
          ? 'WINDOW_CLOSED'
          : message.account.lastErrorCode === 'META_190'
            ? 'CREDENTIALS_UNAVAILABLE'
            : null;
    const templateProblem =
      message.type === 'template' &&
      (!checkedTemplate ||
        checkedTemplate.credentialVersion !== message.account.tokenEncrypted ||
        checkedTemplate.snapshot.businessAccountId !== message.account.businessAccountId ||
        message.templateId !== checkedTemplate.snapshot.templateId ||
        message.template?.definitionHash !== checkedTemplate.snapshot.definitionHash ||
        message.template.status !== 'APPROVED')
        ? 'TEMPLATE_CHANGED'
        : null;
    if (problem || templateProblem || automationProblem) {
      await tx.message.update({
        where: { id: message.id },
        data: { status: 'CANCELED', errorCode: problem ?? templateProblem ?? automationProblem },
      });
      return null;
    }
    if (
      message.type !== 'text' &&
      message.type !== 'template' &&
      !(message.type === 'interactive' && snapshot?.success && snapshot.data.kind === 'menu') &&
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
      automation: snapshot?.success ? snapshot.data : null,
    };
  });
  if (!claimed) return;
  try {
    const providerId =
      claimed.type === 'interactive' && claimed.automation
        ? await sendInteractive(
            claimed.phone,
            claimed.token,
            claimed.to,
            interactivePayload(claimed.automation),
            claimed.id,
            transport,
          )
        : claimed.type === 'text'
          ? await sendText(
              claimed.phone,
              claimed.token,
              claimed.to,
              claimed.text,
              claimed.id,
              transport,
            )
          : claimed.type === 'template' && checkedTemplate
            ? await sendTemplate(
                claimed.phone,
                claimed.token,
                claimed.to,
                {
                  name: checkedTemplate.snapshot.definition.name,
                  language: checkedTemplate.snapshot.definition.language,
                  components: templateComponents(checkedTemplate.snapshot),
                },
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
