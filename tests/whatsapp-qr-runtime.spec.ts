import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fixture, db, inbound } from './helpers/whatsapp';
import { commandWeb } from '../src/modules/whatsapp/web/core';
import { captureWebhook, processWebhook } from '../src/modules/whatsapp/core/ingest';
import { processOutbound } from '../src/modules/whatsapp/core/outbound';
import { dispatchJobs } from '../src/modules/whatsapp/core/qstash';
import { mutateFlow } from '../src/modules/automations/core';
import { exampleFlow } from '../src/modules/automations/definition';
test.afterAll(() => db.$disconnect());
async function setup() {
  const f = await fixture();
  const { accountId } = await commandWeb(db, f.tenant.id, f.user.id, {
    action: 'create',
    name: 'QR operativo',
    phone: '549' + f.account.phoneNumberId.slice(-10),
  });
  const account = await db.whatsappAccount.update({
    where: { id: accountId },
    data: { enabled: true },
  });
  await db.whatsappWebSession.update({
    where: { accountId },
    data: {
      desiredState: 'CONNECTED',
      state: 'CONNECTED',
      leaseOwner: 'runtime-test',
      leaseUntil: new Date(Date.now() + 120000),
    },
  });
  return { ...f, account };
}
async function receive(f: Awaited<ReturnType<typeof setup>>, text: string) {
  const events = await captureWebhook(
    db,
    Buffer.from(JSON.stringify(inbound(f.account, randomUUID(), text))),
    'BAILEYS',
  );
  for (const event of events) await processWebhook(db, event.id);
  return db.conversation.findFirstOrThrow({ where: { accountId: f.account.id } });
}
test('QR: flujo numerado, texto fuera de ventana Meta y capacidades reales en la bandeja', async ({
  page,
}, info) => {
  const f = await setup();
  const draft = await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'save',
    revision: 0,
    graph: exampleFlow,
  });
  await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'publish',
    revision: draft.revision,
  });
  const conversation = await receive(f, 'Hola');
  const first = await db.message.findFirstOrThrow({
    where: { conversationId: conversation.id, direction: 'OUTBOUND', status: 'QUEUED' },
  });
  expect(first.type).toBe('interactive');
  const sent: string[] = [];
  const transport = {
    owner: 'runtime-test',
    send: async (_account: string, _generation: number, _to: string, text: string) => {
      sent.push(text);
      return randomUUID();
    },
  };
  await processOutbound(db, first.id, undefined, transport);
  expect(sent[0]).toContain('1.');
  await receive(f, '1');
  const next = await db.message.findFirstOrThrow({
    where: { conversationId: conversation.id, direction: 'OUTBOUND', status: 'QUEUED' },
  });
  await processOutbound(db, next.id, undefined, transport);
  expect(sent).toHaveLength(2);
  await db.conversation.update({
    where: { id: conversation.id },
    data: { lastInboundAt: new Date(Date.now() - 25 * 3600000) },
  });
  const base = `/api/workspaces/${f.tenant.id}/conversations/${conversation.id}`;
  const thread = await (await f.api.get(base)).json();
  expect(thread.canReply).toBe(true);
  expect(thread.replyWindowClosesAt).toBe(null);
  expect(thread.conversation.account.provider).toBe('BAILEYS');
  expect(
    (
      await f.api.post(base + '/messages', {
        data: { text: 'Respuesta manual QR', idempotencyKey: randomUUID() },
      })
    ).ok(),
  ).toBe(true);
  expect((await f.api.get(base + '/templates')).status()).toBe(409);
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto(`/dashboard/conversaciones?conversation=${conversation.id}`);
  await expect(page.getByText('Sesión QR conectada', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usar plantilla', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adjuntar archivo', exact: true })).toHaveCount(0);
  await expect(page.locator('.message-composer')).toBeInViewport();
  await page.screenshot({ path: `work/qr-inbox-${info.project.name}.png` });
});
test('QR: trabajos excluidos de QStash/Meta, revocación y sesión vencida no envían', async () => {
  const f = await setup(),
    other = await fixture();
  const conversation = await receive(f, 'Hola');
  const message = await db.message.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      conversationId: conversation.id,
      createdByUserId: f.user.id,
      direction: 'OUTBOUND',
      type: 'text',
      text: 'Esperar',
      status: 'QUEUED',
      occurredAt: new Date(),
    },
  });
  const previous = process.env.WHATSAPP_PROCESSOR;
  let calls = 0;
  try {
    process.env.WHATSAPP_PROCESSOR = 'qstash';
    await dispatchJobs(db, [{ kind: 'outbox', id: message.id }], async () => {
      calls++;
      throw new Error('QR must not call QStash');
    });
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_PROCESSOR;
    else process.env.WHATSAPP_PROCESSOR = previous;
  }
  expect(calls).toBe(0);
  const transport = {
    owner: 'runtime-test',
    send: async () => {
      calls++;
      return 'wrong';
    },
  };
  await db.whatsappWebSession.update({
    where: { accountId: f.account.id },
    data: { leaseUntil: new Date(Date.now() - 1) },
  });
  await processOutbound(db, message.id, undefined, transport);
  expect(calls).toBe(0);
  expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('QUEUED');
  const accountBase = `/api/workspaces/${f.tenant.id}/whatsapp/accounts`;
  expect(
    (await f.api.post(`${accountBase}/${f.account.id}/authorization`, { data: {} })).status(),
  ).toBe(409);
  expect(
    (await f.api.post(`${accountBase}/${other.account.id}/authorization`, { data: {} })).status(),
  ).toBe(403);
  await db.whatsappWebSession.update({
    where: { accountId: f.account.id },
    data: { leaseUntil: new Date(Date.now() + 60000) },
  });
  await db.membership.delete({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
  });
  await processOutbound(db, message.id, undefined, transport);
  expect(calls).toBe(0);
  expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
    'CANCELED',
  );
});
