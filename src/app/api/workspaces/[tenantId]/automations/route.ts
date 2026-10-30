import { apiResponse } from '@/modules/tenants/http';
import { listFlowAccounts } from '@/modules/automations/service';
export async function GET(_: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  return apiResponse(async () => listFlowAccounts((await params).tenantId));
}
