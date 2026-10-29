import 'server-only';
import { z } from 'zod';
import { AccessError } from '@/modules/access/policy';
import { authConfig } from '@/modules/auth/config';
export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assertMutationOrigin(request: Request) {
  if (request.headers.get('origin') !== authConfig().origin)
    throw new RequestError(403, 'Origen de solicitud no permitido.');
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new RequestError(415, 'Se requiere JSON.');
}
export async function readJson(request: Request, maxBytes = 8192): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, 'Solicitud vacía.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RequestError(413, 'Solicitud demasiado grande.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'JSON inválido.');
  }
}
export async function apiResponse(work: () => Promise<unknown>) {
  try {
    return Response.json(await work(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AccessError || error instanceof RequestError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    if (error instanceof z.ZodError)
      return Response.json({ error: 'Revisá los campos enviados.' }, { status: 400 });
    // Log only a bounded category; never database URLs, credentials or request bodies.
    console.error('MONZO request failed:', error instanceof Error ? error.name : 'UnknownError');
    return Response.json(
      { error: 'No pudimos completar la operación. Intentá nuevamente.' },
      { status: 500 },
    );
  }
}
export const idSchema = z.string().min(1).max(128);
