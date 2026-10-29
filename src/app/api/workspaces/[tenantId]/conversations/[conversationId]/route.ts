import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { getThread, updateConversation } from '@/modules/whatsapp/service';
type Context = { params: Promise<{ tenantId: string; conversationId: string }> };
export async function GET(request: Request, { params }: Context) {
  return apiResponse(async () => {
    const { tenantId, conversationId } = await params;
    return getThread(
      tenantId,
      conversationId,
      new URL(request.url).searchParams.get('before') ?? undefined,
    );
  });
}
export async function PATCH(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId, conversationId } = await params;
    return updateConversation(tenantId, conversationId, await readJson(request));
  });
}
