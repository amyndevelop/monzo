import { test, expect } from '@playwright/test';
import { fixture, db } from './helpers/whatsapp';
import { analyticsFilters, loadAnalytics } from '../src/modules/analytics/core';
import { randomUUID } from 'node:crypto';
import type { MessageDirection, MessageStatus } from '@prisma/client';
test.afterAll(() => db.$disconnect());
async function seeded() {
  const f = await fixture();
  await db.tenantSettings.update({
    where: { tenantId: f.tenant.id },
    data: { timezone: 'America/New_York' },
  });
  const contact = await db.contact.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      waId: '15551230000',
      name: 'Private analytics fixture',
    },
  });
  const conversation = await db.conversation.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      contactId: contact.id,
      createdAt: new Date('2026-02-01T00:00:00Z'),
      status: 'OPEN',
    },
  });
  const flow = await db.automationFlow.create({
    data: { tenantId: f.tenant.id, accountId: f.account.id, draft: {}, publishedVersion: 1 },
  });
  const second = await db.whatsappAccount.create({
    data: {
      tenantId: f.tenant.id,
      phoneNumberId: '3' + randomUUID().replaceAll('-', ''),
      businessAccountId: 'fixture-only',
      displayName: 'Segundo canal',
      displayPhone: 'Número secundario',
    },
  });
  const otherContact = await db.contact.create({
    data: { tenantId: f.tenant.id, accountId: second.id, waId: '15551230001' },
  });
  const other = await db.conversation.create({
    data: {
      tenantId: f.tenant.id,
      accountId: second.id,
      contactId: otherContact.id,
      status: 'CLOSED',
      createdAt: new Date('2026-03-08T06:00:00Z'),
    },
  });
  async function message(
    direction: MessageDirection,
    status: MessageStatus,
    at: string,
    kind?: string,
    otherChannel = false,
  ) {
    return db.message.create({
      data: {
        tenantId: f.tenant.id,
        accountId: otherChannel ? second.id : f.account.id,
        conversationId: otherChannel ? other.id : conversation.id,
        direction,
        status,
        type: 'text',
        text: 'PRIVATE_MESSAGE_NOT_FOR_ANALYTICS',
        createdAt: new Date(at),
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        ...(kind ? { automationFlowId: flow.id, automationSnapshot: { kind } } : {}),
      },
    });
  }
  await message('INBOUND', 'RECEIVED', '2026-03-08T04:59:59Z'); // Previous local day.
  await message('INBOUND', 'RECEIVED', '2026-03-08T05:00:00Z'); // First instant of selected day.
  await message('INBOUND', 'RECEIVED', '2026-03-09T03:59:59Z'); // Last second: DST day is 23h.
  await message('INBOUND', 'RECEIVED', '2026-03-09T04:00:00Z'); // Next local day.
  for (const [status, kind] of [
    ['SENT', 'menu'],
    ['DELIVERED', 'capture'],
    ['READ', 'message'],
    ['SENT', 'handoff'],
    ['FAILED', 'message'],
    ['UNKNOWN', 'handoff'],
    ['QUEUED', 'capture'],
    ['CANCELED', 'message'],
    ['SENDING', undefined],
  ] as const)
    await message('OUTBOUND', status, '2026-03-08T12:00:00Z', kind);
  await message('INBOUND', 'RECEIVED', '2026-03-08T12:00:00Z', undefined, true);
  await message('OUTBOUND', 'READ', '2026-03-08T12:00:00Z', undefined, true);
  return { ...f, second, conversation };
}
const selected = { from: '2026-03-08', to: '2026-03-08' };
test('filtros: calendario local, rango máximo, fechas reales y parámetros estrictos', () => {
  const now = new Date('2026-03-09T02:00:00Z');
  expect(analyticsFilters({}, 'America/New_York', now)).toMatchObject({
    from: '2026-03-02',
    to: '2026-03-08',
  });
  for (const input of [
    { from: '2026-02-29', to: '2026-03-01' },
    { from: '2026-03-01' },
    { from: '2026-03-08', to: '2026-03-07' },
    { from: '2025-01-01', to: '2026-03-08' },
    { days: '900' },
    { ...selected, days: '7' },
    { to: '2026-03-09', from: '2026-03-09' },
    { tenantId: 'foreign' },
    { from: '2026-13-01', to: '2026-13-02' },
  ])
    expect(() => analyticsFilters(input, 'America/New_York', now)).toThrow();
});
test('agregados: límites DST, estados actuales, resultados de pasos y aislamiento por canal/empresa', async () => {
  const f = await seeded();
  const scoped = await loadAnalytics(db, f.tenant.id, { ...selected, accountId: f.account.id });
  expect(scoped.days).toEqual([{ date: '2026-03-08', inbound: 2, outbound: 9 }]);
  expect(scoped.messages).toMatchObject({
    inbound: 2,
    outbound: 9,
    accepted: 4,
    delivered: 2,
    read: 1,
    statuses: {
      SENT: 2,
      DELIVERED: 1,
      READ: 1,
      FAILED: 1,
      UNKNOWN: 1,
      CANCELED: 1,
      QUEUED: 1,
      SENDING: 1,
    },
  });
  expect(scoped.conversations).toEqual({ active: 1, new: 0, open: 1, closed: 0, unassigned: 1 });
  expect(scoped.flows[0]).toMatchObject({
    registered: 8,
    accepted: 4,
    menus: 1,
    captures: 1,
    finals: 1,
    handoffs: 1,
    failed: 1,
    unknown: 1,
    pending: 1,
    canceled: 1,
  });
  const all = await loadAnalytics(db, f.tenant.id, selected);
  expect(all.messages).toMatchObject({ inbound: 3, outbound: 10, accepted: 5 });
  expect(all.conversations).toEqual({ active: 2, new: 1, open: 1, closed: 1, unassigned: 1 });
  const empty = await loadAnalytics(db, f.tenant.id, { from: '2026-03-01', to: '2026-03-03' });
  expect(empty.days).toHaveLength(3);
  expect(empty.days.every((day) => day.inbound === 0 && day.outbound === 0)).toBe(true);
  expect(empty.messages.inbound).toBe(0);
  expect(JSON.stringify(all)).not.toContain('PRIVATE_MESSAGE');
  expect(JSON.stringify(all)).not.toContain('Private analytics fixture');
  expect(JSON.stringify(all)).not.toContain('tokenEncrypted');
  const foreign = await fixture();
  await expect(
    loadAnalytics(db, f.tenant.id, { ...selected, accountId: foreign.account.id }),
  ).rejects.toMatchObject({ status: 404 });
  expect((await loadAnalytics(db, foreign.tenant.id, selected)).messages.inbound).toBe(0);
  await db.message.updateMany({
    where: {
      tenantId: f.tenant.id,
      automationSnapshot: { path: ['kind'], equals: 'message' },
      status: 'READ',
    },
    data: { status: 'FAILED' },
  });
  expect((await loadAnalytics(db, f.tenant.id, selected)).flows[0].finals).toBe(0);
});
test('API: sesión, membresía, parámetros, no-store y revocación', async ({ request }) => {
  const f = await fixture();
  const url = `/api/workspaces/${f.tenant.id}/analytics`;
  expect((await request.get(url)).status()).toBe(401);
  const result = await f.api.get(url);
  expect(result.status()).toBe(200);
  expect(result.headers()['cache-control']).toContain('no-store');
  const other = await fixture();
  expect((await other.api.get(url)).status()).toBe(403);
  for (const query of ['days=0', 'days=7&days=30', 'from=bad&to=bad', 'unexpected=1'])
    expect((await f.api.get(url + '?' + query)).status()).toBe(400);
  expect((await f.api.get(url + '?accountId=' + other.account.id)).status()).toBe(404);
  await db.membership.update({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    data: { role: 'MEMBER' },
  });
  expect((await f.api.get(url)).status()).toBe(200);
  await db.membership.delete({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
  });
  expect((await f.api.get(url)).status()).toBe(403);
});
test('UI: filtros, gráfico, CSV, errores recuperables y navegación por teclado', async ({
  page,
}, testInfo) => {
  const f = await seeded();
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/analiticas');
  await expect(page.getByRole('heading', { name: 'Sin actividad en este período' })).toBeVisible();
  await page.getByLabel('Desde', { exact: true }).fill(selected.from);
  await page.getByLabel('Hasta (inclusive)').fill(selected.to);
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(
    page
      .locator('.analytics-metric')
      .filter({ has: page.getByRole('heading', { name: 'Mensajes recibidos', exact: true }) })
      .locator('strong'),
  ).toHaveText('3');
  await page.getByText('Ver datos por día', { exact: true }).click();
  await expect(page.getByRole('cell', { name: '10', exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar CSV diario' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain('2026-03-08,3,10');
  let fail = true;
  await page.route('**/analytics?*', async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fallo controlado de analíticas' }),
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.locator('.analytics-panel').getByRole('alert')).toContainText(
    'Fallo controlado',
  );
  await expect(page.getByLabel('Desde', { exact: true })).toHaveValue(selected.from);
  await expect(page.locator('.analytics-metric')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Actividad por día', exact: true })).toBeVisible();
  await page
    .locator('section.analytics-card')
    .filter({ has: page.getByRole('heading', { name: 'Resultados de los flujos', exact: true }) })
    .screenshot({ path: `work/analytics-flows-${testInfo.project.name}.png` });
  await page
    .locator('.analytics-chart')
    .screenshot({ path: `work/analytics-chart-${testInfo.project.name}.png` });
  await page.getByLabel('Canal', { exact: true }).selectOption(f.second.id);
  await expect(page.getByRole('button', { name: 'Descargar CSV diario' })).toBeDisabled();
  await expect(page.getByText('Hay cambios en los filtros.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(
    page
      .locator('.analytics-metric')
      .filter({ has: page.getByRole('heading', { name: 'Mensajes recibidos', exact: true }) })
      .locator('strong'),
  ).toHaveText('1');
  await page.getByRole('button', { name: 'Aplicar filtros' }).focus();
  await expect(page.getByRole('button', { name: 'Aplicar filtros' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `work/analytics-${testInfo.project.name}.png`, fullPage: true });
});

test('calendario: día de 25 horas y zona de desplazamiento fijo', async () => {
  const f = await fixture();
  await db.tenantSettings.update({
    where: { tenantId: f.tenant.id },
    data: { timezone: 'America/New_York' },
  });
  const contact = await db.contact.create({
    data: { tenantId: f.tenant.id, accountId: f.account.id, waId: '15559870000' },
  });
  const c = await db.conversation.create({
    data: { tenantId: f.tenant.id, accountId: f.account.id, contactId: contact.id },
  });
  for (const at of [
    '2026-11-01T03:59:59Z',
    '2026-11-01T04:00:00Z',
    '2026-11-02T04:59:59Z',
    '2026-11-02T05:00:00Z',
  ])
    await db.message.create({
      data: {
        tenantId: f.tenant.id,
        accountId: f.account.id,
        conversationId: c.id,
        direction: 'INBOUND',
        status: 'RECEIVED',
        type: 'text',
        createdAt: new Date(at),
        occurredAt: new Date(at),
      },
    });
  const report = await loadAnalytics(
    db,
    f.tenant.id,
    { from: '2026-11-01', to: '2026-11-01' },
    new Date('2026-11-03T00:00:00Z'),
  );
  expect(report.messages.inbound).toBe(2);
  expect(report.days[0].inbound).toBe(2);
  await db.tenantSettings.update({
    where: { tenantId: f.tenant.id },
    data: { timezone: '+05:30' },
  });
  const fixed = await loadAnalytics(
    db,
    f.tenant.id,
    { from: '2026-11-01', to: '2026-11-01' },
    new Date('2026-11-03T00:00:00Z'),
  );
  expect(fixed.messages.inbound).toBe(2);
  expect(fixed.days[0].inbound).toBe(2);
});
