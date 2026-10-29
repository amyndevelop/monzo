import { request as requestFactory, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes, createHmac } from 'node:crypto';
import { encryptToken } from '../../src/modules/whatsapp/core/crypto';
export const db = new PrismaClient();
export const origin = 'http://127.0.0.1:3100';
export const fakeToken = 'automated-test-token-not-a-real-meta-credential';
export async function fixture() {
  const ip = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const api = await requestFactory.newContext({
    baseURL: origin,
    extraHTTPHeaders: { origin, 'x-forwarded-for': ip },
  });
  const email = `whatsapp-${randomBytes(8).toString('hex')}@example.test`;
  const password = `Test-${randomBytes(16).toString('hex')}`;
  expect(
    (
      await api.post('/api/auth/sign-up/email', {
        data: { name: 'Operador de prueba', email, password },
      })
    ).ok(),
  ).toBe(true);
  // Email verification itself is exercised by auth-tenants.spec.ts. This fixture changes only its generated test user.
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  expect((await api.post('/api/auth/sign-in/email', { data: { email, password } })).ok()).toBe(
    true,
  );
  const response = await api.post('/api/workspaces', {
    data: { name: 'Empresa de prueba WhatsApp' },
  });
  expect(response.ok()).toBe(true);
  const tenant = await response.json();
  const suffix = randomBytes(6).readUIntBE(0, 6).toString();
  const phoneNumberId = '1' + suffix;
  const businessAccountId = '2' + suffix;
  const account = await db.whatsappAccount.create({
    data: {
      tenantId: tenant.id,
      phoneNumberId,
      businessAccountId,
      displayPhone: 'Número de pruebas automatizadas',
      displayName: 'Fixture de pruebas',
      tokenEncrypted: encryptToken(fakeToken, tenant.id, phoneNumberId),
      enabled: true,
      verifiedAt: new Date(),
    },
  });
  return { api, user, tenant, account, ip };
}
export function inbound(
  account: { phoneNumberId: string; businessAccountId: string },
  id = 'wamid.' + randomBytes(9).toString('hex'),
  text = 'Consulta de prueba',
  ageSeconds = 0,
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: account.businessAccountId,
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: account.phoneNumberId },
              contacts: [{ wa_id: '5491112345678', profile: { name: 'Cliente de prueba' } }],
              messages: [
                {
                  id,
                  from: '5491112345678',
                  timestamp: String(Math.floor(Date.now() / 1000) - ageSeconds),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
export async function deliver(
  api: APIRequestContext,
  payload: unknown,
  secret = process.env.WHATSAPP_APP_SECRET!,
) {
  const raw = JSON.stringify(payload);
  return api.post('/api/webhooks/whatsapp', {
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
    },
    data: raw,
  });
}
export async function receive(
  f: Awaited<ReturnType<typeof fixture>>,
  text = 'Consulta de prueba',
  ageSeconds = 0,
) {
  const payload = inbound(f.account, undefined, text, ageSeconds);
  expect((await deliver(f.api, payload)).ok()).toBe(true);
  let conversationId = '';
  await expect
    .poll(
      async () => {
        const conversation = await db.conversation.findFirst({
          where: { tenantId: f.tenant.id, accountId: f.account.id },
        });
        conversationId = conversation?.id ?? '';
        return Boolean(conversation);
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return conversationId;
}
export function receipt(
  account: { phoneNumberId: string; businessAccountId: string },
  id: string,
  status: string,
  callback?: string,
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: account.businessAccountId,
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: account.phoneNumberId },
              statuses: [
                {
                  id,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...(callback ? { biz_opaque_callback_data: callback } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
export async function queued(
  api: APIRequestContext,
  tenantId: string,
  conversationId: string,
  text = 'Respuesta de prueba',
  key = crypto.randomUUID(),
) {
  const response = await api.post(
    `/api/workspaces/${tenantId}/conversations/${conversationId}/messages`,
    { data: { text, idempotencyKey: key } },
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
