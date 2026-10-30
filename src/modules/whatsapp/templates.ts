import 'server-only';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { requireTenantAccess } from '@/modules/access/policy';
import { idSchema, RequestError } from '@/modules/tenants/http';
import { attachmentContext } from './core/attachments';
import { AttachmentError } from './core/media';
import { MetaError } from './core/meta';
import { enqueueTemplate, syncTemplatePage, TemplateError } from './core/templates';
import { templateDefinitionSchema } from './core/template-schema';
import { dispatchJobs } from './core/qstash';
import { presentMessage } from './core/message';

export async function authorizeTemplates(tenantId: string, conversationId: string) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId));
  return attachmentContext(getDb(), tenantId, user.id, idSchema.parse(conversationId));
}
export async function listTemplates(
  tenantId: string,
  conversationId: string,
  params: URLSearchParams,
) {
  const { user, membership } = await requireTenantAccess(idSchema.parse(tenantId));
  const context = await attachmentContext(
    getDb(),
    tenantId,
    user.id,
    idSchema.parse(conversationId),
  );
  const q = z
    .string()
    .max(80)
    .parse(params.get('q') ?? '')
    .trim()
    .replaceAll(' ', '_');
  const status = z.enum(['APPROVED', 'ALL']).parse(params.get('status') ?? 'APPROVED');
  const language = z
    .string()
    .max(10)
    .parse(params.get('language') ?? '');
  const after = params.get('after');
  const selected = params.get('selected');
  const scope = {
    tenantId,
    accountId: context.accountId,
    businessAccountId: context.account.businessAccountId,
  };
  if (
    after &&
    !(await getDb().whatsappTemplate.findFirst({
      where: { id: idSchema.parse(after), ...scope },
      select: { id: true },
    }))
  )
    throw new TemplateError(403, 'ACCESS', 'No tenés acceso a esa página de plantillas.');
  const where = {
    ...scope,
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
    ...(status === 'ALL' ? {} : { status }),
    ...(language ? { language } : {}),
  };
  const select = {
    id: true,
    name: true,
    language: true,
    category: true,
    status: true,
    definition: true,
    definitionHash: true,
  } as const;
  const [items, total, languages, selection] = await Promise.all([
    getDb().whatsappTemplate.findMany({
      where,
      select,
      take: 51,
      orderBy: [{ name: 'asc' }, { language: 'asc' }, { id: 'asc' }],
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    }),
    getDb().whatsappTemplate.count({ where }),
    getDb().whatsappTemplate.findMany({
      where: scope,
      distinct: ['language'],
      select: { language: true },
      take: 100,
      orderBy: { language: 'asc' },
    }),
    selected
      ? getDb().whatsappTemplate.findFirst({
          where: { id: idSchema.parse(selected), ...scope },
          select,
        })
      : null,
  ]);
  const item = (row: NonNullable<typeof selection>) => ({
    ...row,
    definition: templateDefinitionSchema.parse(row.definition),
  });
  return {
    items: items.slice(0, 50).map(item),
    total,
    nextPage: items.length > 50 ? items[49].id : null,
    canSync: membership.role !== 'MEMBER',
    blockedReason: !context.account.enabled
      ? 'El canal está desconectado. Un propietario debe conectarlo en Canales.'
      : !context.account.tokenEncrypted
        ? 'No hay una credencial guardada. Un propietario debe autorizar el número en Canales.'
        : context.account.lastErrorCode === 'META_190'
          ? 'Meta rechazó la credencial guardada (META_190). Un propietario debe completar la autorización en Canales para actualizar y enviar plantillas.'
          : null,
    syncedAt: context.account.templatesSyncedAt,
    hasMore: Boolean(context.account.templatesNextCursor),
    enabled:
      context.account.enabled &&
      Boolean(context.account.tokenEncrypted) &&
      context.account.lastErrorCode !== 'META_190',
    languages: languages.map((value) => value.language),
    selection: selection ? item(selection) : null,
  };
}
export async function syncTemplates(tenantId: string, conversationId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER', 'ADMIN']);
  const { mode } = z
    .object({ mode: z.enum(['refresh', 'next']) })
    .strict()
    .parse(input);
  return syncTemplatePage(getDb(), tenantId, user.id, idSchema.parse(conversationId), mode);
}
export async function sendTemplateMessage(
  tenantId: string,
  conversationId: string,
  input: unknown,
  file?: { bytes: Uint8Array; filename: string },
) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId));
  const message = await enqueueTemplate(
    getDb(),
    tenantId,
    user.id,
    idSchema.parse(conversationId),
    input,
    file,
  );
  if (message.status === 'QUEUED') {
    try {
      await dispatchJobs(getDb(), [{ kind: 'outbox', id: message.id }]);
    } catch {
      throw new RequestError(
        503,
        'La plantilla quedó guardada, pero no pudimos programar su envío. Reintentá sin cambiar los datos o recuperá pendientes desde Canales.',
      );
    }
  }
  return presentMessage(message);
}
export function templateFailure(error: unknown): never {
  if (error instanceof TemplateError || error instanceof AttachmentError)
    throw new RequestError(error.status, error.message);
  if (error instanceof MetaError) {
    if (error.code === 'META_190')
      throw new RequestError(
        409,
        'La autorización de Meta venció o fue revocada. Actualizala en Canales.',
      );
    throw new RequestError(
      502,
      `No pudimos consultar las plantillas en Meta (${error.code}). Revisá la conexión y sus permisos o intentá nuevamente.`,
    );
  }
  throw error;
}
