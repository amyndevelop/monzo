import { apiResponse, assertMutationOrigin, readJson } from '@/modules/tenants/http';
import { listWorkspaces, createWorkspace } from '@/modules/tenants/service';
export async function GET() {
  return apiResponse(listWorkspaces);
}
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    return createWorkspace(await readJson(request));
  });
}
