import { test, expect } from '@playwright/test';
import { fixture, db } from './helpers/whatsapp';
import { randomUUID } from 'node:crypto';
test.afterAll(() => db.$disconnect());
async function setup() {
  const f = await fixture();
  const contact = await db.contact.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      waId: '15550001234',
      name: 'Perfil WhatsApp',
    },
  });
  const conversation = await db.conversation.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      contactId: contact.id,
      automationPaused: false,
      lastInboundAt: new Date(),
      automationState: {
        flowId: 'fixture',
        version: 1,
        nodeId: 'done',
        status: 'completed',
        misses: 0,
        runId: randomUUID(),
        variables: { nombre: 'Cliente Luna', correo: 'luna@example.test', interes: 'Mayorista' },
      },
    },
  });
  const base = `/api/workspaces/${f.tenant.id}/contacts`;
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  return { ...f, contact, conversation, base };
}
function profile(revision = 1) {
  return {
    crmName: 'Cliente Luna',
    email: 'luna@example.test',
    company: 'Tienda Luna',
    salesStage: 'FOLLOW_UP',
    tags: ['Mayorista', 'Prioridad'],
    ownerUserId: null,
    profileNotes: 'Cliente interesado en catálogo.',
    crmRevision: revision,
  };
}
test('CRM: ficha persistente, filtros combinados y conversación independiente', async () => {
  const f = await setup();
  const before = await db.conversation.findUniqueOrThrow({ where: { id: f.conversation.id } });
  const response = await f.api.patch(`${f.base}/${f.contact.id}`, {
    data: { ...profile(), ownerUserId: f.user.id },
  });
  expect(response.ok()).toBe(true);
  const detail = await response.json();
  expect(detail.contact.crmRevision).toBe(2);
  expect(detail.answers).toHaveLength(3);
  for (const params of [
    'q=LUNA',
    'stage=FOLLOW_UP&owner=me&tag=Mayorista',
    'q=luna%40example.test',
    'q=Tienda',
    'q=Mayorista',
  ]) {
    const list = await f.api.get(`${f.base}?${params}`);
    expect(list.ok()).toBe(true);
    expect((await list.json()).map((c: { id: string }) => c.id)).toEqual([f.contact.id]);
  }
  expect(await (await f.api.get(`${f.base}?stage=CLOSED`)).json()).toEqual([]);
  expect(await (await f.api.get(`${f.base}?owner=unassigned`)).json()).toEqual([]);
  const after = await db.conversation.findUniqueOrThrow({ where: { id: f.conversation.id } });
  expect(after.automationState).toEqual(before.automationState);
  expect(after.automationPaused).toBe(false);
  expect(after.assignedUserId).toBe(null);
  expect(after.status).toBe('OPEN');
  await db.conversation.update({ where: { id: f.conversation.id }, data: { automationState: {} } });
  await db.contact.update({
    where: { id: f.contact.id },
    data: { name: 'Otro nombre de WhatsApp' },
  });
  const final = await (await f.api.get(`${f.base}/${f.contact.id}`)).json();
  expect(final.contact.crmName).toBe('Cliente Luna');
  expect(final.contact.profileNotes).toBe(profile().profileNotes);
  expect(final.answers).toEqual([]);
});
test('CRM: aislamiento, origen, validaciones y revisiones concurrentes', async () => {
  const a = await setup(),
    b = await setup();
  expect((await a.api.get(`${a.base}/${b.contact.id}`)).status()).toBe(403);
  expect((await a.api.patch(`${b.base}/${b.contact.id}`, { data: profile() })).status()).toBe(403);
  expect(
    (
      await a.api.patch(`${a.base}/${a.contact.id}`, {
        headers: { origin: 'https://wrong.example' },
        data: profile(),
      })
    ).status(),
  ).toBe(403);
  for (const data of [
    { ...profile(), salesStage: 'WON' },
    { ...profile(), email: 'not-an-email' },
    { ...profile(), tags: Array(13).fill('tag') },
    { ...profile(), tags: ['a,b'] },
    { ...profile(), tenantId: b.tenant.id },
  ])
    expect((await a.api.patch(`${a.base}/${a.contact.id}`, { data })).status()).toBe(400);
  expect(
    (
      await a.api.patch(`${a.base}/${a.contact.id}`, {
        data: { ...profile(), ownerUserId: b.user.id },
      })
    ).status(),
  ).toBe(403);
  const results = await Promise.all(
    ['A', 'B'].map((crmName) =>
      a.api.patch(`${a.base}/${a.contact.id}`, { data: { ...profile(), crmName } }),
    ),
  );
  expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
  const saved = await db.contact.findUniqueOrThrow({ where: { id: a.contact.id } });
  expect(saved.crmRevision).toBe(2);
  expect(['A', 'B']).toContain(saved.crmName);
  expect((await a.api.get(`${a.base}?stage=invalid`)).status()).toBe(400);
  const ownList = await (await a.api.get(a.base)).json();
  expect(ownList.map((c: { id: string }) => c.id)).not.toContain(b.contact.id);
});
test('CRM: miembro se asigna a sí mismo, revocación y responsable que dejó la empresa', async () => {
  const f = await setup(),
    colleague = await fixture();
  await db.membership.create({
    data: { tenantId: f.tenant.id, userId: colleague.user.id, role: 'MEMBER' },
  });
  await db.membership.update({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    data: { role: 'MEMBER' },
  });
  expect(
    (
      await f.api.patch(`${f.base}/${f.contact.id}`, {
        data: { ...profile(), ownerUserId: colleague.user.id },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await f.api.patch(`${f.base}/${f.contact.id}`, {
        data: { ...profile(), ownerUserId: f.user.id },
      })
    ).status(),
  ).toBe(200);
  expect((await f.api.patch(`${f.base}/${f.contact.id}`, { data: profile(2) })).status()).toBe(200);
  await db.contact.update({
    where: { id: f.contact.id },
    data: { ownerUserId: colleague.user.id },
  });
  await db.membership.delete({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: colleague.user.id } },
  });
  expect(
    (
      await f.api.patch(`${f.base}/${f.contact.id}`, {
        data: { ...profile(3), ownerUserId: colleague.user.id },
      })
    ).status(),
  ).toBe(200);
  await db.membership.delete({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
  });
  expect((await f.api.patch(`${f.base}/${f.contact.id}`, { data: profile(4) })).status()).toBe(403);
});
test('CRM UI: incorporar respuestas, guardar, filtrar y abrir ficha desde el chat', async ({
  page,
}, info) => {
  const f = await setup();
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1366, height: 700 });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/contactos');
  const open = page.getByRole('button', { name: 'Abrir ficha de Perfil WhatsApp', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Ficha del contacto' });
  await expect(dialog.getByLabel('Nombre en la ficha')).toBeVisible();
  await dialog.locator('.crm-answers > summary').click();
  await dialog.getByLabel('Usar nombre en', { exact: true }).selectOption('crmName');
  await dialog.getByLabel('Usar correo en', { exact: true }).selectOption('email');
  await dialog.getByLabel('Usar interes en', { exact: true }).selectOption('profileNotes');
  await dialog.getByLabel('Estado comercial', { exact: true }).selectOption('FOLLOW_UP');
  await dialog.getByLabel('Empresa', { exact: true }).fill('Luna S.A.');
  await dialog.getByLabel('Etiquetas', { exact: true }).fill('Mayorista, Prioridad');
  await dialog.getByLabel('Responsable comercial').selectOption(f.user.id);
  await dialog.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Ficha guardada.');
  await page.screenshot({ path: `work/crm-profile-${info.project.name}.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Abrir ficha de Cliente Luna', exact: true }),
  ).toBeFocused();
  await page.getByLabel('Filtrar estado comercial').selectOption('FOLLOW_UP');
  await page.getByLabel('Filtrar responsable').selectOption('me');
  await expect(
    page.getByRole('button', { name: 'Abrir ficha de Cliente Luna', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `work/crm-list-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Abrir conversación de Cliente Luna' }).click();
  const composer = page.locator('.message-composer');
  await expect(composer).toBeInViewport();
  await page.getByRole('button', { name: 'Ficha del contacto', exact: true }).click();
  await expect(dialog.getByLabel('Correo electrónico')).toHaveValue('luna@example.test');
  await expect(dialog.getByLabel('Observaciones', { exact: true })).toHaveValue(
    'interes: Mayorista',
  );
  await page.keyboard.press('Escape');
  await expect(composer).toBeInViewport();
  await page.screenshot({ path: `work/crm-chat-${info.project.name}.png` });
});
test('CRM UI: fallo, Escape y conflicto conservan el borrador; recarga es explícita', async ({
  page,
}) => {
  const f = await setup();
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/contactos');
  await page.getByRole('button', { name: 'Ver ficha', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ficha del contacto' });
  await dialog.getByLabel('Empresa', { exact: true }).fill('Conservar borrador');
  await page.route(`**/contacts/${f.contact.id}`, async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fallo controlado' }),
      });
    else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Fallo controlado');
  page.once('dialog', (d) => d.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog.getByLabel('Empresa', { exact: true })).toHaveValue('Conservar borrador');
  await page.unroute(`**/contacts/${f.contact.id}`);
  await f.api.patch(`${f.base}/${f.contact.id}`, { data: profile() });
  await dialog.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Otra persona actualizó');
  await expect(dialog.getByLabel('Empresa', { exact: true })).toHaveValue('Conservar borrador');
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Recargar ficha' }).click();
  await expect(dialog.getByLabel('Empresa', { exact: true })).toHaveValue('Tienda Luna');
  await expect(dialog.getByRole('button', { name: 'Guardar ficha', exact: true })).toBeDisabled();
});
