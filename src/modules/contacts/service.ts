import 'server-only';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { requireTenantAccess, AccessError } from '@/modules/access/policy';
import { idSchema, RequestError } from '@/modules/tenants/http';
import { stateSchema } from '@/modules/automations/definition';
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
const profileSchema = z
  .object({
    crmName: text(120),
    email: z.union([z.literal(''), z.email().max(254)]).transform((v) => v || null),
    company: text(160),
    salesStage: z.enum(['NEW', 'FOLLOW_UP', 'CLOSED']),
    tags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(40)
          .refine((v) => !v.includes(',')),
      )
      .max(12)
      .transform((v) => [...new Set(v)]),
    ownerUserId: idSchema.nullable(),
    profileNotes: text(4000),
    crmRevision: z.number().int().positive(),
  })
  .strict();
const fields = {
  id: true,
  name: true,
  waId: true,
  crmName: true,
  email: true,
  company: true,
  salesStage: true,
  tags: true,
  ownerUserId: true,
  profileNotes: true,
  crmRevision: true,
  createdAt: true,
  account: { select: { displayPhone: true } },
  owner: { select: { id: true, name: true } },
  conversations: {
    select: { id: true, status: true, lastMessageAt: true },
    take: 1,
    orderBy: { lastMessageAt: 'desc' as const },
  },
} as const;
export async function contactList(tenantId: string, params: URLSearchParams) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId));
  const q = z
    .string()
    .max(80)
    .parse(params.get('q') ?? '')
    .trim();
  const stage = z.enum(['', 'NEW', 'FOLLOW_UP', 'CLOSED']).parse(params.get('stage') ?? '');
  const owner = z
    .string()
    .max(128)
    .parse(params.get('owner') ?? '');
  const tag = z
    .string()
    .max(40)
    .parse(params.get('tag') ?? '')
    .trim();
  return getDb().contact.findMany({
    where: {
      tenantId,
      ...(stage ? { salesStage: stage } : {}),
      ...(owner
        ? { ownerUserId: owner === 'unassigned' ? null : owner === 'me' ? user.id : owner }
        : {}),
      ...(tag ? { tags: { has: tag } } : {}),
      ...(q
        ? {
            OR: [
              ...['name', 'crmName', 'email', 'company'].map((key) => ({
                [key]: { contains: q, mode: 'insensitive' as const },
              })),
              { waId: { contains: q } },
              { tags: { has: q } },
            ],
          }
        : {}),
    },
    select: fields,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
}
export async function contactDetail(tenantId: string, contactId: string) {
  const { user, membership } = await requireTenantAccess(idSchema.parse(tenantId));
  const contact = await getDb().contact.findFirst({
    where: { id: idSchema.parse(contactId), tenantId },
    select: fields,
  });
  if (!contact) throw new AccessError(403);
  const [members, conversations, definitions] = await Promise.all([
    getDb().membership.findMany({
      where: { tenantId },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    getDb().conversation.findMany({
      where: { tenantId, contactId },
      select: { id: true, automationState: true },
      orderBy: { lastMessageAt: 'desc' },
      take: 1,
    }),
    getDb().automationVariable.findMany({
      where: { tenantId },
      select: { identifier: true, name: true },
      take: 100,
    }),
  ]);
  const answers = conversations.flatMap((c) => {
    const state = stateSchema.safeParse(c.automationState);
    return state.success
      ? Object.entries(state.data.variables ?? {}).map(([identifier, value]) => ({
          identifier,
          value,
          label: definitions.find((d) => d.identifier === identifier)?.name ?? identifier,
          conversationId: c.id,
        }))
      : [];
  });
  return { contact, members, answers, canAssign: membership.role !== 'MEMBER', userId: user.id };
}
export async function saveContact(tenantId: string, contactId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId));
  idSchema.parse(contactId);
  const { crmRevision, ...data } = profileSchema.parse(input);
  await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const actor = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
    });
    const current = await tx.contact.findFirst({ where: { id: contactId, tenantId } });
    if (!actor || !current) throw new AccessError(403);
    if (current.crmRevision !== crmRevision)
      throw new RequestError(
        409,
        'Otra persona actualizó esta ficha. Conservamos tus campos; recargá la ficha antes de volver a guardar.',
      );
    if (
      data.ownerUserId !== current.ownerUserId &&
      actor.role === 'MEMBER' &&
      data.ownerUserId !== user.id &&
      !(data.ownerUserId === null && current.ownerUserId === user.id)
    )
      throw new AccessError(403);
    if (
      data.ownerUserId &&
      data.ownerUserId !== current.ownerUserId &&
      !(await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: data.ownerUserId } },
      }))
    )
      throw new AccessError(403);
    // An old owner who left the workspace cannot be reassigned; retain or clear explicitly.
    await tx.contact.update({
      where: { id: contactId },
      data: { ...data, crmRevision: { increment: 1 } },
    });
  });
  return contactDetail(tenantId, contactId);
}
