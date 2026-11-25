import { evolutionProbe } from '@/modules/evolution/probe';
export const runtime = 'nodejs';
export const maxDuration = 10;
export async function POST(request: Request) {
  return evolutionProbe(request, process.env.EVOLUTION_WEBHOOK_SECRET);
}
