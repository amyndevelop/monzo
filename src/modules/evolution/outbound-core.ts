import type { PrismaClient } from '@prisma/client';
import { processOutbound, type EvolutionOutbox } from '../whatsapp/core/outbound';
import { evolutionCommand } from './channel-api';
import { evolutionConfiguration, type EvolutionTransport } from './core';
export function evolutionOutbox(
  config: ReturnType<typeof evolutionConfiguration>,
  origin: string,
  transport?: EvolutionTransport,
): EvolutionOutbox | null {
  if (!config.configured) return null;
  return {
    key: config.key,
    submit: (command) => evolutionCommand(config, origin, command, transport),
  };
}
export async function dispatchEvolutionQueued(
  db: PrismaClient,
  tenantId: string,
  accountId: string,
  outbox: EvolutionOutbox,
) {
  await db.message.updateMany({
    where: {
      tenantId,
      accountId,
      direction: 'OUTBOUND',
      status: 'SENDING',
      attemptedAt: { lt: new Date(Date.now() - 120000) },
      account: { provider: 'EVOLUTION' },
    },
    data: { status: 'UNKNOWN', errorCode: 'EVOLUTION_RESULT_UNKNOWN' },
  });
  const messages = await db.message.findMany({
    where: {
      tenantId,
      accountId,
      status: 'QUEUED',
      direction: 'OUTBOUND',
      account: { provider: 'EVOLUTION' },
    },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 4,
  });
  for (const message of messages)
    await processOutbound(db, message.id, undefined, undefined, outbox);
}
