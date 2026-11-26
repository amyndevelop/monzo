import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { fixture, db, origin } from './helpers/whatsapp';

async function control(
  api: APIRequestContext,
  operation: string,
  accountId: string,
  extra: object = {},
) {
  const url = process.env.EVO_TEST_CONTROL_URL,
    key = process.env.EVO_TEST_CONTROL_KEY;
  if (!url || !key || new URL(url).hostname !== '127.0.0.1')
    throw new Error(
      'Run with scripts/test-evolution-browser.mjs; controlled local provider required.',
    );
  const response = await api.post(url + operation, {
    headers: { 'x-test-key': key },
    data: { accountId, ...extra },
  });
  expect(response.ok()).toBe(true);
}
async function prepare(api: APIRequestContext, tenantId: string) {
  const phone = '54911' + randomBytes(4).readUIntBE(0, 4).toString();
  const response = await api.post(`/api/workspaces/${tenantId}/whatsapp/evolution/channels`, {
    data: { action: 'create', name: 'Atención de pruebas', phone },
  });
  expect(response.ok()).toBe(true);
  return { phone, ...((await response.json()) as { accountId: string; generation: number }) };
}

test('Evolution bot: importar precios, publicar, reanudar chat existente, menús numerados, asesor y pausa humana', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const f = await fixture(),
    prepared = await prepare(f.api, f.tenant.id);
  const accountId = prepared.accountId,
    path = `/api/workspaces/${f.tenant.id}/whatsapp/evolution/channels`;
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  expect(
    (
      await f.api.post(path, {
        data: { action: 'connect', accountId, generation: 1, idempotencyKey: crypto.randomUUID() },
      })
    ).ok(),
  ).toBe(true);
  await expect
    .poll(async () => (await (await f.api.get(path)).json()).sessions[0]?.qr, { timeout: 15000 })
    .toMatch(/^data:image/);
  await control(f.api, '/scan', accountId);
  await expect
    .poll(async () => (await (await f.api.get(path)).json()).sessions[0]?.state, { timeout: 15000 })
    .toBe('CONNECTED');
  await control(f.api, '/incoming', accountId, { text: 'Consulta anterior a publicar' });
  await expect
    .poll(() => db.conversation.count({ where: { accountId } }), { timeout: 15000 })
    .toBe(1);
  const chat = await db.conversation.findFirstOrThrow({ where: { accountId } });
  // This reproduces the user's already-attended test conversation.
  expect(
    (
      await f.api.post(`/api/workspaces/${f.tenant.id}/conversations/${chat.id}/messages`, {
        data: { text: 'Te atiendo desde MONZO', idempotencyKey: crypto.randomUUID() },
      })
    ).ok(),
  ).toBe(true);
  await expect
    .poll(() => db.message.count({ where: { accountId, direction: 'OUTBOUND', status: 'SENT' } }), {
      timeout: 15000,
    })
    .toBe(1);
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/automatizaciones');
  await page
    .getByRole('combobox', { name: 'Número de WhatsApp', exact: true })
    .selectOption(accountId);
  const create = page.getByRole('button', {
    name: 'Crear menú de servicios y precios',
    exact: true,
  });
  await create.click();
  const drawer = page.getByRole('dialog', {
    name: 'Crear menú de servicios y precios',
    exact: true,
  });
  const upload = drawer.getByLabel('Lista de servicios y precios CSV');
  const csv =
    'categoria;servicio;cantidad;precio;moneda\nRed A;Servicio A;100;990;ARS\nRed A;Servicio A;250;2160;ARS\nRed B;Servicio B;100;1450;ARS\n';
  await upload.setInputFiles({ name: 'lista.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(drawer.getByRole('status')).toHaveText('3 paquetes · 2 servicios · 2 categorías');
  await drawer.getByLabel('Mensaje de bienvenida').fill('Hola, elegí una categoría.');
  await upload.setInputFiles({
    name: 'incorrecta.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv.replace('990;ARS', '9.990;ARS')),
  });
  await expect(drawer.getByRole('alert')).toContainText('precio del paquete');
  await expect(drawer.getByRole('button', { name: 'Preparar borrador' })).toBeDisabled();
  await expect(drawer.getByLabel('Mensaje de bienvenida')).toHaveValue(
    'Hola, elegí una categoría.',
  );
  await upload.setInputFiles({ name: 'lista.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(drawer.getByRole('status')).toHaveText('3 paquetes · 2 servicios · 2 categorías');
  await drawer
    .locator('summary')
    .filter({ hasText: /^Red A/ })
    .click();
  await expect(drawer.getByRole('table', { name: 'Red A · Servicio A' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await drawer.screenshot({ path: `work/evolution-services-${testInfo.project.name}.png` });
  await page.keyboard.press('Escape');
  await expect(create).toBeFocused();
  await create.click();
  await expect(drawer.getByRole('status')).toHaveText('3 paquetes · 2 servicios · 2 categorías');
  await drawer.getByRole('button', { name: 'Preparar borrador' }).click();
  await expect(drawer).not.toBeVisible();
  // Replacing a populated draft needs a fresh explicit choice on every opening.
  await create.click();
  await expect(drawer.getByRole('button', { name: 'Preparar borrador' })).toBeDisabled();
  await drawer.getByRole('checkbox').check();
  await expect(drawer.getByRole('button', { name: 'Preparar borrador' })).toBeEnabled();
  await drawer.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await create.click();
  await expect(drawer.getByRole('checkbox')).not.toBeChecked();
  await expect(drawer.getByRole('button', { name: 'Preparar borrador' })).toBeDisabled();
  await drawer.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Borrador guardado.' })).toBeVisible();
  await page.getByRole('button', { name: 'Probar recorrido', exact: true }).click();
  const simulator = page.getByRole('dialog', { name: 'Probar recorrido', exact: true });
  await simulator.getByRole('button', { name: 'Red A', exact: true }).click();
  await simulator.getByRole('button', { name: 'Servicio A', exact: true }).click();
  await expect(simulator.getByText(/250:.*2\.160.*ARS/)).toBeVisible();
  await page.keyboard.press('Escape');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Publicar y activar', exact: true }).click();
  await expect(page.getByText('Publicado · Activo', { exact: true })).toBeVisible();
  const count = () => db.message.count({ where: { accountId, automationFlowId: { not: null } } });
  expect(await count()).toBe(0);
  expect(
    (await db.conversation.findUniqueOrThrow({ where: { id: chat.id } })).automationPaused,
  ).toBe(true);
  await page.getByRole('link', { name: 'abrí la conversación', exact: true }).click();
  await page.getByRole('button', { name: /Cliente de pruebas/ }).click();
  const draft = page.getByLabel('Mensaje de WhatsApp', { exact: true });
  await draft.fill('Borrador que debe conservarse');
  await page.getByRole('button', { name: 'Reanudar flujo', exact: true }).click();
  expect(await count()).toBe(0);
  const next = async (text: string, total: number, id?: string) => {
    await control(f.api, '/incoming', accountId, { text, ...(id ? { providerId: id } : {}) });
    await expect
      .poll(
        () =>
          db.message.count({
            where: { accountId, automationFlowId: { not: null }, status: 'SENT' },
          }),
        { timeout: 15000 },
      )
      .toBe(total);
    return db.message.findFirstOrThrow({
      where: { accountId, automationFlowId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
  };
  const first = await next('Hola', 1, 'AUTOMATION_START');
  expect(first.text).toContain('1. Red A');
  expect(first.text).toContain('2. Red B');
  await control(f.api, '/incoming', accountId, { text: 'Hola', providerId: 'AUTOMATION_START' });
  expect((await next('1', 2)).text).toContain('1. Servicio A');
  const prices = await next('1', 3);
  expect(prices.text).toMatch(/250:.*2\.160.*ARS/);
  expect(prices.text).toContain('1. Consultar compra');
  await expect(page.getByRole('log').getByText(/250:.*2\.160.*ARS/)).toBeVisible({
    timeout: 15000,
  });
  await next('1', 4);
  await expect(page.getByRole('button', { name: 'Reanudar flujo', exact: true })).toBeVisible({
    timeout: 15000,
  });
  const ignored = 'Pregunta después de derivar';
  await control(f.api, '/incoming', accountId, { text: ignored });
  await expect
    .poll(() => db.message.count({ where: { accountId, direction: 'INBOUND', text: ignored } }), {
      timeout: 15000,
    })
    .toBe(1);
  expect(await count()).toBe(4);
  await page.getByRole('button', { name: 'Reanudar flujo', exact: true }).click();
  await next('Hola otra vez', 5);
  await control(f.api, '/incoming', accountId, {
    text: 'Te atiendo desde el teléfono',
    fromMe: true,
  });
  await expect
    .poll(
      async () =>
        (await db.conversation.findUniqueOrThrow({ where: { id: chat.id } })).automationPaused,
      { timeout: 15000 },
    )
    .toBe(true);
  const afterHuman = 'Elijo después de la atención humana';
  await control(f.api, '/incoming', accountId, { text: afterHuman });
  await expect
    .poll(
      () => db.message.count({ where: { accountId, direction: 'INBOUND', text: afterHuman } }),
      { timeout: 15000 },
    )
    .toBe(1);
  expect(await count()).toBe(5);
  await expect(page.getByRole('button', { name: 'Reanudar flujo', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByRole('log').getByText('Te atiendo desde el teléfono', { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(draft).toHaveValue('Borrador que debe conservarse');
  await expect(
    page.getByText('El flujo comenzará con el próximo mensaje del cliente.', { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: `work/evolution-services-chat-${testInfo.project.name}.png` });
  await f.api.dispose();
});

test('Evolution UI: preparar, QR, número comprobado, conversación y respuesta con recibos; escritorio y móvil', async ({
  page,
}, testInfo) => {
  const f = await fixture();
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies(await f.api.storageState().then((s) => s.cookies));
  await page.goto('/dashboard/canales');
  const section = page.getByRole('region', { name: 'Vinculación de WhatsApp' });
  await expect(section.getByText('Tu WhatsApp, en MONZO')).toBeVisible();
  await section.getByLabel('Nombre de la conexión', { exact: true }).fill('Atención de pruebas');
  const phone = '54911' + randomBytes(4).readUIntBE(0, 4).toString();
  await section.getByLabel('Número con código de país', { exact: true }).fill('+' + phone);
  await section.getByRole('button', { name: 'Preparar número', exact: true }).click();
  const generate = section.getByRole('button', { name: 'Generar QR', exact: true });
  await expect(generate).toBeFocused();
  await generate.press('Enter');
  const image = section.getByRole('img', { name: 'QR para vincular el número +' + phone });
  await expect(image).toBeVisible({ timeout: 15000 });
  const session = await db.evolutionSession.findFirstOrThrow({
    where: { tenantId: f.tenant.id, expectedWaId: phone },
  });
  expect(session.qrEncrypted).not.toContain('LOCAL_TEST_QR');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await section.screenshot({ path: `work/evolution-link-${testInfo.project.name}.png` });
  await control(f.api, '/scan', session.accountId);
  await expect(section.getByText('Conectado', { exact: true })).toBeVisible({ timeout: 15000 });
  await control(f.api, '/incoming', session.accountId, {
    text: 'Consulta de mi número personal',
    providerId: 'LOCAL_DUPLICATE',
  });
  await control(f.api, '/incoming', session.accountId, {
    text: 'Consulta de mi número personal',
    providerId: 'LOCAL_DUPLICATE',
  });
  await section.getByRole('link', { name: 'Abrir conversaciones' }).click();
  await page.getByRole('button', { name: /Cliente de pruebas/ }).click();
  await expect(
    page.getByRole('log').getByText('Consulta de mi número personal', { exact: true }),
  ).toHaveCount(1, {
    timeout: 15000,
  });
  await page.getByLabel('Mensaje de WhatsApp', { exact: true }).fill('Te respondo desde MONZO');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(
    page.getByRole('log').getByText('Te respondo desde MONZO', { exact: true }),
  ).toBeVisible({
    timeout: 15000,
  });
  await expect
    .poll(
      async () =>
        db.message.count({
          where: {
            accountId: session.accountId,
            direction: 'OUTBOUND',
            status: 'SENT',
            text: 'Te respondo desde MONZO',
          },
        }),
      { timeout: 15000 },
    )
    .toBe(1);
  await control(f.api, '/read', session.accountId);
  await expect
    .poll(
      async () =>
        db.message.count({
          where: { accountId: session.accountId, direction: 'OUTBOUND', status: 'READ' },
        }),
      { timeout: 15000 },
    )
    .toBe(1);
  await expect(page.getByRole('log').getByText('Leído', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(
    true,
  );
  await page.screenshot({ path: `work/evolution-chat-${testInfo.project.name}.png` });
  await f.api.dispose();
});

test('Evolution UI: código vencido, renovación y teléfono equivocado con recuperación', async ({
  page,
}, testInfo) => {
  const f = await fixture(),
    prepared = await prepare(f.api, f.tenant.id);
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/canales');
  const section = page.getByRole('region', { name: 'Vinculación de WhatsApp' });
  await section.getByRole('button', { name: 'Generar QR', exact: true }).click();
  await expect(section.getByRole('img', { name: /QR para vincular/ })).toBeVisible({
    timeout: 15000,
  });
  await control(f.api, '/expire', prepared.accountId);
  await section.getByRole('button', { name: 'Actualizar estado', exact: true }).click();
  await expect(section.getByText('Código vencido', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(section.getByRole('img', { name: /QR para vincular/ })).toHaveCount(0);
  await section.getByRole('button', { name: 'Solicitar nuevo QR' }).click();
  await expect(section.getByRole('img', { name: /QR para vincular/ })).toBeVisible({
    timeout: 15000,
  });
  await control(f.api, '/scan', prepared.accountId, { wrongPhone: true });
  await expect(section.getByText(/Se escaneó desde otro número/)).toBeVisible({ timeout: 15000 });
  await expect(section.getByText('Conectado', { exact: true })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Volver a vincular' })).toBeEnabled();
  await section.screenshot({ path: `work/evolution-link-error-${testInfo.project.name}.png` });
  await f.api.dispose();
});

test('Evolution API: propietario ve QR; miembros no ven el código ni pueden operar y el origen es obligatorio', async () => {
  const f = await fixture(),
    member = await fixture(),
    prepared = await prepare(f.api, f.tenant.id);
  const path = `/api/workspaces/${f.tenant.id}/whatsapp/evolution/channels`;
  const response = await f.api.post(path, {
    data: {
      action: 'connect',
      accountId: prepared.accountId,
      generation: 1,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(response.ok()).toBe(true);
  await expect
    .poll(async () => (await (await f.api.get(path)).json()).sessions[0]?.qr, { timeout: 15000 })
    .toMatch(/^data:image\/png;base64,/);
  await db.membership.create({
    data: { tenantId: f.tenant.id, userId: member.user.id, role: 'MEMBER' },
  });
  const state = await (await member.api.get(path)).json();
  expect(state.canManage).toBe(false);
  expect(state.sessions[0].qr).toBeNull();
  expect(state.sessions[0].qrEncrypted).toBeUndefined();
  expect(
    (
      await member.api.post(path, {
        data: {
          action: 'disconnect',
          accountId: prepared.accountId,
          generation: 2,
          idempotencyKey: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await f.api.post(path, {
        headers: { origin: 'https://other.example.invalid' },
        data: {
          action: 'disconnect',
          accountId: prepared.accountId,
          generation: 2,
          idempotencyKey: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await f.api.post(path, {
        headers: { origin },
        data: {
          action: 'disconnect',
          accountId: prepared.accountId,
          generation: 2,
          idempotencyKey: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true);
  await expect
    .poll(async () => (await (await f.api.get(path)).json()).sessions[0]?.state, { timeout: 15000 })
    .toBe('DISCONNECTED');
  await f.api.dispose();
  await member.api.dispose();
});
