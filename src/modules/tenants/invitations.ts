import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { AccessError, requireTenantAccess, requireUser } from '@/modules/access/policy';
import { authConfig } from '@/modules/auth/config';
import { sendAccountEmail } from '@/modules/auth/email';
import { RequestError, idSchema } from './http';
export async function inviteMember(tenantId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER']);
  const data = z
    .object({
      email: z
        .email()
        .max(254)
        .transform((v) => v.trim().toLowerCase()),
      role: z.enum(['ADMIN', 'MEMBER']),
    })
    .strict()
    .parse(input);
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const tenant = await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const actor = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      include: { tenant: true },
    });
    if (actor?.role !== 'OWNER') throw new AccessError(403);
    if (
      (await tx.tenantInvitation.count({ where: { tenantId, expiresAt: { gt: new Date() } } })) >=
      50
    )
      throw new RequestError(409, 'Hay demasiadas invitaciones pendientes.');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await tx.tenantInvitation.upsert({
      where: { tenantId_email: { tenantId, email: data.email } },
      create: { tenantId, email: data.email, role: data.role, tokenHash, expiresAt },
      update: { role: data.role, tokenHash, expiresAt },
    });
    return { name: actor.tenant.name };
  });
  const url = `${authConfig().origin}/invitacion?token=${token}`;
  await sendAccountEmail(
    data.email,
    'Te invitaron a un equipo en MONZO',
    `Te invitaron a unirte a ${tenant.name}.\n\nAbrí este enlace e ingresá con la cuenta del correo que recibió esta invitación:\n${url}\n\nVence en 48 horas. Si no la esperabas, ignorá el mensaje.`,
  );
  return { ok: true };
}
export async function acceptInvitation(input: unknown) {
  const user = await requireUser();
  const { token } = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .parse(input);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return getDb().$transaction(async (tx) => {
    const invite = await tx.tenantInvitation.findUnique({ where: { tokenHash } });
    if (!invite || invite.expiresAt < new Date() || invite.email !== user.email.toLowerCase())
      throw new AccessError(403, 'La invitación no es válida para esta cuenta o venció.');
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${invite.tenantId} FOR UPDATE`;
    const current = await tx.tenantInvitation.findUnique({ where: { tokenHash } });
    if (!current || current.expiresAt < new Date()) throw new AccessError(403);
    const existing = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } },
    });
    if (!existing)
      await tx.membership.create({
        data: { tenantId: invite.tenantId, userId: user.id, role: invite.role },
      });
    await tx.tenantInvitation.delete({ where: { id: invite.id } });
    return { tenantId: invite.tenantId };
  });
}
