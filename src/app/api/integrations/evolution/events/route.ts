import { getDb } from '@/lib/db';
import { receiveEvolutionEvent } from '@/modules/evolution/event-request';
import { processEvolutionEvent } from '@/modules/evolution/events';
import { after } from 'next/server';
import { dispatchEvolutionAccount } from '@/modules/evolution/outbound';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  return receiveEvolutionEvent(request, {
    enabled: process.env.EVOLUTION_CHANNELS_ENABLED === 'true',
    secret: process.env.EVOLUTION_WEBHOOK_SECRET,
    process: async (event, digest) => {
      await processEvolutionEvent(getDb(), event, digest);
      after(async () => {
        try {
          await dispatchEvolutionAccount(event.scope.tenantId, event.scope.accountId);
        } catch {
          console.error('Evolution outbound scheduling deferred.');
        }
      });
    },
  });
}
