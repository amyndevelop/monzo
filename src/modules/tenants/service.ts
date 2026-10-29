import 'server-only';
import { z } from 'zod';
import { Prisma, type MembershipRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { getDb } from '@/lib/db';
import { requireTenantAccess, requireUser, AccessError } from '@/modules/access/policy';
import { RequestError, idSchema } from './http';
const nameSchema = z.string().trim().min(2).max(80);
export async function listWorkspaces() {
  const user = await requireUser();
  const memberships = await getDb().membership.findMany({
    where: { userId: user.id },
    select: { role: true, tenant: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  return { user, memberships };
}
export async function createWorkspace(input: unknown) {
  const user = await requireUser();
  const { name } = z.object({ name: nameSchema }).strict().parse(input);
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user.id} FOR UPDATE`;
    if ((await tx.membership.count({ where: { userId: user.id, role: 'OWNER' } })) >= 20)
      throw new RequestError(409, 'Alcanzaste el límite de 20 empresas propias.');
    const slug = `${
      name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 45) || 'empresa'
    }-${randomBytes(6).toString('hex')}`;
    return tx.tenant.create({
      data: {
        name,
        slug,
        settings: { create: {} },
        memberships: { create: { userId: user.id, role: 'OWNER' } },
      },
      select: { id: true, name: true, slug: true },
    });
  });
}
export async function getWorkspace(tenantId: string) {
  const { tenant, membership } = await requireTenantAccess(idSchema.parse(tenantId));
  const settings = await getDb().tenantSettings.findUnique({
    where: { tenantId },
    select: { timezone: true, locale: true },
  });
  return { tenant, role: membership.role, settings };
}
export async function listMembers(tenantId: string) {
  await requireTenantAccess(idSchema.parse(tenantId));
  return getDb().membership.findMany({
    where: { tenantId },
    select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
}
export async function updateSettings(tenantId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER', 'ADMIN']);
  const data = z
    .object({
      name: nameSchema,
      timezone: z
        .string()
        .max(100)
        .refine((v) => {
          try {
            new Intl.DateTimeFormat('es', { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }),
      locale: z.enum(['es-AR', 'es', 'en', 'pt-BR']),
    })
    .strict()
    .parse(input);
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const actor = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
    });
    if (!actor || !['OWNER', 'ADMIN'].includes(actor.role)) throw new AccessError(403);
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { name: data.name },
      select: { id: true, name: true },
    });
    await tx.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, timezone: data.timezone, locale: data.locale },
      update: { timezone: data.timezone, locale: data.locale },
    });
    return tenant;
  });
}
export async function changeMembership(
  tenantId: string,
  membershipId: string,
  input: unknown,
  remove = false,
) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER']);
  idSchema.parse(membershipId);
  const role: MembershipRole | undefined = remove
    ? undefined
    : z
        .object({ role: z.enum(['OWNER', 'ADMIN', 'MEMBER']) })
        .strict()
        .parse(input).role;
  return getDb().$transaction(
    async (tx) => {
      // Serialize owner changes within the tenant to preserve the last owner under concurrency.
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
      const actor = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: user.id } },
      });
      if (actor?.role !== 'OWNER') throw new AccessError(403);
      const target = await tx.membership.findFirst({ where: { id: membershipId, tenantId } });
      if (!target) throw new AccessError(403);
      if (
        target.role === 'OWNER' &&
        (remove || role !== 'OWNER') &&
        (await tx.membership.count({ where: { tenantId, role: 'OWNER' } })) <= 1
      )
        throw new RequestError(409, 'La empresa debe conservar al menos un propietario.');
      if (remove) {
        await tx.conversation.updateMany({
          where: { tenantId, assignedUserId: target.userId },
          data: { assignedUserId: null },
        });
        await tx.membership.delete({ where: { id: target.id } });
      } else await tx.membership.update({ where: { id: target.id }, data: { role } });
      return { ok: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
