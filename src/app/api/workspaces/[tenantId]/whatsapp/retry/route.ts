import { apiResponse, assertMutationOrigin } from '@/modules/tenants/http';
import { retryFailedEvents } from '@/modules/whatsapp/service';
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return retryFailedEvents((await params).tenantId);
  });
}
