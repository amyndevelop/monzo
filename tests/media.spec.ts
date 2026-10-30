import { test, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fixture, db, inbound, fakeToken } from './helpers/whatsapp';
import { captureWebhook } from '../src/modules/whatsapp/core/ingest';
import { processJob } from '../src/modules/whatsapp/core/qstash';
import { enqueueAttachment, readAttachment } from '../src/modules/whatsapp/core/attachments';
import {
  downloadMedia,
  uploadMedia,
  inspectMedia,
  mediaDownloadUrl,
  type MediaFetch,
} from '../src/modules/whatsapp/core/media';
import { sendMedia, type MetaFetch } from '../src/modules/whatsapp/core/meta';
import { attachmentResponse } from '../src/modules/whatsapp/core/media-response';
import { presentMessage } from '../src/modules/whatsapp/core/message';
import { MAX_MEDIA_BYTES, safeFilename } from '../src/modules/whatsapp/media-policy';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const pdf = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
);
const audio = readFileSync('tests/fixtures/voice.ogg');
const video = readFileSync('tests/fixtures/video.mp4');
const mediaId = '123456789012345';
const providerUrl = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=fixture';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
test.afterAll(() => db.$disconnect());
async function received(f: Awaited<ReturnType<typeof fixture>>) {
  const events = await captureWebhook(db, Buffer.from(JSON.stringify(inbound(f.account))));
  await processJob(db, { kind: 'inbox', id: events[0].id });
  return db.conversation.findFirstOrThrow({ where: { accountId: f.account.id } });
}
function uploadTransport(check?: MediaFetch): MediaFetch {
  return async (url, init) => {
    if (check) await check(url, init);
    return new Response(JSON.stringify({ id: mediaId }), { status: 200 });
  };
}
function downloadTransport(
  bytes = png,
  mime = 'image/png',
  overrides: Record<string, unknown> = {},
  check?: (url: string) => void,
): MediaFetch {
  return async (url, init) => {
    check?.(url);
    expect(init.headers.Authorization).toBe('Bearer ' + fakeToken);
    return url.startsWith('https://graph.facebook.com/')
      ? new Response(
          JSON.stringify({
            id: mediaId,
            url: providerUrl,
            file_size: bytes.length,
            mime_type: mime,
            sha256: hash(bytes),
            ...overrides,
          }),
          { status: 200 },
        )
      : new Response(new Uint8Array(bytes), { status: 200 });
  };
}

test('formatos: contenido real, tamaño, audio Opus, video y nombre seguro', async () => {
  for (const [bytes, name, kind, mime] of [
    [png, 'foto.jpg', 'image', 'image/png'],
    [pdf, 'factura.pdf', 'document', 'application/pdf'],
    [audio, 'audio.ogg', 'audio', 'audio/ogg'],
    [readFileSync('tests/fixtures/voice.m4a'), 'voice.m4a', 'audio', 'audio/mp4'],
    [video, 'clip.mp4', 'video', 'video/mp4'],
  ] as const) {
    const file = await inspectMedia(bytes, name);
    expect(file.kind).toBe(kind);
    expect(file.mime).toBe(mime);
    expect(file.sha256).toBe(hash(bytes));
  }
  expect((await inspectMedia(png, 'archivo.html')).filename).toBe('archivo.html.png');
  expect(safeFilename('../cliente\r\n"\u202e.pdf')).not.toMatch(/[\r\n/"\u202e]/);
  await expect(
    inspectMedia(Buffer.from('<html>falso PDF</html>'), 'falso.pdf'),
  ).rejects.toMatchObject({ status: 415 });
  await expect(inspectMedia(new Uint8Array(), 'vacio.png')).rejects.toMatchObject({ status: 413 });
  await expect(
    inspectMedia(new Uint8Array(MAX_MEDIA_BYTES + 1), 'grande.png'),
  ).rejects.toMatchObject({ status: 413 });
});

test('webhook adjuntos: metadatos, deduplicación y DTO privado sin ID de medio ni credenciales', async () => {
  const f = await fixture();
  const providerId = 'wamid.media-inbound.' + randomUUID();
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: f.account.businessAccountId,
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: f.account.phoneNumberId },
              contacts: [{ wa_id: '5491112345678', profile: { name: 'Cliente de prueba' } }],
              messages: [
                {
                  id: providerId,
                  from: '5491112345678',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'document',
                  document: {
                    id: mediaId,
                    mime_type: 'application/pdf',
                    filename: 'factura.pdf',
                    sha256: hash(pdf),
                    caption: 'Factura recibida',
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const [event] = await captureWebhook(db, Buffer.from(JSON.stringify(payload)));
  await processJob(db, { kind: 'inbox', id: event.id });
  await captureWebhook(db, Buffer.from(JSON.stringify(payload)));
  await processJob(db, { kind: 'inbox', id: event.id });
  const messages = await db.message.findMany({ where: { tenantId: f.tenant.id, providerId } });
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    type: 'document',
    text: 'Factura recibida',
    mediaId,
    mediaMimeType: 'application/pdf',
    mediaFilename: 'factura.pdf',
    mediaSha256: hash(pdf),
  });
  const response = await f.api.get(
    `/api/workspaces/${f.tenant.id}/conversations/${messages[0].conversationId}`,
  );
  expect(response.ok()).toBe(true);
  const dto = (await response.json()).messages[0];
  expect(dto).toMatchObject({
    hasMedia: true,
    mediaFilename: 'factura.pdf',
    mediaMimeType: 'application/pdf',
  });
  expect(dto).not.toHaveProperty('mediaId');
  expect(presentMessage(messages[0])).not.toHaveProperty('providerId');
  expect(presentMessage(messages[0])).not.toHaveProperty('mediaSha256');
  expect(presentMessage(messages[0])).not.toHaveProperty('createdByUserId');
  expect(JSON.stringify(dto)).not.toContain(fakeToken);
  expect(
    (await db.whatsappWebhookEvent.findUniqueOrThrow({ where: { id: event.id } })).payload,
  ).toBeNull();
  await f.api.dispose();
});

test('contrato Meta: upload multipart con token privado, cuenta correcta y contenido comprobado', async () => {
  const file = await inspectMedia(png, 'foto.png');
  expect(
    await uploadMedia(
      '1234567890',
      fakeToken,
      png,
      file,
      uploadTransport(async (url, init) => {
        expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v25\.0\/1234567890\/media$/);
        expect(init.headers).toEqual({ Authorization: 'Bearer ' + fakeToken });
        expect(init.body!.get('messaging_product')).toBe('whatsapp');
        const attached = init.body!.get('file');
        if (!attached || typeof attached === 'string') throw new Error('Expected a file');
        expect(attached.type).toBe('image/png');
        expect(Buffer.from(await attached.arrayBuffer())).toEqual(png);
        return new Response('{}');
      }),
    ),
  ).toBe(mediaId);
});

test('descarga: URL de Meta renovada, cuenta de origen, hash y contenido exacto', async () => {
  const urls: string[] = [];
  const file = await downloadMedia(
    '1234567890',
    fakeToken,
    mediaId,
    'foto.png',
    'image',
    hash(png),
    downloadTransport(png, 'image/png', {}, (url) => urls.push(url)),
  );
  expect(urls).toEqual([
    `https://graph.facebook.com/v25.0/${mediaId}?phone_number_id=1234567890`,
    providerUrl,
  ]);
  expect(file.bytes).toEqual(png);
  expect(file.mime).toBe('image/png');
  await expect(
    downloadMedia(
      '1234567890',
      fakeToken,
      mediaId,
      'foto.png',
      'image',
      '0'.repeat(64),
      downloadTransport(),
    ),
  ).rejects.toMatchObject({ code: 'MEDIA_HASH' });
  await expect(
    downloadMedia(
      '1234567890',
      fakeToken,
      mediaId,
      'foto.png',
      'document',
      null,
      downloadTransport(),
    ),
  ).rejects.toMatchObject({ code: 'MEDIA_TYPE' });
});

test('descarga: destinos ajenos, credenciales y redirecciones no se aceptan como URL de archivo', async () => {
  for (const url of [
    'https://example.test/file',
    'http://lookaside.fbsbx.com/whatsapp_business/attachments/x',
    'https://lookaside.fbsbx.com.evil.test/whatsapp_business/attachments/x',
    'https://user:password@lookaside.fbsbx.com/whatsapp_business/attachments/x',
    'https://lookaside.fbsbx.com:444/whatsapp_business/attachments/x',
    'https://lookaside.fbsbx.com/otro',
  ])
    expect(() => mediaDownloadUrl(url)).toThrow();
  let calls = 0;
  await expect(
    downloadMedia(
      '1234567890',
      fakeToken,
      mediaId,
      'foto.png',
      'image',
      null,
      downloadTransport(png, 'image/png', { url: 'https://example.test/leak' }, () => calls++),
    ),
  ).rejects.toMatchObject({ code: 'MEDIA_URL' });
  expect(calls).toBe(1);
});

test('descarga: límites de metadatos y stream, archivo vencido y bytes truncados', async () => {
  let calls = 0;
  await expect(
    downloadMedia(
      '1234567890',
      fakeToken,
      mediaId,
      'foto.png',
      'image',
      null,
      downloadTransport(png, 'image/png', { file_size: MAX_MEDIA_BYTES + 1 }, () => calls++),
    ),
  ).rejects.toMatchObject({ status: 413 });
  expect(calls).toBe(1);
  for (const mode of ['expired', 'oversized', 'truncated'] as const) {
    const transport: MediaFetch = async (url, init) => {
      if (url === providerUrl)
        return mode === 'expired'
          ? new Response('expired', { status: 404 })
          : new Response(
              mode === 'oversized'
                ? new Uint8Array(MAX_MEDIA_BYTES + 1)
                : new Uint8Array(png.subarray(0, 10)),
              { status: 200 },
            );
      return downloadTransport()(url, init);
    };
    await expect(
      downloadMedia('1234567890', fakeToken, mediaId, 'foto.png', 'image', null, transport),
    ).rejects.toMatchObject(
      mode === 'expired'
        ? { status: 410 }
        : mode === 'oversized'
          ? { status: 413 }
          : { code: 'MEDIA_RESPONSE' },
    );
  }
});

test('respuesta privada: rangos, disposición segura, tamaño y ausencia de caché', async () => {
  const file = { bytes: pdf, ...(await inspectMedia(pdf, 'presupuesto á.pdf')) };
  const full = attachmentResponse(file, new Request('https://monzo.example.test/attachment'));
  expect(full.status).toBe(200);
  expect(full.headers.get('cache-control')).toBe('private, no-store');
  expect(full.headers.get('content-type')).toBe('application/pdf');
  expect(full.headers.get('content-disposition')).toContain(
    'attachment; filename="archivo.pdf"; filename*=UTF-8\'\'presupuesto%20%C3%A1.pdf',
  );
  expect(full.headers.get('x-content-type-options')).toBe('nosniff');
  expect(Buffer.from(await full.arrayBuffer())).toEqual(pdf);
  for (const [range, status, expected] of [
    ['bytes=0-4', 206, pdf.subarray(0, 5)],
    ['bytes=-5', 206, pdf.subarray(-5)],
    ['bytes=5-', 206, pdf.subarray(5)],
    ['bytes=100000-', 416, Buffer.alloc(0)],
    ['bytes=0-2,4-6', 416, Buffer.alloc(0)],
    ['bytes=-0', 416, Buffer.alloc(0)],
  ] as const) {
    const response = attachmentResponse(
      file,
      new Request('https://monzo.example.test/attachment', { headers: { range } }),
    );
    expect(response.status).toBe(status);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
    expect(response.headers.get('content-length')).toBe(String(expected.length));
    expect(response.headers.get('content-range')).not.toBeNull();
  }
});

test('envío por QStash: upload concurrente crea un solo mensaje y callback repetido no lo reenvía', async () => {
  const f = await fixture();
  const conv = await received(f);
  const input = {
    bytes: png,
    filename: 'foto.png',
    text: 'Mirá esta imagen',
    idempotencyKey: randomUUID(),
  };
  const [a, b] = await Promise.all([
    enqueueAttachment(db, f.tenant.id, f.user.id, conv.id, input, uploadTransport()),
    enqueueAttachment(db, f.tenant.id, f.user.id, conv.id, input, uploadTransport()),
  ]);
  expect(a.id).toBe(b.id);
  expect(
    await db.message.count({ where: { conversationId: conv.id, direction: 'OUTBOUND' } }),
  ).toBe(1);
  let calls = 0;
  const transport: MetaFetch = async (_, init) => {
    calls++;
    const body = JSON.parse(init.body!);
    expect(body.type).toBe('image');
    expect(body.image).toEqual({ id: mediaId, caption: input.text });
    expect(body.biz_opaque_callback_data).toBe(a.id);
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.media.' + a.id }] }),
    };
  };
  await Promise.all([
    processJob(db, { kind: 'outbox', id: a.id }, transport),
    processJob(db, { kind: 'outbox', id: b.id }, transport),
  ]);
  await processJob(db, { kind: 'outbox', id: a.id }, transport);
  expect(calls).toBe(1);
  expect((await db.message.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('SENT');
  const replay = await enqueueAttachment(db, f.tenant.id, f.user.id, conv.id, input, async () => {
    throw new Error('Must not upload again');
  });
  expect(replay.id).toBe(a.id);
  await expect(
    enqueueAttachment(
      db,
      f.tenant.id,
      f.user.id,
      conv.id,
      { ...input, bytes: pdf, filename: 'factura.pdf' },
      uploadTransport(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await f.api.dispose();
});

test('adjuntos: aislamiento por empresa y revocación durante la subida impiden guardar o leer', async () => {
  const a = await fixture();
  const b = await fixture();
  const conv = await received(a);
  const input = { bytes: png, filename: 'foto.png', text: '', idempotencyKey: randomUUID() };
  await expect(
    enqueueAttachment(db, b.tenant.id, b.user.id, conv.id, input, uploadTransport()),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    enqueueAttachment(
      db,
      a.tenant.id,
      a.user.id,
      conv.id,
      input,
      uploadTransport(async () => {
        await db.membership.delete({
          where: { tenantId_userId: { tenantId: a.tenant.id, userId: a.user.id } },
        });
        return new Response('{}');
      }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    await db.message.count({ where: { conversationId: conv.id, direction: 'OUTBOUND' } }),
  ).toBe(0);
  await a.api.dispose();
  await b.api.dispose();
});

test('adjuntos: canal desconectado, ventana vencida y límite de subidas se validan antes de Meta', async () => {
  const f = await fixture();
  const conv = await received(f);
  const input = { bytes: png, filename: 'foto.png', text: '', idempotencyKey: randomUUID() };
  let calls = 0;
  const transport = uploadTransport(async () => {
    calls++;
    return new Response('{}');
  });
  await db.conversation.update({
    where: { id: conv.id },
    data: { lastInboundAt: new Date(Date.now() - 25 * 3600000) },
  });
  await expect(
    enqueueAttachment(db, f.tenant.id, f.user.id, conv.id, input, transport),
  ).rejects.toMatchObject({ code: 'WINDOW_CLOSED' });
  await db.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date() } });
  await db.whatsappAccount.update({ where: { id: f.account.id }, data: { enabled: false } });
  await expect(
    enqueueAttachment(db, f.tenant.id, f.user.id, conv.id, input, transport),
  ).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
  await db.whatsappAccount.update({ where: { id: f.account.id }, data: { enabled: true } });
  const key = 'whatsapp-media:upload:' + f.tenant.id;
  await db.rateLimit.create({
    data: { id: key, key, count: 10, lastRequest: BigInt(Math.floor(Date.now() / 60000) * 60000) },
  });
  await expect(
    enqueueAttachment(db, f.tenant.id, f.user.id, conv.id, input, transport),
  ).rejects.toMatchObject({ status: 429 });
  expect(calls).toBe(0);
  await f.api.dispose();
});

test('documentos y audio: payload de Meta correcto y rechazo argentino conserva el archivo', async () => {
  for (const type of ['image', 'video', 'audio', 'document']) {
    const bodies: Record<string, unknown>[] = [];
    await sendMedia(
      '1234567890',
      fakeToken,
      '5491112345678',
      { type, id: mediaId, caption: 'Leyenda', filename: 'factura.pdf' },
      'message-fixture',
      async (_, init) => {
        bodies.push(JSON.parse(init.body!));
        return bodies.length === 1
          ? { ok: false, status: 400, json: async () => ({ error: { code: 131030 } }) }
          : { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.fixture' }] }) };
      },
    );
    expect(bodies[1]).toEqual({ ...bodies[0], to: '541112345678' });
    expect(bodies[1][type]).toEqual({
      id: mediaId,
      ...(type === 'document' ? { filename: 'factura.pdf' } : {}),
      ...(type === 'audio' ? {} : { caption: 'Leyenda' }),
    });
  }
});

test('lectura: el servidor verifica empresa y acceso actual, incluso después de descargar de Meta', async () => {
  const f = await fixture();
  const other = await fixture();
  const conv = await received(f);
  const saved = await enqueueAttachment(
    db,
    f.tenant.id,
    f.user.id,
    conv.id,
    { bytes: png, filename: 'foto.png', text: '', idempotencyKey: randomUUID() },
    uploadTransport(),
  );
  expect(
    (await readAttachment(db, f.tenant.id, f.user.id, saved.id, downloadTransport())).bytes,
  ).toEqual(png);
  await expect(
    readAttachment(db, other.tenant.id, other.user.id, saved.id, downloadTransport()),
  ).rejects.toMatchObject({ status: 403 });
  const transport: MediaFetch = async (url, init) => {
    const response = await downloadTransport()(url, init);
    if (url === providerUrl)
      await db.membership.delete({
        where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
      });
    return response;
  };
  await expect(
    readAttachment(db, f.tenant.id, f.user.id, saved.id, transport),
  ).rejects.toMatchObject({ status: 403 });
  await f.api.dispose();
  await other.api.dispose();
});

test('API: origen, sesión, alcance, tamaño y contenido multipart sin bypass de Meta', async ({
  request,
}) => {
  const f = await fixture();
  const other = await fixture();
  const conv = await received(f);
  const path = `/api/workspaces/${f.tenant.id}/conversations/${conv.id}/attachments`;
  const multipart = {
    file: { name: 'foto.png', mimeType: 'image/png', buffer: png },
    text: '',
    idempotencyKey: randomUUID(),
  };
  expect((await request.post(path, { multipart })).status()).toBe(403);
  expect(
    (
      await request.post(path, { headers: { origin: 'http://127.0.0.1:3100' }, multipart })
    ).status(),
  ).toBe(401);
  expect((await other.api.post(path, { multipart })).status()).toBe(403);
  expect(
    (
      await f.api.post(path, {
        multipart: {
          ...multipart,
          file: { ...multipart.file, buffer: Buffer.alloc(MAX_MEDIA_BYTES + 1) },
        },
      })
    ).status(),
  ).toBe(413);
  expect(
    (
      await f.api.post(path, {
        multipart: {
          ...multipart,
          file: { ...multipart.file, buffer: Buffer.from('<html>not an image</html>') },
        },
      })
    ).status(),
  ).toBe(415);
  const response = await f.api.post(path, { multipart });
  expect(response.status()).toBe(502);
  expect(await response.text()).toContain('TEST_NETWORK_DISABLED');
  expect(
    await db.message.count({ where: { conversationId: conv.id, direction: 'OUTBOUND' } }),
  ).toBe(0);
  expect(
    (await f.api.get(`/api/workspaces/${f.tenant.id}/messages/not-available/attachment`)).status(),
  ).toBe(403);
  await f.api.dispose();
  await other.api.dispose();
});

test('bandeja: adjuntos reales en historial, carga a pedido, audio/video, descarga y formulario móvil', async ({
  page,
}, testInfo) => {
  const f = await fixture();
  const conv = await received(f);
  for (const [type, bytes, name, mime] of [
    ['image', png, 'foto.png', 'image/png'],
    ['audio', audio, 'voz.ogg', 'audio/ogg'],
    ['video', video, 'clip.mp4', 'video/mp4'],
    ['document', pdf, 'factura.pdf', 'application/pdf'],
  ] as const) {
    await db.message.create({
      data: {
        tenantId: f.tenant.id,
        accountId: f.account.id,
        conversationId: conv.id,
        direction: 'INBOUND',
        status: 'RECEIVED',
        type,
        mediaId,
        mediaMimeType: mime,
        mediaFilename: name,
        mediaSize: bytes.length,
        occurredAt: new Date(),
      },
    });
  }
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  const requests: string[] = [];
  // Explicit UI fixture transport; core/download authentication is exercised separately.
  await page.route('**/messages/*/attachment', async (route) => {
    requests.push(route.request().url());
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const message = await db.message.findUniqueOrThrow({ where: { id } });
    const bytes =
      message.type === 'image'
        ? png
        : message.type === 'audio'
          ? audio
          : message.type === 'video'
            ? video
            : pdf;
    await route.fulfill({
      status: 200,
      body: bytes,
      contentType: message.mediaMimeType!,
      headers: {
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(message.mediaFilename!)}`,
      },
    });
  });
  await page.goto('/dashboard/conversaciones');
  await page.getByRole('button', { name: /Cliente de prueba/ }).click();
  await expect(page.getByRole('button', { name: 'Ver imagen', exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Ver imagen', exact: true }).click();
  await expect(page.getByRole('img', { name: 'foto.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Ampliar imagen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Vista de imagen' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Vista de imagen' })).toBeHidden();
  await page.getByRole('button', { name: 'Escuchar audio', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Posición del audio' })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByLabel('Audio de la conversación')
        .evaluate((element: HTMLAudioElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Velocidad del audio: 1x', exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByLabel('Audio de la conversación')
        .evaluate((element: HTMLAudioElement) => element.playbackRate),
    )
    .toBe(1.5);
  await expect(page.getByRole('button', { name: 'Reproducir audio', exact: true })).toBeVisible();
  await page.getByRole('slider', { name: 'Posición del audio' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() =>
      page
        .getByLabel('Audio de la conversación')
        .evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await page.getByRole('log', { name: 'Historial de mensajes' }).evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: testInfo.outputPath('media-chat-redesign.png'), fullPage: true });
  await page.getByRole('button', { name: 'Ver video', exact: true }).click();
  await expect(page.getByLabel('Video de la conversación')).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByLabel('Video de la conversación')
        .evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar documento', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('factura.pdf');
  await expect(page.getByText('factura.pdf', { exact: true })).toBeVisible();
  await page
    .getByLabel('Archivo adjunto', { exact: true })
    .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('button', { name: 'Quitar adjunto' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Vista previa del adjunto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
  const composer = page.getByLabel('Mensaje de WhatsApp', { exact: true });
  await composer.fill('Una foto');
  await composer.press('Shift+Enter');
  await composer.pressSequentially('Para vos');
  await expect(composer).toHaveValue('Una foto\nPara vos');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'TEST_NETWORK_DISABLED' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar adjunto' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('media-inbox.png'), fullPage: true });
  await f.api.dispose();
});
