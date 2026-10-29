import { test, expect } from '@playwright/test';
import { randomBytes, createHmac } from 'node:crypto';
import {
  fixture,
  db,
  inbound,
  deliver,
  receive,
  receipt,
  queued,
  fakeToken,
} from './helpers/whatsapp';
import { decryptToken, encryptToken } from '../src/modules/whatsapp/core/crypto';
import { processOutbound } from '../src/modules/whatsapp/core/outbound';
import { verifyAndSubscribe, type MetaFetch } from '../src/modules/whatsapp/core/meta';

test.afterAll(async () => {
  await db.$disconnect();
});

test('webhook: desafío, firma sobre cuerpo crudo, duplicados y recepción por worker real', async ({
  request,
}) => {
  const f = await fixture();
  expect(
    (
      await request.get(
        '/api/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=123&hub.verify_token=wrong',
      )
    ).status(),
  ).toBe(403);
  const verified = await request.get(
    '/api/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=123&hub.verify_token=' +
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  );
  expect(verified.status()).toBe(200);
  expect(await verified.text()).toBe('123');
  const payload = inbound(f.account);
  const raw = JSON.stringify(payload);
  expect(
    (
      await request.post('/api/webhooks/whatsapp', {
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256':
            'sha256=' +
            createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(raw).digest('hex'),
        },
        data: raw + ' ',
      })
    ).status(),
  ).toBe(403);
  expect((await request.post('/api/webhooks/whatsapp', { data: payload })).status()).toBe(403);
  expect((await deliver(f.api, payload, process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)).status()).toBe(
    403,
  );
  expect((await deliver(f.api, payload)).ok()).toBe(true);
  expect((await deliver(f.api, payload)).ok()).toBe(true);
  await expect
    .poll(() => db.message.count({ where: { accountId: f.account.id } }), { timeout: 15000 })
    .toBe(1);
  expect(await db.contact.count({ where: { tenantId: f.tenant.id } })).toBe(1);
  const conversation = await db.conversation.findFirstOrThrow({ where: { tenantId: f.tenant.id } });
  expect(conversation.unreadCount).toBe(1);
  expect(await db.whatsappWebhookEvent.count({ where: { accountId: f.account.id } })).toBe(1);
  expect(
    (await db.whatsappWebhookEvent.findFirstOrThrow({ where: { accountId: f.account.id } }))
      .payload,
  ).toBeNull();
  await f.api.dispose();
});

test('aislamiento de canales, contactos, hilos, cursores y acciones entre empresas', async () => {
  const a = await fixture();
  const b = await fixture();
  const chatA = await receive(a, 'Solo empresa A');
  const chatB = await receive(b, 'Solo empresa B');
  const base = `/api/workspaces/${a.tenant.id}`;
  expect((await a.api.get(`/api/workspaces/${b.tenant.id}/conversations`)).status()).toBe(403);
  expect((await a.api.get(base + '/conversations/' + chatB)).status()).toBe(403);
  expect(
    (
      await a.api.post(base + '/conversations/' + chatB + '/notes', { data: { text: 'Intrusión' } })
    ).status(),
  ).toBe(403);
  expect(
    (
      await a.api.post(base + '/conversations/' + chatB + '/messages', {
        data: { text: 'Intrusión', idempotencyKey: crypto.randomUUID() },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await a.api.delete(base + '/whatsapp/accounts/' + b.account.id, { data: {} })).status(),
  ).toBe(403);
  const contacts = await (await a.api.get(base + '/contacts')).json();
  expect(contacts.length).toBe(1);
  const messageB = await db.message.findFirstOrThrow({ where: { conversationId: chatB } });
  expect(
    (await a.api.get(base + '/conversations/' + chatA + '?before=' + messageB.id)).status(),
  ).toBe(403);
  const channels = await (await a.api.get(base + '/whatsapp/accounts')).json();
  expect(JSON.stringify(channels)).not.toContain(fakeToken);
  expect(JSON.stringify(channels)).not.toContain('tokenEncrypted');
  expect(channels.accounts.map((x: { id: string }) => x.id)).toEqual([a.account.id]);
  expect(
    await db.contact.count({
      where: { waId: '5491112345678', tenantId: { in: [a.tenant.id, b.tenant.id] } },
    }),
  ).toBe(2);
  await a.api.dispose();
  await b.api.dispose();
});

test('bandeja responsive: recibir, responder en cola, notas internas y estados monotónicos', async ({
  page,
}, testInfo) => {
  const f = await fixture();
  const conversationId = await receive(f);
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/conversaciones');
  await page.getByRole('button', { name: /Cliente de prueba/ }).click();
  await expect(page.getByRole('log', { name: 'Historial de mensajes' })).toContainText(
    'Consulta de prueba',
  );
  await page.getByLabel('Mensaje de WhatsApp', { exact: true }).fill('Respuesta desde la bandeja');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByText('En cola', { exact: true })).toBeVisible();
  const outgoing = await db.message.findFirstOrThrow({
    where: { conversationId, direction: 'OUTBOUND' },
  });
  expect(outgoing.status).toBe('QUEUED');
  await page.getByRole('button', { name: 'Nota interna', exact: true }).click();
  await page.getByLabel('Nota interna', { exact: true }).fill('Nota visible solo para el equipo');
  await page.getByRole('button', { name: 'Guardar nota', exact: true }).click();
  await expect.poll(() => db.conversationNote.count({ where: { conversationId } })).toBe(1);
  expect(await db.message.count({ where: { conversationId } })).toBe(2);
  const providerId = 'wamid.' + randomBytes(8).toString('hex');
  let calls = 0;
  const transport: MetaFetch = async (url, init) => {
    calls++;
    expect(url).toContain('/' + f.account.phoneNumberId + '/messages');
    const body = JSON.parse(init.body!);
    expect(body.to).toBe('5491112345678');
    expect(body.text.body).toBe('Respuesta desde la bandeja');
    expect(body.biz_opaque_callback_data).toBe(outgoing.id);
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: providerId }] }) };
  };
  await processOutbound(db, outgoing.id, transport);
  expect(calls).toBe(1);
  expect((await db.message.findUniqueOrThrow({ where: { id: outgoing.id } })).status).toBe('SENT');
  expect((await deliver(f.api, receipt(f.account, providerId, 'read', outgoing.id))).ok()).toBe(
    true,
  );
  await expect
    .poll(async () => (await db.message.findUniqueOrThrow({ where: { id: outgoing.id } })).status, {
      timeout: 15000,
    })
    .toBe('READ');
  await deliver(f.api, receipt(f.account, providerId, 'delivered', outgoing.id));
  await new Promise((resolve) => setTimeout(resolve, 3500));
  expect((await db.message.findUniqueOrThrow({ where: { id: outgoing.id } })).status).toBe('READ');
  await expect(page.getByText('Leído', { exact: true })).toBeVisible();
  expect(await page.locator('.skip-link').evaluate((link) => link === document.activeElement)).toBe(
    false,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('inbox.png'), fullPage: true });
  await f.api.dispose();
});

test('ventana de 24 horas, idempotencia de envío y revocación antes del worker', async () => {
  const f = await fixture();
  const conversationId = await receive(f, 'Mensaje histórico', 25 * 3600);
  const base = `/api/workspaces/${f.tenant.id}/conversations/${conversationId}`;
  expect(
    (
      await f.api.post(base + '/messages', {
        data: { text: 'Fuera de ventana', idempotencyKey: crypto.randomUUID() },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await f.api.post(base + '/notes', { data: { text: 'Nota permitida fuera de ventana' } })).ok(),
  ).toBe(true);
  await deliver(f.api, inbound(f.account));
  await expect
    .poll(
      async () =>
        (
          await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })
        ).lastInboundAt!.getTime(),
      { timeout: 15000 },
    )
    .toBeGreaterThan(Date.now() - 60000);
  const key = crypto.randomUUID();
  const first = await queued(f.api, f.tenant.id, conversationId, 'Respuesta idempotente', key);
  const again = await queued(f.api, f.tenant.id, conversationId, 'Respuesta idempotente', key);
  expect(again.id).toBe(first.id);
  expect(
    (
      await f.api.post(base + '/messages', {
        data: { text: 'Otro contenido', idempotencyKey: key },
      })
    ).status(),
  ).toBe(409);
  await db.membership.deleteMany({ where: { tenantId: f.tenant.id, userId: f.user.id } });
  let calls = 0;
  await processOutbound(db, first.id, async () => {
    calls++;
    throw new Error('Must not call Meta');
  });
  expect(calls).toBe(0);
  expect((await db.message.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('CANCELED');
  await f.api.dispose();
});

test('resultado incierto no se reintenta y una recepción firmada puede reconciliarlo', async () => {
  const f = await fixture();
  const conversationId = await receive(f);
  const message = await queued(f.api, f.tenant.id, conversationId);
  let calls = 0;
  const transport: MetaFetch = async () => {
    calls++;
    throw new Error('Network timeout fixture');
  };
  await processOutbound(db, message.id, transport);
  await processOutbound(db, message.id, transport);
  expect(calls).toBe(1);
  expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
    'UNKNOWN',
  );
  const providerId = 'wamid.' + randomBytes(8).toString('hex');
  await deliver(f.api, receipt(f.account, providerId, 'delivered', message.id));
  await expect
    .poll(async () => (await db.message.findUniqueOrThrow({ where: { id: message.id } })).status, {
      timeout: 15000,
    })
    .toBe('DELIVERED');
  await f.api.dispose();
});

test('autorización del número en Meta y cifrado vinculado a empresa/número', async () => {
  let calls = 0;
  const token = encryptToken(fakeToken, 'tenant-a', '123456');
  expect(token).not.toContain(fakeToken);
  expect(decryptToken(token, 'tenant-a', '123456')).toBe(fakeToken);
  expect(() => decryptToken(token, 'tenant-b', '123456')).toThrow();
  const transport: MetaFetch = async (url) => {
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () =>
        url.includes('/phone_numbers')
          ? {
              data: [
                {
                  id: '123456',
                  display_phone_number: '+54 9 11',
                  verified_name: 'Prueba de contrato',
                },
              ],
            }
          : { success: true },
    };
  };
  expect((await verifyAndSubscribe('654321', '123456', fakeToken, transport)).displayName).toBe(
    'Prueba de contrato',
  );
  expect(calls).toBe(2);
  calls = 0;
  await expect(verifyAndSubscribe('654321', '999999', fakeToken, transport)).rejects.toThrow();
  expect(calls).toBe(1);
});

test('paginación del historial, notas privadas y control de asignación entre empresas', async () => {
  const f = await fixture();
  const other = await fixture();
  const payload = inbound(f.account);
  const value = payload.entry[0].changes[0].value;
  const template = value.messages[0];
  value.messages = Array.from({ length: 55 }, (_, i) => ({
    ...template,
    id: `wamid.pagination.${f.account.id}.${i}`,
    text: { body: `Mensaje ${i}` },
  }));
  expect((await deliver(f.api, payload)).ok()).toBe(true);
  await expect
    .poll(() => db.message.count({ where: { accountId: f.account.id } }), { timeout: 20000 })
    .toBe(55);
  expect(await db.whatsappWebhookEvent.count({ where: { accountId: f.account.id } })).toBe(3);
  await deliver(f.api, payload);
  expect(await db.whatsappWebhookEvent.count({ where: { accountId: f.account.id } })).toBe(3);
  const conv = await db.conversation.findFirstOrThrow({ where: { accountId: f.account.id } });
  const base = `/api/workspaces/${f.tenant.id}/conversations/${conv.id}`;
  const first = await (await f.api.get(base)).json();
  expect(first.messages.length).toBe(50);
  expect(first.hasMore).toBe(true);
  const older = await (await f.api.get(base + '?before=' + first.messages[0].id)).json();
  expect(older.messages.length).toBe(5);
  expect(older.hasMore).toBe(false);
  expect(
    new Set([...first.messages, ...older.messages].map((m: { id: string }) => m.id)).size,
  ).toBe(55);
  expect((await f.api.patch(base, { data: { assignedUserId: other.user.id } })).status()).toBe(403);
  expect(
    (await f.api.patch(base, { data: { assignedUserId: f.user.id, status: 'CLOSED' } })).ok(),
  ).toBe(true);
  expect((await db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe(
    'CLOSED',
  );
  const delayed = inbound(f.account, undefined, 'Mensaje anterior demorado');
  delayed.entry[0].changes[0].value.messages[0].timestamp = String(
    Math.floor(Date.now() / 1000) - 3600,
  );
  await deliver(f.api, delayed);
  await expect
    .poll(() => db.message.count({ where: { accountId: f.account.id } }), { timeout: 15000 })
    .toBe(56);
  expect((await db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe(
    'CLOSED',
  );
  await deliver(f.api, inbound(f.account, undefined, 'Nuevo mensaje que reabre'));
  await expect
    .poll(
      async () => (await db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status,
      { timeout: 15000 },
    )
    .toBe('OPEN');
  expect(
    (await f.api.patch(base, { data: { readThroughId: first.messages.at(-1).id } })).ok(),
  ).toBe(true);
  expect(
    (await db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).unreadCount,
  ).toBeGreaterThan(0);
  await f.api.dispose();
  await other.api.dispose();
});

test('desconexión y ventana revalidada impiden enviar mensajes pendientes', async () => {
  const f = await fixture();
  const conv = await receive(f);
  const message = await queued(f.api, f.tenant.id, conv);
  await db.conversation.update({
    where: { id: conv },
    data: { lastInboundAt: new Date(Date.now() - 25 * 3600000) },
  });
  let calls = 0;
  await processOutbound(db, message.id, async () => {
    calls++;
    throw new Error('Should not send outside window');
  });
  expect(calls).toBe(0);
  expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).errorCode).toBe(
    'WINDOW_CLOSED',
  );
  await db.conversation.update({ where: { id: conv }, data: { lastInboundAt: new Date() } });
  const pending = await queued(f.api, f.tenant.id, conv);
  expect(
    (
      await f.api.delete(`/api/workspaces/${f.tenant.id}/whatsapp/accounts/${f.account.id}`, {
        data: {},
      })
    ).ok(),
  ).toBe(true);
  expect((await db.message.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
    'CANCELED',
  );
  expect(
    (await db.whatsappAccount.findUniqueOrThrow({ where: { id: f.account.id } })).tokenEncrypted,
  ).toBeNull();
  const before = await db.whatsappWebhookEvent.count({ where: { accountId: f.account.id } });
  await deliver(f.api, inbound(f.account));
  expect(await db.whatsappWebhookEvent.count({ where: { accountId: f.account.id } })).toBe(before);
  await f.api.dispose();
});

test('un rechazo explícito de Meta se distingue de un resultado incierto', async () => {
  const f = await fixture();
  const conv = await receive(f);
  const message = await queued(f.api, f.tenant.id, conv);
  await processOutbound(db, message.id, async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { code: 190, message: 'Provider fixture' } }),
  }));
  expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('FAILED');
  expect(
    (await db.whatsappAccount.findUniqueOrThrow({ where: { id: f.account.id } })).lastErrorCode,
  ).toBe('META_190');
  const second = await queued(f.api, f.tenant.id, conv);
  let calls = 0;
  await processOutbound(db, second.id, async () => {
    calls++;
    throw new Error('Should not send with invalid credentials');
  });
  expect(calls).toBe(0);
  expect((await db.message.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
    'CANCELED',
  );
  await f.api.dispose();
});

test('procesamiento concurrente envía una sola vez y un rechazo antiguo no invalida un token nuevo', async () => {
  const f = await fixture();
  const conv = await receive(f);
  const message = await queued(f.api, f.tenant.id, conv);
  let calls = 0;
  const transport: MetaFetch = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: `wamid.concurrent.${message.id}` }] }),
    };
  };
  await Promise.all([
    processOutbound(db, message.id, transport),
    processOutbound(db, message.id, transport),
  ]);
  expect(calls).toBe(1);
  expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('SENT');
  const next = await queued(f.api, f.tenant.id, conv);
  await processOutbound(db, next.id, async () => {
    await db.whatsappAccount.update({
      where: { id: f.account.id },
      data: {
        tokenEncrypted: encryptToken(fakeToken + '-rotated', f.tenant.id, f.account.phoneNumberId),
        lastErrorCode: null,
      },
    });
    return { ok: false, status: 400, json: async () => ({ error: { code: 190 } }) };
  });
  expect((await db.message.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('FAILED');
  expect(
    (await db.whatsappAccount.findUniqueOrThrow({ where: { id: f.account.id } })).lastErrorCode,
  ).toBeNull();
  await f.api.dispose();
});
