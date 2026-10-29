import { apiResponse } from '@/modules/tenants/http';
import { listContacts } from '@/modules/whatsapp/service';
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  return apiResponse(async () =>
    listContacts((await params).tenantId, new URL(request.url).searchParams.get('q') ?? ''),
  );
}
