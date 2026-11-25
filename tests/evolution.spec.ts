import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { fixture, db } from './helpers/whatsapp';
import { evolutionConfiguration, checkEvolutionGateway } from '../src/modules/evolution/core';
import { evolutionProbe } from '../src/modules/evolution/probe';
import {
  PROTOCOL,
  PROBE_PATH,
  probeSignature,
  responseProof,
} from '../services/evolution-gateway/protocol.mjs';

test.afterAll(() => db.$disconnect());
const key = () => randomBytes(32).toString('hex');
test('Evolution: configuración y reportes rechazan destinos inseguros, versiones falsas y respuestas incoherentes', async () => {
  const env = {
    EVOLUTION_GATEWAY_URL: 'https://onlineboosty.com.ar',
    EVOLUTION_GATEWAY_KEY: key(),
    EVOLUTION_WEBHOOK_SECRET: key(),
    NODE_ENV: 'production',
  } as NodeJS.ProcessEnv;
  const config = evolutionConfiguration(env);
  expect(config.configured).toBe(true);
  for (const url of [
    'http://onlineboosty.com.ar',
    'https://secret@onlineboosty.com.ar',
    'https://onlineboosty.com.ar/private',
    'https://onlineboosty.com.ar?token=secret',
    'https://localhost',
  ])
    expect(evolutionConfiguration({ ...env, EVOLUTION_GATEWAY_URL: url }).configured).toBe(false);
  expect(
    evolutionConfiguration({ ...env, EVOLUTION_WEBHOOK_SECRET: env.EVOLUTION_GATEWAY_KEY })
      .configured,
  ).toBe(false);
  const report = await checkEvolutionGateway(
    config,
    'https://monzo.example.test',
    async (url, init) => {
      expect(url).toBe('https://onlineboosty.com.ar/v1/diagnostics');
      expect(init.redirect).toBe('error');
      const input = JSON.parse(init.body);
      expect(input.callbackUrl).toBe('https://monzo.example.test' + PROBE_PATH);
      return Response.json({
        protocol: PROTOCOL,
        challenge: input.challenge,
        checkedAt: new Date().toISOString(),
        evolution: { ok: true, code: 'OK', version: '2.3.8' },
        callback: { ok: true, code: 'OK' },
      });
    },
  );
  expect(report.ok).toBe(true);
  expect(JSON.stringify(report)).not.toContain(env.EVOLUTION_GATEWAY_KEY);
  for (const mismatch of ['challenge', 'version', 'consistency', 'time']) {
    await expect(
      checkEvolutionGateway(config, 'https://monzo.example.test', async (_url, init) =>
        Response.json({
          protocol: PROTOCOL,
          challenge: mismatch === 'challenge' ? key() : JSON.parse(init.body).challenge,
          checkedAt: new Date(mismatch === 'time' ? 0 : Date.now()).toISOString(),
          evolution:
            mismatch === 'consistency'
              ? { ok: false, code: 'EVOLUTION_AUTH' }
              : { ok: true, code: 'OK', version: mismatch === 'version' ? 'wrong' : '2.3.8' },
          callback: { ok: true, code: 'OK' },
        }),
      ),
    ).rejects.toThrow('INVALID_RESPONSE');
  }
  await expect(
    checkEvolutionGateway(config, 'https://monzo.example.test', async () =>
      Response.json({}, { status: 401 }),
    ),
  ).rejects.toThrow('GATEWAY_AUTH');
});

test('Evolution: callback real de Next verifica cuerpo y firma; no acepta mensajes ni cuerpos excesivos', async ({
  request,
}) => {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET!;
  const challenge = key(),
    nonce = randomBytes(16).toString('hex'),
    timestamp = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify({ kind: 'monzo.evolution.probe', challenge });
  const headers = {
    'content-type': 'application/json',
    'x-monzo-timestamp': timestamp,
    'x-monzo-nonce': nonce,
    'x-monzo-signature': probeSignature(secret, raw, timestamp, nonce),
  };
  const result = await request.post(PROBE_PATH, { headers, data: raw });
  expect(result.ok()).toBe(true);
  expect(await result.json()).toEqual({
    challenge,
    proof: responseProof(secret, challenge, nonce),
  });
  expect(result.headers()['cache-control']).toBe('no-store');
  expect((await request.post(PROBE_PATH, { headers, data: raw + ' ' })).status()).toBe(401);
  expect((await request.post(PROBE_PATH, { data: {} })).status()).toBe(401);
  expect((await request.post(PROBE_PATH, { headers, data: 'x'.repeat(3000) })).status()).toBe(413);
  const message = JSON.stringify({ kind: 'messages.upsert', challenge });
  expect(
    (
      await request.post(PROBE_PATH, {
        headers: {
          ...headers,
          'x-monzo-signature': probeSignature(secret, message, timestamp, nonce),
        },
        data: message,
      })
    ).status(),
  ).toBe(400);
  const old = String(Math.floor(Date.now() / 1000) - 120);
  expect(
    (
      await request.post(PROBE_PATH, {
        headers: {
          ...headers,
          'x-monzo-timestamp': old,
          'x-monzo-signature': probeSignature(secret, raw, old, nonce),
        },
        data: raw,
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await evolutionProbe(
        new Request('https://example.test', { method: 'POST', body: raw }),
        undefined,
      )
    ).status,
  ).toBe(503);
});

test('Evolution: acceso por empresa, comprobación reservada al propietario y origen obligatorio', async () => {
  const f = await fixture(),
    other = await fixture();
  const path = `/api/workspaces/${f.tenant.id}/whatsapp/evolution`;
  const owner = await (await f.api.get(path)).json();
  expect(owner.canCheck).toBe(true);
  expect(Object.keys(owner).sort()).toEqual(['canCheck', 'configurationMessage', 'configured']);
  expect((await other.api.get(path)).status()).toBe(403);
  expect(
    (await f.api.post(path, { headers: { origin: 'https://foreign.example' }, data: {} })).status(),
  ).toBe(403);
  expect(
    (await f.api.post(path, { data: { callbackUrl: 'https://untrusted.example' } })).status(),
  ).toBe(400);
  await db.membership.update({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    data: { role: 'MEMBER' },
  });
  expect((await (await f.api.get(path)).json()).canCheck).toBe(false);
  expect((await f.api.post(path, { data: {} })).status()).toBe(403);
});

test('Evolution UI: configuración pendiente, carga, error recuperable y resultado accesible sin desbordar', async ({
  page,
}, info) => {
  const f = await fixture();
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  const path = `/api/workspaces/${f.tenant.id}/whatsapp/evolution`;
  let configured = false,
    calls = 0;
  await page.route('**' + path, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          configured,
          canCheck: true,
          configurationMessage: configured
            ? 'Configuración cargada.'
            : 'El administrador debe completar la conexión del servidor.',
        },
      });
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (calls === 1)
      return route.fulfill({
        status: 502,
        json: { error: 'No pudimos conectar con el servidor. Revisá HTTPS y Nginx.' },
      });
    return route.fulfill({
      json: {
        ok: true,
        checkedAt: new Date().toISOString(),
        checks: [
          { name: 'service', ok: true, message: 'Evolution responde con la versión esperada.' },
          { name: 'credential', ok: true, message: 'Credencial aceptada.' },
          { name: 'callback', ok: true, message: 'Retorno autenticado.' },
        ],
      },
    });
  });
  await page.goto('/dashboard/canales');
  const card = page.getByRole('region', { name: 'Servidor de WhatsApp' });
  await expect(card.getByRole('button', { name: 'Comprobar servidor' })).toBeDisabled();
  await expect(
    card.getByText('El administrador debe completar la conexión del servidor.'),
  ).toBeVisible();
  configured = true;
  await page.reload();
  const button = card.getByRole('button', { name: 'Comprobar servidor' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: 'Comprobando servidor…' })).toBeDisabled();
  await expect(card.getByRole('alert')).toContainText('No pudimos conectar');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(card.getByText('Conexión comprobada', { exact: true })).toBeVisible();
  await expect(card.getByText('Retorno autenticado.', { exact: true })).toBeVisible();
  await expect(card.getByRole('alert')).toHaveCount(0);
  await card.screenshot({ path: `work/evolution-card-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
