import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { changeMembership } from '@/modules/tenants/service';
type Context = { params: Promise<{ tenantId: string; membershipId: string }> };
export async function PATCH(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId, membershipId } = await params;
    return changeMembership(tenantId, membershipId, await readJson(request));
  });
}
export async function DELETE(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId, membershipId } = await params;
    return changeMembership(tenantId, membershipId, await readJson(request), true);
  });
}
