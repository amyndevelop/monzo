import type { Prisma, WhatsappAccount, Conversation } from '@prisma/client';
import {
  flowSchema,
  flowIssues,
  normalize,
  stateSchema,
  choiceId,
  type FlowSnapshot,
} from './definition';
import { advanceFlow } from './engine';
import { withinWindow } from '../whatsapp/core/payload';

// Call under the Tenant row lock. Never performs HTTP or schedules work in a transaction.
export async function pauseForHuman(
  tx: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
) {
  await tx.conversation.updateMany({
    where: { id: conversationId, tenantId },
    data: { automationPaused: true, automationGeneration: { increment: 1 } },
  });
  await tx.message.updateMany({
    where: { tenantId, conversationId, automationFlowId: { not: null }, status: 'QUEUED' },
    data: { status: 'CANCELED', errorCode: 'AUTOMATION_PAUSED' },
  });
}
export async function advanceAutomation(
  tx: Prisma.TransactionClient,
  account: WhatsappAccount,
  conversation: Conversation,
  incoming: { id: string; text: string; choice?: string; at: Date; eventId: string },
) {
  if (
    conversation.automationPaused ||
    conversation.assignedUserId ||
    !account.enabled ||
    !account.tokenEncrypted ||
    account.lastErrorCode === 'META_190' ||
    !withinWindow(incoming.at) ||
    (conversation.lastInboundAt && incoming.at < conversation.lastInboundAt)
  )
    return;
  const flow = await tx.automationFlow.findUnique({ where: { accountId: account.id } });
  if (
    !flow?.enabled ||
    !flow.published ||
    !flow.publishedByUserId ||
    !flow.activatedAt ||
    incoming.at.getTime() < Math.floor(flow.activatedAt.getTime() / 1000) * 1000
  )
    return;
  const actor = await tx.membership.findUnique({
    where: { tenantId_userId: { tenantId: account.tenantId, userId: flow.publishedByUserId } },
  });
  if (!actor || actor.role === 'MEMBER') return;
  const parsed = flowSchema.safeParse(flow.published);
  if (!parsed.success || flowIssues(parsed.data).length) {
    await pauseForHuman(tx, account.tenantId, conversation.id);
    return;
  }
  const graph = parsed.data;
  const decoded = stateSchema.safeParse(conversation.automationState);
  let state =
    decoded.success &&
    decoded.data.flowId === flow.id &&
    decoded.data.version === flow.publishedVersion
      ? decoded.data
      : null;
  // Handoff is sticky. Only an explicit operator action can resume it.
  if (state?.status === 'handoff' || state?.status === 'blocked') return;
  if (conversation.lastInboundAt && !withinWindow(conversation.lastInboundAt)) state = null;
  const restart = ['menu', 'inicio'].includes(normalize(incoming.text));
  if (state?.status === 'completed' && !restart) return;
  const currentNode = graph.nodes.find((n) => n.id === state?.nodeId);
  const option =
    incoming.choice && currentNode?.kind === 'menu'
      ? currentNode.options.find(
          (o) =>
            incoming.choice ===
            choiceId(
              flow.id,
              flow.publishedVersion,
              conversation.automationGeneration,
              currentNode.id,
              o.id,
            ),
        )
      : undefined;
  const result = advanceFlow(graph, state, {
    text: incoming.text,
    optionId: option?.id,
    invalidChoice: Boolean(incoming.choice && !option),
  });
  const { node, variables, misses } = result;
  const [tenantCount, conversationCount] = await Promise.all([
    tx.message.count({
      where: {
        tenantId: account.tenantId,
        direction: 'OUTBOUND',
        createdAt: { gt: new Date(Date.now() - 60000) },
      },
    }),
    tx.message.count({
      where: {
        tenantId: account.tenantId,
        conversationId: conversation.id,
        automationFlowId: { not: null },
        createdAt: { gt: new Date(Date.now() - 60000) },
      },
    }),
  ]);
  if (tenantCount >= 30 || conversationCount >= (graph.schemaVersion === 2 ? 20 : 6)) {
    await pauseForHuman(tx, account.tenantId, conversation.id);
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        automationState: {
          flowId: flow.id,
          version: flow.publishedVersion,
          nodeId: node.id,
          status: 'blocked',
          variables,
          misses,
          reason:
            'Se alcanzó el límite de respuestas automáticas. Revisá la conversación antes de reanudar.',
        },
      },
    });
    return;
  }
  const generation = conversation.automationGeneration + 1;
  const text =
    node.kind === 'message' ? `${result.text}\n\nEscribí MENÚ para volver al inicio.` : result.text;
  const snapshot: FlowSnapshot = {
    version: 1,
    flowId: flow.id,
    publishedVersion: flow.publishedVersion,
    generation,
    nodeId: node.id,
    kind: node.kind,
    text,
    choices:
      node.kind === 'menu'
        ? node.options.map((o) => ({
            id: choiceId(flow.id, flow.publishedVersion, generation, node.id, o.id),
            label: o.label,
          }))
        : [],
  };
  await tx.message.updateMany({
    where: {
      tenantId: account.tenantId,
      conversationId: conversation.id,
      automationFlowId: { not: null },
      status: 'QUEUED',
    },
    data: { status: 'CANCELED', errorCode: 'AUTOMATION_ADVANCED' },
  });
  await tx.message.create({
    data: {
      tenantId: account.tenantId,
      accountId: account.id,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      type: node.kind === 'menu' ? 'interactive' : 'text',
      text:
        node.kind === 'menu'
          ? text + '\n' + snapshot.choices.map((o, i) => `${i + 1}. ${o.label}`).join('\n')
          : text,
      createdByUserId: flow.publishedByUserId,
      automationFlowId: flow.id,
      automationSourceId: incoming.id,
      automationEventId: incoming.eventId,
      automationSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      occurredAt: new Date(),
    },
  });
  await tx.conversation.update({
    where: { id: conversation.id },
    data: {
      automationGeneration: generation,
      lastMessageAt: new Date(),
      automationState: {
        flowId: flow.id,
        version: flow.publishedVersion,
        nodeId: node.id,
        status: result.status,
        turns: result.turns,
        runId: result.runId,
        ...(result.reason ? { reason: result.reason } : {}),
        misses,
        variables,
      },
    },
  });
}
