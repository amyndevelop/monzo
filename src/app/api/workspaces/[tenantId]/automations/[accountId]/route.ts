import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { getFlow, changeFlow } from '@/modules/automations/service';
type Context = { params: Promise<{ tenantId: string; accountId: string }> };
export async function GET(_: Request, { params }: Context) {
  return apiResponse(async () => {
    const { tenantId, accountId } = await params;
    return getFlow(tenantId, accountId);
  });
}
export async function POST(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId, accountId } = await params;
    return changeFlow(tenantId, accountId, await readJson(request, 180000));
  });
}
