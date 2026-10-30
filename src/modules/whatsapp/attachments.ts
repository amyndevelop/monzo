import 'server-only';
import { getDb } from '@/lib/db';
import { requireTenantAccess } from '@/modules/access/policy';
import { idSchema, RequestError } from '@/modules/tenants/http';
import { attachmentContext, enqueueAttachment, readAttachment } from './core/attachments';
import { AttachmentError } from './core/media';
import { MetaError } from './core/meta';
import { dispatchJobs } from './core/qstash';
import { presentMessage } from './core/message';

export async function authorizeAttachment(tenantId: string, conversationId: string) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId));
  await attachmentContext(getDb(), tenantId, user.id, idSchema.parse(conversationId));
}
export async function saveAttachment(
  tenantId: string,
  conversationId: string,
  input: { bytes: Uint8Array; filename: string; text: string; idempotencyKey: string },
) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId));
  const saved = await enqueueAttachment(
    getDb(),
    tenantId,
    user.id,
    idSchema.parse(conversationId),
    input,
  );
  if (saved.status === 'QUEUED') {
    try {
      await dispatchJobs(getDb(), [{ kind: 'outbox', id: saved.id }]);
    } catch {
      throw new RequestError(
        503,
        'El adjunto quedó guardado, pero no pudimos programar su envío. Reintentá el mismo archivo o recuperá pendientes desde Canales.',
      );
    }
  }
  return presentMessage(saved);
}
export async function getAttachment(tenantId: string, messageId: string) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId));
  return readAttachment(getDb(), tenantId, user.id, idSchema.parse(messageId));
}
export function attachmentFailure(error: unknown): never {
  if (error instanceof AttachmentError) throw new RequestError(error.status, error.message);
  if (error instanceof MetaError) {
    if (error.code === 'META_190')
      throw new RequestError(
        409,
        'La autorización de Meta venció o fue revocada. Actualizá el token en Canales.',
      );
    if (['META_100', 'HTTP_404'].includes(error.code))
      throw new RequestError(
        410,
        'Meta ya no tiene este archivo disponible. Podés pedir que lo envíen nuevamente.',
      );
    throw new RequestError(
      502,
      `No pudimos procesar el archivo en Meta (${error.code}). Intentá nuevamente.`,
    );
  }
  throw error;
}
