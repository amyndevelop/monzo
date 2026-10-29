import 'server-only';
import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/modules/auth/server';
import { isAuthConfigured } from '@/modules/auth/config';
import { getDb } from '@/lib/db';
export class AccessError extends Error {
  constructor(
    public status: 401 | 403,
    message = 'No tenés acceso a este espacio.',
  ) {
    super(message);
  }
}
export const ACTIVE_TENANT_COOKIE = 'monzo.active-tenant';
export async function requireUser() {
  if (!isAuthConfigured()) throw new AccessError(401);
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user || !session.user.emailVerified) throw new AccessError(401);
  return { id: session.user.id, name: session.user.name, email: session.user.email };
}
export async function requireTenantAccess(
  tenantId: string,
  roles: readonly string[] = ['OWNER', 'ADMIN', 'MEMBER'],
) {
  const user = await requireUser();
  const membership = await getDb().membership.findUnique({
    where: { tenantId_userId: { tenantId, userId: user.id } },
    select: {
      id: true,
      role: true,
      tenantId: true,
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!membership || !roles.includes(membership.role)) throw new AccessError(403);
  return { user, membership, tenant: membership.tenant };
}
export async function requireDashboardContext() {
  const tenantId = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  try {
    if (!tenantId) {
      await requireUser();
      redirect('/empresas');
    }
    return await requireTenantAccess(tenantId);
  } catch (error) {
    if (error instanceof AccessError)
      redirect(error.status === 401 ? '/ingresar' : '/empresas?acceso=denegado');
    throw error;
  }
}

export async function requirePageUser() {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof AccessError) redirect('/ingresar');
    throw error;
  }
}
