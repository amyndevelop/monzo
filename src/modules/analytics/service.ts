import 'server-only';
import { getDb } from '@/lib/db';
import { requireTenantAccess } from '@/modules/access/policy';
import { idSchema, RequestError } from '@/modules/tenants/http';
import { AnalyticsError, loadAnalytics } from './core';
export async function getAnalytics(tenantId: string, input: unknown) {
  await requireTenantAccess(idSchema.parse(tenantId));
  try {
    return await loadAnalytics(getDb(), tenantId, input);
  } catch (error) {
    if (error instanceof AnalyticsError) throw new RequestError(error.status, error.message);
    throw error;
  }
}
