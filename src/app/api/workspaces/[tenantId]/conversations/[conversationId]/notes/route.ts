import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { addNote } from '@/modules/whatsapp/service';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; conversationId: string }> },
) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId, conversationId } = await params;
    return addNote(tenantId, conversationId, await readJson(request, 16384));
  });
}
