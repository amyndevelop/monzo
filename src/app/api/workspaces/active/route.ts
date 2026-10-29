import { cookies } from 'next/headers';
import { z } from 'zod';
import { ACTIVE_TENANT_COOKIE, requireTenantAccess } from '@/modules/access/policy';
import { apiResponse, assertMutationOrigin, readJson, idSchema } from '@/modules/tenants/http';
import { authConfig } from '@/modules/auth/config';
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertMutationOrigin(request);
    const { tenantId } = z
      .object({ tenantId: idSchema })
      .strict()
      .parse(await readJson(request));
    await requireTenantAccess(tenantId);
    (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: authConfig().secureCookies,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return { ok: true };
  });
}
