import { test, expect } from '@playwright/test';
import { fixture, db } from './helpers/whatsapp';
import { mutateVariable } from '../src/modules/automations/variable-registry';
import { mutateFlow } from '../src/modules/automations/core';
import { variableExample } from '../src/modules/automations/examples';
test.afterAll(() => db.$disconnect());
async function setup() {
  const f = await fixture();
  const { graph } = variableExample();
  for (const variable of graph.variables!)
    await mutateVariable(db, f.tenant.id, f.user.id, { action: 'create', variable });
  await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'save',
    revision: 0,
    graph,
  });
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  return f;
}
test('constructor: acciones a la vista, scroll independiente, búsqueda, variables y navegación', async ({
  page,
}, testInfo) => {
  const f = await setup();
  if (testInfo.project.name === 'desktop') await page.setViewportSize({ width: 1366, height: 640 });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/automatizaciones');
  await expect(
    page.getByRole('button', { name: 'Guardar borrador', exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole('button', { name: 'Publicar y activar', exact: true }),
  ).toBeInViewport();
  await expect(page.getByLabel('Buscar un paso')).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    const inspector = page.getByRole('region', { name: 'Editor del paso' });
    await inspector.evaluate((e) => (e.scrollTop = e.scrollHeight));
  }
  await page.getByLabel('Buscar un paso').fill('Servicio');
  await page.locator('.flow-node').filter({ hasText: 'Servicio' }).first().click();
  await expect(page.getByLabel('Título del paso')).toHaveValue('Servicio');
  await expect(page.getByLabel('Título del paso')).toBeInViewport();
  await expect(
    page.getByRole('button', { name: 'Guardar borrador', exact: true }),
  ).toBeInViewport();
  await page.getByLabel('Nombre del flujo').fill('Mi borrador UX');
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Variables', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Variables', exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Nombre del flujo')).toHaveValue('Mi borrador UX');
  await expect(page.getByRole('button', { name: 'Variables', exact: true })).toBeFocused();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Árbol', exact: true }).click();
  await page.getByLabel('Buscar un paso').fill('');
  await page.screenshot({ path: `work/automation-split-view-${testInfo.project.name}.png` });
  const toggle = page.locator('.flow-studio-header [data-navigation-toggle]');
  await toggle.click();
  if (testInfo.project.name === 'mobile') {
    await expect(page.getByRole('dialog', { name: 'Menú principal' })).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Menú principal' })
      .getByRole('button', { name: 'Cerrar navegación', exact: true })
      .click();
  } else await expect(page.locator('.dashboard-sidebar')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(
    true,
  );
  await page.screenshot({ path: `work/automation-workspace-${testInfo.project.name}.png` });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Editar paso', exact: true }).click();
  await page.screenshot({ path: `work/automation-inspector-${testInfo.project.name}.png` });
});
test('constructor: agregar un paso abre su edición y los errores mantienen el borrador', async ({
  page,
}, testInfo) => {
  const f = await setup();
  if (testInfo.project.name === 'desktop') await page.setViewportSize({ width: 1366, height: 640 });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/automatizaciones');
  await page.locator('.flow-add-menu > summary').click();
  await page.getByRole('button', { name: 'Asignar variable', exact: true }).click();
  await expect(page.getByLabel('Título del paso')).toBeVisible();
  await page.getByLabel('Título del paso').fill('Paso nuevo sin perder');
  await page.route('**/automations/' + f.account.id, async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fallo controlado del constructor' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Fallo controlado' })).toBeVisible();
  await expect(page.getByLabel('Título del paso')).toHaveValue('Paso nuevo sin perder');
  await expect(
    page.getByRole('button', { name: 'Guardar borrador', exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: /Revisar \d+ avis/ }).click();
  await expect(page.getByRole('dialog', { name: 'Revisar flujo', exact: true })).toContainText(
    'asignación',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Título del paso')).toHaveValue('Paso nuevo sin perder');
});
