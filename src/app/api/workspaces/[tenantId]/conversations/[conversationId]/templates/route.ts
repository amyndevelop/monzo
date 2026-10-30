import { apiResponse } from '@/modules/tenants/http';
import { listTemplates, templateFailure } from '@/modules/whatsapp/templates';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; conversationId: string }> },
) {
  return apiResponse(async () => {
    try {
      const { tenantId, conversationId } = await params;
      return await listTemplates(tenantId, conversationId, new URL(request.url).searchParams);
    } catch (error) {
      templateFailure(error);
    }
  });
}
