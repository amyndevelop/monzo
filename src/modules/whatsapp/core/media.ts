import { createHash, timingSafeEqual } from 'node:crypto';
import { fetch as httpFetch, EnvHttpProxyAgent, FormData as HttpFormData } from 'undici';
import { fileTypeFromBuffer } from 'file-type';
import { MetaError } from './meta';
import { MAX_MEDIA_BYTES, safeFilename, type MediaKind } from '../media-policy';

export class AttachmentError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type MediaFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: HttpFormData;
    signal: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: Pick<Headers, 'get'>;
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
    };
    cancel(): Promise<void>;
  } | null;
  json: () => Promise<unknown>;
}>;
let dispatcher: EnvHttpProxyAgent | undefined;
const network: MediaFetch = async (url, init) => {
  dispatcher ??= new EnvHttpProxyAgent();
  return httpFetch(url, { ...init, dispatcher, redirect: 'error' });
};
const formats: Record<string, { kind: MediaKind; ext: string }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'sticker', ext: 'webp' },
  'audio/mpeg': { kind: 'audio', ext: 'mp3' },
  'audio/ogg': { kind: 'audio', ext: 'ogg' },
  'audio/opus': { kind: 'audio', ext: 'ogg' },
  'audio/mp4': { kind: 'audio', ext: 'm4a' },
  'audio/aac': { kind: 'audio', ext: 'aac' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/3gpp': { kind: 'video', ext: '3gp' },
  'application/pdf': { kind: 'document', ext: 'pdf' },
  'text/plain': { kind: 'document', ext: 'txt' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'document',
    ext: 'docx',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'document',
    ext: 'xlsx',
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    kind: 'document',
    ext: 'pptx',
  },
};
function canonicalMime(value: string) {
  const mime = value.split(';', 1)[0].trim().toLowerCase();
  return mime === 'audio/x-m4a' ? 'audio/mp4' : mime === 'audio/opus' ? 'audio/ogg' : mime;
}
export async function inspectMedia(bytes: Uint8Array, filename: string, allowSticker = true) {
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES)
    throw new AttachmentError(413, 'MEDIA_SIZE', 'El archivo debe pesar entre 1 byte y 3 MB.');
  let mime: string | undefined;
  try {
    const detected = await fileTypeFromBuffer(bytes);
    mime = detected ? canonicalMime(detected.mime) : undefined;
  } catch {
    // Incomplete signatures are not accepted as a supported binary format.
  }
  if (!mime && /\.txt$/i.test(filename)) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) mime = 'text/plain';
    } catch {}
  }
  const format = mime ? formats[mime] : undefined;
  if (!format || (!allowSticker && format.kind === 'sticker'))
    throw new AttachmentError(
      415,
      'MEDIA_TYPE',
      'El contenido del archivo no corresponde a un formato admitido.',
    );
  if (
    (mime === 'audio/ogg' || mime === 'audio/opus') &&
    !Buffer.from(bytes.subarray(0, 256)).includes(Buffer.from('OpusHead'))
  )
    throw new AttachmentError(415, 'MEDIA_CODEC', 'El audio OGG debe usar el códec Opus.');
  const name = safeFilename(filename);
  return {
    kind: format.kind,
    mime: mime === 'audio/opus' ? 'audio/ogg' : mime!,
    filename: name.toLowerCase().endsWith('.' + format.ext) ? name : name + '.' + format.ext,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ext: format.ext,
  };
}
function graphUrl(path: string) {
  const version = process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0';
  if (!/^v(2[5-9]|[3-9]\d)\.0$/.test(version)) throw new MetaError('GRAPH_VERSION');
  return `https://graph.facebook.com/${version}/${path}`;
}
async function request(
  url: string,
  token: string,
  method: string,
  body: HttpFormData | undefined,
  transport: MediaFetch,
) {
  if (
    transport === network &&
    process.env.DATABASE_URL &&
    new URL(process.env.DATABASE_URL).pathname === '/monzo_test'
  )
    throw new MetaError('TEST_NETWORK_DISABLED');
  try {
    return await transport(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new MetaError('MEDIA_NETWORK');
  }
}
async function responseJson(response: Awaited<ReturnType<MediaFetch>>) {
  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
    if (!data || typeof data !== 'object') throw new Error();
  } catch {
    throw new MetaError('MEDIA_RESPONSE');
  }
  if (!response.ok) {
    const code = (data.error as { code?: unknown } | undefined)?.code;
    throw new MetaError(typeof code === 'number' ? `META_${code}` : `HTTP_${response.status}`);
  }
  return data;
}
export async function uploadMedia(
  phone: string,
  token: string,
  bytes: Uint8Array,
  file: Awaited<ReturnType<typeof inspectMedia>>,
  transport: MediaFetch = network,
) {
  if (!/^\d{5,30}$/.test(phone)) throw new MetaError('IDENTIFIER');
  const body = new HttpFormData();
  body.set('messaging_product', 'whatsapp');
  body.set('type', file.mime);
  body.set('file', new Blob([new Uint8Array(bytes)], { type: file.mime }), file.filename);
  const data = await responseJson(
    await request(graphUrl(`${phone}/media`), token, 'POST', body, transport),
  );
  if (typeof data.id !== 'string' || !/^\d{5,30}$/.test(data.id))
    throw new MetaError('MEDIA_RESPONSE');
  return data.id;
}
export function mediaDownloadUrl(value: unknown) {
  if (typeof value !== 'string') throw new MetaError('MEDIA_URL');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MetaError('MEDIA_URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'lookaside.fbsbx.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.startsWith('/whatsapp_business/attachments/')
  )
    throw new MetaError('MEDIA_URL');
  return url.href;
}
export async function downloadMedia(
  phone: string,
  token: string,
  mediaId: string,
  filename: string | null,
  expectedKind: string,
  expectedHash: string | null,
  transport: MediaFetch = network,
) {
  if (!/^\d{5,30}$/.test(phone) || !/^\d{5,30}$/.test(mediaId)) throw new MetaError('IDENTIFIER');
  const data = await responseJson(
    await request(
      graphUrl(`${mediaId}?phone_number_id=${phone}`),
      token,
      'GET',
      undefined,
      transport,
    ),
  );
  if (data.id !== mediaId) throw new MetaError('MEDIA_RESPONSE');
  if (
    typeof data.file_size !== 'number' ||
    !Number.isSafeInteger(data.file_size) ||
    data.file_size < 1 ||
    data.file_size > MAX_MEDIA_BYTES
  )
    throw new AttachmentError(
      413,
      'MEDIA_SIZE',
      'Este adjunto supera el límite de 3 MB o tiene un tamaño inválido.',
    );
  const response = await request(mediaDownloadUrl(data.url), token, 'GET', undefined, transport);
  if (!response.ok) {
    await response.body?.cancel();
    throw new AttachmentError(
      410,
      'MEDIA_UNAVAILABLE',
      'Meta ya no permite descargar este archivo. Podés pedirle al cliente que lo envíe nuevamente.',
    );
  }
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_MEDIA_BYTES)) {
    await response.body?.cancel();
    throw new AttachmentError(413, 'MEDIA_SIZE', 'Este adjunto supera el límite de 3 MB.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MetaError('MEDIA_RESPONSE');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) throw new MetaError('MEDIA_RESPONSE');
      size += value.length;
      if (size > MAX_MEDIA_BYTES)
        throw new AttachmentError(413, 'MEDIA_SIZE', 'Este adjunto supera el límite de 3 MB.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error instanceof AttachmentError ? error : new MetaError('MEDIA_NETWORK');
  }
  if (size !== data.file_size) throw new MetaError('MEDIA_RESPONSE');
  const bytes = Buffer.concat(chunks);
  const mime = typeof data.mime_type === 'string' ? canonicalMime(data.mime_type) : '';
  const ext = formats[mime]?.ext;
  const file = await inspectMedia(bytes, filename ?? `archivo.${ext ?? 'bin'}`);
  if (
    file.kind !== expectedKind ||
    (mime && mime !== file.mime && !(mime === 'audio/opus' && file.mime === 'audio/ogg'))
  )
    throw new MetaError('MEDIA_TYPE');
  for (const hash of [data.sha256, expectedHash]) {
    if (!hash) continue;
    if (
      typeof hash !== 'string' ||
      !(/^[a-f\d]{64}$/i.test(hash) || /^[A-Za-z\d+/]{43}=$/.test(hash))
    )
      throw new MetaError('MEDIA_HASH');
    const expected = Buffer.from(hash, /^[a-f\d]{64}$/i.test(hash) ? 'hex' : 'base64');
    if (expected.length !== 32 || !timingSafeEqual(expected, Buffer.from(file.sha256, 'hex')))
      throw new MetaError('MEDIA_HASH');
  }
  return { bytes, ...file };
}
