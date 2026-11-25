import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readConfig, checkEvolution } from '../core.mjs';
import { createGateway } from '../server.mjs';
import { PROTOCOL, PROBE_PATH, probeSignature, verifyProbe, responseProof } from '../protocol.mjs';

const key = () => randomBytes(32).toString('hex');
async function listen(server, t) {
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
async function rig(t, { auth = true, version = '2.3.8', proof = true } = {}) {
  const apiKey = key(),
    gatewayKey = key(),
    webhookSecret = key();
  const seen = [];
  let callbacks = 0;
  const evo = await listen(
    createServer((req, res) => {
      seen.push({ path: req.url, authorization: req.headers.apikey });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/') return res.end(JSON.stringify({ version }));
      if (req.url === '/instance/fetchInstances') {
        if (!auth || req.headers.apikey !== apiKey) {
          res.statusCode = 401;
          return res.end('{}');
        }
        return res.end(
          JSON.stringify([
            { name: 'another-business-private', token: 'never-return-instance-credentials' },
          ]),
        );
      }
      res.statusCode = 404;
      res.end('{}');
    }),
    t,
  );
  const callback = await listen(
    createServer(async (req, res) => {
      callbacks++;
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks);
      assert.equal(req.url, PROBE_PATH);
      assert.ok(
        verifyProbe(webhookSecret, raw, {
          timestamp: req.headers['x-monzo-timestamp'],
          nonce: req.headers['x-monzo-nonce'],
          signature: req.headers['x-monzo-signature'],
        }),
      );
      const { challenge } = JSON.parse(raw);
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          challenge,
          proof: proof
            ? responseProof(webhookSecret, challenge, req.headers['x-monzo-nonce'])
            : key(),
        }),
      );
    }),
    t,
  );
  const config = readConfig({
    NODE_ENV: 'test',
    EVOLUTION_ORIGIN: evo,
    MONZO_CALLBACK_URL: callback + PROBE_PATH,
    EVOLUTION_API_KEY: apiKey,
    EVOLUTION_GATEWAY_KEY: gatewayKey,
    EVOLUTION_WEBHOOK_SECRET: webhookSecret,
  });
  const gateway = await listen(createGateway(config), t);
  const post = (body) =>
    fetch(gateway + '/v1/diagnostics', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + gatewayKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { config, gateway, seen, post, callbacks: () => callbacks };
}
test('firmas: cuerpo, nonce, tiempo y respuesta tienen contextos distintos', () => {
  const secret = key(),
    body = JSON.stringify({ kind: 'monzo.evolution.probe', challenge: key() }),
    timestamp = String(Math.floor(Date.now() / 1000)),
    nonce = randomBytes(16).toString('hex');
  const headers = { timestamp, nonce, signature: probeSignature(secret, body, timestamp, nonce) };
  assert.ok(verifyProbe(secret, body, headers));
  assert.equal(verifyProbe(secret, body + ' ', headers), false);
  assert.equal(verifyProbe(key(), body, headers), false);
  assert.equal(
    verifyProbe(secret, body, { ...headers, nonce: randomBytes(16).toString('hex') }),
    false,
  );
  assert.equal(verifyProbe(secret, body, headers, Date.now() + 61000), false);
  assert.notEqual(responseProof(secret, JSON.parse(body).challenge, nonce), headers.signature);
});
test('configuración: credenciales independientes y destinos cerrados', () => {
  const env = {
    EVOLUTION_API_KEY: key(),
    EVOLUTION_GATEWAY_KEY: key(),
    EVOLUTION_WEBHOOK_SECRET: key(),
    MONZO_CALLBACK_URL: 'https://monzo.example.test' + PROBE_PATH,
  };
  assert.equal(readConfig(env).evolutionOrigin, 'http://evolution:8080');
  for (const change of [
    { EVOLUTION_ORIGIN: 'http://169.254.169.254' },
    { MONZO_CALLBACK_URL: 'http://monzo.example.test' + PROBE_PATH },
    { MONZO_CALLBACK_URL: 'https://user:pass@monzo.example.test' + PROBE_PATH },
    { MONZO_CALLBACK_URL: 'https://monzo.example.test' + PROBE_PATH + '?token=private' },
    { EVOLUTION_GATEWAY_KEY: env.EVOLUTION_API_KEY },
    { PORT: '80' },
  ])
    assert.throws(() => readConfig({ ...env, ...change }));
});
test('HTTP real local: autenticación, lista privada y comprobación firmada de ida y vuelta', async (t) => {
  const r = await rig(t);
  const challenge = key();
  assert.equal((await fetch(r.gateway + '/v1/status')).status, 401);
  assert.equal(
    (
      await fetch(r.gateway + '/instance/fetchInstances', {
        headers: { Authorization: 'Bearer ' + r.config.gatewayKey },
      })
    ).status,
    404,
  );
  const live = await (await fetch(r.gateway + '/healthz')).json();
  assert.deepEqual(live, { ok: true, protocol: PROTOCOL });
  const response = await r.post({ challenge, callbackUrl: r.config.callbackUrl });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.challenge, challenge);
  assert.equal(result.evolution.ok, true);
  assert.equal(result.callback.ok, true);
  assert.equal(r.callbacks(), 1);
  for (const value of [
    r.config.apiKey,
    r.config.gatewayKey,
    r.config.webhookSecret,
    'another-business-private',
    'never-return-instance-credentials',
  ])
    assert.equal(JSON.stringify(result).includes(value), false);
  assert.equal(r.seen[1].authorization, r.config.apiKey);
});
test('HTTP: credencial del proveedor rechazada se distingue del servicio y no prueba callback', async (t) => {
  const r = await rig(t, { auth: false });
  const result = await (
    await r.post({ challenge: key(), callbackUrl: r.config.callbackUrl })
  ).json();
  assert.equal(result.evolution.code, 'EVOLUTION_AUTH');
  assert.equal(result.callback.code, 'NOT_CHECKED');
  assert.equal(r.callbacks(), 0);
});
test('HTTP: versión incompatible impide continuar con la credencial y el retorno', async (t) => {
  const r = await rig(t, { version: 'different' });
  const result = await (
    await r.post({ challenge: key(), callbackUrl: r.config.callbackUrl })
  ).json();
  assert.equal(result.evolution.code, 'EVOLUTION_VERSION');
  assert.equal(r.seen.length, 1);
  assert.equal(r.callbacks(), 0);
});
test('HTTP: un retorno que solo refleja el desafío no se considera autenticado', async (t) => {
  const r = await rig(t, { proof: false });
  const result = await (
    await r.post({ challenge: key(), callbackUrl: r.config.callbackUrl })
  ).json();
  assert.equal(result.evolution.ok, true);
  assert.equal(result.callback.ok, false);
  assert.equal(result.callback.code, 'CALLBACK_RESPONSE');
});
test('HTTP: URL de callback, JSON, tamaño y campos no pueden cambiar los destinos', async (t) => {
  const r = await rig(t);
  assert.equal(
    (await r.post({ challenge: key(), callbackUrl: 'https://untrusted.test' + PROBE_PATH })).status,
    409,
  );
  assert.equal(
    (await r.post({ challenge: key(), callbackUrl: r.config.callbackUrl, extra: true })).status,
    409,
  );
  assert.equal(
    (await r.post({ challenge: 'x'.repeat(3000), callbackUrl: r.config.callbackUrl })).status,
    413,
  );
  assert.equal(r.seen.length, 0);
  assert.equal(r.callbacks(), 0);
});
test('respuestas malformadas y redirecciones del upstream se rechazan', async () => {
  const config = {
    evolutionOrigin: 'http://evolution:8080',
    apiKey: key(),
    version: '2.3.8',
    callbackUrl: 'https://monzo.example.test' + PROBE_PATH,
  };
  const malformed = await checkEvolution(
    config,
    async () =>
      new Response('x'.repeat(20000), { headers: { 'content-type': 'application/json' } }),
  );
  assert.equal(malformed.code, 'EVOLUTION_INVALID_RESPONSE');
  const offline = await checkEvolution(config, async (_url, init) => {
    assert.equal(init.redirect, 'error');
    throw new Error('redirect blocked');
  });
  assert.equal(offline.code, 'EVOLUTION_UNREACHABLE');
});
test('HTTP: exige Bearer, limita solicitudes autenticadas y mantiene la consulta de salud', async (t) => {
  const r = await rig(t);
  assert.equal(
    (await fetch(r.gateway + '/v1/status', { headers: { authorization: r.config.gatewayKey } }))
      .status,
    401,
  );
  for (let i = 0; i < 20; i++) {
    const result = await fetch(r.gateway + '/v1/status', {
      headers: { authorization: 'Bearer ' + r.config.gatewayKey },
    });
    assert.equal(result.status, 200);
    await result.body.cancel();
  }
  const limited = await fetch(r.gateway + '/v1/status', {
    headers: { authorization: 'Bearer ' + r.config.gatewayKey },
  });
  assert.equal(limited.status, 429);
  assert.equal((await fetch(r.gateway + '/healthz')).status, 200);
});
