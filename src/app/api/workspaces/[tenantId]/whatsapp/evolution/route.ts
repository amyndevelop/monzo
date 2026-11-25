import { z } from 'zod';
import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { evolutionSettings, evolutionDiagnostics } from '@/modules/evolution/service';
export const runtime = 'nodejs';
export const maxDuration = 45;
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(_request: Request, { params }: Context) {
  return apiResponse(async () => evolutionSettings((await params).tenantId));
}
export async function POST(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    z.object({})
      .strict()
      .parse(await readJson(request, 1024));
    return evolutionDiagnostics((await params).tenantId);
  });
}
