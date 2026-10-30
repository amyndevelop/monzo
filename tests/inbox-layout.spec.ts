import { test, expect, type Page } from '@playwright/test';
import { fixture, db, inbound } from './helpers/whatsapp';
import { captureWebhook } from '../src/modules/whatsapp/core/ingest';
import { processJob } from '../src/modules/whatsapp/core/qstash';

test.afterAll(() => db.$disconnect());
async function openChat(page: Page) {
  const f = await fixture();
  const events = await captureWebhook(db, Buffer.from(JSON.stringify(inbound(f.account))));
  await processJob(db, { kind: 'inbox', id: events[0].id });
  const conversation = await db.conversation.findFirstOrThrow({
    where: { accountId: f.account.id },
  });
  await db.message.createMany({
    data: Array.from({ length: 30 }, (_, index) => ({
      tenantId: f.tenant.id,
      accountId: f.account.id,
      conversationId: conversation.id,
      direction: index % 2 ? ('OUTBOUND' as const) : ('INBOUND' as const),
      status: index % 2 ? ('SENT' as const) : ('RECEIVED' as const),
      type: 'text',
      text: `Mensaje de prueba ${index + 1}. Conversación para comprobar el desplazamiento del historial.`,
      occurredAt: new Date(),
    })),
  });
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/conversaciones?conversation=' + conversation.id);
  await expect(page.getByLabel('Mensaje de WhatsApp', { exact: true })).toBeVisible();
  return f;
}
async function fitsScreen(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        const inbox = document.querySelector('.inbox')!.getBoundingClientRect();
        const composer = document.querySelector('.composer-row')!.getBoundingClientRect();
        return (
          root.scrollHeight <= innerHeight + 1 &&
          root.scrollWidth <= innerWidth + 1 &&
          Math.abs(inbox.top) < 1 &&
          Math.abs(inbox.bottom - innerHeight) < 1 &&
          composer.bottom <= innerHeight &&
          composer.top >= 0
        );
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

test('chat ocupa el viewport, el menú se oculta sin perder el borrador y otras páginas conservan su estructura', async ({
  page,
}, testInfo) => {
  const f = await openChat(page);
  const main = page.getByRole('main');
  const navigation = page.getByRole('navigation', { name: 'Navegación privada' });
  const draft = page.getByLabel('Mensaje de WhatsApp', { exact: true });
  await draft.fill('Borrador que debe conservarse');
  await fitsScreen(page);
  const history = page.getByRole('log', { name: 'Historial de mensajes' });
  expect(await history.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  await history.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await history.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await fitsScreen(page);

  if (testInfo.project.name === 'desktop') {
    await expect(navigation).toBeVisible();
    const before = (await main.boundingBox())!.width;
    await main.getByRole('button', { name: 'Ocultar menú', exact: true }).click();
    await expect(navigation).toBeHidden();
    await expect.poll(async () => (await main.boundingBox())!.width).toBeGreaterThan(before);
    expect((await main.boundingBox())!.x).toBe(0);
    await expect(draft).toHaveValue('Borrador que debe conservarse');
    await fitsScreen(page);
    await page.screenshot({
      path: testInfo.outputPath('chat-fullscreen-collapsed.png'),
      fullPage: true,
    });
    await main.getByRole('button', { name: 'Mostrar menú', exact: true }).click();
    await expect(navigation).toBeVisible();
    await fitsScreen(page);
    await page.screenshot({ path: testInfo.outputPath('chat-fullscreen.png'), fullPage: true });
    // A collapsed chat must not hide navigation on a different dashboard page.
    await main.getByRole('button', { name: 'Ocultar menú', exact: true }).click();
    await main.getByRole('link', { name: 'Canales →', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Canales.' })).toBeVisible();
    await expect(navigation).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
    await navigation.getByRole('link', { name: 'Conversaciones', exact: true }).click();
    await expect(main.getByRole('button', { name: 'Mostrar menú', exact: true })).toBeVisible();
  } else {
    await expect(navigation).toBeHidden();
    const trigger = main.getByRole('button', { name: 'Abrir navegación', exact: true });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: 'Menú principal' });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole('button', { name: 'Cerrar navegación', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(draft).toHaveValue('Borrador que debe conservarse');
    await fitsScreen(page);
    await page.screenshot({ path: testInfo.outputPath('chat-fullscreen.png'), fullPage: true });
    await trigger.click();
    await drawer.getByRole('link', { name: 'Canales', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Canales.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir navegación', exact: true })).toBeVisible();
  }
  await f.api.dispose();
});

test('el compositor sigue accesible con ventanas pequeñas y al cambiar la orientación', async ({
  page,
}, testInfo) => {
  const f = await openChat(page);
  const sizes =
    testInfo.project.name === 'desktop'
      ? [
          { width: 1366, height: 642 },
          { width: 820, height: 600 },
          { width: 390, height: 640 },
          { width: 844, height: 390 },
        ]
      : [
          { width: 390, height: 640 },
          { width: 390, height: 400 },
          { width: 844, height: 390 },
        ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await fitsScreen(page);
    await expect(page.getByLabel('Mensaje de WhatsApp', { exact: true })).toBeVisible();
    if (size.width <= 900) {
      await page
        .getByRole('main')
        .getByRole('button', { name: 'Abrir navegación', exact: true })
        .click();
      const drawer = page.getByRole('dialog', { name: 'Menú principal' });
      await expect(drawer).toBeVisible();
      await drawer.getByRole('button', { name: 'Cerrar navegación', exact: true }).click();
      await fitsScreen(page);
    }
  }
  await f.api.dispose();
});
