import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { testEnvironment } from './test-env.mjs';
import {
  processEvolutionEvent,
  EvolutionEventError,
  qrContext,
} from '../src/modules/evolution/events';
import { receiveEvolutionEvent } from '../src/modules/evolution/event-request';
import type { EvolutionEvent } from '../src/modules/evolution/event-schema';
import { decryptToken } from '../src/modules/whatsapp/core/crypto';
import { processOutbound } from '../src/modules/whatsapp/core/outbound';
import {
  EVENT_PATH,
  PROTOCOL,
  eventDigest,
  eventProof,
  eventSignature,
  probeSignature,
} from '../services/evolution-gateway/protocol.mjs';

// Refuse any database except the existing isolated local test service.
Object.assign(process.env, testEnvironment());
const db = new PrismaClient();
after(async () => {
  await db.$disconnect();
});
const hex = () => randomBytes(32).toString('hex');
const now = Date.now();
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const suffix = randomBytes(8).toString('hex');
  const tenant = await db.tenant.create({
    data: { name: 'Evolution test', slug: 'evo-' + suffix },
  });
  t.after(async () => {
    const where = { tenantId: tenant.id };
    await db.evolutionDelivery.deleteMany({ where });
    await db.message.deleteMany({ where });
    await db.conversation.deleteMany({ where });
    await db.contact.deleteMany({ where });
    await db.automationFlow.deleteMany({ where });
    await db.evolutionSession.deleteMany({ where });
    await db.whatsappAccount.deleteMany({ where });
    await db.membership.deleteMany({ where });
    await db.tenant.delete({ where: { id: tenant.id } });
  });
  const account = await db.whatsappAccount.create({
    data: {
      tenantId: tenant.id,
      provider: 'EVOLUTION',
      phoneNumberId: randomBytes(6).readUIntBE(0, 6).toString(),
      businessAccountId: 'evolution',
      displayPhone: 'Prueba',
      displayName: 'Prueba',
    },
  });
  const scope = {
    tenantId: tenant.id,
    accountId: account.id,
    generation: 1,
    expectedPhone: '15551234567',
  };
  await db.evolutionSession.create({
    data: {
      accountId: account.id,
      tenantId: tenant.id,
      expectedWaId: scope.expectedPhone,
      desiredState: 'CONNECTED',
    },
  });
  let sequence = 0;
  const event = (payload: EvolutionEvent['payload']): EvolutionEvent => ({
    kind: 'monzo.evolution.event',
    id: hex(),
    sequence: ++sequence,
    scope,
    payload,
  });
  const incoming = (
    overrides: Partial<Extract<EvolutionEvent['payload'], { type: 'message' }>> = {},
  ) =>
    event({
      type: 'message',
      providerId: hex(),
      peer: '15557654321',
      fromMe: false,
      occurredAt: now,
      verifiedPhone: scope.expectedPhone,
      verifiedAt: now,
      history: false,
      messageType: 'text',
      text: 'Hola',
      contactName: 'Cliente',
      ...overrides,
    });
  const process = (e: EvolutionEvent, digest = eventDigest(JSON.stringify(e))) =>
    processEvolutionEvent(db, e, digest, now);
  return { tenant, account, scope, event, incoming, process };
}

test('eventos MONZO: transacción real deduplica entregas concurrentes y mensajes con IDs de evento distintos', async (t) => {
  const f = await fixture(t),
    e = f.incoming();
  await Promise.all(Array.from({ length: 4 }, () => f.process(e)));
  assert.equal(await db.evolutionDelivery.count({ where: { accountId: f.account.id } }), 1);
  assert.equal(await db.message.count({ where: { accountId: f.account.id } }), 1);
  const conversation = await db.conversation.findFirstOrThrow({
    where: { accountId: f.account.id },
  });
  assert.equal(conversation.unreadCount, 1);
  await f.process({ ...e, id: hex(), sequence: e.sequence + 1 });
  assert.equal(await db.message.count({ where: { accountId: f.account.id } }), 1);
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).unreadCount,
    1,
  );
  await assert.rejects(
    () => f.process(e, hex()),
    (err: unknown) => err instanceof EvolutionEventError && err.code === 'EVENT_CONFLICT',
  );
});

test('eventos MONZO: rechaza otra empresa, teléfono, generación futura y timestamps futuros sin escrituras', async (t) => {
  const f = await fixture(t),
    e = f.incoming();
  for (const change of [
    { tenantId: 'other-tenant' },
    { accountId: 'other-account' },
    { expectedPhone: '15550000000' },
    { generation: 2 },
  ]) {
    await assert.rejects(
      () => f.process({ ...e, scope: { ...e.scope, ...change } }),
      EvolutionEventError,
    );
  }
  if (e.payload.type !== 'message') throw new Error('fixture');
  await assert.rejects(
    () => f.process({ ...e, payload: { ...e.payload, verifiedPhone: '15550000000' } }),
    EvolutionEventError,
  );
  await assert.rejects(
    () => f.process({ ...e, payload: { ...e.payload, occurredAt: now + 61000 } }),
    EvolutionEventError,
  );
  assert.equal(await db.evolutionDelivery.count({ where: { accountId: f.account.id } }), 0);
  assert.equal(await db.message.count({ where: { accountId: f.account.id } }), 0);
});

test('eventos MONZO: QR cifrado, caducidad, identidad y generación preservan el estado correcto', async (t) => {
  const f = await fixture(t);
  await f.process(
    f.event({
      type: 'connection',
      state: 'QR',
      qr: 'fixture-qr-material',
      observedAt: now,
      qrExpiresAt: now + 45000,
    }),
  );
  let session = await db.evolutionSession.findUniqueOrThrow({ where: { accountId: f.account.id } });
  assert.equal(session.state, 'QR');
  assert.ok(session.qrEncrypted && !session.qrEncrypted.includes('fixture-qr-material'));
  assert.equal(
    decryptToken(session.qrEncrypted!, f.tenant.id, qrContext(f.account.id, 1)),
    'fixture-qr-material',
  );
  await f.process(
    f.event({
      type: 'connection',
      state: 'CONNECTED',
      connectedPhone: '15550000000',
      observedAt: now,
    }),
  );
  assert.equal(
    (await db.evolutionSession.findUniqueOrThrow({ where: { accountId: f.account.id } })).state,
    'ERROR',
  );
  assert.equal(
    (await db.whatsappAccount.findUniqueOrThrow({ where: { id: f.account.id } })).enabled,
    false,
  );
  await f.process(
    f.event({
      type: 'connection',
      state: 'CONNECTED',
      connectedPhone: f.scope.expectedPhone,
      observedAt: now,
    }),
  );
  session = await db.evolutionSession.findUniqueOrThrow({ where: { accountId: f.account.id } });
  assert.equal(session.state, 'CONNECTED');
  assert.equal(session.qrEncrypted, null);
  await db.evolutionSession.update({
    where: { accountId: f.account.id },
    data: { generation: 2, state: 'DISCONNECTED', desiredState: 'DISCONNECTED' },
  });
  await f.process(
    f.event({
      type: 'connection',
      state: 'QR',
      qr: 'old-qr',
      observedAt: now,
      qrExpiresAt: now + 45000,
    }),
  );
  assert.equal(
    (await db.evolutionSession.findUniqueOrThrow({ where: { accountId: f.account.id } })).state,
    'DISCONNECTED',
  );
});

test('eventos MONZO: fallo de cifrado revierte el registro; una repetición válida puede confirmarlo', async (t) => {
  const f = await fixture(t),
    e = f.event({
      type: 'connection',
      state: 'QR',
      qr: 'fixture',
      observedAt: now,
      qrExpiresAt: now + 45000,
    });
  const original = process.env.WHATSAPP_ENCRYPTION_KEY;
  try {
    process.env.WHATSAPP_ENCRYPTION_KEY = 'invalid';
    await assert.rejects(() => f.process(e));
  } finally {
    process.env.WHATSAPP_ENCRYPTION_KEY = original;
  }
  assert.equal(await db.evolutionDelivery.count({ where: { id: e.id } }), 0);
  assert.equal(
    (await db.evolutionSession.findUniqueOrThrow({ where: { accountId: f.account.id } })).state,
    'DISCONNECTED',
  );
  await f.process(e);
  assert.equal(await db.evolutionDelivery.count({ where: { id: e.id } }), 1);
});

test('eventos MONZO: envío desde el teléfono pausa al bot y conserva el nombre del cliente', async (t) => {
  const f = await fixture(t);
  await f.process(f.incoming());
  const conversation = await db.conversation.findFirstOrThrow({
    where: { accountId: f.account.id },
  });
  const flow = await db.automationFlow.create({
    data: { tenantId: f.tenant.id, accountId: f.account.id, draft: {}, enabled: false },
  });
  const queued = await db.message.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      type: 'text',
      text: 'Respuesta automática',
      automationFlowId: flow.id,
      occurredAt: new Date(now),
    },
  });
  await f.process(f.incoming({ fromMe: true, text: 'Intervención humana', contactName: 'Yo' }));
  assert.equal(
    (await db.contact.findFirstOrThrow({ where: { accountId: f.account.id } })).name,
    'Cliente',
  );
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).automationPaused,
    true,
  );
  assert.equal(
    (await db.message.findUniqueOrThrow({ where: { id: queued.id } })).status,
    'CANCELED',
  );
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).unreadCount,
    1,
  );
});

test('eventos MONZO: eco propio y recibos fuera de orden reconcilian UNKNOWN sin pausar el bot', async (t) => {
  const f = await fixture(t);
  await f.process(f.incoming());
  const conversation = await db.conversation.findFirstOrThrow({
    where: { accountId: f.account.id },
  });
  const providerId = hex();
  const own = await db.message.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      status: 'UNKNOWN',
      type: 'text',
      text: 'Desde MONZO',
      providerId,
      channelGeneration: 1,
      occurredAt: new Date(now),
    },
  });
  await f.process(f.incoming({ providerId, fromMe: true, text: 'Desde MONZO' }));
  assert.equal((await db.message.findUniqueOrThrow({ where: { id: own.id } })).status, 'SENT');
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).automationPaused,
    false,
  );
  for (const status of ['READ', 'DELIVERED', 'FAILED'] as const)
    await f.process(
      f.event({
        type: 'receipt',
        providerId,
        peer: '15557654321',
        status,
        occurredAt: now,
        verifiedAt: now,
        verifiedPhone: f.scope.expectedPhone,
      }),
    );
  assert.equal((await db.message.findUniqueOrThrow({ where: { id: own.id } })).status, 'READ');
});

test('eventos MONZO: historial no dispara respuestas ni pausa conversaciones activas; el worker Meta omite Evolution', async (t) => {
  const f = await fixture(t);
  await f.process(f.incoming());
  const conversation = await db.conversation.findFirstOrThrow({
    where: { accountId: f.account.id },
  });
  await f.process(f.incoming({ fromMe: true, history: true, occurredAt: now - 86400000 }));
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).automationPaused,
    false,
  );
  const queued = await db.message.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      type: 'text',
      text: 'No enviar a Meta',
      occurredAt: new Date(now),
    },
  });
  let contacted = false;
  await processOutbound(db, queued.id, async () => {
    contacted = true;
    throw new Error('Not allowed');
  });
  assert.equal(contacted, false);
  assert.equal((await db.message.findUniqueOrThrow({ where: { id: queued.id } })).status, 'QUEUED');
});

test('receptor HTTP MONZO: autenticación y commit antes de ACK; errores no exponen datos', async (t) => {
  const f = await fixture(t),
    e = f.incoming(),
    secret = hex(),
    nonce = randomBytes(16).toString('hex'),
    timestamp = String(Math.floor(now / 1000));
  const body = JSON.stringify(e);
  const request = (signature = eventSignature(secret, body, timestamp, nonce), content = body) =>
    new Request('https://monzo.example.test' + EVENT_PATH, {
      method: 'POST',
      body: content,
      headers: {
        'content-type': 'application/json',
        'x-monzo-timestamp': timestamp,
        'x-monzo-nonce': nonce,
        'x-monzo-signature': signature,
      },
    });
  const options = {
    enabled: true,
    secret,
    clock: () => now,
    process: (event: EvolutionEvent, digest: string) => f.process(event, digest),
  };
  assert.equal(
    (await receiveEvolutionEvent(request(), { ...options, enabled: false })).status,
    503,
  );
  assert.equal(
    (await receiveEvolutionEvent(request(probeSignature(secret, body, timestamp, nonce)), options))
      .status,
    401,
  );
  assert.equal(await db.evolutionDelivery.count({ where: { id: e.id } }), 0);
  let response = await receiveEvolutionEvent(request(), options);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    protocol: PROTOCOL,
    id: e.id,
    digest: eventDigest(body),
    proof: eventProof(secret, e.id, eventDigest(body), nonce),
  });
  assert.equal(await db.message.count({ where: { accountId: f.account.id } }), 1);
  response = await receiveEvolutionEvent(request(), options);
  assert.equal(response.status, 200);
  assert.equal(await db.message.count({ where: { accountId: f.account.id } }), 1);
  response = await receiveEvolutionEvent(request(), {
    ...options,
    process: async () => {
      throw new Error('private-database-url-and-payload');
    },
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'EVENT_PROCESSING' });
});

test('receptor HTTP MONZO: limita bytes y rechaza JSON, campos o firma inválidos antes de escribir', async (t) => {
  const f = await fixture(t),
    secret = hex(),
    nonce = randomBytes(16).toString('hex');
  const timestamp = String(Math.floor(now / 1000));
  let called = false;
  const options = {
    enabled: true,
    secret,
    clock: () => now,
    process: async () => {
      called = true;
    },
  };
  const signed = (body: string, extras: Record<string, string> = {}) =>
    new Request('https://monzo.example.test' + EVENT_PATH, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-monzo-timestamp': timestamp,
        'x-monzo-nonce': nonce,
        'x-monzo-signature': eventSignature(secret, body, timestamp, nonce),
        ...extras,
      },
    });
  for (const body of [
    '{',
    JSON.stringify({ ...f.incoming(), unexpected: 'not allowed' }),
    JSON.stringify({ ...f.incoming(), scope: { ...f.scope, generation: 0 } }),
  ])
    assert.equal((await receiveEvolutionEvent(signed(body), options)).status, 400);
  const valid = JSON.stringify(f.incoming());
  assert.equal(
    (await receiveEvolutionEvent(signed(valid, { 'content-length': '65537' }), options)).status,
    413,
  );
  assert.equal(
    (await receiveEvolutionEvent(signed(valid, { 'content-type': 'text/plain' }), options)).status,
    415,
  );
  assert.equal((await receiveEvolutionEvent(signed('x'.repeat(65537)), options)).status, 413);
  assert.equal(
    (
      await receiveEvolutionEvent(
        signed(valid + ' ', {
          'x-monzo-signature': eventSignature(secret, valid, timestamp, nonce),
        }),
        options,
      )
    ).status,
    401,
  );
  assert.equal(called, false);
  assert.equal(await db.evolutionDelivery.count({ where: { accountId: f.account.id } }), 0);
});

test('eventos MONZO: resultados de envío revalidan destino/generación y no retroceden un envío confirmado', async (t) => {
  const f = await fixture(t);
  await f.process(f.incoming());
  const conversation = await db.conversation.findFirstOrThrow({
    where: { accountId: f.account.id },
  });
  const providerId = '3EB0' + 'C'.repeat(18);
  const message = await db.message.create({
    data: {
      tenantId: f.tenant.id,
      accountId: f.account.id,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      status: 'UNKNOWN',
      type: 'text',
      text: 'Mensaje',
      channelGeneration: 1,
      providerId,
      occurredAt: new Date(now),
    },
  });
  const payload = {
    type: 'sendResult' as const,
    messageId: message.id,
    providerId,
    peer: '15557654321',
    status: 'SENT' as const,
    occurredAt: now,
    code: 'OK' as const,
  };
  await f.process(f.event({ ...payload, peer: '15550000000' }));
  assert.equal(
    (await db.message.findUniqueOrThrow({ where: { id: message.id } })).status,
    'UNKNOWN',
  );
  await f.process(f.event(payload));
  for (const status of ['UNKNOWN', 'FAILED', 'CANCELED'] as const)
    await f.process(f.event({ ...payload, status, code: 'RESULT_UNKNOWN' }));
  assert.equal((await db.message.findUniqueOrThrow({ where: { id: message.id } })).status, 'SENT');
  await db.message.update({ where: { id: message.id }, data: { status: 'UNKNOWN' } });
  await db.evolutionSession.update({
    where: { accountId: f.account.id },
    data: { generation: 2, state: 'DISCONNECTED', desiredState: 'DISCONNECTED' },
  });
  await f.process(f.event(payload));
  assert.equal((await db.message.findUniqueOrThrow({ where: { id: message.id } })).status, 'SENT');
  const session = await db.evolutionSession.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  assert.equal(session.generation, 2);
  assert.equal(session.state, 'DISCONNECTED');
});
