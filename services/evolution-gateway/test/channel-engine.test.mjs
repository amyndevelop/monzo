import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGateway } from '../server.mjs';
import { DurableStore } from '../durable-store.mjs';
import { ChannelEngine } from '../channel-engine.mjs';
import { readConfig } from '../core.mjs';
import { instanceScope, instanceEventToken, InstanceError } from '../instance-client.mjs';
import {
  PROTOCOL,
  PROBE_PATH,
  EVENT_PATH,
  eventDigest,
  eventProof,
  verifyEvent,
  outboundMessageId,
} from '../protocol.mjs';

const key = () => randomBytes(32).toString('hex');
const scope = {
  tenantId: 'engine-tenant',
  accountId: 'engine-account',
  generation: 1,
  expectedPhone: '15551234567',
};
function fixture(t) {
  let now = 1800000000000;
  const directory = mkdtempSync(join(tmpdir(), 'monzo-channel-engine-')),
    storageKey = key();
  const config = readConfig({
    EVOLUTION_API_KEY: key(),
    EVOLUTION_GATEWAY_KEY: key(),
    EVOLUTION_WEBHOOK_SECRET: key(),
    MONZO_CALLBACK_URL: 'https://preview.vercel.app' + PROBE_PATH,
  });
  const states = new Map(),
    calls = [],
    deliveries = [];
  const client = {
    async status(s) {
      calls.push(['status', s.generation]);
      const value = states.get(instanceScope(s).name) ?? { state: 'NOT_CREATED' };
      if (value.state === 'CONNECTED' && value.connectedPhone !== s.expectedPhone)
        throw new InstanceError('NUMBER_MISMATCH');
      return value;
    },
    async create(s) {
      calls.push(['create', s.generation]);
      const name = instanceScope(s).name;
      if (!states.has(name)) states.set(name, { state: 'DISCONNECTED' });
      return client.status(s);
    },
    async connect(s) {
      calls.push(['connect', s.generation]);
      states.set(instanceScope(s).name, { state: 'CONNECTING' });
      return { state: 'QR', qr: 'fixture-qr-' + s.generation };
    },
    async disconnect(s) {
      calls.push(['disconnect', s.generation]);
      states.set(instanceScope(s).name, { state: 'DISCONNECTED' });
      return { state: 'DISCONNECTED' };
    },
    async sendText(s, data) {
      calls.push(['send', s.generation, data.providerId]);
      return data.providerId;
    },
  };
  const openStore = () => new DurableStore({ directory, key: storageKey, clock: () => now });
  let store = openStore();
  let engine = new ChannelEngine(config, { store, client, clock: () => now });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const transport = async (url, init) => {
    assert.equal(url, 'https://preview.vercel.app' + EVENT_PATH);
    const headers = {
      timestamp: init.headers['x-monzo-timestamp'],
      nonce: init.headers['x-monzo-nonce'],
      signature: init.headers['x-monzo-signature'],
    };
    assert.ok(verifyEvent(config.webhookSecret, init.body, headers, now));
    const event = JSON.parse(init.body);
    deliveries.push(event);
    const digest = eventDigest(init.body);
    return Response.json({
      protocol: PROTOCOL,
      id: event.id,
      digest,
      proof: eventProof(config.webhookSecret, event.id, digest, headers.nonce),
    });
  };
  return {
    config,
    client,
    calls,
    deliveries,
    states,
    get engine() {
      return engine;
    },
    get store() {
      return store;
    },
    advance(ms) {
      now += ms;
    },
    open(s = scope, phone = s.expectedPhone) {
      states.set(instanceScope(s).name, { state: 'CONNECTED', connectedPhone: phone });
    },
    command(operation = 'connect', s = scope, id = 'command:' + key()) {
      return { scope: s, commandId: id, operation, deadline: now + 120000 };
    },
    webhook(data, event = 'messages.upsert', s = scope) {
      return {
        instance: instanceScope(s).name,
        event,
        date_time: new Date(now).toISOString(),
        data,
        apikey: 'never-retain-api-key',
      };
    },
    auth(s = scope) {
      return 'Bearer ' + instanceEventToken(config, s);
    },
    relay() {
      return engine.relay({ transport });
    },
    reopen() {
      store.close();
      store = openStore();
      engine = new ChannelEngine(config, { store, client, clock: () => now });
    },
  };
}

test('coordinador: aceptar un comando no contacta WhatsApp; repetición durable no repite la conexión', async (t) => {
  const f = fixture(t),
    input = f.command();
  assert.equal(f.engine.command(input).state, 'ACCEPTED');
  assert.equal(f.calls.length, 0);
  assert.equal(f.engine.command(input).state, 'ACCEPTED');
  await f.engine.drainCommands();
  assert.equal(f.engine.status(scope).state, 'QR');
  assert.equal(f.calls.filter((c) => c[0] === 'connect').length, 1);
  f.reopen();
  f.advance(120001);
  assert.equal(f.engine.command(input).state, 'DONE');
  await f.engine.drainCommands();
  assert.equal(f.calls.filter((c) => c[0] === 'connect').length, 1);
  assert.throws(
    () => f.engine.command({ ...f.command('connect', scope, 'expired'), deadline: 1 }),
    /COMMAND_EXPIRED/,
  );
});

test('coordinador: QR repetido y refresh conservan el vencimiento original', async (t) => {
  const f = fixture(t);
  f.engine.command(f.command());
  await f.engine.drainCommands();
  const first = f.engine.status(scope);
  f.advance(10000);
  const raw = f.webhook(
    { qrcode: { code: 'fixture-qr-1', base64: 'never-retain-base64' } },
    'qrcode.updated',
  );
  f.engine.capture(raw, f.auth());
  await f.relay();
  f.engine.capture(raw, f.auth());
  assert.equal(f.engine.status(scope).qrExpiresAt, first.qrExpiresAt);
  f.advance(35001);
  assert.equal(f.engine.status(scope).qr, null);
  f.engine.command(f.command('refresh'));
  await f.engine.drainCommands();
  assert.equal(f.engine.status(scope).qr, null);
  assert.notEqual(f.engine.status(scope).state, 'QR');
});

test('coordinador: identidad equivocada cierra el número y no entrega su mensaje privado', async (t) => {
  const f = fixture(t);
  f.engine.command(f.command());
  await f.engine.drainCommands();
  await f.relay();
  f.open(scope, '15559999999');
  f.engine.capture(
    f.webhook({
      key: { id: 'FOREIGN_MESSAGE', fromMe: false, remoteJid: '15557654321@s.whatsapp.net' },
      message: { conversation: 'never-relay-private-text' },
      messageTimestamp: 1800000000,
    }),
    f.auth(),
  );
  await f.relay();
  assert.equal(JSON.stringify(f.deliveries).includes('never-relay-private-text'), false);
  assert.equal(
    f.calls.some((c) => c[0] === 'disconnect'),
    true,
  );
  assert.equal(f.engine.status(scope).lastErrorCode, 'NUMBER_MISMATCH');
  await f.engine.poll();
  assert.equal(f.engine.status(scope).lastErrorCode, 'NUMBER_MISMATCH');
});

test('coordinador: la generación nueva confirma cierre de la anterior antes de crear otra instancia', async (t) => {
  const f = fixture(t);
  f.engine.command(f.command());
  await f.engine.drainCommands();
  f.open();
  await f.engine.poll();
  const next = { ...scope, generation: 2 };
  f.calls.length = 0;
  f.engine.command(f.command('connect', next));
  await f.engine.drainCommands();
  assert.ok(
    f.calls.findIndex((c) => c[0] === 'disconnect' && c[1] === 1) <
      f.calls.findIndex((c) => c[0] === 'create' && c[1] === 2),
  );
  assert.equal(f.engine.status(next).state, 'QR');
  assert.equal(f.store.byInstance(instanceScope(scope).name).data.closed, true);
  assert.throws(() => f.engine.status(scope), /STALE_GENERATION/);
});

test('coordinador: desconectar durante la solicitud de QR nunca vuelve a exponer ese QR', async (t) => {
  const f = fixture(t);
  let release;
  const started = Promise.withResolvers();
  f.client.connect = async () => {
    started.resolve();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  f.engine.command(f.command());
  const running = f.engine.drainCommands();
  await started.promise;
  f.engine.command(f.command('disconnect'));
  release({ state: 'QR', qr: 'in-flight-qr' });
  await running;
  assert.equal(f.engine.status(scope).desiredState, 'DISCONNECTED');
  assert.equal(f.engine.status(scope).qr, null);
  assert.equal(f.engine.status(scope).state, 'DISCONNECTING');
  await f.engine.drainCommands();
  assert.equal(f.engine.status(scope).state, 'DISCONNECTED');
});

test('coordinador: reiniciar con comando en vuelo conserva UNKNOWN y consulta estado sin repetirlo', async (t) => {
  const f = fixture(t);
  const input = f.command();
  f.engine.command(input);
  f.store.claim('command');
  f.reopen();
  f.open();
  await f.engine.drainCommands();
  await f.engine.poll();
  assert.equal(f.engine.command(input).state, 'UNKNOWN');
  assert.equal(f.calls.filter((c) => c[0] === 'connect').length, 0);
  assert.equal(f.engine.status(scope).state, 'CONNECTED');
});

test('coordinador: autenticación por instancia y preparación pendiente no pierden eventos', async (t) => {
  const f = fixture(t);
  f.engine.command(f.command());
  await f.engine.drainCommands();
  await f.relay();
  const raw = f.webhook({
    key: { id: 'MESSAGE_ONE', fromMe: false, remoteJid: '15557654321@s.whatsapp.net' },
    message: { conversation: 'Hola' },
    messageTimestamp: 1800000000,
  });
  for (const credential of ['Bearer ' + f.config.gatewayKey, 'Bearer ' + key(), undefined])
    assert.throws(() => f.engine.capture(raw, credential), /UNAUTHORIZED/);
  f.engine.capture(raw, f.auth());
  const blocked = await f.relay();
  assert.equal(blocked[0].code, 'EVENT_PREPARATION');
  f.open();
  f.advance(5000);
  await f.relay();
  assert.equal(f.deliveries.at(-1).payload.type, 'message');
  assert.equal(f.deliveries.at(-1).payload.verifiedPhone, scope.expectedPhone);
  assert.equal(JSON.stringify(f.deliveries).includes(raw.apikey), false);
});

test('rutas de canal HTTP: credencial, destino fijo y scope se verifican antes de aceptar trabajo', async (t) => {
  const f = fixture(t);
  const server = createGateway({ ...f.config, channelsEnabled: true }, fetch, f.engine);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body, token = f.config.gatewayKey) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
  const input = { ...f.command(), callbackUrl: f.config.callbackUrl };
  assert.equal(
    (
      await post('/v1/channels/command', {
        ...input,
        callbackUrl: 'https://other-preview.vercel.app' + PROBE_PATH,
      })
    ).status,
    409,
  );
  assert.equal(f.store.accounts().length, 0);
  assert.equal((await post('/v1/channels/command', input, key())).status, 401);
  assert.equal((await post('/v1/channels/command', input)).status, 200);
  assert.equal(f.calls.length, 0);
  await f.engine.drainCommands();
  const response = await post('/v1/channels/state', { scope, callbackUrl: f.config.callbackUrl });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.qr, 'fixture-qr-1');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.stringify(state).includes(f.config.apiKey), false);
  const event = f.webhook({ qrcode: { code: 'another-fixture-qr' } }, 'qrcode.updated');
  assert.equal((await post('/internal/events', event)).status, 401);
  assert.equal(
    (await post('/internal/events', event, instanceEventToken(f.config, scope))).status,
    200,
  );
  assert.equal(
    (await post('/v1/channels/command', input, instanceEventToken(f.config, scope))).status,
    401,
  );
  assert.equal((await post('/instance/create', {})).status, 404);
});

test('rutas de canal HTTP: permanecen deshabilitadas sin la bandera explícita', async (t) => {
  const f = fixture(t),
    server = createGateway(f.config, fetch, f.engine);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const origin = 'http://127.0.0.1:' + server.address().port;
  const response = await fetch(origin + '/v1/channels/command', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + f.config.gatewayKey, 'content-type': 'application/json' },
    body: JSON.stringify({ ...f.command(), callbackUrl: f.config.callbackUrl }),
  });
  assert.equal(response.status, 404);
  assert.equal(f.store.accounts().length, 0);
});

test('configuración de canales: exige una clave de almacenamiento independiente y bandera válida', () => {
  const env = {
    EVOLUTION_API_KEY: key(),
    EVOLUTION_GATEWAY_KEY: key(),
    EVOLUTION_WEBHOOK_SECRET: key(),
    MONZO_CALLBACK_URL: 'https://preview.vercel.app' + PROBE_PATH,
  };
  assert.equal(readConfig(env).channelsEnabled, false);
  for (const extra of [
    { EVOLUTION_CHANNELS_ENABLED: 'yes' },
    { EVOLUTION_CHANNELS_ENABLED: 'true' },
    { EVOLUTION_CHANNELS_ENABLED: 'true', EVOLUTION_STORAGE_KEY: env.EVOLUTION_WEBHOOK_SECRET },
    { EVOLUTION_CHANNELS_ENABLED: 'true', EVOLUTION_STORAGE_KEY: env.EVOLUTION_GATEWAY_KEY },
  ])
    assert.throws(() => readConfig({ ...env, ...extra }), /CONFIG_CHANNELS|CONFIG_STORAGE_KEY/);
  assert.equal(
    readConfig({ ...env, EVOLUTION_CHANNELS_ENABLED: 'true', EVOLUTION_STORAGE_KEY: key() })
      .channelsEnabled,
    true,
  );
});

test('coordinador: otro propietario espera el cierre confirmado del mismo teléfono', async (t) => {
  const f = fixture(t),
    other = { ...scope, tenantId: 'other-tenant', accountId: 'other-account' };
  f.engine.command(f.command());
  await f.engine.drainCommands();
  assert.throws(() => f.engine.command(f.command('connect', other)), /PHONE_IN_USE/);
  f.engine.command(f.command('disconnect'));
  assert.throws(() => f.engine.command(f.command('connect', other)), /PHONE_IN_USE/);
  await f.engine.drainCommands();
  assert.equal(f.engine.command(f.command('connect', other)).state, 'ACCEPTED');
});

function sendCommand(f, messageId = 'message-one') {
  return {
    ...f.command('send', scope, 'message:' + messageId),
    data: {
      messageId,
      to: '15557654321',
      text: 'Mensaje del fixture',
      providerId: outboundMessageId(
        f.config.gatewayKey,
        scope.tenantId,
        scope.accountId,
        messageId,
      ),
    },
  };
}
test('envío durable: un ID de MONZO produce un solo POST lógico y un resultado persistente', async (t) => {
  const f = fixture(t);
  f.engine.command(f.command());
  await f.engine.drainCommands();
  f.open();
  await f.engine.poll();
  const command = sendCommand(f);
  assert.equal(f.engine.command(command).state, 'ACCEPTED');
  assert.equal(
    f.calls.some((c) => c[0] === 'send'),
    false,
  );
  await f.engine.drainCommands();
  assert.equal(f.calls.filter((c) => c[0] === 'send').length, 1);
  f.reopen();
  assert.equal(f.engine.command(command).state, 'DONE');
  await f.engine.drainCommands();
  assert.equal(f.calls.filter((c) => c[0] === 'send').length, 1);
  for (let i = 0; i < 4; i++) await f.relay();
  const result = f.deliveries.find((d) => d.payload.type === 'sendResult');
  assert.equal(result.payload.status, 'SENT');
  assert.equal(result.payload.providerId, command.data.providerId);
  assert.equal(result.payload.text, undefined);
});

test('envío durable: timeout no se reintenta y el reinicio conserva UNKNOWN', async (t) => {
  const f = fixture(t);
  f.engine.command(f.command());
  await f.engine.drainCommands();
  f.open();
  await f.engine.poll();
  let sends = 0;
  f.client.sendText = async () => {
    sends++;
    throw new InstanceError('INSTANCE_RESULT_UNKNOWN', true);
  };
  const command = sendCommand(f);
  f.engine.command(command);
  await f.engine.drainCommands();
  assert.equal(f.engine.command(command).state, 'UNKNOWN');
  f.reopen();
  await f.engine.drainCommands();
  assert.equal(f.engine.command(command).state, 'UNKNOWN');
  assert.equal(sends, 1);
  for (let i = 0; i < 4; i++) await f.relay();
  assert.equal(f.deliveries.find((d) => d.payload.type === 'sendResult').payload.status, 'UNKNOWN');
});

test('envío durable: desconexión previa cancela sin enviar y rechaza IDs falsos o claves alternativas', async (t) => {
  const f = fixture(t);
  f.engine.command(f.command());
  await f.engine.drainCommands();
  f.open();
  await f.engine.poll();
  const command = sendCommand(f);
  assert.throws(
    () => f.engine.command({ ...command, commandId: 'another-key' }),
    /INVALID_MESSAGE/,
  );
  assert.throws(
    () =>
      f.engine.command({
        ...command,
        data: { ...command.data, providerId: '3EB0' + 'A'.repeat(18) },
      }),
    /INVALID_MESSAGE/,
  );
  f.engine.command(command);
  f.engine.command(f.command('disconnect'));
  await f.engine.drainCommands();
  assert.equal(
    f.calls.some((c) => c[0] === 'send'),
    false,
  );
  for (let i = 0; i < 4; i++) await f.relay();
  assert.equal(
    f.deliveries.find((d) => d.payload.type === 'sendResult').payload.status,
    'CANCELED',
  );
});

test('ID de envío: estable en reintentos y distinto por empresa, cuenta, mensaje y clave', () => {
  const secret = key(),
    id = outboundMessageId(secret, 'tenant', 'account', 'message');
  assert.match(id, /^3EB0[A-F0-9]{18}$/);
  assert.equal(outboundMessageId(secret, 'tenant', 'account', 'message'), id);
  for (const change of [
    [key(), 'tenant', 'account', 'message'],
    [secret, 'other', 'account', 'message'],
    [secret, 'tenant', 'other', 'message'],
    [secret, 'tenant', 'account', 'other'],
  ])
    assert.notEqual(outboundMessageId(...change), id);
  assert.throws(
    () => outboundMessageId(secret, 'tenant\nother', 'account', 'message'),
    /INVALID_MESSAGE_SCOPE/,
  );
});

test('coordinador: repetir la solicitud no extiende el deadline aceptado originalmente', async (t) => {
  const f = fixture(t),
    command = f.command();
  command.deadline -= 119999;
  f.engine.command(command);
  f.advance(2000);
  assert.equal(
    f.engine.command({ ...command, deadline: command.deadline + 120000 }).state,
    'ACCEPTED',
  );
  await f.engine.drainCommands();
  assert.equal(f.engine.command(command).state, 'CANCELED');
  assert.equal(
    f.calls.some((c) => c[0] === 'connect'),
    false,
  );
});

test('envío durable: si cambia la identidad se cierra la sesión y no se envía al proveedor', async (t) => {
  const f = fixture(t);
  f.engine.command(f.command());
  await f.engine.drainCommands();
  f.open();
  await f.engine.poll();
  f.engine.command(sendCommand(f));
  f.open(scope, '15559999999');
  await f.engine.drainCommands();
  assert.equal(
    f.calls.some((c) => c[0] === 'send'),
    false,
  );
  assert.equal(
    f.calls.some((c) => c[0] === 'disconnect'),
    true,
  );
  assert.equal(f.engine.status(scope).lastErrorCode, 'NUMBER_MISMATCH');
});
