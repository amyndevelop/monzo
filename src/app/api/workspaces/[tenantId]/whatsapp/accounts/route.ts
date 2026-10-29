import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { channelStatus, connectAccount } from '@/modules/whatsapp/service';
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(_: Request, { params }: Context) {
  return apiResponse(async () => channelStatus((await params).tenantId));
}
export async function POST(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return connectAccount((await params).tenantId, await readJson(request));
  });
}
