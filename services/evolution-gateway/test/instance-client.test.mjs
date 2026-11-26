import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../core.mjs';
import { instanceClient, instanceScope } from '../instance-client.mjs';

const key = () => randomBytes(32).toString('hex');
const scope = {
  tenantId: 'tenant_one',
  accountId: 'account_one',
  generation: 1,
  expectedPhone: '5491123456789',
};

async function rig(t) {
  const secrets = { api: key(), gateway: key(), webhook: key(), upstream: key() };
  const calls = [];
  const state = {
    exists: false,
    connection: 'close',
    owner: scope.expectedPhone + '@s.whatsapp.net',
    qr: 'qr-test-fixture-never-used-with-whatsapp',
    foreignName: null,
    createStatus: 201,
    sendStatus: 201,
    sendIdMismatch: false,
  };
  const name = instanceScope(scope).name;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.apikey, secrets.api);
    assert.equal(req.headers.origin, 'https://preview.vercel.app');
    assert.equal(req.headers['x-vercel-protection-bypass'], undefined);
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    calls.push({ path: req.url, method: req.method, body });
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/instance/fetchInstances') {
      assert.equal(url.searchParams.get('instanceName'), name);
      if (!state.exists) {
        res.statusCode = 404;
        return res.end('{}');
      }
      return res.end(
        JSON.stringify([
          {
            name: state.foreignName ?? name,
            connectionStatus: state.connection,
            integration: 'WHATSAPP-BAILEYS',
            ownerJid: state.owner,
            token: secrets.upstream,
            Proxy: { password: secrets.upstream },
          },
        ]),
      );
    }
    if (url.pathname === '/instance/create') {
      assert.equal(req.method, 'POST');
      state.exists = true;
      res.statusCode = state.createStatus;
      return res.end(
        JSON.stringify({
          instance: { instanceName: name, integration: 'WHATSAPP-BAILEYS', status: 'close' },
          hash: secrets.upstream,
        }),
      );
    }
    if (url.pathname === '/instance/connect/' + name) {
      assert.equal(req.method, 'GET');
      state.connection = 'connecting';
      return res.end(
        JSON.stringify({
          code: state.qr,
          base64: 'not-forwarded-image',
          pairingCode: secrets.upstream,
        }),
      );
    }
    if (url.pathname === '/instance/logout/' + name) {
      assert.equal(req.method, 'DELETE');
      state.connection = 'close';
      return res.end('{}');
    }
    if (url.pathname === '/message/sendText/' + name) {
      assert.equal(req.method, 'POST');
      res.statusCode = state.sendStatus;
      return res.end(
        JSON.stringify({
          key: {
            id: state.sendIdMismatch ? 'UNEXPECTED' : body.monzoMessageId,
            fromMe: true,
            remoteJid: body.number + '@s.whatsapp.net',
          },
          message: { conversation: body.text },
          token: secrets.upstream,
        }),
      );
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const config = readConfig({
    NODE_ENV: 'test',
    EVOLUTION_ORIGIN: `http://127.0.0.1:${server.address().port}`,
    MONZO_CALLBACK_URL: 'https://preview.vercel.app/api/integrations/evolution/probe',
    EVOLUTION_API_KEY: secrets.api,
    EVOLUTION_GATEWAY_KEY: secrets.gateway,
    EVOLUTION_WEBHOOK_SECRET: secrets.webhook,
  });
  return { client: instanceClient(config), config, calls, state, secrets };
}

test('envío HTTP controlado: verifica identidad, usa ID previo y devuelve solo ese ID', async (t) => {
  const r = await rig(t);
  r.state.exists = true;
  r.state.connection = 'open';
  const data = { to: '15557654321', text: 'Texto de prueba', providerId: '3EB0' + 'A'.repeat(18) };
  assert.equal(await r.client.sendText(scope, data), data.providerId);
  const call = r.calls.find((c) => c.path.startsWith('/message/sendText/'));
  assert.deepEqual(call.body, {
    number: data.to,
    text: data.text,
    linkPreview: false,
    monzoMessageId: data.providerId,
  });
  const before = r.calls.length;
  await assert.rejects(
    () => r.client.sendText(scope, { ...data, to: scope.expectedPhone }),
    /INVALID_MESSAGE/,
  );
  assert.equal(r.calls.length, before);
  r.state.owner = '15559999999@s.whatsapp.net';
  await assert.rejects(() => r.client.sendText(scope, data), /NUMBER_MISMATCH/);
  assert.equal(r.calls.filter((c) => c.path.startsWith('/message/sendText/')).length, 1);
});

test('envío HTTP controlado: respuesta perdida o ID inesperado queda incierto sin repetir POST', async (t) => {
  const r = await rig(t);
  r.state.exists = true;
  r.state.connection = 'open';
  const data = { to: '15557654321', text: 'Texto de prueba', providerId: '3EB0' + 'B'.repeat(18) };
  r.state.sendIdMismatch = true;
  await assert.rejects(
    () => r.client.sendText(scope, data),
    (e) => e.code === 'INSTANCE_RESULT_UNKNOWN' && e.uncertain,
  );
  assert.equal(r.calls.filter((c) => c.path.startsWith('/message/sendText/')).length, 1);
  r.state.sendIdMismatch = false;
  r.state.sendStatus = 500;
  await assert.rejects(
    () => r.client.sendText(scope, data),
    (e) => e.code === 'INSTANCE_RESULT_UNKNOWN' && e.uncertain,
  );
  assert.equal(r.calls.filter((c) => c.path.startsWith('/message/sendText/')).length, 2);
  r.state.connection = 'close';
  await assert.rejects(() => r.client.sendText(scope, data), /CHANNEL_NOT_CONNECTED/);
  assert.equal(r.calls.filter((c) => c.path.startsWith('/message/sendText/')).length, 2);
});

test('instancias: nombres estables separados por empresa, cuenta y generación; sin teléfonos ni rutas arbitrarias', () => {
  const name = instanceScope(scope).name;
  assert.equal(instanceScope(scope).name, name);
  assert.equal(name.includes(scope.expectedPhone), false);
  for (const change of [
    { tenantId: 'tenant_two' },
    { accountId: 'account_two' },
    { generation: 2 },
  ])
    assert.notEqual(instanceScope({ ...scope, ...change }).name, name);
  for (const change of [
    { accountId: '../other' },
    { tenantId: ['tenant_one'] },
    { generation: 0 },
    { generation: 1.5 },
    { generation: 2147483648 },
    { expectedPhone: '+5491123456789' },
    { instanceName: 'another-business' },
    { callbackUrl: 'https://attacker.example' },
  ])
    assert.throws(() => instanceScope({ ...scope, ...change }), /INVALID_SCOPE/);
});

test('instancias HTTP controlado: preparación sin iniciar WhatsApp, configuración restringida y credenciales no devueltas', async (t) => {
  const r = await rig(t);
  assert.deepEqual(await r.client.status(scope), { state: 'NOT_CREATED' });
  assert.deepEqual(await r.client.create(scope), { state: 'DISCONNECTED' });
  const create = r.calls.find((call) => call.method === 'POST');
  assert.equal(create.body.qrcode, false);
  assert.equal(create.body.syncFullHistory, false);
  assert.equal(create.body.groupsIgnore, true);
  assert.equal(create.body.readMessages, false);
  assert.equal(create.body.readStatus, false);
  assert.equal('number' in create.body, false);
  assert.equal(create.body.webhook.url, 'http://evolution-gateway:9080/internal/events');
  assert.equal(create.body.webhook.base64, false);
  assert.match(create.body.token, /^[a-f0-9]{64}$/);
  assert.notEqual(create.body.token, create.body.webhook.headers.authorization.slice(7));
  for (const secret of Object.values(r.secrets))
    assert.equal(JSON.stringify(create.body).includes(secret), false);
  assert.deepEqual(await r.client.create(scope), { state: 'DISCONNECTED' });
  assert.equal(r.calls.filter((call) => call.method === 'POST').length, 1);
});

test('instancias HTTP controlado: QR explícito, respuesta mínima e identidad comprobada antes de conectar', async (t) => {
  const r = await rig(t);
  r.state.exists = true;
  const qr = await r.client.connect(scope);
  assert.deepEqual(qr, { state: 'QR', qr: r.state.qr });
  r.state.connection = 'open';
  const connected = await r.client.connect(scope);
  assert.deepEqual(connected, { state: 'CONNECTED', connectedPhone: scope.expectedPhone });
  assert.equal(r.calls.filter((call) => call.path.startsWith('/instance/connect/')).length, 1);
  r.state.owner = '5491199999999@s.whatsapp.net';
  await assert.rejects(r.client.status(scope), /NUMBER_MISMATCH/);
  await assert.rejects(r.client.connect(scope), /NUMBER_MISMATCH/);
  r.state.owner = 'unresolved@lid';
  await assert.rejects(r.client.status(scope), /INSTANCE_IDENTITY_UNAVAILABLE/);
  assert.equal(JSON.stringify(connected).includes(r.secrets.upstream), false);
});

test('instancias HTTP controlado: una lista ajena no se acepta y un QR inválido no se muestra', async (t) => {
  const r = await rig(t);
  r.state.exists = true;
  r.state.foreignName = 'another-business';
  await assert.rejects(r.client.status(scope), /INSTANCE_INVALID_RESPONSE/);
  r.state.foreignName = null;
  r.state.qr = 'invalid\ncode';
  assert.deepEqual(await r.client.connect(scope), { state: 'CONNECTING' });
  r.state.qr = 'x'.repeat(4097);
  assert.deepEqual(await r.client.connect(scope), { state: 'CONNECTING' });
});

test('instancias HTTP controlado: desvinculación idempotente y cierre del teléfono equivocado', async (t) => {
  const r = await rig(t);
  assert.deepEqual(await r.client.disconnect(scope), { state: 'NOT_CREATED' });
  r.state.exists = true;
  r.state.connection = 'open';
  r.state.owner = '5491199999999@s.whatsapp.net';
  assert.deepEqual(await r.client.disconnect(scope), { state: 'DISCONNECTED' });
  assert.deepEqual(await r.client.disconnect(scope), { state: 'DISCONNECTED' });
  assert.equal(r.calls.filter((call) => call.method === 'DELETE').length, 1);
});

test('instancias: resultados inciertos no disparan reintentos ni incluyen detalles del proveedor', async (t) => {
  const r = await rig(t);
  r.state.createStatus = 500;
  await assert.rejects(
    r.client.create(scope),
    (error) => error.code === 'INSTANCE_RESULT_UNKNOWN' && error.uncertain,
  );
  assert.equal(r.calls.filter((call) => call.method === 'POST').length, 1);
  let calls = 0;
  const client = instanceClient(r.config, async (url, init) => {
    calls++;
    assert.equal(init.redirect, 'error');
    if (init.method === 'GET') return Response.json([]);
    throw new Error('private-provider-details');
  });
  await assert.rejects(
    client.create(scope),
    (error) => error.code === 'INSTANCE_RESULT_UNKNOWN' && !String(error).includes('private'),
  );
  assert.equal(calls, 2);
});
