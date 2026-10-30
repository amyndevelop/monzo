import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fixture, db, inbound, fakeToken } from './helpers/whatsapp';
import { captureWebhook } from '../src/modules/whatsapp/core/ingest';
import { processJob } from '../src/modules/whatsapp/core/qstash';
import {
  normalizeTemplate,
  syncTemplatePage,
  enqueueTemplate,
  templateComponents,
} from '../src/modules/whatsapp/core/templates';
import { processOutbound } from '../src/modules/whatsapp/core/outbound';
import { readTemplateSnapshot } from '../src/modules/whatsapp/core/template-schema';
import { renderTemplatePreview } from '../src/modules/whatsapp/template-types';
import { type MetaFetch } from '../src/modules/whatsapp/core/meta';

test.afterAll(() => db.$disconnect());
const source = (overrides: Record<string, unknown> = {}) => ({
  id: '123456789012345',
  name: 'seguimiento_pedido',
  language: 'es_AR',
  category: 'UTILITY',
  status: 'APPROVED',
  parameter_format: 'POSITIONAL',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Tu pedido {{1}}', example: { header_text: ['1234'] } },
    {
      type: 'BODY',
      text: 'Hola {{1}}, tu pedido ya está listo.',
      example: { body_text: [['Andrés']] },
    },
    { type: 'FOOTER', text: 'Gracias por elegirnos' },
    {
      type: 'BUTTONS',
      buttons: [
        {
          type: 'URL',
          text: 'Ver pedido',
          url: 'https://example.test/pedidos/{{1}}',
          example: ['1234'],
        },
        { type: 'QUICK_REPLY', text: 'Necesito ayuda' },
      ],
    },
  ],
  ...overrides,
});
const reply = (body: unknown): Awaited<ReturnType<MetaFetch>> => ({
  ok: true,
  status: 200,
  json: async () => body,
});
async function context() {
  const f = await fixture();
  const [event] = await captureWebhook(db, Buffer.from(JSON.stringify(inbound(f.account))));
  await processJob(db, { kind: 'inbox', id: event.id });
  const chat = await db.conversation.findFirstOrThrow({ where: { accountId: f.account.id } });
  return { ...f, chat };
}
async function seed(f: Awaited<ReturnType<typeof context>>, raw = source()) {
  await syncTemplatePage(db, f.tenant.id, f.user.id, f.chat.id, 'refresh', async () =>
    reply({ data: [raw] }),
  );
  return db.whatsappTemplate.findFirstOrThrow({
    where: { accountId: f.account.id, providerId: String(raw.id) },
  });
}
function input(
  template: { id: string; definitionHash: string },
  values = { 'header:1': '1234', 'body:1': 'Andrés', 'button:0:1': '1234' },
) {
  return {
    templateId: template.id,
    definitionHash: template.definitionHash,
    values,
    idempotencyKey: randomUUID(),
  };
}
test('catálogo paginado: consulta acotada, cursor seguro, estados y cuentas aisladas', async () => {
  const f = await context();
  const old = await seed(f, source({ id: '123456789012346', name: 'plantilla_anterior' }));
  let url = '';
  await syncTemplatePage(db, f.tenant.id, f.user.id, f.chat.id, 'refresh', async (path, init) => {
    url = path;
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer ' + fakeToken);
    return reply({
      data: [source()],
      paging: { next: 'https://untrusted.test/do-not-follow', cursors: { after: 'cursor+/=' } },
    });
  });
  expect(url).toContain(`/${f.account.businessAccountId}/message_templates?fields=`);
  expect(url).toContain('&limit=50');
  expect((await db.whatsappTemplate.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
    'APPROVED',
  );
  await syncTemplatePage(db, f.tenant.id, f.user.id, f.chat.id, 'next', async (path) => {
    expect(path).toContain('after=cursor%2B%2F%3D');
    return reply({
      data: [source({ id: '123456789012347', name: 'plantilla_pausada', status: 'PAUSED' })],
    });
  });
  expect((await db.whatsappTemplate.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
    'UNAVAILABLE',
  );
  const base = `/api/workspaces/${f.tenant.id}/conversations/${f.chat.id}/templates`;
  const catalog = await (await f.api.get(base)).json();
  expect(catalog.items).toHaveLength(1);
  expect(catalog.items[0].name).toBe('seguimiento_pedido');
  expect(catalog.hasMore).toBe(false);
  expect((await (await f.api.get(base + '?status=ALL')).json()).total).toBe(3);
  expect((await (await f.api.get(base + '?q=seguimiento%20pedido')).json()).items).toHaveLength(1);
  const other = await context();
  expect((await other.api.get(base)).status()).toBe(403);
  expect(
    (
      await f.api.get(`/api/workspaces/${f.tenant.id}/conversations/${other.chat.id}/templates`)
    ).status(),
  ).toBe(403);
  await f.api.dispose();
  await other.api.dispose();
});
test('catálogo: permisos y cambio de autorización durante la consulta impiden escritura obsoleta', async () => {
  const f = await context();
  await db.membership.update({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    data: { role: 'MEMBER' },
  });
  let calls = 0;
  await expect(
    syncTemplatePage(db, f.tenant.id, f.user.id, f.chat.id, 'refresh', async () => {
      calls++;
      return reply({ data: [] });
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(calls).toBe(0);
  await db.membership.update({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    data: { role: 'OWNER' },
  });
  await expect(
    syncTemplatePage(db, f.tenant.id, f.user.id, f.chat.id, 'refresh', async () => {
      await db.whatsappAccount.update({
        where: { id: f.account.id },
        data: { templatesSyncVersion: { increment: 1 } },
      });
      return reply({ data: [source()] });
    }),
  ).rejects.toMatchObject({ code: 'TEMPLATE_SYNC_CHANGED' });
  expect(await db.whatsappTemplate.count({ where: { accountId: f.account.id } })).toBe(0);
  await expect(
    syncTemplatePage(db, f.tenant.id, f.user.id, f.chat.id, 'refresh', async () =>
      reply({ data: [source(), source()] }),
    ),
  ).rejects.toMatchObject({ code: 'TEMPLATE_RESPONSE' });
  await f.api.dispose();
});
test('variables con nombre, formatos especiales y vista previa sin sustituciones recursivas', () => {
  const normalized = normalizeTemplate(
    source({
      parameter_format: 'NAMED',
      components: [
        {
          type: 'BODY',
          text: 'Hola {{nombre}}, pedido {{pedido}}. {{nombre}}',
          example: { body_text_named_params: [{ param_name: 'nombre', example: 'Ana' }] },
        },
      ],
    }),
  );
  expect(normalized.definition.parameters.map((p) => p.key)).toEqual([
    'body:nombre',
    'body:pedido',
  ]);
  expect(normalized.definition.parameters[0].example).toBe('Ana');
  expect(
    renderTemplatePreview(normalized.definition, {
      'body:nombre': '{{pedido}}',
      'body:pedido': '1234',
    }).body,
  ).toBe('Hola {{pedido}}, pedido 1234. {{pedido}}');
  for (const components of [
    [{ type: 'CAROUSEL' }],
    [
      { type: 'BODY', text: 'Hola' },
      { type: 'BUTTONS', buttons: [{ type: 'FLOW', text: 'Continuar' }] },
    ],
  ])
    expect(normalizeTemplate(source({ components })).definition.unsupportedReason).toBeTruthy();
  expect(
    normalizeTemplate(source({ category: 'AUTHENTICATION' })).definition.unsupportedReason,
  ).toBeTruthy();
});
test('envío fuera de las 24 h: datos exactos, idempotencia y contrato de Meta', async () => {
  const f = await context();
  const template = await seed(f);
  await db.conversation.update({
    where: { id: f.chat.id },
    data: { lastInboundAt: new Date(Date.now() - 48 * 3600000) },
  });
  const data = input(template);
  const first = await enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, data);
  const second = await enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, data);
  expect(second.id).toBe(first.id);
  await expect(
    enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, {
      ...data,
      values: { ...data.values, 'body:1': 'Otra persona' },
    }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  const bodies: Record<string, unknown>[] = [];
  await Promise.all([
    processOutbound(db, first.id, async (_, init) => {
      if (init.method === 'GET') return reply(source());
      bodies.push(JSON.parse(init.body!));
      return reply({ messages: [{ id: 'wamid.template.' + first.id }] });
    }),
    processOutbound(db, first.id, async (_, init) => {
      if (init.method === 'GET') return reply(source());
      bodies.push(JSON.parse(init.body!));
      return reply({ messages: [{ id: 'wamid.template.' + first.id }] });
    }),
  ]);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    type: 'template',
    messaging_product: 'whatsapp',
    biz_opaque_callback_data: first.id,
    template: {
      name: 'seguimiento_pedido',
      language: { code: 'es_AR' },
      components: [
        { type: 'header', parameters: [{ type: 'text', text: '1234' }] },
        { type: 'body', parameters: [{ type: 'text', text: 'Andrés' }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: '1234' }],
        },
        { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload' }] },
      ],
    },
  });
  expect((await db.message.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('SENT');
  const dto = await (
    await f.api.get(`/api/workspaces/${f.tenant.id}/conversations/${f.chat.id}`)
  ).json();
  const sent = dto.messages.find((m: { id: string }) => m.id === first.id);
  expect(sent.template.body).toContain('Hola Andrés');
  expect(sent).not.toHaveProperty('templateSnapshot');
  expect(sent).not.toHaveProperty('definitionHash');
  expect(
    (
      await f.api.post(`/api/workspaces/${f.tenant.id}/conversations/${f.chat.id}/messages`, {
        data: { text: 'No permitido', idempotencyKey: randomUUID() },
      })
    ).status(),
  ).toBe(409);
  await f.api.dispose();
});
test('rechaza datos incompletos, extras, plantilla ajena, estado y vista previa antigua', async () => {
  const f = await context();
  const template = await seed(f);
  const other = await context();
  for (const values of [
    {},
    { 'header:1': '1234', 'body:1': 'Ana\nOtra línea', 'button:0:1': '1234' },
    { 'header:1': '1234', 'body:1': 'Ana', 'button:0:1': 'no válido' },
    { 'header:1': '1234', 'body:1': 'Ana', 'button:0:1': '1234', extra: 'dato' },
  ])
    await expect(
      enqueueTemplate(
        db,
        f.tenant.id,
        f.user.id,
        f.chat.id,
        input(template, values as ReturnType<typeof input>['values']),
      ),
    ).rejects.toThrow();
  await expect(
    enqueueTemplate(db, other.tenant.id, other.user.id, other.chat.id, input(template)),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, {
      ...input(template),
      definitionHash: '0'.repeat(64),
    }),
  ).rejects.toMatchObject({ code: 'TEMPLATE_CHANGED' });
  await db.whatsappTemplate.update({ where: { id: template.id }, data: { status: 'PAUSED' } });
  await expect(
    enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, input(template)),
  ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_APPROVED' });
  expect(await db.message.count({ where: { accountId: f.account.id, type: 'template' } })).toBe(0);
  await f.api.dispose();
  await other.api.dispose();
});
test('comprobación previa: pausa en Meta actualiza catálogo, evita POST y conserva el historial', async () => {
  const f = await context();
  const template = await seed(f);
  const message = await enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, input(template));
  let posts = 0;
  await processOutbound(db, message.id, async (_, init) => {
    if (init.method === 'POST') posts++;
    return reply(source({ status: 'PAUSED' }));
  });
  expect(posts).toBe(0);
  expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
    status: 'FAILED',
    errorCode: 'TEMPLATE_NOT_APPROVED',
  });
  expect((await db.whatsappTemplate.findUniqueOrThrow({ where: { id: template.id } })).status).toBe(
    'PAUSED',
  );
  expect(readTemplateSnapshot(message.templateSnapshot)?.definition.body).toContain('Hola {{1}}');
  await f.api.dispose();
});

test('versión modificada en Meta exige nueva vista previa y el historial conserva el texto original', async () => {
  const f = await context();
  const template = await seed(f);
  const message = await enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, input(template));
  const changed = source({
    components: [{ type: 'BODY', text: 'Nueva versión sin datos variables' }],
  });
  let posts = 0;
  await processOutbound(db, message.id, async (_, init) => {
    if (init.method === 'POST') posts++;
    return reply(changed);
  });
  expect(posts).toBe(0);
  expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
    status: 'FAILED',
    errorCode: 'TEMPLATE_CHANGED',
  });
  const current = await db.whatsappTemplate.findUniqueOrThrow({ where: { id: template.id } });
  expect(current.definitionHash).not.toBe(template.definitionHash);
  expect(readTemplateSnapshot(message.templateSnapshot)?.definition.body).toContain('Hola {{1}}');
  // A replay of a durable message uses its original snapshot even if the current template changed.
  const original = { ...input(template), idempotencyKey: message.idempotencyKey! };
  expect((await enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, original)).id).toBe(
    message.id,
  );
  await f.api.dispose();
});

test('API: origen, campos estrictos, idempotencia y variables con nombre', async () => {
  const f = await context();
  const raw = source({
    parameter_format: 'NAMED',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{nombre}}',
        example: { body_text_named_params: [{ param_name: 'nombre', example: 'Ana' }] },
      },
    ],
  });
  const template = await seed(f, raw);
  const base = `/api/workspaces/${f.tenant.id}/conversations/${f.chat.id}`;
  const data = {
    templateId: template.id,
    definitionHash: template.definitionHash,
    values: { 'body:nombre': 'Ana' },
    idempotencyKey: randomUUID(),
  };
  expect(
    (
      await f.api.post(base + '/template-messages', {
        headers: { origin: 'https://untrusted.test' },
        data,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await f.api.post(base + '/templates/sync', {
        headers: { origin: 'https://untrusted.test' },
        data: { mode: 'refresh' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await f.api.post(base + '/template-messages', {
        data: { ...data, to: 'untrusted-recipient' },
      })
    ).status(),
  ).toBe(400);
  const first = await f.api.post(base + '/template-messages', { data });
  expect(first.ok()).toBe(true);
  const dto = await first.json();
  const second = await f.api.post(base + '/template-messages', { data });
  expect((await second.json()).id).toBe(dto.id);
  const stored = await db.message.findUniqueOrThrow({ where: { id: dto.id } });
  expect(templateComponents(readTemplateSnapshot(stored.templateSnapshot)!)).toEqual([
    { type: 'body', parameters: [{ type: 'text', parameter_name: 'nombre', text: 'Ana' }] },
  ]);
  expect(dto.template.body).toBe('Hola Ana');
  expect(dto).not.toHaveProperty('templateSnapshot');
  await f.api.dispose();
});
test('no reenvía resultados inciertos y revalida permisos antes de enviar', async () => {
  const f = await context();
  const template = await seed(f);
  const message = await enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, input(template));
  let posts = 0;
  const transport: MetaFetch = async (_, init) => {
    if (init.method === 'GET') return reply(source());
    posts++;
    throw new Error('Interrupted');
  };
  await processOutbound(db, message.id, transport);
  await processOutbound(db, message.id, transport);
  expect(posts).toBe(1);
  expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
    'UNKNOWN',
  );
  const next = await enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, input(template));
  await processOutbound(db, next.id, async () => {
    await db.membership.delete({
      where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    });
    return reply(source());
  });
  expect(await db.message.findUniqueOrThrow({ where: { id: next.id } })).toMatchObject({
    status: 'CANCELED',
    errorCode: 'MEMBERSHIP_REVOKED',
  });
  await f.api.dispose();
});
test('encabezados con imagen y PDF: archivo requerido, carga privada y snapshot para el historial', async () => {
  const f = await context();
  const raw = source({
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Tu comprobante está listo.' },
    ],
  });
  const template = await seed(f, raw);
  await expect(
    enqueueTemplate(
      db,
      f.tenant.id,
      f.user.id,
      f.chat.id,
      input(template, {} as ReturnType<typeof input>['values']),
    ),
  ).rejects.toMatchObject({ code: 'TEMPLATE_HEADER' });
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const data = input(template, {} as ReturnType<typeof input>['values']);
  let uploads = 0;
  const message = await enqueueTemplate(
    db,
    f.tenant.id,
    f.user.id,
    f.chat.id,
    data,
    { bytes, filename: 'foto.png' },
    async (url, init) => {
      uploads++;
      expect(url).toContain(`/${f.account.phoneNumberId}/media`);
      expect(init.headers.Authorization).toBe('Bearer ' + fakeToken);
      return new Response(JSON.stringify({ id: '123456789012349' }));
    },
  );
  const snapshot = readTemplateSnapshot(message.templateSnapshot)!;
  expect(templateComponents(snapshot)).toEqual([
    { type: 'header', parameters: [{ type: 'image', image: { id: '123456789012349' } }] },
  ]);
  expect(snapshot.media?.filename).toBe('foto.png');
  await enqueueTemplate(db, f.tenant.id, f.user.id, f.chat.id, data, {
    bytes,
    filename: 'foto.png',
  });
  expect(uploads).toBe(1);
  const pdfTemplate = await seed(
    f,
    source({
      components: [
        { type: 'HEADER', format: 'DOCUMENT' },
        { type: 'BODY', text: 'Documento' },
      ],
    }),
  );
  await expect(
    enqueueTemplate(
      db,
      f.tenant.id,
      f.user.id,
      f.chat.id,
      input(pdfTemplate, {} as ReturnType<typeof input>['values']),
      { bytes, filename: 'fake.pdf' },
    ),
  ).rejects.toMatchObject({ code: 'TEMPLATE_HEADER' });
  await f.api.dispose();
});
async function openDialog(page: Page, raw = source()) {
  const f = await context();
  const template = await seed(f, raw);
  await syncTemplatePage(db, f.tenant.id, f.user.id, f.chat.id, 'refresh', async () =>
    reply({
      data: [raw, source({ id: '123456789012346', name: 'mensaje_pausado', status: 'PAUSED' })],
    }),
  );
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/conversaciones?conversation=' + f.chat.id);
  await page.getByLabel('Mensaje de WhatsApp', { exact: true }).fill('Borrador conservado');
  await page.getByRole('button', { name: 'Usar plantilla', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Enviar una plantilla' });
  await expect(dialog.getByLabel('Buscar plantilla')).toBeFocused();
  await dialog.getByRole('button', { name: /seguimiento pedido/ }).click();
  return { f, template, dialog };
}
test('UX: vista previa, error recuperable, foco, pantalla completa y borrador preservado', async ({
  page,
}, testInfo) => {
  const { f, dialog } = await openDialog(page);
  await dialog.getByLabel('Dato 1 Encabezado').fill('1234');
  await dialog.getByLabel('Dato 1 Mensaje').fill('Ana');
  await dialog.getByLabel('Ver pedido Enlace').fill('1234');
  await expect(dialog.locator('.template-preview')).toContainText(
    'Hola Ana, tu pedido ya está listo.',
  );
  const send = dialog.getByRole('button', { name: 'Enviar plantilla', exact: true });
  await expect(send).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath('plantilla-lista-para-enviar.png'),
    fullPage: true,
  });
  const keys: string[] = [];
  await page.route('**/template-messages', async (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Servicio temporalmente ocupado. Reintentá.' }),
    });
  });
  await send.click();
  await expect(dialog.getByRole('alert')).toContainText('temporalmente ocupado');
  await expect(dialog.getByLabel('Dato 1 Mensaje')).toHaveValue('Ana');
  await send.click();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const dialog = document.querySelector('dialog.template-dialog')!.getBoundingClientRect();
        const send = document.querySelector('.template-send-footer')!.getBoundingClientRect();
        return (
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1 &&
          dialog.bottom <= innerHeight &&
          send.bottom <= innerHeight
        );
      }),
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('plantilla-preview.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Usar plantilla', exact: true })).toBeFocused();
  await expect(page.getByLabel('Mensaje de WhatsApp', { exact: true })).toHaveValue(
    'Borrador conservado',
  );
  await page.unroute('**/template-messages');
  await page.getByRole('button', { name: 'Usar plantilla', exact: true }).click();
  await dialog.getByRole('button', { name: /seguimiento pedido/ }).click();
  await dialog.getByLabel('Dato 1 Encabezado').fill('1234');
  await dialog.getByLabel('Dato 1 Mensaje').fill('Ana');
  await dialog.getByLabel('Ver pedido Enlace').fill('1234');
  await dialog.getByRole('button', { name: 'Enviar plantilla', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('log').locator('.template-preview')).toContainText('Hola Ana');
  await expect(page.getByLabel('Mensaje de WhatsApp', { exact: true })).toHaveValue(
    'Borrador conservado',
  );
  await f.api.dispose();
});

test('UX: imagen del encabezado, validación y archivo conservado ante un fallo', async ({
  page,
}, testInfo) => {
  const { f, dialog } = await openDialog(
    page,
    source({
      components: [
        { type: 'HEADER', format: 'IMAGE' },
        { type: 'BODY', text: '*Tu pedido* está listo.' },
      ],
    }),
  );
  const send = dialog.getByRole('button', { name: 'Enviar plantilla', exact: true });
  await expect(send).toBeDisabled();
  const file = dialog.getByLabel('Archivo del encabezado');
  await file.setInputFiles({
    name: 'foto.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(dialog.getByRole('img', { name: 'Imagen de la plantilla' })).toBeVisible();
  await expect(dialog.locator('.template-preview strong')).toHaveText('Tu pedido');
  await expect(send).toBeEnabled();
  await page.route('**/template-messages', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Meta no respondió. Reintentá.' }),
    }),
  );
  await send.click();
  await expect(dialog.getByRole('alert')).toContainText('Meta no respondió');
  await expect(dialog.getByRole('img', { name: 'Imagen de la plantilla' })).toBeVisible();
  await expect(dialog.locator('.template-file')).toContainText('foto.png');
  await page.screenshot({ path: testInfo.outputPath('plantilla-imagen.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Quitar archivo', exact: true }).click();
  await expect(send).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cerrar plantillas' }).click();
  await f.api.dispose();
});

test('webhook: las respuestas a botones muestran su texto y abren la ventana de atención', async () => {
  const f = await context();
  const payload = inbound(f.account);
  Object.assign(payload.entry[0].changes[0].value.messages[0], {
    type: 'button',
    text: undefined,
    button: { text: 'Necesito ayuda', payload: 'monzo:test:0' },
  });
  const [event] = await captureWebhook(db, Buffer.from(JSON.stringify(payload)));
  await processJob(db, { kind: 'inbox', id: event.id });
  const dto = await (
    await f.api.get(`/api/workspaces/${f.tenant.id}/conversations/${f.chat.id}`)
  ).json();
  expect(dto.messages.at(-1).text).toBe('Necesito ayuda');
  expect(dto.canReply).toBe(true);
  await f.api.dispose();
});
test('UX: plantilla pausada visible sin envío y acceso desde ventana cerrada', async ({
  page,
}, testInfo) => {
  const { f, dialog } = await openDialog(page);
  if (testInfo.project.name === 'mobile')
    await dialog.getByRole('button', { name: 'Volver a plantillas' }).click();
  await dialog.getByLabel('Estado de la plantilla').selectOption('ALL');
  await dialog.getByRole('button', { name: /mensaje pausado/ }).click();
  await expect(
    dialog.getByRole('button', { name: 'Enviar plantilla', exact: true }),
  ).toBeDisabled();
  await expect(dialog.locator('.template-warning')).toContainText('Solo se pueden enviar');
  await dialog.getByRole('button', { name: 'Cerrar plantillas' }).click();
  await db.conversation.update({
    where: { id: f.chat.id },
    data: { lastInboundAt: new Date(Date.now() - 48 * 3600000) },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Elegir plantilla' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar plantillas' }).click();
  await f.api.dispose();
});
