import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { webStatus, webAction } from '@/modules/whatsapp/web/service';
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(_request: Request, { params }: Context) {
  return apiResponse(async () => webStatus((await params).tenantId));
}
export async function POST(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return webAction((await params).tenantId, await readJson(request));
  });
}
