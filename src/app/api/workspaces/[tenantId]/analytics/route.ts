import { apiResponse, RequestError } from '@/modules/tenants/http';
import { getAnalytics } from '@/modules/analytics/service';
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  return apiResponse(async () => {
    const paramsQuery = new URL(request.url).searchParams;
    for (const key of new Set(paramsQuery.keys()))
      if (paramsQuery.getAll(key).length !== 1)
        throw new RequestError(400, 'No repitas los filtros.');
    return getAnalytics((await params).tenantId, Object.fromEntries(paramsQuery));
  });
}
