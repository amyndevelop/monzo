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
