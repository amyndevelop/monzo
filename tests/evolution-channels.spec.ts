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
