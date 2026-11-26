import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { evolutionChannels, evolutionChannelAction } from '@/modules/evolution/channels';
export const runtime = 'nodejs';
export const maxDuration = 25;
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(_request: Request, { params }: Context) {
  return apiResponse(() => params.then(({ tenantId }) => evolutionChannels(tenantId)));
}
export async function POST(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return evolutionChannelAction((await params).tenantId, await readJson(request, 2048));
  });
}
