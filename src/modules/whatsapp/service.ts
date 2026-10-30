import 'server-only';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getDb } from '@/lib/db';
import { requireTenantAccess, AccessError } from '@/modules/access/policy';
import { RequestError, idSchema } from '@/modules/tenants/http';
import { encryptToken, whatsappConfigured } from './core/crypto';
import { verifyAndSubscribe, MetaError, authorizationFailure } from './core/meta';
import { messageFields, presentMessage } from './core/message';
import { withinWindow } from './core/payload';
import { dispatchJobs, processorMode, qstashConfigurationIssues } from './core/qstash';
const accountFields = {
  id: true,
  phoneNumberId: true,
  businessAccountId: true,
  displayPhone: true,
  displayName: true,
  enabled: true,
  verifiedAt: true,
  lastErrorCode: true,
  createdAt: true,
} as const;
export async function channelStatus(tenantId: string) {
  const { membership } = await requireTenantAccess(idSchema.parse(tenantId));
  const mode = processorMode();
  const stale = new Date(Date.now() - 120000);
  const pendingWhere = { OR: [{ jobPublishedAt: null }, { jobPublishedAt: { lt: stale } }] };
  const [accounts, heartbeat, failedEvents, pendingEvents, pendingMessages] = await Promise.all([
    getDb().whatsappAccount.findMany({
      where: { tenantId },
      select: accountFields,
      orderBy: { createdAt: 'asc' },
    }),
    getDb().workerHeartbeat.findUnique({ where: { id: 'whatsapp' } }),
    getDb().whatsappWebhookEvent.count({ where: { tenantId, state: 'FAILED' } }),
    mode === 'qstash'
      ? getDb().whatsappWebhookEvent.count({
          where: { tenantId, state: 'PENDING', ...pendingWhere },
        })
      : 0,
    mode === 'qstash'
      ? getDb().message.count({
          where: {
            tenantId,
            direction: 'OUTBOUND',
            OR: [
              { status: 'QUEUED', ...pendingWhere },
              { status: 'SENDING', attemptedAt: { lt: stale } },
            ],
          },
        })
      : 0,
  ]);
  const recent = Boolean(heartbeat && heartbeat.seenAt.getTime() > Date.now() - 45000);
  const processorIssues = mode === 'qstash' ? qstashConfigurationIssues() : [];
  return {
    accounts,
    configured: whatsappConfigured(),
    canManage: membership.role === 'OWNER',
    workerAlive: recent,
    outboundWorkerAlive: recent && Boolean(heartbeat?.outboundEnabled),
    failedEvents,
    processorMode: mode,
    processorReady:
      mode === 'qstash'
        ? processorIssues.length === 0
        : recent && Boolean(heartbeat?.outboundEnabled),
    processorIssues: membership.role === 'OWNER' ? processorIssues : [],
    pendingJobs: pendingEvents + pendingMessages,
  };
}
export async function connectAccount(tenantId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER']);
  if (!whatsappConfigured())
    throw new RequestError(
      503,
      'La integración de Meta todavía no está configurada en esta instancia.',
    );
  const data = z
    .object({
      phoneNumberId: z.string().regex(/^\d{5,30}$/),
      businessAccountId: z.string().regex(/^\d{5,30}$/),
      accessToken: z.string().trim().min(20).max(4096),
    })
    .strict()
    .parse(input);
  const previous = await getDb().whatsappAccount.findUnique({
    where: { phoneNumberId: data.phoneNumberId },
    select: { tenantId: true },
  });
  if (previous && previous.tenantId !== tenantId)
    throw new RequestError(409, 'Este número no está disponible para esta empresa.');
  let identity: { displayPhone: string; displayName: string };
  try {
    identity = await verifyAndSubscribe(
      data.businessAccountId,
      data.phoneNumberId,
      data.accessToken,
    );
  } catch (error) {
    throw new RequestError(
      502,
      error instanceof MetaError
        ? authorizationFailure(error)
        : 'No pudimos verificar la conexión con Meta.',
    );
  }
  try {
    return await getDb().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
      const actor = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: user.id } },
      });
      if (actor?.role !== 'OWNER') throw new AccessError(403);
      const current = await tx.whatsappAccount.findUnique({
        where: { phoneNumberId: data.phoneNumberId },
      });
      if (current && current.tenantId !== tenantId) throw new AccessError(403);
      const values = {
        ...identity,
        businessAccountId: data.businessAccountId,
        tokenEncrypted: encryptToken(data.accessToken, tenantId, data.phoneNumberId),
        enabled: true,
        verifiedAt: new Date(),
        lastErrorCode: null,
      };
      return current
        ? tx.whatsappAccount.update({
            where: { id: current.id },
            data: values,
            select: accountFields,
          })
        : tx.whatsappAccount.create({
            data: { tenantId, phoneNumberId: data.phoneNumberId, ...values },
            select: accountFields,
          });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new RequestError(409, 'Este número no está disponible para esta empresa.');
    throw error;
  }
}
export async function disconnectAccount(tenantId: string, accountId: string) {
  const { user } = await requireTenantAccess(tenantId, ['OWNER']);
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const actor = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
    });
    if (actor?.role !== 'OWNER') throw new AccessError(403);
    const account = await tx.whatsappAccount.findFirst({
      where: { id: idSchema.parse(accountId), tenantId },
    });
    if (!account) throw new AccessError(403);
    await tx.whatsappAccount.update({
      where: { id: account.id },
      data: { enabled: false, tokenEncrypted: null },
    });
    await tx.message.updateMany({
      where: { accountId: account.id, tenantId, status: 'QUEUED' },
      data: { status: 'CANCELED', errorCode: 'ACCOUNT_DISABLED' },
    });
    return { ok: true };
  });
}
export async function retryFailedEvents(tenantId: string) {
  await requireTenantAccess(tenantId, ['OWNER']);
  const result = await getDb().whatsappWebhookEvent.updateMany({
    where: { tenantId, state: 'FAILED', payload: { not: Prisma.DbNull } },
    data: { state: 'PENDING', errorCode: null, attempts: 0, jobPublishedAt: null },
  });
  if (processorMode() === 'qstash') await recoverPendingJobs(tenantId);
  return { queued: result.count };
}
export async function recoverPendingJobs(tenantId: string) {
  const { user } = await requireTenantAccess(tenantId, ['OWNER']);
  if (processorMode() !== 'qstash')
    throw new RequestError(409, 'Esta recuperación corresponde al procesamiento por eventos.');
  const jobs = await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const actor = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
    });
    if (actor?.role !== 'OWNER') throw new AccessError(403);
    const stale = new Date(Date.now() - 120000);
    await tx.message.updateMany({
      where: { tenantId, status: 'SENDING', attemptedAt: { lt: stale } },
      data: { status: 'UNKNOWN', errorCode: 'WORKER_INTERRUPTED' },
    });
    const pendingWhere = { OR: [{ jobPublishedAt: null }, { jobPublishedAt: { lt: stale } }] };
    const [events, messages] = await Promise.all([
      tx.whatsappWebhookEvent.findMany({
        where: { tenantId, state: 'PENDING', ...pendingWhere },
        select: { id: true },
        take: 50,
        orderBy: { createdAt: 'asc' },
      }),
      tx.message.findMany({
        where: { tenantId, status: 'QUEUED', direction: 'OUTBOUND', ...pendingWhere },
        select: { id: true },
        take: 50,
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return [
      ...events.map(({ id }) => ({ kind: 'inbox' as const, id })),
      ...messages.map(({ id }) => ({ kind: 'outbox' as const, id })),
    ];
  });
  try {
    await dispatchJobs(getDb(), jobs);
  } catch {
    throw new RequestError(
      503,
      'Los pendientes siguen guardados. Revisá la configuración y la cuota del servicio de procesamiento.',
    );
  }
  return { queued: jobs.length };
}
export async function listConversations(tenantId: string, params: URLSearchParams) {
  await requireTenantAccess(tenantId);
  const query = z
    .string()
    .max(80)
    .parse(params.get('q') ?? '');
  const status = z.enum(['OPEN', 'CLOSED', 'ALL']).parse(params.get('status') ?? 'OPEN');
  const items = await getDb().conversation.findMany({
    where: {
      tenantId,
      ...(status === 'ALL' ? {} : { status }),
      ...(query
        ? {
            contact: {
              OR: [
                { name: { contains: query, mode: 'insensitive' as const } },
                { waId: { contains: query } },
              ],
            },
          }
        : {}),
    },
    select: {
      id: true,
      status: true,
      unreadCount: true,
      lastMessageAt: true,
      lastInboundAt: true,
      assignedUserId: true,
      contact: { select: { id: true, name: true, waId: true } },
      account: { select: { id: true, displayPhone: true, enabled: true } },
      messages: {
        select: messageFields,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
      },
    },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: 101,
  });
  return {
    items: items
      .slice(0, 100)
      .map((item) => ({ ...item, messages: item.messages.map(presentMessage) })),
    hasMore: items.length > 100,
  };
}
async function scopedConversation(tenantId: string, conversationId: string) {
  const access = await requireTenantAccess(tenantId);
  const conversation = await getDb().conversation.findFirst({
    where: { id: idSchema.parse(conversationId), tenantId },
    include: {
      contact: true,
      account: { select: { id: true, enabled: true, displayPhone: true } },
    },
  });
  if (!conversation) throw new AccessError(403);
  return { ...access, conversation };
}
export async function getThread(tenantId: string, conversationId: string, before?: string) {
  const { conversation } = await scopedConversation(tenantId, conversationId);
  const cursor = before
    ? await getDb().message.findFirst({
        where: { id: idSchema.parse(before), tenantId, conversationId },
        select: { createdAt: true, id: true },
      })
    : null;
  if (before && !cursor) throw new AccessError(403);
  const [messages, notes, members] = await Promise.all([
    getDb().message.findMany({
      where: {
        tenantId,
        conversationId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: messageFields,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    }),
    getDb().conversationNote.findMany({
      where: { tenantId, conversationId },
      select: { id: true, text: true, createdAt: true, author: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    getDb().membership.findMany({
      where: { tenantId },
      select: { user: { select: { id: true, name: true } } },
      take: 100,
    }),
  ]);
  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      assignedUserId: conversation.assignedUserId,
      contact: {
        id: conversation.contact.id,
        name: conversation.contact.name,
        waId: conversation.contact.waId,
      },
      account: conversation.account,
      unreadCount: conversation.unreadCount,
    },
    messages: messages.slice(0, 50).reverse().map(presentMessage),
    hasMore: messages.length > 50,
    notes,
    members,
    replyWindowClosesAt: conversation.lastInboundAt
      ? new Date(conversation.lastInboundAt.getTime() + 86400000)
      : null,
    canReply: conversation.account.enabled && withinWindow(conversation.lastInboundAt),
  };
}
export async function enqueueMessage(tenantId: string, conversationId: string, input: unknown) {
  const { user } = await scopedConversation(tenantId, conversationId);
  const { text, idempotencyKey } = z
    .object({ text: z.string().trim().min(1).max(4096), idempotencyKey: z.uuid() })
    .strict()
    .parse(input);
  const saved = await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    if (
      !(await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: user.id } },
      }))
    )
      throw new AccessError(403);
    const existing = await tx.message.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      select: { ...messageFields, conversationId: true },
    });
    if (existing) {
      if (
        existing.conversationId !== conversationId ||
        existing.text !== text ||
        existing.type !== 'text'
      )
        throw new RequestError(409, 'La clave de envío ya se usó para otro mensaje.');
      return existing;
    }
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { account: true },
    });
    if (!conversation) throw new AccessError(403);
    if (!conversation.account.enabled || !conversation.account.tokenEncrypted)
      throw new RequestError(409, 'El canal no está habilitado para enviar.');
    if (!withinWindow(conversation.lastInboundAt))
      throw new RequestError(
        409,
        'La ventana de atención de 24 horas está cerrada. Esperá un nuevo mensaje del cliente; las plantillas se incorporarán más adelante.',
      );
    if (
      (await tx.message.count({
        where: { tenantId, direction: 'OUTBOUND', createdAt: { gt: new Date(Date.now() - 60000) } },
      })) >= 30
    )
      throw new RequestError(429, 'Alcanzaste el límite de envíos por minuto. Intentá más tarde.');
    const message = await tx.message.create({
      data: {
        tenantId,
        accountId: conversation.accountId,
        conversationId,
        direction: 'OUTBOUND',
        status: 'QUEUED',
        type: 'text',
        text,
        idempotencyKey,
        createdByUserId: user.id,
        occurredAt: new Date(),
      },
      select: messageFields,
    });
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
    return message;
  });
  if (saved.status === 'QUEUED') {
    try {
      await dispatchJobs(getDb(), [{ kind: 'outbox', id: saved.id }]);
    } catch {
      throw new RequestError(
        503,
        'El mensaje quedó guardado, pero no pudimos programar el envío. Reintentá el mismo mensaje o pedile al propietario recuperar los pendientes en Canales.',
      );
    }
  }
  return presentMessage(saved);
}
export async function updateConversation(tenantId: string, conversationId: string, input: unknown) {
  const { user } = await scopedConversation(tenantId, conversationId);
  const data = z
    .object({
      status: z.enum(['OPEN', 'CLOSED']).optional(),
      assignedUserId: idSchema.nullable().optional(),
      readThroughId: idSchema.optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0)
    .parse(input);
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const actor = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
    });
    const current = await tx.conversation.findFirst({ where: { id: conversationId, tenantId } });
    if (!actor || !current) throw new AccessError(403);
    if (data.assignedUserId !== undefined) {
      if (
        actor.role === 'MEMBER' &&
        data.assignedUserId !== user.id &&
        !(data.assignedUserId === null && current.assignedUserId === user.id)
      )
        throw new AccessError(403);
      if (
        data.assignedUserId &&
        !(await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId, userId: data.assignedUserId } },
        }))
      )
        throw new AccessError(403);
    }
    let unreadCount: number | undefined;
    if (data.readThroughId) {
      const through = await tx.message.findFirst({
        where: { id: data.readThroughId, tenantId, conversationId },
        select: { createdAt: true, id: true },
      });
      if (!through) throw new AccessError(403);
      unreadCount = await tx.message.count({
        where: {
          tenantId,
          conversationId,
          direction: 'INBOUND',
          OR: [
            { createdAt: { gt: through.createdAt } },
            { createdAt: through.createdAt, id: { gt: through.id } },
          ],
        },
      });
    }
    return tx.conversation.update({
      where: { id: conversationId },
      data: {
        ...(data.status
          ? { status: data.status, closedAt: data.status === 'CLOSED' ? new Date() : null }
          : {}),
        ...(data.assignedUserId !== undefined ? { assignedUserId: data.assignedUserId } : {}),
        ...(unreadCount !== undefined ? { unreadCount } : {}),
      },
      select: { id: true, status: true, assignedUserId: true, unreadCount: true },
    });
  });
}
export async function addNote(tenantId: string, conversationId: string, input: unknown) {
  const { user } = await scopedConversation(tenantId, conversationId);
  const { text } = z
    .object({ text: z.string().trim().min(1).max(2000) })
    .strict()
    .parse(input);
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    if (
      !(await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: user.id } },
      }))
    )
      throw new AccessError(403);
    return tx.conversationNote.create({
      data: { tenantId, conversationId, authorId: user.id, text },
      select: { id: true, text: true, createdAt: true },
    });
  });
}
export async function listContacts(tenantId: string, query: string) {
  await requireTenantAccess(tenantId);
  z.string().max(80).parse(query);
  return getDb().contact.findMany({
    where: {
      tenantId,
      ...(query
        ? {
            OR: [{ name: { contains: query, mode: 'insensitive' } }, { waId: { contains: query } }],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      waId: true,
      createdAt: true,
      account: { select: { displayPhone: true } },
      conversations: { select: { id: true, status: true, lastMessageAt: true }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
}

export async function checkAccountAuthorization(tenantId: string, accountId: string) {
  await requireTenantAccess(idSchema.parse(tenantId), ['OWNER']);
  idSchema.parse(accountId);
  const { checkSavedAuthorization } = await import('./core/authorization');
  const { consumeLimit } = await import('./core/attachments');
  const { AttachmentError } = await import('./core/media');
  try {
    await getDb().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
      await consumeLimit(
        tx,
        tenantId,
        'authorization',
        5,
        'Podés comprobar la autorización hasta 5 veces por minuto. Esperá un momento.',
      );
    });
  } catch (error) {
    if (error instanceof AttachmentError) throw new RequestError(error.status, error.message);
    throw error;
  }
  return checkSavedAuthorization(getDb(), tenantId, accountId);
}
