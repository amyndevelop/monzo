import { apiResponse, assertMutationOrigin } from '@/modules/tenants/http';
import { disconnectAccount } from '@/modules/whatsapp/service';
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; accountId: string }> },
) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId, accountId } = await params;
    return disconnectAccount(tenantId, accountId);
  });
}
