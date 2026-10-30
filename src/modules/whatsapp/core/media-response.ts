import type { downloadMedia } from './media';

export function attachmentResponse(
  file: Awaited<ReturnType<typeof downloadMedia>>,
  request: Request,
) {
  const headers = new Headers({
    'Content-Type': file.mime,
    'Content-Length': String(file.bytes.length),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${file.kind === 'document' || new URL(request.url).searchParams.has('download') ? 'attachment' : 'inline'}; filename="archivo.${file.ext}"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}`,
  });
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const size = file.bytes.length;
    const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
    const end = match?.[1] ? Math.min(size - 1, match[2] ? Number(match[2]) : size - 1) : size - 1;
    if (
      !match ||
      !(match[1] || match[2]) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      start >= size
    ) {
      headers.set('Content-Range', `bytes */${size}`);
      headers.set('Content-Length', '0');
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(new Uint8Array(file.bytes.subarray(start, end + 1)), {
      status: 206,
      headers,
    });
  }
  return new Response(new Uint8Array(file.bytes), { headers });
}
