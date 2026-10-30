import { apiResponse, assertMutationOrigin } from '@/modules/tenants/http';
import { checkAccountAuthorization } from '@/modules/whatsapp/service';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; accountId: string }> },
) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId, accountId } = await params;
    return checkAccountAuthorization(tenantId, accountId);
  });
}
