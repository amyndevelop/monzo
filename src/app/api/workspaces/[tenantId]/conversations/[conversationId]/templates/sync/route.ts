import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { syncTemplates, templateFailure } from '@/modules/whatsapp/templates';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; conversationId: string }> },
) {
  return apiResponse(async () => {
    try {
      assertMutationOrigin(request);
      const { tenantId, conversationId } = await params;
      return await syncTemplates(tenantId, conversationId, await readJson(request));
    } catch (error) {
      templateFailure(error);
    }
  });
}
