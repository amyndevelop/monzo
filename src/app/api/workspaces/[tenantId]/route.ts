import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { getWorkspace, updateSettings } from '@/modules/tenants/service';
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(_: Request, { params }: Context) {
  return apiResponse(async () => getWorkspace((await params).tenantId));
}
export async function PATCH(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return updateSettings((await params).tenantId, await readJson(request));
  });
}
