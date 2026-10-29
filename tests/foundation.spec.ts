import { test, expect } from '@playwright/test';
import { platformSections } from '../src/modules/platform/navigation';
import { requireTenantAccess } from '../src/modules/access/policy';

test('las operaciones quedan cerradas hasta implementar acceso verificado', () => {
  expect(() => requireTenantAccess()).toThrow('autenticación y autorización pendientes');
});

test('landing: identidad, recursos, anclas y demo accesible', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/MONZO/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-AR');
  const logo = page.locator('.site-header .brand-logo img');
  await expect(logo).toHaveAttribute('src', '/brand/logo/monzo-light.svg');
  await expect
    .poll(() => logo.evaluate((img) => (img as HTMLImageElement).naturalWidth > 0))
    .toBe(true);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Tus conversacionestrabajan por vos.',
  );
  await expect(page.getByRole('img', { name: /MONZO, nuestro asistente/ }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Ver funcionalidades', exact: true }).click();
  await expect(page).toHaveURL(/#funcionalidades$/);
  await expect(page.locator('#funcionalidades')).toContainText('No disponible todavía');
  await expect(page.locator('#funcionalidades .small-badge')).toHaveCount(4);
  for (const image of await page.locator('main img').all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  await page.evaluate(() => scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('landing.png'), fullPage: true });
  await page.getByRole('link', { name: 'Conocer el producto', exact: true }).click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hola, esto es MONZO');
  await expect(page.locator('.demo-banner')).toContainText('No hay una sesión real');
  expect(errors).toEqual([]);
});

test('dashboard: selector informativo, navegación completa y estados pendientes', async ({
  page,
}, testInfo) => {
  await page.goto('/dashboard');
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page.getByRole('button', { name: /Espacio de muestra/ }).click();
  await expect(page.locator('#workspace-note')).toContainText('Fase 2');
  for (const section of platformSections) {
    if (testInfo.project.name === 'mobile' && !(await page.locator('.sidebar-open').count()))
      await page.getByRole('button', { name: 'Abrir navegación' }).click();
    await page
      .getByRole('navigation', { name: 'Navegación del dashboard' })
      .getByRole('link', { name: section.label + ' Próximamente', exact: true })
      .click();
    await expect(page).toHaveURL(`/dashboard/${section.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(section.label + '.');
    await expect(page.locator('.coming-soon')).toContainText('Todavía no procesa datos');
    await expect(
      page.getByRole('link', { name: section.label + ' Próximamente', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: testInfo.outputPath('upcoming.png'), fullPage: true });
  await page.getByRole('link', { name: 'Volver al inicio', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
});

test('menú móvil y página inexistente', async ({ page }, testInfo) => {
  await page.goto('/');
  if (testInfo.project.name === 'mobile') {
    const menu = page.getByRole('button', { name: 'Abrir menú' });
    await menu.click();
    await expect(page.getByRole('button', { name: 'Cerrar menú' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page
      .getByRole('navigation', { name: 'Navegación móvil' })
      .getByRole('link', { name: 'Explorar demo' })
      .click();
    await expect(page).toHaveURL('/dashboard');
  }
  const response = await page.goto('/dashboard/no-existe');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Esta conversación empieza');
});

test('favicon y cabeceras básicas', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const icon = await request.get('/icon.png');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('image/png');
});
