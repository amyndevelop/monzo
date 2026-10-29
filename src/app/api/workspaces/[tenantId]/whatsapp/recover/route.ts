import { apiResponse, assertMutationOrigin } from '@/modules/tenants/http';
import { recoverPendingJobs } from '@/modules/whatsapp/service';
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return recoverPendingJobs((await params).tenantId);
  });
}
