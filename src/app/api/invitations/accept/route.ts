import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { acceptInvitation } from '@/modules/tenants/invitations';
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return acceptInvitation(await readJson(request));
  });
}
