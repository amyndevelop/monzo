import { apiResponse } from '@/modules/tenants/http';
import { contactList } from '@/modules/contacts/service';
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  return apiResponse(async () =>
    contactList((await params).tenantId, new URL(request.url).searchParams),
  );
}
