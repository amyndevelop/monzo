import 'server-only';
import { getDb } from '@/lib/db';
import { authConfig } from '@/modules/auth/config';
import { evolutionConfiguration } from './core';
import { evolutionOutbox, dispatchEvolutionQueued } from './outbound-core';
export async function dispatchEvolutionAccount(tenantId: string, accountId: string) {
  if (process.env.EVOLUTION_CHANNELS_ENABLED !== 'true') return;
  const outbox = evolutionOutbox(evolutionConfiguration(), authConfig().origin);
  if (outbox) await dispatchEvolutionQueued(getDb(), tenantId, accountId, outbox);
}
