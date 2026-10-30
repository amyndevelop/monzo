import type { Prisma, PrismaClient } from '@prisma/client';
import { AiError, generateTestReply, type GeminiTransport } from './gemini';
import { agentSchema, defaultAgent, testSchema, type AgentForm } from './schema';
export const dayWindow = (now = Date.now()) => BigInt(Math.floor(now / 86400000) * 86400000);
export const usageKey = (tenantId: string) => `ai:day:${tenantId}`;
async function member(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  edit = false,
) {
  const row = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  if (!row || (edit && row.role === 'MEMBER'))
    throw new AiError(403, 'ACCESS', 'No tenés acceso a esta acción.');
}
export async function saveAgent(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  input: unknown,
) {
  const form = agentSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    await member(tx, tenantId, userId, true);
    const current = await tx.aiAgent.findUnique({ where: { tenantId } });
    if ((current?.revision ?? 0) !== form.revision)
      throw new AiError(
        409,
        'CONFIG_CHANGED',
        'Otra persona cambió el agente. Recargá la configuración antes de guardar; conservá tus cambios para compararlos.',
      );
    const data = { ...form, revision: form.revision + 1 };
    return current
      ? tx.aiAgent.update({ where: { tenantId }, data })
      : tx.aiAgent.create({ data: { tenantId, ...data } });
  });
}
async function consume(tx: Prisma.TransactionClient, key: string, window: bigint, limit: number) {
  const current = await tx.rateLimit.findUnique({ where: { key } });
  if (current?.lastRequest === window && current.count >= limit)
    throw new AiError(
      429,
      'LOCAL_QUOTA',
      'Alcanzaste el límite de pruebas por minuto o por día en MONZO. Esperá al próximo período o revisá el límite con un administrador.',
    );
  await tx.rateLimit.upsert({
    where: { key },
    create: { id: key, key, count: 1, lastRequest: window },
    update: { count: current?.lastRequest === window ? current.count + 1 : 1, lastRequest: window },
  });
}
export async function runAgentTest(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  input: unknown,
  transport?: GeminiTransport,
) {
  const { question } = testSchema.parse(input);
  if (!process.env.GEMINI_API_KEY?.trim())
    throw new AiError(
      503,
      'NOT_CONFIGURED',
      'Gemini todavía no está configurado. El administrador debe agregar GEMINI_API_KEY en el servidor.',
    );
  const prepared = await db.$transaction(async (tx) => {
    // All AI quota reservations share this lock, including requests from different tenants.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(60603001)::text`;
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    await member(tx, tenantId, userId);
    const agent = await tx.aiAgent.findUnique({ where: { tenantId } });
    if (!agent?.enabled)
      throw new AiError(
        409,
        'PAUSED',
        'El laboratorio está pausado. Un administrador debe guardar y habilitar el agente para probarlo.',
      );
    const now = Date.now();
    const day = dayWindow(now);
    const minute = BigInt(Math.floor(now / 60000) * 60000);
    await consume(tx, usageKey(tenantId), day, agent.dailyLimit);
    await consume(tx, 'ai:global:day', day, 100);
    await consume(tx, `ai:minute:${tenantId}`, minute, 3);
    await consume(tx, 'ai:global:minute', minute, 10);
    return agent;
  });
  const result = await generateTestReply(
    agentSchema.parse(preparedDto(prepared)),
    question,
    transport,
  );
  // Revoked access, paused agents and changed instructions invalidate late results.
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    await member(tx, tenantId, userId);
    const current = await tx.aiAgent.findUnique({ where: { tenantId } });
    if (!current?.enabled || current.revision !== prepared.revision)
      throw new AiError(
        409,
        'CONFIG_CHANGED',
        'El agente cambió o se pausó durante la consulta. No se aplicó la respuesta.',
      );
  });
  return result;
}
export function preparedDto(agent: AgentForm | null) {
  if (!agent) return defaultAgent;
  const { name, instructions, knowledge, enabled, dailyLimit, revision } = agent;
  return { name, instructions, knowledge, enabled, dailyLimit, revision };
}
