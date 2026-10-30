'use client';
export async function whatsappRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    headers:
      body === undefined || body instanceof FormData
        ? undefined
        : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'No pudimos completar la solicitud.');
  return data as T;
}
