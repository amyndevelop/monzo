import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { testAgent } from '@/modules/ai/service';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return testAgent((await params).tenantId, await readJson(request, 12288));
  });
}
