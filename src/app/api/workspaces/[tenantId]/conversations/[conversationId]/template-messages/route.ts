import { apiResponse, readJson, RequestError } from '@/modules/tenants/http';
import { authConfig } from '@/modules/auth/config';
import {
  authorizeTemplates,
  sendTemplateMessage,
  templateFailure,
} from '@/modules/whatsapp/templates';
import { MAX_MEDIA_BYTES } from '@/modules/whatsapp/media-policy';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; conversationId: string }> },
) {
  return apiResponse(async () => {
    try {
      if (request.headers.get('origin') !== authConfig().origin)
        throw new RequestError(403, 'Origen de solicitud no permitido.');
      const { tenantId, conversationId } = await params;
      await authorizeTemplates(tenantId, conversationId);
      const contentType = request.headers.get('content-type') ?? '';
      if (contentType.startsWith('application/json'))
        return await sendTemplateMessage(tenantId, conversationId, await readJson(request, 32768));
      if (!contentType.startsWith('multipart/form-data;'))
        throw new RequestError(415, 'Se requiere una plantilla válida y su archivo.');
      const maximum = MAX_MEDIA_BYTES + 32768;
      const length = request.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
        throw new RequestError(413, 'El archivo supera el límite de 3 MB.');
      const reader = request.body?.getReader();
      if (!reader) throw new RequestError(400, 'Solicitud vacía.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maximum) {
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
        throw new RequestError(400, 'Revisá el archivo y los datos de la plantilla.');
      }
      if (
        [...form.keys()].some((key) => !['payload', 'file'].includes(key)) ||
        form.getAll('payload').length !== 1 ||
        form.getAll('file').length !== 1
      )
        throw new RequestError(400, 'Revisá el archivo y los datos de la plantilla.');
      const payload = form.get('payload');
      const file = form.get('file');
      if (typeof payload !== 'string' || payload.length > 32768 || !(file instanceof File))
        throw new RequestError(400, 'Revisá el archivo y los datos de la plantilla.');
      if (!file.size || file.size > MAX_MEDIA_BYTES)
        throw new RequestError(413, 'El archivo debe pesar entre 1 byte y 3 MB.');
      let input: unknown;
      try {
        input = JSON.parse(payload);
      } catch {
        throw new RequestError(400, 'Los datos de la plantilla no son válidos.');
      }
      return await sendTemplateMessage(tenantId, conversationId, input, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
      });
    } catch (error) {
      templateFailure(error);
    }
  });
}
