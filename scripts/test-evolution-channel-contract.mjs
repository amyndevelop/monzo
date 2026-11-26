import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { testEnvironment } from './test-env.mjs';
import { DurableStore } from '../services/evolution-gateway/durable-store.mjs';
import { ChannelEngine } from '../services/evolution-gateway/channel-engine.mjs';
import { readConfig } from '../services/evolution-gateway/core.mjs';
import {
  instanceScope,
  instanceEventToken,
} from '../services/evolution-gateway/instance-client.mjs';
import { PROBE_PATH } from '../services/evolution-gateway/protocol.mjs';
import { receiveEvolutionEvent } from '../src/modules/evolution/event-request.ts';
import { processEvolutionEvent } from '../src/modules/evolution/events.ts';

Object.assign(process.env, testEnvironment());
const db = new PrismaClient(),
  key = () => randomBytes(32).toString('hex');
const directory = mkdtempSync(join(tmpdir(), 'monzo-channel-contract-'));
let tenant, store;
const now = Date.now();
try {
  const config = readConfig({
    EVOLUTION_API_KEY: key(),
    EVOLUTION_GATEWAY_KEY: key(),
    EVOLUTION_WEBHOOK_SECRET: key(),
    MONZO_CALLBACK_URL: 'https://preview.example.invalid' + PROBE_PATH,
  });
  tenant = await db.tenant.create({
    data: {
      name: 'Channel contract test',
      slug: 'channel-contract-' + randomBytes(8).toString('hex'),
    },
  });
  const account = await db.whatsappAccount.create({
    data: {
      tenantId: tenant.id,
      provider: 'EVOLUTION',
      phoneNumberId: randomBytes(6).readUIntBE(0, 6).toString(),
      businessAccountId: 'evolution',
      displayPhone: 'Fixture',
      displayName: 'Fixture',
    },
  });
  const scope = {
    tenantId: tenant.id,
    accountId: account.id,
    generation: 1,
    expectedPhone: '1555' + randomBytes(4).readUIntBE(0, 4).toString(),
  };
  await db.evolutionSession.create({
    data: {
      accountId: account.id,
      tenantId: tenant.id,
      expectedWaId: scope.expectedPhone,
      desiredState: 'CONNECTED',
    },
  });
  store = new DurableStore({ directory, key: key(), clock: () => now });
  const states = new Map();
  // Controlled provider fixture; no WhatsApp connection is initiated by this test.
  const client = {
    async status(s) {
      return states.get(instanceScope(s).name) ?? { state: 'NOT_CREATED' };
    },
    async create(s) {
      const name = instanceScope(s).name;
      if (!states.has(name)) states.set(name, { state: 'DISCONNECTED' });
      return client.status(s);
    },
    async connect(s) {
      states.set(instanceScope(s).name, { state: 'CONNECTING' });
      return { state: 'QR', qr: 'fixture-qr-' + s.generation };
    },
    async disconnect(s) {
      states.set(instanceScope(s).name, { state: 'DISCONNECTED' });
      return { state: 'DISCONNECTED' };
    },
  };
  const engine = new ChannelEngine(config, { store, client, clock: () => now });
  const transport = (url, init) =>
    receiveEvolutionEvent(new Request(url, init), {
      enabled: true,
      secret: config.webhookSecret,
      clock: () => now,
      process: (event, digest) => processEvolutionEvent(db, event, digest, now),
    });
  async function relay() {
    for (let i = 0; i < 10; i++) {
      const results = await engine.relay({ transport });
      assert.ok(
        results.every((r) => r.acknowledged),
        JSON.stringify(results),
      );
      if (!results.length) return;
    }
    throw new Error('Contract relay did not drain');
  }
  function capture(data, event = 'messages.upsert', ownScope = scope) {
    engine.capture(
      {
        instance: instanceScope(ownScope).name,
        event,
        date_time: new Date(now).toISOString(),
        data,
        apikey: 'fixture-must-not-be-retained',
      },
      'Bearer ' + instanceEventToken(config, ownScope),
    );
  }
  engine.command({
    scope,
    commandId: 'connect:' + key(),
    operation: 'connect',
    deadline: now + 120000,
  });
  await engine.drainCommands();
  await relay();
  assert.equal(
    (await db.evolutionSession.findUniqueOrThrow({ where: { accountId: account.id } })).state,
    'QR',
  );
  states.set(instanceScope(scope).name, {
    state: 'CONNECTED',
    connectedPhone: scope.expectedPhone,
  });
  await engine.poll();
  await relay();
  assert.equal(
    (await db.whatsappAccount.findUniqueOrThrow({ where: { id: account.id } })).enabled,
    true,
  );
  const incoming = {
    key: { id: 'CONTRACT_INBOUND', remoteJid: '15557654321@s.whatsapp.net', fromMe: false },
    message: { conversation: 'Hola desde el fixture' },
    messageTimestamp: Math.floor(now / 1000),
    pushName: 'Cliente',
  };
  capture(incoming);
  capture(incoming);
  await relay();
  assert.equal(await db.message.count({ where: { accountId: account.id } }), 1);
  const conversation = await db.conversation.findFirstOrThrow({ where: { accountId: account.id } });
  assert.equal(conversation.unreadCount, 1);
  assert.equal(conversation.automationPaused, false);
  const human = {
    ...incoming,
    key: { ...incoming.key, id: 'CONTRACT_HUMAN', fromMe: true },
    message: { conversation: 'Respuesta humana' },
    pushName: 'Yo',
  };
  capture(human, 'send.message');
  await relay();
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).automationPaused,
    true,
  );
  const next = { ...scope, generation: 2 };
  await db.evolutionSession.update({
    where: { accountId: account.id },
    data: { generation: 2, state: 'CONNECTING', lastEventSequence: 0 },
  });
  engine.command({
    scope: next,
    commandId: 'reconnect:' + key(),
    operation: 'connect',
    deadline: now + 120000,
  });
  await engine.drainCommands();
  await relay();
  assert.equal(
    (await db.evolutionSession.findUniqueOrThrow({ where: { accountId: account.id } })).state,
    'QR',
  );
  capture(
    {
      keyId: 'CONTRACT_HUMAN',
      remoteJid: '15557654321@s.whatsapp.net',
      fromMe: true,
      status: 'READ',
    },
    'messages.update',
    scope,
  );
  await relay();
  assert.equal(
    (
      await db.message.findUniqueOrThrow({
        where: { accountId_providerId: { accountId: account.id, providerId: 'CONTRACT_HUMAN' } },
      })
    ).status,
    'READ',
  );
  const current = await db.evolutionSession.findUniqueOrThrow({ where: { accountId: account.id } });
  assert.equal(current.generation, 2);
  assert.equal(current.state, 'QR');
  console.log(
    'Contrato gateway → firma → receptor → PostgreSQL real comprobado: QR, identidad, mensaje deduplicado, pausa humana y recibo tardío de generación anterior. Solo proveedor controlado y base local aislada; sin WhatsApp real.',
  );
} finally {
  store?.close();
  rmSync(directory, { recursive: true, force: true });
  if (tenant) {
    const where = { tenantId: tenant.id };
    await db.evolutionDelivery.deleteMany({ where });
    await db.message.deleteMany({ where });
    await db.conversation.deleteMany({ where });
    await db.contact.deleteMany({ where });
    await db.evolutionSession.deleteMany({ where });
    await db.whatsappAccount.deleteMany({ where });
    await db.tenant.delete({ where: { id: tenant.id } });
  }
  await db.$disconnect();
}
