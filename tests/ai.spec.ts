import { test, expect } from '@playwright/test';
import { fixture, db } from './helpers/whatsapp';
import { saveAgent, runAgentTest, usageKey, dayWindow } from '../src/modules/ai/core';
import { defaultAgent } from '../src/modules/ai/schema';
import { generateTestReply, type GeminiTransport } from '../src/modules/ai/gemini';

const initialGeminiKey = process.env.GEMINI_API_KEY;
test.afterEach(() => {
  if (initialGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = initialGeminiKey;
});
test.afterAll(() => db.$disconnect());
const response = (value: unknown, status = 200): Awaited<ReturnType<GeminiTransport>> => ({
  ok: status === 200,
  status,
  text: async () => JSON.stringify(value),
});
const accepted: GeminiTransport = async () =>
  response({
    candidates: [
      {
        finishReason: 'STOP',
        content: { parts: [{ text: 'La tienda ficticia abre de 9 a 18.' }] },
      },
    ],
  });
const form = {
  ...defaultAgent,
  enabled: true,
  knowledge: 'Tienda ficticia Luna: horario de 9 a 18.',
};

test('Gemini: contrato acotado sin herramientas, historial ni clave en URL; errores privados', async () => {
  process.env.GEMINI_API_KEY = 'fixture-gemini-not-real';
  const result = await generateTestReply(form, 'Pregunta ficticia', async (url, init) => {
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(url).not.toContain(process.env.GEMINI_API_KEY!);
    expect(init.headers['x-goog-api-key']).toBe(process.env.GEMINI_API_KEY);
    const body = JSON.parse(init.body);
    expect(body.tools).toBeUndefined();
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Pregunta ficticia' }] }]);
    expect(body.generationConfig.maxOutputTokens).toBe(700);
    expect(init.redirect).toBe('error');
    return response({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [{ thought: true, text: 'No mostrar' }, { text: 'Respuesta ficticia' }],
          },
        },
      ],
    });
  });
  expect(result.text).toBe('Respuesta ficticia');
  for (const status of [400, 403, 404, 429, 500]) {
    let read = false;
    await expect(
      generateTestReply(form, 'Prueba', async () => ({
        ok: false,
        status,
        text: async () => {
          read = true;
          return 'fixture-gemini-not-real';
        },
      })),
    ).rejects.toMatchObject({
      code:
        status === 429
          ? 'PROVIDER_QUOTA'
          : status === 404
            ? 'MODEL_UNAVAILABLE'
            : status === 500
              ? 'PROVIDER_UNAVAILABLE'
              : 'PROVIDER_ACCESS',
    });
    expect(read).toBe(false);
  }
  for (const body of [
    {},
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Truncado' }] } }] },
  ])
    await expect(
      generateTestReply(form, 'Prueba', async () => response(body)),
    ).rejects.toMatchObject({ code: 'NO_COMPLETE_REPLY' });
  await expect(
    generateTestReply(form, 'Prueba', async () => {
      throw new Error('fixture-gemini-not-real');
    }),
  ).rejects.toMatchObject({ code: 'NETWORK' });
});

test('IA: aislamiento, roles, control de revisión y confirmación obligatoria', async () => {
  process.env.GEMINI_API_KEY = 'fixture-gemini-not-real';
  const first = await fixture();
  const second = await fixture();
  await expect(saveAgent(db, first.tenant.id, second.user.id, form)).rejects.toMatchObject({
    code: 'ACCESS',
  });
  await db.membership.create({
    data: { tenantId: first.tenant.id, userId: second.user.id, role: 'MEMBER' },
  });
  await expect(saveAgent(db, first.tenant.id, second.user.id, form)).rejects.toMatchObject({
    code: 'ACCESS',
  });
  const saved = await saveAgent(db, first.tenant.id, first.user.id, form);
  expect(saved.revision).toBe(1);
  await expect(saveAgent(db, first.tenant.id, first.user.id, form)).rejects.toMatchObject({
    code: 'CONFIG_CHANGED',
  });
  await expect(
    runAgentTest(
      db,
      first.tenant.id,
      first.user.id,
      { question: 'Prueba', fictional: false },
      accepted,
    ),
  ).rejects.toThrow();
  await expect(
    runAgentTest(
      db,
      first.tenant.id,
      first.user.id,
      { question: 'Prueba', fictional: true, conversationId: 'no-history' },
      accepted,
    ),
  ).rejects.toThrow();
  expect(await db.rateLimit.findUnique({ where: { key: usageKey(first.tenant.id) } })).toBeNull();
  expect(
    (
      await runAgentTest(
        db,
        first.tenant.id,
        second.user.id,
        { question: 'Horario ficticio', fictional: true },
        accepted,
      )
    ).text,
  ).toContain('ficticia');
});

test('IA: reserva concurrente respeta límite diario y no crea mensajes', async () => {
  process.env.GEMINI_API_KEY = 'fixture-gemini-not-real';
  const f = await fixture();
  await saveAgent(db, f.tenant.id, f.user.id, { ...form, dailyLimit: 1 });
  let calls = 0;
  const transport: GeminiTransport = async (...args) => {
    calls++;
    return accepted(...args);
  };
  const results = await Promise.allSettled(
    [1, 2, 3].map(() =>
      runAgentTest(db, f.tenant.id, f.user.id, { question: 'Prueba', fictional: true }, transport),
    ),
  );
  expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(calls).toBe(1);
  expect((await db.rateLimit.findUnique({ where: { key: usageKey(f.tenant.id) } }))?.count).toBe(1);
  expect(await db.message.count({ where: { tenantId: f.tenant.id } })).toBe(0);
});

test('IA: errores consumen intento y una pausa concurrente invalida el resultado', async () => {
  process.env.GEMINI_API_KEY = 'fixture-gemini-not-real';
  const f = await fixture();
  await saveAgent(db, f.tenant.id, f.user.id, form);
  await expect(
    runAgentTest(db, f.tenant.id, f.user.id, { question: 'Prueba', fictional: true }, async () =>
      response({}, 429),
    ),
  ).rejects.toMatchObject({ code: 'PROVIDER_QUOTA' });
  expect((await db.rateLimit.findUnique({ where: { key: usageKey(f.tenant.id) } }))?.count).toBe(1);
  await expect(
    runAgentTest(
      db,
      f.tenant.id,
      f.user.id,
      { question: 'Prueba', fictional: true },
      async (...args) => {
        await saveAgent(db, f.tenant.id, f.user.id, { ...form, enabled: false, revision: 1 });
        return accepted(...args);
      },
    ),
  ).rejects.toMatchObject({ code: 'CONFIG_CHANGED' });
  expect((await db.aiAgent.findUnique({ where: { tenantId: f.tenant.id } }))?.enabled).toBe(false);
});

test('API IA: sesión real, origen, tamaño y configuración por empresa', async () => {
  const f = await fixture();
  const other = await fixture();
  const base = `/api/workspaces/${f.tenant.id}/ai`;
  expect((await other.api.get(base)).status()).toBe(403);
  expect(
    (await f.api.put(base, { data: form, headers: { origin: 'https://foreign.test' } })).status(),
  ).toBe(403);
  expect(
    (await f.api.put(base, { data: { ...form, knowledge: 'a'.repeat(66000) } })).status(),
  ).toBe(413);
  const initial = await (await f.api.get(base)).json();
  expect(initial.agent.enabled).toBe(false);
  const saved = await f.api.put(base, { data: form });
  expect(saved.ok()).toBe(true);
  expect((await saved.json()).agent.revision).toBe(1);
  expect((await f.api.put(base, { data: form })).status()).toBe(409);
  expect(
    (await f.api.post(base + '/test', { data: { question: 'Prueba', fictional: true } })).status(),
  ).toBe(503);
});

test('UI IA: preparación visible, configuración, pruebas, borrador y foco', async ({
  page,
}, testInfo) => {
  const f = await fixture();
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies(await f.api.storageState().then((state) => state.cookies));
  const base = `/api/workspaces/${f.tenant.id}/ai`;
  await page.goto('/dashboard/agentes-ia');
  await expect(page.getByText('La conexión con Gemini está en preparación.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Probar respuesta' })).toBeDisabled();
  let state = {
    agent: { ...form, revision: 1 },
    configured: true,
    model: 'gemini-3.5-flash-lite',
    used: 0,
    resetsAt: new Date(Number(dayWindow()) + 86400000).toISOString(),
    canEdit: true,
  };
  await page.route('**' + base, async (route) => {
    if (route.request().method() === 'PUT')
      state = {
        ...state,
        agent: { ...route.request().postDataJSON(), revision: state.agent.revision + 1 },
      };
    await route.fulfill({ json: state });
  });
  await page.reload();
  await page.getByLabel('Nombre del agente').fill('Luna de prueba');
  await expect(page.getByRole('button', { name: 'Probar respuesta' })).toBeDisabled();
  await page.getByRole('button', { name: 'Guardar agente' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Configuración guardada' }),
  ).toBeVisible();
  await page.getByLabel('Pregunta ficticia').fill('¿Qué horario tiene la tienda ficticia?');
  await page.getByLabel('Confirmo que').check();
  await page.route('**' + base + '/test', (route) =>
    route.fulfill({ status: 429, json: { error: 'Cuota de prueba alcanzada.' } }),
  );
  await page.getByRole('button', { name: 'Probar respuesta' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Cuota de prueba alcanzada.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Pregunta ficticia')).toHaveValue(
    '¿Qué horario tiene la tienda ficticia?',
  );
  await page.route('**' + base + '/test', (route) =>
    route.fulfill({ json: { text: 'La tienda ficticia abre de 9 a 18.' } }),
  );
  await page.getByRole('button', { name: 'Probar respuesta' }).click();
  const heading = page.getByRole('heading', { name: 'Respuesta de prueba · Revisar' });
  await expect(heading).toBeFocused();
  await expect(page.getByText('La tienda ficticia abre de 9 a 18.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `work/ai-${testInfo.project.name}.png`, fullPage: true });
});
