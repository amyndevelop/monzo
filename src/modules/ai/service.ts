import 'server-only';
import { getDb } from '@/lib/db';
import { requireTenantAccess } from '@/modules/access/policy';
import { idSchema, RequestError } from '@/modules/tenants/http';
import { dayWindow, usageKey, preparedDto, saveAgent, runAgentTest } from './core';
import { AiError, GEMINI_MODEL } from './gemini';
async function failure<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AiError) throw new RequestError(error.status, error.message);
    throw error;
  }
}
export async function agentStatus(tenantId: string) {
  const { membership } = await requireTenantAccess(idSchema.parse(tenantId));
  const [agent, usage] = await Promise.all([
    getDb().aiAgent.findUnique({ where: { tenantId } }),
    getDb().rateLimit.findUnique({ where: { key: usageKey(tenantId) } }),
  ]);
  const day = dayWindow();
  return {
    agent: preparedDto(agent),
    configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    model: GEMINI_MODEL,
    canEdit: membership.role !== 'MEMBER',
    used: usage?.lastRequest === day ? usage.count : 0,
    resetsAt: new Date(Number(day) + 86400000).toISOString(),
  };
}
export async function updateAgent(tenantId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER', 'ADMIN']);
  await failure(() => saveAgent(getDb(), tenantId, user.id, input));
  return agentStatus(tenantId);
}
export async function testAgent(tenantId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId));
  return failure(() => runAgentTest(getDb(), tenantId, user.id, input));
}
