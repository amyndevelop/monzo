import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { agentStatus, updateAgent } from '@/modules/ai/service';
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(_: Request, { params }: Context) {
  return apiResponse(async () => agentStatus((await params).tenantId));
}
export async function PUT(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return updateAgent((await params).tenantId, await readJson(request, 65536));
  });
}
