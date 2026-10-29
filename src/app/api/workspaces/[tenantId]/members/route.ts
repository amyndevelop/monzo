import { apiResponse } from '@/modules/tenants/http';
import { listMembers } from '@/modules/tenants/service';
export async function GET(_: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  return apiResponse(async () => listMembers((await params).tenantId));
}
