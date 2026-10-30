import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { changeConversationFlow } from '@/modules/automations/service';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; conversationId: string }> },
) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId, conversationId } = await params;
    return changeConversationFlow(tenantId, conversationId, await readJson(request));
  });
}
