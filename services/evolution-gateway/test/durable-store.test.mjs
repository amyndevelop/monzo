import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  chmodSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DurableStore } from '../durable-store.mjs';

const scope = {
  tenantId: 'tenant-one',
  accountId: 'account-one',
  generation: 1,
  expectedPhone: '5491123456789',
};
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'monzo-evolution-spool-'));
  const key = randomBytes(32).toString('hex');
  let now = 1800000000000;
  const open = () => new DurableStore({ directory, key, clock: () => now, ...options });
  let store = open();
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    key,
    get store() {
      return store;
    },
    advance(ms) {
      now += ms;
    },
    reopen() {
      store.close();
      store = open();
      return store;
    },
  };
}
test('spool durable: persiste cuentas y eventos cifrados; deduplicación y contenido no visible en archivos', (t) => {
  const r = fixture(t);
  const privateText = 'private_customer_text_905329';
  r.store.register(scope, { state: 'QR', qr: 'private_qr_material_6749' });
  const first = r.store.enqueue(scope, 'event', 'message-one', { text: privateText, other: 1 });
  assert.equal(
    r.store.enqueue(scope, 'event', 'message-one', { other: 1, text: privateText }).id,
    first.id,
  );
  assert.equal(r.store.stats()[0].count, 1);
  for (const file of readdirSync(r.directory)) {
    if (!statSync(join(r.directory, file)).isFile()) continue;
    const content = readFileSync(join(r.directory, file));
    for (const value of [
      scope.expectedPhone,
      scope.tenantId,
      privateText,
      'private_qr_material_6749',
      r.key,
    ])
      assert.equal(content.includes(Buffer.from(value)), false);
    assert.equal(statSync(join(r.directory, file)).mode & 0o077, 0);
  }
  r.reopen();
  assert.equal(r.store.account(scope).data.qr, 'private_qr_material_6749');
  assert.equal(r.store.record(scope, 'event', 'message-one').payload.text, privateText);
  assert.throws(
    () => r.store.enqueue(scope, 'event', 'message-one', { text: 'different' }),
    /IDEMPOTENCY_CONFLICT/,
  );
});
test('spool durable: aislamiento entre empresas, cuentas e intentos; escrituras obsoletas rechazadas', (t) => {
  const r = fixture(t);
  const other = { ...scope, tenantId: 'tenant-two' };
  r.store.register(scope, { state: 'QR' });
  r.store.register(other, { state: 'DISCONNECTED' });
  const one = r.store.enqueue(scope, 'event', 'same-key', { text: 'one' });
  const two = r.store.enqueue(other, 'event', 'same-key', { text: 'two' });
  assert.notEqual(one.id, two.id);
  assert.equal(r.store.record({ ...scope, accountId: 'other' }, 'event', 'same-key'), null);
  const command = r.store.enqueue(scope, 'command', 'send-message-one', { text: 'send-once' });
  r.store.register({ ...scope, generation: 2 }, { state: 'CONNECTING' });
  assert.throws(() => r.store.updateAccount(scope, { state: 'CONNECTED' }), /STALE_GENERATION/);
  assert.throws(
    () => r.store.enqueue(scope, 'command', 'new-stale-command', {}),
    /STALE_GENERATION/,
  );
  assert.throws(
    () =>
      r.store.enqueue({ ...scope, generation: 2 }, 'command', 'send-message-one', {
        text: 'send-once',
      }),
    /IDEMPOTENCY_CONFLICT/,
  );
  assert.equal(
    r.store.record({ ...scope, generation: 2 }, 'command', 'send-message-one').id,
    command.id,
  );
  assert.equal(r.store.record(scope, 'command', 'send-message-one').result.state, 'CANCELED');
  assert.deepEqual(r.store.claim('command'), []);
  assert.equal(r.store.account({ ...scope, generation: 2 }).data.state, 'CONNECTING');
  assert.throws(
    () => r.store.register({ ...scope, generation: 3, expectedPhone: '5491199999999' }),
    /NUMBER_SCOPE_CHANGED/,
  );
});
test('spool durable: eventos conservan orden por cuenta y reintentan con concesión y espera', (t) => {
  const r = fixture(t);
  r.store.register(scope);
  const other = { ...scope, accountId: 'second-account' };
  r.store.register(other);
  const first = r.store.enqueue(scope, 'event', 'first', { text: 'first' });
  const second = r.store.enqueue(scope, 'event', 'second', { text: 'second' });
  const independent = r.store.enqueue(other, 'event', 'other', { text: 'other' });
  const batch = r.store.claim('event');
  assert.deepEqual(
    batch.map((event) => event.id),
    [first.id, independent.id],
  );
  assert.equal(r.store.retryEvent(first.id, batch[0].leaseToken, 5000), true);
  assert.equal(r.store.finish(independent.id, batch[1].leaseToken, { accepted: true }), true);
  assert.deepEqual(r.store.claim('event'), []);
  r.advance(5000);
  const [retry] = r.store.claim('event');
  assert.equal(retry.id, first.id);
  assert.equal(retry.attempts, 2);
  assert.equal(r.store.finish(first.id, batch[0].leaseToken, { accepted: true }), false);
  assert.equal(r.store.finish(first.id, retry.leaseToken, { accepted: true }), true);
  assert.deepEqual(r.store.record(scope, 'event', 'first').payload, {});
  assert.equal(r.store.claim('event')[0].id, second.id);
});
test('spool durable: reinicio recupera eventos, marca envíos inciertos y no vuelve a reclamarlos', (t) => {
  const r = fixture(t);
  r.store.register(scope);
  const command = r.store.enqueue(scope, 'command', 'send-once', { text: 'uncertain-send' });
  const event = r.store.enqueue(scope, 'event', 'receive-once', { text: 'replay-safe' });
  const [send] = r.store.claim('command');
  const [delivery] = r.store.claim('event');
  r.reopen();
  const current = r.store.record(scope, 'command', 'send-once');
  assert.equal(current.id, command.id);
  assert.equal(current.state, 'UNKNOWN');
  assert.equal(current.result.code, 'PROCESS_INTERRUPTED');
  assert.deepEqual(r.store.claim('command'), []);
  assert.equal(
    r.store.enqueue(scope, 'command', 'send-once', { text: 'uncertain-send' }).state,
    'UNKNOWN',
  );
  assert.equal(r.store.claim('event')[0].id, event.id);
  assert.equal(r.store.finish(send.id, send.leaseToken, { state: 'SENT' }), false);
  assert.equal(r.store.finish(delivery.id, delivery.leaseToken, { accepted: true }), false);
});
test('spool durable: SIGKILL real conserva WAL, recupera eventos y nunca repite el envío interrumpido', (t) => {
  const r = fixture(t);
  r.store.close();
  const source = `import {DurableStore} from ${JSON.stringify(new URL('../durable-store.mjs', import.meta.url).href)};
    import {readFileSync} from 'node:fs';
    const input=JSON.parse(readFileSync(0,'utf8'));
    const store=new DurableStore({directory:input.directory,key:input.key});
    store.register(input.scope);
    store.enqueue(input.scope,'command','crash-send',{text:'send-once'});
    store.enqueue(input.scope,'event','crash-event',{text:'retry-event'});
    store.claim('command');store.claim('event');
    process.kill(process.pid,'SIGKILL');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    input: JSON.stringify({ directory: r.directory, key: r.key, scope }),
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(child.signal, 'SIGKILL');
  assert.equal(child.stdout, '');
  r.reopen();
  assert.equal(r.store.record(scope, 'command', 'crash-send').state, 'UNKNOWN');
  assert.deepEqual(r.store.claim('command'), []);
  assert.equal(r.store.claim('event')[0].key, 'crash-event');
});
test('spool durable: un error interno revierte la transacción aunque el llamador lo capture', (t) => {
  const r = fixture(t, { capacity: 1 });
  r.store.register(scope);
  r.store.enqueue(scope, 'command', 'one', {});
  const [command] = r.store.claim('command');
  assert.throws(
    () =>
      r.store.atomic(() => {
        r.store.finish(command.id, command.leaseToken, { state: 'SENT' });
        try {
          r.store.enqueue(scope, 'event', 'full', {});
        } catch {}
      }),
    /STORAGE_TRANSACTION_ABORTED/,
  );
  assert.equal(r.store.record(scope, 'command', 'one').state, 'PROCESSING');
});
test('spool durable: concesión vencida de envío queda incierta sin repetición automática', (t) => {
  const r = fixture(t);
  r.store.register(scope);
  r.store.enqueue(scope, 'command', 'expired', {});
  r.store.claim('command', { leaseMs: 1000 });
  r.advance(1001);
  assert.deepEqual(r.store.claim('command'), []);
  assert.equal(r.store.record(scope, 'command', 'expired').state, 'UNKNOWN');
});
test('spool durable: resultado y notificación se confirman juntos o se revierten juntos', (t) => {
  const r = fixture(t);
  r.store.register(scope);
  r.store.enqueue(scope, 'command', 'outgoing', { text: 'one' });
  const [command] = r.store.claim('command');
  assert.throws(
    () =>
      r.store.atomic(() => {
        r.store.finish(command.id, command.leaseToken, { state: 'SENT', providerId: 'known-id' });
        r.store.enqueue(scope, 'event', 'result', { messageId: 'one', status: 'sent' });
        throw new Error('rollback-fixture');
      }),
    /STORAGE_UNAVAILABLE/,
  );
  assert.equal(r.store.record(scope, 'command', 'outgoing').state, 'PROCESSING');
  assert.equal(r.store.record(scope, 'event', 'result'), null);
  r.store.atomic(() => {
    assert.equal(
      r.store.finish(command.id, command.leaseToken, { state: 'SENT', providerId: 'known-id' }),
      true,
    );
    r.store.enqueue(scope, 'event', 'result', { messageId: 'one', status: 'sent' });
    r.store.markNotified(command.id);
  });
  r.reopen();
  assert.equal(r.store.record(scope, 'command', 'outgoing').state, 'DONE');
  assert.equal(r.store.record(scope, 'event', 'result').state, 'PENDING');
  assert.deepEqual(r.store.pendingResults(), []);
});
test('spool durable: límite visible, limpieza solo de eventos confirmados y tombstones de envíos conservados', (t) => {
  const r = fixture(t, { capacity: 3 });
  r.store.register(scope);
  r.store.enqueue(scope, 'command', 'sent', { text: 'private-old-text' });
  const [command] = r.store.claim('command');
  r.store.finish(command.id, command.leaseToken, { state: 'SENT' });
  r.store.markNotified(command.id);
  r.store.enqueue(scope, 'event', 'done', {});
  const [done] = r.store.claim('event');
  r.store.finish(done.id, done.leaseToken, { accepted: true });
  r.store.enqueue(scope, 'event', 'pending', {});
  assert.throws(() => r.store.enqueue(scope, 'event', 'full', {}), /STORAGE_FULL/);
  r.advance(8 * 86400000);
  assert.equal(r.store.cleanup(), 1);
  assert.equal(r.store.record(scope, 'event', 'pending').state, 'PENDING');
  assert.equal(r.store.record(scope, 'command', 'sent').state, 'DONE');
  assert.deepEqual(r.store.record(scope, 'command', 'sent').payload, {});
  assert.equal(
    r.store.enqueue(scope, 'command', 'sent', { text: 'private-old-text' }).state,
    'DONE',
  );
  assert.throws(
    () => r.store.enqueue(scope, 'command', 'sent', { text: 'changed' }),
    /IDEMPOTENCY_CONFLICT/,
  );
});
test('spool durable: rechaza segundo propietario, claves incorrectas y alteración del cifrado', (t) => {
  const r = fixture(t);
  r.store.register(scope, { state: 'QR', qr: 'secret-fixture' });
  assert.throws(
    () => new DurableStore({ directory: r.directory, key: r.key }),
    /STORAGE_UNAVAILABLE/,
  );
  r.store.close();
  assert.throws(
    () => new DurableStore({ directory: r.directory, key: randomBytes(32).toString('hex') }),
    /STORAGE_(DATA|KEY)_INVALID/,
  );
  const db = new DatabaseSync(join(r.directory, 'gateway.sqlite'));
  const row = db.prepare('SELECT owner,payload FROM accounts').get();
  const bytes = Buffer.from(row.payload);
  bytes[bytes.length - 1] ^= 1;
  db.prepare('UPDATE accounts SET payload=? WHERE owner=?').run(bytes, row.owner);
  db.close();
  r.reopen();
  assert.throws(() => r.store.account(scope), /STORAGE_DATA_INVALID/);
});
test('spool durable: rechaza permisos amplios, enlaces, versiones ajenas y payloads fuera de límite', (t) => {
  const r = fixture(t);
  r.store.register(scope);
  assert.throws(
    () => r.store.enqueue(scope, 'event', 'large', { text: 'x'.repeat(262145) }),
    /STORAGE_PAYLOAD_LIMIT/,
  );
  assert.throws(() => r.store.atomic(async () => {}), /STORAGE_ASYNC_TRANSACTION/);
  r.store.close();
  chmodSync(r.directory, 0o755);
  assert.throws(
    () => new DurableStore({ directory: r.directory, key: r.key }),
    /STORAGE_DIRECTORY/,
  );
  chmodSync(r.directory, 0o700);
  const db = new DatabaseSync(join(r.directory, 'gateway.sqlite'));
  db.exec('PRAGMA user_version=99');
  db.close();
  assert.throws(() => new DurableStore({ directory: r.directory, key: r.key }), /STORAGE_VERSION/);
  const external = join(r.directory, 'external');
  writeFileSync(external, 'preserve', { mode: 0o600 });
  rmSync(join(r.directory, 'gateway.sqlite'));
  symlinkSync(external, join(r.directory, 'gateway.sqlite'));
  assert.throws(() => new DurableStore({ directory: r.directory, key: r.key }), /STORAGE_FILE/);
  assert.equal(readFileSync(external, 'utf8'), 'preserve');
});

test('spool durable: conserva instancias retiradas sin permitir que cambien la generación actual', (t) => {
  const r = fixture(t);
  const original = r.store.register(scope, {
    state: 'CONNECTED',
    verifiedPhone: scope.expectedPhone,
  });
  const next = { ...scope, generation: 2 };
  r.store.register(next, { state: 'DISCONNECTED' });
  assert.equal(r.store.byInstance(original.name).scope.generation, 1);
  assert.equal(r.store.byInstance(original.name).data.verifiedPhone, scope.expectedPhone);
  assert.equal(r.store.priorInstances(next).length, 1);
  r.store.updateInstance(scope, { state: 'DISCONNECTED', closed: true });
  assert.equal(r.store.byInstance(original.name).data.closed, true);
  assert.deepEqual(r.store.account(next).data, { state: 'DISCONNECTED' });
  assert.throws(() => r.store.updateAccount(scope, {}), /STALE_GENERATION/);
  assert.throws(
    () => r.store.updateInstance({ ...scope, expectedPhone: '15559999999' }, {}),
    /STALE_GENERATION/,
  );
  r.store.enqueue(scope, 'event', 'delayed-receipt', {});
  assert.throws(
    () => r.store.enqueue({ ...scope, generation: 3 }, 'event', 'future', {}),
    /STALE_GENERATION/,
  );
});

test('spool durable: migra formato 1 sin alterar cuentas, journal ni credenciales cifradas', (t) => {
  const r = fixture(t);
  r.store.register(scope, { state: 'CONNECTED', verifiedPhone: scope.expectedPhone });
  r.store.enqueue(scope, 'event', 'old-format', { text: 'preserve-encrypted-payload' });
  r.store.close();
  const db = new DatabaseSync(join(r.directory, 'gateway.sqlite'));
  const before = db.prepare('SELECT hex(payload) AS bytes FROM journal').get().bytes;
  const account = db.prepare('SELECT hex(payload) AS bytes FROM accounts').get().bytes;
  db.exec('DROP TABLE instances; PRAGMA user_version=1;');
  db.close();
  r.reopen();
  assert.equal(r.store.account(scope).data.state, 'CONNECTED');
  assert.equal(r.store.priorInstances(scope).length, 0);
  const name = r.store.account(scope).name;
  assert.equal(r.store.byInstance(name).data.verifiedPhone, scope.expectedPhone);
  assert.equal(
    r.store.record(scope, 'event', 'old-format').payload.text,
    'preserve-encrypted-payload',
  );
  r.store.close();
  const after = new DatabaseSync(join(r.directory, 'gateway.sqlite'));
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(after.prepare('SELECT hex(payload) AS bytes FROM journal').get().bytes, before);
  assert.equal(after.prepare('SELECT hex(payload) AS bytes FROM instances').get().bytes, account);
  after.close();
});

test('spool durable: prepara el cuerpo una vez antes de enviarlo y lo conserva tras reiniciar', (t) => {
  const r = fixture(t);
  r.store.register(scope);
  const candidate = { candidate: { text: 'message-one' } };
  const event = r.store.enqueue(scope, 'event', 'prepare', candidate);
  const [claimed] = r.store.claim('event');
  assert.throws(() => r.store.prepareEvent(event.id, 'not-the-lease', {}), /STORAGE_LEASE_LOST/);
  const prepared = r.store.prepareEvent(event.id, claimed.leaseToken, {
    type: 'message',
    verifiedAt: 1,
    text: 'message-one',
  });
  assert.equal(prepared.prepared, true);
  assert.deepEqual(
    r.store.prepareEvent(event.id, claimed.leaseToken, { changed: true }).payload,
    prepared.payload,
  );
  r.reopen();
  const [retry] = r.store.claim('event');
  assert.equal(retry.prepared, true);
  assert.deepEqual(retry.payload, prepared.payload);
  assert.deepEqual(r.store.enqueue(scope, 'event', 'prepare', candidate).payload, prepared.payload);
  assert.throws(
    () => r.store.enqueue(scope, 'event', 'prepare', { candidate: { text: 'different' } }),
    /IDEMPOTENCY_CONFLICT/,
  );
});

test('spool durable: ejecuta como máximo un comando por cuenta y permite avanzar a otra', (t) => {
  const r = fixture(t),
    other = { ...scope, accountId: 'other-account' };
  r.store.register(scope);
  r.store.register(other);
  const first = r.store.enqueue(scope, 'command', 'first', {});
  const second = r.store.enqueue(scope, 'command', 'second', {});
  const independent = r.store.enqueue(other, 'command', 'other', {});
  const claims = r.store.claim('command');
  assert.deepEqual(
    claims.map((c) => c.id),
    [first.id, independent.id],
  );
  assert.deepEqual(r.store.claim('command'), []);
  r.store.finish(first.id, claims[0].leaseToken, { state: 'DONE' });
  assert.equal(r.store.claim('command')[0].id, second.id);
});
