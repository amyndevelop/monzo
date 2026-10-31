import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { flowSchema, flowIssues, effectiveVariables, type FlowGraph } from './definition';
import { variableDefinition } from './variable-registry';
import { pauseForHuman } from './runtime';
import { FlowError } from './errors';
export { FlowError } from './errors';
const revision = z.number().int().min(0);
export const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), revision, graph: flowSchema }).strict(),
  z.object({ action: z.enum(['publish', 'pause', 'enable']), revision }).strict(),
]);
export async function mutateFlow(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  accountId: string,
  input: unknown,
) {
  const data = mutationSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const member = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    const account = await tx.whatsappAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!member || member.role === 'MEMBER' || !account)
      throw new FlowError(403, 'No tenés acceso para editar este flujo.');
    const flow = await tx.automationFlow.findUnique({ where: { accountId } });
    if ((flow?.revision ?? 0) !== data.revision)
      throw new FlowError(
        409,
        'El flujo cambió en otra sesión. Recargá su versión antes de guardar; tu borrador sigue en pantalla.',
      );
    async function compile(graph: FlowGraph) {
      if (!graph.variables)
        for (const def of effectiveVariables(graph))
          await tx.automationVariable.upsert({
            where: { tenantId_identifier: { tenantId, identifier: def.identifier } },
            create: { tenantId, ...def },
            update: {},
          });
      const variables = (
        await tx.automationVariable.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })
      ).map(variableDefinition);
      if (variables.length > 100)
        throw new FlowError(409, 'El máximo es de 100 variables por empresa.');
      return { ...graph, variables };
    }
    if (data.action === 'save') {
      const draft = (await compile(data.graph)) as unknown as Prisma.InputJsonValue;
      return flow
        ? tx.automationFlow.update({
            where: { id: flow.id },
            data: { draft, revision: { increment: 1 } },
          })
        : tx.automationFlow.create({ data: { tenantId, accountId, draft } });
    }
    if (!flow) throw new FlowError(409, 'Guardá primero un borrador del flujo.');
    let published: FlowGraph | undefined;
    if (data.action !== 'pause') {
      if (!account.enabled || !account.tokenEncrypted || account.lastErrorCode === 'META_190')
        throw new FlowError(409, 'Autorizá el número en Canales antes de activar el flujo.');
      if (data.action === 'enable' && !flow.published)
        throw new FlowError(409, 'Publicá un borrador antes de activar el flujo.');
      const source = flowSchema.parse(data.action === 'publish' ? flow.draft : flow.published);
      const graph = data.action === 'publish' ? await compile(source) : source;
      if (data.action === 'publish') published = graph;
      const issues = flowIssues(graph);
      if (issues.length) throw new FlowError(409, issues.join(' '));
    }
    await tx.message.updateMany({
      where: { tenantId, automationFlowId: flow.id, status: 'QUEUED' },
      data: { status: 'CANCELED', errorCode: 'AUTOMATION_CHANGED' },
    });
    return tx.automationFlow.update({
      where: { id: flow.id },
      data: {
        revision: { increment: 1 },
        enabled: data.action !== 'pause',
        publishedVersion: { increment: 1 },
        ...(data.action === 'publish'
          ? { published: published as unknown as Prisma.InputJsonValue, publishedByUserId: userId }
          : {}),
        ...(data.action === 'enable' ? { publishedByUserId: userId } : {}),
        ...(data.action !== 'pause' ? { activatedAt: new Date() } : {}),
      },
    });
  });
}
export async function controlConversation(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  conversationId: string,
  action: 'pause' | 'resume',
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const member = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!member || !conversation) throw new FlowError(403, 'No tenés acceso a esta conversación.');
    if (action === 'pause') {
      await pauseForHuman(tx, tenantId, conversationId);
      return { ok: true };
    }
    const flow = await tx.automationFlow.findUnique({
      where: { accountId: conversation.accountId },
    });
    const account = await tx.whatsappAccount.findFirst({
      where: { id: conversation.accountId, tenantId },
    });
    if (!account?.enabled || !account.tokenEncrypted || account.lastErrorCode === 'META_190')
      throw new FlowError(409, 'Autorizá el canal en Canales antes de reanudar el flujo.');
    if (!flow?.enabled)
      throw new FlowError(409, 'Publicá y activá un flujo para este número antes de reanudar.');
    const publisher = flow.publishedByUserId
      ? await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId, userId: flow.publishedByUserId } },
        })
      : null;
    if (!publisher || publisher.role === 'MEMBER')
      throw new FlowError(
        409,
        'Un administrador actual debe volver a publicar el flujo antes de reanudar.',
      );
    if (conversation.assignedUserId)
      throw new FlowError(409, 'Quitá la asignación del operador antes de reanudar el flujo.');
    if (conversation.status !== 'OPEN')
      throw new FlowError(409, 'Reabrí la conversación antes de reanudar el flujo.');
    await pauseForHuman(tx, tenantId, conversationId);
    await tx.conversation.update({
      where: { id: conversationId },
      data: { automationPaused: false, automationState: Prisma.DbNull },
    });
    return { ok: true };
  });
}
