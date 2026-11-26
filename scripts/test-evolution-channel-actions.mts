import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { testEnvironment } from './test-env.mjs';
import {
  commandEvolutionChannel,
  ChannelActionError,
} from '../src/modules/evolution/channel-commands';
import {
  evolutionCommand,
  evolutionState,
  ChannelRpcError,
  type EvolutionCommand,
} from '../src/modules/evolution/channel-api';
import { evolutionConfiguration, type EvolutionTransport } from '../src/modules/evolution/core';
import { processEvolutionEvent } from '../src/modules/evolution/events';
import { commandWeb } from '../src/modules/whatsapp/web/core';
import { PROTOCOL, PROBE_PATH } from '../services/evolution-gateway/protocol.mjs';

Object.assign(process.env, testEnvironment());
const db = new PrismaClient();
after(() => db.$disconnect());
const key = () => randomBytes(32).toString('hex'),
  now = Date.now();
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const user = await db.user.create({
    data: { email: 'evo-action-' + randomUUID() + '@example.invalid', emailVerified: true },
  });
  const tenant = await db.tenant.create({
    data: { name: 'Evolution actions fixture', slug: 'evo-actions-' + randomUUID() },
  });
  await db.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'OWNER' } });
  t.after(async () => {
    const where = { tenantId: tenant.id };
    await db.evolutionDelivery.deleteMany({ where });
    await db.message.deleteMany({ where });
    await db.conversation.deleteMany({ where });
    await db.contact.deleteMany({ where });
    await db.evolutionSession.deleteMany({ where });
    await db.whatsappWebSession.deleteMany({ where });
    await db.whatsappAccount.deleteMany({ where });
    await db.membership.deleteMany({ where });
    await db.rateLimit.deleteMany({ where: { key: 'evolution-channel-actions:' + tenant.id } });
    await db.tenant.delete({ where: { id: tenant.id } });
    await db.user.delete({ where: { id: user.id } });
  });
  const commands: EvolutionCommand[] = [];
  const submit = async (command: EvolutionCommand) => {
    commands.push(command);
  };
  const phone = '1555' + randomBytes(4).readUIntBE(0, 4).toString();
  const action = (input: unknown, send = submit) =>
    commandEvolutionChannel(db, tenant.id, user.id, input, send, now);
  const prepare = (number = phone) =>
    action({ action: 'create', name: 'WhatsApp de prueba', phone: number });
  const command = (
    accountId: string,
    generation: number,
    action: 'connect' | 'disconnect' | 'refresh' = 'connect',
  ) => ({ action, accountId, generation, idempotencyKey: randomUUID() });
  return { user, tenant, commands, phone, action, prepare, command };
}

test('acciones Evolution: preparar no contacta proveedor, es repetible y limita conexiones de empresa', async (t) => {
  const f = await fixture(t),
    first = await f.prepare('+' + f.phone);
  assert.equal(f.commands.length, 0);
  assert.equal((await f.prepare()).accountId, first.accountId);
  assert.equal(
    (await db.whatsappAccount.findUniqueOrThrow({ where: { id: first.accountId } })).provider,
    'EVOLUTION',
  );
  for (let i = 0; i < 2; i++) await f.prepare('15550000' + (i + 1));
  await assert.rejects(
    () => f.prepare('15550000999'),
    (e: unknown) => e instanceof ChannelActionError && e.status === 409,
  );
  assert.equal(f.commands.length, 0);
});

test('acciones Evolution: solo OWNER y cuenta de la empresa; revocación se verifica dentro de la transacción', async (t) => {
  const f = await fixture(t),
    other = await fixture(t),
    first = await f.prepare();
  await assert.rejects(
    () => other.action(other.command(first.accountId, 1)),
    (e: unknown) => e instanceof ChannelActionError && e.status === 403,
  );
  for (const role of ['ADMIN', 'MEMBER'] as const) {
    await db.membership.update({
      where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
      data: { role },
    });
    await assert.rejects(
      () => f.action(f.command(first.accountId, 1)),
      (e: unknown) => e instanceof ChannelActionError && e.status === 403,
    );
  }
  assert.equal(f.commands.length, 0);
});

test('acciones Evolution: connect avanza generación una vez; reintento conserva comando y solicitudes obsoletas fallan', async (t) => {
  const f = await fixture(t),
    first = await f.prepare(),
    input = f.command(first.accountId, 1);
  const result = await f.action(input);
  await f.action(input);
  assert.equal(result.generation, 2);
  assert.equal(f.commands.length, 2);
  assert.equal(f.commands[0].commandId, f.commands[1].commandId);
  assert.equal(f.commands[0].scope.generation, f.commands[1].scope.generation);
  assert.equal(
    (
      await db.rateLimit.findUniqueOrThrow({
        where: { key: 'evolution-channel-actions:' + f.tenant.id },
      })
    ).count,
    1,
  );
  await assert.rejects(() => f.action(f.command(first.accountId, 1)), ChannelActionError);
  assert.equal(f.commands.length, 2);
});

test('acciones Evolution: espera confirmación del cierre entre empresas y también bloquea la conexión QR anterior', async (t) => {
  const f = await fixture(t),
    other = await fixture(t),
    first = await f.prepare(),
    second = await other.prepare(f.phone);
  await f.action(f.command(first.accountId, 1));
  await assert.rejects(
    () => other.action(other.command(second.accountId, 1)),
    /otra conexión activa/,
  );
  await f.action(f.command(first.accountId, 2, 'disconnect'));
  await assert.rejects(
    () => other.action(other.command(second.accountId, 1)),
    /otra conexión activa/,
  );
  await processEvolutionEvent(
    db,
    {
      kind: 'monzo.evolution.event',
      id: key(),
      sequence: 1,
      scope: {
        tenantId: f.tenant.id,
        accountId: first.accountId,
        generation: 2,
        expectedPhone: f.phone,
      },
      payload: { type: 'connection', state: 'DISCONNECTED', observedAt: now },
    },
    key(),
    now,
  );
  await other.action(other.command(second.accountId, 1));
  const native = await db.whatsappAccount.create({
    data: {
      tenantId: f.tenant.id,
      provider: 'BAILEYS',
      phoneNumberId: randomBytes(8).readBigUInt64BE().toString(),
      businessAccountId: 'fixture',
      displayPhone: '+' + f.phone,
      displayName: 'Native fixture',
    },
  });
  await db.whatsappWebSession.create({
    data: { accountId: native.id, tenantId: f.tenant.id, expectedWaId: f.phone },
  });
  const before = process.env.EVOLUTION_CHANNELS_ENABLED;
  try {
    process.env.EVOLUTION_CHANNELS_ENABLED = 'true';
    await assert.rejects(
      () =>
        commandWeb(db, f.tenant.id, f.user.id, {
          action: 'connect',
          accountId: native.id,
          generation: 1,
        }),
      /otra conexión activa/,
    );
  } finally {
    if (before === undefined) delete process.env.EVOLUTION_CHANNELS_ENABLED;
    else process.env.EVOLUTION_CHANNELS_ENABLED = before;
  }
});

test('acciones Evolution: una respuesta HTTP perdida no borra un QR ya recibido', async (t) => {
  const f = await fixture(t),
    first = await f.prepare();
  await assert.rejects(
    () =>
      f.action(f.command(first.accountId, 1), async (command) => {
        await processEvolutionEvent(
          db,
          {
            kind: 'monzo.evolution.event',
            id: key(),
            sequence: 1,
            scope: command.scope,
            payload: {
              type: 'connection',
              state: 'QR',
              observedAt: now,
              qr: 'fixture-qr',
              qrExpiresAt: now + 45000,
            },
          },
          key(),
          now,
        );
        throw new ChannelRpcError('UNREACHABLE', true);
      }),
    ChannelRpcError,
  );
  const session = await db.evolutionSession.findUniqueOrThrow({
    where: { accountId: first.accountId },
  });
  assert.equal(session.state, 'QR');
  assert.equal(session.lastErrorCode, null);
  assert.ok(session.qrEncrypted);
});

test('cliente de canales: origen fijo, cuerpo limitado, ACK exacto y errores sin filtrar respuesta privada', async () => {
  const config = evolutionConfiguration({
    ...process.env,
    EVOLUTION_GATEWAY_URL: 'https://gateway.example.invalid',
    EVOLUTION_GATEWAY_KEY: key(),
    EVOLUTION_WEBHOOK_SECRET: key(),
  });
  assert.equal(config.configured, true);
  const scope = {
    tenantId: 'tenant',
    accountId: 'account',
    generation: 1,
    expectedPhone: '15551234567',
  };
  const command: EvolutionCommand = {
    scope,
    commandId: 'connect:' + randomUUID(),
    operation: 'connect',
    deadline: now + 120000,
  };
  let calls = 0;
  const transport: EvolutionTransport = async (url, init) => {
    calls++;
    assert.equal(url, 'https://gateway.example.invalid/v1/channels/command');
    assert.equal(init.redirect, 'error');
    assert.equal(JSON.parse(init.body).callbackUrl, 'https://preview.example.invalid' + PROBE_PATH);
    return Response.json({ protocol: PROTOCOL, commandId: command.commandId, state: 'ACCEPTED' });
  };
  assert.equal(
    (await evolutionCommand(config, 'https://preview.example.invalid', command, transport)).state,
    'ACCEPTED',
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      evolutionCommand(config, 'https://preview.example.invalid', command, async () =>
        Response.json({ protocol: PROTOCOL, commandId: 'wrong', state: 'ACCEPTED' }),
      ),
    ChannelRpcError,
  );
  await assert.rejects(
    () =>
      evolutionCommand(config, 'https://preview.example.invalid', command, async () =>
        Response.json({ error: 'secret-private-provider-response' }, { status: 500 }),
      ),
    (e: unknown) => e instanceof ChannelRpcError && e.message === 'UNREACHABLE' && e.uncertain,
  );
  await assert.rejects(
    () =>
      evolutionState(config, 'https://preview.example.invalid', scope, async () =>
        Response.json({
          protocol: PROTOCOL,
          scope: { ...scope, tenantId: 'other' },
          state: 'CONNECTED',
          desiredState: 'CONNECTED',
          connectedPhone: scope.expectedPhone,
          qr: null,
          qrExpiresAt: null,
          lastSeenAt: now,
          lastErrorCode: null,
        }),
      ),
    ChannelRpcError,
  );
});
