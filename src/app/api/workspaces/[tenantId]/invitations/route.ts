import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { inviteMember } from '@/modules/tenants/invitations';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return inviteMember((await params).tenantId, await readJson(request));
  });
}
