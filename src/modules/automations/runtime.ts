import type { Prisma, WhatsappAccount, Conversation } from '@prisma/client';
import {
  captureAnswer,
  renderFlowText,
  resolveConditions,
  flowSchema,
  flowIssues,
  normalize,
  stateSchema,
  choiceId,
  type FlowSnapshot,
} from './definition';
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
  const variables = state && !restart ? { ...state.variables } : {};
  let node = graph.nodes.find((n) => n.id === (state && !restart ? state.nodeId : graph.start))!;
  let misses = 0;
  let hint = '';
  if (state?.status === 'waiting' && !restart && node?.kind === 'capture') {
    const answer = captureAnswer(incoming.text, incoming.choice);
    if (answer) {
      variables[node.variable!] = answer;
      node = graph.nodes.find((n) => n.id === node.options[0].next)!;
    } else {
      misses = state.misses + 1;
      hint = 'Respondé con un texto de hasta 120 caracteres, sin saltos de línea.\n\n';
      if (misses >= 3)
        node = {
          id: 'ayuda',
          label: 'Atención humana',
          kind: 'handoff',
          text: 'Un integrante del equipo continuará la atención.',
          options: [],
        };
    }
  } else if (state?.status === 'waiting' && !restart && node?.kind === 'menu') {
    const option = node.options.find((o, index) =>
      incoming.choice
        ? incoming.choice ===
          choiceId(flow.id, flow.publishedVersion, conversation.automationGeneration, node.id, o.id)
        : normalize(incoming.text) === String(index + 1) ||
          normalize(incoming.text) === normalize(o.label),
    );
    if (option) node = graph.nodes.find((n) => n.id === option.next)!;
    else {
      misses = state.misses + 1;
      hint = 'Elegí una opción del menú para continuar.\n\n';
      if (misses >= 3)
        node = {
          id: 'ayuda',
          label: 'Atención humana',
          kind: 'handoff',
          text: 'No pudimos reconocer tu elección. Un integrante del equipo continuará la atención.',
          options: [],
        };
    }
  }
  if (!node) {
    await pauseForHuman(tx, account.tenantId, conversation.id);
    return;
  }
  if (node.kind === 'condition') node = resolveConditions(graph, node.id, variables);
  const rendered = renderFlowText(node.text, variables);
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
  if (tenantCount >= 30 || conversationCount >= 6) {
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
    node.kind === 'message'
      ? `${rendered}\n\nEscribí MENÚ para volver al inicio.`
      : (['menu', 'capture'].includes(node.kind) ? hint : '') + rendered;
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
        status: ['menu', 'capture'].includes(node.kind)
          ? 'waiting'
          : node.kind === 'handoff'
            ? 'handoff'
            : 'completed',
        misses,
        variables,
      },
    },
  });
}
