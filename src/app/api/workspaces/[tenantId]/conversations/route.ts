import { apiResponse } from '@/modules/tenants/http';
import { listConversations } from '@/modules/whatsapp/service';
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  return apiResponse(async () =>
    listConversations((await params).tenantId, new URL(request.url).searchParams),
  );
}
