import { getDb } from '@/lib/db';
import { receiveEvolutionEvent } from '@/modules/evolution/event-request';
import { processEvolutionEvent } from '@/modules/evolution/events';
export const runtime = 'nodejs';
export const maxDuration = 25;
export async function POST(request: Request) {
  return receiveEvolutionEvent(request, {
    enabled: process.env.EVOLUTION_CHANNELS_ENABLED === 'true',
    secret: process.env.EVOLUTION_WEBHOOK_SECRET,
    process: (event, digest) => processEvolutionEvent(getDb(), event, digest),
  });
}
