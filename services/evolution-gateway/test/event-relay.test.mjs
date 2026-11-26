import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableStore } from '../durable-store.mjs';
import { readConfig } from '../core.mjs';
import { deliverEvent, relayEvents } from '../event-relay.mjs';
import {
  PROTOCOL,
  PROBE_PATH,
  EVENT_PATH,
  probeSignature,
  verifyProbe,
  eventDigest,
  eventSignature,
  verifyEvent,
  eventProof,
} from '../protocol.mjs';

const key = () => randomBytes(32).toString('hex');
const scope = {
  tenantId: 'relay-tenant',
  accountId: 'relay-account',
  generation: 1,
  expectedPhone: '15551234567',
};
async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}
async function fixture(t) {
  let now = 1800000000000;
  const storageKey = key(),
    webhookSecret = key(),
    bypass = key();
  const directory = mkdtempSync(join(tmpdir(), 'monzo-event-relay-'));
  const open = () => new DurableStore({ directory, key: storageKey, clock: () => now });
  let store = open();
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const received = [],
    committed = new Map();
  const behavior = { mode: 'ok', ackTransform: (ack) => ack };
  const origin = await listen(t, async (req, res) => {
    assert.equal(req.url, EVENT_PATH);
    assert.equal(req.headers['x-vercel-protection-bypass'], bypass);
    assert.equal(req.headers.apikey, undefined);
    assert.equal(req.headers.authorization, undefined);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const headers = {
      timestamp: req.headers['x-monzo-timestamp'],
      nonce: req.headers['x-monzo-nonce'],
      signature: req.headers['x-monzo-signature'],
    };
    assert.ok(verifyEvent(webhookSecret, raw, headers, now));
    const event = JSON.parse(raw);
    received.push({ event, nonce: headers.nonce, raw });
    const digest = eventDigest(raw);
    if (behavior.mode === 'redirect') {
      res.writeHead(302, { location: behavior.location });
      return res.end();
    }
    if (typeof behavior.mode === 'number') {
      res.writeHead(behavior.mode);
      return res.end();
    }
    if (behavior.mode === 'malformed') {
      res.setHeader('content-type', 'application/json');
      return res.end('{');
    }
    if (behavior.mode === 'html') {
      res.setHeader('content-type', 'text/html');
      return res.end('SSO');
    }
    if (behavior.mode === 'oversized') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ extra: 'x'.repeat(3000) }));
    }
    // A controlled HTTP receiver simulates commit-before-ACK. Product database
    // processing is separate and is not claimed by this transport test.
    if (committed.has(event.id)) assert.equal(committed.get(event.id), digest);
    else committed.set(event.id, digest);
    if (behavior.mode === 'lost-response') {
      res.destroy();
      return;
    }
    const ack = {
      protocol: PROTOCOL,
      id: event.id,
      digest,
      proof: eventProof(webhookSecret, event.id, digest, headers.nonce),
    };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(behavior.ackTransform(ack)));
  });
  const config = readConfig({
    NODE_ENV: 'test',
    EVOLUTION_ORIGIN: origin,
    MONZO_CALLBACK_URL: origin + PROBE_PATH,
    EVOLUTION_API_KEY: key(),
    EVOLUTION_GATEWAY_KEY: key(),
    EVOLUTION_WEBHOOK_SECRET: webhookSecret,
    VERCEL_AUTOMATION_BYPASS_SECRET: bypass,
  });
  store.register(scope);
  return {
    config,
    behavior,
    received,
    committed,
    clock: () => now,
    get store() {
      return store;
    },
    advance(ms) {
      now += ms;
    },
    reopen() {
      store.close();
      store = open();
    },
    enqueue(name, payload = { type: 'text', text: 'mensaje de fixture' }, ownScope = scope) {
      return store.enqueue(ownScope, 'event', name, payload);
    },
  };
}

test('eventos firmados: dominios, bytes, nonce, digest, reloj y ACK independientes del probe', () => {
  const secret = key(),
    body = '{"kind":"monzo.evolution.event"}',
    nonce = randomBytes(16).toString('hex');
  const now = 1800000000000,
    timestamp = String(now / 1000);
  const headers = { timestamp, nonce, signature: eventSignature(secret, body, timestamp, nonce) };
  assert.ok(verifyEvent(secret, body, headers, now));
  for (const changed of [body + ' ', body.replace('event', 'probe')])
    assert.equal(verifyEvent(secret, changed, headers, now), false);
  assert.equal(verifyEvent(key(), body, headers, now), false);
  assert.equal(verifyEvent('', body, headers, now), false);
  assert.equal(verifyEvent(secret, body, headers, now + 61000), false);
  assert.equal(verifyEvent(secret, body, headers, now - 61000), false);
  assert.equal(
    verifyEvent(secret, body, { ...headers, nonce: randomBytes(16).toString('hex') }, now),
    false,
  );
  assert.equal(
    verifyEvent(
      secret,
      body,
      { ...headers, signature: probeSignature(secret, body, timestamp, nonce) },
      now,
    ),
    false,
  );
  assert.equal(verifyProbe(secret, body, headers, now), false);
  const id = key(),
    digest = eventDigest(body),
    proof = eventProof(secret, id, digest, nonce);
  assert.notEqual(proof, eventProof(secret, key(), digest, nonce));
  assert.notEqual(proof, eventProof(secret, id, key(), nonce));
  assert.notEqual(proof, eventProof(secret, id, digest, randomBytes(16).toString('hex')));
});

test('relay HTTP: ACK firmado termina el evento y elimina su contenido pendiente', async (t) => {
  const f = await fixture(t);
  const first = f.enqueue('one', {
    type: 'text',
    text: 'fixture',
    callbackUrl: 'https://attacker.invalid',
  });
  assert.deepEqual(await relayEvents(f.store, f.config, { clock: f.clock }), [
    { id: first.id, acknowledged: true, code: 'OK' },
  ]);
  const record = f.store.record(scope, 'event', 'one');
  assert.equal(record.state, 'DONE');
  assert.deepEqual(record.payload, {});
  assert.equal(f.committed.size, 1);
  assert.equal(f.received[0].event.id, first.id);
  assert.deepEqual(f.received[0].event.scope, scope);
});

test('relay: HTTP 200 sin prueba exacta no confirma ni descarta el evento', async (t) => {
  const f = await fixture(t),
    record = f.enqueue('one');
  for (const transform of [
    (ack) => ({ ...ack, proof: key() }),
    (ack) => ({ ...ack, id: key() }),
    (ack) => ({ ...ack, digest: key() }),
    (ack) => ({ ...ack, protocol: 'other' }),
    (ack) => ({ ...ack, unsolicited: true }),
    () => null,
    () => [],
  ]) {
    f.behavior.ackTransform = transform;
    assert.deepEqual(await deliverEvent(f.config, record, { clock: f.clock }), {
      acknowledged: false,
      code: 'CALLBACK_PROOF',
    });
    assert.equal(f.store.record(scope, 'event', 'one').state, 'PENDING');
  }
});

test('relay: no sigue redirecciones ni filtra credenciales al destino redirigido', async (t) => {
  const f = await fixture(t),
    record = f.enqueue('one');
  let leaked = false;
  f.behavior.location = await listen(t, (req, res) => {
    leaked = true;
    res.end();
  });
  f.behavior.mode = 'redirect';
  assert.deepEqual(await deliverEvent(f.config, record, { clock: f.clock }), {
    acknowledged: false,
    code: 'CALLBACK_REDIRECT',
  });
  assert.equal(leaked, false);
});

test('relay: respuestas acotadas, errores HTTP y límite de cuerpo conservan el pendiente', async (t) => {
  const f = await fixture(t),
    record = f.enqueue('one');
  for (const [mode, code] of [
    [401, 'CALLBACK_AUTH'],
    [403, 'CALLBACK_AUTH'],
    [409, 'CALLBACK_CONFLICT'],
    [503, 'CALLBACK_UNAVAILABLE'],
    ['malformed', 'CALLBACK_RESPONSE'],
    ['html', 'CALLBACK_RESPONSE'],
    ['oversized', 'CALLBACK_RESPONSE'],
  ]) {
    f.behavior.mode = mode;
    assert.deepEqual(await deliverEvent(f.config, record, { clock: f.clock }), {
      acknowledged: false,
      code,
    });
  }
  const count = f.received.length;
  assert.deepEqual(
    await deliverEvent(
      f.config,
      { ...record, payload: { text: 'x'.repeat(65536) } },
      { clock: f.clock },
    ),
    { acknowledged: false, code: 'EVENT_LIMIT' },
  );
  assert.equal(f.received.length, count);
  assert.equal(f.store.record(scope, 'event', 'one').state, 'PENDING');
});

test('relay durable: perder la respuesta y reiniciar reenvía el mismo evento con nonce nuevo', async (t) => {
  const f = await fixture(t),
    record = f.enqueue('one');
  f.behavior.mode = 'lost-response';
  assert.deepEqual(await relayEvents(f.store, f.config, { clock: f.clock }), [
    { id: record.id, acknowledged: false, code: 'CALLBACK_UNREACHABLE' },
  ]);
  assert.equal(f.committed.size, 1);
  f.reopen();
  assert.deepEqual(await relayEvents(f.store, f.config, { clock: f.clock }), []);
  f.advance(1000);
  f.behavior.mode = 'ok';
  assert.deepEqual(await relayEvents(f.store, f.config, { clock: f.clock }), [
    { id: record.id, acknowledged: true, code: 'OK' },
  ]);
  assert.equal(f.committed.size, 1);
  assert.equal(f.received.length, 2);
  assert.equal(f.received[0].raw.toString(), f.received[1].raw.toString());
  assert.notEqual(f.received[0].nonce, f.received[1].nonce);
  assert.equal(f.store.record(scope, 'event', 'one').state, 'DONE');
});

test('relay: cuenta bloqueada conserva orden; otra avanza; ACK previo no sirve para el reintento', async (t) => {
  const f = await fixture(t),
    first = f.enqueue('one');
  const second = f.enqueue('two');
  const otherScope = { ...scope, tenantId: 'other-tenant', accountId: 'other-account' };
  f.store.register(otherScope);
  const other = f.enqueue('other', { type: 'text', text: 'otra cuenta' }, otherScope);
  let oldAck;
  f.behavior.ackTransform = (ack) => {
    if (ack.id !== first.id) return ack;
    oldAck ??= ack;
    return { ...ack, proof: key() };
  };
  let results = await relayEvents(f.store, f.config, { clock: f.clock });
  assert.equal(results.find((r) => r.id === first.id).acknowledged, false);
  assert.equal(results.find((r) => r.id === other.id).acknowledged, true);
  assert.equal(
    f.received.some((r) => r.event.id === second.id),
    false,
  );
  f.advance(1000);
  f.behavior.ackTransform = () => oldAck;
  results = await relayEvents(f.store, f.config, { clock: f.clock });
  assert.equal(results[0].code, 'CALLBACK_PROOF');
  assert.equal(
    f.received.some((r) => r.event.id === second.id),
    false,
  );
  f.advance(2000);
  f.behavior.ackTransform = (ack) => ack;
  assert.equal((await relayEvents(f.store, f.config, { clock: f.clock }))[0].acknowledged, true);
  assert.equal((await relayEvents(f.store, f.config, { clock: f.clock }))[0].id, second.id);
});

test('relay: prepara identidad una vez y no cambia el cuerpo tras una respuesta perdida', async (t) => {
  const f = await fixture(t),
    event = f.enqueue('candidate', { candidate: { text: 'fixture' } });
  let calls = 0;
  const options = {
    clock: f.clock,
    prepare: async (record) => {
      calls++;
      return f.store.prepareEvent(record.id, record.leaseToken, {
        type: 'message',
        verifiedAt: f.clock(),
        text: 'fixture',
      });
    },
  };
  f.behavior.mode = 'lost-response';
  assert.equal((await relayEvents(f.store, f.config, options))[0].acknowledged, false);
  assert.equal(calls, 1);
  f.reopen();
  f.advance(1000);
  f.behavior.mode = 'ok';
  assert.equal((await relayEvents(f.store, f.config, options))[0].acknowledged, true);
  assert.equal(calls, 1);
  assert.equal(f.received[0].raw.toString(), f.received[1].raw.toString());
  assert.equal(f.store.record(scope, 'event', 'candidate').id, event.id);
});
