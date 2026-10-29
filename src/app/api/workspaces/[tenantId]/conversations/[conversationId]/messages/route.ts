import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { enqueueMessage } from '@/modules/whatsapp/service';
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; conversationId: string }> },
) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId, conversationId } = await params;
    return enqueueMessage(tenantId, conversationId, await readJson(request, 24576));
  });
}
