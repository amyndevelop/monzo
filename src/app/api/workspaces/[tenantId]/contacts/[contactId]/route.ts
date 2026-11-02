import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { contactDetail, saveContact } from '@/modules/contacts/service';
type Context = { params: Promise<{ tenantId: string; contactId: string }> };
export async function GET(_request: Request, { params }: Context) {
  return apiResponse(async () => {
    const { tenantId, contactId } = await params;
    return contactDetail(tenantId, contactId);
  });
}
export async function PATCH(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId, contactId } = await params;
    return saveContact(tenantId, contactId, await readJson(request, 24000));
  });
}
