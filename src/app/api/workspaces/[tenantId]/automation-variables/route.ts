import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { getVariables, changeVariable } from '@/modules/automations/service';
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(_: Request, { params }: Context) {
  return apiResponse(() => params.then((p) => getVariables(p.tenantId)));
}
export async function POST(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return changeVariable((await params).tenantId, await readJson(request, 20000));
  });
}
