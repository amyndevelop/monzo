import { apiResponse, RequestError } from '@/modules/tenants/http';
import { authConfig } from '@/modules/auth/config';
import {
  authorizeAttachment,
  saveAttachment,
  attachmentFailure,
} from '@/modules/whatsapp/attachments';
import { MAX_MEDIA_BYTES } from '@/modules/whatsapp/media-policy';
export const runtime = 'nodejs';
export const maxDuration = 60;
const MAX_BODY = MAX_MEDIA_BYTES + 32768;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; conversationId: string }> },
) {
  return apiResponse(async () => {
    try {
      if (request.headers.get('origin') !== authConfig().origin)
        throw new RequestError(403, 'Origen de solicitud no permitido.');
      const contentType = request.headers.get('content-type') ?? '';
      if (!contentType.startsWith('multipart/form-data;'))
        throw new RequestError(415, 'Se requiere un archivo adjunto.');
      const { tenantId, conversationId } = await params;
      await authorizeAttachment(tenantId, conversationId);
      const length = request.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY))
        throw new RequestError(413, 'El archivo supera el límite de 3 MB.');
      const reader = request.body?.getReader();
      if (!reader) throw new RequestError(400, 'Solicitud vacía.');
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BODY) {
          await reader.cancel();
          throw new RequestError(413, 'El archivo supera el límite de 3 MB.');
        }
        chunks.push(value);
      }
      let form: FormData;
      try {
        form = await new Response(Buffer.concat(chunks), {
          headers: { 'Content-Type': contentType },
        }).formData();
      } catch {
        throw new RequestError(400, 'El archivo adjunto no es válido.');
      }
      if (
        [...form.keys()].some((key) => !['file', 'text', 'idempotencyKey'].includes(key)) ||
        ['file', 'text', 'idempotencyKey'].some((key) => form.getAll(key).length !== 1)
      )
        throw new RequestError(400, 'Revisá el archivo y los campos enviados.');
      const file = form.get('file');
      const text = form.get('text');
      const idempotencyKey = form.get('idempotencyKey');
      if (!(file instanceof File) || typeof text !== 'string' || typeof idempotencyKey !== 'string')
        throw new RequestError(400, 'Revisá el archivo y los campos enviados.');
      if (!file.size || file.size > MAX_MEDIA_BYTES)
        throw new RequestError(413, 'El archivo debe pesar entre 1 byte y 3 MB.');
      return await saveAttachment(tenantId, conversationId, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
        text,
        idempotencyKey,
      });
    } catch (error) {
      attachmentFailure(error);
    }
  });
}
