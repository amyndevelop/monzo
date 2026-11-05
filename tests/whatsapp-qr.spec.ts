import { test, expect } from '@playwright/test';
import { fixture, db, inbound } from './helpers/whatsapp';
import {
  acquireWebLease,
  commandWeb,
  openSession,
  sealSession,
} from '../src/modules/whatsapp/web/core';
import { captureWebhook, processWebhook } from '../src/modules/whatsapp/core/ingest';
import { processOutbound } from '../src/modules/whatsapp/core/outbound';
import { WebSocketSession } from '../src/modules/whatsapp/web/socket';
import type makeWASocket from '@whiskeysockets/baileys';
test.afterAll(() => db.$disconnect());
async function setup() {
  const f = await fixture();
  const result = await commandWeb(db, f.tenant.id, f.user.id, {
    action: 'create',
    name: 'Prueba QR',
    phone: '549' + f.account.phoneNumberId.slice(-10),
  });
  const account = await db.whatsappAccount.findUniqueOrThrow({ where: { id: result.accountId } });
  const session = await db.whatsappWebSession.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  return { ...f, account, session, base: `/api/workspaces/${f.tenant.id}/whatsapp/qr` };
}
async function connected(f: Awaited<ReturnType<typeof setup>>) {
  await db.whatsappWebSession.update({
    where: { accountId: f.account.id },
    data: {
      desiredState: 'CONNECTED',
      state: 'CONNECTED',
      connectedWaId: f.session.expectedWaId,
      leaseOwner: 'test-owner',
      leaseUntil: new Date(Date.now() + 60000),
    },
  });
  await db.whatsappAccount.update({ where: { id: f.account.id }, data: { enabled: true } });
}
async function receive(f: Awaited<ReturnType<typeof setup>>, id = 'qr-inbound') {
  const raw = Buffer.from(JSON.stringify(inbound(f.account, id, 'Hola')));
  expect(await captureWebhook(db, raw)).toEqual([]);
  const events = await captureWebhook(db, raw, 'BAILEYS');
  for (const event of events) await processWebhook(db, event.id);
  return db.conversation.findFirstOrThrow({ where: { accountId: f.account.id } });
}
test('QR: comandos por propietario, revisiones, separación de empresas y QR secreto', async () => {
  const f = await setup(),
    other = await fixture();
  expect(
    (
      await f.api.post(f.base, {
        headers: { origin: 'https://foreign.example' },
        data: { action: 'disconnect', accountId: f.account.id, generation: 1 },
      })
    ).status(),
  ).toBe(403);
  expect((await other.api.get(f.base)).status()).toBe(403);
  await db.workerHeartbeat.upsert({
    where: { id: 'whatsapp-qr' },
    create: { id: 'whatsapp-qr', outboundEnabled: true, seenAt: new Date(0) },
    update: { seenAt: new Date(0) },
  });
  expect(
    (
      await f.api.post(f.base, {
        data: { action: 'connect', accountId: f.account.id, generation: 1 },
      })
    ).status(),
  ).toBe(409);
  await db.workerHeartbeat.upsert({
    where: { id: 'whatsapp-qr' },
    create: { id: 'whatsapp-qr', outboundEnabled: true, seenAt: new Date() },
    update: { seenAt: new Date() },
  });
  expect(
    (
      await f.api.post(f.base, {
        data: { action: 'connect', accountId: f.account.id, generation: 1 },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await f.api.post(f.base, {
        data: { action: 'disconnect', accountId: f.account.id, generation: 1 },
      })
    ).status(),
  ).toBe(409);
  const encrypted = sealSession('secret-test-qr', f.tenant.id, f.account.id);
  expect(() => openSession(encrypted, other.tenant.id, f.account.id)).toThrow();
  await db.whatsappWebSession.update({
    where: { accountId: f.account.id },
    data: {
      state: 'QR',
      qrEncrypted: encrypted,
      qrExpiresAt: new Date(Date.now() + 45000),
      leaseOwner: 'test-owner',
      leaseUntil: new Date(Date.now() + 60000),
    },
  });
  const ownerView = await (await f.api.get(f.base)).json();
  expect(ownerView.sessions[0].qr).toMatch(/^data:image\/png;base64,/);
  expect(JSON.stringify(ownerView)).not.toContain('secret-test-qr');
  expect(JSON.stringify(ownerView)).not.toContain('authEncrypted');
  await db.membership.update({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    data: { role: 'MEMBER' },
  });
  const memberView = await (await f.api.get(f.base)).json();
  expect(memberView.sessions[0].qr).toBe(null);
  expect(
    (
      await f.api.post(f.base, {
        data: { action: 'disconnect', accountId: f.account.id, generation: 2 },
      })
    ).status(),
  ).toBe(403);
  await db.whatsappWebSession.update({
    where: { accountId: f.account.id },
    data: { qrExpiresAt: new Date(Date.now() - 1000) },
  });
});
test('QR: ingreso aislado, duplicados, envío único y resultado incierto sin reenvío', async () => {
  const f = await setup();
  await connected(f);
  const conversation = await receive(f);
  await receive(f);
  expect(
    await db.message.count({ where: { conversationId: conversation.id, direction: 'INBOUND' } }),
  ).toBe(1);
  const outgoing = await db.message.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      type: 'text',
      text: 'Respuesta QR',
      createdByUserId: f.user.id,
      occurredAt: new Date(),
    },
  });
  await processOutbound(db, outgoing.id);
  expect((await db.message.findUniqueOrThrow({ where: { id: outgoing.id } })).status).toBe(
    'QUEUED',
  );
  let sends = 0;
  const transport = {
    owner: 'test-owner',
    send: async () => {
      sends++;
      return 'QR_SENT_1';
    },
  };
  await Promise.all([
    processOutbound(db, outgoing.id, undefined, transport),
    processOutbound(db, outgoing.id, undefined, transport),
  ]);
  expect(sends).toBe(1);
  expect((await db.message.findUniqueOrThrow({ where: { id: outgoing.id } })).status).toBe('SENT');
  const unknown = await db.message.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      type: 'text',
      text: 'Incierto',
      createdByUserId: f.user.id,
      occurredAt: new Date(),
    },
  });
  await processOutbound(db, unknown.id, undefined, {
    owner: 'test-owner',
    send: async () => {
      throw new Error('simulated transport uncertainty');
    },
  });
  expect((await db.message.findUniqueOrThrow({ where: { id: unknown.id } })).status).toBe(
    'UNKNOWN',
  );
  await processOutbound(db, unknown.id, undefined, transport);
  expect(sends).toBe(1);
  expect(await acquireWebLease(db, f.account.id, 'other-owner')).toBe(false);
  await db.whatsappWebSession.update({
    where: { accountId: f.account.id },
    data: { leaseUntil: new Date(Date.now() - 1) },
  });
  expect(await acquireWebLease(db, f.account.id, 'other-owner')).toBe(true);
});
test('QR: socket falso comprueba cifrado, identidad, ingreso y exclusión de historial/grupos', async () => {
  const f = await setup();
  await db.whatsappWebSession.update({
    where: { accountId: f.account.id },
    data: {
      desiredState: 'CONNECTED',
      state: 'CONNECTING',
      leaseOwner: 'socket-test',
      leaseUntil: new Date(Date.now() + 60000),
    },
  });
  const session = await db.whatsappWebSession.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  const handlers = new Map<string, (event: unknown) => void>();
  const fake = {
    user: { id: f.session.expectedWaId + '@s.whatsapp.net' },
    ev: { on: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn) },
    end: () => {},
    logout: async () => {},
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
  };
  const socket = new WebSocketSession(
    db,
    session,
    'socket-test',
    (() => fake) as unknown as typeof makeWASocket,
  );
  await socket.start();
  handlers.get('connection.update')!({ qr: 'fixture-sensitive-qr' });
  await socket.flush();
  const qr = await db.whatsappWebSession.findUniqueOrThrow({ where: { accountId: f.account.id } });
  expect(qr.qrEncrypted).not.toContain('fixture-sensitive-qr');
  expect(openSession(qr.qrEncrypted!, f.tenant.id, f.account.id)).toBe('fixture-sensitive-qr');
  handlers.get('creds.update')!({ registered: true });
  await socket.flush();
  expect(
    (await db.whatsappWebSession.findUniqueOrThrow({ where: { accountId: f.account.id } }))
      .authEncrypted,
  ).toMatch(/^v1\./);
  handlers.get('connection.update')!({ connection: 'open' });
  await socket.flush();
  expect(socket.connected).toBe(true);
  const message = {
    key: { id: 'test-incoming', remoteJid: '15550000000@s.whatsapp.net', fromMe: false },
    message: { conversation: 'Hola QR' },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
  handlers.get('messages.upsert')!({ type: 'append', messages: [message] });
  await socket.flush();
  expect(await db.message.count({ where: { accountId: f.account.id } })).toBe(0);
  handlers.get('messages.upsert')!({
    type: 'notify',
    messages: [
      message,
      { ...message, key: { ...message.key, id: 'group', remoteJid: '123@g.us' } },
    ],
  });
  await socket.flush();
  expect(await db.message.count({ where: { accountId: f.account.id } })).toBe(1);
  await db.whatsappWebSession.update({
    where: { accountId: f.account.id },
    data: { generation: { increment: 1 } },
  });
  handlers.get('connection.update')!({ qr: 'obsolete' });
  await socket.flush();
  expect(
    (await db.whatsappWebSession.findUniqueOrThrow({ where: { accountId: f.account.id } }))
      .qrEncrypted,
  ).toBe(null);
  await socket.stop();
});
test('QR UI: preparar número, error conserva formulario y estado visible en móvil', async ({
  page,
}, info) => {
  const f = await fixture();
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/canales');
  const section = page.getByRole('region', { name: 'WhatsApp por QR' });
  await section.getByLabel('Nombre de la conexión').fill('Mi QR');
  await section.getByLabel('Número de WhatsApp').fill('5491112345678');
  await section.getByRole('button', { name: 'Preparar número', exact: true }).click();
  await expect(section.getByText('Mi QR', { exact: true })).toBeVisible();
  await expect(section.getByText('Desconectado', { exact: true })).toBeVisible();
  await page.screenshot({ path: `work/qr-channels-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const rows = await db.whatsappWebSession.findMany({ where: { tenantId: f.tenant.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].authEncrypted).toBe(null);
});
