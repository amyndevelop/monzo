import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { graphRequest, MetaError, type MetaFetch } from './meta';
import { decryptToken } from './crypto';
import { attachmentContext, consumeLimit } from './attachments';
import { AttachmentError, inspectMedia, uploadMedia, type MediaFetch } from './media';
import {
  templateDefinitionSchema,
  templateSnapshotSchema,
  readTemplateSnapshot,
  type TemplateSnapshot,
} from './template-schema';
import { renderTemplatePreview, type TemplateDefinition } from '../template-types';

export class TemplateError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const templateFields = 'id,name,status,category,language,parameter_format,components';
const providerSchema = z.object({
  id: z.string().regex(/^\d{5,30}$/),
  name: z.string().regex(/^[a-z0-9_]{1,512}$/),
  language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
  status: z.string().max(40),
  category: z.string().max(40),
  parameter_format: z.enum(['POSITIONAL', 'NAMED']).optional(),
  components: z.array(z.record(z.string(), z.unknown())).max(20),
});
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function placeholders(text: string) {
  return [
    ...new Set([...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1])),
  ];
}
function templateAccount(account: {
  enabled: boolean;
  tokenEncrypted: string | null;
  lastErrorCode: string | null;
}) {
  if (!account.enabled || !account.tokenEncrypted || account.lastErrorCode === 'META_190')
    throw new TemplateError(
      409,
      'ACCOUNT_DISABLED',
      'Actualizá la autorización del canal en Canales antes de usar plantillas.',
    );
}
function tokenFor(account: {
  tokenEncrypted: string | null;
  tenantId: string;
  phoneNumberId: string;
}) {
  try {
    return decryptToken(account.tokenEncrypted!, account.tenantId, account.phoneNumberId);
  } catch {
    throw new TemplateError(
      409,
      'CREDENTIALS_UNAVAILABLE',
      'Volvé a autorizar el canal en Canales.',
    );
  }
}
export function normalizeTemplate(input: unknown) {
  const source = providerSchema.parse(input);
  const definition: TemplateDefinition = {
    name: source.name,
    language: source.language,
    category: source.category,
    parameterFormat: source.parameter_format ?? 'POSITIONAL',
    header: { format: 'NONE', text: '' },
    body: '',
    footer: '',
    buttons: [],
    parameters: [],
    unsupportedReason: null,
  };
  const unsupported = (reason: string) => {
    definition.unsupportedReason ??= reason;
  };
  if (!['UTILITY', 'MARKETING'].includes(source.category))
    unsupported(
      'Las plantillas de autenticación y otras categorías especiales no se envían desde esta bandeja.',
    );
  function addParameters(text: string, component: 'header' | 'body', example: unknown) {
    const names = placeholders(text);
    if (definition.parameterFormat === 'POSITIONAL') names.sort((a, b) => Number(a) - Number(b));
    if (
      names.length > 30 ||
      (text.includes('{{') && text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, '').includes('{{'))
    )
      unsupported('El formato de las variables de esta plantilla no está disponible.');
    if (
      definition.parameterFormat === 'POSITIONAL' &&
      names.some((name, index) => name !== String(index + 1))
    )
      unsupported(
        'Esta plantilla tiene variables numeradas que no podemos completar en este formato.',
      );
    if (
      definition.parameterFormat === 'NAMED' &&
      names.some((name) => !/^[a-z][a-z0-9_]{0,63}$/.test(name))
    )
      unsupported('El formato de las variables con nombre no está disponible.');
    const examples =
      example && typeof example === 'object' ? (example as Record<string, unknown>) : {};
    const named = examples[`${component}_text_named_params`];
    const positional = examples[`${component}_text`];
    for (const name of names) {
      const namedValue = Array.isArray(named)
        ? named.find((item) => item && item.param_name === name)?.example
        : undefined;
      const values = component === 'body' && Array.isArray(positional) ? positional[0] : positional;
      const sample =
        definition.parameterFormat === 'NAMED'
          ? namedValue
          : Array.isArray(values)
            ? values[Number(name) - 1]
            : undefined;
      definition.parameters.push({
        key: `${component}:${name}`,
        name,
        component,
        label: definition.parameterFormat === 'NAMED' ? name.replaceAll('_', ' ') : `Dato ${name}`,
        example: typeof sample === 'string' ? sample.slice(0, 500) : '',
        maxLength: component === 'header' ? 60 : 500,
      });
    }
  }
  const seen = new Set<string>();
  for (const component of source.components) {
    const type = String(component.type);
    if (seen.has(type))
      unsupported('Esta plantilla tiene componentes repetidos que no están disponibles.');
    seen.add(type);
    if (type === 'HEADER') {
      const format = String(component.format);
      if (['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
        definition.header = {
          format: format as TemplateDefinition['header']['format'],
          text: typeof component.text === 'string' ? component.text : '',
        };
        if (format === 'TEXT') addParameters(definition.header.text, 'header', component.example);
      } else
        unsupported(
          'El encabezado de esta plantilla requiere un formato especial que todavía no se puede enviar desde acá.',
        );
    } else if (type === 'BODY') {
      definition.body = typeof component.text === 'string' ? component.text : '';
      addParameters(definition.body, 'body', component.example);
    } else if (type === 'FOOTER') {
      definition.footer = typeof component.text === 'string' ? component.text : '';
      if (placeholders(definition.footer).length)
        unsupported('Esta plantilla tiene variables en el pie que no están disponibles.');
    } else if (type === 'BUTTONS') {
      if (!Array.isArray(component.buttons) || component.buttons.length > 10) {
        unsupported('Los botones de esta plantilla no están disponibles.');
        continue;
      }
      for (const [index, button] of component.buttons.entries()) {
        if (!button || typeof button !== 'object' || typeof button.text !== 'string') {
          unsupported('Los botones de esta plantilla no están disponibles.');
          continue;
        }
        if (button.type === 'QUICK_REPLY')
          definition.buttons.push({ type: 'QUICK_REPLY', text: button.text, index });
        else if (
          button.type === 'PHONE_NUMBER' &&
          typeof button.phone_number === 'string' &&
          /^\+?\d{5,20}$/.test(button.phone_number)
        )
          definition.buttons.push({
            type: 'PHONE_NUMBER',
            text: button.text,
            phoneNumber: button.phone_number,
            index,
          });
        else if (button.type === 'URL' && typeof button.url === 'string') {
          const names = placeholders(button.url);
          let url: URL | undefined;
          try {
            url = new URL(button.url.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, 'example'));
          } catch {}
          if (
            !url ||
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            names.length > 1 ||
            (names.length && (names[0] !== '1' || !/\{\{\s*1\s*\}\}$/.test(button.url)))
          ) {
            unsupported('El enlace de uno de los botones no está disponible para este envío.');
            continue;
          }
          const key = names.length ? `button:${index}:1` : undefined;
          definition.buttons.push({
            type: 'URL',
            text: button.text,
            url: button.url,
            ...(key ? { parameterKey: key } : {}),
            index,
          });
          if (key)
            definition.parameters.push({
              key,
              name: '1',
              component: 'button',
              label: button.text,
              example: '',
              maxLength: 200,
            });
        } else
          unsupported(
            'Esta plantilla incluye un botón especial que todavía no se puede enviar desde acá.',
          );
      }
    } else
      unsupported(
        'Esta plantilla usa un formato especial que todavía no está disponible en la bandeja.',
      );
  }
  if (!seen.has('BODY') || !definition.body)
    unsupported('La plantilla no tiene un mensaje de texto disponible.');
  if (definition.parameters.length > 40)
    unsupported('La plantilla tiene demasiados campos para este envío.');
  const parsed = templateDefinitionSchema.parse(definition);
  return {
    providerId: source.id,
    name: source.name,
    language: source.language,
    category: source.category,
    status: source.status,
    definition: parsed,
    definitionHash: digest(parsed),
  };
}
export function validateTemplateValues(definition: TemplateDefinition, input: unknown) {
  const values = z.record(z.string().max(150), z.string().trim().min(1).max(500)).parse(input);
  const keys = new Set(definition.parameters.map((parameter) => parameter.key));
  if (Object.keys(values).length !== keys.size || Object.keys(values).some((key) => !keys.has(key)))
    throw new TemplateError(
      400,
      'TEMPLATE_PARAMETERS',
      'Completá todos los datos de la plantilla seleccionada.',
    );
  for (const parameter of definition.parameters) {
    const value = values[parameter.key];
    if (
      !value ||
      value.length > parameter.maxLength ||
      /[\r\n\t]/.test(value) ||
      / {5}/.test(value)
    )
      throw new TemplateError(
        400,
        'TEMPLATE_PARAMETERS',
        `Revisá el campo «${parameter.label}». Usá una sola línea de texto.`,
      );
    if (parameter.component === 'button' && /[\s<>"{}]/.test(value))
      throw new TemplateError(
        400,
        'TEMPLATE_PARAMETERS',
        'El dato del enlace no puede incluir espacios ni caracteres especiales de formato.',
      );
  }
  const preview = renderTemplatePreview(definition, values);
  if (preview.body.length > 4096 || preview.header.text.length > 60)
    throw new TemplateError(
      400,
      'TEMPLATE_PARAMETERS',
      'El mensaje completo es demasiado largo. Acortá los datos ingresados.',
    );
  return Object.fromEntries(
    definition.parameters.map((parameter) => [parameter.key, values[parameter.key]]),
  );
}
function available(template: { status: string; definition: unknown }) {
  if (template.status !== 'APPROVED')
    throw new TemplateError(
      409,
      'TEMPLATE_NOT_APPROVED',
      'Meta no tiene aprobada esta plantilla. Actualizá el catálogo o elegí otra.',
    );
  const definition = templateDefinitionSchema.parse(template.definition);
  if (definition.unsupportedReason)
    throw new TemplateError(409, 'TEMPLATE_UNSUPPORTED', definition.unsupportedReason);
  return definition;
}
export async function syncTemplatePage(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  conversationId: string,
  mode: 'refresh' | 'next',
  transport?: MetaFetch,
) {
  const prepared = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const context = await attachmentContext(tx, tenantId, userId, conversationId);
    const actor = await tx.membership.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (actor.role === 'MEMBER')
      throw new TemplateError(
        403,
        'ACCESS',
        'Solo propietarios y administradores pueden actualizar el catálogo de Meta.',
      );
    templateAccount(context.account);
    if (
      mode === 'next' &&
      (!context.account.templatesNextCursor || !context.account.templatesSyncId)
    )
      throw new TemplateError(
        409,
        'TEMPLATE_NO_MORE',
        'Ya se consultaron todas las páginas disponibles.',
      );
    await consumeLimit(
      tx,
      tenantId,
      'template-sync',
      5,
      'Alcanzaste el límite de consultas a Meta por minuto. Esperá un momento antes de actualizar.',
    );
    return context.account;
  });
  const cursor = mode === 'next' ? prepared.templatesNextCursor : null;
  if (cursor && !/^[A-Za-z0-9_+=/.-]{1,2048}$/.test(cursor)) throw new MetaError('TEMPLATE_CURSOR');
  const path = `${prepared.businessAccountId}/message_templates?fields=${templateFields}&limit=50${cursor ? '&after=' + encodeURIComponent(cursor) : ''}`;
  let data: Awaited<ReturnType<typeof graphRequest>>;
  try {
    data = await graphRequest(path, tokenFor(prepared), 'GET', undefined, transport);
  } catch (error) {
    if (error instanceof MetaError && error.code === 'META_190')
      await db.whatsappAccount.updateMany({
        where: { id: prepared.id, tokenEncrypted: prepared.tokenEncrypted },
        data: { lastErrorCode: error.code },
      });
    throw error;
  }
  if (!Array.isArray(data.data) || data.data.length > 50) throw new MetaError('TEMPLATE_RESPONSE');
  const templates = data.data.map(normalizeTemplate);
  if (
    new Set(templates.map((row) => row.providerId)).size !== templates.length ||
    new Set(templates.map((row) => `${row.name}:${row.language}`)).size !== templates.length
  )
    throw new MetaError('TEMPLATE_RESPONSE');
  const paging = data.paging as { next?: unknown; cursors?: { after?: unknown } } | undefined;
  const next = paging?.next ? paging.cursors?.after : null;
  if (next !== null && (typeof next !== 'string' || !/^[A-Za-z0-9_+=/.-]{1,2048}$/.test(next)))
    throw new MetaError('TEMPLATE_CURSOR');
  if (next && (next === cursor || !templates.length)) throw new MetaError('TEMPLATE_CURSOR');
  const syncId = mode === 'refresh' ? randomUUID() : prepared.templatesSyncId!;
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
      const context = await attachmentContext(tx, tenantId, userId, conversationId);
      const actor = await tx.membership.findUniqueOrThrow({
        where: { tenantId_userId: { tenantId, userId } },
      });
      if (actor.role === 'MEMBER')
        throw new TemplateError(403, 'ACCESS', 'No tenés permiso para actualizar el catálogo.');
      const current = context.account;
      templateAccount(current);
      if (
        current.templatesSyncVersion !== prepared.templatesSyncVersion ||
        current.tokenEncrypted !== prepared.tokenEncrypted ||
        current.businessAccountId !== prepared.businessAccountId
      )
        throw new TemplateError(
          409,
          'TEMPLATE_SYNC_CHANGED',
          'Otra actualización cambió el catálogo o el canal. Volvé a consultarlo.',
        );
      for (const template of templates) {
        const values = {
          ...template,
          definition: template.definition as Prisma.InputJsonValue,
          syncId,
          syncedAt: new Date(),
          businessAccountId: current.businessAccountId,
        };
        await tx.whatsappTemplate.upsert({
          where: {
            accountId_name_language: {
              accountId: current.id,
              name: template.name,
              language: template.language,
            },
          },
          create: { ...values, tenantId, accountId: current.id },
          update: values,
        });
      }
      if (!next)
        await tx.whatsappTemplate.updateMany({
          where: {
            tenantId,
            accountId: current.id,
            OR: [
              { syncId: { not: syncId } },
              { businessAccountId: { not: current.businessAccountId } },
            ],
          },
          data: { status: 'UNAVAILABLE' },
        });
      await tx.whatsappAccount.update({
        where: { id: current.id },
        data: {
          templatesNextCursor: next as string | null,
          templatesSyncId: syncId,
          templatesSyncVersion: { increment: 1 },
          ...(!next ? { templatesSyncedAt: new Date() } : {}),
        },
      });
      return { updated: templates.length, hasMore: Boolean(next) };
    },
    { timeout: 20000 },
  );
}
export async function enqueueTemplate(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  conversationId: string,
  input: unknown,
  file?: { bytes: Uint8Array; filename: string },
  transport?: MediaFetch,
) {
  const data = z
    .object({
      templateId: z.string().min(1).max(128),
      definitionHash: z.string().regex(/^[a-f\d]{64}$/),
      values: z.record(z.string().max(150), z.string().max(500)),
      idempotencyKey: z.uuid(),
    })
    .strict()
    .parse(input);
  const media = file ? await inspectMedia(file.bytes, file.filename, false) : null;
  const prepared = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const context = await attachmentContext(tx, tenantId, userId, conversationId);
    const existing = await tx.message.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: data.idempotencyKey } },
    });
    const template = await tx.whatsappTemplate.findFirst({
      where: {
        id: data.templateId,
        tenantId,
        accountId: context.accountId,
        businessAccountId: context.account.businessAccountId,
      },
    });
    if (!template) throw new TemplateError(403, 'ACCESS', 'No tenés acceso a esta plantilla.');
    const definition = existing
      ? (readTemplateSnapshot(existing.templateSnapshot)?.definition ??
        templateDefinitionSchema.parse(template.definition))
      : templateDefinitionSchema.parse(template.definition);
    const values = validateTemplateValues(definition, data.values);
    const inputHash = digest({
      templateId: data.templateId,
      definitionHash: data.definitionHash,
      values,
      media: media ? { sha256: media.sha256, filename: media.filename } : null,
    });
    if (existing) {
      const snapshot = readTemplateSnapshot(existing.templateSnapshot);
      if (
        existing.conversationId !== conversationId ||
        existing.type !== 'template' ||
        snapshot?.inputHash !== inputHash
      )
        throw new TemplateError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'La clave de envío ya se usó para otro mensaje.',
        );
      return { existing, context, template, definition, values, inputHash };
    }
    templateAccount(context.account);
    available(template);
    if (template.definitionHash !== data.definitionHash)
      throw new TemplateError(
        409,
        'TEMPLATE_CHANGED',
        'La plantilla cambió en Meta. Actualizá la selección antes de enviarla.',
      );
    const kind = definition.header.format.toLowerCase();
    const needsMedia = ['image', 'video', 'document'].includes(kind);
    if (
      needsMedia !== Boolean(media) ||
      (media && (media.kind !== kind || (kind === 'document' && media.mime !== 'application/pdf')))
    )
      throw new TemplateError(
        400,
        'TEMPLATE_HEADER',
        'Adjuntá el archivo que corresponde al encabezado: imagen, video o PDF.',
      );
    if (media) await consumeLimit(tx, tenantId, 'upload', 10);
    return { existing: null, context, template, definition, values, inputHash };
  });
  if (prepared.existing) return prepared.existing;
  const account = prepared.context.account;
  const mediaId =
    media && file
      ? await uploadMedia(account.phoneNumberId, tokenFor(account), file.bytes, media, transport)
      : null;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const context = await attachmentContext(tx, tenantId, userId, conversationId);
    templateAccount(context.account);
    const existing = await tx.message.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: data.idempotencyKey } },
    });
    if (existing) {
      if (
        existing.conversationId !== conversationId ||
        existing.type !== 'template' ||
        readTemplateSnapshot(existing.templateSnapshot)?.inputHash !== prepared.inputHash
      )
        throw new TemplateError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'La clave de envío ya se usó para otro mensaje.',
        );
      return existing;
    }
    const template = await tx.whatsappTemplate.findFirst({
      where: {
        id: data.templateId,
        tenantId,
        accountId: context.accountId,
        businessAccountId: context.account.businessAccountId,
      },
    });
    if (
      context.account.businessAccountId !== account.businessAccountId ||
      !template ||
      template.definitionHash !== data.definitionHash
    )
      throw new TemplateError(
        409,
        'TEMPLATE_CHANGED',
        'La plantilla cambió. Actualizá la selección antes de enviarla.',
      );
    available(template);
    if (
      (await tx.message.count({
        where: { tenantId, direction: 'OUTBOUND', createdAt: { gt: new Date(Date.now() - 60000) } },
      })) >= 30
    )
      throw new TemplateError(
        429,
        'SEND_RATE_LIMIT',
        'Alcanzaste el límite de envíos por minuto. Intentá más tarde.',
      );
    const snapshot = templateSnapshotSchema.parse({
      version: 1,
      templateId: template.id,
      businessAccountId: account.businessAccountId,
      definitionHash: template.definitionHash,
      definition: prepared.definition,
      values: prepared.values,
      inputHash: prepared.inputHash,
      media:
        media && mediaId
          ? {
              id: mediaId,
              mime: media.mime,
              filename: media.filename,
              size: media.size,
              sha256: media.sha256,
              kind: media.kind,
            }
          : null,
    });
    const message = await tx.message.create({
      data: {
        tenantId,
        accountId: context.accountId,
        conversationId,
        direction: 'OUTBOUND',
        status: 'QUEUED',
        type: 'template',
        text: renderTemplatePreview(prepared.definition, prepared.values).body,
        templateId: template.id,
        templateSnapshot: snapshot as Prisma.InputJsonValue,
        idempotencyKey: data.idempotencyKey,
        createdByUserId: userId,
        occurredAt: new Date(),
        ...(snapshot.media
          ? {
              mediaId: snapshot.media.id,
              mediaMimeType: snapshot.media.mime,
              mediaFilename: snapshot.media.filename,
              mediaSize: snapshot.media.size,
              mediaSha256: snapshot.media.sha256,
            }
          : {}),
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
    return message;
  });
}
export function templateComponents(snapshot: TemplateSnapshot) {
  const result: Record<string, unknown>[] = [];
  const def = snapshot.definition;
  for (const component of ['header', 'body'] as const) {
    const parameters: Record<string, unknown>[] = def.parameters
      .filter((item) => item.component === component)
      .map((item) => ({
        type: 'text',
        text: snapshot.values[item.key],
        ...(def.parameterFormat === 'NAMED' ? { parameter_name: item.name } : {}),
      }));
    if (component === 'header' && snapshot.media)
      parameters.push({
        type: snapshot.media.kind,
        [snapshot.media.kind]: {
          id: snapshot.media.id,
          ...(snapshot.media.kind === 'document' ? { filename: snapshot.media.filename } : {}),
        },
      });
    if (parameters.length) result.push({ type: component, parameters });
  }
  for (const button of def.buttons) {
    if (button.type === 'QUICK_REPLY')
      result.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(button.index),
        parameters: [{ type: 'payload', payload: `monzo:${snapshot.templateId}:${button.index}` }],
      });
    else if (button.parameterKey)
      result.push({
        type: 'button',
        sub_type: 'url',
        index: String(button.index),
        parameters: [{ type: 'text', text: snapshot.values[button.parameterKey] }],
      });
  }
  return result;
}
export async function checkQueuedTemplate(
  db: PrismaClient,
  messageId: string,
  transport?: MetaFetch,
) {
  const message = await db.message.findUnique({
    where: { id: messageId },
    include: { account: true, template: true },
  });
  if (!message || message.status !== 'QUEUED' || message.type !== 'template') return null;
  let errorCode = 'TEMPLATE_UNAVAILABLE';
  const checkedAt = new Date();
  try {
    const snapshot = readTemplateSnapshot(message.templateSnapshot);
    const member = message.createdByUserId
      ? await db.membership.findUnique({
          where: {
            tenantId_userId: { tenantId: message.tenantId, userId: message.createdByUserId },
          },
        })
      : null;
    if (
      !snapshot ||
      digest(snapshot.definition) !== snapshot.definitionHash ||
      !member ||
      !message.template ||
      message.templateId !== snapshot.templateId ||
      snapshot.businessAccountId !== message.account.businessAccountId ||
      message.template.definitionHash !== snapshot.definitionHash
    )
      throw new TemplateError(409, 'TEMPLATE_CHANGED', 'La plantilla cambió.');
    templateAccount(message.account);
    available(message.template);
    validateTemplateValues(snapshot.definition, snapshot.values);
    const current = normalizeTemplate(
      await graphRequest(
        `${message.template.providerId}?fields=${templateFields}`,
        tokenFor(message.account),
        'GET',
        undefined,
        transport,
      ),
    );
    if (
      current.providerId === message.template.providerId &&
      (current.status !== message.template.status ||
        current.definitionHash !== message.template.definitionHash)
    ) {
      await db.whatsappTemplate.updateMany({
        where: {
          id: message.template.id,
          definitionHash: message.template.definitionHash,
          syncedAt: { lte: checkedAt },
          businessAccountId: snapshot.businessAccountId,
        },
        data: {
          ...current,
          definition: current.definition as Prisma.InputJsonValue,
          syncedAt: new Date(),
        },
      });
    }
    if (current.providerId !== message.template.providerId || current.status !== 'APPROVED')
      throw new TemplateError(
        409,
        'TEMPLATE_NOT_APPROVED',
        'Meta no tiene aprobada esta plantilla.',
      );
    if (current.definitionHash !== snapshot.definitionHash)
      throw new TemplateError(409, 'TEMPLATE_CHANGED', 'La plantilla cambió en Meta.');
    return { snapshot, credentialVersion: message.account.tokenEncrypted! };
  } catch (error) {
    if (error instanceof TemplateError || error instanceof MetaError) errorCode = error.code;
    if (error instanceof AttachmentError) errorCode = error.code;
    await db.message.updateMany({
      where: { id: messageId, status: 'QUEUED' },
      data: { status: 'FAILED', errorCode },
    });
    if (errorCode === 'META_100' && message.template)
      await db.whatsappTemplate.updateMany({
        where: {
          id: message.template.id,
          definitionHash: message.template.definitionHash,
          syncedAt: { lte: checkedAt },
        },
        data: { status: 'UNAVAILABLE' },
      });
    if (errorCode === 'META_190')
      await db.whatsappAccount.updateMany({
        where: { id: message.accountId, tokenEncrypted: message.account.tokenEncrypted },
        data: { lastErrorCode: errorCode },
      });
    return null;
  }
}
