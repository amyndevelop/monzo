import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { testEnvironment } from './test-env.mjs';
import { processOutbound, type EvolutionOutbox } from '../src/modules/whatsapp/core/outbound';
import { ChannelRpcError } from '../src/modules/evolution/channel-api';
import { processEvolutionEvent } from '../src/modules/evolution/events';
import { outboundMessageId } from '../services/evolution-gateway/protocol.mjs';
import { dispatchEvolutionQueued } from '../src/modules/evolution/outbound-core';

Object.assign(process.env, testEnvironment());
const db = new PrismaClient();
after(() => db.$disconnect());
const key = () => randomBytes(32).toString('hex');
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const user = await db.user.create({
    data: { email: 'evo-outbound-' + randomUUID() + '@example.invalid', emailVerified: true },
  });
  const tenant = await db.tenant.create({
    data: { name: 'Outbound fixture', slug: 'evo-outbound-' + randomUUID() },
  });
  await db.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' } });
  t.after(async () => {
    const where = { tenantId: tenant.id };
    await db.evolutionDelivery.deleteMany({ where });
    await db.message.deleteMany({ where });
    await db.automationFlow.deleteMany({ where });
    await db.conversation.deleteMany({ where });
    await db.contact.deleteMany({ where });
    await db.evolutionSession.deleteMany({ where });
    await db.whatsappAccount.deleteMany({ where });
    await db.membership.deleteMany({ where });
    await db.tenant.delete({ where: { id: tenant.id } });
    await db.user.delete({ where: { id: user.id } });
  });
  const account = await db.whatsappAccount.create({
    data: {
      tenantId: tenant.id,
      provider: 'EVOLUTION',
      phoneNumberId: randomBytes(6).readUIntBE(0, 6).toString(),
      businessAccountId: 'fixture',
      displayPhone: 'Fixture',
      displayName: 'Fixture',
      enabled: true,
    },
  });
  const phone = '1555' + randomBytes(4).readUIntBE(0, 4).toString();
  await db.evolutionSession.create({
    data: {
      tenantId: tenant.id,
      accountId: account.id,
      expectedWaId: phone,
      connectedWaId: phone,
      state: 'CONNECTED',
      desiredState: 'CONNECTED',
      lastSeenAt: new Date(),
    },
  });
  const contact = await db.contact.create({
    data: { tenantId: tenant.id, accountId: account.id, waId: '15557654321' },
  });
  const conversation = await db.conversation.create({
    data: {
      tenantId: tenant.id,
      accountId: account.id,
      contactId: contact.id,
      lastInboundAt: new Date(Date.now() - 48 * 3600000),
      automationPaused: true,
    },
  });
  const message = await db.message.create({
    data: {
      tenantId: tenant.id,
      accountId: account.id,
      conversationId: conversation.id,
      createdByUserId: user.id,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      type: 'text',
      text: 'Respuesta del fixture',
      occurredAt: new Date(),
    },
  });
  const secret = key();
  return { user, tenant, account, conversation, message, secret, phone };
}

test('salida Evolution: claim concurrente envía una vez; providerId y generación quedan guardados antes del RPC', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const outbox: EvolutionOutbox = {
    key: f.secret,
    submit: async (command) => {
      calls++;
      const stored = await db.message.findUniqueOrThrow({ where: { id: f.message.id } });
      assert.equal(stored.status, 'SENDING');
      assert.equal(stored.channelGeneration, 1);
      assert.equal(stored.providerId, command.data.providerId);
      assert.equal(
        command.data.providerId,
        outboundMessageId(f.secret, f.tenant.id, f.account.id, f.message.id),
      );
      assert.equal(command.data.text, f.message.text);
      assert.equal(command.scope.expectedPhone, f.phone);
    },
  };
  await Promise.all([
    processOutbound(db, f.message.id, undefined, undefined, outbox),
    processOutbound(db, f.message.id, undefined, undefined, outbox),
  ]);
  assert.equal(calls, 1);
  assert.equal(
    (await db.message.findUniqueOrThrow({ where: { id: f.message.id } })).status,
    'SENDING',
  );
});

test('salida Evolution: eco confirmado antes de perder el RPC no retrocede a UNKNOWN', async (t) => {
  const f = await fixture(t);
  const outbox: EvolutionOutbox = {
    key: f.secret,
    submit: async (command) => {
      await processEvolutionEvent(
        db,
        {
          kind: 'monzo.evolution.event',
          id: key(),
          sequence: 1,
          scope: command.scope,
          payload: {
            type: 'message',
            providerId: command.data.providerId,
            peer: command.data.to,
            fromMe: true,
            occurredAt: Date.now(),
            history: false,
            messageType: 'text',
            text: command.data.text,
            verifiedPhone: f.phone,
            verifiedAt: Date.now(),
          },
        },
        key(),
      );
      throw new ChannelRpcError('UNREACHABLE', true);
    },
  };
  await processOutbound(db, f.message.id, undefined, undefined, outbox);
  assert.equal(
    (await db.message.findUniqueOrThrow({ where: { id: f.message.id } })).status,
    'SENT',
  );
  assert.equal(await db.message.count({ where: { accountId: f.account.id } }), 1);
});

test('salida Evolution: permiso revocado cancela el pendiente sin contactar el gateway', async (t) => {
  const f = await fixture(t);
  await db.membership.delete({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
  });
  let called = false;
  await processOutbound(db, f.message.id, undefined, undefined, {
    key: f.secret,
    submit: async () => {
      called = true;
    },
  });
  const stored = await db.message.findUniqueOrThrow({ where: { id: f.message.id } });
  assert.equal(stored.status, 'CANCELED');
  assert.equal(stored.errorCode, 'MEMBERSHIP_REVOKED');
  assert.equal(called, false);
});

test('salida Evolution: una sesión sin confirmación reciente o desconectada impide el claim', async (t) => {
  const f = await fixture(t);
  let called = false;
  const outbox = {
    key: f.secret,
    submit: async () => {
      called = true;
    },
  };
  await db.evolutionSession.update({
    where: { accountId: f.account.id },
    data: { lastSeenAt: new Date(Date.now() - 46000) },
  });
  await processOutbound(db, f.message.id, undefined, undefined, outbox);
  await db.evolutionSession.update({
    where: { accountId: f.account.id },
    data: { lastSeenAt: new Date(), desiredState: 'DISCONNECTED' },
  });
  await processOutbound(db, f.message.id, undefined, undefined, outbox);
  assert.equal(called, false);
  assert.equal(
    (await db.message.findUniqueOrThrow({ where: { id: f.message.id } })).status,
    'QUEUED',
  );
});

test('salida Evolution: resultado incierto se conserva con ID y no vuelve a reclamarse', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const outbox = {
    key: f.secret,
    submit: async () => {
      calls++;
      throw new ChannelRpcError('UNREACHABLE', true);
    },
  };
  await processOutbound(db, f.message.id, undefined, undefined, outbox);
  const stored = await db.message.findUniqueOrThrow({ where: { id: f.message.id } });
  assert.equal(stored.status, 'UNKNOWN');
  assert.ok(stored.providerId);
  assert.equal(stored.text, f.message.text);
  await processOutbound(db, f.message.id, undefined, undefined, outbox);
  assert.equal(calls, 1);
});

test('salida Evolution: rechazo explícito del gateway falla; el transporte de Meta no acepta este proveedor', async (t) => {
  const f = await fixture(t);
  let called = false;
  await processOutbound(db, f.message.id, async () => {
    called = true;
    throw new Error('No Meta');
  });
  assert.equal(called, false);
  await processOutbound(db, f.message.id, undefined, undefined, {
    key: f.secret,
    submit: async () => {
      throw new ChannelRpcError('GATEWAY_AUTH', false);
    },
  });
  const stored = await db.message.findUniqueOrThrow({ where: { id: f.message.id } });
  assert.equal(stored.status, 'FAILED');
  assert.equal(stored.errorCode, 'EVOLUTION_GATEWAY_AUTH');
});

test('salida Evolution: pausa humana invalida una respuesta automática antes del gateway', async (t) => {
  const f = await fixture(t);
  let called = false;
  const flow = await db.automationFlow.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      draft: {},
      published: {},
      enabled: true,
      publishedVersion: 1,
      publishedByUserId: f.user.id,
    },
  });
  await db.message.update({
    where: { id: f.message.id },
    data: {
      automationFlowId: flow.id,
      automationSnapshot: {
        version: 1,
        flowId: flow.id,
        publishedVersion: 1,
        generation: 0,
        nodeId: 'start',
        kind: 'message',
        text: 'Respuesta',
        choices: [],
      },
    },
  });
  await processOutbound(db, f.message.id, undefined, undefined, {
    key: f.secret,
    submit: async () => {
      called = true;
    },
  });
  const stored = await db.message.findUniqueOrThrow({ where: { id: f.message.id } });
  assert.equal(stored.status, 'CANCELED');
  assert.equal(stored.errorCode, 'AUTOMATION_PAUSED');
  assert.equal(called, false);
});

test('salida Evolution: conserva orden por cuenta hasta confirmar el envío anterior', async (t) => {
  const f = await fixture(t),
    commands: Parameters<EvolutionOutbox['submit']>[0][] = [];
  await db.message.update({
    where: { id: f.message.id },
    data: { createdAt: new Date(Date.now() - 10) },
  });
  const next = await db.message.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      conversationId: f.conversation.id,
      createdByUserId: f.user.id,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      type: 'text',
      text: 'Segundo',
      occurredAt: new Date(),
    },
  });
  const outbox = {
    key: f.secret,
    submit: async (command: Parameters<EvolutionOutbox['submit']>[0]) => {
      commands.push(command);
    },
  };
  await processOutbound(db, next.id, undefined, undefined, outbox);
  assert.equal(commands.length, 0);
  await processOutbound(db, f.message.id, undefined, undefined, outbox);
  await processOutbound(db, next.id, undefined, undefined, outbox);
  assert.equal(commands.length, 1);
  await processEvolutionEvent(
    db,
    {
      kind: 'monzo.evolution.event',
      id: key(),
      sequence: 1,
      scope: commands[0].scope,
      payload: {
        type: 'sendResult',
        messageId: f.message.id,
        providerId: commands[0].data.providerId,
        peer: commands[0].data.to,
        status: 'SENT',
        code: 'OK',
        occurredAt: Date.now(),
      },
    },
    key(),
  );
  await processOutbound(db, next.id, undefined, undefined, outbox);
  assert.equal(commands.length, 2);
  assert.equal(commands[1].data.messageId, next.id);
});

test('salida Evolution: SENDING abandonado queda UNKNOWN con el mismo ID y nunca se reenvía', async (t) => {
  const f = await fixture(t),
    providerId = outboundMessageId(f.secret, f.tenant.id, f.account.id, f.message.id);
  await db.message.update({
    where: { id: f.message.id },
    data: {
      status: 'SENDING',
      attemptedAt: new Date(Date.now() - 121000),
      providerId,
      channelGeneration: 1,
    },
  });
  let called = false;
  await dispatchEvolutionQueued(db, f.tenant.id, f.account.id, {
    key: f.secret,
    submit: async () => {
      called = true;
    },
  });
  const stored = await db.message.findUniqueOrThrow({ where: { id: f.message.id } });
  assert.equal(stored.status, 'UNKNOWN');
  assert.equal(stored.providerId, providerId);
  assert.equal(called, false);
});
