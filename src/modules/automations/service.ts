import 'server-only';
import { registryRows, mutateVariable } from './variable-registry';
import { variableDefinition } from './variable-registry';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { requireTenantAccess } from '@/modules/access/policy';
import { idSchema, RequestError } from '@/modules/tenants/http';
import { mutateFlow, controlConversation, FlowError, mutationSchema } from './core';
import { processorMode, qstashConfigured } from '@/modules/whatsapp/core/qstash';
export async function listFlowAccounts(tenantId: string) {
  const { membership } = await requireTenantAccess(idSchema.parse(tenantId));
  const accounts = await getDb().whatsappAccount.findMany({
    where: { tenantId },
    select: {
      id: true,
      displayPhone: true,
      displayName: true,
      enabled: true,
      automationFlow: { select: { enabled: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return { accounts, canEdit: membership.role !== 'MEMBER' };
}
export async function getFlow(tenantId: string, accountId: string) {
  const { membership } = await requireTenantAccess(idSchema.parse(tenantId));
  const account = await getDb().whatsappAccount.findFirst({
    where: { id: idSchema.parse(accountId), tenantId },
    select: { id: true, enabled: true, tokenEncrypted: true, lastErrorCode: true },
  });
  if (!account) throw new RequestError(403, 'No tenés acceso a este número.');
  const flow = await getDb().automationFlow.findUnique({ where: { accountId } });
  const heartbeat =
    processorMode() === 'bullmq'
      ? await getDb().workerHeartbeat.findUnique({ where: { id: 'whatsapp' } })
      : null;
  const publisher = flow?.publishedByUserId
    ? await getDb().membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: flow.publishedByUserId } },
        select: { role: true },
      })
    : null;
  return {
    variables: (
      await getDb().automationVariable.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      })
    ).map(variableDefinition),
    flow: flow
      ? {
          draft: flow.draft,
          published: flow.published,
          revision: flow.revision,
          publishedVersion: flow.publishedVersion,
          enabled: flow.enabled,
        }
      : null,
    runtimeIssue:
      flow?.enabled && (!publisher || publisher.role === 'MEMBER')
        ? 'El administrador que publicó ya no tiene permiso. Un administrador actual debe volver a publicar el flujo.'
        : null,
    canEdit: membership.role !== 'MEMBER',
    channelReady:
      account.enabled && Boolean(account.tokenEncrypted) && account.lastErrorCode !== 'META_190',
    processorReady:
      processorMode() === 'qstash'
        ? qstashConfigured()
        : Boolean(heartbeat?.outboundEnabled && heartbeat.seenAt > new Date(Date.now() - 45000)),
  };
}
async function failure<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FlowError) throw new RequestError(error.status, error.message);
    throw error;
  }
}
export async function changeFlow(tenantId: string, accountId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER', 'ADMIN']);
  idSchema.parse(accountId);
  const data = mutationSchema.parse(input);
  if (['publish', 'enable'].includes(data.action)) {
    const status = await getFlow(tenantId, accountId);
    if (!status.processorReady)
      throw new RequestError(
        409,
        'El procesamiento de mensajes está en pausa. Revisalo en Canales antes de activar el flujo.',
      );
  }
  await failure(() => mutateFlow(getDb(), tenantId, user.id, accountId, data));
  return getFlow(tenantId, accountId);
}
export async function changeConversationFlow(
  tenantId: string,
  conversationId: string,
  input: unknown,
) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId));
  const { action } = z
    .object({ action: z.enum(['pause', 'resume']) })
    .strict()
    .parse(input);
  return failure(() =>
    controlConversation(getDb(), tenantId, user.id, idSchema.parse(conversationId), action),
  );
}

export async function getVariables(tenantId: string) {
  const { membership } = await requireTenantAccess(idSchema.parse(tenantId));
  return {
    variables: await registryRows(getDb(), tenantId),
    canEdit: membership.role !== 'MEMBER',
  };
}
export async function changeVariable(tenantId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER', 'ADMIN']);
  const result = await failure(() => mutateVariable(getDb(), tenantId, user.id, input));
  return {
    ...(await getVariables(tenantId)),
    ...((input as { action?: string })?.action === 'example' ? { example: result } : {}),
  };
}
